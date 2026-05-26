# Spark Pricing Agent

A small Spark-ready pricing app for sales reps. The app collects deal inputs, calls a normalized pricing provider, and returns discount guidance that can later be backed by Snowflake directly.

## Current State

- Working Next.js app with a sales rep pricing form.
- `POST /api/price` validates requests with Zod.
- `PRICING_PROVIDER=mock` works locally with deterministic sample guidance.
- `PRICING_PROVIDER=zapier` is ready for a Zapier Catch Hook.
- `/api/health` is wired for Spark health checks.
- `spark.json` is included but not deployed yet.

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

| Name | Required | Description |
| --- | --- | --- |
| `PRICING_PROVIDER` | Yes | `mock` or `zapier`. Defaults to `mock` if omitted. |
| `ZAPIER_PRICING_WEBHOOK_URL` | For Zapier | Zapier Catch Hook URL used by the backend provider. |
| `ZAPIER_PRICING_SHARED_SECRET` | Optional | Sent to Zapier as `X-Pricing-Secret`. Useful for simple webhook validation. |
| `PRICING_MODEL_VERSION` | Optional | Included in mock/API responses for audit and debugging. |

## Pricing Request Shape

`POST /api/price`

```json
{
  "repEmail": "rep@example.com",
  "accountName": "Acme Inc.",
  "opportunityId": "006abc",
  "dealType": "new_business",
  "customerSegment": "mid_market",
  "productPackage": "growth",
  "region": "na",
  "seats": 250,
  "contractMonths": 12,
  "listPrice": 50000,
  "requestedDiscount": 10,
  "notes": "Competitor pressure"
}
```

## Normalized Pricing Result

The UI expects Zapier or Snowflake to return either this object directly or under a `result` key:

```json
{
  "quoteId": "Q-123",
  "recommendedDiscount": 12,
  "maxDiscount": 18,
  "floorPrice": 41000,
  "recommendedPrice": 44000,
  "approvalRequired": false,
  "approvalLevel": "None",
  "reasonCodes": ["Segment: mid market", "Term: 12 months"],
  "modelVersion": "snowflake-2026-05",
  "provider": "zapier",
  "calculatedAt": "2026-05-26T12:00:00.000Z"
}
```

## Zapier V1 Bridge

Recommended Zapier flow:

1. Trigger: Catch Hook.
2. Optional validation: compare `X-Pricing-Secret` to the Spark secret.
3. Run the Snowflake/Python pricing step.
4. Return the normalized pricing result synchronously.

The Spark app keeps the frontend stable while this backend provider changes:

```text
UI -> /api/price -> mock now
UI -> /api/price -> Zapier soon
UI -> /api/price -> direct Snowflake later
```

## Spark Notes

- Health check path: `/api/health`.
- Set `PRICING_PROVIDER=zapier` in Spark once the webhook is ready.
- Add `ZAPIER_PRICING_WEBHOOK_URL` as a Spark secret.
- Add `ZAPIER_PRICING_SHARED_SECRET` if the Zap should validate inbound requests.
- Direct Snowflake can be added later behind the same provider interface in `src/lib/pricing/provider.ts`.
