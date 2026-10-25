"""시나리오 판정 엔진 (러너 공용).

``run_mcp_tests.py`` (NL2SQL 프로파일) 와 ``scenario_runner.py`` (범용 ``mcp_cli.py test``) 가
함께 씁니다.
서버를 호출하는 일은 하지 않고, 응답 JSON 을 받아 ``expect`` 와 비교하는 순수 함수만 둡니다.

* 에러 응답 인식: CLI 형식 ``{"error": {"code", "message"}}`` 와 MCP ``isError`` 형식
* 필드 경로: ``a.b``, ``a[0]``, ``a[-1]``, ``a[*].b``, ``a[?k=='v'].b``, ``a | length``
* 연산자: :data:`OPS` (``eq``, ``contains``, ``length_gte``, ``matches_regex`` 등)
* 판정: :func:`evaluate_expect` 가 ``status`` / ``error_code`` / ``checks`` 를 한 번에 봅니다.
"""

from __future__ import annotations

import json
import re
from collections.abc import Collection
from typing import Any

_CODE_TAG_RE = re.compile(r"\[([A-Z][A-Z0-9_]+)\]")


class _Missing:
    """경로가 없을 때의 값 (``None`` 과 구분)."""

    def __repr__(self) -> str:
        return "<missing>"


MISSING = _Missing()


class ScenarioError(Exception):
    """YAML 이 러너가 모르는 연산자, 경로, 코드를 쓸 때 (케이스 ERROR)."""


# ── 응답 해석 ──────────────────────────────────────────────────────────────


def _is_error(data: Any) -> bool:
    """CLI 에러 응답 ``{"error": {"code", "message"}}`` 또는 MCP ``isError`` 형식인지."""
    if isinstance(data, dict):
        err = data.get("error")
        if isinstance(err, dict) and ("code" in err or "message" in err):
            return True
        if data.get("isError") or data.get("is_error"):
            return True
        content = data.get("content")
        if isinstance(content, list):
            return any(isinstance(x, dict) and x.get("isError") for x in content)
        return False
    if isinstance(data, list):
        return any(isinstance(x, dict) and x.get("isError") for x in data)
    return False


def _extract_error_code(data: Any, known_codes: Collection[str] | None = None) -> str | None:
    """구조화된 ``error.code`` 가 우선이고, 없으면 메시지의 마지막 ``[CODE]`` 태그.

    ``known_codes`` 를 주면 그 안의 태그만 인정하고, ``None`` 이면 모든 태그를 인정합니다.
    """
    if isinstance(data, dict) and isinstance(data.get("error"), dict):
        code = data["error"].get("code")
        if isinstance(code, str) and code:
            return code
    text = json.dumps(data, ensure_ascii=False)
    tags = [t for t in _CODE_TAG_RE.findall(text) if known_codes is None or t in known_codes]
    return tags[-1] if tags else None


# ── 필드 경로 ──────────────────────────────────────────────────────────────

# key | [0] | [*] | [?key=='value']
_TOKEN_RE = re.compile(
    r"""\.?(?P<key>[A-Za-z_][A-Za-z0-9_]*)
      |\[(?P<index>-?\d+)\]
      |\[(?P<star>\*)\]
      |\[\?\s*(?P<fkey>[A-Za-z_][A-Za-z0-9_]*)\s*==\s*(?P<q>['"])(?P<fval>.*?)(?P=q)\s*\]""",
    re.VERBOSE,
)
_PIPES = {"length"}


def _tokenize(path: str) -> list[tuple[str, Any]]:
    tokens: list[tuple[str, Any]] = []
    pos = 0
    while pos < len(path):
        m = _TOKEN_RE.match(path, pos)
        if not m or m.end() == pos:
            raise ScenarioError(f"지원하지 않는 경로: {path!r} (위치 {pos})")
        if m.group("key") is not None:
            tokens.append(("key", m.group("key")))
        elif m.group("index") is not None:
            tokens.append(("index", int(m.group("index"))))
        elif m.group("star") is not None:
            tokens.append(("star", None))
        else:
            tokens.append(("filter", (m.group("fkey"), m.group("fval"))))
        pos = m.end()
    return tokens


def _matches_filter(item: Any, key: str, value: str) -> bool:
    if not isinstance(item, dict) or key not in item:
        return False
    actual = item[key]
    if isinstance(actual, bool):
        return str(actual).lower() == value.lower()
    return str(actual) == value


def _resolve(val: Any, tokens: list[tuple[str, Any]]) -> Any:
    for i, (kind, arg) in enumerate(tokens):
        if val is MISSING:
            return MISSING
        if kind == "key":
            val = val[arg] if isinstance(val, dict) and arg in val else MISSING
        elif kind == "index":
            val = val[arg] if isinstance(val, list) and -len(val) <= arg < len(val) else MISSING
        elif kind == "star":
            if not isinstance(val, list):
                return MISSING
            rest = tokens[i + 1 :]
            return [r for r in (_resolve(item, rest) for item in val) if r is not MISSING]
        else:  # filter: 하나만 맞으면 그 항목, 여럿이면 투영(projection)
            if not isinstance(val, list):
                return MISSING
            matched = [item for item in val if _matches_filter(item, *arg)]
            if not matched:
                return MISSING
            if len(matched) == 1:
                val = matched[0]
                continue
            rest = tokens[i + 1 :]
            return [r for r in (_resolve(item, rest) for item in matched) if r is not MISSING]
    return val


def _split_pipes(path: str) -> list[str]:
    """``|`` 로 파이프를 나눕니다. 대괄호와 따옴표 안의 ``|`` (예: ``a[?k=='x|y']``) 는 값으로 둡니다."""
    parts: list[str] = []
    depth = 0
    quote: str | None = None
    start = 0
    for i, ch in enumerate(path):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "'\"":
            quote = ch
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth = max(0, depth - 1)
        elif ch == "|" and depth == 0:
            parts.append(path[start:i].strip())
            start = i + 1
    parts.append(path[start:].strip())
    return parts


def _get_field(data: Any, path: str) -> Any:
    """``a.b``, ``a[0].b``, ``a[*].b``, ``a[?k=='v'].b``, ``a | length`` 형태의 경로 값.

    없으면 :data:`MISSING` 을 돌려줍니다.
    """
    head, *pipes = _split_pipes(path)
    val = _resolve(data, _tokenize(head))
    for pipe in pipes:
        if pipe not in _PIPES:
            raise ScenarioError(f"지원하지 않는 파이프: {pipe!r}")
        val = len(val) if isinstance(val, (list, dict, str)) else MISSING
    return val


# ── 조건 검사 ──────────────────────────────────────────────────────────────


def _present(v: Any) -> bool:
    return v is not MISSING and v is not None


def _compare(actual: Any, exp: Any, fn) -> bool:
    if not _present(actual):
        return False
    try:
        return bool(fn(actual, exp))
    except TypeError:
        return False


def _contains(actual: Any, item: Any) -> bool:
    if isinstance(actual, str):
        return str(item) in actual
    if isinstance(actual, list):
        return item in actual
    if isinstance(actual, dict):
        return item in actual
    return False


def _length(actual: Any) -> int | None:
    return len(actual) if isinstance(actual, (list, dict, str)) else None


def _contains_field(actual: Any, name: Any) -> bool:
    """dict 목록 중 하나라도 키 또는 값으로 ``name`` 을 가지면 참 (예: columns 에 name=store_id)."""
    if not isinstance(actual, list):
        return False
    return any(isinstance(x, dict) and (name in x or name in x.values()) for x in actual)


def _length_op(fn):
    def check(actual: Any, exp: Any) -> bool:
        n = _length(actual)
        return n is not None and fn(n, exp)

    return check


OPS: dict[str, Any] = {
    "eq": lambda a, e: a is not MISSING and a == e,
    "ne": lambda a, e: a is not MISSING and a != e,
    "gte": lambda a, e: _compare(a, e, lambda x, y: x >= y),
    "gt": lambda a, e: _compare(a, e, lambda x, y: x > y),
    "lte": lambda a, e: _compare(a, e, lambda x, y: x <= y),
    "lt": lambda a, e: _compare(a, e, lambda x, y: x < y),
    "exists": lambda a, e: (a is not MISSING) == (e is not False),
    "not_empty": lambda a, e: _present(a) and bool(a),
    "is_null": lambda a, e: a is None or a is MISSING,
    "not_null": lambda a, e: _present(a),
    "contains": lambda a, e: _present(a) and _contains(a, e),
    "not_contains": lambda a, e: _present(a) and not _contains(a, e),
    "contains_any": lambda a, e: _present(a) and any(_contains(a, v) for v in e),
    "contains_all": lambda a, e: _present(a) and all(_contains(a, v) for v in e),
    "contains_field": lambda a, e: _contains_field(a, e),
    "in": lambda a, e: a is not MISSING and a in e,
    "not_in": lambda a, e: a is not MISSING and a not in e,
    "length_eq": _length_op(lambda n, e: n == e),
    "length_gte": _length_op(lambda n, e: n >= e),
    "length_lte": _length_op(lambda n, e: n <= e),
    "matches_regex": lambda a, e: _present(a) and bool(re.search(e, str(a))),
}
MANUAL_OPS = {"note"}


def _check(data: Any, chk: dict) -> bool:
    op = chk.get("op")
    fn = OPS.get(op)
    if fn is None:
        raise ScenarioError(f"지원하지 않는 연산자: {op!r}")
    return fn(_get_field(data, chk["field"]), chk.get("value"))


def _short(value: Any, limit: int = 150) -> str:
    text = repr(value) if value is MISSING else json.dumps(value, ensure_ascii=False, default=str)
    return text if len(text) <= limit else text[:limit] + "..."


def evaluate_expect(
    data: Any, expect: dict[str, Any] | None, known_codes: Collection[str] | None = None
) -> tuple[str, str]:
    """응답 ``data`` 를 ``expect`` 와 비교해 ``(PASS|FAIL, 사유)`` 를 돌려줍니다.

    ``status`` 는 ``success`` (기본), ``error``, ``any`` 입니다. ``known_codes`` 를 주면 기대하는
    ``error_code`` 가 그 안에 있어야 하고, 아니면 :class:`ScenarioError` 를 던져요 (케이스 ERROR).
    ``op: note`` 검사는 사람이 확인할 항목이라 건너뜁니다.
    """
    expect = expect or {}
    exp_status = expect.get("status", "success")
    actual_error = _is_error(data)
    actual_code = _extract_error_code(data, known_codes) if actual_error else None

    if exp_status == "error":
        if not actual_error:
            return "FAIL", f"에러 기대했으나 성공 응답: {_short(data)}"
        exp_code = expect.get("error_code")
        if exp_code:
            if known_codes is not None and exp_code not in known_codes:
                raise ScenarioError(f"알 수 없는 error_code: {exp_code}")
            if actual_code != exp_code:
                return "FAIL", f"error_code 불일치: 기대={exp_code}, 실제={actual_code}"
    elif exp_status != "any" and actual_error:
        return "FAIL", f"성공 기대했으나 에러 응답: {actual_code or _short(data)}"

    for chk in expect.get("checks") or []:
        if chk.get("op") in MANUAL_OPS:
            continue
        if "field" not in chk:
            raise ScenarioError(f"check 에 field 가 없습니다: {chk!r}")
        if not _check(data, chk):
            actual_val = _get_field(data, chk["field"])
            return (
                "FAIL",
                f"check 실패: field={chk['field']} op={chk['op']} "
                f"expected={_short(chk.get('value'), 80)} actual={_short(actual_val)}",
            )
    return "PASS", ""
