import { PricingProvider, PricingRequest, PricingResult } from "./schema";
import { normalizePricingResult } from "./result-utils";

type JsonRpcResponse<T = unknown> = {
  id?: string | number | null;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type McpContentBlock = {
  type?: string;
  text?: string;
};

type McpCallResult = {
  content?: McpContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
};

type McpListToolsResult = {
  tools?: Array<{ name: string }>;
};

type ZapierRowsPayload =
  | { rows?: unknown[]; results?: unknown[] | { rows?: unknown[] }; data?: unknown[] }
  | unknown[];

const DEFAULT_MCP_TIMEOUT_MS = 25_000;
const MCP_PROTOCOL_VERSION = "2025-11-25";

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

function getMcpTimeoutMs() {
  return Number(process.env.ZAPIER_MCP_TIMEOUT_MS ?? DEFAULT_MCP_TIMEOUT_MS);
}

function compactRequest(request: PricingRequest) {
  return Object.fromEntries(
    Object.entries(request).filter(([, value]) => value !== "" && value !== null && value !== undefined)
  );
}

function buildSql(request: PricingRequest) {
  return `CALL AC.SANDBOX.CALCULATE_PRICING_GUIDANCE(PARSE_JSON($$${JSON.stringify(compactRequest(request))}$$));`;
}

function parseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseJsonOrSse(text: string): JsonRpcResponse {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Zapier MCP returned an empty response.");

  if (!trimmed.startsWith("event:") && !trimmed.startsWith("data:")) {
    return JSON.parse(trimmed);
  }

  const payloads = trimmed
    .split(/\n\n+/)
    .flatMap((event) =>
      event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .filter(Boolean)
    );

  if (!payloads.length) throw new Error(`Zapier MCP returned an unparseable event stream: ${trimmed.slice(0, 500)}`);

  return JSON.parse(payloads[payloads.length - 1]);
}

async function postJsonRpc<T>(
  method: string,
  params: Record<string, unknown> | undefined,
  sessionId: string | undefined,
  protocolVersion: string | undefined,
  timeoutMs: number
) {
  const serverUrl = getZapierMcpUrl();
  const token = getZapierMcpBearerToken();
  if (!serverUrl) throw new Error("ZAPIER_MCP_URL or ZAPIER_MCP_SERVER_URL is not configured.");
  if (!token) throw new Error("ZAPIER_MCP_TOKEN or ZAPIER_MCP_KEY is not configured.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(serverUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        ...(protocolVersion ? { "mcp-protocol-version": protocolVersion } : {})
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method,
        params
      })
    });

    const text = await response.text();
    if (!response.ok) throw new Error(`Zapier MCP ${method} failed: HTTP ${response.status} ${text.slice(0, 1000)}`);

    const payload = parseJsonOrSse(text) as JsonRpcResponse<T>;
    if (payload.error) throw new Error(`Zapier MCP ${method} failed: ${payload.error.message}`);

    return {
      protocolVersion,
      result: payload.result as T,
      sessionId: response.headers.get("mcp-session-id") ?? sessionId
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Zapier MCP ${method} timed out after ${timeoutMs / 1000}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function postJsonRpcNotification(
  method: string,
  sessionId: string | undefined,
  protocolVersion: string | undefined,
  timeoutMs: number
) {
  const serverUrl = getZapierMcpUrl();
  const token = getZapierMcpBearerToken();
  if (!serverUrl) throw new Error("ZAPIER_MCP_URL or ZAPIER_MCP_SERVER_URL is not configured.");
  if (!token) throw new Error("ZAPIER_MCP_TOKEN or ZAPIER_MCP_KEY is not configured.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(serverUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        ...(protocolVersion ? { "mcp-protocol-version": protocolVersion } : {})
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Zapier MCP ${method} failed: HTTP ${response.status} ${text.slice(0, 1000)}`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Zapier MCP ${method} timed out after ${timeoutMs / 1000}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractRows(payload: ZapierRowsPayload): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.data)) return payload.data;

  const results = payload.results;
  if (Array.isArray(results)) {
    if (
      results.length === 1 &&
      results[0] &&
      typeof results[0] === "object" &&
      Array.isArray((results[0] as { rows?: unknown[] }).rows)
    ) {
      return (results[0] as { rows: unknown[] }).rows;
    }
    return results;
  }

  if (results && typeof results === "object" && Array.isArray(results.rows)) return results.rows;

  return [];
}

function extractPricingResultFromText(text: string) {
  const parsed = parseJson(text);
  const direct = normalizePricingResult(parsed);
  if (direct) return direct;

  const rows = extractRows(parsed);
  for (const row of rows) {
    const result = normalizePricingResult(row);
    if (result) return result;
  }

  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const embedded = normalizePricingResult(parseJson(objectMatch[0]));
    if (embedded) return embedded;
  }

  return null;
}

function extractPricingResult(content: McpContentBlock[] | undefined) {
  const previews: string[] = [];

  for (const block of content ?? []) {
    if (block.type !== "text" || typeof block.text !== "string") continue;
    previews.push(block.text.slice(0, 500));

    const result = extractPricingResultFromText(block.text);
    if (result) return result;
  }

  throw new Error(
    `Zapier MCP returned an unexpected pricing response shape. Preview: ${
      previews.join(" --- ") || "no text content"
    }`
  );
}

async function callSnowflakePricingProcedure(request: PricingRequest) {
  const timeoutMs = getMcpTimeoutMs();
  const session = await initializeMcpSession(timeoutMs);

  const called = await postJsonRpc<McpCallResult>(
    "tools/call",
    {
      name: process.env.ZAPIER_MCP_TOOL_NAME ?? "snowflake_execute_sql",
      arguments: {
        statement: buildSql(request),
        output_hint: "Return the stored procedure result as JSON with the pricing guidance object.",
        instructions:
          "Execute the SQL exactly as provided. Return the Snowflake procedure result without rewriting field names."
      }
    },
    session.sessionId,
    session.protocolVersion,
    timeoutMs
  );

  if (called.result.isError) {
    throw new Error(`Zapier MCP tool returned an error: ${JSON.stringify(called.result.content ?? [])}`);
  }

  return called.result;
}

async function initializeMcpSession(timeoutMs: number) {
  const initialized = await postJsonRpc<{ protocolVersion?: string }>(
    "initialize",
    {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "spark-pricing-agent",
        version: "0.1.0"
      }
    },
    undefined,
    undefined,
    timeoutMs
  );

  const protocolVersion = initialized.result.protocolVersion ?? MCP_PROTOCOL_VERSION;
  await postJsonRpcNotification(
    "notifications/initialized",
    initialized.sessionId,
    protocolVersion,
    Math.min(timeoutMs, 5_000)
  );

  return {
    protocolVersion,
    sessionId: initialized.sessionId
  };
}

export async function listZapierMcpTools() {
  const timeoutMs = Math.min(getMcpTimeoutMs(), 8_000);
  const session = await initializeMcpSession(timeoutMs);
  const listed = await postJsonRpc<McpListToolsResult>(
    "tools/list",
    undefined,
    session.sessionId,
    session.protocolVersion,
    timeoutMs
  );

  return listed.result.tools ?? [];
}

export const zapierMcpPricingProvider: PricingProvider = {
  async calculate(request: PricingRequest): Promise<PricingResult> {
    const callResult = await callSnowflakePricingProcedure(request);
    const result = normalizePricingResult(callResult.structuredContent) ?? extractPricingResult(callResult.content);

    return {
      ...result,
      provider: "zapier-mcp",
      calculatedAt: result.calculatedAt ?? new Date().toISOString(),
      modelVersion: result.modelVersion ?? process.env.PRICING_MODEL_VERSION ?? "zapier-mcp"
    };
  }
};
