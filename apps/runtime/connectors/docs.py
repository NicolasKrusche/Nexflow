"""Google Docs native connector."""
from __future__ import annotations

from typing import Any

import httpx

from .base import IConnector, ConnectorError
from .rate_limit import request_with_rate_limit

_DOCS_BASE = "https://docs.googleapis.com/v1"
_DRIVE_BASE = "https://www.googleapis.com/drive/v3"


class DocsConnector(IConnector):
    provider = "docs"
    supported_operations = [
        "read_document",
        "create_document",
        "append_to_document",
        "replace_text",
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
                case "read_document":
                    return await self._read_document(client, headers, params)
                case "create_document":
                    return await self._create_document(client, headers, params)
                case "append_to_document":
                    return await self._append_text(client, headers, params)
                case "replace_text":
                    return await self._replace_text(client, headers, params)
                case _:
                    raise ConnectorError(
                        "UNSUPPORTED_OPERATION",
                        f"Google Docs does not support operation '{operation}'",
                    )

    async def _read_document(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        document_id = params.get("document_id")
        if not document_id:
            raise ConnectorError("MISSING_PARAM", "read_document requires 'document_id'")
        r = await request_with_rate_limit(
            client, "GET", f"{_DOCS_BASE}/documents/{document_id}", headers=headers
        )
        _raise_for_status(r, "read_document")
        doc = r.json()
        text = _extract_plain_text(doc)
        return {
            "document_id": doc.get("documentId"),
            "title": doc.get("title"),
            "text": text,
            "revision_id": doc.get("revisionId"),
        }

    async def _create_document(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        title = params.get("title", "Untitled Document")
        r = await request_with_rate_limit(
            client, "POST", f"{_DOCS_BASE}/documents",
            headers=headers, json={"title": title},
        )
        _raise_for_status(r, "create_document")
        doc = r.json()
        document_id = doc.get("documentId")
        result: dict[str, Any] = {"document_id": document_id, "title": doc.get("title")}
        if params.get("content"):
            await self._append_text(
                client, headers, {"document_id": document_id, "text": params["content"]}
            )
        return result

    async def _append_text(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        document_id = params.get("document_id")
        text = params.get("text", "")
        if not document_id:
            raise ConnectorError("MISSING_PARAM", "append_text requires 'document_id'")
        requests = [{"insertText": {"location": {"index": 1}, "text": text + "\n"}}]
        r = await request_with_rate_limit(
            client, "POST", f"{_DOCS_BASE}/documents/{document_id}:batchUpdate",
            headers=headers, json={"requests": requests},
        )
        _raise_for_status(r, "append_text")
        return {"document_id": document_id, "appended": True}

    async def _replace_text(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        document_id = params.get("document_id")
        find = params.get("find")
        replace = params.get("replace", "")
        if not document_id or not find:
            raise ConnectorError(
                "MISSING_PARAM", "replace_text requires 'document_id' and 'find'"
            )
        requests = [
            {
                "replaceAllText": {
                    "containsText": {"text": find, "matchCase": bool(params.get("match_case", False))},
                    "replaceText": replace,
                }
            }
        ]
        r = await request_with_rate_limit(
            client, "POST", f"{_DOCS_BASE}/documents/{document_id}:batchUpdate",
            headers=headers, json={"requests": requests},
        )
        _raise_for_status(r, "replace_text")
        data = r.json()
        occurrences = (
            data.get("replies", [{}])[0]
            .get("replaceAllText", {})
            .get("occurrencesChanged", 0)
        )
        return {"document_id": document_id, "occurrences_replaced": occurrences}


def _extract_plain_text(doc: dict) -> str:
    """Walk the Docs structural elements and extract all plain text."""
    parts: list[str] = []
    for elem in doc.get("body", {}).get("content", []):
        paragraph = elem.get("paragraph")
        if not paragraph:
            continue
        for pe in paragraph.get("elements", []):
            text_run = pe.get("textRun")
            if text_run:
                parts.append(text_run.get("content", ""))
    return "".join(parts)


def _raise_for_status(r: httpx.Response, operation: str) -> None:
    if r.status_code == 401:
        raise ConnectorError(
            "TOKEN_EXPIRED",
            f"Google Docs {operation} failed: access token is invalid or expired",
        )
    if r.status_code == 404:
        raise ConnectorError(
            "NOT_FOUND",
            f"Google Docs {operation} failed: document not found",
        )
    if r.status_code >= 400:
        raise ConnectorError(
            "DOCS_HTTP_ERROR",
            f"Google Docs {operation} failed ({r.status_code}): {r.text[:300]}",
        )
