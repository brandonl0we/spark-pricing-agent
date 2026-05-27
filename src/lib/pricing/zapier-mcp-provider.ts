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

const DEFAULT_MCP_TIMEOUT_MS = 45_000;

function getZapierMcpBearerToken() {
  return (
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

function hasCompleteSsePayload(text: string) {
  return text.includes("\n\n") && text.split("\n").some((line) => line.startsWith("data:"));
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

async function readMcpResponseBody(response: Response, timeoutMs: number) {
  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";

  const read = async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text;

      text += decoder.decode(value, { stream: true });
      if (hasCompleteSsePayload(text)) {
        await reader.cancel();
        return text;
      }
    }
  };

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reader.cancel("Zapier MCP response timed out.").catch(() => undefined);
      reject(new Error(`Zapier MCP response timed out after ${timeoutMs / 1000}s.`));
    }, timeoutMs);
  });

  return Promise.race([read(), timeout]);
}

async function postMcp<T>(method: string, params?: Record<string, unknown>, sessionId?: string) {
  const serverUrl = process.env.ZAPIER_MCP_SERVER_URL;
  const bearerToken = getZapierMcpBearerToken();
  const timeoutMs = getMcpTimeoutMs();
  if (!serverUrl) {
    throw new Error("ZAPIER_MCP_SERVER_URL is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;

  try {
    response = await fetch(serverUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "accept": "application/json, text/event-stream",
        "content-type": "application/json",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        ...(bearerToken ? { "authorization": `Bearer ${bearerToken}` } : {})
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method,
        params
      })
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Zapier MCP ${method} timed out after ${timeoutMs / 1000}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const body = await readMcpResponseBody(response, timeoutMs);
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

async function notifyMcp(method: string, sessionId?: string) {
  const serverUrl = process.env.ZAPIER_MCP_SERVER_URL;
  const bearerToken = getZapierMcpBearerToken();
  const timeoutMs = getMcpTimeoutMs();
  if (!serverUrl) {
    throw new Error("ZAPIER_MCP_SERVER_URL is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;

  try {
    response = await fetch(serverUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "accept": "application/json, text/event-stream",
        "content-type": "application/json",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        ...(bearerToken ? { "authorization": `Bearer ${bearerToken}` } : {})
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method
      })
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Zapier MCP ${method} timed out after ${timeoutMs / 1000}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Zapier MCP ${method} failed: ${response.status} ${body}`);
  }
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
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: {
        name: "spark-pricing-agent",
        version: "0.1.0"
      }
    });
    await notifyMcp("notifications/initialized", initialized.sessionId ?? undefined);

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
