"""SQL dialect 선택. ``NL2SQL_DB_DIALECT`` (``postgres`` 기본, ``oracle``) 로 고릅니다."""

from __future__ import annotations

from functools import cache

from nl2sql_mcp.db.dialects.base import CatalogQueries, SQLDialect
from nl2sql_mcp.db.dialects.oracle import OracleDialect
from nl2sql_mcp.db.dialects.postgres import PostgresDialect

__all__ = [
    "CatalogQueries",
    "SQLDialect",
    "OracleDialect",
    "PostgresDialect",
    "SUPPORTED_DIALECTS",
    "get_dialect",
]

SUPPORTED_DIALECTS: dict[str, type[SQLDialect]] = {
    "postgres": PostgresDialect,
    "oracle": OracleDialect,
}

# 사용자가 흔히 쓰는 별칭
_ALIASES = {"postgresql": "postgres", "pg": "postgres"}


@cache
def _instance(name: str) -> SQLDialect:
    return SUPPORTED_DIALECTS[name]()


def get_dialect(name: str | None = None) -> SQLDialect:
    """이름으로 dialect 를 돌려줍니다. ``None`` 이면 설정값(``NL2SQL_DB_DIALECT``)을 씁니다."""
    if name is None:
        from nl2sql_mcp.config import settings

        name = settings.nl2sql_db_dialect
    key = _ALIASES.get(name.strip().lower(), name.strip().lower())
    if key not in SUPPORTED_DIALECTS:
        raise ValueError(
            f"Unsupported NL2SQL_DB_DIALECT value: {name!r} (supported: {', '.join(SUPPORTED_DIALECTS)})"
        )
    return _instance(key)
