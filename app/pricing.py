from datetime import UTC, datetime
from math import isfinite
from typing import Any

from pydantic import BaseModel

from app.config import Settings
from app.zapier_client import call_zapier_tool


class PricingRequest(BaseModel):
    accountId: str | None = None
    planTier: str | None = None
    region: str | None = None
    productLine: str | None = None
    resellerId: str | None = None
    contactLimit: float | None = None
    listPrice: float | None = None
    discountRate: float | None = None
    smsFlag: bool | None = None
    smsCredits: float | None = None
    whatsapp: bool | None = None
    termLength: float | None = None
    arr: float | None = None
    priceRealization: float | None = None


def compact_request(request: PricingRequest) -> dict[str, Any]:
    return {key: value for key, value in request.model_dump().items() if value is not None and value != ""}


def build_sql(request: PricingRequest) -> str:
    payload = compact_request(request)
    import json

    return f"CALL AC.SANDBOX.CALCULATE_PRICING_GUIDANCE(PARSE_JSON($${json.dumps(payload)}$$));"


async def calculate_pricing(settings: Settings, request: PricingRequest) -> dict[str, Any]:
    if settings.pricing_provider == "mock":
        return mock_pricing(request)

    if settings.pricing_provider != "zapier-mcp":
        raise ValueError(f"Unsupported PRICING_PROVIDER: {settings.pricing_provider}")

    if not settings.zapier_mcp_server_url:
        raise ValueError("ZAPIER_MCP_SERVER_URL is not configured.")
    if not settings.zapier_mcp_key:
        raise ValueError("ZAPIER_MCP_KEY is not configured.")

    parsed, debug = await call_zapier_tool(
        server_url=settings.zapier_mcp_server_url,
        token=settings.zapier_mcp_key,
        tool_name=settings.zapier_mcp_tool_name,
        arguments={
            "statement": build_sql(request),
            "output_hint": "Return the stored procedure result as JSON with the pricing guidance object.",
            "instructions": "Execute the SQL exactly as provided. Return the Snowflake procedure result without rewriting field names.",
        },
    )
    result = normalize_pricing_result(parsed)
    result["provider"] = "zapier-mcp"
    result.setdefault("debug", {})["zapierMcp"] = debug
    return result


def normalize_pricing_result(value: Any) -> dict[str, Any]:
    candidate = _find_pricing_result(value)
    if not candidate:
        raise ValueError(f"Zapier MCP returned an unexpected pricing response shape: {str(value)[:800]}")

    return {
        "quoteId": _string(candidate, "quoteId", "Quote Id", "quote_id"),
        "recommendedDiscount": _number(candidate, "recommendedDiscount", "Recommended Discount", "recommended_discount"),
        "maxDiscount": _number(candidate, "maxDiscount", "Max Discount", "max_discount"),
        "floorPrice": _number(candidate, "floorPrice", "Floor Price", "floor_price"),
        "recommendedPrice": _number(candidate, "recommendedPrice", "Recommended Price", "recommended_price"),
        "approvalRequired": _bool(candidate, "approvalRequired", "Approval Required", "approval_required"),
        "approvalLevel": _string(candidate, "approvalLevel", "Approval Level", "approval_level") or "None",
        "reasonCodes": _array(candidate, "reasonCodes", "Reason Codes", "reason_codes") or [],
        "modelVersion": _string(candidate, "modelVersion", "Model Version", "model_version") or "snowflake-quantreg-v1",
        "provider": _string(candidate, "provider", "Provider") or "snowflake",
        "calculatedAt": _string(candidate, "calculatedAt", "Calculated At", "calculated_at")
        or datetime.now(UTC).isoformat(),
    }


def _find_pricing_result(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        nested = value.get("result") or value.get("CALCULATE_PRICING_GUIDANCE")
        if nested is not None:
            found = _find_pricing_result(nested)
            if found:
                return found

        rows = _extract_rows(value)
        for row in rows:
            found = _find_pricing_result(row)
            if found:
                return found

        if _number(value, "recommendedDiscount", "Recommended Discount", "recommended_discount") is not None:
            return value

    if isinstance(value, list):
        for item in value:
            found = _find_pricing_result(item)
            if found:
                return found

    return None


def _extract_rows(value: dict[str, Any]) -> list[Any]:
    if isinstance(value.get("rows"), list):
        return value["rows"]
    if isinstance(value.get("data"), list):
        return value["data"]

    results = value.get("results")
    if isinstance(results, list):
        if len(results) == 1 and isinstance(results[0], dict) and isinstance(results[0].get("rows"), list):
            return results[0]["rows"]
        return results
    if isinstance(results, dict) and isinstance(results.get("rows"), list):
        return results["rows"]

    return []


def _string(record: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = record.get(key)
        if isinstance(value, str):
            return value
    return None


def _number(record: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        value = record.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)) and isfinite(float(value)):
            return round(float(value), 2)
        if isinstance(value, str) and value.strip():
            try:
                return round(float(value), 2)
            except ValueError:
                continue
    return None


def _bool(record: dict[str, Any], *keys: str) -> bool:
    for key in keys:
        value = record.get(key)
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            normalized = value.lower()
            if normalized in {"true", "yes", "1"}:
                return True
            if normalized in {"false", "no", "0"}:
                return False
    return False


def _array(record: dict[str, Any], *keys: str) -> list[str] | None:
    for key in keys:
        value = record.get(key)
        if isinstance(value, list):
            return [str(item) for item in value]
        if isinstance(value, str) and value.strip():
            return [part.strip() for part in value.split("|") if part.strip()]
    return None


def mock_pricing(request: PricingRequest) -> dict[str, Any]:
    list_price = request.listPrice or 0
    base_discount = 12
    if request.planTier and request.planTier.lower() in {"enterprise", "professional"}:
        base_discount += 3
    if request.termLength and request.termLength >= 12:
        base_discount += 1

    max_discount = base_discount + 4
    recommended_price = round(list_price * (1 - base_discount / 100), 2)
    floor_price = round(list_price * (1 - max_discount / 100), 2)

    return {
        "quoteId": f"Q-MOCK-{int(datetime.now(UTC).timestamp())}",
        "recommendedDiscount": base_discount,
        "maxDiscount": max_discount,
        "floorPrice": floor_price,
        "recommendedPrice": recommended_price,
        "approvalRequired": False,
        "approvalLevel": "None",
        "reasonCodes": [
            f"Plan tier: {request.planTier or 'not provided'}",
            f"Region: {request.region or 'not provided'}",
            f"Product line: {request.productLine or 'not provided'}",
        ],
        "modelVersion": "mock-python",
        "provider": "mock",
        "calculatedAt": datetime.now(UTC).isoformat(),
    }
