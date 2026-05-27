import { NextResponse } from "next/server";
import { getPricingProvider } from "@/lib/pricing/provider";
import { pricingRequestSchema } from "@/lib/pricing/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = pricingRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid pricing request.",
        fields: parsed.error.flatten().fieldErrors
      },
      { status: 400 }
    );
  }

  try {
    const result = await getPricingProvider().calculate(parsed.data);
    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown pricing error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
