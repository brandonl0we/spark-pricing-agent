import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CONNECT_TIMEOUT_MS = 8_000;

function getZapierMcpUrl() {
  return process.env.ZAPIER_MCP_URL ?? process.env.ZAPIER_MCP_SERVER_URL;
}

function getZapierMcpBearerToken() {
  return (
    process.env.ZAPIER_MCP_TOKEN ??
    process.env.ZAPIER_MCP_KEY ??
    process.env.ZAPIER_MCP_API ??
    process.env.ZAPIER_MCP_BEARER_TOKEN
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timeout: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s.`)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

export async function GET() {
  const startedAt = Date.now();
  const serverUrl = getZapierMcpUrl();
  const token = getZapierMcpBearerToken();

  if (!serverUrl) {
    return NextResponse.json({ ok: false, error: "ZAPIER_MCP_URL or ZAPIER_MCP_SERVER_URL is not configured." }, { status: 500 });
  }

  if (!token) {
    return NextResponse.json({ ok: false, error: "ZAPIER_MCP_TOKEN or ZAPIER_MCP_KEY is not configured." }, { status: 500 });
  }

  try {
    const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
      import("@modelcontextprotocol/sdk/client/index.js"),
      import("@modelcontextprotocol/sdk/client/streamableHttp.js")
    ]);

    const client = new Client({
      name: "spark-pricing-agent-diagnostics",
      version: "0.1.0"
    });

    const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });

    try {
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, "Zapier MCP connect");
      const tools = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, "Zapier MCP tools/list");

      return NextResponse.json({
        ok: true,
        provider: process.env.PRICING_PROVIDER ?? "mock",
        runtimeMs: Date.now() - startedAt,
        toolNames: tools.tools.map((tool) => tool.name)
      });
    } finally {
      await client.close().catch(() => undefined);
    }
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
