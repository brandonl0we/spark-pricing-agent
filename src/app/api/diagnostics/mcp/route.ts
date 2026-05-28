import { NextResponse } from "next/server";
import { listZapierMcpTools } from "@/lib/pricing/zapier-mcp-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const startedAt = Date.now();

  try {
    const tools = await listZapierMcpTools();

    return NextResponse.json({
      ok: true,
      provider: process.env.PRICING_PROVIDER ?? "mock",
      runtimeMs: Date.now() - startedAt,
      toolNames: tools.map((tool) => tool.name)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Zapier MCP diagnostic error.";
    return NextResponse.json(
      {
        ok: false,
        provider: process.env.PRICING_PROVIDER ?? "mock",
        runtimeMs: Date.now() - startedAt,
        error: message
      },
      { status: 502 }
    );
  }
}
