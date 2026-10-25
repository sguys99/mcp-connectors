# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) starting with `0.1.0`.

## [Unreleased]

## [0.1.0] - 2026-10-25

The first public release. It packages the MVP, the revamp phases 0 to 6, and the release preparation of phase 7.

Highlights:

- Three MCP servers in one layout: `starter_mcp` (canonical starter), `mock_repo_mcp` (mock backend baseline), and `nl2sql_mcp`, an NL2SQL guardrail reference that runs agent-written SQL behind read-only enforcement, row and date limits, scan blocking, PII control, and an audit log.
- Shared `_common` security modules: API key auth, CORS, `.env` loading, errors with `[CODE]` tags, JSON logging, PII masking, retry, and untrusted content wrapping.
- A CLI and a generic scenario runner with JUnit XML output, plus pytest suites for every server.
- A local web UI with a Dashboard, an Inspector, an LLM Chat with a trace waterfall, and Settings, in English and Korean, light and dark.
- One-command start with Docker Compose, and an optional PostgreSQL 17 sample database (Pagila) for NL2SQL.
- Claude Code skills that turn a 10-section spec into a server, tests, scenarios, and registry entries.
- GitHub Actions CI for lint, tests, scenarios, integration, Frontend build, Playwright, secret scanning, and the Docker stack.

### Added

**MCP servers**

- `starter_mcp`: canonical starter over stdio and Streamable HTTP (:8001) with 4 tools (`echo`, `add`, `current_time`, `sample_content`), 4 resources (Markdown, JSON, a URI template, and a binary PNG), and 2 prompts.
- `mock_repo_mcp`: baseline server with a mock backend over Streamable HTTP (:8002).
- `nl2sql_mcp`: NL2SQL reference server with SQL guardrails (select-only, row limits, date ranges, mass scan blocking, forbidden and risky constructs, timeouts, PII control) and a SQLite audit log. PostgreSQL is the default dialect and Oracle is optional (`uv sync --extra oracle`). Runs on a Mock backend by default.
- `_common`: shared modules for API key auth, CORS, `.env` loading, errors, JSON logging, PII masking, retry, and untrusted content wrapping.
- NL2SQL sample database: PostgreSQL 17 with the Pagila schema, a read-only account, and `make sample-db-up`, `make nl2sql-sample-db`, and `make nl2sql-mock`.
- Docker Compose stack with all three HTTP servers and the Frontend, running as non-root users.

**CLI and testing**

- `scripts/mcp_cli.py` with `list-servers`, `list-tools`, `call`, `list-resources`, `read-resource`, `list-prompts`, and `get-prompt` for stdio and Streamable HTTP servers in the registry.
- Generic scenario runner `mcp_cli.py test <file|dir>` with a documented YAML format (`docs/scenario-format.md`, `configs/schemas/scenario.schema.json`), tag and id filters, and JUnit XML output (`--junit`).
- NL2SQL scenario suite (`make test-scenarios`, `make test-scenarios-real`) and a starter scenario suite (`make test-scenarios-starter`).
- pytest suites for every server, `_common`, the HTTP transport (with the API key on and off), and the CLI, plus integration tests against the sample database (`make test-integration`).
- Playwright end-to-end tests with a fake LLM for Chat (`make test-e2e`), including screen reader approximation checks with axe (landmarks, headings, live regions, focus management).
- GitHub Actions CI with parallel jobs for ruff, pytest and scenarios, integration against the sample database, Frontend lint, typecheck, vitest and build, Playwright, gitleaks over the full history, and a Docker Compose build and health check. Dependabot watches uv, npm, GitHub Actions, and Docker.

**Frontend**

- Dashboard: server status, latency sparklines, tool counts, offline hints, and a getting started panel.
- Inspector: tools, resources (including templates), and prompts; a server info panel; a raw JSON-RPC log; call history with replay; export of history as a scenario YAML; cancellation; and a timing waterfall based on `Server-Timing`.
- Chat: LLM tool-use loop over one or more MCP servers with Anthropic, OpenAI, and OpenRouter; model and max iteration controls; manual approval mode; token usage from provider reports; conversations saved in IndexedDB with search, rename, and Markdown or JSON export and import.
- Runtime servers: add an MCP server by URL and headers from the UI for the current tab, connected directly from the browser or through an opt-in server proxy.
- Copy client configuration for Claude Desktop, Cursor, VS Code, and Claude Code.
- Settings with local data management, English and Korean UI, light and dark themes, a command palette, and mobile layouts. Checked against WCAG 2.1 AA.
- Dashboard latency bars share one adaptive scale across rows (rounded up to 100, 200, 300, 500, or 1000 ms steps), and latency measures only the `tools/list` round trip, not session setup.
- NL2SQL results from the Mock backend carry `data_source: "mock_sample"` and a `notice`, and the Inspector shows a "Mock sample data" alert above them. Results from a database carry `data_source: "database"`.
- Settings section badges follow the real state of each section ("Applies on Save" or "Unsaved").
- Chat Markdown tables wrap cells and scroll horizontally instead of being cut off, the Chat toolbar and the Inspector Run, Cancel, and Reset row no longer wrap at 1200 px, and the conversation list shows a running draft row for the first conversation.

**Workflow**

- Claude Code skills `mcp-spec-writer` (10-section spec interview in English or Korean) and `mcp-server-builder` (scaffold a server, tests, scenarios, registry entries, and Makefile targets from a spec).
- Open source project documents: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, this changelog, and issue and pull request templates.

### Changed

- `oracle_nl2sql_mcp` was renamed to `nl2sql_mcp` and made database neutral through dialect adapters (`NL2SQL_DB_DIALECT`).
- `echo_mcp` and `simple_mcp_server` were merged into `starter_mcp`; port 8001 now serves the starter over HTTP.
- `configs/mcp_servers.yaml` is the single registry for the CLI and the Frontend. The Frontend reads it on the server and serves it through `/api/registry`.
- Registry entries have an English `description` and a Korean `description_ko`. Tool descriptions and error messages of the example servers are in English, and errors end with a `[CODE]` suffix.
- MCP servers read the root `.env` regardless of the working directory, with an optional per-server `.env` override.
- The Frontend was rebuilt on the chosen design: new app shell, design tokens, and redesigned Dashboard, Inspector, Chat, and Settings.
- `MCP_CORS_ORIGINS` follows the same rules as other settings (process environment, then the server `.env`, then the root `.env`), and Docker Compose passes it through from the root `.env` (`${MCP_CORS_ORIGINS:-http://localhost:3000}`). It used to be read from the process environment only.
- The OpenRouter default model is `anthropic/claude-sonnet-4.6`. The old default `anthropic/claude-sonnet-4-6`, which OpenRouter does not list, is migrated automatically in saved settings.
- Tool descriptions of the starter and mock_repo servers no longer contain reStructuredText markup or developer notes.
- The Dashboard first paint is lighter on mobile: the Getting started card renders on the server and three dialogs load on first open.
- Smaller first load: the MCP SDK's JSON schema validator (ajv) loads only when a tool with an `outputSchema` is called, Markdown rendering and YAML load on first use, and Chat reserves its sidebar space up front (no layout shift). First load JS dropped by 15 to 25 percent per page.
- Dependencies updated for security: Python `mcp` 1.30 and `fastmcp` 3.4 (capped below the next major), starlette, cryptography, pyjwt, and others; Frontend React 19.3, Base UI 1.9, zod 4.6, happy-dom 21, and the npm minor and patch group. `npm audit` reports no findings.
- Node.js moves to the 24 LTS line (Frontend image `node:24-alpine`, CI, `engines`, `.nvmrc`).
- Client errors of the starter and mock_repo servers end with a `[CODE]` tag, and the mock_repo HTTP backend reuses one HTTP client.

### Fixed

- Health checks now close their MCP session after each check. Before, each check left a GET SSE stream open, so two app tabs could use up the browser's six connections per host and stall `/api/chat`.
- The Frontend MCP client starts a new session and retries once when the server answers 404 for an expired session (the MCP Python SDK closes Streamable HTTP sessions idle for 30 minutes). Before, the page stopped working until a reload.
- Accessibility: the command palette button and the language toggle have accessible names that match their visible text, Refresh all keeps focus while busy, toggles no longer announce their state twice, required Inspector arguments carry `aria-required` and invalid runs move focus to the first error, and stopping a Chat run before the first reply is announced.
- The Chat thread no longer stops following new content when the browser moves the scroll position by itself (content that shrinks and grows again in one frame). Only wheel, touch, keyboard, pointer, or focus input from the user detaches it.

### Security

- API key authentication (`X-MCP-API-Key`, checked against `MCP_API_KEY`) is applied to every Streamable HTTP server. It stays disabled when the key is unset.
- Browsers reach registry servers only through the same-origin proxy `/api/mcp/[server]`, which attaches the API key on the server side.
- The runtime server proxy is off by default (`MCP_ALLOW_RUNTIME_PROXY`). When enabled it rejects link-local and metadata hosts, does not follow redirects, caps time and size, and never attaches the server API key.
- Server-side LLM keys are used only when `CHAT_ALLOW_SERVER_KEYS=true`.
- Manual approval tokens are HMAC signed (`CHAT_APPROVAL_SECRET`), single use, and expire after 30 minutes. `/api/chat` rejects cross-origin requests.
- Secrets are hidden in the Inspector log, call history, and exports.
- gitleaks runs as a pre-commit hook with project rules in `.gitleaks.toml`. Credentials found in early documents were removed, and internal names were replaced with generic examples.
- Frontend dependencies were updated to resolve `npm audit` findings, and Python dependencies were updated to resolve Dependabot alerts.
- Private vulnerability reporting, secret scanning, and push protection are enabled for the repository.

### Removed

- An unrelated prototype directory, its dependencies, empty files, duplicated result files, and Frontend boilerplate and dead code.
- Internal-only specs and documents. MVP planning documents were moved to `docs/history/` as historical records.
- Agents and skills unrelated to MCP server development from `.claude/`.

[Unreleased]: https://github.com/sguys99/mcp-connectors/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/sguys99/mcp-connectors/releases/tag/v0.1.0
