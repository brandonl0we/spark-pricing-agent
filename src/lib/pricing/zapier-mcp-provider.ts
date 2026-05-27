import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PricingProvider, PricingRequest, PricingResult } from "./schema";
import { normalizePricingResult } from "./result-utils";

type McpContentBlock = {
  type?: string;
  text?: string;
};

type ZapierRowsPayload =
  | { rows?: unknown[]; results?: unknown[] | { rows?: unknown[] }; data?: unknown[] }
  | unknown[];

const DEFAULT_MCP_TIMEOUT_MS = 25_000;
const MCP_CLOSE_TIMEOUT_MS = 1_000;

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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timeout: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s.`)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
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

function asContentBlocks(value: unknown) {
  if (!Array.isArray(value)) return undefined;

  return value.filter((block): block is McpContentBlock => {
    return Boolean(block) && typeof block === "object";
  });
}

async function callSnowflakePricingProcedure(request: PricingRequest) {
  const serverUrl = getZapierMcpUrl();
  const token = getZapierMcpBearerToken();
  const timeoutMs = getMcpTimeoutMs();

  if (!serverUrl) throw new Error("ZAPIER_MCP_URL or ZAPIER_MCP_SERVER_URL is not configured.");
  if (!token) throw new Error("ZAPIER_MCP_TOKEN or ZAPIER_MCP_KEY is not configured.");

  const client = new Client({
    name: "spark-pricing-agent",
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
    await withTimeout(client.connect(transport), timeoutMs, "Zapier MCP connect");
    return await withTimeout(
      client.callTool({
        name: process.env.ZAPIER_MCP_TOOL_NAME ?? "snowflake_execute_sql",
        arguments: {
          statement: buildSql(request),
          output_hint: "Return the stored procedure result as JSON with the pricing guidance object.",
          instructions:
            "Execute the SQL exactly as provided. Return the Snowflake procedure result without rewriting field names."
        }
      }),
      timeoutMs,
      "Zapier MCP snowflake_execute_sql"
    );
  } finally {
    await Promise.race([client.close(), wait(MCP_CLOSE_TIMEOUT_MS)]).catch(() => undefined);
  }
}

export const zapierMcpPricingProvider: PricingProvider = {
  async calculate(request: PricingRequest): Promise<PricingResult> {
    const callResult = await callSnowflakePricingProcedure(request);
    const result =
      normalizePricingResult(callResult.structuredContent) ?? extractPricingResult(asContentBlocks(callResult.content));

    return {
      ...result,
      provider: "zapier-mcp",
      calculatedAt: result.calculatedAt ?? new Date().toISOString(),
      modelVersion: result.modelVersion ?? process.env.PRICING_MODEL_VERSION ?? "zapier-mcp"
    };
  }
};
