from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Optional

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from db import get_db, update_run
from engine.executor import ExecutionError, ProgramExecutor
from schema import ProgramSchema, parse_schema

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    yield


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


async def _run_program(
    schema: ProgramSchema,
    run_id: str,
    user_id: str,
    trigger_payload: Optional[dict[str, Any]],
) -> None:
    db = get_db()
    try:
        executor = ProgramExecutor(schema, run_id, user_id)
        await executor.execute(trigger_payload)
        await update_run(db, run_id, status="completed", completed_at="now()")
    except ExecutionError as e:
        await update_run(
            db, run_id, status="failed", error_message=e.message, completed_at="now()"
        )
    except Exception as e:
        await update_run(
            db, run_id, status="failed", error_message=str(e), completed_at="now()"
        )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
