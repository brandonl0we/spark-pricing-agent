import {
  normalizeCurrency,
  PricingProvider,
  PricingRequest,
  PricingResult
} from "./schema";

function approvalLevelFor(requestedDiscount: number, maxDiscount: number): PricingResult["approvalLevel"] {
  if (requestedDiscount <= maxDiscount) return "None";
  if (requestedDiscount <= maxDiscount + 5) return "Manager";
  if (requestedDiscount <= maxDiscount + 12) return "Director";
  return "VP";
}

export const mockPricingProvider: PricingProvider = {
  async calculate(request: PricingRequest): Promise<PricingResult> {
    const termBoost = (request.termLength ?? 0) >= 36 ? 4 : (request.termLength ?? 0) >= 24 ? 2 : 0;
    const contactBoost = (request.contactLimit ?? 0) >= 100000 ? 4 : (request.contactLimit ?? 0) >= 25000 ? 2 : 0;
    const tier = (request.planTier ?? "").toLowerCase();
    const tierBoost = tier.includes("enterprise") || tier.includes("pro") ? 4 : tier.includes("plus") ? 2 : 0;
    const base = 8 + termBoost + contactBoost + tierBoost;

    const maxDiscount = Math.min(35, base + 4);
    const recommendedDiscount = Math.min(maxDiscount, Math.max(5, base));
    const listPrice = request.listPrice ?? request.arr ?? 0;
    const recommendedPrice = normalizeCurrency(listPrice * (1 - recommendedDiscount / 100));
    const floorPrice = normalizeCurrency(listPrice * (1 - maxDiscount / 100));
    const approvalLevel = approvalLevelFor(request.discountRate ?? 0, maxDiscount);

    return {
      quoteId: `Q-${Date.now().toString(36).toUpperCase()}`,
      recommendedDiscount,
      maxDiscount,
      floorPrice,
      recommendedPrice,
      approvalRequired: approvalLevel !== "None",
      approvalLevel,
      reasonCodes: [
        `Plan tier: ${request.planTier ?? "not provided"}`,
        `Region: ${request.region ?? "not provided"}`,
        `Product line: ${request.productLine ?? "not provided"}`,
        `Term: ${request.termLength ?? "not provided"}`
      ],
      modelVersion: process.env.PRICING_MODEL_VERSION ?? "mock-2026-05",
      provider: "mock",
      calculatedAt: new Date().toISOString()
    };
  }
};
