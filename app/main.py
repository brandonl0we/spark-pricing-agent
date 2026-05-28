from time import monotonic
from typing import Any

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse

from app.config import get_settings
from app.pricing import PricingRequest, calculate_pricing
from app.zapier_client import list_zapier_tools

app = FastAPI(title="spark-pricing-agent", version="0.1.0")


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
        tool_names = await list_zapier_tools(
            server_url=settings.zapier_mcp_server_url,
            token=settings.zapier_mcp_key,
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


@app.post("/api/price")
async def price(body: PricingRequest) -> JSONResponse:
    settings = get_settings()

    try:
        result = await calculate_pricing(settings, body)
        return JSONResponse({"result": result})
    except Exception as exc:
        return JSONResponse({"error": str(exc)[:1200]}, status_code=502)


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


_INDEX_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pricing Agent</title>
  <style>
    :root {
      --ink: #111827;
      --muted: #667085;
      --line: #d9dee8;
      --panel: #f8fafc;
      --blue: #245cff;
      --green: #087443;
      --red: #b42318;
      --white: #fff;
    }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #eef2f7; }
    main { min-height: 100vh; padding: 24px; }
    .shell { max-width: 1180px; margin: 0 auto; background: var(--white); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 20px 24px; border-bottom: 1px solid var(--line); }
    h1 { margin: 0; font-size: 22px; font-weight: 650; }
    h2 { margin: 0; font-size: 15px; }
    .eyebrow { margin: 0 0 4px; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .pill { border: 1px solid var(--line); background: var(--panel); border-radius: 999px; padding: 7px 10px; font-size: 12px; color: var(--muted); }
    .grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(340px, .85fr); min-height: 680px; }
    form { padding: 22px 24px; border-right: 1px solid var(--line); }
    .section { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
    .section span { color: var(--muted); font-size: 12px; }
    .fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    label { display: grid; gap: 6px; color: #344054; font-size: 12px; font-weight: 600; }
    input, select { width: 100%; border: 1px solid var(--line); border-radius: 6px; padding: 10px 11px; color: var(--ink); background: var(--white); font: inherit; font-size: 14px; }
    input:focus, select:focus { outline: 2px solid rgba(36, 92, 255, .18); border-color: var(--blue); }
    button { margin-top: 18px; width: 100%; border: 0; border-radius: 6px; padding: 12px 14px; background: var(--blue); color: var(--white); font: inherit; font-weight: 650; cursor: pointer; }
    button:disabled { opacity: .55; cursor: wait; }
    aside { padding: 22px 24px; background: var(--panel); }
    .error { color: var(--red); background: #fff1f0; border: 1px solid #fecdca; border-radius: 6px; padding: 10px 12px; margin-top: 14px; white-space: pre-wrap; }
    .empty { margin-top: 20px; color: var(--muted); background: var(--white); border: 1px solid var(--line); border-radius: 8px; padding: 18px; }
    .result { display: grid; gap: 14px; margin-top: 16px; }
    .approval { display: flex; justify-content: space-between; gap: 12px; padding: 14px; border-radius: 8px; border: 1px solid var(--line); background: var(--white); }
    .approval.ok strong { color: var(--green); }
    .approval.warn strong { color: var(--red); }
    .metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .metric { padding: 14px; background: var(--white); border: 1px solid var(--line); border-radius: 8px; }
    .metric span { display: block; color: var(--muted); font-size: 12px; margin-bottom: 4px; }
    .metric strong { font-size: 22px; }
    ul { margin: 8px 0 0; padding-left: 18px; color: #344054; }
    dl { display: grid; gap: 8px; margin: 0; }
    .meta { display: grid; grid-template-columns: 84px 1fr; gap: 6px; font-size: 13px; }
    dt { color: var(--muted); }
    dd { margin: 0; word-break: break-word; }
    @media (max-width: 880px) {
      main { padding: 0; }
      .shell { border-radius: 0; border-left: 0; border-right: 0; }
      .grid { grid-template-columns: 1fr; }
      form { border-right: 0; border-bottom: 1px solid var(--line); }
      .fields { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <div class="shell">
      <header>
        <div>
          <p class="eyebrow">Spark pricing workspace</p>
          <h1>Discount guidance</h1>
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
      output.className = "empty";
      output.textContent = "Running pricing guidance...";

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
        const payload = JSON.parse(text);
        if (!response.ok) throw new Error(payload.error || text.slice(0, 500));
        renderResult(payload.result);
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
