# Spark Pricing Agent

A small Spark-ready pricing app for sales reps. The deployed runtime is Python/FastAPI so the Zapier MCP call path matches AP-Sparkle's known-working Snowflake bridge.

## Current State

- Working FastAPI app with a sales rep pricing form.
- `POST /api/price` validates requests with Pydantic.
- `PRICING_PROVIDER=mock` works locally with deterministic sample guidance.
- `PRICING_PROVIDER=zapier-mcp` calls Zapier MCP with the official Python MCP client.
- `/api/health` is wired for Spark health checks.
- `Dockerfile` forces Spark/Kaniko to deploy the Python app instead of the older Next.js prototype.

## Local Setup

```bash
pip install .
uvicorn app.main:app --host 0.0.0.0 --port 3000
```

Open `http://localhost:3000`.

## Environment Variables

| Name | Required | Description |
| --- | --- | --- |
| `PRICING_PROVIDER` | Yes | `mock` or `zapier-mcp`. Defaults to `mock` if omitted. |
| `ZAPIER_MCP_SERVER_URL` | For Zapier MCP | Private Zapier MCP server URL. This usually includes auth in the URL and should be treated like a secret. |
| `ZAPIER_MCP_URL` | For Zapier MCP | Alias used by AP-Sparkle for the Zapier MCP server URL. |
| `ZAPIER_MCP_KEY` | For Zapier MCP | Bearer token for Zapier MCP when auth is stored separately from the URL. |
| `ZAPIER_MCP_TOKEN` | For Zapier MCP | Alias used by AP-Sparkle for the Zapier MCP bearer token. |
| `ZAPIER_MCP_API` | For Zapier MCP | Bearer token for Zapier MCP when auth is stored separately from the URL. |
| `ZAPIER_MCP_BEARER_TOKEN` | Optional | Bearer token if your Zapier MCP setup gives auth separately from the URL. |
| `ZAPIER_MCP_TOOL_NAME` | Optional | Exact Zapier MCP tool name to call. Defaults to `snowflake_execute_sql`. |
| `PRICING_MODEL_VERSION` | Optional | Included in mock/API responses for audit and debugging. |

## Pricing Request Shape

`POST /api/price`

All fields are optional. Blank form fields are omitted from the request.

```json
{
  "accountId": "123456",
  "planTier": "Enterprise",
  "region": "NA",
  "productLine": "Marketing",
  "resellerId": "RSID-123",
  "contactLimit": 50000,
  "listPrice": 50000,
  "discountRate": 10,
  "smsFlag": true,
  "smsCredits": 1000,
  "whatsapp": false,
  "termLength": 12,
  "arr": 42000,
  "priceRealization": 0.84
}
```

## Normalized Pricing Result

The UI expects `/api/price` to return this object under a `result` key:

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
  "provider": "zapier-mcp",
  "calculatedAt": "2026-05-26T12:00:00.000Z"
}
```

## Zapier MCP Bridge

Use this to call the same Snowflake-authed Zapier MCP path AP-Sparkle uses.

Spark secrets:

```text
PRICING_PROVIDER=zapier-mcp
ZAPIER_MCP_SERVER_URL=<private Zapier MCP server URL>
ZAPIER_MCP_KEY=<Zapier MCP bearer token>
ZAPIER_MCP_TOOL_NAME=snowflake_execute_sql
```

The provider calls `snowflake_execute_sql` with `statement`, `output_hint`, and `instructions`.
The statement is:

```sql
CALL AC.SANDBOX.CALCULATE_PRICING_GUIDANCE(
  PARSE_JSON($${...pricing request json...}$$)
);
```

## Spark Notes

- Health check path: `/api/health`.
- Set `PRICING_PROVIDER=zapier-mcp` in Spark to use the Zapier MCP Snowflake connection.
- For the MCP bridge, set `PRICING_PROVIDER=zapier-mcp` and add the `ZAPIER_MCP_*` secrets above.
- Direct Snowflake can be added later behind the same provider interface in `app/pricing.py`.
