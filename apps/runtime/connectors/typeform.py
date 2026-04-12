"""Typeform native connector."""
from __future__ import annotations

from typing import Any

import httpx

from .base import IConnector, ConnectorError
from .rate_limit import request_with_rate_limit

_BASE = "https://api.typeform.com"


class TypeformConnector(IConnector):
    provider = "typeform"
    supported_operations = [
        "list_forms",
        "get_form",
        "list_responses",
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
                case "list_forms":
                    return await self._list_forms(client, headers, params)
                case "get_form":
                    return await self._get_form(client, headers, params)
                case "list_responses":
                    return await self._get_responses(client, headers, params)
                case _:
                    raise ConnectorError(
                        "UNSUPPORTED_OPERATION",
                        f"Typeform does not support operation '{operation}'",
                    )

    async def _list_forms(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        query: dict[str, Any] = {"page_size": int(params.get("page_size", 25))}
        if params.get("search"):
            query["search"] = params["search"]
        r = await request_with_rate_limit(
            client, "GET", f"{_BASE}/forms", headers=headers, params=query
        )
        _raise_for_status(r, "list_forms")
        data = r.json()
        forms = [
            {
                "id": f.get("id"),
                "title": f.get("title"),
                "last_updated_at": f.get("last_updated_at"),
                "self_link": f.get("_links", {}).get("display"),
            }
            for f in data.get("items", [])
        ]
        return {"forms": forms, "total_items": data.get("total_items")}

    async def _get_form(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        form_id = params.get("form_id")
        if not form_id:
            raise ConnectorError("MISSING_PARAM", "get_form requires 'form_id'")
        r = await request_with_rate_limit(
            client, "GET", f"{_BASE}/forms/{form_id}", headers=headers
        )
        _raise_for_status(r, "get_form")
        form = r.json()
        fields = [
            {"id": f.get("id"), "title": f.get("title"), "type": f.get("type")}
            for f in form.get("fields", [])
        ]
        return {
            "id": form.get("id"),
            "title": form.get("title"),
            "fields": fields,
            "settings": form.get("settings", {}),
        }

    async def _get_responses(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        form_id = params.get("form_id")
        if not form_id:
            raise ConnectorError("MISSING_PARAM", "get_responses requires 'form_id'")
        query: dict[str, Any] = {"page_size": int(params.get("page_size", 25))}
        if params.get("since"):
            query["since"] = params["since"]
        if params.get("until"):
            query["until"] = params["until"]
        if params.get("completed") is not None:
            query["completed"] = str(params["completed"]).lower()
        r = await request_with_rate_limit(
            client, "GET", f"{_BASE}/forms/{form_id}/responses",
            headers=headers, params=query,
        )
        _raise_for_status(r, "get_responses")
        data = r.json()
        responses = [
            {
                "response_id": resp.get("response_id"),
                "submitted_at": resp.get("submitted_at"),
                "answers": _flatten_answers(resp.get("answers", [])),
            }
            for resp in data.get("items", [])
        ]
        return {"responses": responses, "total_items": data.get("total_items")}


def _flatten_answers(answers: list[dict]) -> dict[str, Any]:
    """Convert Typeform's answer array into a {field_ref: value} dict."""
    result: dict[str, Any] = {}
    for answer in answers:
        field = answer.get("field", {})
        ref = field.get("ref") or field.get("id", "unknown")
        answer_type = answer.get("type")
        value: Any = answer.get(answer_type) if answer_type else None
        result[ref] = value
    return result


def _raise_for_status(r: httpx.Response, operation: str) -> None:
    if r.status_code == 401:
        raise ConnectorError(
            "TOKEN_EXPIRED",
            f"Typeform {operation} failed: access token is invalid or expired",
        )
    if r.status_code == 404:
        raise ConnectorError(
            "NOT_FOUND",
            f"Typeform {operation} failed: form not found",
        )
    if r.status_code >= 400:
        raise ConnectorError(
            "TYPEFORM_HTTP_ERROR",
            f"Typeform {operation} failed ({r.status_code}): {r.text[:300]}",
        )
