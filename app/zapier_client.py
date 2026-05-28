import json
from typing import Any

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client


class ZapierMCPError(Exception):
    pass


async def call_zapier_tool(
    *,
    server_url: str,
    token: str,
    tool_name: str,
    arguments: dict[str, Any],
) -> tuple[Any, dict[str, Any]]:
    headers = {"Authorization": f"Bearer {token}"}

    try:
        async with streamablehttp_client(server_url, headers=headers) as (
            read_stream,
            write_stream,
            _,
        ):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                result = await session.call_tool(tool_name, arguments=arguments)
    except BaseException as exc:
        raise ZapierMCPError(f"MCP call failed: {_format_exception_chain(exc)}") from exc

    if getattr(result, "isError", False):
        raise ZapierMCPError(f"tool returned error: {result.content!r}")

    debug = {
        "block_count": len(result.content) if result.content else 0,
        "block_types": [getattr(block, "type", "?") for block in (result.content or [])],
        "raw_text_preview": _preview_raw_text(result.content),
    }
    return _parse_tool_content(result.content), debug


async def list_zapier_tools(*, server_url: str, token: str) -> list[str]:
    headers = {"Authorization": f"Bearer {token}"}

    try:
        async with streamablehttp_client(server_url, headers=headers) as (
            read_stream,
            write_stream,
            _,
        ):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                tools = await session.list_tools()
    except BaseException as exc:
        raise ZapierMCPError(f"MCP tools/list failed: {_format_exception_chain(exc)}") from exc

    return [tool.name for tool in tools.tools]


def _preview_raw_text(content: Any) -> str:
    if not content:
        return ""

    parts: list[str] = []
    for block in content:
        text = getattr(block, "text", None)
        if isinstance(text, str):
            parts.append(text)

    joined = "\n---\n".join(parts)
    if len(joined) > 800:
        return joined[:800] + f"... [truncated, total {len(joined)} chars]"
    return joined


def _format_exception_chain(exc: BaseException, depth: int = 0) -> str:
    if depth > 4:
        return f"{type(exc).__name__}: <max-depth>"

    inner: list[BaseException] | None = getattr(exc, "exceptions", None)
    if inner:
        children = "; ".join(_format_exception_chain(child, depth + 1) for child in inner)
        return f"{type(exc).__name__}[{children}]"

    cause = getattr(exc, "__cause__", None)
    if cause is not None and cause is not exc:
        return f"{type(exc).__name__}({exc}) <- {_format_exception_chain(cause, depth + 1)}"

    return f"{type(exc).__name__}: {exc}"


def _parse_tool_content(content: Any) -> Any:
    if not content:
        return None

    text_blocks: list[str] = []
    for block in content:
        block_type = getattr(block, "type", None)
        text = getattr(block, "text", None)
        if block_type == "text" and isinstance(text, str):
            text_blocks.append(text)

    for raw in text_blocks:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            continue

    return text_blocks[0] if text_blocks else None
