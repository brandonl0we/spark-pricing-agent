import { PricingProvider } from "./schema";

export async function getPricingProvider(): Promise<PricingProvider> {
  const provider = process.env.PRICING_PROVIDER ?? "mock";

  if (provider === "zapier") {
    const { zapierPricingProvider } = await import("./zapier-provider");
    return zapierPricingProvider;
  }

  if (provider === "zapier-mcp") {
    const { zapierMcpPricingProvider } = await import("./zapier-mcp-provider");
    return zapierMcpPricingProvider;
  }

  if (provider === "mock") {
    const { mockPricingProvider } = await import("./mock-provider");
    return mockPricingProvider;
  }

  throw new Error(`Unsupported PRICING_PROVIDER: ${provider}`);
}
