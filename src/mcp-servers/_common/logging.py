"""구조화 로깅. JSON 포맷, 파라미터 자동 해싱."""

from __future__ import annotations

import hashlib
import json
import logging
import sys
from typing import Any


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        # extra 필드 병합
        for key, value in record.__dict__.items():
            if key in {
                "args",
                "asctime",
                "created",
                "exc_info",
                "exc_text",
                "filename",
                "funcName",
                "levelname",
                "levelno",
                "lineno",
                "message",
                "module",
                "msecs",
                "msg",
                "name",
                "pathname",
                "process",
                "processName",
                "relativeCreated",
                "stack_info",
                "thread",
                "threadName",
            }:
                continue
            payload[key] = value
        return json.dumps(payload, ensure_ascii=False)


def setup_logger(server_name: str) -> logging.Logger:
    """서버명 기반 logger를 반환. JSON 포맷, 중복 등록 방지."""
    logger = logging.getLogger(server_name)
    if logger.handlers:
        return logger
    # ponytail: stdio MCP transport은 stdout을 JSONRPC 전용으로 예약하므로 stderr로 출력
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    return logger


def hash_params(params: dict[str, Any]) -> str:
    """입력 파라미터 dict의 SHA256 short hash. 민감정보 원문 저장 방지용."""
    blob = json.dumps(params, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]
