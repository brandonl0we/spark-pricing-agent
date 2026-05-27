import { PricingProvider, PricingRequest, PricingResult } from "./schema";
import { isPricingResult } from "./result-utils";

export const zapierPricingProvider: PricingProvider = {
  async calculate(request: PricingRequest): Promise<PricingResult> {
    const webhookUrl = process.env.ZAPIER_PRICING_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new Error("ZAPIER_PRICING_WEBHOOK_URL is not configured.");
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.ZAPIER_PRICING_SHARED_SECRET
          ? { "x-pricing-secret": process.env.ZAPIER_PRICING_SHARED_SECRET }
          : {})
      },
      body: JSON.stringify({
        request,
        requestedAt: new Date().toISOString(),
        source: "spark-pricing-agent"
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Zapier pricing webhook failed: ${response.status} ${body}`);
    }

    const payload = await response.json();
    const result = payload.result ?? payload;

    if (!isPricingResult(result)) {
      throw new Error("Zapier returned an unexpected pricing response shape.");
    }

    return {
      ...result,
      provider: "zapier",
      calculatedAt: result.calculatedAt ?? new Date().toISOString(),
      modelVersion: result.modelVersion ?? process.env.PRICING_MODEL_VERSION ?? "zapier"
    };
  }
};
