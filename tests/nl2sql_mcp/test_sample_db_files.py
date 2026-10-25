"""샘플 DB(docker/postgres) 파일과 Mock 백엔드가 어긋나지 않는지 확인합니다 (Docker 불필요).

- initdb/03-pagila-comments.sql 의 COMMENT ON 은 Mock 픽스처 코멘트와 같아야 합니다.
- Dockerfile 은 Pagila 를 고정 커밋과 sha256 으로 받아야 합니다.
"""

from __future__ import annotations

import re
from pathlib import Path

from nl2sql_mcp.db.mock_backend import _FIXTURE_SCHEMAS

ROOT = Path(__file__).resolve().parents[2]
PG_DIR = ROOT / "docker" / "postgres"

_IDENT = r'(?:"[^"]+"|\w+)'
_RELATION_RE = re.compile(
    rf"^COMMENT ON (?:TABLE|VIEW|MATERIALIZED VIEW) public\.({_IDENT}) IS '((?:[^']|'')*)';$", re.M
)
_COLUMN_RE = re.compile(
    rf"^COMMENT ON COLUMN public\.({_IDENT})\.({_IDENT}) IS '((?:[^']|'')*)';$", re.M
)


def _unquote(name: str) -> str:
    return name[1:-1] if name.startswith('"') else name


def _unescape(text: str) -> str:
    return text.replace("''", "'")


def test_comment_sql_matches_mock_fixtures():
    sql = (PG_DIR / "initdb" / "03-pagila-comments.sql").read_text(encoding="utf-8")

    relations = {_unquote(n): _unescape(c) for n, c in _RELATION_RE.findall(sql)}
    expected_relations = {name: s["comment"] for name, s in _FIXTURE_SCHEMAS.items()}
    assert relations == expected_relations

    columns = {(_unquote(t), _unquote(c)): _unescape(v) for t, c, v in _COLUMN_RE.findall(sql)}
    expected_columns = {
        (name, col["name"]): col["comment"]
        for name, s in _FIXTURE_SCHEMAS.items()
        for col in s["columns"]
    }
    assert columns == expected_columns


def test_comment_sql_refreshes_matview_and_analyzes():
    sql = (PG_DIR / "initdb" / "03-pagila-comments.sql").read_text(encoding="utf-8")
    assert "REFRESH MATERIALIZED VIEW public.rental_by_category;" in sql
    assert re.search(r"^ANALYZE;$", sql, re.M)


def test_dockerfile_pins_pagila_with_checksums():
    dockerfile = (PG_DIR / "Dockerfile").read_text(encoding="utf-8")
    assert re.search(r"^FROM postgres:\d+\.\d+-alpine$", dockerfile, re.M)
    assert re.search(r"^ARG PAGILA_COMMIT=[0-9a-f]{40}$", dockerfile, re.M)
    urls = re.findall(
        r"https://raw\.githubusercontent\.com/devrimgunduz/pagila/\$\{PAGILA_COMMIT\}/(\S+)", dockerfile
    )
    assert urls == ["pagila-schema.sql", "pagila-data.sql"]
    assert len(re.findall(r"--checksum=sha256:[0-9a-f]{64}", dockerfile)) == 2


def test_readonly_role_script_revokes_create():
    script = (PG_DIR / "initdb" / "04-readonly-role.sh").read_text(encoding="utf-8")
    assert "REVOKE ALL ON SCHEMA public FROM PUBLIC;" in script
    assert "default_transaction_read_only = on" in script
    assert "GRANT INSERT" not in script.upper().replace("\n", " ")
