import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.string().optional()
);

const optionalNumber = z.preprocess((value) => {
  if (value === "" || value === null || typeof value === "undefined") return undefined;
  return Number(value);
}, z.number().finite().optional());

const optionalBoolean = z.preprocess((value) => {
  if (value === "" || value === null || typeof value === "undefined") return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "yes" || value === "1") return true;
  if (value === "false" || value === "no" || value === "0") return false;
  return value;
}, z.boolean().optional());

export const pricingRequestSchema = z.object({
  accountId: optionalString,
  planTier: optionalString,
  region: optionalString,
  productLine: optionalString,
  resellerId: optionalString,
  contactLimit: optionalNumber,
  listPrice: optionalNumber,
  discountRate: optionalNumber,
  smsFlag: optionalBoolean,
  smsCredits: optionalNumber,
  whatsapp: optionalBoolean,
  termLength: optionalNumber,
  arr: optionalNumber,
  priceRealization: optionalNumber
});

export type PricingRequest = z.infer<typeof pricingRequestSchema>;

export type PricingResult = {
  quoteId: string;
  recommendedDiscount: number;
  maxDiscount: number;
  floorPrice: number;
  recommendedPrice: number;
  approvalRequired: boolean;
  approvalLevel: "None" | "Manager" | "Director" | "VP";
  reasonCodes: string[];
  modelVersion: string;
  provider: "mock" | "zapier" | "snowflake";
  calculatedAt: string;
};

export type PricingProvider = {
  calculate(request: PricingRequest): Promise<PricingResult>;
};

export function normalizeCurrency(value: number) {
  return Math.round(value * 100) / 100;
}
