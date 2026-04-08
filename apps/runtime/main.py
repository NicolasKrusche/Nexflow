from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from db import get_active_cron_workflows, get_db, release_run_locks, update_run
from engine.executor import ExecutionError, ProgramExecutor
from schema import ProgramSchema, parse_schema

load_dotenv()

scheduler = AsyncIOScheduler()


def parse_cron(expression: str) -> dict:
    """Split a 5-field cron string into APScheduler kwargs."""
    fields = expression.strip().split()
    if len(fields) != 5:
        raise ValueError(f"Expected 5-field cron expression, got: {expression!r}")
    minute, hour, day, month, day_of_week = fields
    return {
        "minute": minute,
        "hour": hour,
        "day": day,
        "month": month,
        "day_of_week": day_of_week,
    }


async def trigger_workflow(workflow_id: str) -> None:
    db = get_db()
    result = db.table("programs").select("*").eq("id", workflow_id).single().execute()
    program_data = result.data
    if not program_data:
        return
    schema = parse_schema(program_data.get("schema") or {})
    run_result = (
        db.table("runs")
        .insert({
            "program_id": workflow_id,
            "triggered_by": "cron",
            "trigger_payload": None,
            "status": "running",
            "started_at": "now()",
        })
        .execute()
    )
    run_id = run_result.data[0]["id"]
    user_id = program_data.get("user_id", "")
    executor = ProgramExecutor(schema, run_id, user_id)
    try:
        await executor.execute(None)
        await update_run(db, run_id, status="completed", completed_at="now()")
    except ExecutionError as e:
        await update_run(db, run_id, status="failed", error_message=e.message, completed_at="now()")
    except Exception as e:
        await update_run(db, run_id, status="failed", error_message=str(e), completed_at="now()")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    workflows = await get_active_cron_workflows()
    for w in workflows:
        try:
            scheduler.add_job(
                trigger_workflow,
                "cron",
                **parse_cron(w.get("cron_expression", "0 * * * *")),
                args=[w["id"]],
            )
        except ValueError:
            pass  # Skip workflows with invalid cron expressions
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="FlowOS Runtime", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def verify_runtime_secret(x_runtime_secret: str = Header(...)) -> None:
    expected = os.environ.get("RUNTIME_SECRET")
    if not expected or x_runtime_secret != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


class ExecuteRequest(BaseModel):
    run_id: str
    program_id: str
    user_id: str
    schema: dict[str, Any]
    trigger_payload: Optional[dict[str, Any]] = None
    triggered_by: str = "manual"


@app.post("/execute")
async def execute_program(
    body: ExecuteRequest,
    background_tasks: BackgroundTasks,
    x_runtime_secret: str = Header(...),
) -> dict[str, str]:
    verify_runtime_secret(x_runtime_secret)
    schema = parse_schema(body.schema)
    background_tasks.add_task(
        _run_program, schema, body.run_id, body.user_id, body.trigger_payload
    )
    return {"status": "started", "run_id": body.run_id}


RUN_TIMEOUT_SECONDS = 600  # 10 minutes max per run


async def _run_program(
    schema: ProgramSchema,
    run_id: str,
    user_id: str,
    trigger_payload: Optional[dict[str, Any]],
) -> None:
    db = get_db()
    try:
        executor = ProgramExecutor(schema, run_id, user_id)
        await asyncio.wait_for(executor.execute(trigger_payload), timeout=RUN_TIMEOUT_SECONDS)
        await update_run(db, run_id, status="completed", completed_at="now()")
    except asyncio.TimeoutError:
        await update_run(
            db, run_id, status="failed",
            error_message=f"Run exceeded maximum execution time ({RUN_TIMEOUT_SECONDS}s)",
            completed_at="now()",
        )
    except ExecutionError as e:
        await update_run(
            db, run_id, status="failed", error_message=e.message, completed_at="now()"
        )
    except Exception as e:
        await update_run(
            db, run_id, status="failed", error_message=str(e), completed_at="now()"
        )
    finally:
        await release_run_locks(db, run_id)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
