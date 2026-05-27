"use client";

import { FormEvent, useMemo, useState } from "react";
import type { PricingResult } from "@/lib/pricing/schema";

type FormState = {
  accountId: string;
  planTier: string;
  region: string;
  productLine: string;
  resellerId: string;
  contactLimit: string;
  listPrice: string;
  discountRate: string;
  smsFlag: string;
  smsCredits: string;
  whatsapp: string;
  termLength: string;
  arr: string;
  priceRealization: string;
};

const initialForm: FormState = {
  accountId: "",
  planTier: "",
  region: "",
  productLine: "",
  resellerId: "",
  contactLimit: "",
  listPrice: "",
  discountRate: "",
  smsFlag: "",
  smsCredits: "",
  whatsapp: "",
  termLength: "",
  arr: "",
  priceRealization: ""
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const percent = (value: number) => `${value.toFixed(value % 1 ? 1 : 0)}%`;

const booleanOptions = [
  { label: "Unknown", value: "" },
  { label: "Yes", value: "true" },
  { label: "No", value: "false" }
];

function emptyToUndefined(value: string) {
  return value === "" ? undefined : value;
}

function emptyToNumber(value: string) {
  return value === "" ? undefined : Number(value);
}

function parseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export default function Home() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [result, setResult] = useState<PricingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const requestedDiscountNumber = useMemo(
    () => Number.parseFloat(form.discountRate || "0"),
    [form.discountRate]
  );

  function updateField(name: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function pollPricingStatus(requestId: string) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await wait(2_000);

      const response = await fetch(`/api/price/status?requestId=${encodeURIComponent(requestId)}`);
      const responseText = await response.text();
      const payload = parseJson(responseText);

      if (!response.ok) {
        throw new Error(
          payload?.error ??
            `Pricing status failed with HTTP ${response.status}: ${responseText.slice(0, 500) || response.statusText}`
        );
      }

      if (payload?.status === "complete" && payload.result) return payload.result as PricingResult;
      if (payload?.status === "error") throw new Error(payload.error ?? "Pricing request failed.");
    }

    throw new Error("Pricing request timed out while waiting for Zapier.");
  }

  async function submitPricingRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setResult(null);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 60_000);

    try {
      const response = await fetch("/api/price", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId: emptyToUndefined(form.accountId),
          planTier: emptyToUndefined(form.planTier),
          region: emptyToUndefined(form.region),
          productLine: emptyToUndefined(form.productLine),
          resellerId: emptyToUndefined(form.resellerId),
          contactLimit: emptyToNumber(form.contactLimit),
          listPrice: emptyToNumber(form.listPrice),
          discountRate: emptyToNumber(form.discountRate),
          smsFlag: form.smsFlag === "" ? undefined : form.smsFlag === "true",
          smsCredits: emptyToNumber(form.smsCredits),
          whatsapp: form.whatsapp === "" ? undefined : form.whatsapp === "true",
          termLength: emptyToNumber(form.termLength),
          arr: emptyToNumber(form.arr),
          priceRealization: emptyToNumber(form.priceRealization)
        })
      });

      const responseText = await response.text();
      const payload = parseJson(responseText);

      if (!response.ok) {
        setError(
          payload?.error ??
            `Pricing request failed with HTTP ${response.status}: ${responseText.slice(0, 500) || response.statusText}`
        );
        return;
      }

      if (!payload?.result) {
        if (payload?.status === "pending" && typeof payload.requestId === "string") {
          setResult(await pollPricingStatus(payload.requestId));
          return;
        }

        setError(`Pricing response was not valid JSON: ${responseText.slice(0, 500) || "Empty response"}`);
        return;
      }

      setResult(payload.result);
    } catch (requestError) {
      setError(
        requestError instanceof Error && requestError.name === "AbortError"
          ? "Pricing request timed out after 60 seconds."
          : `Pricing request failed before a response was returned: ${
              requestError instanceof Error ? requestError.message : "Unknown browser error"
            }`
      );
    } finally {
      window.clearTimeout(timeout);
      setIsLoading(false);
    }
  }

  return (
    <main className="shell">
      <section className="workbench">
        <header className="topbar">
          <div>
            <p className="eyebrow">Spark pricing workspace</p>
            <h1>Discount guidance</h1>
          </div>
          <div className="statusPill">Snowflake fields</div>
        </header>

        <div className="contentGrid">
          <form className="pricingForm" onSubmit={submitPricingRequest}>
            <div className="sectionHeader">
              <h2>Model inputs</h2>
              <span>All optional</span>
            </div>

            <div className="twoCol">
              <label>
                Account ID
                <input
                  name="accountId"
                  onChange={(event) => updateField("accountId", event.target.value)}
                  placeholder="AccountID"
                  value={form.accountId}
                />
              </label>

              <label>
                Reseller ID
                <input
                  name="resellerId"
                  onChange={(event) => updateField("resellerId", event.target.value)}
                  placeholder="RSID"
                  value={form.resellerId}
                />
              </label>
            </div>

            <div className="threeCol">
              <label>
                Plan tier
                <input
                  name="planTier"
                  onChange={(event) => updateField("planTier", event.target.value)}
                  placeholder="Starter, Plus, Pro, Enterprise"
                  value={form.planTier}
                />
              </label>

              <label>
                Region
                <input
                  name="region"
                  onChange={(event) => updateField("region", event.target.value)}
                  placeholder="NA, EMEA, APAC"
                  value={form.region}
                />
              </label>

              <label>
                Product line
                <input
                  name="productLine"
                  onChange={(event) => updateField("productLine", event.target.value)}
                  placeholder="ProductLine"
                  value={form.productLine}
                />
              </label>
            </div>

            <div className="threeCol">
              <label>
                Contact limit
                <input
                  min="0"
                  name="contactLimit"
                  onChange={(event) => updateField("contactLimit", event.target.value)}
                  type="number"
                  value={form.contactLimit}
                />
              </label>

              <label>
                Term length
                <input
                  min="0"
                  name="termLength"
                  onChange={(event) => updateField("termLength", event.target.value)}
                  placeholder="Months"
                  type="number"
                  value={form.termLength}
                />
              </label>

              <label>
                SMS credits
                <input
                  min="0"
                  name="smsCredits"
                  onChange={(event) => updateField("smsCredits", event.target.value)}
                  type="number"
                  value={form.smsCredits}
                />
              </label>
            </div>

            <div className="threeCol">
              <label>
                List price
                <input
                  min="0"
                  name="listPrice"
                  onChange={(event) => updateField("listPrice", event.target.value)}
                  type="number"
                  value={form.listPrice}
                />
              </label>

              <label>
                Discount rate
                <input
                  min="0"
                  name="discountRate"
                  onChange={(event) => updateField("discountRate", event.target.value)}
                  type="number"
                  value={form.discountRate}
                />
              </label>

              <label>
                ARR
                <input
                  min="0"
                  name="arr"
                  onChange={(event) => updateField("arr", event.target.value)}
                  type="number"
                  value={form.arr}
                />
              </label>
            </div>

            <div className="threeCol">
              <label>
                Price realization
                <input
                  min="0"
                  name="priceRealization"
                  onChange={(event) => updateField("priceRealization", event.target.value)}
                  type="number"
                  value={form.priceRealization}
                />
              </label>

              <label>
                SMS
                <select value={form.smsFlag} onChange={(event) => updateField("smsFlag", event.target.value)}>
                  {booleanOptions.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                WhatsApp
                <select value={form.whatsapp} onChange={(event) => updateField("whatsapp", event.target.value)}>
                  {booleanOptions.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {error ? <div className="errorBox">{error}</div> : null}

            <button className="submitButton" disabled={isLoading} type="submit">
              {isLoading ? "Calculating..." : "Calculate guidance"}
            </button>
          </form>

          <aside className="resultPanel">
            <div className="sectionHeader">
              <h2>Guidance</h2>
              <span>{result ? result.provider : "Waiting"}</span>
            </div>

            {result ? (
              <div className="resultStack">
                <div className={result.approvalRequired ? "approvalWarn" : "approvalOk"}>
                  <strong>{result.approvalRequired ? "Approval required" : "Auto-approvable"}</strong>
                  <span>{result.approvalLevel}</span>
                </div>

                <div className="metricGrid">
                  <div>
                    <span>Recommended</span>
                    <strong>{percent(result.recommendedDiscount)}</strong>
                  </div>
                  <div>
                    <span>Maximum</span>
                    <strong>{percent(result.maxDiscount)}</strong>
                  </div>
                  <div>
                    <span>Quote price</span>
                    <strong>{currency.format(result.recommendedPrice)}</strong>
                  </div>
                  <div>
                    <span>Floor</span>
                    <strong>{currency.format(result.floorPrice)}</strong>
                  </div>
                </div>

                <div className="comparison">
                  <span>Input discount rate</span>
                  <strong>{percent(Number.isFinite(requestedDiscountNumber) ? requestedDiscountNumber : 0)}</strong>
                </div>

                <div>
                  <h3>Reason codes</h3>
                  <ul className="reasonList">
                    {result.reasonCodes.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>

                <dl className="metadata">
                  <div>
                    <dt>Quote ID</dt>
                    <dd>{result.quoteId}</dd>
                  </div>
                  <div>
                    <dt>Model</dt>
                    <dd>{result.modelVersion}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <div className="emptyState">
                <strong>Ready for model inputs.</strong>
                <p>Blank fields are omitted so the pricing model can infer from what is available.</p>
              </div>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}
