import asyncio
import json
import urllib.error
import urllib.request
import uuid
from time import monotonic
from typing import Any

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse

from app.config import get_settings
from app.pricing import PricingRequest, calculate_pricing
from app.zapier_client import list_zapier_tools

app = FastAPI(title="spark-pricing-agent", version="0.1.0")
_pricing_jobs: dict[str, dict[str, Any]] = {}
_pricing_tasks: dict[str, asyncio.Task[None]] = {}
_JOB_TTL_SECONDS = 600


@app.get("/api/health")
@app.get("/healthz")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": "python-mcp"}


@app.get("/api/diagnostics/runtime")
async def diagnostics_runtime() -> dict[str, Any]:
    settings = get_settings()
    return {
        "ok": True,
        "runtime": "python-fastapi",
        "provider": settings.pricing_provider,
        "hasMcpUrl": bool(settings.zapier_mcp_server_url),
        "hasMcpKey": bool(settings.zapier_mcp_key),
        "urlHost": _url_host(settings.zapier_mcp_server_url),
    }


@app.get("/api/diagnostics/mcp")
async def diagnostics_mcp() -> JSONResponse:
    settings = get_settings()
    started = monotonic()

    if not settings.zapier_mcp_server_url or not settings.zapier_mcp_key:
        return JSONResponse(
            {
                "ok": False,
                "runtime": "python-fastapi",
                "provider": settings.pricing_provider,
                "runtimeMs": int((monotonic() - started) * 1000),
                "error": "Zapier MCP URL or key is not configured.",
            },
            status_code=500,
        )

    try:
        tool_names = await asyncio.wait_for(
            list_zapier_tools(
                server_url=settings.zapier_mcp_server_url,
                token=settings.zapier_mcp_key,
            ),
            timeout=8,
        )
        return JSONResponse(
            {
                "ok": True,
                "runtime": "python-fastapi",
                "provider": settings.pricing_provider,
                "runtimeMs": int((monotonic() - started) * 1000),
                "toolNames": tool_names,
            }
        )
    except Exception as exc:
        return JSONResponse(
            {
                "ok": False,
                "runtime": "python-fastapi",
                "provider": settings.pricing_provider,
                "runtimeMs": int((monotonic() - started) * 1000),
                "error": str(exc)[:1000],
            },
            status_code=502,
        )


@app.get("/api/diagnostics/network")
async def diagnostics_network() -> JSONResponse:
    settings = get_settings()
    started = monotonic()

    if not settings.zapier_mcp_server_url or not settings.zapier_mcp_key:
        return JSONResponse(
            {
                "ok": False,
                "runtime": "python-fastapi",
                "provider": settings.pricing_provider,
                "runtimeMs": int((monotonic() - started) * 1000),
                "error": "Zapier MCP URL or key is not configured.",
            },
            status_code=500,
        )

    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(
                _post_zapier_mcp_probe,
                settings.zapier_mcp_server_url,
                settings.zapier_mcp_key,
            ),
            timeout=5,
        )
        return JSONResponse(
            {
                "ok": result["status"] < 500,
                "runtime": "python-fastapi",
                "provider": settings.pricing_provider,
                "runtimeMs": int((monotonic() - started) * 1000),
                **result,
            },
            status_code=200 if result["status"] < 500 else 502,
        )
    except Exception as exc:
        return JSONResponse(
            {
                "ok": False,
                "runtime": "python-fastapi",
                "provider": settings.pricing_provider,
                "runtimeMs": int((monotonic() - started) * 1000),
                "error": str(exc)[:1000],
                "errorType": type(exc).__name__,
            },
            status_code=502,
        )


@app.post("/api/price")
async def price(body: PricingRequest) -> JSONResponse:
    _cleanup_pricing_jobs()
    request_id = uuid.uuid4().hex
    _pricing_jobs[request_id] = {
        "status": "pending",
        "startedAt": monotonic(),
    }
    _pricing_tasks[request_id] = asyncio.create_task(_run_pricing_job(request_id, body))

    return JSONResponse({"status": "pending", "requestId": request_id})


@app.get("/api/price/status")
async def price_status(requestId: str) -> JSONResponse:
    _cleanup_pricing_jobs()
    job = _pricing_jobs.get(requestId)

    if not job:
        return JSONResponse({"status": "not_found", "error": "Pricing request was not found or expired."}, status_code=404)

    payload = {key: value for key, value in job.items() if key != "startedAt"}
    payload["requestId"] = requestId
    payload["runtimeMs"] = int((monotonic() - job["startedAt"]) * 1000)
    return JSONResponse(payload)


@app.post("/api/price/sync")
async def price_sync(body: PricingRequest) -> JSONResponse:
    settings = get_settings()
    try:
        result = await asyncio.wait_for(calculate_pricing(settings, body), timeout=28)
        return JSONResponse({"result": result})
    except TimeoutError:
        return JSONResponse({"error": "Pricing request timed out after 28 seconds."}, status_code=504)
    except Exception as exc:
        return JSONResponse({"error": str(exc)[:1200]}, status_code=502)


async def _run_pricing_job(request_id: str, body: PricingRequest) -> None:
    settings = get_settings()

    try:
        result = await asyncio.wait_for(calculate_pricing(settings, body), timeout=90)
        _pricing_jobs[request_id] = {
            "status": "complete",
            "startedAt": _pricing_jobs.get(request_id, {}).get("startedAt", monotonic()),
            "result": result,
        }
    except BaseException as exc:
        _pricing_jobs[request_id] = {
            "status": "error",
            "startedAt": _pricing_jobs.get(request_id, {}).get("startedAt", monotonic()),
            "error": f"{type(exc).__name__}: {str(exc)[:1200]}",
        }
    finally:
        _pricing_tasks.pop(request_id, None)


def _cleanup_pricing_jobs() -> None:
    cutoff = monotonic() - _JOB_TTL_SECONDS
    expired = [request_id for request_id, job in _pricing_jobs.items() if job.get("startedAt", 0) < cutoff]
    for request_id in expired:
        _pricing_jobs.pop(request_id, None)
        task = _pricing_tasks.pop(request_id, None)
        if task and not task.done():
            task.cancel()


@app.get("/api/diagnostics/price-sample")
async def diagnostics_price_sample() -> JSONResponse:
    settings = get_settings()
    started = monotonic()
    sample = PricingRequest(
        planTier="enterprise",
        region="NORTHAM",
        productLine="ac",
        resellerId="0",
        contactLimit=600000,
        listPrice=4700,
        smsFlag=False,
        whatsapp=False,
        termLength=12,
    )

    try:
        result = await asyncio.wait_for(calculate_pricing(settings, sample), timeout=28)
        return JSONResponse(
            {
                "ok": True,
                "runtime": "python-fastapi",
                "provider": settings.pricing_provider,
                "runtimeMs": int((monotonic() - started) * 1000),
                "result": result,
            }
        )
    except TimeoutError:
        return JSONResponse(
            {
                "ok": False,
                "runtime": "python-fastapi",
                "provider": settings.pricing_provider,
                "runtimeMs": int((monotonic() - started) * 1000),
                "error": "Pricing request timed out after 28 seconds.",
            },
            status_code=504,
        )
    except Exception as exc:
        return JSONResponse(
            {
                "ok": False,
                "runtime": "python-fastapi",
                "provider": settings.pricing_provider,
                "runtimeMs": int((monotonic() - started) * 1000),
                "error": str(exc)[:1200],
            },
            status_code=502,
        )


@app.get("/")
async def index() -> HTMLResponse:
    return HTMLResponse(_INDEX_HTML)


def _url_host(value: str | None) -> str | None:
    if not value:
        return None

    try:
        from urllib.parse import urlparse

        return urlparse(value).netloc
    except Exception:
        return None


def _post_zapier_mcp_probe(server_url: str, token: str) -> dict[str, Any]:
    body = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": "diagnostic-ping",
            "method": "tools/list",
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        server_url,
        data=body,
        method="POST",
        headers={
            "accept": "application/json, text/event-stream",
            "content-type": "application/json",
            "authorization": f"Bearer {token}",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=4) as response:
            text = response.read(800).decode("utf-8", errors="replace")
            return {
                "status": response.status,
                "preview": text,
            }
    except urllib.error.HTTPError as exc:
        text = exc.read(800).decode("utf-8", errors="replace")
        return {
            "status": exc.code,
            "preview": text,
        }


_INDEX_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pricing Agent</title>
  <style>
    :root {
      --charcoal-1000: #00001f;
      --charcoal-900: #05052b;
      --charcoal-800: #25263b;
      --charcoal-700: #35354a;
      --charcoal-500: #70718d;
      --charcoal-400: #9f9fb8;
      --charcoal-300: #dfe0ea;
      --ac-blue-700: #004cff;
      --ac-blue-500: #819eff;
      --ac-blue-300: #d7e5ff;
      --midday-500: #ffce54;
      --moss-500: #7db485;
      --red-500: #ff8686;
      --red-300: #ffcaca;
      --white: #ffffff;
      --ai-gradient: linear-gradient(180deg, #004cff 21%, #eb4786 67%, #f67dac 100%);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--white);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at 12% 8%, rgba(0, 76, 255, .28), transparent 32%),
        linear-gradient(145deg, var(--charcoal-1000), #080832 52%, #11113e);
      min-height: 100vh;
    }
    main { min-height: 100vh; padding: 28px; }
    .shell {
      max-width: 1220px;
      margin: 0 auto;
      background: rgba(255,255,255,.97);
      color: var(--charcoal-1000);
      border: 1px solid rgba(223,224,234,.25);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 24px 70px rgba(0,0,31,.32);
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: center;
      padding: 20px 24px;
      border-bottom: 1px solid var(--charcoal-300);
      background: linear-gradient(90deg, #fff, #f6f8ff);
    }
    .brandLockup { display: flex; align-items: center; gap: 14px; min-width: 0; }
    .pixelAgent {
      width: 36px;
      height: 36px;
      flex: 0 0 36px;
      image-rendering: pixelated;
      background:
        linear-gradient(var(--ac-blue-700), var(--ac-blue-700)) 8px 4px / 20px 4px no-repeat,
        linear-gradient(var(--charcoal-1000), var(--charcoal-1000)) 4px 8px / 28px 20px no-repeat,
        linear-gradient(var(--ac-blue-300), var(--ac-blue-300)) 10px 14px / 4px 4px no-repeat,
        linear-gradient(var(--midday-500), var(--midday-500)) 22px 14px / 4px 4px no-repeat,
        linear-gradient(var(--ac-blue-700), var(--ac-blue-700)) 8px 28px / 6px 4px no-repeat,
        linear-gradient(var(--ac-blue-700), var(--ac-blue-700)) 22px 28px / 6px 4px no-repeat;
      animation: botBreathe 2.8s steps(2, end) infinite;
      filter: drop-shadow(0 6px 12px rgba(0,76,255,.25));
    }
    @keyframes botBreathe {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-3px); }
    }
    h1 { margin: 0; font-size: 22px; font-weight: 700; }
    h2 { margin: 0; font-size: 15px; }
    .eyebrow { margin: 0 0 4px; color: var(--charcoal-500); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .pill {
      border: 1px solid var(--charcoal-300);
      background: #fff;
      border-radius: 999px;
      padding: 7px 10px;
      font-size: 12px;
      color: var(--charcoal-700);
      white-space: nowrap;
    }
    .grid { display: grid; grid-template-columns: minmax(0, 1.48fr) minmax(360px, .82fr); min-height: 700px; }
    form { padding: 24px; border-right: 1px solid var(--charcoal-300); background: #fff; }
    .section { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .section span { color: var(--charcoal-500); font-size: 12px; }
    .fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    label { display: grid; gap: 6px; color: var(--charcoal-700); font-size: 12px; font-weight: 650; }
    input, select {
      width: 100%;
      border: 1px solid var(--charcoal-300);
      border-radius: 6px;
      padding: 10px 11px;
      color: var(--charcoal-1000);
      background: #fff;
      font: inherit;
      font-size: 14px;
      transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease;
    }
    input:focus, select:focus {
      outline: 0;
      border-color: var(--ac-blue-700);
      box-shadow: 0 0 0 3px rgba(0,76,255,.14);
    }
    button {
      margin-top: 18px;
      width: 100%;
      border: 0;
      border-radius: 6px;
      padding: 12px 14px;
      background: var(--ac-blue-700);
      color: var(--white);
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 10px 24px rgba(0,76,255,.22);
      transition: transform .18s ease, box-shadow .18s ease, background .18s ease;
    }
    button:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 14px 30px rgba(0,76,255,.28); }
    button:disabled { opacity: .68; cursor: wait; transform: none; }
    aside { padding: 24px; background: linear-gradient(180deg, #f7f8ff, #eef2ff); }
    .error { color: #8a1f17; background: #fff1f0; border: 1px solid #fecdca; border-radius: 6px; padding: 10px 12px; margin-top: 14px; white-space: pre-wrap; }
    .empty, .loadingState {
      margin-top: 20px;
      color: var(--charcoal-500);
      background: #fff;
      border: 1px solid var(--charcoal-300);
      border-radius: 8px;
      padding: 18px;
    }
    .loadingState {
      display: grid;
      gap: 14px;
      min-height: 156px;
      align-content: center;
      position: relative;
      overflow: hidden;
    }
    .loadingState::before {
      content: "";
      position: absolute;
      inset: 0;
      background: repeating-linear-gradient(90deg, transparent 0 16px, rgba(0,76,255,.05) 16px 18px);
      animation: scanGrid 1.6s linear infinite;
    }
    @keyframes scanGrid { from { transform: translateX(-18px); } to { transform: translateX(18px); } }
    .loadingLabel { position: relative; z-index: 1; font-weight: 700; color: var(--charcoal-800); }
    .pixelTrack {
      position: relative;
      z-index: 1;
      height: 12px;
      border-radius: 0;
      background: var(--charcoal-300);
      overflow: hidden;
      image-rendering: pixelated;
    }
    .pixelTrack::after {
      content: "";
      display: block;
      width: 34%;
      height: 100%;
      background: var(--ai-gradient);
      animation: pixelRun 1.1s steps(7, end) infinite;
    }
    @keyframes pixelRun { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
    .result { display: grid; gap: 14px; margin-top: 16px; }
    .approval { display: flex; justify-content: space-between; gap: 12px; padding: 14px; border-radius: 8px; border: 1px solid var(--charcoal-300); background: #fff; animation: panelIn .32s ease both; }
    .approval.ok strong { color: var(--moss-500); }
    .approval.warn strong { color: #b42318; }
    .metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .metric { padding: 14px; background: #fff; border: 1px solid var(--charcoal-300); border-radius: 8px; animation: panelIn .34s ease both; }
    .metric:nth-child(2) { animation-delay: .03s; }
    .metric:nth-child(3) { animation-delay: .06s; }
    .metric:nth-child(4) { animation-delay: .09s; }
    @keyframes panelIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    .metric span { display: block; color: var(--charcoal-500); font-size: 12px; margin-bottom: 4px; }
    .metric strong { font-size: 24px; color: var(--charcoal-1000); }
    ul { margin: 8px 0 0; padding-left: 18px; color: var(--charcoal-700); }
    dl { display: grid; gap: 8px; margin: 0; }
    .meta { display: grid; grid-template-columns: 84px 1fr; gap: 6px; font-size: 13px; }
    dt { color: var(--charcoal-500); }
    dd { margin: 0; word-break: break-word; }
    @media (max-width: 880px) {
      main { padding: 0; }
      .shell { border-radius: 0; border-left: 0; border-right: 0; }
      .grid { grid-template-columns: 1fr; }
      form { border-right: 0; border-bottom: 1px solid var(--charcoal-300); }
      .fields { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <div class="shell">
      <header>
        <div class="brandLockup">
          <div class="pixelAgent" aria-hidden="true"></div>
          <div>
            <p class="eyebrow">Autonomous pricing workspace</p>
            <h1>Discount guidance</h1>
          </div>
        </div>
        <div class="pill">Snowflake via Zapier MCP</div>
      </header>
      <div class="grid">
        <form id="pricingForm">
          <div class="section"><h2>Model inputs</h2><span>All optional</span></div>
          <div class="fields">
            <label>Account ID<input name="accountId" placeholder="AccountID" /></label>
            <label>Reseller ID<input name="resellerId" placeholder="RSID" /></label>
            <label>Plan tier<input name="planTier" placeholder="enterprise" /></label>
            <label>Region<input name="region" placeholder="NORTHAM" /></label>
            <label>Product line<input name="productLine" placeholder="ac" /></label>
            <label>Contact limit<input name="contactLimit" type="number" min="0" placeholder="600000" /></label>
            <label>List price<input name="listPrice" type="number" min="0" placeholder="4700" /></label>
            <label>Discount rate<input name="discountRate" type="number" min="0" /></label>
            <label>SMS credits<input name="smsCredits" type="number" min="0" /></label>
            <label>Term length<input name="termLength" type="number" min="0" placeholder="12" /></label>
            <label>ARR<input name="arr" type="number" min="0" /></label>
            <label>Price realization<input name="priceRealization" type="number" min="0" step="0.0001" /></label>
            <label>SMS<select name="smsFlag"><option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></select></label>
            <label>WhatsApp<select name="whatsapp"><option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></select></label>
          </div>
          <div id="error" class="error" hidden></div>
          <button id="submitButton" type="submit">Calculate guidance</button>
        </form>
        <aside>
          <div class="section"><h2>Guidance</h2><span id="provider">Waiting</span></div>
          <div id="output" class="empty">Blank fields are omitted so the pricing model can infer from what is available.</div>
        </aside>
      </div>
    </div>
  </main>
  <script>
    const form = document.getElementById("pricingForm");
    const button = document.getElementById("submitButton");
    const errorBox = document.getElementById("error");
    const output = document.getElementById("output");
    const provider = document.getElementById("provider");
    const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    const percent = (value) => `${Number(value || 0).toFixed(Number(value || 0) % 1 ? 1 : 0)}%`;
    const optionalNumber = (value) => value === "" ? undefined : Number(value);
    const optionalString = (value) => value === "" ? undefined : value;
    const optionalBoolean = (value) => value === "" ? undefined : value === "true";

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      button.disabled = true;
      button.textContent = "Calculating...";
      errorBox.hidden = true;
      setLoadingState("Running pricing guidance...");

      const data = new FormData(form);
      const body = {
        accountId: optionalString(data.get("accountId")),
        resellerId: optionalString(data.get("resellerId")),
        planTier: optionalString(data.get("planTier")),
        region: optionalString(data.get("region")),
        productLine: optionalString(data.get("productLine")),
        contactLimit: optionalNumber(data.get("contactLimit")),
        listPrice: optionalNumber(data.get("listPrice")),
        discountRate: optionalNumber(data.get("discountRate")),
        smsCredits: optionalNumber(data.get("smsCredits")),
        termLength: optionalNumber(data.get("termLength")),
        arr: optionalNumber(data.get("arr")),
        priceRealization: optionalNumber(data.get("priceRealization")),
        smsFlag: optionalBoolean(data.get("smsFlag")),
        whatsapp: optionalBoolean(data.get("whatsapp")),
      };

      Object.keys(body).forEach((key) => body[key] === undefined && delete body[key]);

      try {
        const response = await fetch("/api/price", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const text = await response.text();
        let payload;
        try {
          payload = JSON.parse(text);
        } catch {
          throw new Error(`Pricing request returned HTTP ${response.status}: ${text.slice(0, 800) || response.statusText}`);
        }
        if (!response.ok) throw new Error(payload.error || text.slice(0, 500));
        if (payload.status === "pending" && payload.requestId) {
          const result = await pollPricingStatus(payload.requestId);
          renderResult(result);
        } else if (payload.result) {
          renderResult(payload.result);
        } else {
          throw new Error(`Pricing response did not include result: ${text.slice(0, 500)}`);
        }
      } catch (error) {
        errorBox.hidden = false;
        errorBox.textContent = error.message || "Pricing request failed.";
        output.className = "empty";
        output.textContent = "No guidance returned.";
      } finally {
        button.disabled = false;
        button.textContent = "Calculate guidance";
      }
    });

    async function pollPricingStatus(requestId) {
      for (let attempt = 0; attempt < 70; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        setLoadingState(`Running pricing guidance... ${attempt + 1}`);
        const response = await fetch(`/api/price/status?requestId=${encodeURIComponent(requestId)}`);
        const text = await response.text();
        let payload;
        try {
          payload = JSON.parse(text);
        } catch {
          throw new Error(`Pricing status returned HTTP ${response.status}: ${text.slice(0, 800) || response.statusText}`);
        }
        if (payload.status === "complete" && payload.result) return payload.result;
        if (payload.status === "error") throw new Error(payload.error || "Pricing request failed.");
        if (!response.ok && payload.status !== "pending") throw new Error(payload.error || text.slice(0, 500));
      }
      throw new Error("Pricing request timed out while waiting for the background job.");
    }

    function setLoadingState(label) {
      output.className = "loadingState";
      output.innerHTML = `
        <div class="pixelAgent" aria-hidden="true"></div>
        <div class="loadingLabel">${escapeHtml(label)}</div>
        <div class="pixelTrack" aria-hidden="true"></div>
      `;
    }

    function renderResult(result) {
      provider.textContent = result.provider || "snowflake";
      output.className = "result";
      output.innerHTML = `
        <div class="approval ${result.approvalRequired ? "warn" : "ok"}">
          <strong>${result.approvalRequired ? "Approval required" : "Auto-approvable"}</strong>
          <span>${result.approvalLevel || "None"}</span>
        </div>
        <div class="metrics">
          <div class="metric"><span>Recommended</span><strong>${percent(result.recommendedDiscount)}</strong></div>
          <div class="metric"><span>Maximum</span><strong>${percent(result.maxDiscount)}</strong></div>
          <div class="metric"><span>Quote price</span><strong>${money.format(result.recommendedPrice || 0)}</strong></div>
          <div class="metric"><span>Floor</span><strong>${money.format(result.floorPrice || 0)}</strong></div>
        </div>
        <div class="metric"><span>Reason codes</span><ul>${(result.reasonCodes || []).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></div>
        <dl>
          <div class="meta"><dt>Quote ID</dt><dd>${escapeHtml(result.quoteId || "")}</dd></div>
          <div class="meta"><dt>Model</dt><dd>${escapeHtml(result.modelVersion || "")}</dd></div>
        </dl>
      `;
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
      }[char]));
    }
  </script>
</body>
</html>"""
