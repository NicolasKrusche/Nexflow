from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Literal, Optional, Union


@dataclass
class RetryConfig:
    max_attempts: int
    backoff: Literal["none", "linear", "exponential"]
    backoff_base_seconds: float
    fail_program_on_exhaust: bool


@dataclass
class AgentConfig:
    model: str
    api_key_ref: str
    system_prompt: str
    input_schema: Optional[dict]
    output_schema: Optional[dict]
    requires_approval: bool
    approval_timeout_hours: float
    scope_required: Optional[str]
    scope_access: Literal["read", "write", "read_write"]
    retry: RetryConfig
    tools: list[str]


@dataclass
class TriggerConfig:
    trigger_type: str
    extra: dict = field(default_factory=dict)


@dataclass
class StepConfig:
    logic_type: Literal[
        "transform", "filter", "branch",
        "delay", "loop", "format", "parse", "deduplicate", "sort",
    ]
    extra: dict = field(default_factory=dict)


@dataclass
class OAuthConnectionConfig:
    scope_access: str
    scope_required: list[str]
    connector_type: Literal["oauth"] = "oauth"
    operation: Optional[str] = None
    operation_params: dict = field(default_factory=dict)


@dataclass
class HttpConnectionConfig:
    connector_type: Literal["http"] = "http"
    method: str = "GET"
    url: str = ""
    auth_type: str = "none"
    auth_value: Optional[str] = None
    query_params: list[dict[str, str]] = field(default_factory=list)
    headers: list[dict[str, str]] = field(default_factory=list)
    body: Optional[str] = None
    parse_response: bool = True
    timeout_seconds: Optional[float] = None
    retry: Optional[RetryConfig] = None


ConnectionConfig = Union[OAuthConnectionConfig, HttpConnectionConfig]


@dataclass
class SchemaNode:
    id: str
    type: Literal["trigger", "agent", "step", "connection"]
    label: str
    description: str
    connection: Optional[str]
    config: Union[AgentConfig, TriggerConfig, StepConfig, ConnectionConfig]
    position: dict
    status: str


@dataclass
class SchemaEdge:
    id: str
    from_node: str   # "from" is a Python keyword
    to: str
    type: Literal["data_flow", "control_flow", "event_subscription"]
    data_mapping: Optional[dict]
    condition: Optional[str]
    label: Optional[str]


@dataclass
class ProgramSchema:
    version: str
    program_id: str
    program_name: str
    nodes: list[SchemaNode]
    edges: list[SchemaEdge]
    execution_mode: str


def _parse_retry(data: dict) -> RetryConfig:
    return RetryConfig(
        max_attempts=int(data.get("max_attempts", 1)),
        backoff=data.get("backoff", "none"),
        backoff_base_seconds=float(data.get("backoff_base_seconds", 1.0)),
        fail_program_on_exhaust=bool(data.get("fail_program_on_exhaust", False)),
    )


def _parse_node_config(
    node_type: str,
    raw: dict,
) -> Union[AgentConfig, TriggerConfig, StepConfig, ConnectionConfig]:
    if node_type == "agent":
        retry_raw = raw.get("retry") or {}
        return AgentConfig(
            model=raw.get("model", "__USER_ASSIGNED__"),
            api_key_ref=raw.get("api_key_ref", "__USER_ASSIGNED__"),
            system_prompt=raw.get("system_prompt", ""),
            input_schema=raw.get("input_schema"),
            output_schema=raw.get("output_schema"),
            requires_approval=bool(raw.get("requires_approval", False)),
            approval_timeout_hours=float(raw.get("approval_timeout_hours", 24.0)),
            scope_required=raw.get("scope_required"),
            scope_access=raw.get("scope_access", "read"),
            retry=_parse_retry(retry_raw),
            tools=list(raw.get("tools") or []),
        )
    elif node_type == "trigger":
        trigger_type = raw.get("trigger_type", "manual")
        extra = {k: v for k, v in raw.items() if k != "trigger_type"}
        return TriggerConfig(trigger_type=trigger_type, extra=extra)
    elif node_type == "step":
        logic_type = raw.get("logic_type", "transform")
        extra = {k: v for k, v in raw.items() if k != "logic_type"}
        return StepConfig(logic_type=logic_type, extra=extra)
    elif node_type == "connection":
        connector_type = raw.get("connector_type")
        if connector_type == "http":
            timeout_raw = raw.get("timeout_seconds")
            timeout_seconds = (
                float(timeout_raw)
                if timeout_raw not in (None, "")
                else None
            )
            retry_raw = raw.get("retry")
            retry_cfg = _parse_retry(retry_raw) if isinstance(retry_raw, dict) else None

            query_params_raw = raw.get("query_params") or []
            headers_raw = raw.get("headers") or []

            query_params = [
                {
                    "key": str(item.get("key", "")),
                    "value": str(item.get("value", "")),
                }
                for item in query_params_raw
                if isinstance(item, dict)
            ]
            headers = [
                {
                    "key": str(item.get("key", "")),
                    "value": str(item.get("value", "")),
                }
                for item in headers_raw
                if isinstance(item, dict)
            ]

            auth_value = raw.get("auth_value")
            body = raw.get("body")

            return HttpConnectionConfig(
                connector_type="http",
                method=str(raw.get("method", "GET")).upper(),
                url=str(raw.get("url", "")),
                auth_type=str(raw.get("auth_type", "none")),
                auth_value=str(auth_value) if auth_value is not None else None,
                query_params=query_params,
                headers=headers,
                body=str(body) if body is not None else None,
                parse_response=bool(raw.get("parse_response", True)),
                timeout_seconds=timeout_seconds,
                retry=retry_cfg,
            )

        # Backward-compatible OAuth-style connection config.
        return OAuthConnectionConfig(
            connector_type="oauth",
            scope_access=raw.get("scope_access", "read"),
            scope_required=list(raw.get("scope_required") or []),
            operation=raw.get("operation"),
            operation_params=dict(raw.get("operation_params") or {}),
        )
    else:
        return TriggerConfig(trigger_type="manual")


def parse_schema(data: dict) -> ProgramSchema:
    """Construct a ProgramSchema from a raw JSON dict."""
    raw_nodes: list[dict] = data.get("nodes") or []
    raw_edges: list[dict] = data.get("edges") or []

    nodes: list[SchemaNode] = []
    for n in raw_nodes:
        node_type = n.get("type", "step")
        raw_config = n.get("config") or {}
        config = _parse_node_config(node_type, raw_config)
        nodes.append(
            SchemaNode(
                id=n["id"],
                type=node_type,
                label=n.get("label", ""),
                description=n.get("description", ""),
                connection=n.get("connection"),
                config=config,
                position=n.get("position") or {},
                status=n.get("status", "idle"),
            )
        )

    edges: list[SchemaEdge] = []
    for e in raw_edges:
        edges.append(
            SchemaEdge(
                id=e["id"],
                from_node=e.get("from", ""),
                to=e.get("to", ""),
                type=e.get("type", "data_flow"),
                data_mapping=e.get("data_mapping"),
                condition=e.get("condition"),
                label=e.get("label"),
            )
        )

    return ProgramSchema(
        version=data.get("version", "1.0"),
        program_id=data.get("program_id", ""),
        program_name=data.get("program_name", ""),
        nodes=nodes,
        edges=edges,
        execution_mode=data.get("execution_mode", "autonomous"),
    )
