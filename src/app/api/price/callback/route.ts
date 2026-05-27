import { NextResponse } from "next/server";
import { completePricingRequest, failPricingRequest } from "@/lib/pricing/async-store";
import { normalizePricingResult } from "@/lib/pricing/result-utils";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);

  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid callback payload." }, { status: 400 });
  }

  const record = payload as Record<string, unknown>;
  const requestId = typeof record.requestId === "string" ? record.requestId : undefined;

  if (!requestId) {
    return NextResponse.json({ error: "requestId is required." }, { status: 400 });
  }

  if (typeof record.error === "string" && record.error) {
    failPricingRequest(requestId, record.error);
    return NextResponse.json({ ok: true });
  }

  const result = normalizePricingResult(record.result ?? record);

  if (!result) {
    failPricingRequest(requestId, "Zapier callback did not include a recognizable pricing result.");
    return NextResponse.json({ error: "Callback did not include a recognizable pricing result." }, { status: 400 });
  }

  completePricingRequest(requestId, result);
  return NextResponse.json({ ok: true });
}
