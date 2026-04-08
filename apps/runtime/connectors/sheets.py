"""Google Sheets native connector."""
from __future__ import annotations

from typing import Any

import httpx

from .base import IConnector, ConnectorError
from .rate_limit import request_with_rate_limit

_BASE = "https://sheets.googleapis.com/v4/spreadsheets"


class SheetsConnector(IConnector):
    provider = "sheets"
    supported_operations = [
        "read_range",
        "write_range",
        "append_row",
        "list_sheets",
        "clear_range",
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
                case "read_range":
                    return await self._read_range(client, headers, params)
                case "write_range":
                    return await self._write_range(client, headers, params)
                case "append_row":
                    return await self._append_row(client, headers, params)
                case "list_sheets":
                    return await self._list_sheets(client, headers, params)
                case "clear_range":
                    return await self._clear_range(client, headers, params)
                case _:
                    raise ConnectorError(
                        "UNSUPPORTED_OPERATION",
                        f"Sheets does not support operation '{operation}'",
                    )

    async def _read_range(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        spreadsheet_id = params.get("spreadsheet_id")
        range_ = params.get("range")
        if not spreadsheet_id or not range_:
            raise ConnectorError("MISSING_PARAM", "read_range requires 'spreadsheet_id' and 'range'")
        r = await request_with_rate_limit(
            client,
            "GET",
            f"{_BASE}/{spreadsheet_id}/values/{range_}",
            headers=headers,
            params={"valueRenderOption": "FORMATTED_VALUE"},
        )
        _raise_for_status(r, "read_range")
        data = r.json()
        return {
            "range": data.get("range"),
            "values": data.get("values", []),
            "major_dimension": data.get("majorDimension", "ROWS"),
        }

    async def _write_range(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        spreadsheet_id = params.get("spreadsheet_id")
        range_ = params.get("range")
        values = params.get("values")
        if not spreadsheet_id or not range_ or values is None:
            raise ConnectorError(
                "MISSING_PARAM",
                "write_range requires 'spreadsheet_id', 'range', and 'values'",
            )
        r = await request_with_rate_limit(
            client,
            "PUT",
            f"{_BASE}/{spreadsheet_id}/values/{range_}",
            headers=headers,
            params={"valueInputOption": "USER_ENTERED"},
            json={"range": range_, "majorDimension": "ROWS", "values": values},
        )
        _raise_for_status(r, "write_range")
        data = r.json()
        return {
            "updated_range": data.get("updatedRange"),
            "updated_rows": data.get("updatedRows", 0),
            "updated_cells": data.get("updatedCells", 0),
        }

    async def _append_row(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        spreadsheet_id = params.get("spreadsheet_id")
        range_ = params.get("range")
        values = params.get("values")
        if not spreadsheet_id or not range_ or values is None:
            raise ConnectorError(
                "MISSING_PARAM",
                "append_row requires 'spreadsheet_id', 'range', and 'values'",
            )
        rows = values if isinstance(values[0], list) else [values]
        r = await request_with_rate_limit(
            client,
            "POST",
            f"{_BASE}/{spreadsheet_id}/values/{range_}:append",
            headers=headers,
            params={"valueInputOption": "USER_ENTERED", "insertDataOption": "INSERT_ROWS"},
            json={"majorDimension": "ROWS", "values": rows},
        )
        _raise_for_status(r, "append_row")
        data = r.json()
        updates = data.get("updates", {})
        return {
            "updated_range": updates.get("updatedRange"),
            "updated_rows": updates.get("updatedRows", 0),
        }

    async def _list_sheets(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        spreadsheet_id = params.get("spreadsheet_id")
        if not spreadsheet_id:
            raise ConnectorError("MISSING_PARAM", "list_sheets requires 'spreadsheet_id'")
        r = await request_with_rate_limit(
            client,
            "GET",
            f"{_BASE}/{spreadsheet_id}",
            headers=headers,
            params={"fields": "sheets.properties"},
        )
        _raise_for_status(r, "list_sheets")
        sheets = r.json().get("sheets", [])
        return {
            "sheets": [
                {
                    "sheet_id": s["properties"]["sheetId"],
                    "title": s["properties"]["title"],
                    "index": s["properties"]["index"],
                }
                for s in sheets
            ]
        }

    async def _clear_range(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        spreadsheet_id = params.get("spreadsheet_id")
        range_ = params.get("range")
        if not spreadsheet_id or not range_:
            raise ConnectorError(
                "MISSING_PARAM", "clear_range requires 'spreadsheet_id' and 'range'"
            )
        r = await request_with_rate_limit(
            client,
            "POST",
            f"{_BASE}/{spreadsheet_id}/values/{range_}:clear",
            headers=headers,
        )
        _raise_for_status(r, "clear_range")
        data = r.json()
        return {"cleared_range": data.get("clearedRange")}


def _raise_for_status(r: httpx.Response, operation: str) -> None:
    if r.status_code >= 400:
        raise ConnectorError(
            "SHEETS_API_ERROR",
            f"Sheets {operation} failed ({r.status_code}): {r.text[:300]}",
        )