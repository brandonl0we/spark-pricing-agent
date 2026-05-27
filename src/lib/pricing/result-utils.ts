import { PricingResult } from "./schema";

function numberFrom(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return undefined;
}

function booleanFrom(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "true" || normalized === "yes" || normalized === "1") return true;
    if (normalized === "false" || normalized === "no" || normalized === "0") return false;
  }
  return undefined;
}

function stringFrom(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function arrayFrom(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return value
        .split("|")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return undefined;
}

export function isPricingResult(value: unknown): value is PricingResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<PricingResult>;
  return (
    typeof result.quoteId === "string" &&
    typeof result.recommendedDiscount === "number" &&
    typeof result.maxDiscount === "number" &&
    typeof result.floorPrice === "number" &&
    typeof result.recommendedPrice === "number" &&
    typeof result.approvalRequired === "boolean" &&
    typeof result.approvalLevel === "string" &&
    Array.isArray(result.reasonCodes)
  );
}

export function normalizePricingResult(value: unknown): PricingResult | null {
  if (isPricingResult(value)) return value;
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const nested = normalizePricingResult(record.result ?? record.CALCULATE_PRICING_GUIDANCE);
  if (nested) return nested;

  const quoteId = stringFrom(record.quoteId ?? record["Quote Id"] ?? record.quote_id);
  const recommendedDiscount = numberFrom(
    record.recommendedDiscount ?? record["Recommended Discount"] ?? record.recommended_discount
  );
  const maxDiscount = numberFrom(record.maxDiscount ?? record["Max Discount"] ?? record.max_discount);
  const floorPrice = numberFrom(record.floorPrice ?? record["Floor Price"] ?? record.floor_price);
  const recommendedPrice = numberFrom(
    record.recommendedPrice ?? record["Recommended Price"] ?? record.recommended_price
  );
  const approvalRequired = booleanFrom(
    record.approvalRequired ?? record["Approval Required"] ?? record.approval_required
  );
  const approvalLevel = stringFrom(record.approvalLevel ?? record["Approval Level"] ?? record.approval_level);
  const reasonCodes = arrayFrom(record.reasonCodes ?? record["Reason Codes"] ?? record.reason_codes);

  if (
    !quoteId ||
    typeof recommendedDiscount !== "number" ||
    typeof maxDiscount !== "number" ||
    typeof floorPrice !== "number" ||
    typeof recommendedPrice !== "number" ||
    typeof approvalRequired !== "boolean" ||
    !approvalLevel ||
    !reasonCodes
  ) {
    return null;
  }

  return {
    approvalLevel: approvalLevel as PricingResult["approvalLevel"],
    approvalRequired,
    calculatedAt: stringFrom(record.calculatedAt ?? record["Calculated At"] ?? record.calculated_at) ?? new Date().toISOString(),
    floorPrice,
    maxDiscount,
    modelVersion: stringFrom(record.modelVersion ?? record["Model Version"] ?? record.model_version) ?? "pricing-guidance",
    provider: "zapier",
    quoteId,
    reasonCodes,
    recommendedDiscount,
    recommendedPrice
  };
}
