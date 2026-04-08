from __future__ import annotations

import asyncio
import json
import os
import re
import time
from typing import Any, Callable

import httpx
from langgraph.graph import StateGraph
from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI

from schema import (
    AgentConfig,
    HttpConnectionConfig,
    ProgramSchema,
    RetryConfig,
    SchemaNode,
    StepConfig,
)
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


def _resolve_expressions(template: str, inputs: dict) -> str:
    """Replace {{key}} and {{node_id.field}} expressions with values from inputs."""
    def replacer(match: re.Match) -> str:
        expr = match.group(1).strip()
        parts = expr.split(".")
        val: Any = inputs
        for part in parts:
            if isinstance(val, dict):
                val = val.get(part, match.group(0))
            else:
                return match.group(0)
        return str(val)
    return re.sub(r"\{\{([^}]+)\}\}", replacer, template)


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

    def _resolve_input(self, node_id: str, state: dict[str, Any]) -> dict:
        """Merge upstream outputs according to edge data_mapping."""
        incoming = [e for e in self.schema.edges if e.to == node_id]
        resolved: dict[str, Any] = {}
        for edge in incoming:
            upstream = state.get(edge.from_node) or {}
            if not edge.data_mapping:
                resolved.update(upstream)
            else:
                for src_field, tgt_field in edge.data_mapping.items():
                    value = upstream.get(src_field)
                    if value is not None:
                        resolved[tgt_field] = value
        return resolved

    async def _execute_node(self, node: SchemaNode, input_data: dict) -> dict:
        await update_node_execution(
            self.db,
            self.run_id,
            node.id,
            status="running",
            started_at="now()",
            input_payload=input_data,
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
        api_key = await self._fetch_api_key(cfg.api_key_ref)

        # Execute with retry
        return await self._with_retry(
            lambda: self._call_llm(cfg, api_key, input_data),
            cfg.retry,
            node.id,
        )

    async def _call_llm(self, cfg: AgentConfig, api_key: str, input_data: dict) -> dict:
        """Call the LLM via LiteLLM-compatible API."""
        litellm_url = os.environ.get("LITELLM_URL")

        if litellm_url:
            base_url = litellm_url
        elif "claude" in cfg.model or "anthropic" in cfg.model:
            base_url = "https://api.anthropic.com/v1"
        else:
            base_url = "https://api.openai.com/v1"

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        content: str
        if "anthropic" in base_url and (litellm_url is None or "litellm" not in base_url):
            headers["x-api-key"] = api_key
            headers["anthropic-version"] = "2023-06-01"
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    f"{base_url}/messages",
                    headers=headers,
                    json={
                        "model": cfg.model,
                        "max_tokens": 4096,
                        "system": cfg.system_prompt,
                        "messages": [
                            {"role": "user", "content": json.dumps(input_data)}
                        ],
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                content = data["content"][0]["text"] if data.get("content") else ""
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
                resp.raise_for_status()
                data = resp.json()
                content = (
                    data["choices"][0]["message"]["content"]
                    if data.get("choices")
                    else ""
                )

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
                return {}  # Empty output = filtered out
            return input_data

        elif cfg.logic_type == "branch":
            conditions = extra.get("conditions", [])
            for cond in conditions:
                if _safe_eval_condition(cond["condition"], input_data):
                    return {**input_data, "__branch_target__": cond["target_node_id"]}
            default = extra.get("default_branch", "")
            return {**input_data, "__branch_target__": default}

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

    async def _fetch_api_key(self, api_key_ref: str) -> str:
        """Fetch the actual API key value from the Next.js internal vault endpoint."""
        nextjs_url = os.environ.get("NEXTJS_INTERNAL_URL", "http://localhost:3000")
        secret = os.environ["RUNTIME_SECRET"]
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{nextjs_url}/api/internal/vault/{api_key_ref}",
                headers={"x-runtime-secret": secret},
            )
            resp.raise_for_status()
            return str(resp.json()["value"])

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
            except Exception as e:
                last_error = e
                await update_node_execution(
                    self.db,
                    self.run_id,
                    node_id,
                    retry_count=attempt,
                    error_message=str(e),
                )
                if attempt == retry.max_attempts:
                    break
                delay_map = {
                    "none": 0.0,
                    "linear": retry.backoff_base_seconds * attempt,
                    "exponential": retry.backoff_base_seconds * (2 ** (attempt - 1)),
                }
                delay = delay_map.get(retry.backoff, 0.0)
                if delay > 0:
                    await asyncio.sleep(delay)

        if retry.fail_program_on_exhaust:
            raise ExecutionError(
                "MAX_RETRIES_EXHAUSTED", str(last_error), node_id
            )
        return {}


def _safe_eval_transform(expression: str, data: dict) -> Any:
    """Evaluate a transformation expression in a sandboxed namespace."""
    try:
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
        return eval(expression, namespace)  # noqa: S307
    except Exception:
        return data


def _safe_eval_condition(condition: str, data: dict) -> bool:
    """Evaluate a boolean condition expression."""
    try:
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
        result = eval(condition, namespace)  # noqa: S307
        return bool(result)
    except Exception:
        return False
