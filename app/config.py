from functools import lru_cache
from os import getenv

from pydantic import BaseModel


class Settings(BaseModel):
    pricing_provider: str = getenv("PRICING_PROVIDER", "mock")
    pricing_model_version: str = getenv("PRICING_MODEL_VERSION", "snowflake-quantreg-v1")
    zapier_mcp_server_url: str | None = getenv("ZAPIER_MCP_URL") or getenv("ZAPIER_MCP_SERVER_URL")
    zapier_mcp_key: str | None = (
        getenv("ZAPIER_MCP_TOKEN")
        or getenv("ZAPIER_MCP_KEY")
        or getenv("ZAPIER_MCP_API")
        or getenv("ZAPIER_MCP_BEARER_TOKEN")
    )
    zapier_mcp_tool_name: str = getenv("ZAPIER_MCP_TOOL_NAME", "snowflake_execute_sql")


@lru_cache
def get_settings() -> Settings:
    return Settings()
