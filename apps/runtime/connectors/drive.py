"""Google Drive native connector."""
from __future__ import annotations

from typing import Any

import httpx

from .base import IConnector, ConnectorError
from .rate_limit import request_with_rate_limit

_BASE = "https://www.googleapis.com/drive/v3"
_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3"


class DriveConnector(IConnector):
    provider = "drive"
    supported_operations = [
        "list_files",
        "get_file_metadata",
        "create_folder",
        "share_file",
        "delete_file",
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
                case "list_files":
                    return await self._list_files(client, headers, params)
                case "get_file_metadata":
                    return await self._get_file(client, headers, params)
                case "create_folder":
                    return await self._create_folder(client, headers, params)
                case "share_file":
                    return await self._share_file(client, headers, params)
                case "delete_file":
                    return await self._delete_file(client, headers, params)
                case _:
                    raise ConnectorError(
                        "UNSUPPORTED_OPERATION",
                        f"Google Drive does not support operation '{operation}'",
                    )

    async def _list_files(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        query_parts: list[str] = ["trashed = false"]
        if params.get("query"):
            query_parts.append(f"name contains '{params['query']}'")
        if params.get("folder_id"):
            query_parts.append(f"'{params['folder_id']}' in parents")
        if params.get("mime_type"):
            query_parts.append(f"mimeType = '{params['mime_type']}'")
        q = " and ".join(query_parts)
        r = await request_with_rate_limit(
            client, "GET", f"{_BASE}/files",
            headers=headers,
            params={
                "q": q,
                "pageSize": int(params.get("max_results", 20)),
                "fields": "files(id,name,mimeType,size,modifiedTime,parents,webViewLink)",
            },
        )
        _raise_for_status(r, "list_files")
        data = r.json()
        return {"files": data.get("files", [])}

    async def _get_file(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        file_id = params.get("file_id")
        if not file_id:
            raise ConnectorError("MISSING_PARAM", "get_file requires 'file_id'")
        r = await request_with_rate_limit(
            client, "GET", f"{_BASE}/files/{file_id}",
            headers=headers,
            params={"fields": "id,name,mimeType,size,modifiedTime,parents,webViewLink,description"},
        )
        _raise_for_status(r, "get_file")
        return r.json()

    async def _create_folder(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        name = params.get("name")
        if not name:
            raise ConnectorError("MISSING_PARAM", "create_folder requires 'name'")
        body: dict[str, Any] = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
        }
        if params.get("parent_id"):
            body["parents"] = [params["parent_id"]]
        r = await request_with_rate_limit(
            client, "POST", f"{_BASE}/files",
            headers={**headers, "Content-Type": "application/json"},
            json=body,
        )
        _raise_for_status(r, "create_folder")
        data = r.json()
        return {"folder_id": data.get("id"), "name": data.get("name")}

    async def _share_file(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        file_id = params.get("file_id")
        email = params.get("email")
        role = params.get("role", "reader")
        if not file_id or not email:
            raise ConnectorError(
                "MISSING_PARAM", "share_file requires 'file_id' and 'email'"
            )
        r = await request_with_rate_limit(
            client, "POST", f"{_BASE}/files/{file_id}/permissions",
            headers={**headers, "Content-Type": "application/json"},
            json={"type": "user", "role": role, "emailAddress": email},
        )
        _raise_for_status(r, "share_file")
        data = r.json()
        return {"file_id": file_id, "permission_id": data.get("id"), "role": role, "email": email}

    async def _delete_file(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        file_id = params.get("file_id")
        if not file_id:
            raise ConnectorError("MISSING_PARAM", "delete_file requires 'file_id'")
        r = await request_with_rate_limit(
            client, "DELETE", f"{_BASE}/files/{file_id}", headers=headers
        )
        if r.status_code not in (200, 204):
            _raise_for_status(r, "delete_file")
        return {"file_id": file_id, "deleted": True}


def _raise_for_status(r: httpx.Response, operation: str) -> None:
    if r.status_code == 401:
        raise ConnectorError(
            "TOKEN_EXPIRED",
            f"Google Drive {operation} failed: access token is invalid or expired",
        )
    if r.status_code == 404:
        raise ConnectorError(
            "NOT_FOUND",
            f"Google Drive {operation} failed: file or folder not found",
        )
    if r.status_code >= 400:
        raise ConnectorError(
            "DRIVE_HTTP_ERROR",
            f"Google Drive {operation} failed ({r.status_code}): {r.text[:300]}",
        )
