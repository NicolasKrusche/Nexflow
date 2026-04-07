from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any, Callable

import httpx

from schema import AgentConfig, ProgramSchema, SchemaNode, StepConfig
from db import (
    create_approval,
    create_node_execution,
    get_db,
    update_node_execution,
    update_run,
)


class ExecutionError(Exception):
    def __init__(self, code: str, message: str, node_id: str | None = None) -> None:
        self.code = code
        self.message = message
        self.node_id = node_id
        super().__init__(message)


class ProgramExecutor:
    def __init__(self, schema: ProgramSchema, run_id: str, user_id: str) -> None:
        self.schema = schema
        self.run_id = run_id
        self.user_id = user_id
        self.db = get_db()
        self.node_map: dict[str, SchemaNode] = {n.id: n for n in schema.nodes}
        self.edges_from: dict[str, list] = {}
        for edge in schema.edges:
            self.edges_from.setdefault(edge.from_node, []).append(edge)

    async def execute(self, trigger_payload: dict | None = None) -> dict[str, Any]:
        """Run the program. Returns final state."""
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

        try:
            if node.type == "agent":
                output = await self._execute_agent(node, input_data)
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

        # Check for approval requirement
        if cfg.requires_approval:
            approved = await self._request_approval(node, input_data)
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
        # Phase 5 will implement full connectors — for now pass through
        return input_data

    async def _request_approval(self, node: SchemaNode, input_data: dict) -> bool:
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
            },
        )

        cfg: AgentConfig = node.config  # type: ignore[assignment]
        timeout_seconds = cfg.approval_timeout_hours * 3600
        deadline = time.time() + timeout_seconds
        poll_interval = 5  # seconds

        while time.time() < deadline:
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
