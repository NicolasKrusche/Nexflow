"""Outlook (Microsoft Graph) native connector."""
from __future__ import annotations

from typing import Any

import httpx

from .base import IConnector, ConnectorError
from .rate_limit import request_with_rate_limit

_BASE = "https://graph.microsoft.com/v1.0/me"


class OutlookConnector(IConnector):
    provider = "outlook"
    supported_operations = [
        "list_emails",
        "read_email",
        "send_email",
        "reply_email",
        "delete_email",
        "list_folders",
        "move_email",
    ]

    async def execute(
        self,
        operation: str,
        params: dict[str, Any],
        access_token: str,
    ) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            match operation:
                case "list_emails":
                    return await self._list_emails(client, headers, params)
                case "read_email":
                    return await self._read_email(client, headers, params)
                case "send_email":
                    return await self._send_email(client, headers, params)
                case "reply_email":
                    return await self._reply_email(client, headers, params)
                case "delete_email":
                    return await self._delete_email(client, headers, params)
                case "list_folders":
                    return await self._list_folders(client, headers, params)
                case "move_email":
                    return await self._move_email(client, headers, params)
                case _:
                    raise ConnectorError(
                        "UNSUPPORTED_OPERATION",
                        f"Outlook does not support operation '{operation}'",
                    )

    async def _list_emails(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        folder = params.get("folder", "inbox")
        limit = int(params.get("max_results", 20))
        select = "id,subject,from,toRecipients,receivedDateTime,isRead,bodyPreview"
        query: dict[str, Any] = {
            "$top": limit,
            "$select": select,
            "$orderby": "receivedDateTime desc",
        }
        if params.get("filter"):
            query["$filter"] = params["filter"]
        r = await request_with_rate_limit(
            client, "GET", f"{_BASE}/mailFolders/{folder}/messages",
            headers=headers, params=query,
        )
        _raise_for_status(r, "list_emails")
        data = r.json()
        emails = [
            {
                "id": m.get("id"),
                "subject": m.get("subject"),
                "from": m.get("from", {}).get("emailAddress", {}),
                "received_at": m.get("receivedDateTime"),
                "is_read": m.get("isRead"),
                "preview": m.get("bodyPreview"),
            }
            for m in data.get("value", [])
        ]
        return {"emails": emails}

    async def _read_email(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        message_id = params.get("message_id")
        if not message_id:
            raise ConnectorError("MISSING_PARAM", "read_email requires 'message_id'")
        r = await request_with_rate_limit(
            client, "GET", f"{_BASE}/messages/{message_id}",
            headers=headers,
            params={"$select": "id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,isRead"},
        )
        _raise_for_status(r, "read_email")
        m = r.json()
        return {
            "id": m.get("id"),
            "subject": m.get("subject"),
            "from": m.get("from", {}).get("emailAddress", {}),
            "to": [r["emailAddress"] for r in m.get("toRecipients", [])],
            "cc": [r["emailAddress"] for r in m.get("ccRecipients", [])],
            "received_at": m.get("receivedDateTime"),
            "body": m.get("body", {}).get("content", ""),
            "body_type": m.get("body", {}).get("contentType", "text"),
            "is_read": m.get("isRead"),
        }

    async def _send_email(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        to = params.get("to")
        subject = params.get("subject")
        body = params.get("body", "")
        if not to or not subject:
            raise ConnectorError("MISSING_PARAM", "send_email requires 'to' and 'subject'")
        to_recipients = [{"emailAddress": {"address": addr}} for addr in (to if isinstance(to, list) else [to])]
        message: dict[str, Any] = {
            "subject": subject,
            "body": {"contentType": params.get("body_type", "Text"), "content": body},
            "toRecipients": to_recipients,
        }
        if params.get("cc"):
            cc = params["cc"]
            message["ccRecipients"] = [{"emailAddress": {"address": a}} for a in (cc if isinstance(cc, list) else [cc])]
        r = await request_with_rate_limit(
            client, "POST", f"{_BASE}/sendMail",
            headers=headers, json={"message": message, "saveToSentItems": True},
        )
        if r.status_code not in (200, 202):
            _raise_for_status(r, "send_email")
        return {"sent": True, "subject": subject}

    async def _reply_email(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        message_id = params.get("message_id")
        body = params.get("body", "")
        if not message_id:
            raise ConnectorError("MISSING_PARAM", "reply_email requires 'message_id'")
        r = await request_with_rate_limit(
            client, "POST", f"{_BASE}/messages/{message_id}/reply",
            headers=headers,
            json={"message": {"body": {"contentType": "Text", "content": body}}},
        )
        if r.status_code not in (200, 202):
            _raise_for_status(r, "reply_email")
        return {"replied": True, "message_id": message_id}

    async def _delete_email(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        message_id = params.get("message_id")
        if not message_id:
            raise ConnectorError("MISSING_PARAM", "delete_email requires 'message_id'")
        r = await request_with_rate_limit(
            client, "DELETE", f"{_BASE}/messages/{message_id}", headers=headers
        )
        if r.status_code not in (200, 204):
            _raise_for_status(r, "delete_email")
        return {"message_id": message_id, "deleted": True}

    async def _list_folders(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        r = await request_with_rate_limit(
            client, "GET", f"{_BASE}/mailFolders",
            headers=headers,
            params={"$select": "id,displayName,totalItemCount,unreadItemCount"},
        )
        _raise_for_status(r, "list_folders")
        data = r.json()
        folders = [
            {
                "id": f.get("id"),
                "name": f.get("displayName"),
                "total_items": f.get("totalItemCount"),
                "unread_items": f.get("unreadItemCount"),
            }
            for f in data.get("value", [])
        ]
        return {"folders": folders}

    async def _move_email(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        message_id = params.get("message_id")
        destination_folder = params.get("destination_folder")
        if not message_id or not destination_folder:
            raise ConnectorError(
                "MISSING_PARAM",
                "move_email requires 'message_id' and 'destination_folder'",
            )
        r = await request_with_rate_limit(
            client, "POST", f"{_BASE}/messages/{message_id}/move",
            headers=headers, json={"destinationId": destination_folder},
        )
        _raise_for_status(r, "move_email")
        data = r.json()
        return {"message_id": data.get("id"), "moved": True, "folder": destination_folder}


def _raise_for_status(r: httpx.Response, operation: str) -> None:
    if r.status_code == 401:
        raise ConnectorError(
            "TOKEN_EXPIRED",
            f"Outlook {operation} failed: access token is invalid or expired",
        )
    if r.status_code == 404:
        raise ConnectorError(
            "NOT_FOUND",
            f"Outlook {operation} failed: message or folder not found",
        )
    if r.status_code == 403:
        raise ConnectorError(
            "FORBIDDEN",
            f"Outlook {operation} failed: insufficient permissions",
        )
    if r.status_code >= 400:
        raise ConnectorError(
            "OUTLOOK_HTTP_ERROR",
            f"Outlook {operation} failed ({r.status_code}): {r.text[:300]}",
        )
