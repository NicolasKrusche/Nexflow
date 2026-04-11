"""Notion native connector."""
from __future__ import annotations

import re
from typing import Any

import httpx

from .base import IConnector, ConnectorError
from .rate_limit import request_with_rate_limit

_BASE = "https://api.notion.com/v1"
_VERSION = "2022-06-28"
_NOTION_TEXT_LIMIT = 2000


class NotionConnector(IConnector):
    provider = "notion"
    supported_operations = [
        "read_page",
        "create_page",
        "append_to_page",
        "query_database",
        "create_database_entry",
        "create_database",
    ]

    async def execute(
        self,
        operation: str,
        params: dict[str, Any],
        access_token: str,
    ) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Notion-Version": _VERSION,
            "Content-Type": "application/json",
        }
        # Intercept create_page with a non-UUID parent_id — the model almost certainly
        # meant create_database_entry. Redirect before any HTTP call is made.
        if operation == "create_page":
            parent_id = str(params.get("parent_id", "")).strip()
            if (parent_id
                    and not parent_id.startswith("http")
                    and not _UUID_RE.fullmatch(parent_id)
                    and not _HEX32_RE.fullmatch(parent_id)):
                print(f"[notion] intercepted create_page with non-UUID parent_id '{parent_id}' → create_database_entry", flush=True)
                redirect_params: dict[str, Any] = {"database_id": parent_id}
                if params.get("title"):
                    redirect_params["_title"] = str(params["title"])
                if params.get("content"):
                    redirect_params["_body"] = str(params["content"])
                operation = "create_database_entry"
                params = redirect_params

        async with httpx.AsyncClient(timeout=30.0) as client:
            match operation:
                case "read_page":
                    return await self._read_page(client, headers, params)
                case "create_page":
                    return await self._create_page(client, headers, params)
                case "append_to_page":
                    return await self._append_to_page(client, headers, params)
                case "query_database":
                    return await self._query_database(client, headers, params)
                case "create_database_entry":
                    return await self._create_database_entry(client, headers, params)
                case "create_database":
                    return await self._create_database(client, headers, params)
                case _:
                    raise ConnectorError(
                        "UNSUPPORTED_OPERATION",
                        f"Notion does not support operation '{operation}'",
                    )

    async def _read_page(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        page_id = params.get("page_id")
        if not page_id:
            raise ConnectorError("MISSING_PARAM", "read_page requires 'page_id'")
        r = await request_with_rate_limit(client, "GET", f"{_BASE}/pages/{page_id}", headers=headers)
        _raise_for_status(r, "read_page")
        page = r.json()
        blocks_r = await request_with_rate_limit(
            client, "GET", f"{_BASE}/blocks/{page_id}/children", headers=headers
        )
        try:
            blocks = blocks_r.json().get("results", []) if blocks_r.status_code == 200 else []
        except Exception:
            blocks = []
        return {"page": page, "blocks": blocks}

    async def _create_page(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        parent_id = params.get("parent_id")
        title = params.get("title", "Untitled")
        if not parent_id:
            raise ConnectorError("MISSING_PARAM", "create_page requires 'parent_id'")
        # Safety net: if parent_id is a plain name (not a UUID/URL), the model
        # almost certainly meant create_database_entry — redirect automatically.
        parent_str = str(parent_id).strip()
        if (not parent_str.startswith("http")
                and not _UUID_RE.fullmatch(parent_str)
                and not _HEX32_RE.fullmatch(parent_str)):
            print(f"[notion] create_page got non-UUID parent_id '{parent_str}' — redirecting to create_database_entry", flush=True)
            redirect_params = {"database_id": parent_str, "_title": title}
            if params.get("content"):
                redirect_params["_body"] = str(params["content"])
            return await self._create_database_entry(client, headers, redirect_params)
        body: dict[str, Any] = {
            "parent": {"type": "page_id", "page_id": parent_id},
            "properties": {
                "title": {
                    "title": [{"type": "text", "text": {"content": str(title)[:_NOTION_TEXT_LIMIT]}}]
                }
            },
        }
        if params.get("content"):
            body["children"] = _text_to_blocks(str(params["content"]))
        r = await request_with_rate_limit(
            client, "POST", f"{_BASE}/pages", headers=headers, json=body
        )
        _raise_for_status(r, "create_page")
        try:
            result = r.json()
        except Exception as e:
            raise ConnectorError("NOTION_PARSE_ERROR", f"create_page returned non-JSON response: {r.text[:200]}") from e
        return {"page_id": result.get("id"), "url": result.get("url")}

    async def _append_to_page(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        page_id = params.get("page_id")
        content = params.get("content", "")
        if not page_id:
            raise ConnectorError("MISSING_PARAM", "append_to_page requires 'page_id'")
        blocks = (
            params["blocks"]
            if isinstance(params.get("blocks"), list)
            else _text_to_blocks(str(content))
        )
        r = await request_with_rate_limit(
            client,
            "PATCH",
            f"{_BASE}/blocks/{page_id}/children",
            headers=headers,
            json={"children": blocks},
        )
        _raise_for_status(r, "append_to_page")
        return {"page_id": page_id, "appended_blocks": len(blocks)}

    async def _query_database(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        database_id = params.get("database_id")
        if not database_id:
            raise ConnectorError("MISSING_PARAM", "query_database requires 'database_id'")
        body: dict[str, Any] = {}
        if params.get("filter"):
            body["filter"] = params["filter"]
        if params.get("sorts"):
            body["sorts"] = params["sorts"]
        if params.get("page_size"):
            body["page_size"] = int(params["page_size"])
        r = await request_with_rate_limit(
            client,
            "POST",
            f"{_BASE}/databases/{database_id}/query",
            headers=headers,
            json=body,
        )
        _raise_for_status(r, "query_database")
        data = r.json()
        return {"results": data.get("results", []), "has_more": data.get("has_more", False)}

    async def _create_database(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        """Create a new Notion database as a child of a given page.

        Required params:
          - parent_page_id: ID or URL of the parent page
        Optional params:
          - title: Database title (default: "Untitled Database")
          - properties: dict of additional Notion property definitions to include
        """
        raw_parent = params.get("parent_page_id")
        if not raw_parent:
            raise ConnectorError("MISSING_PARAM", "create_database requires 'parent_page_id'")
        parent_id = _extract_database_id(str(raw_parent))
        title = params.get("title", "Untitled Database")
        extra_properties: dict[str, Any] = params.get("properties", {})

        # Every Notion DB must have at least a Name (title) property
        properties: dict[str, Any] = {
            "Name": {"title": {}},
            **extra_properties,
        }

        body: dict[str, Any] = {
            "parent": {"type": "page_id", "page_id": parent_id},
            "title": [{"type": "text", "text": {"content": str(title)[:_NOTION_TEXT_LIMIT]}}],
            "properties": properties,
        }
        r = await request_with_rate_limit(
            client, "POST", f"{_BASE}/databases", headers=headers, json=body
        )
        _raise_for_status(r, "create_database")
        try:
            result = r.json()
        except Exception as e:
            raise ConnectorError("NOTION_PARSE_ERROR", f"create_database returned non-JSON response: {r.text[:200]}") from e
        return {
            "database_id": result.get("id"),
            "url": result.get("url"),
            "title": title,
        }

    async def _fetch_database_schema(
        self, client: httpx.AsyncClient, headers: dict, database_id: str
    ) -> dict[str, Any]:
        """Fetch the database schema and return its properties dict."""
        r = await request_with_rate_limit(
            client, "GET", f"{_BASE}/databases/{database_id}", headers=headers
        )
        _raise_for_status(r, "create_database_entry")
        try:
            return r.json().get("properties", {})
        except Exception:
            return {}

    async def _find_or_create_database(
        self, client: httpx.AsyncClient, headers: dict, name: str
    ) -> str:
        """Find a Notion database by name or create it automatically.

        1. Search for a database matching `name` (exact title match preferred).
        2. If not found, find the first accessible page and create the database there.
        Returns the database UUID.
        """
        # Step 1: Search for existing database
        r = await request_with_rate_limit(
            client,
            "POST",
            f"{_BASE}/search",
            headers=headers,
            json={"query": name, "filter": {"value": "database", "property": "object"}},
        )
        _raise_for_status(r, "search_database")
        results = r.json().get("results", [])
        name_lower = name.lower().strip()
        for db in results:
            titles = db.get("title", [])
            db_title = "".join(t.get("plain_text", "") for t in titles).lower().strip()
            if db_title == name_lower:
                print(f"[notion] found existing database '{name}' -> {db['id']}", flush=True)
                return db["id"]

        # Step 2: Not found — find first accessible page to use as parent
        print(f"[notion] database '{name}' not found, creating it automatically", flush=True)
        r2 = await request_with_rate_limit(
            client,
            "POST",
            f"{_BASE}/search",
            headers=headers,
            json={"filter": {"value": "page", "property": "object"}, "page_size": 1},
        )
        _raise_for_status(r2, "search_parent_page")
        pages = r2.json().get("results", [])
        if not pages:
            raise ConnectorError(
                "NO_ACCESSIBLE_PAGE",
                f"Cannot create database '{name}': no Notion pages are shared with the Nexflow integration. "
                "Share at least one page with the integration so it can create the database automatically.",
            )
        parent_id = pages[0]["id"]
        print(f"[notion] creating database '{name}' under page {parent_id}", flush=True)

        # Step 3: Create the database
        body: dict[str, Any] = {
            "parent": {"type": "page_id", "page_id": parent_id},
            "title": [{"type": "text", "text": {"content": name[:_NOTION_TEXT_LIMIT]}}],
            "properties": {"Name": {"title": {}}},
        }
        r3 = await request_with_rate_limit(
            client, "POST", f"{_BASE}/databases", headers=headers, json=body
        )
        _raise_for_status(r3, "create_database")
        db_id = r3.json().get("id")
        print(f"[notion] created database '{name}' -> {db_id}", flush=True)
        return db_id

    async def _create_database_entry(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        raw_id = params.get("database_id")
        if not raw_id:
            raise ConnectorError("MISSING_PARAM", "create_database_entry requires 'database_id'")
        # If unset sentinel, fall back to a sensible default name
        raw_str = str(raw_id).strip()
        if raw_str == "__USER_ASSIGNED__" or not raw_str:
            raw_str = "Nexflow Tasks"
        # If it looks like a name (not a UUID or URL), find or create automatically
        if raw_str.startswith("http") or _UUID_RE.fullmatch(raw_str) or _HEX32_RE.fullmatch(raw_str):
            database_id = _extract_database_id(raw_str)
        else:
            database_id = await self._find_or_create_database(client, headers, raw_str)

        # Support two calling conventions:
        # 1. Flat top-level _title/_body/... keys (new genesis convention)
        # 2. Nested "properties" dict (explicit Notion API format)
        top_level_simple = {k: v for k, v in params.items()
                            if k.startswith("_") and k != "_"}
        raw_properties = params.get("properties", {})

        # Merge: top-level simple keys take precedence
        all_simple_keys = top_level_simple or {k: v for k, v in raw_properties.items() if k.startswith("_")}
        has_simple = bool(all_simple_keys)

        db_schema = await self._fetch_database_schema(client, headers, database_id)
        print(f"[notion] db_schema keys: {list(db_schema.keys())}", flush=True)
        print(f"[notion] has_simple={has_simple} raw_properties keys={list(raw_properties.keys())}", flush=True)

        if has_simple:
            # Combine simple keys from both sources, non-simple from raw_properties
            merged_simple = {**{k: v for k, v in raw_properties.items() if k.startswith("_")}, **top_level_simple}
            non_simple = {k: v for k, v in raw_properties.items() if not k.startswith("_")}
            properties = {**_map_simple_fields(merged_simple, db_schema), **non_simple}
        else:
            # Explicit Notion-format properties — validate names against live schema,
            # remapping by case-insensitive match or type when names don't exist.
            properties = _remap_explicit_properties(raw_properties, db_schema)

        body = {
            "parent": {"database_id": database_id},
            "properties": properties,
        }
        # Apply Notion's 2000-char limit to ALL rich_text content recursively
        body = _truncate_rich_text(body)
        r = await request_with_rate_limit(
            client, "POST", f"{_BASE}/pages", headers=headers, json=body
        )
        _raise_for_status(r, "create_database_entry")
        try:
            result = r.json()
        except Exception as e:
            raise ConnectorError("NOTION_PARSE_ERROR", f"create_database_entry returned non-JSON response: {r.text[:200]}") from e
        return {"page_id": result.get("id"), "url": result.get("url")}


# ─── URL / ID helpers ────────────────────────────────────────────────────────

_UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)
_HEX32_RE = re.compile(r"[0-9a-f]{32}", re.IGNORECASE)


def _extract_database_id(value: str) -> str:
    """Return the Notion database/page UUID (with hyphens) from a URL or raw ID.

    Accepts:
      - Raw UUID with hyphens: "33fac82c-a3d4-80ca-95cd-f8b2ef72b2af"
      - Raw 32-char hex ID:   "33fac82ca3d480ca95cdf8b2ef72b2af"
      - Notion page URL:      "https://notion.so/workspace/Title-33fac82c...?v=..."
    Always returns UUID format with hyphens (Notion API requirement).
    """
    # Already a hyphenated UUID — return as-is
    if _UUID_RE.fullmatch(value.strip()):
        return value.strip()

    if value.startswith("http"):
        # Prefer hyphenated UUID found in the URL
        m = _UUID_RE.search(value)
        if m:
            return m.group(0)
        # Fallback: 32-char hex block (Notion IDs without hyphens in URLs)
        m = _HEX32_RE.search(value)
        if m:
            return _hex32_to_uuid(m.group(0))
        # Can't extract — return original and let the API surface the error
        return value

    # Plain 32-char hex without hyphens
    if _HEX32_RE.fullmatch(value.strip()):
        return _hex32_to_uuid(value.strip())

    return value


def _hex32_to_uuid(hex_id: str) -> str:
    """Format a 32-char hex string as a hyphenated UUID."""
    h = hex_id.lower()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


# ─── Simple field mapping ─────────────────────────────────────────────────────

def _map_simple_fields(
    simple: dict[str, Any],
    db_schema: dict[str, Any],
) -> dict[str, Any]:
    """Map _-prefixed simple fields to actual Notion property objects.

    Convention:
      "_title"   → the database's title property (every DB has exactly one)
      "_body"    → first rich_text property in the schema
      "_status"  → first status property
      "_select"  → first select property
      "_date"    → first date property
      Any other "_key" → tries to find a property whose name matches "key" (case-insensitive),
                         then falls back to the first writable text property available.

    Non-prefixed keys are passed through as-is (explicit Notion API format).
    """
    # Index schema by type and by normalised name
    by_type: dict[str, list[str]] = {}  # type → [prop_name, ...]
    by_name: dict[str, str] = {}        # lower(name) → actual_name
    for prop_name, prop_def in db_schema.items():
        prop_type = prop_def.get("type", "")
        by_type.setdefault(prop_type, []).append(prop_name)
        by_name[prop_name.lower()] = prop_name

    def first_of(*types: str) -> str | None:
        for t in types:
            if by_type.get(t):
                return by_type[t][0]
        return None

    result: dict[str, Any] = {}

    for key, value in simple.items():
        if not key.startswith("_"):
            result[key] = value
            continue

        field = key[1:]  # strip leading _
        text = str(value)[:_NOTION_TEXT_LIMIT]

        if field == "title":
            target = first_of("title")
            if target:
                result[target] = {"title": [{"text": {"content": text}}]}

        elif field == "body":
            target = first_of("rich_text")
            if target:
                result[target] = {"rich_text": [{"text": {"content": text}}]}

        elif field == "status":
            target = first_of("status")
            if target:
                result[target] = {"status": {"name": text}}

        elif field == "select":
            target = first_of("select")
            if target:
                result[target] = {"select": {"name": text}}

        elif field == "date":
            target = first_of("date")
            if target:
                result[target] = {"date": {"start": text}}

        else:
            # Try name match first, then fall back to first available text column
            actual = by_name.get(field.lower()) or by_name.get(field)
            if actual:
                prop_type = db_schema[actual].get("type", "rich_text")
                result[actual] = _format_property(prop_type, text)
            else:
                # Best-effort: dump into first rich_text column
                fallback = first_of("rich_text")
                if fallback and fallback not in result:
                    result[fallback] = {"rich_text": [{"text": {"content": text}}]}

    return result


def _remap_explicit_properties(
    explicit: dict[str, Any],
    db_schema: dict[str, Any],
) -> dict[str, Any]:
    """Validate explicit Notion property objects against the live schema.

    Resolution order per property:
      1. Exact name match → keep as-is
      2. Case-insensitive name match → rename to actual schema name
      3. No name match → place into first unused schema property of matching type
      4. Still no match → skip (prevents Notion 400 for unknown property names)
    """
    by_name_lower = {name.lower(): name for name in db_schema}
    # Group schema props by type for fallback assignment
    by_type: dict[str, list[str]] = {}
    for name, defn in db_schema.items():
        by_type.setdefault(defn.get("type", ""), []).append(name)

    result: dict[str, Any] = {}

    for prop_name, prop_value in explicit.items():
        # 1. Exact match
        if prop_name in db_schema:
            result[prop_name] = prop_value
            continue
        # 2. Case-insensitive match
        actual = by_name_lower.get(prop_name.lower())
        if actual:
            result[actual] = prop_value
            continue
        # 3. Type-based fallback
        inferred = _infer_notion_type(prop_value)
        if inferred:
            for candidate in by_type.get(inferred, []):
                if candidate not in result:
                    result[candidate] = prop_value
                    break
        # 4. No match → skip silently

    return result


def _infer_notion_type(value: Any) -> str | None:
    """Infer the Notion property type from an explicit property value object."""
    if not isinstance(value, dict):
        return None
    for t in ("title", "rich_text", "select", "status", "date", "number", "checkbox", "url", "email", "phone_number"):
        if t in value:
            return t
    return None


def _format_property(prop_type: str, text: str) -> Any:
    """Wrap a plain string in the correct Notion property value shape."""
    if prop_type == "title":
        return {"title": [{"text": {"content": text}}]}
    if prop_type == "rich_text":
        return {"rich_text": [{"text": {"content": text}}]}
    if prop_type == "select":
        return {"select": {"name": text}}
    if prop_type == "status":
        return {"status": {"name": text}}
    if prop_type == "date":
        return {"date": {"start": text}}
    if prop_type == "number":
        try:
            return {"number": float(text)}
        except ValueError:
            return {"number": None}
    if prop_type == "checkbox":
        return {"checkbox": text.lower() in ("true", "1", "yes")}
    # Default fallback
    return {"rich_text": [{"text": {"content": text}}]}


# ─── Utilities ────────────────────────────────────────────────────────────────

def _truncate_rich_text(obj: Any) -> Any:
    """Recursively truncate any text.content string to Notion's 2000-char limit."""
    if isinstance(obj, dict):
        if "content" in obj and isinstance(obj["content"], str):
            if len(obj["content"]) > _NOTION_TEXT_LIMIT:
                obj = {**obj, "content": obj["content"][:_NOTION_TEXT_LIMIT]}
        return {k: _truncate_rich_text(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_truncate_rich_text(item) for item in obj]
    return obj


def _raise_for_status(r: httpx.Response, operation: str) -> None:
    if r.status_code == 401:
        raise ConnectorError(
            "TOKEN_EXPIRED",
            f"Notion {operation} failed: OAuth access token is invalid or expired",
        )
    if r.status_code >= 400:
        raise ConnectorError(
            "NOTION_API_ERROR",
            f"Notion {operation} failed ({r.status_code}): {r.text[:300]}",
        )


def _text_to_blocks(text: str) -> list[dict]:
    """Convert plain text into Notion paragraph blocks, one per line."""
    blocks = []
    for line in text.split("\n"):
        blocks.append({
            "object": "block",
            "type": "paragraph",
            "paragraph": {
                "rich_text": [{"type": "text", "text": {"content": line[:_NOTION_TEXT_LIMIT]}}]
            },
        })
    return blocks
