# Python MCP 서버 공용 이미지.
# compose 의 각 서비스 `command:` 가 모듈 경로(예: starter_mcp.server --transport http)를
# 넘겨주는 멀티 진입점 구조. Makefile 의 `cd src/mcp-servers && python -m <pkg>.server`
# 패턴과 동일한 실행 시그니처를 유지한다.

FROM python:3.12-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project


FROM python:3.12-slim AS runtime

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY src/ ./src/
COPY configs/ ./configs/

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1

# 비루트 사용자로 실행합니다. /app/var 는 NL2SQL 감사 로그(audit.db) 쓰기 위치이며,
# 볼륨을 붙여도 이 소유권이 이어지도록 미리 만들어 둡니다.
RUN useradd --system --uid 10001 --no-create-home app \
    && mkdir -p /app/var \
    && chown app:app /app/var

# pyproject.toml [tool.pytest.ini_options] pythonpath = [".", "src/mcp-servers"] 와
# 동일한 import 경로를 컨테이너에서 보장 (Makefile 의 `cd src/mcp-servers` 와 등가).
WORKDIR /app/src/mcp-servers

USER app

ENTRYPOINT ["python", "-m"]
