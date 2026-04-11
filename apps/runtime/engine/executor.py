from __future__ import annotations

import asyncio
import json
import os
import re
import time
from urllib.parse import urlsplit
from typing import Any, Callable

import httpx
from langgraph.graph import StateGraph
from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI

from schema import (
    AgentConfig,
    HttpConnectionConfig,
    OAuthConnectionConfig,
    ProgramSchema,
    RetryConfig,
    SchemaNode,
    StepConfig,
)
from connectors import get_connector
from connectors.base import ConnectorError
from db import (
    acquire_resource_lock,
    cleanup_stale_locks,
    create_approval,
    create_node_execution,
    get_credential,
    get_db,
    get_existing_lock,
    get_run_status,
    release_run_locks,
    update_node_execution,
    update_run,
)


def _resolve_path(expr: str, data: Any) -> Any:
    """Walk a dot-separated path with optional array indices like emails[0].id."""
    parts = re.split(r"\.", expr)
    val = data
    for part in parts:
        arr_match = re.match(r"^(\w+)\[(\d+)\]$", part)
        if arr_match:
            key, idx = arr_match.group(1), int(arr_match.group(2))
            if isinstance(val, dict):
                val = val.get(key)
            if isinstance(val, list):
                val = val[idx] if idx < len(val) else None
            else:
                return None
        elif isinstance(val, dict):
            val = val.get(part)
        else:
            return None
    return val


_PURE_EXPR = re.compile(r"^\{\{([^}]+)\}\}$")


def _resolve_expression_raw(template: str, inputs: dict) -> Any:
    """Like _resolve_expressions but preserves the native type of the resolved value.

    If the entire template is a single {{expr}}, the raw resolved value is returned
    (could be dict, list, int, etc.).  If it's a mixed string like "id={{expr}}", the
    result is always a string (same as _resolve_expressions).
    """
    pure = _PURE_EXPR.match(template)
    if pure:
        result = _resolve_path(pure.group(1).strip(), inputs)
        return result  # None, str, int, dict, list — caller decides
    return _resolve_expressions(template, inputs)


def _resolve_expressions(template: str, inputs: dict) -> str:
    """Replace {{key}} and {{node_id.field[0].sub}} expressions with values from inputs.
    Unresolved expressions resolve to empty string — never to the raw template literal.
    """
    def replacer(match: re.Match) -> str:
        expr = match.group(1).strip()
        result = _resolve_path(expr, inputs)
        if result is None:
            return ""
        if isinstance(result, (dict, list)):
            return json.dumps(result)
        return str(result)
    return re.sub(r"\{\{([^}]+)\}\}", replacer, template)


def _resolve_nested(value: Any, inputs: dict) -> Any:
    """Recursively resolve {{expressions}} inside nested dicts and lists."""
    if isinstance(value, str):
        return _resolve_expressions(value, inputs)
    if isinstance(value, dict):
        return {k: _resolve_nested(v, inputs) for k, v in value.items()}
    if isinstance(value, list):
        return [_resolve_nested(item, inputs) for item in value]
    return value


async def run_agent(config: dict, inputs: dict, credentials: Any) -> dict:
    model = config.get("model", "claude")
    api_key = credentials if isinstance(credentials, str) else (credentials or {}).get("value", "")

    if "claude" in str(model) or model == "claude":
        llm = ChatAnthropic(model="claude-opus-4-5-20251001", api_key=api_key or None)
    else:
        llm = ChatOpenAI(model="gpt-4", api_key=api_key or None)

    def agent_node(state: dict) -> dict:
        prompt = _resolve_expressions(config.get("prompt", config.get("system_prompt", "")), inputs)
        response = llm.invoke(prompt)
        output_field = config.get("outputField", "output")
        return {output_field: response.content}

    graph = StateGraph(dict)
    graph.add_node("agent", agent_node)
    graph.set_entry_point("agent")
    graph.set_finish_point("agent")
    result = await graph.compile().ainvoke({})
    return result


class ExecutionError(Exception):
    def __init__(self, code: str, message: str, node_id: str | None = None) -> None:
        self.code = code
        self.message = message
        self.node_id = node_id
        super().__init__(message)


class CancellationError(ExecutionError):
    def __init__(self) -> None:
        super().__init__("CANCELLED", "Run was cancelled", None)


class ConflictError(ExecutionError):
    def __init__(self, resource_id: str) -> None:
        super().__init__(
            "RESOURCE_CONFLICT",
            f"Resource {resource_id} is locked by another run",
            None,
        )


class ProgramExecutor:
    def __init__(
        self,
        schema: ProgramSchema,
        run_id: str,
        user_id: str,
        execution_mode: str = "autonomous",
        conflict_policy: str = "queue",
        connection_name_to_id: dict[str, str] | None = None,
    ) -> None:
        self.schema = schema
        self.run_id = run_id
        self.user_id = user_id
        self.execution_mode = execution_mode
        self.conflict_policy = conflict_policy
        self.db = get_db()
        self.node_map: dict[str, SchemaNode] = {n.id: n for n in schema.nodes}
        self.edges_from: dict[str, list] = {}
        for edge in schema.edges:
            self.edges_from.setdefault(edge.from_node, []).append(edge)
        # Maps connection name → UUID. Populated from the run request; falls back to DB lookup.
        self._connection_name_to_id: dict[str, str] = dict(connection_name_to_id or {})

    async def execute(self, trigger_payload: dict | None = None) -> dict[str, Any]:
        """Run the program. Returns final state."""
        # Clean up stale locks before starting
        await cleanup_stale_locks(self.db)

        # Check for resource conflicts on all write-access connections used by this program
        await self._acquire_program_locks()

        # Find trigger node
        trigger_node = next((n for n in self.schema.nodes if n.type == "trigger"), None)
        if not trigger_node:
            raise ExecutionError("NO_TRIGGER", "Program has no trigger node")

        # Build initial state: each node_id maps to its output (None = not yet run)
        state: dict[str, Any] = {n.id: None for n in self.schema.nodes}
        state[trigger_node.id] = trigger_payload or {}

        # Create node_execution rows for all nodes
        for node in self.schema.nodes:
            await create_node_execution(self.db, self.run_id, node.id)

        # Update trigger node to completed immediately
        await update_node_execution(
            self.db,
            self.run_id,
            trigger_node.id,
            status="completed",
            started_at="now()",
            completed_at="now()",
            output_payload=state[trigger_node.id],
        )

        # Topological execution
        visited: set[str] = {trigger_node.id}
        queue: list[str] = [trigger_node.id]

        while queue:
            # Cancellation check on each iteration
            current_status = await get_run_status(self.db, self.run_id)
            if current_status == "cancelled":
                raise CancellationError()

            current_id = queue.pop(0)
            outgoing = self.edges_from.get(current_id, [])

            for edge in outgoing:
                target_node = self.node_map.get(edge.to)
                if not target_node or edge.to in visited:
                    continue

                # Resolve input via data mapping
                input_data = self._resolve_input(edge.to, state)

                # Execute the target node
                try:
                    output = await self._execute_node(target_node, input_data)
                    state[edge.to] = output
                    visited.add(edge.to)

                    # Filter nodes can intentionally halt the branch when the
                    # condition is false. In that case we don't enqueue
                    # downstream nodes.
                    is_filtered_out = (
                        target_node.type == "step"
                        and isinstance(target_node.config, StepConfig)
                        and target_node.config.logic_type == "filter"
                        and isinstance(output, dict)
                        and output.get("__filtered_out__") is True
                    )
                    if is_filtered_out:
                        skipped = await self._skip_descendants_from(edge.to)
                        visited.update(skipped)
                        for skipped_node_id in skipped:
                            state[skipped_node_id] = {"__skipped__": True}
                        continue

                    # If this is a loop step, expand it: run all downstream nodes once
                    # per item instead of once with the whole list.
                    if isinstance(output, dict) and "__loop_items__" in output:
                        body_visited = await self._execute_loop_body(
                            edge.to, output, state
                        )
                        visited.update(body_visited)
                        # Don't push loop body nodes onto the main queue — they're done.
                    else:
                        queue.append(edge.to)
                except CancellationError:
                    raise
                except ExecutionError as e:
                    await update_node_execution(
                        self.db,
                        self.run_id,
                        edge.to,
                        status="failed",
                        error_message=e.message,
                        completed_at="now()",
                    )
                    if target_node.type == "agent":
                        agent_cfg = target_node.config
                        if (
                            isinstance(agent_cfg, AgentConfig)
                            and agent_cfg.retry.fail_program_on_exhaust
                        ):
                            raise
                    visited.add(edge.to)  # Mark failed nodes as visited to continue

        return state

    async def _skip_descendants_from(self, node_id: str) -> set[str]:
        """Mark all descendants of a node as skipped for this run.

        Used when a filter node intentionally short-circuits a branch. Without
        this, untouched descendants stay "pending" in the UI even though the run
        has completed.
        """
        descendants: set[str] = set()
        frontier = [e.to for e in self.edges_from.get(node_id, [])]

        while frontier:
            nid = frontier.pop()
            if nid in descendants:
                continue
            descendants.add(nid)
            frontier.extend(e.to for e in self.edges_from.get(nid, []))

        for nid in descendants:
            await update_node_execution(
                self.db,
                self.run_id,
                nid,
                status="skipped",
                completed_at="now()",
            )

        return descendants

    async def _execute_loop_body(
        self, loop_node_id: str, loop_output: dict, state: dict
    ) -> set[str]:
        """Execute all nodes downstream of a loop node once per item.

        Returns the set of node IDs that were executed (so the main BFS can skip them).
        Results are stored in state as {"iterations": [...], "count": N} so downstream
        nodes (after the loop) can reference aggregated outputs.
        """
        items: list = loop_output.get("__loop_items__", [])
        item_var: str = loop_output.get("item_var", "item")

        # Collect all node IDs that are reachable from the loop node (the loop body)
        body_ids: set[str] = set()
        frontier = [e.to for e in self.edges_from.get(loop_node_id, [])]
        while frontier:
            nid = frontier.pop()
            if nid in body_ids:
                continue
            body_ids.add(nid)
            frontier.extend(e.to for e in self.edges_from.get(nid, []))

        # Topological order for body nodes — Kahn's algorithm (BFS with in-degree).
        # DFS post-order is unreliable for parallel branches: n4→n5 and n4→n6→n7
        # gives [n6, n7, n5] with DFS, but must be [n5, n6, n7] or [n6, n5, n7].
        in_degree: dict[str, int] = {nid: 0 for nid in body_ids}
        for nid in body_ids:
            for e in self.edges_from.get(nid, []):
                if e.to in body_ids:
                    in_degree[e.to] += 1
        kahn_queue = [nid for nid in body_ids if in_degree[nid] == 0]
        body_order: list[str] = []
        while kahn_queue:
            nid = kahn_queue.pop(0)
            body_order.append(nid)
            for e in self.edges_from.get(nid, []):
                if e.to in body_ids:
                    in_degree[e.to] -= 1
                    if in_degree[e.to] == 0:
                        kahn_queue.append(e.to)

        # Per-node aggregated results across iterations
        iteration_results: dict[str, list] = {nid: [] for nid in body_ids}

        for idx, item in enumerate(items):
            print(f"[executor] loop {loop_node_id} — item {idx + 1}/{len(items)}", flush=True)
            # Build a local state snapshot: inherit current state, inject the loop item
            local_state = dict(state)
            local_state[loop_node_id] = {
                **loop_output,
                item_var: item,        # {{loop_node_id.item_var.*}}
                "current_item": item,  # {{loop_node_id.current_item.*}}
                "index": idx,
            }

            for nid in body_order:
                node = self.node_map.get(nid)
                if not node:
                    continue

                current_status = await get_run_status(self.db, self.run_id)
                if current_status == "cancelled":
                    raise CancellationError()

                # _resolve_input already handles everything:
                # - flat merge from direct edges ({{field}})
                # - every executed node by ID ({{node_id.field}})
                # local_state has the current loop item in local_state[loop_node_id]
                # and each body node's output as it completes, so all expressions
                # resolve correctly for any schema topology.
                body_input = self._resolve_input(nid, local_state)
                try:
                    out = await self._execute_node(node, body_input)
                except ExecutionError as e:
                    await update_node_execution(
                        self.db, self.run_id, nid,
                        status="failed", error_message=e.message, completed_at="now()",
                    )
                    out = {}
                local_state[nid] = out
                iteration_results[nid].append(out)

        # Write aggregated results back to the shared state
        for nid, results in iteration_results.items():
            state[nid] = {"iterations": results, "count": len(items)}
            # Update the DB record to reflect the final aggregated output
            await update_node_execution(
                self.db, self.run_id, nid,
                status="completed",
                completed_at="now()",
                output_payload={"iterations": results, "count": len(items)},
            )

        return body_ids

    def _resolve_input(self, node_id: str, state: dict[str, Any]) -> dict:
        """Build the input dict for a node.

        Two layers, both always present:

        1. Flat merge from direct upstream edges — {{field}} expressions work.
           If the edge has a data_mapping, only the mapped fields are included.

        2. Every already-executed node exposed by its ID — {{node_id.field}}
           expressions always work regardless of edge topology.
           This is the architectural contract: genesis-generated schemas use
           {{node_id.field}} and that must resolve for any downstream node,
           not just nodes with a direct incoming edge from the source.
        """
        incoming = [e for e in self.schema.edges if e.to == node_id]
        resolved: dict[str, Any] = {}

        # Layer 1: flat merge from direct upstream edges
        for edge in incoming:
            upstream = state.get(edge.from_node) or {}
            if not edge.data_mapping:
                resolved.update(upstream)
            else:
                for src_field, tgt_field in edge.data_mapping.items():
                    value = upstream.get(src_field)
                    if value is not None:
                        resolved[tgt_field] = value

        # Layer 2: every node that has already produced output, keyed by node ID.
        # This makes {{n2.emails}}, {{n5.message_id}}, {{n4.email.id}} etc. work
        # universally — no special-casing needed anywhere else in the executor.
        for nid, output in state.items():
            if output is not None and nid not in resolved:
                resolved[nid] = output

        return resolved

    async def _execute_node(self, node: SchemaNode, input_data: dict) -> dict:
        # input_data includes full state keyed by node ID (for expression resolution),
        # but logging the entire state to the DB causes oversized payloads and
        # httpx [Errno 22] on Windows. Log only the "real" input fields — strip
        # the node-ID keys that were added by _resolve_input layer 2.
        log_input = {k: v for k, v in input_data.items() if k not in self.node_map}
        await update_node_execution(
            self.db,
            self.run_id,
            node.id,
            status="running",
            started_at="now()",
            input_payload=log_input,
        )

        # In manual mode: pause each node and wait for step-through approval
        if self.execution_mode == "manual" and node.type != "trigger":
            approved = await self._request_step_approval(node, input_data, "Manual step-through")
            if not approved:
                await update_node_execution(
                    self.db, self.run_id, node.id, status="skipped", completed_at="now()"
                )
                return {}

        try:
            if node.type == "agent":
                output = await self._execute_agent(node, input_data)
            elif node.type.startswith("agent"):
                cfg = node.config
                api_key_ref = getattr(cfg, "api_key_ref", None)
                credentials = None
                if api_key_ref and api_key_ref != "__USER_ASSIGNED__":
                    credentials = await get_credential(api_key_ref, self.user_id)
                output = await run_agent(
                    cfg.__dict__ if hasattr(cfg, "__dict__") else {},
                    input_data,
                    credentials,
                )
            elif node.type == "step":
                output = await self._execute_step(node, input_data)
            elif node.type == "connection":
                output = await self._execute_connection(node, input_data)
            else:
                output = input_data  # trigger: pass through

            await update_node_execution(
                self.db,
                self.run_id,
                node.id,
                status="completed",
                completed_at="now()",
                output_payload=output,
            )
            return output
        except ExecutionError:
            raise
        except Exception as e:
            raise ExecutionError("NODE_FAILED", str(e), node.id) from e

    async def _execute_agent(self, node: SchemaNode, input_data: dict) -> dict:
        cfg: AgentConfig = node.config  # type: ignore[assignment]

        # Supervised mode: every agent needs approval regardless of node config
        needs_approval = cfg.requires_approval or self.execution_mode == "supervised"

        if needs_approval:
            approved = await self._request_step_approval(node, input_data, "Agent approval required")
            if not approved:
                await update_node_execution(
                    self.db, self.run_id, node.id, status="skipped", completed_at="now()"
                )
                return {}

        # Fetch API key from Next.js internal endpoint (keeps key off this service)
        api_key, provider = await self._fetch_api_key(cfg.api_key_ref)

        # Execute with retry
        return await self._with_retry(
            lambda: self._call_llm(cfg, api_key, provider, input_data),
            cfg.retry,
            node.id,
        )

    async def _call_llm(self, cfg: AgentConfig, api_key: str, provider: str, input_data: dict) -> dict:
        """Call the LLM via LiteLLM-compatible API."""
        if not api_key:
            raise ExecutionError("API_KEY_MISSING", f"No API key available for provider '{provider}' — check your key configuration")
        litellm_url = os.environ.get("LITELLM_URL")

        PROVIDER_URLS: dict[str, str] = {
            "groq":       "https://api.groq.com/openai/v1",
            "google":     "https://generativelanguage.googleapis.com/v1beta/openai",
            "openrouter": "https://openrouter.ai/api/v1",
            "openai":     "https://api.openai.com/v1",
            "anthropic":  "https://api.anthropic.com/v1",
        }

        if litellm_url:
            base_url = litellm_url
        elif "claude" in cfg.model or provider == "anthropic":
            base_url = "https://api.anthropic.com/v1"
        elif provider in PROVIDER_URLS:
            base_url = PROVIDER_URLS[provider]
        elif "/" in cfg.model:
            # OpenRouter-style provider/model format
            base_url = "https://openrouter.ai/api/v1"
        else:
            base_url = "https://api.openai.com/v1"

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        content: str
        if "anthropic" in base_url and (litellm_url is None or "litellm" not in base_url):
            # Anthropic uses x-api-key, not Bearer
            headers.pop("Authorization", None)
            headers["x-api-key"] = api_key
            headers["anthropic-version"] = "2023-06-01"
            body: dict = {
                "model": cfg.model,
                "max_tokens": 4096,
                "messages": [
                    {"role": "user", "content": json.dumps(input_data)}
                ],
            }
            # Anthropic rejects empty/None system prompts — only include if non-empty
            if cfg.system_prompt and cfg.system_prompt.strip():
                body["system"] = cfg.system_prompt
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    f"{base_url}/messages",
                    headers=headers,
                    json=body,
                )
                print(f"[LLM/anthropic] {resp.status_code} model={cfg.model} body={resp.text[:800]}", flush=True)
                if not resp.is_success:
                    raise Exception(
                        f"LLM API error {resp.status_code} from {base_url} "
                        f"(model={cfg.model}): {resp.text[:500]}"
                    )
                try:
                    data = resp.json()
                except Exception as parse_err:
                    raise Exception(f"LLM returned non-JSON response (model={cfg.model}): {resp.text[:300]}") from parse_err
                content_list = data.get("content") or []
                if not content_list:
                    raise Exception(f"LLM returned empty content (model={cfg.model}). Full response: {resp.text[:500]}")
                first = content_list[0]
                if not isinstance(first, dict) or "text" not in first:
                    raise Exception(f"LLM content[0] has unexpected shape (model={cfg.model}): {first}")
                content = first["text"]
        else:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    f"{base_url}/chat/completions",
                    headers=headers,
                    json={
                        "model": cfg.model,
                        "max_tokens": 4096,
                        "messages": [
                            {"role": "system", "content": cfg.system_prompt},
                            {"role": "user", "content": json.dumps(input_data)},
                        ],
                    },
                )
                if not resp.is_success:
                    raise Exception(
                        f"LLM API error {resp.status_code} from {base_url} "
                        f"(model={cfg.model}): {resp.text[:500]}"
                    )
                try:
                    data = resp.json()
                except Exception as parse_err:
                    raise Exception(f"LLM returned non-JSON response (model={cfg.model}): {resp.text[:300]}") from parse_err
                choices = data.get("choices") or []
                if not choices:
                    raise Exception(f"LLM returned no choices (model={cfg.model}). Full response: {resp.text[:500]}")
                message = choices[0].get("message") or {}
                content = message.get("content") or ""
                if content is None:
                    raise Exception(f"LLM message.content is null (model={cfg.model}). Full response: {resp.text[:500]}")

        # Try to parse as JSON, else wrap in text field
        try:
            return json.loads(content)
        except (json.JSONDecodeError, ValueError):
            return {"text": content}

    async def _execute_step(self, node: SchemaNode, input_data: dict) -> dict:
        cfg: StepConfig = node.config  # type: ignore[assignment]
        extra = cfg.extra

        if cfg.logic_type == "transform":
            transformation = extra.get("transformation", "")
            result = _safe_eval_transform(transformation, input_data)
            return result if isinstance(result, dict) else {"result": result}

        elif cfg.logic_type == "filter":
            condition = extra.get("condition", "True")
            passes = _safe_eval_condition(condition, input_data)
            if not passes:
                return {"__filtered_out__": True}
            return input_data

        elif cfg.logic_type == "branch":
            conditions = extra.get("conditions", [])
            for cond in conditions:
                if _safe_eval_condition(cond["condition"], input_data):
                    return {**input_data, "__branch_target__": cond["target_node_id"]}
            default = extra.get("default_branch", "")
            return {**input_data, "__branch_target__": default}

        elif cfg.logic_type == "delay":
            import asyncio as _asyncio
            seconds = float(extra.get("seconds", 0))
            if seconds > 0:
                await _asyncio.sleep(min(seconds, 300))  # cap at 5 min
            return input_data

        elif cfg.logic_type == "loop":
            over_expr = extra.get("over", "input")
            item_var = extra.get("item_var", "item")
            items = _safe_eval_transform(over_expr, input_data)
            if not isinstance(items, list):
                items = list(items) if hasattr(items, "__iter__") else [items]
            return {"items": items, "item_var": item_var, "__loop_items__": items}

        elif cfg.logic_type == "format":
            template: str = extra.get("template", "")
            output_key: str = extra.get("output_key", "text")
            try:
                result = template.format_map(input_data)
            except KeyError as e:
                raise ExecutionError(
                    "FORMAT_KEY_MISSING",
                    f"Format template references key {e} which is not present in input. Available keys: {list(input_data.keys())}",
                )
            except ValueError as e:
                raise ExecutionError("FORMAT_ERROR", f"Format template is invalid: {e}")
            return {**input_data, output_key: result}

        elif cfg.logic_type == "parse":
            import csv as _csv
            import io as _io
            input_key: str = extra.get("input_key", "text")
            fmt: str = extra.get("format", "json")
            raw = input_data.get(input_key, "")
            if fmt == "json":
                import json as _json
                try:
                    parsed = _json.loads(raw) if isinstance(raw, str) else raw
                except Exception as e:
                    raise ExecutionError(
                        "PARSE_JSON_FAILED",
                        f"Failed to parse JSON from key '{input_key}': {e}. Raw value (first 200 chars): {str(raw)[:200]}",
                    )
            elif fmt == "csv":
                try:
                    reader = _csv.DictReader(_io.StringIO(str(raw)))
                    parsed = list(reader)
                except Exception as e:
                    raise ExecutionError("PARSE_CSV_FAILED", f"Failed to parse CSV from key '{input_key}': {e}")
            elif fmt == "lines":
                parsed = [line for line in str(raw).splitlines() if line.strip()]
            else:
                parsed = raw
            return {**input_data, "parsed": parsed}

        elif cfg.logic_type == "deduplicate":
            key: str = extra.get("key", "id")
            items = input_data.get("items", [])
            if not isinstance(items, list):
                return input_data
            seen: set = set()
            deduped = []
            for item in items:
                val = item.get(key) if isinstance(item, dict) else item
                if val not in seen:
                    seen.add(val)
                    deduped.append(item)
            return {**input_data, "items": deduped}

        elif cfg.logic_type == "sort":
            key: str = extra.get("key", "id")
            order: str = extra.get("order", "asc")
            items = input_data.get("items", [])
            if not isinstance(items, list):
                return input_data
            try:
                sorted_items = sorted(
                    items,
                    key=lambda x: x.get(key) if isinstance(x, dict) else x,
                    reverse=(order == "desc"),
                )
            except TypeError as e:
                raise ExecutionError(
                    "SORT_TYPE_ERROR",
                    f"Cannot sort items by key '{key}': {e}. Items may have mixed or non-comparable types.",
                )
            return {**input_data, "items": sorted_items}

        return input_data

    async def _execute_connection(self, node: SchemaNode, input_data: dict) -> dict:
        cfg = node.config
        if isinstance(cfg, HttpConnectionConfig):
            retry_cfg = cfg.retry or RetryConfig(
                max_attempts=1,
                backoff="none",
                backoff_base_seconds=0,
                fail_program_on_exhaust=False,
            )
            return await self._with_retry(
                lambda: self._execute_http_connection(cfg, input_data),
                retry_cfg,
                node.id,
            )
        if isinstance(cfg, OAuthConnectionConfig):
            connection_name = node.connection
            if not connection_name:
                raise ExecutionError("OAUTH_CONFIG_INVALID", "OAuth connection node has no connection reference")
            connection_id = self._resolve_connection_id(connection_name)
            access_token = await self._fetch_oauth_token(connection_id)

            # If the node specifies a native operation, dispatch to the connector.
            if cfg.operation:
                connector = get_connector(self._provider_for_connection(connection_id))
                if connector is None:
                    raise ExecutionError(
                        "CONNECTOR_NOT_FOUND",
                        f"No native connector found for connection '{connection_name}'",
                    )

                # Resolve {{expressions}} in operation_params against upstream input_data
                raw_params = cfg.operation_params or {}
                resolved_params: dict[str, Any] = {}
                for k, v in raw_params.items():
                    if isinstance(v, str):
                        # Use raw resolver so {{expr}} that points to a dict/list keeps
                        # its native type instead of being JSON-serialised to a string.
                        resolved = _resolve_expression_raw(v, input_data)
                        # Pass __USER_ASSIGNED__ through to connectors — they handle fallbacks gracefully
                        # If expression resolved to None/empty and original was a template,
                        # keep None so connectors can give a clear "missing param" error
                        if (resolved is None or resolved == "") and re.search(r"\{\{", v):
                            resolved_params[k] = None
                            print(
                                f"[executor] WARNING: param '{k}' for {cfg.operation} "
                                f"resolved to empty (expression: {v!r}). "
                                f"Upstream data keys: {list(input_data.keys())}",
                                flush=True,
                            )
                        else:
                            resolved_params[k] = resolved
                    elif isinstance(v, (dict, list)):
                        # Recursively resolve nested string values
                        resolved_params[k] = _resolve_nested(v, input_data)
                    else:
                        resolved_params[k] = v

                try:
                    result = await connector.execute(
                        cfg.operation,
                        resolved_params,
                        access_token,
                    )
                except ConnectorError as exc:
                    if exc.code == "TOKEN_EXPIRED":
                        # Cached token was rejected — force-refresh and retry once
                        print(
                            f"[executor] TOKEN_EXPIRED for connection '{connection_name}' "
                            f"— forcing token refresh and retrying",
                            flush=True,
                        )
                        try:
                            access_token = await self._fetch_oauth_token(connection_id, force_refresh=True)
                            result = await connector.execute(cfg.operation, resolved_params, access_token)
                        except ConnectorError as retry_exc:
                            provider = self._provider_for_connection(connection_id)
                            # Mark connection invalid so pre-flight blocks future runs
                            try:
                                self.db.table("connections").update({"is_valid": False}).eq("id", connection_id).execute()
                            except Exception:
                                pass  # best-effort
                            raise ExecutionError(
                                "CONNECTION_AUTH_FAILED",
                                f"OAuth token is invalid for connection '{connection_name}' "
                                f"and could not be refreshed. Please reconnect your {provider} account.",
                            ) from retry_exc
                    else:
                        raise ExecutionError(exc.code, exc.message) from exc
                return {**input_data, **result, "connection_id": connection_id}

            # No operation — surface the token to downstream nodes.
            return {**input_data, "access_token": access_token, "connection_id": connection_id}
        return input_data

    async def _execute_http_connection(
        self,
        cfg: HttpConnectionConfig,
        input_data: dict,
    ) -> dict:
        if not cfg.url.strip():
            raise ExecutionError("HTTP_CONFIG_INVALID", "HTTP connector URL is required")

        method = cfg.method.upper().strip() or "GET"
        params = {
            item.get("key", ""): item.get("value", "")
            for item in cfg.query_params
            if item.get("key", "").strip()
        }
        headers = {
            item.get("key", ""): item.get("value", "")
            for item in cfg.headers
            if item.get("key", "").strip()
        }

        auth: tuple[str, str] | None = None
        if cfg.auth_type == "bearer":
            if not cfg.auth_value:
                raise ExecutionError(
                    "HTTP_CONFIG_INVALID",
                    "Bearer auth selected but auth value is missing",
                )
            headers.setdefault("Authorization", f"Bearer {cfg.auth_value}")
        elif cfg.auth_type == "basic":
            if not cfg.auth_value or ":" not in cfg.auth_value:
                raise ExecutionError(
                    "HTTP_CONFIG_INVALID",
                    "Basic auth requires auth value in username:password format",
                )
            username, password = cfg.auth_value.split(":", 1)
            auth = (username, password)
        elif cfg.auth_type == "api_key_header":
            if not cfg.auth_value:
                raise ExecutionError(
                    "HTTP_CONFIG_INVALID",
                    "API key header auth selected but auth value is missing",
                )
            headers.setdefault("X-API-Key", cfg.auth_value)
        elif cfg.auth_type == "api_key_query":
            if not cfg.auth_value:
                raise ExecutionError(
                    "HTTP_CONFIG_INVALID",
                    "API key query auth selected but auth value is missing",
                )
            params.setdefault("api_key", cfg.auth_value)

        timeout_seconds = cfg.timeout_seconds if cfg.timeout_seconds else 30.0

        request_body = None
        if cfg.body:
            body_text = cfg.body.strip()
            if body_text:
                try:
                    request_body = {"json": json.loads(body_text)}
                except (json.JSONDecodeError, ValueError):
                    request_body = {"content": cfg.body}
        elif method in {"POST", "PUT", "PATCH"} and input_data:
            request_body = {"json": input_data}

        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.request(
                method=method,
                url=cfg.url,
                params=params if params else None,
                headers=headers if headers else None,
                auth=auth,
                **(request_body or {}),
            )

        if response.status_code >= 400:
            body_preview = response.text[:500]
            raise ExecutionError(
                "HTTP_REQUEST_FAILED",
                f"{method} {cfg.url} returned {response.status_code}: {body_preview}",
            )

        if cfg.parse_response:
            try:
                body_output: Any = response.json()
            except (json.JSONDecodeError, ValueError):
                body_output = response.text
        else:
            body_output = response.text

        return {
            "status_code": response.status_code,
            "url": str(response.request.url),
            "headers": dict(response.headers),
            "body": body_output,
        }

    async def _request_step_approval(
        self, node: SchemaNode, input_data: dict, reason: str
    ) -> bool:
        """Insert approval row and poll until resolved (up to timeout)."""
        result = (
            self.db.table("node_executions")
            .select("id")
            .eq("run_id", self.run_id)
            .eq("node_id", node.id)
            .single()
            .execute()
        )
        node_exec_id: str = result.data["id"]

        await update_node_execution(
            self.db, self.run_id, node.id, status="waiting_approval"
        )

        await create_approval(
            self.db,
            node_exec_id,
            self.user_id,
            {
                "node_label": node.label,
                "input": input_data,
                "program_id": self.schema.program_id,
                "reason": reason,
                "execution_mode": self.execution_mode,
            },
        )

        # Determine timeout
        timeout_seconds = 86400  # 24h default for supervised/manual
        if node.type == "agent":
            cfg: AgentConfig = node.config  # type: ignore[assignment]
            if hasattr(cfg, "approval_timeout_hours"):
                timeout_seconds = cfg.approval_timeout_hours * 3600

        deadline = time.time() + timeout_seconds
        poll_interval = 5  # seconds

        while time.time() < deadline:
            # Check for cancellation during approval wait
            current_status = await get_run_status(self.db, self.run_id)
            if current_status == "cancelled":
                raise CancellationError()

            await asyncio.sleep(poll_interval)
            approval = (
                self.db.table("approvals")
                .select("status")
                .eq("node_execution_id", node_exec_id)
                .single()
                .execute()
            )
            status = approval.data.get("status")
            if status == "approved":
                return True
            if status == "rejected":
                return False

        # Timeout — treat as rejected
        return False

    # Keep old method name as alias for backward compat
    async def _request_approval(self, node: SchemaNode, input_data: dict) -> bool:
        return await self._request_step_approval(node, input_data, "Approval required")

    async def _acquire_program_locks(self) -> None:
        """
        Acquire resource locks for all connections used by this program.
        Respects conflict_policy: queue (retry), skip/fail (raise).
        """
        # Fetch connections linked to this program
        result = (
            self.db.table("program_connections")
            .select("connection_id")
            .eq("program_id", self.schema.program_id)
            .execute()
        )
        connection_ids = [row["connection_id"] for row in (result.data or [])]

        for conn_id in connection_ids:
            await self._acquire_one_lock("connection", conn_id)

    async def _acquire_one_lock(self, resource_type: str, resource_id: str) -> None:
        """Try to acquire a single lock. Respects conflict_policy."""
        # Check for existing (non-expired) lock
        existing = await get_existing_lock(self.db, resource_type, resource_id)

        if existing and existing.get("locked_by_run_id") != self.run_id:
            # Locked by another run
            if self.conflict_policy == "skip":
                raise ExecutionError(
                    "CONFLICT_SKIP",
                    f"Resource {resource_id} is locked — policy=skip, run skipped",
                )
            elif self.conflict_policy == "fail":
                raise ConflictError(resource_id)
            else:  # queue: wait up to 5 minutes
                waited = 0
                max_wait = 300  # 5 minutes
                while waited < max_wait:
                    await asyncio.sleep(10)
                    waited += 10
                    # Re-check cancellation while waiting
                    current_status = await get_run_status(self.db, self.run_id)
                    if current_status == "cancelled":
                        raise CancellationError()
                    lock = await get_existing_lock(self.db, resource_type, resource_id)
                    if not lock:
                        break
                else:
                    raise ExecutionError(
                        "LOCK_TIMEOUT",
                        f"Timed out waiting for lock on {resource_id}",
                    )

        # Acquire the lock
        acquired = await acquire_resource_lock(
            self.db, self.run_id, resource_type, resource_id
        )
        if not acquired:
            # Race condition — another run got it first
            if self.conflict_policy == "fail":
                raise ConflictError(resource_id)
            # For queue/skip, we just proceed (best-effort locking for MVP)

    def _resolve_connection_id(self, connection_name: str) -> str:
        """Resolve a connection name (from node.connection) to its UUID.

        Uses the name→id map supplied at construction time; falls back to a DB
        lookup keyed by (user_id, name) for cron-triggered runs where the map
        is not available.
        """
        if conn_id := self._connection_name_to_id.get(connection_name):
            return conn_id
        result = (
            self.db.table("connections")
            .select("id")
            .eq("name", connection_name)
            .eq("user_id", self.user_id)
            .limit(1)
            .execute()
        )
        if not result.data:
            raise ExecutionError(
                "CONNECTION_NOT_FOUND",
                f"Connection '{connection_name}' not found for this user",
            )
        conn_id = str(result.data[0]["id"])
        self._connection_name_to_id[connection_name] = conn_id  # cache
        return conn_id

    def _provider_for_connection(self, connection_id: str) -> str:
        """Look up the provider slug for a connection UUID from the DB."""
        result = (
            self.db.table("connections")
            .select("provider")
            .eq("id", connection_id)
            .single()
            .execute()
        )
        if not result.data:
            raise ExecutionError("CONNECTION_NOT_FOUND", f"Connection {connection_id} not found")
        return str(result.data["provider"])

    async def _fetch_oauth_token(self, connection_id: str, force_refresh: bool = False) -> str:
        """Fetch a valid (auto-refreshed) OAuth access token from Next.js."""
        secret = os.environ["RUNTIME_SECRET"]
        params = {"force_refresh": "true"} if force_refresh else {}
        endpoint_path = f"/api/internal/connections/{connection_id}/token"
        endpoint_urls = self._nextjs_endpoint_candidates(endpoint_path)
        attempt_errors: list[str] = []
        async with httpx.AsyncClient(timeout=15) as client:
            for idx, endpoint_url in enumerate(endpoint_urls):
                resp = await client.get(
                    endpoint_url,
                    headers={"x-runtime-secret": secret},
                    params=params if params else None,
                )
                if resp.is_success:
                    try:
                        data = resp.json()
                    except Exception as e:
                        raise ExecutionError(
                            "OAUTH_TOKEN_FAILED",
                            f"Token endpoint returned non-JSON response for connection {connection_id} at {endpoint_url}: {resp.text[:200]}",
                        ) from e
                    if "access_token" not in data:
                        raise ExecutionError(
                            "OAUTH_TOKEN_FAILED",
                            f"Token endpoint response missing 'access_token' for connection {connection_id} at {endpoint_url}. Got keys: {list(data.keys())}",
                        )
                    return str(data["access_token"])

                detail = self._response_error_detail(resp)
                attempt_errors.append(f"{endpoint_url} -> HTTP {resp.status_code}: {detail}")

                # If NEXTJS_INTERNAL_URL contains a path segment (e.g. /browse),
                # try an origin-only fallback when the first attempt is a 404.
                should_try_fallback = (
                    idx == 0
                    and len(endpoint_urls) > 1
                    and resp.status_code in {301, 302, 307, 308, 404}
                )
                if should_try_fallback:
                    continue

                break

            if attempt_errors:
                try:
                    joined = " | ".join(attempt_errors)
                except Exception:
                    joined = attempt_errors[-1]
                raise ExecutionError(
                    "OAUTH_TOKEN_FAILED",
                    f"Could not retrieve token for connection {connection_id}. Attempts: {joined}",
                )

        raise ExecutionError(
            "OAUTH_TOKEN_FAILED",
            f"Could not retrieve token for connection {connection_id}: no response",
        )

    async def _fetch_api_key(self, api_key_ref: str) -> tuple[str, str]:
        """Fetch the API key value + provider from the Next.js internal vault endpoint.
        Returns (value, provider).
        """
        secret = os.environ["RUNTIME_SECRET"]
        endpoint_path = f"/api/internal/vault/{api_key_ref}"
        endpoint_urls = self._nextjs_endpoint_candidates(endpoint_path)
        attempt_errors: list[str] = []
        async with httpx.AsyncClient(timeout=15) as client:
            for idx, endpoint_url in enumerate(endpoint_urls):
                resp = await client.get(
                    endpoint_url,
                    headers={"x-runtime-secret": secret},
                )
                if resp.is_success:
                    try:
                        data = resp.json()
                    except Exception as e:
                        raise ExecutionError(
                            "API_KEY_FETCH_FAILED",
                            f"Vault endpoint returned non-JSON for key '{api_key_ref}' at {endpoint_url}: {resp.text[:200]}",
                        ) from e
                    if "value" not in data:
                        raise ExecutionError(
                            "API_KEY_FETCH_FAILED",
                            f"Vault response missing 'value' for key '{api_key_ref}' at {endpoint_url}. Got keys: {list(data.keys())}",
                        )
                    return str(data["value"]), str(data.get("provider", ""))

                detail = self._response_error_detail(resp)
                attempt_errors.append(f"{endpoint_url} -> HTTP {resp.status_code}: {detail}")

                should_try_fallback = (
                    idx == 0
                    and len(endpoint_urls) > 1
                    and resp.status_code in {301, 302, 307, 308, 404}
                )
                if should_try_fallback:
                    continue
                break

            if attempt_errors:
                try:
                    joined = " | ".join(attempt_errors)
                except Exception:
                    joined = attempt_errors[-1]
                raise ExecutionError(
                    "API_KEY_FETCH_FAILED",
                    f"Could not fetch API key '{api_key_ref}'. Attempts: {joined}",
                )

        raise ExecutionError(
            "API_KEY_FETCH_FAILED",
            f"Could not fetch API key '{api_key_ref}': no response",
        )

    def _nextjs_endpoint_candidates(self, endpoint_path: str) -> list[str]:
        """Build internal endpoint URLs with an origin-only fallback.

        If NEXTJS_INTERNAL_URL is set to a path (for example
        https://app.example.com/browse), internal API calls should still target
        https://app.example.com/api/... .
        """
        raw_base = os.environ.get("NEXTJS_INTERNAL_URL", "http://localhost:3000").strip()
        if not raw_base:
            raw_base = "http://localhost:3000"
        if "://" not in raw_base:
            raw_base = f"http://{raw_base}"

        normalized = raw_base.rstrip("/")
        urls = [f"{normalized}{endpoint_path}"]

        parsed = urlsplit(normalized)
        if parsed.path and parsed.path != "/":
            origin_only = f"{parsed.scheme}://{parsed.netloc}{endpoint_path}"
            if origin_only not in urls:
                urls.append(origin_only)

        return urls

    @staticmethod
    def _response_error_detail(resp: httpx.Response) -> str:
        try:
            body = resp.json()
            if isinstance(body, dict):
                return str(body.get("error") or body.get("message") or resp.text[:300])
            return str(body)[:300]
        except Exception:
            return resp.text[:300]

    async def _with_retry(
        self,
        fn: Callable,
        retry: Any,
        node_id: str,
    ) -> dict:
        last_error: Exception | None = None
        for attempt in range(1, retry.max_attempts + 1):
            try:
                return await fn()
            except ExecutionError:
                # ExecutionError (including OAUTH_TOKEN_FAILED) — never retry, always fatal
                raise
            except Exception as e:
                last_error = e
                error_msg = str(e)
                # Don't retry 4xx errors — they are permanent (bad model ID, bad auth, etc.)
                is_client_error = any(
                    f"LLM API error {code}" in error_msg or f"returned {code}" in error_msg
                    for code in range(400, 500)
                )
                await update_node_execution(
                    self.db,
                    self.run_id,
                    node_id,
                    retry_count=attempt,
                    error_message=error_msg,
                )
                if attempt == retry.max_attempts or is_client_error:
                    break
                delay_map = {
                    "none": 0.0,
                    "linear": retry.backoff_base_seconds * attempt,
                    "exponential": retry.backoff_base_seconds * (2 ** (attempt - 1)),
                }
                delay = delay_map.get(retry.backoff, 0.0)
                if delay > 0:
                    await asyncio.sleep(delay)

        err_msg = str(last_error) if last_error else "Unknown error after retries"
        if retry.fail_program_on_exhaust:
            raise ExecutionError("MAX_RETRIES_EXHAUSTED", err_msg, node_id)
        # Non-fatal exhaustion: record the final error on the node execution so it's visible
        await update_node_execution(
            self.db,
            self.run_id,
            node_id,
            status="failed",
            error_message=f"[Retries exhausted — continuing run] {err_msg}",
            completed_at="now()",
        )
        return {}


def _safe_eval_transform(expression: str, data: dict) -> Any:
    """Evaluate a transformation expression in a sandboxed namespace.
    Raises ExecutionError on any failure — never silently returns wrong data.
    """
    namespace: dict[str, Any] = {
        "data": data,
        "__builtins__": {
            "len": len,
            "str": str,
            "int": int,
            "float": float,
            "list": list,
            "dict": dict,
            "bool": bool,
        },
    }
    try:
        return eval(expression, namespace)  # noqa: S307
    except Exception as e:
        raise RuntimeError(
            f"[TRANSFORM_EVAL_ERROR] Expression '{expression}' failed: "
            f"{type(e).__name__}: {e}. Available data keys: {list(data.keys())}"
        ) from e


def _safe_eval_condition(condition: str, data: dict) -> bool:
    """Evaluate a boolean condition expression.
    Raises RuntimeError on any failure — never silently returns False.
    """
    namespace: dict[str, Any] = {
        "data": data,
        "__builtins__": {
            "len": len,
            "str": str,
            "int": int,
            "float": float,
            "True": True,
            "False": False,
        },
    }
    try:
        result = eval(condition, namespace)  # noqa: S307
        return bool(result)
    except Exception as e:
        raise RuntimeError(
            f"[CONDITION_EVAL_ERROR] Condition '{condition}' failed: "
            f"{type(e).__name__}: {e}. Available data keys: {list(data.keys())}"
        ) from e
