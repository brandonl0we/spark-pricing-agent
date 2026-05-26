import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "spark-pricing-agent",
    timestamp: new Date().toISOString()
  });
}
