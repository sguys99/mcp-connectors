"""Mock 픽스처가 실 샘플 DB 카탈로그와 같은지, MCP 프로토콜 경로가 실 DB 로 동작하는지 확인합니다."""

from __future__ import annotations

import json

import pytest
from fastmcp import Client
from psycopg.conninfo import conninfo_to_dict

from nl2sql_mcp.db.mock_backend import MockBackend
from nl2sql_mcp.db.postgres_connector import PostgresConnectionManager
from nl2sql_mcp.server import mcp

pytestmark = pytest.mark.integration


def _fk_set(schema: dict) -> set[tuple]:
    fks = schema["foreign_keys"]
    return {(tuple(f["columns"]), f["ref_table"], tuple(f["ref_columns"])) for f in fks}


async def test_mock_catalog_matches_real_db(pg_backend: PostgresConnectionManager):
    mock = MockBackend()
    real_tables = (await pg_backend.search_tables("%", limit=100))["tables"]
    mock_tables = (await mock.search_tables("%", limit=100))["tables"]
    assert sorted(t["table_name"] for t in real_tables) == sorted(t["table_name"] for t in mock_tables)

    mock_by_name = {t["table_name"]: t for t in mock_tables}
    for real_summary in real_tables:
        name = real_summary["table_name"]
        assert real_summary["comment"] == mock_by_name[name]["comment"], name
        assert real_summary["column_count"] == mock_by_name[name]["column_count"], name

        real = await pg_backend.get_table_schema(name)
        fixture = await mock.get_table_schema(name)
        assert real["columns"] == fixture["columns"], name
        assert real["primary_key"] == fixture["primary_key"], name
        assert _fk_set(real) == _fk_set(fixture), name


async def test_mock_row_counts_match_real_tables(pg_backend: PostgresConnectionManager):
    """테이블 행 수 추정치(ANALYZE 결과)는 Mock 과 같습니다. 뷰는 통계가 없어 둘 다 None(모름)입니다."""
    mock = MockBackend()
    real = {t["table_name"]: t for t in (await pg_backend.search_tables("%", limit=100))["tables"]}
    for t in (await mock.search_tables("%", limit=100))["tables"]:
        if t["comment"].startswith("View:"):
            assert t["estimated_rows"] is None
            assert real[t["table_name"]]["estimated_rows"] is None, t["table_name"]
        else:
            assert real[t["table_name"]]["estimated_rows"] == t["estimated_rows"], t["table_name"]


async def test_mcp_client_with_real_backend(reader_conninfo: str, monkeypatch):
    """lifespan 이 설정(backend=real)을 읽어 PostgresConnectionManager 를 만들고 도구가 동작합니다."""
    from nl2sql_mcp.config import settings

    params = conninfo_to_dict(reader_conninfo)
    monkeypatch.setattr(settings, "nl2sql_db_backend", "real")
    monkeypatch.setattr(settings, "nl2sql_db_dialect", "postgres")
    monkeypatch.setattr(settings, "nl2sql_pg_dsn", reader_conninfo)
    assert params.get("dbname") == "pagila"

    async with Client(mcp) as client:
        result = await client.call_tool("search_tables_schema", {"pattern": "rental%"})
        payload = json.loads(result.content[0].text)
        assert [t["table_name"] for t in payload["tables"]] == ["rental", "rental_by_category"]
