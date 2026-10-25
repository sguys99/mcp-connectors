"""nl2sql-mcp 에러 코드 정본.

모든 도구 에러 메시지는 ``... [CODE]`` 로 끝나고, ``CODE`` 는
:data:`ERROR_CODES` 중 하나입니다(정의서 §5, §7, §9).
감사 로그의 ``result_status`` 분류(:data:`BLOCKED_CODES`)와
시나리오 러너(``scripts/run_mcp_tests.py``)가 이 목록을 함께 씁니다.
새 코드를 메시지에 넣으면 여기에도 더하세요. 소스의 ``[CODE]`` 태그와
이 목록이 어긋나면 ``tests/nl2sql_mcp/test_error_codes.py`` 가 실패해요.

다른 모듈을 import 하지 않아 서버 설정을 읽지 않고도 불러올 수 있습니다.
"""

from __future__ import annotations

# 가드레일이나 DB 권한 경계가 거부한 경우. 감사 로그에는 ``blocked`` 로 남습니다.
BLOCKED_CODES: frozenset[str] = frozenset(
    {
        "WRITE_BLOCKED",  # 7.1
        "DATE_RANGE_EXCEEDED",  # 7.2
        "FORBIDDEN_SQL_BLOCKED",  # 7.5
        "PII_COLUMN_BLOCKED",  # 7.6
        "MASS_SCAN_BLOCKED",  # 7.7
        "RISKY_SQL_BLOCKED",  # 7.9
        "ACCESS_DENIED",
    }
)

# 입력, 실행, 시스템 오류. 감사 로그에는 ``error`` 로 남습니다.
FAILURE_CODES: frozenset[str] = frozenset(
    {
        "INVALID_INPUT",
        "INVALID_SQL",
        "TABLE_NOT_FOUND",
        "TOO_MANY_TABLES",
        "TOO_MANY_COLUMNS",
        "QUERY_TIMEOUT",
        "BACKEND_UNAVAILABLE",
    }
)

ERROR_CODES: frozenset[str] = BLOCKED_CODES | FAILURE_CODES
