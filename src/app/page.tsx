"use client";

import { FormEvent, useMemo, useState } from "react";
import type { PricingResult } from "@/lib/pricing/schema";

type FormState = {
  repEmail: string;
  accountName: string;
  opportunityId: string;
  dealType: string;
  customerSegment: string;
  productPackage: string;
  region: string;
  seats: string;
  contractMonths: string;
  listPrice: string;
  requestedDiscount: string;
  notes: string;
};

const initialForm: FormState = {
  repEmail: "",
  accountName: "",
  opportunityId: "",
  dealType: "new_business",
  customerSegment: "mid_market",
  productPackage: "growth",
  region: "na",
  seats: "250",
  contractMonths: "12",
  listPrice: "50000",
  requestedDiscount: "10",
  notes: ""
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const percent = (value: number) => `${value.toFixed(value % 1 ? 1 : 0)}%`;

export default function Home() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [result, setResult] = useState<PricingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const requestedDiscountNumber = useMemo(
    () => Number.parseFloat(form.requestedDiscount || "0"),
    [form.requestedDiscount]
  );

  function updateField(name: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submitPricingRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setResult(null);

    const response = await fetch("/api/price", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...form,
        seats: Number(form.seats),
        contractMonths: Number(form.contractMonths),
        listPrice: Number(form.listPrice),
        requestedDiscount: Number(form.requestedDiscount || 0)
      })
    });

    const payload = await response.json();
    setIsLoading(false);

    if (!response.ok) {
      setError(payload.error ?? "Pricing request failed.");
      return;
    }

    setResult(payload.result);
  }

  return (
    <main className="shell">
      <section className="workbench">
        <header className="topbar">
          <div>
            <p className="eyebrow">Spark pricing workspace</p>
            <h1>Discount guidance</h1>
          </div>
          <div className="statusPill">Provider-ready</div>
        </header>

        <div className="contentGrid">
          <form className="pricingForm" onSubmit={submitPricingRequest}>
            <div className="sectionHeader">
              <h2>Deal inputs</h2>
              <span>Required</span>
            </div>

            <label>
              Rep email
              <input
                autoComplete="email"
                name="repEmail"
                onChange={(event) => updateField("repEmail", event.target.value)}
                placeholder="rep@company.com"
                required
                type="email"
                value={form.repEmail}
              />
            </label>

            <div className="twoCol">
              <label>
                Account
                <input
                  name="accountName"
                  onChange={(event) => updateField("accountName", event.target.value)}
                  placeholder="Acme Inc."
                  required
                  value={form.accountName}
                />
              </label>

              <label>
                Opportunity ID
                <input
                  name="opportunityId"
                  onChange={(event) => updateField("opportunityId", event.target.value)}
                  placeholder="006..."
                  required
                  value={form.opportunityId}
                />
              </label>
            </div>

            <div className="threeCol">
              <label>
                Deal type
                <select value={form.dealType} onChange={(event) => updateField("dealType", event.target.value)}>
                  <option value="new_business">New business</option>
                  <option value="expansion">Expansion</option>
                  <option value="renewal">Renewal</option>
                </select>
              </label>

              <label>
                Segment
                <select
                  value={form.customerSegment}
                  onChange={(event) => updateField("customerSegment", event.target.value)}
                >
                  <option value="smb">SMB</option>
                  <option value="mid_market">Mid-market</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </label>

              <label>
                Region
                <select value={form.region} onChange={(event) => updateField("region", event.target.value)}>
                  <option value="na">North America</option>
                  <option value="emea">EMEA</option>
                  <option value="apac">APAC</option>
                  <option value="latam">LATAM</option>
                </select>
              </label>
            </div>

            <div className="threeCol">
              <label>
                Package
                <select
                  value={form.productPackage}
                  onChange={(event) => updateField("productPackage", event.target.value)}
                >
                  <option value="starter">Starter</option>
                  <option value="growth">Growth</option>
                  <option value="enterprise">Enterprise</option>
                  <option value="custom">Custom</option>
                </select>
              </label>

              <label>
                Seats
                <input
                  min="1"
                  onChange={(event) => updateField("seats", event.target.value)}
                  required
                  type="number"
                  value={form.seats}
                />
              </label>

              <label>
                Term
                <select
                  value={form.contractMonths}
                  onChange={(event) => updateField("contractMonths", event.target.value)}
                >
                  <option value="1">Monthly</option>
                  <option value="12">12 months</option>
                  <option value="24">24 months</option>
                  <option value="36">36 months</option>
                </select>
              </label>
            </div>

            <div className="twoCol">
              <label>
                List price
                <input
                  min="1"
                  onChange={(event) => updateField("listPrice", event.target.value)}
                  required
                  type="number"
                  value={form.listPrice}
                />
              </label>

              <label>
                Requested discount
                <input
                  max="95"
                  min="0"
                  onChange={(event) => updateField("requestedDiscount", event.target.value)}
                  type="number"
                  value={form.requestedDiscount}
                />
              </label>
            </div>

            <label>
              Notes
              <textarea
                onChange={(event) => updateField("notes", event.target.value)}
                placeholder="Competitor pressure, strategic logo, procurement notes..."
                rows={4}
                value={form.notes}
              />
            </label>

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
                  <span>Requested discount</span>
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
                <strong>Ready for a deal.</strong>
                <p>The mock pricing provider is active until the Zapier webhook is added.</p>
              </div>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}
