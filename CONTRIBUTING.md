# Contributing to MCP Connectors

Thanks for your interest in improving MCP Connectors. This guide covers how to set up a development environment, add a new MCP server, follow the project conventions, and get a pull request merged.

By participating in this project you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security issue, do not open a public issue; follow [SECURITY.md](SECURITY.md) instead.

## Table of contents

- [Development setup](#development-setup)
- [Project layout](#project-layout)
- [Adding a new MCP server](#adding-a-new-mcp-server)
- [Conventions](#conventions)
- [Checks to run before a pull request](#checks-to-run-before-a-pull-request)
- [Commit messages](#commit-messages)
- [Branch naming](#branch-naming)
- [Pull request process](#pull-request-process)
- [Writing documentation](#writing-documentation)

## Development setup

### Prerequisites

- Python 3.12 and [uv](https://docs.astral.sh/uv/)
- Node.js 24 or newer and npm (for the Frontend; see `frontend/.nvmrc`)
- Docker with Compose (optional: the full stack, the NL2SQL sample database, integration tests)
- [gitleaks](https://github.com/gitleaks/gitleaks) is installed automatically by pre-commit; a local binary is only needed for full tree scans

### Python environment

```bash
make init-dev        # pins Python 3.12.12, creates .venv, runs uv sync --all-extras --dev, installs pre-commit hooks
cp .env.example .env # shared environment for all MCP servers and docker compose
```

All MCP servers read the root `.env` regardless of the working directory (`src/mcp-servers/_common/env.py`). To override a value for a single server, create `src/mcp-servers/<server>/.env`; each server package has its own `.env.example` that lists the keys it reads. Never commit a `.env` file.

### Frontend

```bash
make frontend-install                    # cd frontend && npm install
cp frontend/.env.example frontend/.env.local
make frontend-dev                        # http://localhost:3000
```

Frontend environment variables are read on the server side only (Route Handlers and server components). When you run the stack with `make docker-up`, the root `.env` is passed through docker compose instead of `frontend/.env.local`.

### Running servers

```bash
make run-starter-mcp          # stdio
make run-starter-mcp-http     # Streamable HTTP on :8001
make run-mock-repo-mcp        # Streamable HTTP on :8002
make run-nl2sql-mcp-http      # Streamable HTTP on :8004 (Mock backend by default)
make docker-up                # everything, including the Frontend on :3000
```

Run `make help` to see every target.

## Project layout

| Path | What it contains |
|---|---|
| `src/mcp-servers/_common/` | Shared modules: auth, cors, env, errors, logging, masking, retry, trust |
| `src/mcp-servers/starter_mcp/` | Canonical starter server (tools, resources, prompts). Copy this to start a new server by hand |
| `src/mcp-servers/mock_repo_mcp/` | Baseline server with a mock backend |
| `src/mcp-servers/nl2sql_mcp/` | NL2SQL reference server with SQL guardrails (PostgreSQL by default, Oracle optional) |
| `scripts/mcp_cli.py` | CLI: `list-servers`, `list-tools`, `call`, `list-resources`, `read-resource`, `list-prompts`, `get-prompt`, `test` |
| `configs/mcp_servers.yaml` | Server registry shared by the CLI and the Frontend |
| `frontend/` | Next.js verification UI: Dashboard, Inspector, Chat, Settings |
| `tests/` | pytest suites per server, `_common`, HTTP transport, CLI, and YAML scenarios |
| `docs/mcp-spec/` | MCP server specs written with `/mcp-spec-writer` |
| `.claude/skills/` | The `mcp-spec-writer` and `mcp-server-builder` skills |

See [README.md](README.md) for an overview, [docs/architecture.md](docs/architecture.md) for how the parts fit together, and [CLAUDE.md](CLAUDE.md) for a condensed reference of commands and conventions.

## Adding a new MCP server

### With Claude Code (recommended)

1. Run `/mcp-spec-writer` to write a 10-section spec at `docs/mcp-spec/<server-name>_v0.X.md`. The skill interviews you section by section, in English or Korean.
2. Run `/mcp-server-builder` with that spec. It generates `src/mcp-servers/<snake_name>/`, `tests/<snake_name>/`, a scenario YAML, registry entries in `configs/mcp_servers.yaml`, and Makefile targets. A mock backend lets the server run end to end before any real integration exists.
3. Verify the result:

   ```bash
   uv run pytest tests/<snake_name>/ -v
   uv run python scripts/mcp_cli.py list-tools --server <server-name>
   uv run python scripts/mcp_cli.py call --server <server-name> --tool <tool> --params '<json>'
   uv run python scripts/mcp_cli.py test <path/to/scenario.yaml>
   ```

4. Check it visually in the Frontend: `/inspector` for single calls, `/chat` for the LLM tool-use loop.

The whole workflow, including the conventions and the verification steps, is described in [docs/writing-a-server.md](docs/writing-a-server.md).

### Without Claude Code (manual path)

The skills are a convenience, not a requirement. To add a server by hand (the full walkthrough with code is in [docs/writing-a-server.md](docs/writing-a-server.md#without-claude-code)):

1. Copy `src/mcp-servers/starter_mcp/` to `src/mcp-servers/<snake_name>/` and rename the FastMCP name, logger name, and settings prefix (`STARTER_MCP_*` becomes `<UPPER_NAME>_*`).
2. Keep the layout the builder skill generates (see `nl2sql_mcp` and [docs/writing-a-server.md](docs/writing-a-server.md)): `config.py` (pydantic-settings with `env_files(__file__)`), `state.py`, `tools.py` with a `register_tools()` function, `primitives.py` for resources and prompts, and `server.py` with `--transport stdio|http`. The starter is smaller and binds its tools in `server.py` with `mcp.add_tool`; move to `register_tools()` once a server has state or more than a few tools. Add `build_http_middleware(settings.mcp_api_key)` only on the HTTP branch.
3. Add the package to `known-first-party` in `pyproject.toml` under `[tool.ruff.lint.isort]`.
4. Add tests under `tests/<snake_name>/` (without `__init__.py`, see below).
5. Add registry entries to `configs/mcp_servers.yaml` with both `description` and `description_ko`.
6. Add kebab-case Makefile targets (`run-<server-name>`, `test-<server-name>`) and list them in `.PHONY`.
7. Write a spec in `docs/mcp-spec/` using the template in `.claude/skills/mcp-spec-writer/references/` so reviewers can compare the code to the intended behavior.
8. Add a scenario YAML in the format described in [docs/scenario-format.md](docs/scenario-format.md).

## Conventions

### Python

- Formatting and linting use ruff with `line-length = 105` and `target-version = "py312"` (see `pyproject.toml`).
- Imports from shared code use `from _common.<module> import ...`. This works because pytest runs with `pythonpath = [".", "src/mcp-servers"]`.
- **Do not create `tests/<server>/__init__.py`.** Test directories share names with the server packages under `src/mcp-servers/`, so pytest runs with `--import-mode=importlib` and `asyncio_mode = "auto"` to load each test module in its own namespace.
- **`_common/` is a one-way dependency.** Servers import from `_common`; nothing in `_common` imports a server module.
- Tests that need a real database are marked `@pytest.mark.integration` and are excluded from `make test`.

### Strings the LLM sees

- Tool descriptions, parameter descriptions, resource and prompt descriptions, and error messages are written in **English**.
- Errors raise a subclass from `_common.errors` and end with an error code in brackets, for example `"Table 'films' was not found. Confirm the exact name with search_tables_schema. [TABLE_NOT_FOUND]"`.
- Free text that comes from an external system or a person (file bodies, comments, query rows, user input) is passed through `mask_pii` and wrapped with `wrap_untrusted(metadata=..., untrusted_content=...)` from `_common/trust.py`.

### Registry

Every entry in `configs/mcp_servers.yaml` has an English `description` and a Korean `description_ko`. The Frontend shows `description_ko` when the UI language is Korean; the CLI only reads `description`.

### Naming

- Server packages are snake_case (`code_repo_mcp`). FastMCP names, registry names, and Makefile targets are kebab-case (`code-repo-mcp`).
- Environment variables use the `<UPPER_NAME>_` prefix. The shared keys `MCP_API_KEY` and `MCP_CORS_ORIGINS` have no prefix.

### TypeScript

- Next.js App Router with server components by default. Keep `"use client"` to the smallest interactive island.
- UI strings go through the EN/KO dictionaries in `frontend/src/lib/i18n/`; do not hardcode user-facing text.
- Secrets stay on the server. The browser never receives `MCP_API_KEY` or server-side LLM keys.

## Checks to run before a pull request

Run everything that applies to your change. CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the same checks on every push to `main` and on every pull request, in parallel jobs:

| CI job | What it runs |
|---|---|
| Python lint | `make lint-py` |
| Python tests and scenarios | `make test`, `make test-scenarios-starter`, `make test-scenarios` |
| Integration | `make sample-db-up`, then the `-m integration` tests and the NL2SQL scenarios on the real backend (`make test-integration`, `make test-scenarios-real`) |
| Frontend | `npm run lint`, `npx tsc --noEmit`, `npm run test`, `npm run build` |
| E2E | Playwright (`npm run test:e2e`); the HTML report is uploaded as an artifact when it fails |
| Secret scan | gitleaks 8.30.1 (same version as the pre-commit hook) over the full git history and the working tree, with `.gitleaks.toml` |
| Docker | `docker compose build`, `docker compose up -d --wait`, then health checks on the Frontend (:3000), each MCP server (:8001, :8002, :8004), and the Frontend proxy |

Running the checks below locally first saves a round trip.

### Python

```bash
uv run ruff check src/ scripts/ tests/
uv run ruff format --check src/ scripts/ tests/   # or `make lint-py` for both
make test                                          # all pytest suites, integration tests excluded
make test-scenarios                                # NL2SQL YAML scenarios on the Mock backend
```

Use `uv run ruff format src/ scripts/ tests/` to apply formatting. Narrower targets are also available: `make test-starter-mcp`, `make test-mock-repo-mcp`, `make test-nl2sql`, `make test-http`, `make test-cli`, and `make test-scenarios-starter`. If you touched the NL2SQL database code, also run `make test-integration` and `make test-scenarios-real` (both start the sample PostgreSQL container).

### Frontend

```bash
cd frontend
npm run lint          # eslint (same as `make lint-fe`)
npx tsc --noEmit      # type check
npm run test          # vitest (same as `make frontend-test`)
npm run build         # production build (same as `make frontend-build`)
```

### End-to-end

```bash
make test-e2e         # installs Chromium, then runs Playwright; starts mock-repo-mcp and the dev server for you
```

Playwright runs the Chat tests against a fake LLM (`CHAT_MOCK_LLM=1`), so no real API key is needed.

### Secrets

```bash
uv run pre-commit run --all-files
```

The pre-commit hooks include gitleaks (configured by `.gitleaks.toml`), ruff, ruff-format, and basic file checks. The hooks run on every commit after `make init-dev`. The gitleaks hook only scans staged changes; to scan the whole working tree, run `gitleaks dir .` with a local gitleaks binary. CI also runs `gitleaks git .` over the full history.

## Commit messages

Commits use a gitmoji followed by a conventional commit type and scope:

```
<gitmoji> <type>(<scope>): <summary>
```

Examples (the summary may be in English or Korean; the maintainers' history is mostly Korean):

```
✨ feat(starter): add 4 resources, 2 prompts and the sample_content tool
🐛 fix(nl2sql): allow UNION in the AST-based guardrails
🔒 feat(auth): apply the API key ASGI middleware to every HTTP server
📝 docs(plan): record the Phase 6 work plan
🔀 merge: Phase 5 new features (revamp/phase-5-features)
```

Common pairs: ✨ `feat`, 🐛 `fix`, 📝 `docs`, ♻️ `refactor`, ✅ `test`, 🔧 `chore`, ⚡ `perf`, 🔒 security fixes or features, ♿ accessibility fixes, 🌐 i18n. Typical scopes are a server (`starter`, `nl2sql`), a screen (`inspector`, `chat`, `settings`, `dashboard`), or an area (`cli`, `docker`, `auth`, `skills`). Keep the first line short, use the imperative mood, and keep each commit to a single purpose.

## Branch naming

Create a branch from `main` with one of these prefixes:

| Prefix | Use |
|---|---|
| `feature/` | New functionality, for example `feature/sqlite-dialect` |
| `fix/` | Bug fixes, for example `fix/runtime-proxy-timeout` |
| `docs/` | Documentation only |
| `chore/` | Tooling, dependencies, build |
| `hotfix/` | Urgent fixes |

Use lowercase words separated by hyphens. Maintainers use `revamp/phase-N-<topic>` for the planned revamp phases.

## Pull request process

1. Open an issue first for anything larger than a small fix, so the approach can be agreed before you invest time.
2. Keep pull requests focused. One server, one feature, or one fix per pull request is easiest to review.
3. Fill in the pull request template, including which checks you ran.
4. For UI changes, attach screenshots in light and dark mode, and mention any mobile width you checked.
5. Update the docs that your change affects: the server README, `configs/mcp_servers.yaml` descriptions, `.env.example` files, and `CHANGELOG.md` under "Unreleased".
6. A maintainer reviews the pull request. Address feedback with new commits; the maintainer may squash on merge.

## Writing documentation

- New documents in `docs/`, the open source standard documents, and server READMEs are written in English. `README.md` has a Korean counterpart, `README.ko.md`; keep the two in the same structure.
- Do not use the em dash character or the middle dot character. Use commas, colons, parentheses, or "and" instead.
  - Exception: `frontend/AGENTS.md` is written and re-added by `next dev`, so it keeps its upstream text (which contains em dashes). Do not edit it by hand.
- In Korean documents, mix the polite casual style (해요체) and the formal style (습니다체) at roughly a 2:8 ratio.
- Diagrams are Mermaid with theme variables or hand-made SVG, and must be readable in both light and dark mode.
- Never put real hostnames, credentials, or personal data in docs, fixtures, or examples. Use placeholders such as `localhost` and `<your-key>`.

You can check a file for the forbidden characters with:

```bash
grep -n "$(printf '\342\200\224\\|\302\267')" <file>   # em dash (U+2014) or middle dot (U+00B7)
```
