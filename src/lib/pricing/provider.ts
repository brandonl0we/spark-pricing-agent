import { mockPricingProvider } from "./mock-provider";
import { PricingProvider } from "./schema";
import { zapierPricingProvider } from "./zapier-provider";

export function getPricingProvider(): PricingProvider {
  const provider = process.env.PRICING_PROVIDER ?? "mock";

  if (provider === "zapier") return zapierPricingProvider;
  if (provider === "mock") return mockPricingProvider;

  throw new Error(`Unsupported PRICING_PROVIDER: ${provider}`);
}
