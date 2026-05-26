import { z } from "zod";

export const pricingRequestSchema = z.object({
  repEmail: z.string().email("Enter a valid rep email."),
  accountName: z.string().min(2, "Account name is required."),
  opportunityId: z.string().min(2, "Opportunity ID is required."),
  dealType: z.enum(["new_business", "expansion", "renewal"]),
  customerSegment: z.enum(["smb", "mid_market", "enterprise"]),
  productPackage: z.enum(["starter", "growth", "enterprise", "custom"]),
  region: z.enum(["na", "emea", "apac", "latam"]),
  seats: z.coerce.number().int().min(1).max(100000),
  contractMonths: z.coerce.number().int().min(1).max(60),
  listPrice: z.coerce.number().min(1).max(100000000),
  requestedDiscount: z.coerce.number().min(0).max(95).optional().default(0),
  notes: z.string().max(1200).optional().default("")
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
