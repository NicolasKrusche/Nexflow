"""Slack native connector."""
from __future__ import annotations

from typing import Any

import httpx

from .base import IConnector, ConnectorError
from .rate_limit import request_with_rate_limit

_BASE = "https://slack.com/api"


class SlackConnector(IConnector):
    provider = "slack"
    supported_operations = [
        "send_message",
        "read_channel",
        "list_channels",
        "create_channel",
    ]

    async def execute(
        self,
        operation: str,
        params: dict[str, Any],
        access_token: str,
    ) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json; charset=utf-8",
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            match operation:
                case "send_message":
                    return await self._send_message(client, headers, params)
                case "read_channel":
                    return await self._read_channel(client, headers, params)
                case "list_channels":
                    return await self._list_channels(client, headers, params)
                case "create_channel":
                    return await self._create_channel(client, headers, params)
                case _:
                    raise ConnectorError(
                        "UNSUPPORTED_OPERATION",
                        f"Slack does not support operation '{operation}'",
                    )

    async def _send_message(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        channel = params.get("channel")
        text = params.get("text", "")
        if not channel:
            raise ConnectorError("MISSING_PARAM", "send_message requires 'channel'")
        body: dict[str, Any] = {"channel": channel, "text": text}
        if params.get("blocks"):
            body["blocks"] = params["blocks"]
        r = await request_with_rate_limit(
            client,
            "POST",
            f"{_BASE}/chat.postMessage",
            headers=headers,
            json=body,
        )
        data = _raise_for_status(r, "send_message")
        return {
            "ts": data.get("ts"),
            "channel": data.get("channel"),
            "message": data.get("message", {}),
        }

    async def _read_channel(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        channel = params.get("channel")
        if not channel:
            raise ConnectorError("MISSING_PARAM", "read_channel requires 'channel'")
        limit = int(params.get("limit", 20))
        r = await request_with_rate_limit(
            client,
            "GET",
            f"{_BASE}/conversations.history",
            headers=headers,
            params={"channel": channel, "limit": limit},
        )
        data = _raise_for_status(r, "read_channel")
        return {"messages": data.get("messages", []), "has_more": data.get("has_more", False)}

    async def _list_channels(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        limit = int(params.get("limit", 100))
        r = await request_with_rate_limit(
            client,
            "GET",
            f"{_BASE}/conversations.list",
            headers=headers,
            params={"limit": limit, "exclude_archived": True},
        )
        data = _raise_for_status(r, "list_channels")
        channels = [
            {"id": c["id"], "name": c["name"], "is_private": c.get("is_private", False)}
            for c in data.get("channels", [])
        ]
        return {"channels": channels}

    async def _create_channel(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        name = params.get("name")
        if not name:
            raise ConnectorError("MISSING_PARAM", "create_channel requires 'name'")
        r = await request_with_rate_limit(
            client,
            "POST",
            f"{_BASE}/conversations.create",
            headers=headers,
            json={"name": name, "is_private": bool(params.get("is_private", False))},
        )
        data = _raise_for_status(r, "create_channel")
        ch = data.get("channel", {})
        return {"channel_id": ch.get("id"), "name": ch.get("name")}


def _raise_for_status(r: httpx.Response, operation: str) -> dict:
    if r.status_code == 401:
        raise ConnectorError(
            "TOKEN_EXPIRED",
            f"Slack {operation} failed: OAuth access token is invalid or expired",
        )
    if r.status_code >= 400:
        raise ConnectorError(
            "SLACK_HTTP_ERROR",
            f"Slack {operation} failed ({r.status_code}): {r.text[:300]}",
        )
    data = r.json()
    if not data.get("ok"):
        raise ConnectorError(
            "SLACK_API_ERROR",
            f"Slack {operation} error: {data.get('error', 'unknown')}",
        )
    return data