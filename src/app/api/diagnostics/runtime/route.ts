import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    node: process.version,
    provider: process.env.PRICING_PROVIDER ?? "mock",
    hasMcpUrl: Boolean(process.env.ZAPIER_MCP_URL ?? process.env.ZAPIER_MCP_SERVER_URL),
    hasMcpKey: Boolean(
      process.env.ZAPIER_MCP_TOKEN ??
        process.env.ZAPIER_MCP_KEY ??
        process.env.ZAPIER_MCP_API ??
        process.env.ZAPIER_MCP_BEARER_TOKEN
    )
  });
}
