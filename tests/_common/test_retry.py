"""_common.retry 검증: 지정 예외만 재시도하고 마지막 예외를 그대로 올립니다."""

from __future__ import annotations

import pytest

from _common.retry import with_backoff


class Transient(Exception):
    pass


class Permanent(Exception):
    pass


async def _run(fn, **kwargs):
    async for attempt in with_backoff(initial_wait=0, max_wait=0, **kwargs):
        with attempt:
            return await fn()
    raise AssertionError("unreachable")


async def test_retries_until_success():
    calls = []

    async def flaky():
        calls.append(1)
        if len(calls) < 3:
            raise Transient("try again")
        return "ok"

    assert await _run(flaky, max_attempts=3, retry_on=(Transient,)) == "ok"
    assert len(calls) == 3


async def test_reraises_original_after_max_attempts():
    calls = []

    async def always():
        calls.append(1)
        raise Transient("still down")

    with pytest.raises(Transient, match="still down"):
        await _run(always, max_attempts=2, retry_on=(Transient,))
    assert len(calls) == 2


async def test_does_not_retry_other_exceptions():
    calls = []

    async def permanent():
        calls.append(1)
        raise Permanent("4xx")

    with pytest.raises(Permanent):
        await _run(permanent, max_attempts=5, retry_on=(Transient,))
    assert len(calls) == 1


def test_default_policy():
    retrying = with_backoff()
    assert retrying.stop.max_attempt_number == 2
    assert retrying.reraise is True
