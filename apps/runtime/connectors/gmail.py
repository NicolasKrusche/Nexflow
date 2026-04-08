"""Gmail native connector."""
from __future__ import annotations

import base64
import email as email_lib
from email.mime.text import MIMEText
from typing import Any

import httpx

from .base import IConnector, ConnectorError

_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"


class GmailConnector(IConnector):
    provider = "gmail"
    supported_operations = [
        "list_emails",
        "read_email",
        "send_email",
        "archive_email",
        "label_email",
    ]

    async def execute(
        self,
        operation: str,
        params: dict[str, Any],
        access_token: str,
    ) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {access_token}"}
        async with httpx.AsyncClient(timeout=30.0) as client:
            match operation:
                case "list_emails":
                    return await self._list_emails(client, headers, params)
                case "read_email":
                    return await self._read_email(client, headers, params)
                case "send_email":
                    return await self._send_email(client, headers, params)
                case "archive_email":
                    return await self._archive_email(client, headers, params)
                case "label_email":
                    return await self._label_email(client, headers, params)
                case _:
                    raise ConnectorError(
                        "UNSUPPORTED_OPERATION",
                        f"Gmail does not support operation '{operation}'",
                    )

    async def _list_emails(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        query = params.get("query", "")
        max_results = int(params.get("max_results", 10))
        r = await client.get(
            f"{_BASE}/messages",
            headers=headers,
            params={"q": query, "maxResults": max_results},
        )
        _raise_for_status(r, "list_emails")
        data = r.json()
        messages = data.get("messages", [])
        return {"emails": messages, "result_size_estimate": data.get("resultSizeEstimate", 0)}

    async def _read_email(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        message_id = params.get("message_id")
        if not message_id:
            raise ConnectorError("MISSING_PARAM", "read_email requires 'message_id'")
        r = await client.get(
            f"{_BASE}/messages/{message_id}",
            headers=headers,
            params={"format": "full"},
        )
        _raise_for_status(r, "read_email")
        msg = r.json()
        payload = msg.get("payload", {})
        subject = _header(payload, "Subject")
        sender = _header(payload, "From")
        recipient = _header(payload, "To")
        body = _extract_body(payload)
        return {
            "message_id": message_id,
            "subject": subject,
            "from": sender,
            "to": recipient,
            "snippet": msg.get("snippet", ""),
            "body": body,
            "labels": msg.get("labelIds", []),
        }

    async def _send_email(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        to = params.get("to")
        subject = params.get("subject", "")
        body = params.get("body", "")
        if not to:
            raise ConnectorError("MISSING_PARAM", "send_email requires 'to'")
        mime = MIMEText(body)
        mime["to"] = to
        mime["subject"] = subject
        if params.get("cc"):
            mime["cc"] = params["cc"]
        if params.get("bcc"):
            mime["bcc"] = params["bcc"]
        if params.get("reply_to_id"):
            mime["In-Reply-To"] = params["reply_to_id"]
            mime["References"] = params["reply_to_id"]
        raw = base64.urlsafe_b64encode(mime.as_bytes()).decode()
        payload: dict[str, Any] = {"raw": raw}
        if params.get("thread_id"):
            payload["threadId"] = params["thread_id"]
        r = await client.post(f"{_BASE}/messages/send", headers=headers, json=payload)
        _raise_for_status(r, "send_email")
        result = r.json()
        return {"message_id": result.get("id"), "thread_id": result.get("threadId")}

    async def _archive_email(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        message_id = params.get("message_id")
        if not message_id:
            raise ConnectorError("MISSING_PARAM", "archive_email requires 'message_id'")
        r = await client.post(
            f"{_BASE}/messages/{message_id}/modify",
            headers=headers,
            json={"removeLabelIds": ["INBOX"]},
        )
        _raise_for_status(r, "archive_email")
        return {"message_id": message_id, "archived": True}

    async def _label_email(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        message_id = params.get("message_id")
        if not message_id:
            raise ConnectorError("MISSING_PARAM", "label_email requires 'message_id'")
        r = await client.post(
            f"{_BASE}/messages/{message_id}/modify",
            headers=headers,
            json={
                "addLabelIds": list(params.get("add_label_ids") or []),
                "removeLabelIds": list(params.get("remove_label_ids") or []),
            },
        )
        _raise_for_status(r, "label_email")
        return {"message_id": message_id, "labels": r.json().get("labelIds", [])}


# ─── helpers ─────────────────────────────────────────────────────────────────

def _raise_for_status(r: httpx.Response, operation: str) -> None:
    if r.status_code >= 400:
        raise ConnectorError(
            "GMAIL_API_ERROR",
            f"Gmail {operation} failed ({r.status_code}): {r.text[:300]}",
        )


def _header(payload: dict, name: str) -> str:
    for h in payload.get("headers", []):
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def _extract_body(payload: dict) -> str:
    """Extract plain-text body from a Gmail message payload."""
    mime_type = payload.get("mimeType", "")
    if mime_type == "text/plain":
        data = payload.get("body", {}).get("data", "")
        if data:
            return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
    for part in payload.get("parts", []):
        result = _extract_body(part)
        if result:
            return result
    return ""
