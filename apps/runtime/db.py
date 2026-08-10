from __future__ import annotations
import hashlib
import json
import os
import re
from datetime import datetime, timezone, timedelta
from typing import Any, Optional
from supabase import create_client, Client

TELEMETRY_COLUMNS = {
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "estimated_cost_usd",
    "billed_cost_usd",
    "connector_api_calls",
    "model_call_count",
    "token_usage",
}

COMPLIANCE_COLUMNS = {
    "user_id",
    "workflow_version",
    "trigger_source",
    "data_region",
    "policy_checks",
    "block_warning_reasons",
    "retention_expiry",
    "provider_id",
    "model_id",
    "prompt_hash",
    "input_hash",
    "output_hash",
    "stored_full_prompt",
    "stored_full_input",
    "stored_full_output",
    "tool_calls",
    "approval_request",
    "approval_decision",
    "approver_id",
}

APPROVAL_EVIDENCE_COLUMNS = {
    "requested_action",
    "ai_generated_recommendation",
    "data_summary",
    "risk_flags",
    "approver_id",
    "decision",
    "decision_timestamp",
    "final_executed_action",
}

EXECUTION_LOG_VERBOSITY_MODES = {"NONE", "ERRORS_ONLY", "METADATA_ONLY", "FULL"}
DEFAULT_EXECUTION_LOG_VERBOSITY = "METADATA_ONLY"
MAX_METADATA_DEPTH = 4
MAX_METADATA_KEYS = 20

# Defense-in-depth (S11/S16): never persist secret-bearing keys in node_executions
# output payloads or approval contexts, even if upstream code accidentally
# forwards them. Exact-key match, case-insensitive.
_REDACTED_KEYS = {
    "access_token",
    "refresh_token",
    "id_token",
    "api_key",
    "apikey",
    "secret",
    "client_secret",
    "password",
    "authorization",
    "auth_value",
    "bearer",
    "cookie",
    "credential",
    "credentials",
    "private_key",
    "set-cookie",
    "webhook_token",
    "x-api-key",
}
_REDACTED_PLACEHOLDER = "[redacted]"
_REDACTED_KEY_PLACEHOLDER = "[redacted_key]"
_TOKEN_PATTERNS = [
    re.compile(r"Bearer\s+[A-Za-z0-9._~+/=-]{16,}", re.IGNORECASE),
    re.compile(r"\b(?:sk|rk|pk|ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{16,}\b"),
    re.compile(r"\bxox(?:b|p|o|a|r)-[A-Za-z0-9-]{16,}\b"),
    re.compile(r"\bya29\.[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
]


def _normalise_secret_key(key: str) -> str:
    return key.lower().replace("-", "_").replace(" ", "_")


def is_secret_key(key: str) -> bool:
    normalised = _normalise_secret_key(key)
    if normalised in _REDACTED_KEYS:
        return True
    return any(
        marker in normalised
        for marker in (
            "access_token",
            "refresh_token",
            "id_token",
            "api_key",
            "apikey",
            "auth_token",
            "authorization",
            "client_secret",
            "credential",
            "password",
            "private_key",
            "secret",
            "session_token",
            "webhook_token",
        )
    )


def redact_secret_strings(value: str) -> str:
    redacted = value
    for pattern in _TOKEN_PATTERNS:
        redacted = pattern.sub(_REDACTED_PLACEHOLDER, redacted)
    return redacted


def get_execution_log_verbosity() -> str:
    mode = os.environ.get("EXECUTION_LOG_VERBOSITY", DEFAULT_EXECUTION_LOG_VERBOSITY).strip().upper()
    if mode not in EXECUTION_LOG_VERBOSITY_MODES:
        return DEFAULT_EXECUTION_LOG_VERBOSITY
    return mode


def redact_secrets(value: Any, _depth: int = 0) -> Any:
    """Recursively redact secret-bearing fields from dict/list payloads.

    Bounded recursion (max depth 8) to avoid pathological structures stalling
    the writer. Non-container values are returned unchanged.
    """
    if _depth > 8:
        return value
    if isinstance(value, dict):
        return {
            k: (_REDACTED_PLACEHOLDER if isinstance(k, str) and is_secret_key(k) else redact_secrets(v, _depth + 1))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [redact_secrets(item, _depth + 1) for item in value]
    if isinstance(value, str):
        return redact_secret_strings(value)
    return value


def _safe_metadata_key(key: Any) -> str:
    if not isinstance(key, str):
        return str(key)
    return _REDACTED_KEY_PLACEHOLDER if is_secret_key(key) else key


def summarize_payload_metadata(value: Any, _depth: int = 0) -> Any:
    if _depth > MAX_METADATA_DEPTH:
        return {"type": type(value).__name__, "truncated": True}

    if isinstance(value, dict):
        items = list(value.items())
        fields: dict[str, Any] = {}
        for key, item in items[:MAX_METADATA_KEYS]:
            safe_key = _safe_metadata_key(key)
            if safe_key == _REDACTED_KEY_PLACEHOLDER:
                fields[safe_key] = {"type": "redacted", "redacted": True}
            else:
                fields[safe_key] = summarize_payload_metadata(item, _depth + 1)
        return {
            "_log_payload": "metadata_only",
            "type": "object",
            "key_count": len(items),
            "keys": [_safe_metadata_key(key) for key, _ in items[:MAX_METADATA_KEYS]],
            "truncated_keys": max(0, len(items) - MAX_METADATA_KEYS),
            "fields": fields,
        }

    if isinstance(value, list):
        return {
            "_log_payload": "metadata_only",
            "type": "array",
            "length": len(value),
            "items": [summarize_payload_metadata(item, _depth + 1) for item in value[:5]],
            "truncated_items": max(0, len(value) - 5),
        }

    if isinstance(value, str):
        return {"_log_payload": "metadata_only", "type": "string", "length": len(value)}

    if value is None:
        return None

    return {"_log_payload": "metadata_only", "type": type(value).__name__}


def apply_execution_log_policy(
    value: Any,
    *,
    status: str | None = None,
    verbosity: str | None = None,
) -> Any:
    mode = (verbosity or get_execution_log_verbosity()).strip().upper()
    if mode not in EXECUTION_LOG_VERBOSITY_MODES:
        mode = DEFAULT_EXECUTION_LOG_VERBOSITY

    if mode == "NONE":
        return None
    if mode == "ERRORS_ONLY" and status != "failed":
        return None
    if mode in {"ERRORS_ONLY", "METADATA_ONLY"}:
        return summarize_payload_metadata(value)
    return redact_secrets(value)


def hash_payload(value: Any) -> str:
    try:
        encoded = json.dumps(value, sort_keys=True, default=str, separators=(",", ":"))
    except Exception:
        encoded = str(value)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _looks_like_missing_column_error(error: object, columns: set[str]) -> bool:
    text = str(error).lower()
    if not any(column.lower() in text for column in columns):
        return False
    return any(marker in text for marker in ("column", "schema cache", "could not find"))


def get_db() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


# Tiers that carry the higher "paid" resource ceilings. "unlimited" and admins
# are handled separately (no ceiling at all).
_PAID_TIERS = {"plus", "pro", "builder"}
_MODEL_ACCESS_TIERS = {"free", "plus", "pro", "builder", "unlimited"}


def get_user_run_plan(db: Client, user_id: str) -> str:
    """Resolve a user's run-limit plan: "unlimited", "paid", or "free".

    Admins and unlimited-tier accounts get no resource ceiling (matching the
    unlimited platform-credit behaviour); plus/pro/builder get the paid
    ceilings; everyone else gets the free ceilings. Falls back to "free" on any
    lookup error so a transient DB issue never silently grants unlimited usage.
    """
    if not user_id:
        return "free"
    try:
        result = db.table("profiles").select("tier, is_admin").eq("id", user_id).limit(1).execute()
        rows = result.data or []
        if not rows:
            return "free"
        row = rows[0]
        if row.get("is_admin") is True or row.get("tier") == "unlimited":
            return "unlimited"
        if row.get("tier") in _PAID_TIERS:
            return "paid"
        return "free"
    except Exception:
        return "free"


def get_model_access_tier(db: Client, user_id: str, workspace_id: str | None = None) -> str:
    """Resolve the billing tier that controls platform-model and BYOK access.

    Model entitlements are workspace-scoped in the web app, so a member of a
    paid workspace must inherit that workspace's tier even when their personal
    profile is free. Unknown/missing data fails closed to the Free tier.
    """
    if not user_id:
        return "free"

    try:
        profile_result = db.table("profiles").select("tier, is_admin").eq("id", user_id).limit(1).execute()
        profile_rows = profile_result.data or []
        profile = profile_rows[0] if profile_rows else {}
        if profile.get("is_admin") is True:
            return "unlimited"

        if workspace_id:
            workspace_result = db.table("workspaces").select("tier").eq("id", workspace_id).limit(1).execute()
            workspace_rows = workspace_result.data or []
            workspace_tier = workspace_rows[0].get("tier") if workspace_rows else None
            return workspace_tier if workspace_tier in _MODEL_ACCESS_TIERS else "free"

        profile_tier = profile.get("tier")
        return profile_tier if profile_tier in _MODEL_ACCESS_TIERS else "free"
    except Exception:
        return "free"


_PRIORITY_EXECUTION_TIERS = {"builder", "unlimited"}


def get_user_priority_tier(db: Client, user_id: str) -> bool:
    """Whether this user's plan gets the reserved priority-execution slot pool
    (Scale tier and admins). Falls back to False on any lookup error so a
    transient DB issue never silently grants priority."""
    if not user_id:
        return False
    try:
        result = db.table("profiles").select("tier, is_admin").eq("id", user_id).limit(1).execute()
        rows = result.data or []
        if not rows:
            return False
        row = rows[0]
        if row.get("is_admin") is True:
            return True
        return row.get("tier") in _PRIORITY_EXECUTION_TIERS
    except Exception:
        return False


def is_processing_restricted(db: Client, user_id: str) -> bool:
    result = db.table("profiles").select("processing_restricted").eq("id", user_id).limit(1).execute()
    rows = result.data or []
    if not rows:
        return False
    return rows[0].get("processing_restricted") is True


async def create_run(
    db: Client,
    program_id: str,
    user_id: str,
    triggered_by: str,
    trigger_payload: Optional[dict],
) -> dict:
    """Insert into runs table, return the row."""
    safe_trigger_payload = apply_execution_log_policy(trigger_payload)
    result = (
        db.table("runs")
        .insert(
            {
                "program_id": program_id,
                "triggered_by": triggered_by,
                "trigger_payload": safe_trigger_payload,
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
    fallback_columns = TELEMETRY_COLUMNS | COMPLIANCE_COLUMNS
    try:
        result = db.table("runs").update(kwargs).eq("id", run_id).execute()
    except Exception as exc:
        if any(k in fallback_columns for k in kwargs) and _looks_like_missing_column_error(exc, fallback_columns):
            fallback = {k: v for k, v in kwargs.items() if k not in fallback_columns}
            if fallback and fallback != kwargs:
                db.table("runs").update(fallback).eq("id", run_id).execute()
                print(
                    f"[db] WARNING: update_run compliance metadata skipped for run {run_id} (likely missing migration)",
                    flush=True,
                )
                return
        raise
    if hasattr(result, "error") and result.error and any(k in fallback_columns for k in kwargs):
        fallback = {k: v for k, v in kwargs.items() if k not in fallback_columns}
        if fallback and fallback != kwargs:
            retry = db.table("runs").update(fallback).eq("id", run_id).execute()
            if not (hasattr(retry, "error") and retry.error):
                print(
                    f"[db] WARNING: update_run telemetry skipped for run {run_id} (likely missing migration)",
                    flush=True,
                )
                return
    if hasattr(result, "error") and result.error:
        print(f"[db] WARNING: update_run failed for run {run_id}: {result.error}", flush=True)


async def get_run_status(db: Client, run_id: str) -> str:
    """Fetch the current status of a run (for cancellation checks)."""
    result = db.table("runs").select("status").eq("id", run_id).single().execute()
    return result.data.get("status", "unknown")


async def touch_run_watcher_heartbeat(db: Client, run_id: str) -> None:
    """Best-effort liveness signal written by a live suspend/resume wait loop
    (approval, corelyx.ask_user, file operation) at each poll iteration.

    Lets a reconciliation sweep (apps/web/lib/run-reaper.ts) tell "a process
    is actively watching this paused run" apart from "the process that was
    watching it died (crash/redeploy) and nothing will ever notice the
    decision." Never allowed to fail the wait it's called from -- a missing
    column (migration not yet applied) or a transient DB error just means the
    reaper falls back to treating the run as unwatched, which is the safe
    direction to fail in.
    """
    try:
        db.table("runs").update({"watcher_heartbeat_at": "now()"}).eq("id", run_id).execute()
    except Exception as exc:
        print(f"[db] WARNING: could not update watcher heartbeat for run {run_id}: {exc}", flush=True)

    # Push this run's resource-lock TTL forward too (R13). A legitimately paused
    # run (waiting on approval / ask_user / a file op, up to ~24h) heartbeats
    # every poll; without renewal its lock would time-expire after LOCK_TTL and
    # be reaped mid-wait, letting a second run grab the same connection. The
    # orphan sweep separately exempts runs with a fresh heartbeat.
    try:
        new_expiry = (datetime.now(timezone.utc) + timedelta(minutes=LOCK_TTL_MINUTES)).isoformat()
        db.table("resource_locks").update({"expires_at": new_expiry}).eq("locked_by_run_id", run_id).execute()
    except Exception as exc:
        print(f"[db] WARNING: could not renew resource-lock TTL for run {run_id}: {exc}", flush=True)


async def mark_api_key_invalid(db: Client, api_key_id: str) -> None:
    """Flip api_keys.is_valid after a definitive provider auth failure (401) on
    a BYOK key. Without this the key row stays "valid" forever and the web
    pre-flight (PRE_002) keeps reporting a dead key as healthy, so users see
    all-green checks on workflows that can only fail. Best-effort: a DB error
    here must never mask the original LLM failure."""
    try:
        db.table("api_keys").update({"is_valid": False}).eq("id", api_key_id).execute()
        print(f"[db] marked api_key {api_key_id} invalid after provider auth failure", flush=True)
    except Exception as exc:
        print(f"[db] WARNING: could not mark api_key {api_key_id} invalid: {exc}", flush=True)


async def create_node_execution(db: Client, run_id: str, node_id: str) -> dict:
    # No DB-level unique constraint on (run_id, node_id), so check first to
    # avoid creating duplicate rows on re-dispatch (e.g. Skip trigger flow).
    existing = db.table("node_executions").select("*").eq("run_id", run_id).eq("node_id", node_id).limit(1).execute()
    if existing.data:
        return existing.data[0]
    try:
        result = (
            db.table("node_executions").insert({"run_id": run_id, "node_id": node_id, "status": "pending"}).execute()
        )
        if result.data:
            return result.data[0]
    except Exception as e:
        err = str(e).lower()
        if not ("unique" in err or "duplicate" in err or "23505" in err):
            raise
    # Racy re-check: another writer may have inserted between our select and insert
    recheck = db.table("node_executions").select("*").eq("run_id", run_id).eq("node_id", node_id).limit(1).execute()
    if not recheck.data:
        raise RuntimeError(f"node_execution row missing after conflict (run={run_id}, node={node_id})")
    return recheck.data[0]


async def update_node_execution(db: Client, run_id: str, node_id: str, **kwargs: Any) -> None:
    status = kwargs.get("status")
    if not isinstance(status, str):
        status = None
    if "input_payload" in kwargs:
        raw_input = kwargs["input_payload"]
        kwargs.setdefault("input_hash", hash_payload(raw_input))
        kwargs.setdefault("stored_full_input", get_execution_log_verbosity() == "FULL")
        kwargs["input_payload"] = apply_execution_log_policy(kwargs["input_payload"], status=status)
    if "output_payload" in kwargs:
        raw_output = kwargs["output_payload"]
        kwargs.setdefault("output_hash", hash_payload(raw_output))
        kwargs.setdefault("stored_full_output", get_execution_log_verbosity() == "FULL")
        kwargs["output_payload"] = apply_execution_log_policy(kwargs["output_payload"], status=status)
    fallback_columns = TELEMETRY_COLUMNS | COMPLIANCE_COLUMNS
    try:
        result = db.table("node_executions").update(kwargs).eq("run_id", run_id).eq("node_id", node_id).execute()
    except Exception as exc:
        if any(k in fallback_columns for k in kwargs) and _looks_like_missing_column_error(exc, fallback_columns):
            fallback = {k: v for k, v in kwargs.items() if k not in fallback_columns}
            if fallback and fallback != kwargs:
                (db.table("node_executions").update(fallback).eq("run_id", run_id).eq("node_id", node_id).execute())
                print(
                    f"[db] WARNING: update_node_execution compliance metadata skipped (run={run_id}, node={node_id})",
                    flush=True,
                )
                return
        raise
    if hasattr(result, "error") and result.error and any(k in fallback_columns for k in kwargs):
        fallback = {k: v for k, v in kwargs.items() if k not in fallback_columns}
        if fallback and fallback != kwargs:
            retry = db.table("node_executions").update(fallback).eq("run_id", run_id).eq("node_id", node_id).execute()
            if not (hasattr(retry, "error") and retry.error):
                print(
                    f"[db] WARNING: update_node_execution telemetry skipped (run={run_id}, node={node_id})",
                    flush=True,
                )
                return
    if hasattr(result, "error") and result.error:
        print(f"[db] WARNING: update_node_execution failed (run={run_id}, node={node_id}): {result.error}", flush=True)


async def create_approval(db: Client, node_execution_id: str, user_id: str, context: dict) -> dict:
    safe_context = redact_secrets(context)
    payload = {
        "node_execution_id": node_execution_id,
        "user_id": user_id,
        "status": "pending",
        "context": safe_context,
        "requested_action": safe_context.get("requested_action"),
        "ai_generated_recommendation": safe_context.get("ai_generated_recommendation"),
        "data_summary": safe_context.get("data_summary"),
        "risk_flags": safe_context.get("risk_flags"),
    }
    try:
        result = db.table("approvals").insert(payload).execute()
    except Exception as exc:
        # Older databases without the approval-evidence migration reject the
        # extra columns. Keep approvals working and let the migration add the
        # richer evidence fields where available.
        if not _looks_like_missing_column_error(exc, APPROVAL_EVIDENCE_COLUMNS):
            raise
        fallback = {k: v for k, v in payload.items() if k not in APPROVAL_EVIDENCE_COLUMNS}
        result = db.table("approvals").insert(fallback).execute()
    if hasattr(result, "error") and result.error:
        fallback = {k: v for k, v in payload.items() if k not in APPROVAL_EVIDENCE_COLUMNS}
        result = db.table("approvals").insert(fallback).execute()
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
    return result.data if result is not None else None


# ─── Resource Locking ─────────────────────────────────────────────────────────

LOCK_TTL_MINUTES = 30


async def acquire_resource_lock(db: Client, run_id: str, resource_type: str, resource_id: str) -> bool:
    """
    Try to acquire a resource lock. Returns True if acquired, False if conflict.
    Uses INSERT with ON CONFLICT DO NOTHING to be atomic.
    """
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=LOCK_TTL_MINUTES)).isoformat()

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


async def get_existing_lock(db: Client, resource_type: str, resource_id: str) -> Optional[dict]:
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
    return result.data if result is not None else None


# Run statuses that mean the run is no longer doing work. A lock still held by
# such a run is orphaned (the run was stopped/killed/crashed before releasing
# it) and must not block new runs for the full lock TTL.
_TERMINAL_RUN_STATUSES = ("completed", "success", "partial", "failed", "cancelled")

# A lock held by a run that started this long ago AND has no fresh watcher
# heartbeat means the run was killed (process OOM/redeploy) without releasing
# its locks and left its status stuck at "running". This must clear the paid
# tier's *active* execution ceiling (MAX_EXECUTION_TIME_PAID = 1800s) with
# margin — the old 15-min value reaped legitimate long paid runs mid-flight
# (R13). Genuinely long-but-alive runs (e.g. paused up to ~24h on an approval)
# renew their lock TTL and are exempted from this sweep by their heartbeat.
_ORPHAN_RUN_AGE_SECONDS = 60 * 60

# A run whose watcher wrote a heartbeat within this window is actively being
# watched (a live suspend/resume wait loop, ~30s poll cadence), so its lock is
# NOT orphaned even if the run started long ago. Generous vs. the poll cadence
# to tolerate transient DB hiccups.
_WATCHER_HEARTBEAT_FRESH_SECONDS = 5 * 60


async def cleanup_stale_locks(db: Client) -> int:
    """Delete locks that are either time-expired or orphaned.

    A lock is orphaned when the run that holds it can no longer release it:
      * the run is already in a terminal state (or no longer exists), or
      * the run is still marked "running" but started long enough ago that it
        must have been killed before its ``release_run_locks`` ran.

    Without this cleanup such a lock keeps every new run that touches the same
    connection blocked in the queue-wait path for up to the full
    ``LOCK_TTL_MINUTES`` window — which surfaces as runs that never start.
    """
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    deleted = 0

    # 1. Time-expired locks.
    expired = db.table("resource_locks").delete().lt("expires_at", now_iso).execute()
    deleted += len(expired.data or [])

    # 2. Locks whose holding run is terminal, missing, or a long-dead "running".
    remaining = db.table("resource_locks").select("id, locked_by_run_id").execute()
    rows = remaining.data or []
    run_ids = list({r["locked_by_run_id"] for r in rows if r.get("locked_by_run_id")})
    if not run_ids:
        return deleted

    # watcher_heartbeat_at may be absent on older DBs (migration not yet
    # applied); PostgREST just omits the key, and the freshness check below
    # treats a missing/blank value as "no heartbeat" — the safe direction.
    try:
        runs_res = (
            db.table("runs").select("id, status, started_at, watcher_heartbeat_at").in_("id", run_ids).execute()
        )
    except Exception:
        runs_res = db.table("runs").select("id, status, started_at").in_("id", run_ids).execute()
    runs_by_id = {r["id"]: r for r in (runs_res.data or [])}

    def _has_fresh_heartbeat(run: dict) -> bool:
        hb = run.get("watcher_heartbeat_at")
        if not hb:
            return False
        try:
            beat = datetime.fromisoformat(str(hb).replace("Z", "+00:00"))
            if beat.tzinfo is None:
                beat = beat.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            return False
        return (now - beat).total_seconds() <= _WATCHER_HEARTBEAT_FRESH_SECONDS

    def _is_orphaned(run_id: str) -> bool:
        run = runs_by_id.get(run_id)
        if run is None:
            return True
        if run.get("status") in _TERMINAL_RUN_STATUSES:
            return True
        # A run actively watched by a live wait loop (approval / ask_user / file
        # op) is not orphaned no matter how long ago it started (R13).
        if _has_fresh_heartbeat(run):
            return False
        started_at = run.get("started_at")
        if started_at:
            try:
                started = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
                if started.tzinfo is None:
                    started = started.replace(tzinfo=timezone.utc)
                if (now - started).total_seconds() > _ORPHAN_RUN_AGE_SECONDS:
                    return True
            except (ValueError, TypeError):
                pass
        return False

    orphan_ids = [r["id"] for r in rows if _is_orphaned(r["locked_by_run_id"])]
    if orphan_ids:
        orphaned = db.table("resource_locks").delete().in_("id", orphan_ids).execute()
        deleted += len(orphaned.data or [])

    return deleted


async def get_credential(ref: str, user_id: str) -> dict:
    db = get_db()
    result = db.rpc("get_decrypted_secret", {"secret_name": f"{ref}_{user_id}"}).execute()
    if not result.data:
        raise ValueError(f"Credential '{ref}' not found for user")
    return result.data


# ─── Desktop file operations ──────────────────────────────────────────────────
#
# The runtime never touches a user's filesystem. A `file` connection node enqueues
# a file_operations row addressed to a paired device, then suspends until the
# desktop Bridge claims it, runs it locally inside its granted folders, and writes
# back a result/error. Same suspend/resume mechanism as approvals / ask_user.

# A file operation the Bridge does not pick up within this window fails the node
# with a "waiting for your device" error rather than hanging the run.
FILE_OPERATION_TTL_MINUTES = 30


# Platforms whose devices run the desktop Bridge and can execute file operations.
# Mobile devices (ios/android) live in the same table for push 2FA but must NEVER
# become the file-op "default device" — they can't run file ops. Keep this in
# lockstep with resolveDefaultDeviceId (apps/web/lib/triggers/file-watch.ts).
_FILE_OP_CAPABLE_PLATFORMS = {"macos", "windows", "linux", "unknown"}


def resolve_default_device(db: Client, workspace_id: str) -> Optional[str]:
    """Pick the device a file node should target when none is pinned.

    Returns the id of the workspace's most-recently-seen active (non-revoked)
    desktop Bridge device, or None when the workspace has no usable device paired.
    Mobile (ios/android) devices are excluded — they cannot execute file ops.
    """
    if not workspace_id:
        return None
    try:
        result = (
            db.table("devices")
            .select("id, platform, last_seen_at, paired_at")
            .eq("workspace_id", workspace_id)
            .is_("revoked_at", "null")
            .execute()
        )
    except Exception:
        return None
    rows = [r for r in (result.data or []) if r.get("platform") in _FILE_OP_CAPABLE_PLATFORMS]
    if not rows:
        return None

    def _seen_key(row: dict) -> str:
        # Prefer last_seen_at, fall back to paired_at; "" sorts last.
        return str(row.get("last_seen_at") or row.get("paired_at") or "")

    rows.sort(key=_seen_key, reverse=True)
    return rows[0]["id"]


async def enqueue_file_operation(
    db: Client,
    *,
    run_id: str,
    node_execution_id: Optional[str],
    device_id: Optional[str],
    workspace_id: str,
    user_id: str,
    op_type: str,
    args: dict,
    ttl_minutes: int = FILE_OPERATION_TTL_MINUTES,
) -> dict:
    """Insert a pending file_operations row for the Bridge to execute.

    `args` may transiently carry write content so it reaches the device; the row
    is part of the queue, not the durable audit record. Secrets are redacted as a
    defence-in-depth measure even though file args are not expected to hold any.
    """
    # Authorization backstop (cross-tenant): the target device MUST belong to this
    # run's workspace and be active. The agent file tool reads device_id from
    # model-generated tool args (prompt-injectable), and a forked/shared workflow
    # can carry a device_id pinned to another workspace. bridge/poll only filters
    # by device_id, so without this check a run could address another tenant's
    # device and read/write files inside its granted folders.
    if not device_id:
        raise ValueError("A target device is required for a file operation.")
    owned = (
        db.table("devices")
        .select("id, platform")
        .eq("id", device_id)
        .eq("workspace_id", workspace_id)
        .is_("revoked_at", "null")
        .limit(1)
        .execute()
    )
    if not owned.data:
        raise ValueError("Target device is not a usable device in this workspace.")
    # A pinned device_id bypasses resolve_default_device, so re-assert the
    # platform guard here: a phone (ios/android) can never run file ops, and the
    # Bridge would never claim the row — it would just stall and time out.
    if owned.data[0].get("platform") not in _FILE_OP_CAPABLE_PLATFORMS:
        raise ValueError("Target device cannot execute file operations.")

    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=max(1, ttl_minutes))).isoformat()
    payload = {
        "run_id": run_id,
        "node_execution_id": node_execution_id,
        "device_id": device_id,
        "workspace_id": workspace_id,
        "user_id": user_id,
        "op_type": op_type,
        "args": redact_secrets(args) if isinstance(args, dict) else {},
        "status": "pending",
        "expires_at": expires_at,
    }
    result = db.table("file_operations").insert(payload).execute()
    if not result.data:
        raise RuntimeError(f"DB insert for file_operation (run={run_id}, op={op_type}) returned no data")
    return result.data[0]


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
                cron_workflows.append(
                    {
                        "id": row["id"],
                        "cron_expression": config.get("cron_expression", "0 * * * *"),
                    }
                )
                break
    return cron_workflows
