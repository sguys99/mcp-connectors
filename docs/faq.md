# FAQ

## Why not just use the official MCP Inspector?

Use it when it fits. The official [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a good tool for debugging one server at a time, and it can launch stdio servers, which this Frontend cannot (a browser cannot start a local process, so stdio servers are only listed on the Dashboard and reached through the CLI).

This project covers a different loop: building several internal servers with the same conventions and verifying them repeatedly. It adds:

- A registry (`configs/mcp_servers.yaml`) shared by the CLI and the UI, with a Dashboard that checks every server.
- Chat: a real LLM tool-use loop over one or more servers, with a trace waterfall, manual approval, and token usage.
- A scenario format with a CLI runner (`mcp_cli.py test`, JUnit output) and an Inspector export that turns your manual calls into regression tests.
- A server-side proxy that keeps `MCP_API_KEY` out of the browser.
- Skills and a starter that generate servers with shared auth, PII masking, and trust-boundary helpers.

## Do I need Claude Code or an Anthropic account?

No. The skills are optional; [writing-a-server.md](writing-a-server.md#without-claude-code) describes the manual path. The CLI, the Inspector, and the tests do not call any LLM. Chat needs a key for one provider: Anthropic, OpenAI, or OpenRouter.

## Which LLMs does Chat support?

Three providers: Anthropic (`claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5`, default `claude-sonnet-4-6`), OpenAI (`gpt-4o`, `gpt-4o-mini`, default `gpt-4o`), and OpenRouter with any model ID you type (default `anthropic/claude-sonnet-4.6`). The model has to support tool calling.

## How much does it cost?

The project is free and runs locally. Chat sends requests to your LLM provider with your key, so you pay the provider. The Chat toolbar shows the input and output tokens the provider reported for each request and for the session; it does not convert them to money. Each iteration of the tool-use loop is one LLM request, so the maximum iterations setting (1 to 20, default 5) caps the number of requests per question.

## How do I give Chat an API key?

Two ways. In **Settings**, paste a key: it is stored in your browser's `localStorage` and sent with each Chat request. Or set `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`, `OPENROUTER_API_KEY`) together with `CHAT_ALLOW_SERVER_KEYS=true` on the Frontend server: the root `.env` for Docker (then recreate the container), `frontend/.env.local` for `make frontend-dev`. The server key is ignored without the flag, because anyone who can open the Frontend could spend it. A browser key always takes precedence.

## What is `MCP_API_KEY` and do I need it?

It is a shared key for the MCP servers' HTTP endpoints. When it is set, every HTTP request must carry it in `X-MCP-API-Key`, otherwise the server returns 401. The CLI and the Frontend proxy add it for you from their own environment, so set the same value on the servers and the Frontend. It is empty by default, which disables the check: fine on your own machine, but set it whenever someone else can reach the ports. stdio servers are not affected.

## Can I connect an MCP server that is not in the registry?

Yes. Use **Add server** on the Dashboard (or `+` in the sidebar, or `Cmd+K`). Enter a name, the Streamable HTTP URL, and any headers such as an API key. The server is kept for the current tab only (`sessionStorage`) and works in the Inspector and on the Dashboard. By default the browser connects to it directly, so the server must allow the Frontend origin through CORS. To reach servers without CORS, or to use them in Chat, set `MCP_ALLOW_RUNTIME_PROXY=true` on the Frontend and choose the proxy connection. Read the [runtime server boundary](architecture.md#runtime-server-boundary) before turning that on. To keep a server permanently, add it to `configs/mcp_servers.yaml`.

## I get a CORS error. What do I check?

CORS only applies to runtime servers in direct mode; registered servers go through the same-origin proxy. Check that the target allows your exact Frontend origin (`http://localhost:3000` and `http://127.0.0.1:3000` are different origins) and exposes the `mcp-session-id` header. For this repository's servers, set `MCP_CORS_ORIGINS` (comma separated) in the root `.env` or the process environment and restart the server; the process environment wins. If you cannot change the target, use the server proxy mode described above. More in [getting-started.md](getting-started.md#cors-errors).

## Can I use it with Oracle?

The NL2SQL server has an Oracle dialect: set `NL2SQL_DB_DIALECT=oracle`, install the driver with `uv sync --extra oracle`, set the `NL2SQL_ORACLE_*` connection values, and run with `NL2SQL_DB_BACKEND=real`. Oracle-specific rules (row limits, date expressions, blocked schemas and packages) are covered by unit tests. The repository does not ship an Oracle database, so there are no integration tests against a real Oracle instance; the bundled sample database is PostgreSQL. With `NL2SQL_DB_BACKEND=mock` the Oracle dialect runs against the same Pagila fixtures.

## Where are my conversations and settings stored?

Everything the UI saves stays in your browser:

| Data | Storage |
|---|---|
| Settings, LLM keys, Getting started progress, call history | `localStorage` |
| Chat conversations | IndexedDB (`mcpc-chat`) |
| Runtime servers (URL and headers) | `sessionStorage`, cleared when the tab closes |

Nothing is stored on the Frontend server. Chat can export one conversation as Markdown or JSON, or all of them as JSON, with secret-looking values replaced by `[REDACTED]`, and import them again.

## How do I reset data?

| What | How |
|---|---|
| Browser data | **Settings**, **Local data**, reset all local data (keeps theme and language) |
| NL2SQL audit log | Delete `var/nl2sql_mcp/audit.db` (host runs). In Docker it lives on the `nl2sql-var` volume: `docker compose down -v` removes it together with the other volumes |
| Sample database | `make sample-db-reset` drops the volume and seeds Pagila again |
| Everything in Docker | `docker compose --profile sample-db down -v` removes containers and volumes, including the sample DB (without `--profile sample-db` its container and data volume stay). Add `--rmi local` to remove the built images too |

## Does it work on Windows?

The Docker path needs only Docker Desktop and works the same way. The Makefile, the stdio commands, and the docs assume a POSIX shell (`cd ... &&`, environment prefixes like `VAR=value make ...`), so for local development use WSL 2. The project is developed on macOS.

## Can I use this in production?

It is a development and verification tool, not a production gateway. The Frontend has no user login, authentication is off by default, and the HTTP servers listen on all interfaces. If others can reach it, set `MCP_API_KEY`, put the Frontend behind an authenticating reverse proxy, keep `MCP_ALLOW_RUNTIME_PROXY` and `CHAT_ALLOW_SERVER_KEYS` off unless every user is trusted, and point database servers at read-only accounts. The servers you build here can be deployed on their own like any FastMCP server; see [SECURITY.md](../SECURITY.md#deployment-guidance).

## Why does a Manual approval sometimes fail or expire?

Approval tokens expire after 30 minutes, can be used once, and are signed with `CHAT_APPROVAL_SECRET` (16 characters or more). Without that secret each Frontend process uses a random key, so a restart or a second instance cannot accept a pending approval. Conversations saved while an approval was pending reopen with those calls cancelled. See [architecture.md](architecture.md#approval-tokens).

## Why does my NL2SQL query return nothing?

The Pagila sample data is from 2022, and a query on `payment` or `rental` without a date condition gets "last 3 months" added (`GUARDRAIL_DEFAULT_MONTHS`). Give both date bounds within 12 months, for example `payment_date >= DATE '2022-03-01' AND payment_date < DATE '2022-06-01'`. On the Mock backend, date filters and joins are not evaluated, so use `make nl2sql-sample-db` for realistic results. See [guardrails.md](guardrails.md).

## Where do I report a bug or a security issue?

Bugs and feature requests: GitHub issues (see [CONTRIBUTING.md](../CONTRIBUTING.md)). Security issues: privately, as described in [SECURITY.md](../SECURITY.md).
