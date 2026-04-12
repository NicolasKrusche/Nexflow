"""Asana native connector."""
from __future__ import annotations

from typing import Any

import httpx

from .base import IConnector, ConnectorError
from .rate_limit import request_with_rate_limit

_BASE = "https://app.asana.com/api/1.0"


class AsanaConnector(IConnector):
    provider = "asana"
    supported_operations = [
        "list_projects",
        "list_tasks",
        "get_task",
        "create_task",
        "update_task",
        "complete_task",
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
            "Accept": "application/json",
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            match operation:
                case "list_projects":
                    return await self._list_projects(client, headers, params)
                case "list_tasks":
                    return await self._list_tasks(client, headers, params)
                case "get_task":
                    return await self._get_task(client, headers, params)
                case "create_task":
                    return await self._create_task(client, headers, params)
                case "update_task":
                    return await self._update_task(client, headers, params)
                case "complete_task":
                    return await self._complete_task(client, headers, params)
                case _:
                    raise ConnectorError(
                        "UNSUPPORTED_OPERATION",
                        f"Asana does not support operation '{operation}'",
                    )

    async def _list_projects(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        query: dict[str, Any] = {
            "opt_fields": "gid,name,color,archived,created_at",
            "limit": int(params.get("limit", 50)),
        }
        if params.get("workspace_id"):
            query["workspace"] = params["workspace_id"]
        r = await request_with_rate_limit(
            client, "GET", f"{_BASE}/projects", headers=headers, params=query
        )
        _raise_for_status(r, "list_projects")
        data = r.json()
        return {"projects": data.get("data", [])}

    async def _list_tasks(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        project_id = params.get("project_id")
        if not project_id:
            raise ConnectorError("MISSING_PARAM", "list_tasks requires 'project_id'")
        query: dict[str, Any] = {
            "project": project_id,
            "opt_fields": "gid,name,completed,due_on,assignee.name,notes",
            "limit": int(params.get("limit", 50)),
        }
        if params.get("completed") is not None:
            query["completed"] = str(params["completed"]).lower()
        r = await request_with_rate_limit(
            client, "GET", f"{_BASE}/tasks", headers=headers, params=query
        )
        _raise_for_status(r, "list_tasks")
        return {"tasks": r.json().get("data", [])}

    async def _get_task(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        task_id = params.get("task_id")
        if not task_id:
            raise ConnectorError("MISSING_PARAM", "get_task requires 'task_id'")
        r = await request_with_rate_limit(
            client, "GET", f"{_BASE}/tasks/{task_id}",
            headers=headers,
            params={"opt_fields": "gid,name,completed,due_on,assignee.name,notes,projects.name,tags.name"},
        )
        _raise_for_status(r, "get_task")
        return r.json().get("data", {})

    async def _create_task(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        name = params.get("name")
        project_id = params.get("project_id")
        if not name or not project_id:
            raise ConnectorError(
                "MISSING_PARAM", "create_task requires 'name' and 'project_id'"
            )
        body: dict[str, Any] = {"name": name, "projects": [project_id]}
        if params.get("notes"):
            body["notes"] = params["notes"]
        if params.get("due_on"):
            body["due_on"] = params["due_on"]
        if params.get("assignee"):
            body["assignee"] = params["assignee"]
        r = await request_with_rate_limit(
            client, "POST", f"{_BASE}/tasks",
            headers=headers, json={"data": body},
        )
        _raise_for_status(r, "create_task")
        data = r.json().get("data", {})
        return {"task_id": data.get("gid"), "name": data.get("name")}

    async def _update_task(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        task_id = params.get("task_id")
        if not task_id:
            raise ConnectorError("MISSING_PARAM", "update_task requires 'task_id'")
        body: dict[str, Any] = {}
        for field in ("name", "notes", "due_on", "assignee"):
            if params.get(field) is not None:
                body[field] = params[field]
        r = await request_with_rate_limit(
            client, "PUT", f"{_BASE}/tasks/{task_id}",
            headers=headers, json={"data": body},
        )
        _raise_for_status(r, "update_task")
        data = r.json().get("data", {})
        return {"task_id": data.get("gid"), "name": data.get("name")}

    async def _complete_task(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        task_id = params.get("task_id")
        if not task_id:
            raise ConnectorError("MISSING_PARAM", "complete_task requires 'task_id'")
        r = await request_with_rate_limit(
            client, "PUT", f"{_BASE}/tasks/{task_id}",
            headers=headers, json={"data": {"completed": True}},
        )
        _raise_for_status(r, "complete_task")
        data = r.json().get("data", {})
        return {"task_id": data.get("gid"), "completed": data.get("completed", True)}


def _raise_for_status(r: httpx.Response, operation: str) -> None:
    if r.status_code == 401:
        raise ConnectorError(
            "TOKEN_EXPIRED",
            f"Asana {operation} failed: access token is invalid or expired",
        )
    if r.status_code == 404:
        raise ConnectorError(
            "NOT_FOUND",
            f"Asana {operation} failed: resource not found",
        )
    if r.status_code == 403:
        raise ConnectorError(
            "FORBIDDEN",
            f"Asana {operation} failed: insufficient permissions",
        )
    if r.status_code >= 400:
        raise ConnectorError(
            "ASANA_HTTP_ERROR",
            f"Asana {operation} failed ({r.status_code}): {r.text[:300]}",
        )
