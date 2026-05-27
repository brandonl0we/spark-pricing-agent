import { NextResponse } from "next/server";
import { getPricingRequestStatus } from "@/lib/pricing/async-store";

export async function GET(request: Request) {
  const requestId = new URL(request.url).searchParams.get("requestId");

  if (!requestId) {
    return NextResponse.json({ error: "requestId is required." }, { status: 400 });
  }

  const record = getPricingRequestStatus(requestId);

  if (!record) {
    return NextResponse.json({ error: "Pricing request was not found or expired." }, { status: 404 });
  }

  return NextResponse.json(record);
}
