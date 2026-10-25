"""DB 드라이버가 돌려준 값을 JSON 친화적인 값으로 맞춥니다 (실 DB 와 Mock 의 응답 형식 통일).

| 드라이버 값 | 응답 값 |
|---|---|
| ``Decimal`` (numeric) | 소수 자리가 없으면 ``int``, 있으면 ``float`` (``4.00`` → ``4.0``). |
| | 유효 숫자가 15자리를 넘으면 정밀도를 지키려고 문자열 |
| ``datetime`` | ISO 8601 문자열 (``2022-05-24T21:53:30+00:00``) |
| ``date`` / ``time`` | ISO 8601 문자열 (``2022-02-14`` / ``21:53:30``) |
| ``timedelta`` (interval) | 초 단위 ``float`` |
| ``UUID`` | 문자열 |
| ``bytes``/``memoryview`` (bytea, RAW) | ``\\x`` 로 시작하는 16진 문자열 |
| ``list``/``tuple`` (배열) | 원소마다 같은 규칙을 적용한 리스트 |

Mock 픽스처도 같은 형식(숫자는 숫자, 시각은 ISO 8601)으로 적어 둡니다.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

# float 로 바꿔도 값이 바뀌지 않는 유효 숫자 자릿수 (IEEE 754 double 은 15자리까지 보장)
_FLOAT_SAFE_DIGITS = 15


def _decimal(value: Decimal) -> int | float | str:
    if not value.is_finite():
        return str(value)
    sign_digits_exp = value.as_tuple()
    exponent = sign_digits_exp.exponent
    if isinstance(exponent, int) and exponent >= 0:
        return int(value)  # 소수 자리가 없는 numeric (예: COUNT, SUM(integer))
    if len(sign_digits_exp.digits) <= _FLOAT_SAFE_DIGITS:
        return float(value)
    return str(value)


def normalize_value(value: Any) -> Any:
    """값 하나를 JSON 친화적으로 바꿉니다."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, Decimal):
        return _decimal(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, timedelta):
        return value.total_seconds()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return "\\x" + bytes(value).hex()
    if isinstance(value, (list, tuple)):
        return [normalize_value(v) for v in value]
    return str(value)


def normalize_row(row: Any) -> list[Any]:
    return [normalize_value(v) for v in row]
