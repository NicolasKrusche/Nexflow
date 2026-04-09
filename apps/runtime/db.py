from __future__ import annotations
import os
from datetime import datetime, timezone, timedelta
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
    if not result.data:
        raise RuntimeError("DB insert for run returned no data — possible constraint violation")
    return result.data[0]


async def update_run(db: Client, run_id: str, **kwargs: Any) -> None:
    result = db.table("runs").update(kwargs).eq("id", run_id).execute()
    if hasattr(result, "error") and result.error:
        print(f"[db] WARNING: update_run failed for run {run_id}: {result.error}", flush=True)


async def get_run_status(db: Client, run_id: str) -> str:
    """Fetch the current status of a run (for cancellation checks)."""
    result = (
        db.table("runs")
        .select("status")
        .eq("id", run_id)
        .single()
        .execute()
    )
    return result.data.get("status", "unknown")


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
    if not result.data:
        raise RuntimeError(f"DB insert for node_execution (run={run_id}, node={node_id}) returned no data")
    return result.data[0]


async def update_node_execution(
    db: Client, run_id: str, node_id: str, **kwargs: Any
) -> None:
    result = (
        db.table("node_executions")
        .update(kwargs)
        .eq("run_id", run_id)
        .eq("node_id", node_id)
        .execute()
    )
    if hasattr(result, "error") and result.error:
        print(f"[db] WARNING: update_node_execution failed (run={run_id}, node={node_id}): {result.error}", flush=True)


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
    if not result.data:
        raise RuntimeError(f"DB insert for approval (node_exec={node_execution_id}) returned no data")
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


# ─── Resource Locking ─────────────────────────────────────────────────────────

LOCK_TTL_MINUTES = 30


async def acquire_resource_lock(
    db: Client, run_id: str, resource_type: str, resource_id: str
) -> bool:
    """
    Try to acquire a resource lock. Returns True if acquired, False if conflict.
    Uses INSERT with ON CONFLICT DO NOTHING to be atomic.
    """
    expires_at = (
        datetime.now(timezone.utc) + timedelta(minutes=LOCK_TTL_MINUTES)
    ).isoformat()

    try:
        result = (
            db.table("resource_locks")
            .insert(
                {
                    "resource_type": resource_type,
                    "resource_id": resource_id,
                    "locked_by_run_id": run_id,
                    "expires_at": expires_at,
                }
            )
            .execute()
        )
        return len(result.data) > 0
    except Exception as e:
        err_str = str(e).lower()
        # Unique constraint violation = lock already held by another run — expected, return False
        if "unique" in err_str or "duplicate" in err_str or "23505" in err_str:
            return False
        # Any other DB error (connection failure, permission, etc.) must propagate
        raise RuntimeError(f"acquire_resource_lock failed unexpectedly for {resource_type}/{resource_id}: {e}") from e


async def release_run_locks(db: Client, run_id: str) -> None:
    """Release all resource locks held by this run."""
    db.table("resource_locks").delete().eq("locked_by_run_id", run_id).execute()


async def get_existing_lock(
    db: Client, resource_type: str, resource_id: str
) -> Optional[dict]:
    """Check if a resource is currently locked (and not expired)."""
    now = datetime.now(timezone.utc).isoformat()
    result = (
        db.table("resource_locks")
        .select("id, locked_by_run_id, expires_at")
        .eq("resource_type", resource_type)
        .eq("resource_id", resource_id)
        .gt("expires_at", now)
        .maybe_single()
        .execute()
    )
    return result.data


async def cleanup_stale_locks(db: Client) -> int:
    """Delete expired locks. Returns number deleted."""
    now = datetime.now(timezone.utc).isoformat()
    result = db.table("resource_locks").delete().lt("expires_at", now).execute()
    return len(result.data)


async def get_credential(ref: str, user_id: str) -> dict:
    db = get_db()
    result = db.rpc("get_decrypted_secret", {
        "secret_name": f"{ref}_{user_id}"
    }).execute()
    if not result.data:
        raise ValueError(f"Credential '{ref}' not found for user")
    return result.data


async def get_active_cron_workflows() -> list:
    """Return programs whose trigger node type is trigger.cron."""
    db = get_db()
    result = db.table("programs").select("id, schema").execute()
    rows = result.data or []
    cron_workflows = []
    for row in rows:
        schema = row.get("schema") or {}
        nodes = schema.get("nodes") or []
        for node in nodes:
            if node.get("type") == "trigger.cron":
                config = node.get("config") or {}
                cron_workflows.append({
                    "id": row["id"],
                    "cron_expression": config.get("cron_expression", "0 * * * *"),
                })
                break
    return cron_workflows
