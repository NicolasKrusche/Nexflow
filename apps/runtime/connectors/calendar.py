"""Google Calendar native connector."""
from __future__ import annotations

from typing import Any

import httpx

from .base import IConnector, ConnectorError
from .rate_limit import request_with_rate_limit

_BASE = "https://www.googleapis.com/calendar/v3"


class CalendarConnector(IConnector):
    provider = "calendar"
    supported_operations = [
        "list_events",
        "get_event",
        "create_event",
        "update_event",
        "delete_event",
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
                case "list_events":
                    return await self._list_events(client, headers, params)
                case "get_event":
                    return await self._get_event(client, headers, params)
                case "create_event":
                    return await self._create_event(client, headers, params)
                case "update_event":
                    return await self._update_event(client, headers, params)
                case "delete_event":
                    return await self._delete_event(client, headers, params)
                case _:
                    raise ConnectorError(
                        "UNSUPPORTED_OPERATION",
                        f"Google Calendar does not support operation '{operation}'",
                    )

    async def _list_events(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        calendar_id = params.get("calendar_id", "primary")
        query: dict[str, Any] = {"maxResults": int(params.get("max_results", 25))}
        if params.get("time_min"):
            query["timeMin"] = params["time_min"]
        if params.get("time_max"):
            query["timeMax"] = params["time_max"]
        if params.get("query"):
            query["q"] = params["query"]
        query["singleEvents"] = "true"
        query["orderBy"] = "startTime"
        r = await request_with_rate_limit(
            client, "GET", f"{_BASE}/calendars/{calendar_id}/events",
            headers=headers, params=query,
        )
        _raise_for_status(r, "list_events")
        data = r.json()
        events = [
            {
                "id": e.get("id"),
                "summary": e.get("summary"),
                "start": e.get("start"),
                "end": e.get("end"),
                "status": e.get("status"),
                "html_link": e.get("htmlLink"),
            }
            for e in data.get("items", [])
        ]
        return {"events": events, "next_page_token": data.get("nextPageToken")}

    async def _get_event(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        event_id = params.get("event_id")
        calendar_id = params.get("calendar_id", "primary")
        if not event_id:
            raise ConnectorError("MISSING_PARAM", "get_event requires 'event_id'")
        r = await request_with_rate_limit(
            client, "GET", f"{_BASE}/calendars/{calendar_id}/events/{event_id}",
            headers=headers,
        )
        _raise_for_status(r, "get_event")
        e = r.json()
        return {
            "id": e.get("id"),
            "summary": e.get("summary"),
            "description": e.get("description"),
            "start": e.get("start"),
            "end": e.get("end"),
            "attendees": e.get("attendees", []),
            "location": e.get("location"),
            "status": e.get("status"),
            "html_link": e.get("htmlLink"),
        }

    async def _create_event(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        summary = params.get("summary")
        start = params.get("start")
        end = params.get("end")
        if not summary or not start or not end:
            raise ConnectorError(
                "MISSING_PARAM", "create_event requires 'summary', 'start', and 'end'"
            )
        calendar_id = params.get("calendar_id", "primary")
        body: dict[str, Any] = {"summary": summary, "start": start, "end": end}
        if params.get("description"):
            body["description"] = params["description"]
        if params.get("location"):
            body["location"] = params["location"]
        if params.get("attendees"):
            body["attendees"] = [{"email": a} for a in params["attendees"]]
        r = await request_with_rate_limit(
            client, "POST", f"{_BASE}/calendars/{calendar_id}/events",
            headers={**headers, "Content-Type": "application/json"},
            json=body,
        )
        _raise_for_status(r, "create_event")
        e = r.json()
        return {"id": e.get("id"), "html_link": e.get("htmlLink"), "status": e.get("status")}

    async def _update_event(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        event_id = params.get("event_id")
        calendar_id = params.get("calendar_id", "primary")
        if not event_id:
            raise ConnectorError("MISSING_PARAM", "update_event requires 'event_id'")
        body: dict[str, Any] = {}
        for field in ("summary", "description", "location", "start", "end"):
            if params.get(field) is not None:
                body[field] = params[field]
        if params.get("attendees"):
            body["attendees"] = [{"email": a} for a in params["attendees"]]
        r = await request_with_rate_limit(
            client, "PATCH", f"{_BASE}/calendars/{calendar_id}/events/{event_id}",
            headers={**headers, "Content-Type": "application/json"},
            json=body,
        )
        _raise_for_status(r, "update_event")
        e = r.json()
        return {"id": e.get("id"), "html_link": e.get("htmlLink"), "status": e.get("status")}

    async def _delete_event(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        event_id = params.get("event_id")
        calendar_id = params.get("calendar_id", "primary")
        if not event_id:
            raise ConnectorError("MISSING_PARAM", "delete_event requires 'event_id'")
        r = await request_with_rate_limit(
            client, "DELETE", f"{_BASE}/calendars/{calendar_id}/events/{event_id}",
            headers=headers,
        )
        if r.status_code not in (200, 204):
            _raise_for_status(r, "delete_event")
        return {"event_id": event_id, "deleted": True}


def _raise_for_status(r: httpx.Response, operation: str) -> None:
    if r.status_code == 401:
        raise ConnectorError(
            "TOKEN_EXPIRED",
            f"Google Calendar {operation} failed: access token is invalid or expired",
        )
    if r.status_code == 404:
        raise ConnectorError(
            "NOT_FOUND",
            f"Google Calendar {operation} failed: resource not found",
        )
    if r.status_code >= 400:
        raise ConnectorError(
            "CALENDAR_HTTP_ERROR",
            f"Google Calendar {operation} failed ({r.status_code}): {r.text[:300]}",
        )
