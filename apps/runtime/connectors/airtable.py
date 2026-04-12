"""Airtable native connector."""
from __future__ import annotations

from typing import Any

import httpx

from .base import IConnector, ConnectorError
from .rate_limit import request_with_rate_limit

_BASE = "https://api.airtable.com/v0"


class AirtableConnector(IConnector):
    provider = "airtable"
    supported_operations = [
        "list_records",
        "get_record",
        "create_record",
        "update_record",
        "delete_record",
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
                case "list_records":
                    return await self._list_records(client, headers, params)
                case "get_record":
                    return await self._get_record(client, headers, params)
                case "create_record":
                    return await self._create_record(client, headers, params)
                case "update_record":
                    return await self._update_record(client, headers, params)
                case "delete_record":
                    return await self._delete_record(client, headers, params)
                case _:
                    raise ConnectorError(
                        "UNSUPPORTED_OPERATION",
                        f"Airtable does not support operation '{operation}'",
                    )

    def _table_url(self, base_id: str, table_name: str) -> str:
        return f"{_BASE}/{base_id}/{table_name}"

    async def _list_records(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        base_id = params.get("base_id")
        table_name = params.get("table_name")
        if not base_id or not table_name:
            raise ConnectorError(
                "MISSING_PARAM", "list_records requires 'base_id' and 'table_name'"
            )
        query: dict[str, Any] = {"maxRecords": int(params.get("max_records", 100))}
        if params.get("view"):
            query["view"] = params["view"]
        if params.get("filter_formula"):
            query["filterByFormula"] = params["filter_formula"]
        if params.get("sort_field"):
            query["sort[0][field]"] = params["sort_field"]
            query["sort[0][direction]"] = params.get("sort_direction", "asc")
        r = await request_with_rate_limit(
            client, "GET", self._table_url(base_id, table_name),
            headers=headers, params=query,
        )
        _raise_for_status(r, "list_records")
        data = r.json()
        return {
            "records": data.get("records", []),
            "offset": data.get("offset"),
        }

    async def _get_record(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        base_id = params.get("base_id")
        table_name = params.get("table_name")
        record_id = params.get("record_id")
        if not base_id or not table_name or not record_id:
            raise ConnectorError(
                "MISSING_PARAM",
                "get_record requires 'base_id', 'table_name', and 'record_id'",
            )
        r = await request_with_rate_limit(
            client, "GET", f"{self._table_url(base_id, table_name)}/{record_id}",
            headers=headers,
        )
        _raise_for_status(r, "get_record")
        return r.json()

    async def _create_record(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        base_id = params.get("base_id")
        table_name = params.get("table_name")
        fields = params.get("fields", {})
        if not base_id or not table_name:
            raise ConnectorError(
                "MISSING_PARAM", "create_record requires 'base_id' and 'table_name'"
            )
        r = await request_with_rate_limit(
            client, "POST", self._table_url(base_id, table_name),
            headers=headers, json={"fields": fields},
        )
        _raise_for_status(r, "create_record")
        data = r.json()
        return {"record_id": data.get("id"), "fields": data.get("fields", {})}

    async def _update_record(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        base_id = params.get("base_id")
        table_name = params.get("table_name")
        record_id = params.get("record_id")
        fields = params.get("fields", {})
        if not base_id or not table_name or not record_id:
            raise ConnectorError(
                "MISSING_PARAM",
                "update_record requires 'base_id', 'table_name', and 'record_id'",
            )
        r = await request_with_rate_limit(
            client, "PATCH", f"{self._table_url(base_id, table_name)}/{record_id}",
            headers=headers, json={"fields": fields},
        )
        _raise_for_status(r, "update_record")
        data = r.json()
        return {"record_id": data.get("id"), "fields": data.get("fields", {})}

    async def _delete_record(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        base_id = params.get("base_id")
        table_name = params.get("table_name")
        record_id = params.get("record_id")
        if not base_id or not table_name or not record_id:
            raise ConnectorError(
                "MISSING_PARAM",
                "delete_record requires 'base_id', 'table_name', and 'record_id'",
            )
        r = await request_with_rate_limit(
            client, "DELETE", f"{self._table_url(base_id, table_name)}/{record_id}",
            headers=headers,
        )
        _raise_for_status(r, "delete_record")
        data = r.json()
        return {"record_id": data.get("id"), "deleted": data.get("deleted", True)}


def _raise_for_status(r: httpx.Response, operation: str) -> None:
    if r.status_code == 401:
        raise ConnectorError(
            "TOKEN_EXPIRED",
            f"Airtable {operation} failed: access token is invalid or expired",
        )
    if r.status_code == 404:
        raise ConnectorError(
            "NOT_FOUND",
            f"Airtable {operation} failed: base, table, or record not found",
        )
    if r.status_code == 422:
        raise ConnectorError(
            "VALIDATION_ERROR",
            f"Airtable {operation} failed: invalid fields or formula",
        )
    if r.status_code >= 400:
        raise ConnectorError(
            "AIRTABLE_HTTP_ERROR",
            f"Airtable {operation} failed ({r.status_code}): {r.text[:300]}",
        )
