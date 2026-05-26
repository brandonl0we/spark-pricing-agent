import {
  normalizeCurrency,
  PricingProvider,
  PricingRequest,
  PricingResult
} from "./schema";

const segmentBaseDiscount = {
  smb: 8,
  mid_market: 12,
  enterprise: 16
};

const dealTypeAdjustment = {
  new_business: 0,
  expansion: 3,
  renewal: 2
};

function approvalLevelFor(requestedDiscount: number, maxDiscount: number): PricingResult["approvalLevel"] {
  if (requestedDiscount <= maxDiscount) return "None";
  if (requestedDiscount <= maxDiscount + 5) return "Manager";
  if (requestedDiscount <= maxDiscount + 12) return "Director";
  return "VP";
}

export const mockPricingProvider: PricingProvider = {
  async calculate(request: PricingRequest): Promise<PricingResult> {
    const termBoost = request.contractMonths >= 36 ? 4 : request.contractMonths >= 24 ? 2 : 0;
    const seatBoost = request.seats >= 1000 ? 4 : request.seats >= 250 ? 2 : 0;
    const enterprisePackageBoost = request.productPackage === "enterprise" ? 2 : 0;
    const base =
      segmentBaseDiscount[request.customerSegment] +
      dealTypeAdjustment[request.dealType] +
      termBoost +
      seatBoost +
      enterprisePackageBoost;

    const maxDiscount = Math.min(35, base + 4);
    const recommendedDiscount = Math.min(maxDiscount, Math.max(5, base));
    const recommendedPrice = normalizeCurrency(request.listPrice * (1 - recommendedDiscount / 100));
    const floorPrice = normalizeCurrency(request.listPrice * (1 - maxDiscount / 100));
    const approvalLevel = approvalLevelFor(request.requestedDiscount ?? 0, maxDiscount);

    return {
      quoteId: `Q-${Date.now().toString(36).toUpperCase()}`,
      recommendedDiscount,
      maxDiscount,
      floorPrice,
      recommendedPrice,
      approvalRequired: approvalLevel !== "None",
      approvalLevel,
      reasonCodes: [
        `Segment: ${request.customerSegment.replace("_", " ")}`,
        `Deal type: ${request.dealType.replace("_", " ")}`,
        `Term: ${request.contractMonths} months`,
        `Seats: ${request.seats.toLocaleString()}`
      ],
      modelVersion: process.env.PRICING_MODEL_VERSION ?? "mock-2026-05",
      provider: "mock",
      calculatedAt: new Date().toISOString()
    };
  }
};
