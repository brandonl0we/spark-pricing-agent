from functools import lru_cache
from os import getenv


def _clean_secret(value: str | None) -> str | None:
    if not value:
        return None

    cleaned = value.strip().strip('"').strip("'")
    if cleaned.lower().startswith("bearer "):
        cleaned = cleaned[7:].strip()
    return cleaned or None


def _clean_tool_name(value: str | None) -> str:
    cleaned = _clean_secret(value)
    if not cleaned or cleaned.lower() in {"sql", "statement", "query"}:
        return "snowflake_execute_sql"
    return cleaned

from pydantic import BaseModel


class Settings(BaseModel):
    pricing_provider: str = getenv("PRICING_PROVIDER", "mock")
    pricing_model_version: str = getenv("PRICING_MODEL_VERSION", "snowflake-quantreg-v1")
    zapier_mcp_server_url: str | None = _clean_secret(getenv("ZAPIER_MCP_URL") or getenv("ZAPIER_MCP_SERVER_URL"))
    zapier_mcp_key: str | None = _clean_secret(
        getenv("ZAPIER_MCP_TOKEN")
        or getenv("ZAPIER_MCP_KEY")
        or getenv("ZAPIER_MCP_API")
        or getenv("ZAPIER_MCP_BEARER_TOKEN")
    )
    zapier_mcp_tool_name: str = _clean_tool_name(getenv("ZAPIER_MCP_TOOL_NAME"))


@lru_cache
def get_settings() -> Settings:
    return Settings()
