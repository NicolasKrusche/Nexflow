"""Status-code retry classification must work for plain exceptions.

LLM calls raise plain Exception("LLM API error 401 ..."), not ExecutionError.
The classifier used to gate status extraction on ExecutionError, so permanent
401s from dead keys fell through to the "retry unknown errors" default and
burned the full retry budget (seen in prod: OpenRouter 401 "User not found"
retried to exhaustion every night).
"""

from engine.retry import RetryPolicy


def test_plain_exception_with_401_is_not_retryable() -> None:
    policy = RetryPolicy()
    err = Exception(
        "LLM API error 401 from https://openrouter.ai/api/v1 "
        '(model=nvidia/nemotron-3-super-120b-a12b:free): {"error":{"message":"User not found.","code":401}}'
    )
    assert policy.is_retryable_error(err) is False


def test_plain_exception_with_429_stays_retryable() -> None:
    policy = RetryPolicy()
    err = Exception("LLM API error 429 from https://openrouter.ai/api/v1 (model=x): rate limited")
    assert policy.is_retryable_error(err) is True


def test_plain_exception_with_500_stays_retryable() -> None:
    policy = RetryPolicy()
    err = Exception("LLM API error 500 from https://openrouter.ai/api/v1 (model=x): upstream broke")
    assert policy.is_retryable_error(err) is True


def test_user_not_found_message_is_not_retryable_even_without_status() -> None:
    policy = RetryPolicy()
    assert policy.is_retryable_error(Exception("User not found.")) is False


def test_unknown_errors_still_default_to_retry() -> None:
    policy = RetryPolicy()
    assert policy.is_retryable_error(Exception("boom")) is True
