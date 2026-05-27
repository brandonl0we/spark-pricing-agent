import { PricingProvider, PricingRequest, PricingResult } from "./schema";

type JsonRpcResponse<T = unknown> = {
  id?: string | number | null;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type McpContentBlock = {
  type?: string;
  text?: string;
};

type McpCallResult = {
  content?: McpContentBlock[];
  structuredContent?: unknown;
};

function compactRequest(request: PricingRequest) {
  return Object.fromEntries(
    Object.entries(request).filter(([, value]) => value !== "" && value !== null && value !== undefined)
  );
}

function buildSql(request: PricingRequest) {
  return `CALL AC.SANDBOX.CALCULATE_PRICING_GUIDANCE(PARSE_JSON($$${JSON.stringify(compactRequest(request))}$$));`;
}

function parseMcpBody(text: string): JsonRpcResponse {
  const trimmed = text.trim();
  if (!trimmed.startsWith("event:") && !trimmed.startsWith("data:")) {
    return JSON.parse(trimmed);
  }

  const dataLines = trimmed
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter(Boolean);

  if (!dataLines.length) {
    throw new Error("Zapier MCP returned an empty event stream.");
  }

  return JSON.parse(dataLines[dataLines.length - 1]);
}

async function postMcp<T>(method: string, params?: Record<string, unknown>, sessionId?: string) {
  const serverUrl = process.env.ZAPIER_MCP_SERVER_URL;
  if (!serverUrl) {
    throw new Error("ZAPIER_MCP_SERVER_URL is not configured.");
  }

  const response = await fetch(serverUrl, {
    method: "POST",
    headers: {
      "accept": "application/json, text/event-stream",
      "content-type": "application/json",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      ...(process.env.ZAPIER_MCP_BEARER_TOKEN
        ? { "authorization": `Bearer ${process.env.ZAPIER_MCP_BEARER_TOKEN}` }
        : {})
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
      params
    })
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Zapier MCP ${method} failed: ${response.status} ${body}`);
  }

  const payload = parseMcpBody(body) as JsonRpcResponse<T>;
  if (payload.error) {
    throw new Error(`Zapier MCP ${method} failed: ${payload.error.message}`);
  }

  return {
    result: payload.result as T,
    sessionId: response.headers.get("mcp-session-id") ?? sessionId
  };
}

function chooseTool(tools: McpTool[]) {
  const configured = process.env.ZAPIER_MCP_TOOL_NAME;
  if (configured) {
    const tool = tools.find((candidate) => candidate.name === configured);
    if (!tool) {
      throw new Error(
        `ZAPIER_MCP_TOOL_NAME "${configured}" was not found. Available tools: ${tools
          .map((tool) => tool.name)
          .join(", ")}`
      );
    }
    return tool;
  }

  const tool = tools.find((candidate) => {
    const haystack = `${candidate.name} ${candidate.description ?? ""}`.toLowerCase();
    return haystack.includes("snowflake") && /(sql|query|statement|execute|run)/.test(haystack);
  });

  if (!tool) {
    throw new Error(
      `Could not infer a Snowflake SQL Zapier MCP tool. Set ZAPIER_MCP_TOOL_NAME. Available tools: ${tools
        .map((candidate) => candidate.name)
        .join(", ")}`
    );
  }

  return tool;
}

function buildToolArguments(sql: string) {
  const field = process.env.ZAPIER_MCP_SQL_FIELD ?? "sql";
  return { [field]: sql };
}

function tryJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function findPricingResult(value: unknown): PricingResult | undefined {
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  if (
    typeof record.quoteId === "string" &&
    typeof record.recommendedDiscount === "number" &&
    typeof record.maxDiscount === "number" &&
    typeof record.floorPrice === "number" &&
    typeof record.recommendedPrice === "number" &&
    typeof record.approvalRequired === "boolean" &&
    typeof record.approvalLevel === "string" &&
    Array.isArray(record.reasonCodes)
  ) {
    return record as PricingResult;
  }

  for (const child of Object.values(record)) {
    const result = findPricingResult(child);
    if (result) return result;
  }

  return undefined;
}

function extractPricingResult(callResult: McpCallResult) {
  const structured = findPricingResult(callResult.structuredContent);
  if (structured) return structured;

  for (const block of callResult.content ?? []) {
    if (block.type !== "text" || !block.text) continue;

    const parsed = tryJson(block.text);
    const parsedResult = findPricingResult(parsed);
    if (parsedResult) return parsedResult;

    const match = block.text.match(/\{[\s\S]*\}/);
    if (match) {
      const embeddedResult = findPricingResult(tryJson(match[0]));
      if (embeddedResult) return embeddedResult;
    }
  }

  throw new Error("Zapier MCP returned an unexpected pricing response shape.");
}

export const zapierMcpPricingProvider: PricingProvider = {
  async calculate(request: PricingRequest): Promise<PricingResult> {
    const initialized = await postMcp<{ protocolVersion: string }>("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "spark-pricing-agent",
        version: "0.1.0"
      }
    });

    const listed = await postMcp<{ tools: McpTool[] }>("tools/list", undefined, initialized.sessionId ?? undefined);
    const tool = chooseTool(listed.result.tools ?? []);

    const called = await postMcp<McpCallResult>(
      "tools/call",
      {
        name: tool.name,
        arguments: buildToolArguments(buildSql(request))
      },
      listed.sessionId ?? initialized.sessionId ?? undefined
    );

    const result = extractPricingResult(called.result);

    return {
      ...result,
      provider: "zapier-mcp",
      calculatedAt: result.calculatedAt ?? new Date().toISOString(),
      modelVersion: result.modelVersion ?? process.env.PRICING_MODEL_VERSION ?? "zapier-mcp"
    };
  }
};
