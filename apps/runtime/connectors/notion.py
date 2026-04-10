"""Notion native connector."""
from __future__ import annotations

from typing import Any

import httpx

from .base import IConnector, ConnectorError
from .rate_limit import request_with_rate_limit

_BASE = "https://api.notion.com/v1"
_VERSION = "2022-06-28"


class NotionConnector(IConnector):
    provider = "notion"
    supported_operations = [
        "read_page",
        "create_page",
        "append_to_page",
        "query_database",
        "create_database_entry",
    ]

    async def execute(
        self,
        operation: str,
        params: dict[str, Any],
        access_token: str,
    ) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Notion-Version": _VERSION,
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            match operation:
                case "read_page":
                    return await self._read_page(client, headers, params)
                case "create_page":
                    return await self._create_page(client, headers, params)
                case "append_to_page":
                    return await self._append_to_page(client, headers, params)
                case "query_database":
                    return await self._query_database(client, headers, params)
                case "create_database_entry":
                    return await self._create_database_entry(client, headers, params)
                case _:
                    raise ConnectorError(
                        "UNSUPPORTED_OPERATION",
                        f"Notion does not support operation '{operation}'",
                    )

    async def _read_page(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        page_id = params.get("page_id")
        if not page_id:
            raise ConnectorError("MISSING_PARAM", "read_page requires 'page_id'")
        r = await request_with_rate_limit(client, "GET", f"{_BASE}/pages/{page_id}", headers=headers)
        _raise_for_status(r, "read_page")
        page = r.json()
        # Also fetch page blocks for content
        blocks_r = await request_with_rate_limit(
            client, "GET", f"{_BASE}/blocks/{page_id}/children", headers=headers
        )
        try:
            blocks = blocks_r.json().get("results", []) if blocks_r.status_code == 200 else []
        except Exception:
            blocks = []
        return {"page": page, "blocks": blocks}

    async def _create_page(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        parent_id = params.get("parent_id")
        title = params.get("title", "Untitled")
        if not parent_id:
            raise ConnectorError("MISSING_PARAM", "create_page requires 'parent_id'")
        body: dict[str, Any] = {
            "parent": {"type": "page_id", "page_id": parent_id},
            "properties": {
                "title": {
                    "title": [{"type": "text", "text": {"content": title}}]
                }
            },
        }
        if params.get("content"):
            body["children"] = _text_to_blocks(str(params["content"]))
        r = await request_with_rate_limit(
            client, "POST", f"{_BASE}/pages", headers=headers, json=body
        )
        _raise_for_status(r, "create_page")
        try:
            result = r.json()
        except Exception as e:
            raise ConnectorError("NOTION_PARSE_ERROR", f"create_page returned non-JSON response: {r.text[:200]}") from e
        return {"page_id": result.get("id"), "url": result.get("url")}

    async def _append_to_page(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        page_id = params.get("page_id")
        content = params.get("content", "")
        if not page_id:
            raise ConnectorError("MISSING_PARAM", "append_to_page requires 'page_id'")
        blocks = (
            params["blocks"]
            if isinstance(params.get("blocks"), list)
            else _text_to_blocks(str(content))
        )
        r = await request_with_rate_limit(
            client,
            "PATCH",
            f"{_BASE}/blocks/{page_id}/children",
            headers=headers,
            json={"children": blocks},
        )
        _raise_for_status(r, "append_to_page")
        return {"page_id": page_id, "appended_blocks": len(blocks)}

    async def _query_database(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        database_id = params.get("database_id")
        if not database_id:
            raise ConnectorError("MISSING_PARAM", "query_database requires 'database_id'")
        body: dict[str, Any] = {}
        if params.get("filter"):
            body["filter"] = params["filter"]
        if params.get("sorts"):
            body["sorts"] = params["sorts"]
        if params.get("page_size"):
            body["page_size"] = int(params["page_size"])
        r = await request_with_rate_limit(
            client,
            "POST",
            f"{_BASE}/databases/{database_id}/query",
            headers=headers,
            json=body,
        )
        _raise_for_status(r, "query_database")
        data = r.json()
        return {"results": data.get("results", []), "has_more": data.get("has_more", False)}

    async def _create_database_entry(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        database_id = params.get("database_id")
        properties = params.get("properties", {})
        if not database_id:
            raise ConnectorError("MISSING_PARAM", "create_database_entry requires 'database_id'")
        if database_id == "__USER_ASSIGNED__":
            raise ConnectorError(
                "UNSET_PARAM",
                "create_database_entry: 'database_id' has not been set. "
                "Open the program in the editor and replace __USER_ASSIGNED__ with your Notion database ID. "
                "You can find the database ID in the Notion URL: notion.so/<workspace>/<database_id>?v=...",
            )
        body = {
            "parent": {"database_id": database_id},
            "properties": properties,
        }
        r = await request_with_rate_limit(
            client, "POST", f"{_BASE}/pages", headers=headers, json=body
        )
        _raise_for_status(r, "create_database_entry")
        try:
            result = r.json()
        except Exception as e:
            raise ConnectorError("NOTION_PARSE_ERROR", f"create_database_entry returned non-JSON response: {r.text[:200]}") from e
        return {"page_id": result.get("id"), "url": result.get("url")}


def _raise_for_status(r: httpx.Response, operation: str) -> None:
    if r.status_code == 401:
        raise ConnectorError(
            "TOKEN_EXPIRED",
            f"Notion {operation} failed: OAuth access token is invalid or expired",
        )
    if r.status_code >= 400:
        raise ConnectorError(
            "NOTION_API_ERROR",
            f"Notion {operation} failed ({r.status_code}): {r.text[:300]}",
        )


def _text_to_blocks(text: str) -> list[dict]:
    """Convert a plain-text string into Notion paragraph blocks (one per line)."""
    blocks = []
    for line in text.split("\n"):
        blocks.append({
            "object": "block",
            "type": "paragraph",
            "paragraph": {
                "rich_text": [{"type": "text", "text": {"content": line}}]
            },
        })
    return blocks
