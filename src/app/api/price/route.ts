import { NextResponse } from "next/server";
import { createPendingPricingRequest, failPricingRequest } from "@/lib/pricing/async-store";
import { getPricingProvider } from "@/lib/pricing/provider";
import { pricingRequestSchema } from "@/lib/pricing/schema";

function getOrigin(request: Request) {
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  return forwardedHost ? `${forwardedProto}://${forwardedHost}` : new URL(request.url).origin;
}

function compactPayload(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== "" && fieldValue !== null && fieldValue !== undefined)
  );
}

async function queueZapierPricingRequest(request: Request, payload: Record<string, unknown>) {
  const webhookUrl = process.env.ZAPIER_PRICING_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({ error: "ZAPIER_PRICING_WEBHOOK_URL is not configured." }, { status: 502 });
  }

  const requestId = createPendingPricingRequest();
  const callbackUrl = `${getOrigin(request)}/api/price/callback`;
  const zapierPayload = compactPayload({
    ...payload,
    callbackUrl,
    requestId,
    requestedAt: new Date().toISOString(),
    source: "spark-pricing-agent"
  });

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.ZAPIER_PRICING_SHARED_SECRET
          ? { "x-pricing-secret": process.env.ZAPIER_PRICING_SHARED_SECRET }
          : {})
      },
      body: JSON.stringify(zapierPayload)
    });

    if (!response.ok) {
      const body = await response.text();
      failPricingRequest(requestId, `Zapier pricing webhook failed: ${response.status} ${body}`);
      return NextResponse.json({ error: `Zapier pricing webhook failed: ${response.status} ${body}` }, { status: 502 });
    }

    return NextResponse.json({
      callbackUrl,
      requestId,
      status: "pending"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Zapier pricing webhook failed.";
    failPricingRequest(requestId, message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

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

  if (process.env.PRICING_PROVIDER === "zapier-async") {
    return queueZapierPricingRequest(request, parsed.data);
  }

  try {
    const result = await getPricingProvider().calculate(parsed.data);
    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown pricing error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
