"""HubSpot native connector."""
from __future__ import annotations

from typing import Any

import httpx

from .base import IConnector, ConnectorError
from .rate_limit import request_with_rate_limit

_BASE = "https://api.hubapi.com"


class HubSpotConnector(IConnector):
    provider = "hubspot"
    supported_operations = [
        "list_contacts",
        "get_contact",
        "create_contact",
        "update_contact",
        "list_deals",
        "create_deal",
        "update_deal",
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
                case "list_contacts":
                    return await self._list_contacts(client, headers, params)
                case "get_contact":
                    return await self._get_contact(client, headers, params)
                case "create_contact":
                    return await self._create_contact(client, headers, params)
                case "update_contact":
                    return await self._update_contact(client, headers, params)
                case "list_deals":
                    return await self._list_deals(client, headers, params)
                case "create_deal":
                    return await self._create_deal(client, headers, params)
                case "update_deal":
                    return await self._update_deal(client, headers, params)
                case _:
                    raise ConnectorError(
                        "UNSUPPORTED_OPERATION",
                        f"HubSpot does not support operation '{operation}'",
                    )

    async def _list_contacts(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        limit = int(params.get("limit", 20))
        props = params.get("properties", ["firstname", "lastname", "email", "phone"])
        r = await request_with_rate_limit(
            client, "GET", f"{_BASE}/crm/v3/objects/contacts",
            headers=headers,
            params={"limit": limit, "properties": ",".join(props)},
        )
        _raise_for_status(r, "list_contacts")
        data = r.json()
        return {
            "contacts": [_flatten_hs_object(c) for c in data.get("results", [])],
            "paging": data.get("paging"),
        }

    async def _get_contact(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        contact_id = params.get("contact_id")
        email = params.get("email")
        if not contact_id and not email:
            raise ConnectorError(
                "MISSING_PARAM", "get_contact requires 'contact_id' or 'email'"
            )
        if email and not contact_id:
            r = await request_with_rate_limit(
                client, "GET",
                f"{_BASE}/crm/v3/objects/contacts/{email}",
                headers=headers,
                params={"idProperty": "email", "properties": "firstname,lastname,email,phone,company"},
            )
        else:
            r = await request_with_rate_limit(
                client, "GET",
                f"{_BASE}/crm/v3/objects/contacts/{contact_id}",
                headers=headers,
                params={"properties": "firstname,lastname,email,phone,company"},
            )
        _raise_for_status(r, "get_contact")
        return _flatten_hs_object(r.json())

    async def _create_contact(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        email = params.get("email")
        if not email:
            raise ConnectorError("MISSING_PARAM", "create_contact requires 'email'")
        properties: dict[str, str] = {"email": email}
        for field in ("firstname", "lastname", "phone", "company"):
            if params.get(field):
                properties[field] = str(params[field])
        r = await request_with_rate_limit(
            client, "POST", f"{_BASE}/crm/v3/objects/contacts",
            headers=headers, json={"properties": properties},
        )
        _raise_for_status(r, "create_contact")
        return _flatten_hs_object(r.json())

    async def _update_contact(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        contact_id = params.get("contact_id")
        if not contact_id:
            raise ConnectorError("MISSING_PARAM", "update_contact requires 'contact_id'")
        properties: dict[str, str] = {}
        for field in ("firstname", "lastname", "email", "phone", "company"):
            if params.get(field) is not None:
                properties[field] = str(params[field])
        r = await request_with_rate_limit(
            client, "PATCH", f"{_BASE}/crm/v3/objects/contacts/{contact_id}",
            headers=headers, json={"properties": properties},
        )
        _raise_for_status(r, "update_contact")
        return _flatten_hs_object(r.json())

    async def _list_deals(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        limit = int(params.get("limit", 20))
        props = params.get("properties", ["dealname", "amount", "dealstage", "closedate"])
        r = await request_with_rate_limit(
            client, "GET", f"{_BASE}/crm/v3/objects/deals",
            headers=headers,
            params={"limit": limit, "properties": ",".join(props)},
        )
        _raise_for_status(r, "list_deals")
        data = r.json()
        return {
            "deals": [_flatten_hs_object(d) for d in data.get("results", [])],
            "paging": data.get("paging"),
        }

    async def _create_deal(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        deal_name = params.get("deal_name")
        if not deal_name:
            raise ConnectorError("MISSING_PARAM", "create_deal requires 'deal_name'")
        properties: dict[str, str] = {"dealname": deal_name}
        for field in ("amount", "dealstage", "closedate", "pipeline"):
            if params.get(field) is not None:
                properties[field] = str(params[field])
        r = await request_with_rate_limit(
            client, "POST", f"{_BASE}/crm/v3/objects/deals",
            headers=headers, json={"properties": properties},
        )
        _raise_for_status(r, "create_deal")
        return _flatten_hs_object(r.json())

    async def _update_deal(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        deal_id = params.get("deal_id")
        if not deal_id:
            raise ConnectorError("MISSING_PARAM", "update_deal requires 'deal_id'")
        properties: dict[str, str] = {}
        for field in ("deal_name", "amount", "dealstage", "closedate", "pipeline"):
            if params.get(field) is not None:
                key = "dealname" if field == "deal_name" else field
                properties[key] = str(params[field])
        r = await request_with_rate_limit(
            client, "PATCH", f"{_BASE}/crm/v3/objects/deals/{deal_id}",
            headers=headers, json={"properties": properties},
        )
        _raise_for_status(r, "update_deal")
        return _flatten_hs_object(r.json())


def _flatten_hs_object(obj: dict) -> dict:
    """Merge HubSpot 'properties' dict into the top-level object for easier downstream access."""
    result = {"id": obj.get("id")}
    result.update(obj.get("properties", {}))
    return result


def _raise_for_status(r: httpx.Response, operation: str) -> None:
    if r.status_code == 401:
        raise ConnectorError(
            "TOKEN_EXPIRED",
            f"HubSpot {operation} failed: access token is invalid or expired",
        )
    if r.status_code == 404:
        raise ConnectorError(
            "NOT_FOUND",
            f"HubSpot {operation} failed: resource not found",
        )
    if r.status_code == 409:
        raise ConnectorError(
            "CONFLICT",
            f"HubSpot {operation} failed: contact already exists",
        )
    if r.status_code >= 400:
        raise ConnectorError(
            "HUBSPOT_HTTP_ERROR",
            f"HubSpot {operation} failed ({r.status_code}): {r.text[:300]}",
        )
