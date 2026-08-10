from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Optional, TypeVar

from schema import RetryConfig

from engine.circuit_breaker import CircuitOpenError
from engine.circuit_breaker import get_llm_circuit, get_oauth_token_circuit
from engine.circuit_breaker import CircuitState
from engine.run_limits import RunLimitExceeded

# Local copy to avoid circular import
RETRYABLE_LLM_STATUS_CODES = {408, 409, 425, 429, 500, 502, 503, 504}

T = TypeVar("T")


class ExecutionError(Exception):
    """Execution error with code and node context."""

    def __init__(self, code: str, message: str, node_id: str):
        self.code = code
        self.message = message
        self.node_id = node_id
        super().__init__(f"[{code}] {message} (node: {node_id})")


class BackoffType(str, Enum):
    """Supported backoff strategies."""

    NONE = "none"
    LINEAR = "linear"
    EXPONENTIAL = "exponential"


class RetryOutcome(str, Enum):
    """Outcome of a retry attempt."""

    SUCCESS = "success"
    RETRYING = "retrying"
    EXHAUSTED = "exhausted"
    NON_RETRYABLE = "non_retryable"
    TIMEOUT = "timeout"
    CIRCUIT_OPEN = "circuit_open"
    RUN_LIMIT_EXCEEDED = "run_limit_exceeded"


@dataclass
class RetryPolicy:
    """
    Per-node retry policy configuration.

    This dataclass extends the schema RetryConfig with additional runtime
    configuration options like per-attempt timeout and circuit breaker integration.
    """

    max_attempts: int = 3
    backoff_type: BackoffType = BackoffType.EXPONENTIAL
    backoff_base_seconds: float = 1.0
    backoff_max_seconds: float = 60.0
    backoff_jitter: bool = True
    fail_program_on_exhaust: bool = False
    timeout_per_attempt_seconds: float = 30.0
    timeout_total_seconds: float = 120.0
    retryable_status_codes: set[int] = field(default_factory=lambda: {408, 409, 425, 429, 500, 502, 503, 504})
    retryable_exceptions: tuple[type[Exception], ...] = (
        asyncio.TimeoutError,
        TimeoutError,
        ConnectionError,
        ConnectionRefusedError,
        ConnectionResetError,
        CircuitOpenError,
        RunLimitExceeded,
    )
    non_retryable_status_codes: set[int] = field(default_factory=lambda: set(range(400, 500)) - {408, 409, 425, 429})
    non_retryable_exceptions: tuple[type[Exception], ...] = ()

    @classmethod
    def from_retry_config(cls, config: RetryConfig, node_type: str = "default") -> "RetryPolicy":
        """Create a RetryPolicy from a schema RetryConfig with node-type defaults."""
        # Node-type specific defaults for timeouts
        timeout_defaults = {
            "agent": 60.0,
            "agent_task": 120.0,
            "connection": 30.0,
            "step": 10.0,
            "trigger": 10.0,
            "default": 30.0,
        }
        total_timeout_defaults = {
            "agent": 180.0,
            "agent_task": 300.0,
            "connection": 90.0,
            "step": 30.0,
            "trigger": 30.0,
            "default": 120.0,
        }

        backoff_map = {
            "none": BackoffType.NONE,
            "linear": BackoffType.LINEAR,
            "exponential": BackoffType.EXPONENTIAL,
        }

        return cls(
            max_attempts=config.max_attempts,
            backoff_type=backoff_map.get(config.backoff, BackoffType.EXPONENTIAL),
            backoff_base_seconds=config.backoff_base_seconds,
            backoff_max_seconds=60.0,  # Cap at 60 seconds max backoff
            backoff_jitter=True,
            fail_program_on_exhaust=config.fail_program_on_exhaust,
            timeout_per_attempt_seconds=timeout_defaults.get(node_type, 30.0),
            timeout_total_seconds=total_timeout_defaults.get(node_type, 120.0),
            retryable_status_codes=RETRYABLE_LLM_STATUS_CODES,
        )

    def calculate_delay(self, attempt: int) -> float:
        """Calculate the delay for a given attempt number (1-indexed)."""
        if self.backoff_type == BackoffType.NONE:
            return 0.0
        elif self.backoff_type == BackoffType.LINEAR:
            delay = self.backoff_base_seconds * attempt
        elif self.backoff_type == BackoffType.EXPONENTIAL:
            delay = self.backoff_base_seconds * (2 ** (attempt - 1))
        else:
            delay = 0.0

        # Cap at max backoff
        delay = min(delay, self.backoff_max_seconds)

        # Add jitter (±25%)
        if self.backoff_jitter and delay > 0:
            import random

            jitter_range = delay * 0.25
            delay = delay + (random.random() * 2 - 1) * jitter_range
            delay = max(0.0, delay)

        return delay

    def is_retryable_error(self, error: Exception) -> bool:
        """Determine if an error is retryable based on policy configuration."""
        # Check non-retryable exceptions first
        if self.non_retryable_exceptions and isinstance(error, self.non_retryable_exceptions):
            return False

        # Check retryable exceptions
        if isinstance(error, self.retryable_exceptions):
            return True

        # Status-code classification works off the message text, so apply it to
        # ANY exception. LLM calls raise plain Exception("LLM API error 401 …"),
        # which previously skipped this branch (it was gated on ExecutionError)
        # and fell through to the "retry unknown errors" default — burning the
        # full retry budget on permanent 401s from dead keys.
        status_code = self._extract_status_code(error)
        if status_code is not None:
            if status_code in self.non_retryable_status_codes:
                return False
            if status_code in self.retryable_status_codes:
                return True
            # Default: retry 5xx, don't retry 4xx
            return 500 <= status_code < 600

        # Check for rate limit / timeout patterns in error message
        error_msg = str(error).lower()
        retryable_patterns = (
            "rate limit",
            "rate-limit",
            "temporarily unavailable",
            "temporarily rate-limited",
            "provider returned error",
            "upstream",
            "timeout",
            "connection reset",
            "connection refused",
            "circuit open",
        )
        if any(pattern in error_msg for pattern in retryable_patterns):
            return True

        # Check for non-retryable patterns (auth errors, invalid requests, etc.)
        non_retryable_patterns = (
            "invalid api key",
            "invalid_api_key",
            "incorrect api key",
            "user not found",
            "authentication_error",
            "no api key provided",
            "you didn't provide an api key",
            "credit balance is too low",
            "insufficient credits",
            "insufficient_quota",
            "exceeded your current quota",
            "you've exceeded",
            "billing hard limit",
            "invalid model",
            "model not found",
            "bad request",
        )
        if any(pattern in error_msg for pattern in non_retryable_patterns):
            return False

        # Default: retry on unknown errors (conservative)
        return True

    def _extract_status_code(self, error: Exception) -> int | None:
        """Extract HTTP status code from an exception message."""
        import re

        match = re.search(r"LLM API error\s+(\d{3})", str(error))
        if not match:
            match = re.search(r"returned (\d{3})", str(error))
        if match:
            try:
                return int(match.group(1))
            except ValueError:
                pass
        return None


@dataclass
class RetryAttempt:
    """Record of a single retry attempt."""

    attempt: int
    start_time: float
    end_time: float | None = None
    error: Exception | None = None
    outcome: RetryOutcome = RetryOutcome.RETRYING
    delay_before: float = 0.0

    @property
    def duration(self) -> float:
        """Duration of this attempt in seconds."""
        end = self.end_time or time.monotonic()
        return end - self.start_time


@dataclass
class RetryResult:
    """Result of a retry execution."""

    success: bool
    result: Any = None
    error: Exception | None = None
    attempts: list[RetryAttempt] = field(default_factory=list)
    total_duration: float = 0.0
    final_outcome: RetryOutcome = RetryOutcome.SUCCESS

    @property
    def attempt_count(self) -> int:
        return len(self.attempts)

    @property
    def was_retried(self) -> bool:
        return self.attempt_count > 1


class RetryExecutor:
    """
    Executes an async callable with retry logic, exponential backoff, and timeouts.

    Features:
    - Configurable max attempts with exponential/linear/no backoff
    - Per-attempt and total timeout enforcement
    - Jitter support for backoff
    - Circuit breaker integration (LLM and OAuth circuits)
    - Run limit enforcement integration
    - Detailed attempt tracking for observability
    - Configurable retryable/non-retryable error classification
    """

    def __init__(
        self,
        policy: RetryPolicy,
        node_id: str,
        run_id: str,
        node_type: str,
        db: Any = None,
        update_node_execution: Callable | None = None,
        node_telemetry_fn: Callable[[str], dict] | None = None,
    ):
        """
        Initialize the RetryExecutor.

        Args:
            policy: RetryPolicy configuration
            node_id: ID of the node being executed
            run_id: ID of the current run
            node_type: Type of node (agent, agent_task, connection, step, trigger)
            db: Database connection (for updating node execution records)
            update_node_execution: Async callback to update node execution record
            node_telemetry_fn: Function to get telemetry payload for node updates
        """
        self.policy = policy
        self.node_id = node_id
        self.run_id = run_id
        self.node_type = node_type
        self.db = db
        self._update_node_execution = update_node_execution
        self._node_telemetry_fn = node_telemetry_fn or (lambda node_id: {})

    async def execute(self, fn: Callable[[], T]) -> RetryResult:
        """
        Execute the async callable with retry logic.

        Args:
            fn: Async callable to execute

        Returns:
            RetryResult with success status, result/error, and attempt history
        """
        start_time = time.monotonic()
        attempts: list[RetryAttempt] = []
        last_error: Exception | None = None

        # Initialize circuit breakers for this node type
        llm_circuit = get_llm_circuit() if self.node_type in ("agent", "agent_task") else None
        oauth_circuit = get_oauth_token_circuit() if self.node_type == "connection" else None

        for attempt_num in range(1, self.policy.max_attempts + 1):
            attempt_start = time.monotonic()

            # Calculate delay before this attempt (except first)
            if attempt_num > 1:
                delay = self.policy.calculate_delay(attempt_num - 1)
            else:
                delay = 0.0

            attempt = RetryAttempt(
                attempt=attempt_num,
                start_time=attempt_start,
                delay_before=delay,
            )
            attempts.append(attempt)

            # Apply delay before retry (not before first attempt)
            if delay > 0:
                await asyncio.sleep(delay)

            # Check total timeout
            elapsed_total = time.monotonic() - start_time
            if elapsed_total >= self.policy.timeout_total_seconds:
                attempt.end_time = time.monotonic()
                attempt.outcome = RetryOutcome.TIMEOUT
                attempt.error = TimeoutError(f"Total timeout exceeded ({self.policy.timeout_total_seconds}s)")
                last_error = attempt.error
                break

            # Check circuit breakers before attempt
            if llm_circuit and llm_circuit.state == CircuitState.OPEN:
                attempt.end_time = time.monotonic()
                attempt.outcome = RetryOutcome.CIRCUIT_OPEN
                attempt.error = CircuitOpenError("LLM circuit breaker is open")
                last_error = attempt.error
                break

            if oauth_circuit and oauth_circuit.state == CircuitState.OPEN:
                attempt.end_time = time.monotonic()
                attempt.outcome = RetryOutcome.CIRCUIT_OPEN
                attempt.error = CircuitOpenError("OAuth token circuit breaker is open")
                last_error = attempt.error
                break

            try:
                # Execute with per-attempt timeout
                result = await asyncio.wait_for(
                    fn(),
                    timeout=self.policy.timeout_per_attempt_seconds,
                )

                attempt.end_time = time.monotonic()
                attempt.outcome = RetryOutcome.SUCCESS

                # Record success telemetry
                await self._record_attempt(attempt, success=True)

                return RetryResult(
                    success=True,
                    result=result,
                    attempts=attempts,
                    total_duration=time.monotonic() - start_time,
                    final_outcome=RetryOutcome.SUCCESS,
                )

            except asyncio.TimeoutError as e:
                attempt.end_time = time.monotonic()
                attempt.outcome = RetryOutcome.TIMEOUT
                attempt.error = TimeoutError(f"Attempt timed out after {self.policy.timeout_per_attempt_seconds}s")
                last_error = attempt.error

            except RunLimitExceeded as e:
                attempt.end_time = time.monotonic()
                attempt.outcome = RetryOutcome.RUN_LIMIT_EXCEEDED
                attempt.error = e
                last_error = e
                # Run limit exceeded is never retryable
                break

            except CircuitOpenError as e:
                attempt.end_time = time.monotonic()
                attempt.outcome = RetryOutcome.CIRCUIT_OPEN
                attempt.error = e
                last_error = e
                # Circuit open is retryable (may close on next attempt)
                # but we break to avoid hammering a open circuit
                break

            except ExecutionError as e:
                attempt.end_time = time.monotonic()
                attempt.error = e

                # ExecutionError with non-retryable status codes should not retry
                if not self.policy.is_retryable_error(e):
                    attempt.outcome = RetryOutcome.NON_RETRYABLE
                    last_error = e
                    break

                attempt.outcome = RetryOutcome.RETRYING
                last_error = e

            except Exception as e:
                attempt.end_time = time.monotonic()
                attempt.error = e

                if not self.policy.is_retryable_error(e):
                    attempt.outcome = RetryOutcome.NON_RETRYABLE
                    last_error = e
                    break

                attempt.outcome = RetryOutcome.RETRYING
                last_error = e

            # Record attempt telemetry
            await self._record_attempt(attempt, success=False)

            # Check if we've exhausted retries
            if attempt_num >= self.policy.max_attempts:
                attempt.outcome = RetryOutcome.EXHAUSTED
                break

        # All attempts exhausted or non-retryable error
        total_duration = time.monotonic() - start_time

        final_outcome = attempts[-1].outcome if attempts else RetryOutcome.EXHAUSTED
        if final_outcome == RetryOutcome.RETRYING:
            final_outcome = RetryOutcome.EXHAUSTED

        # Record final failure
        if self._update_node_execution and self.db:
            try:
                await self._update_node_execution(
                    self.db,
                    self.run_id,
                    self.node_id,
                    status="failed" if self.policy.fail_program_on_exhaust else "failed",
                    retry_count=len(attempts),
                    error_message=str(last_error) if last_error else "Unknown error after retries",
                    completed_at="now()",
                    **self._node_telemetry_fn(self.node_id),
                )
            except Exception:
                pass  # Best effort telemetry

        return RetryResult(
            success=False,
            result=None,
            error=last_error,
            attempts=attempts,
            total_duration=total_duration,
            final_outcome=final_outcome,
        )

    async def _record_attempt(self, attempt: RetryAttempt, success: bool) -> None:
        """Record attempt telemetry to database if callbacks are configured."""
        if not self._update_node_execution or not self.db:
            return

        try:
            telemetry = self._node_telemetry_fn(self.node_id)
            await self._update_node_execution(
                self.db,
                self.run_id,
                self.node_id,
                retry_count=attempt.attempt,
                error_message=str(attempt.error) if attempt.error and not success else None,
                **telemetry,
            )
        except Exception:
            pass  # Best effort telemetry


def create_retry_policy_for_node(
    node_config: Any,
    node_type: str,
    default_timeout_per_attempt: float = 30.0,
    default_timeout_total: float = 120.0,
) -> RetryPolicy:
    """
    Factory function to create a RetryPolicy from a node config.

    Args:
        node_config: The node config object (AgentConfig, AgentTaskConfig, etc.)
        node_type: Type of node (agent, agent_task, connection, step, trigger)
        default_timeout_per_attempt: Default per-attempt timeout
        default_timeout_total: Default total timeout

    Returns:
        Configured RetryPolicy
    """
    # Extract retry config from node config if present
    retry_config = getattr(node_config, "retry", None)

    if retry_config is None:
        # Use defaults based on node type
        return RetryPolicy(
            max_attempts=3,
            backoff_type=BackoffType.EXPONENTIAL,
            backoff_base_seconds=1.0,
            fail_program_on_exhaust=False,
            timeout_per_attempt_seconds=default_timeout_per_attempt,
            timeout_total_seconds=default_timeout_total,
        )

    if isinstance(retry_config, RetryConfig):
        return RetryPolicy.from_retry_config(retry_config, node_type)

    if isinstance(retry_config, dict):
        return RetryPolicy.from_retry_config(RetryConfig(**retry_config), node_type)

    return RetryPolicy(
        max_attempts=3,
        backoff_type=BackoffType.EXPONENTIAL,
        backoff_base_seconds=1.0,
        fail_program_on_exhaust=False,
        timeout_per_attempt_seconds=default_timeout_per_attempt,
        timeout_total_seconds=default_timeout_total,
    )


__all__ = [
    "BackoffType",
    "RetryOutcome",
    "RetryPolicy",
    "RetryAttempt",
    "RetryResult",
    "RetryExecutor",
    "create_retry_policy_for_node",
]