"""_common.logging 검증: JSON 포맷, extra 병합, stderr 출력, 파라미터 해시."""

from __future__ import annotations

import json
import logging
import sys
import uuid

from _common.logging import JsonFormatter, hash_params, setup_logger


def _record(msg: str = "hello %s", args=("world",), **extra) -> logging.LogRecord:
    record = logging.LogRecord("srv", logging.WARNING, __file__, 1, msg, args, None)
    for k, v in extra.items():
        setattr(record, k, v)
    return record


def test_json_formatter_basic_fields():
    payload = json.loads(JsonFormatter().format(_record()))
    assert payload["level"] == "WARNING"
    assert payload["logger"] == "srv"
    assert payload["msg"] == "hello world"
    assert "ts" in payload
    # LogRecord 내부 속성(pathname, lineno 등)은 내보내지 않습니다
    assert not {"pathname", "lineno", "args", "msecs"} & payload.keys()


def test_json_formatter_merges_extra_and_keeps_korean():
    payload_text = JsonFormatter().format(_record("감사 %s", ("기록",), tool="run_sql_query", rows=3))
    payload = json.loads(payload_text)
    assert payload["msg"] == "감사 기록"
    assert payload["tool"] == "run_sql_query" and payload["rows"] == 3
    assert "감사" in payload_text  # ensure_ascii=False


def test_json_formatter_includes_exception():
    try:
        raise ValueError("boom")
    except ValueError:
        record = logging.LogRecord("srv", logging.ERROR, __file__, 1, "fail", (), sys.exc_info())
    payload = json.loads(JsonFormatter().format(record))
    assert "ValueError: boom" in payload["exc"]


def test_setup_logger_writes_json_to_stderr_once(capsys):
    name = f"test-server-{uuid.uuid4().hex[:6]}"
    logger = setup_logger(name)
    assert setup_logger(name) is logger
    assert len(logger.handlers) == 1  # 다시 불러도 핸들러를 더하지 않음
    assert logger.level == logging.INFO
    logger.info("started", extra={"port": 8001})
    out = capsys.readouterr()
    assert out.out == ""  # stdio transport 는 stdout 을 JSON-RPC 에 씁니다
    line = json.loads(out.err.strip().splitlines()[-1])
    assert line["msg"] == "started" and line["port"] == 8001


def test_hash_params_is_stable_short_and_order_independent():
    a = hash_params({"sql": "SELECT 1", "max_rows": 10})
    b = hash_params({"max_rows": 10, "sql": "SELECT 1"})
    assert a == b and len(a) == 16
    assert a != hash_params({"sql": "SELECT 2", "max_rows": 10})
    assert "SELECT" not in a
    hash_params({"when": object()})  # 직렬화할 수 없는 값도 default=str 로 처리
