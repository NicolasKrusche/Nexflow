from __future__ import annotations
import os
from typing import Any, Optional
from supabase import create_client, Client


def get_db() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


async def create_run(
    db: Client,
    program_id: str,
    user_id: str,
    triggered_by: str,
    trigger_payload: Optional[dict],
) -> dict:
    """Insert into runs table, return the row."""
    result = (
        db.table("runs")
        .insert(
            {
                "program_id": program_id,
                "triggered_by": triggered_by,
                "trigger_payload": trigger_payload,
                "status": "running",
                "started_at": "now()",
            }
        )
        .execute()
    )
    return result.data[0]


async def update_run(db: Client, run_id: str, **kwargs: Any) -> None:
    db.table("runs").update(kwargs).eq("id", run_id).execute()


async def create_node_execution(db: Client, run_id: str, node_id: str) -> dict:
    result = (
        db.table("node_executions")
        .insert(
            {
                "run_id": run_id,
                "node_id": node_id,
                "status": "pending",
            }
        )
        .execute()
    )
    return result.data[0]


async def update_node_execution(
    db: Client, run_id: str, node_id: str, **kwargs: Any
) -> None:
    (
        db.table("node_executions")
        .update(kwargs)
        .eq("run_id", run_id)
        .eq("node_id", node_id)
        .execute()
    )


async def create_approval(
    db: Client, node_execution_id: str, user_id: str, context: dict
) -> dict:
    result = (
        db.table("approvals")
        .insert(
            {
                "node_execution_id": node_execution_id,
                "user_id": user_id,
                "status": "pending",
                "context": context,
            }
        )
        .execute()
    )
    return result.data[0]


async def get_approval(db: Client, node_execution_id: str) -> Optional[dict]:
    result = (
        db.table("approvals")
        .select("*")
        .eq("node_execution_id", node_execution_id)
        .eq("status", "pending")
        .maybe_single()
        .execute()
    )
    return result.data
