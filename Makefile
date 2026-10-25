help:  ## Show help
	@grep -E '^[.a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

init: ## Init env
	uv python pin 3.12.12
	uv venv .venv
	uv sync
	@echo "\n✓ Environment setup complete!"
	@echo "→ Activate with: source .venv/bin/activate"

init-dev:  ## Init dev env
	uv python pin 3.12.12
	uv venv .venv
	uv sync --all-extras --dev
	rm -f .git/hooks/pre-commit && rm -f .git/hooks/pre-commit.legacy
	uv run pre-commit install
	@echo "\n✓ Development environment setup complete!"
	@echo "→ Activate with: source .venv/bin/activate"

clean:  ## Remove venv, caches, build artifacts
	rm -rf .venv .pytest_cache .ruff_cache htmlcov .coverage coverage.xml
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
	rm -rf build dist *.egg-info
	@echo "✓ Clean complete"

test:  ## Run all Python tests (pytest, excludes -m integration; includes HTTP transport and CLI smoke)
	uv run pytest -q

coverage:  ## Run all Python tests with coverage report (terminal + htmlcov/)
	uv run pytest -q --cov --cov-report=term-missing --cov-report=html

run-starter-mcp:  ## Run starter-mcp (stdio)
	cd src/mcp-servers && uv run python -m starter_mcp.server --transport stdio

run-starter-mcp-http:  ## Run starter-mcp (Streamable HTTP, port 8001)
	cd src/mcp-servers && uv run python -m starter_mcp.server --transport http

test-starter-mcp:  ## Test starter-mcp
	uv run pytest tests/starter_mcp/ -v

run-mock-repo-mcp:  ## Run mock-repo-mcp (Streamable HTTP, port 8002)
	cd src/mcp-servers && uv run python -m mock_repo_mcp.server --transport http

test-mock-repo-mcp:  ## Test mock-repo-mcp
	uv run pytest tests/mock_repo_mcp/ -v

cli-list-servers:  ## CLI: list-servers
	uv run python scripts/mcp_cli.py list-servers

cli-list-tools-starter:  ## CLI: list-tools --server starter-mcp (stdio)
	uv run python scripts/mcp_cli.py list-tools --server starter-mcp

cli-list-tools-mock-repo:  ## CLI: list-tools --server mock-repo-mcp (HTTP; run-mock-repo-mcp 선행 필요)
	uv run python scripts/mcp_cli.py list-tools --server mock-repo-mcp

cli-call-starter:  ## CLI: call starter-mcp.echo({"text":"hi"}), 응답에 "hi" 포함이면 통과
	uv run python scripts/mcp_cli.py call --server starter-mcp --tool echo --params '{"text":"hi"}'

frontend-install:  ## Install frontend dependencies
	cd frontend && npm install

frontend-dev:  ## Run frontend dev server (port 3000)
	cd frontend && npm run dev

frontend-build:  ## Build frontend for production
	cd frontend && npm run build

frontend-test:  ## Run frontend unit tests (vitest)
	cd frontend && npm run test

test-e2e:  ## Run frontend Playwright E2E (auto-starts mock-repo-mcp)
	cd frontend && npx playwright install chromium
	cd frontend && npm run test:e2e

lint-py:  ## Lint Python (ruff check + format check)
	uv run ruff check src/ scripts/ tests/
	uv run ruff format --check src/ scripts/ tests/

lint-fe:  ## Lint frontend (eslint)
	cd frontend && npm run lint

lint-all: lint-py lint-fe  ## Run all lint gates (Python + frontend)

docker-build:  ## Build docker images (all compose services)
	docker compose build

docker-up:  ## Start docker compose stack (-d, http://localhost:3000; nl2sql-mcp runs Mock)
	docker compose up -d

docker-down:  ## Stop docker compose stack
	docker compose down

docker-logs:  ## Tail compose logs
	docker compose logs -f

run-nl2sql-mcp:  ## Run nl2sql-mcp (stdio)
	cd src/mcp-servers && uv run python -m nl2sql_mcp.server --transport stdio

run-nl2sql-mcp-http:  ## Run nl2sql-mcp (Streamable HTTP, port 8004; stop the nl2sql-mcp container first)
	cd src/mcp-servers && uv run python -m nl2sql_mcp.server --transport http --port 8004

test-nl2sql-mcp:  ## Test nl2sql-mcp
	uv run pytest tests/nl2sql_mcp/ -v

test-nl2sql: test-nl2sql-mcp  ## Alias of test-nl2sql-mcp

sample-db-up:  ## Start NL2SQL sample DB (PostgreSQL 17 + Pagila, :5432) and wait until healthy
	docker compose --profile sample-db up -d --build --wait postgres

sample-db-down:  ## Stop NL2SQL sample DB (data volume kept)
	docker compose --profile sample-db stop postgres

sample-db-reset:  ## Recreate NL2SQL sample DB from scratch (drops volume, re-seeds Pagila)
	docker compose --profile sample-db down -v postgres
	docker compose --profile sample-db up -d --build --wait postgres

sample-db-psql:  ## Open psql on the sample DB as the read-only account
	docker compose --profile sample-db exec postgres sh -c 'PGPASSWORD="$$NL2SQL_PG_PASSWORD" psql -h 127.0.0.1 -U "$$NL2SQL_PG_USER" -d pagila'

nl2sql-sample-db:  ## One-click: sample Postgres (Pagila) + dockerized nl2sql-mcp on the real backend (:8004)
	NL2SQL_CONTAINER_BACKEND=real docker compose --profile sample-db up -d --build --wait postgres nl2sql-mcp
	@echo ""
	@echo "✓ nl2sql-mcp (backend=real) is running on the Pagila sample DB."
	@echo "→ Inspector: http://localhost:3000/inspector (server: nl2sql-mcp-http; start the frontend with 'make docker-up' or 'make frontend-dev')"
	@echo "→ CLI: uv run python scripts/mcp_cli.py call --server nl2sql-mcp-http --tool search_tables_schema --params '{\"pattern\": \"film%\"}'"
	@echo "→ Back to mock: make nl2sql-mock   |   Stop the DB: make sample-db-down"

nl2sql-mock:  ## Switch dockerized nl2sql-mcp back to the Mock backend (sample DB is left as is)
	NL2SQL_CONTAINER_BACKEND=mock docker compose up -d --build --wait nl2sql-mcp
	@echo ""
	@echo "✓ nl2sql-mcp (backend=mock) is running on :8004. Stop the sample DB with 'make sample-db-down' if you no longer need it."

test-integration: sample-db-up  ## Run integration tests against the sample DB (starts it first)
	uv run pytest -m integration tests/nl2sql_mcp/integration -v

test-scenarios:  ## Run NL2SQL YAML scenarios on Mock (ARGS="--dir tools" 등, 95% 미만이거나 필수 케이스 실패 시 exit 1)
	uv run python scripts/run_mcp_tests.py $(ARGS)

test-scenarios-real: sample-db-up  ## Run NL2SQL YAML scenarios against the sample DB (starts it first)
	uv run python scripts/run_mcp_tests.py --backend real $(ARGS)

test-scenarios-starter:  ## Run starter-mcp YAML scenarios over stdio (no server to start; ARGS="--junit out.xml" 등)
	uv run python scripts/mcp_cli.py test tests/scenarios/starter.yaml $(ARGS)

test-http:  ## Run Streamable HTTP transport tests (servers on ephemeral ports, API key on/off)
	uv run pytest tests/http_transport -v

test-cli:  ## Run scripts/ tests (mcp_cli smoke, header, scenario runner)
	uv run pytest tests/scripts -v

.PHONY: \
	help \
	init \
	init-dev \
	clean \
	test \
	coverage \
	run-starter-mcp \
	run-starter-mcp-http \
	test-starter-mcp \
	run-mock-repo-mcp \
	test-mock-repo-mcp \
	cli-list-servers \
	cli-list-tools-starter \
	cli-list-tools-mock-repo \
	cli-call-starter \
	frontend-install \
	frontend-dev \
	frontend-build \
	frontend-test \
	test-e2e \
	lint-py \
	lint-fe \
	lint-all \
	docker-build \
	docker-up \
	docker-down \
	docker-logs \
	run-nl2sql-mcp \
	run-nl2sql-mcp-http \
	test-nl2sql-mcp \
	test-nl2sql \
	sample-db-up \
	sample-db-down \
	sample-db-reset \
	sample-db-psql \
	nl2sql-sample-db \
	nl2sql-mock \
	test-integration \
	test-scenarios \
	test-scenarios-real \
	test-scenarios-starter \
	test-http \
	test-cli
