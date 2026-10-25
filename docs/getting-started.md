# Getting started

This guide takes you from a fresh clone to a first tool call in the Inspector, then to a first Chat run, the CLI, and the NL2SQL sample database. The Docker path needs no Python or Node setup and should get you to an Inspector call in under 10 minutes (most of it is the first image build).

## Contents

- [Prerequisites](#prerequisites)
- [1. Clone and configure](#1-clone-and-configure)
- [2. Start the stack](#2-start-the-stack)
- [3. First Inspector call](#3-first-inspector-call)
- [4. First Chat run](#4-first-chat-run)
- [5. The CLI](#5-the-cli)
- [6. NL2SQL with the sample database](#6-nl2sql-with-the-sample-database)
- [Local development without Docker](#local-development-without-docker)
- [Troubleshooting](#troubleshooting)
- [Next steps](#next-steps)

## Prerequisites

Pick one of the two paths. You can add the other later.

| Path | You need | What you get |
|---|---|---|
| Docker (recommended) | Docker with Compose v2 (`docker compose`) | The Frontend on `:3000` and three MCP servers on `:8001`, `:8002`, `:8004` |
| Local | [uv](https://docs.astral.sh/uv/) (it installs Python 3.12.12 for you), Node.js 20.9 or newer with npm | The same pieces run on the host, plus the CLI and the test suites |

Notes:

- Node 20.9 is the minimum required by Next.js 16 (the Frontend image uses `node:20-alpine`). The repository has no `.nvmrc` or `engines` field.
- The CLI and the test suites always run on the host, so you need `uv` for them even if the servers run in Docker.
- The NL2SQL sample database is a Docker container in both paths.

## 1. Clone and configure

```bash
git clone https://github.com/sguys99/mcp-connectors.git
cd mcp-connectors
cp .env.example .env
```

The defaults work as is: authentication is off (`MCP_API_KEY` is empty), NL2SQL uses its in-memory Mock backend, and no LLM key is set. Docker Compose reads this root `.env` to fill the `${VAR}` values in `docker-compose.yaml`, and the MCP servers read it when you run them on the host (`src/mcp-servers/_common/env.py`).

## 2. Start the stack

```bash
docker compose up -d --wait
```

`--wait` returns once every container is up, and healthy where the service defines a health check (Compose prints "Healthy" for each). The first run builds the images, which takes a few minutes. Later runs start in seconds. `make docker-up` runs the same command without `--wait`.

| Service | Port | What it is |
|---|---|---|
| `frontend` | 3000 | Next.js UI: Dashboard, Inspector, Chat, Settings |
| `starter-mcp` | 8001 | Starter server over Streamable HTTP (registry name `starter-mcp-http`) |
| `mock-repo-mcp` | 8002 | Code repository server with a fixture backend (`mock-repo-mcp`) |
| `nl2sql-mcp` | 8004 | NL2SQL server on the Mock backend (`nl2sql-mcp-http`) |

Check the state with `docker compose ps`. Open <http://localhost:3000>. The Dashboard lists every server in `configs/mcp_servers.yaml` and checks each HTTP server. The two stdio entries (`starter-mcp`, `nl2sql-mcp`) are listed for reference and are not checked, because a browser cannot start a local process.

## 3. First Inspector call

1. Open <http://localhost:3000/inspector?server=starter-mcp-http&tool=echo>, or open **Inspector** and pick `starter-mcp-http` in the explorer, then the `echo` tool.
2. Enter `hi` in the `text` field.
3. Press **Run** (or `Cmd+Enter` / `Ctrl+Enter`).

The response pane shows:

```json
{
  "metadata": { "length": 2 },
  "untrusted_content": { "content": "hi" }
}
```

The browser did not talk to port 8001. It called the same-origin proxy `/api/mcp/starter-mcp-http`, and the Frontend server forwarded the request. See [architecture.md](architecture.md#registered-servers) for the path.

<picture><source media="(prefers-color-scheme: dark)" srcset="assets/screenshots/inspector-call-dark.png"><img alt="Inspector on nl2sql-mcp-http with run_sql_query selected, the argument form in the middle and an OK response with the Mock sample data notice on the right" src="assets/screenshots/inspector-call-light.png" width="100%"></picture>

While you are here, try:

- The **Resources** and **Prompts** tabs on `starter-mcp-http` (for example `starter://about` and `explain_tool`).
- The dock at the bottom: **JSON-RPC log** shows every raw message, **History** keeps your calls and can export them as a scenario file, **Server info** shows the `initialize` result.

## 4. First Chat run

Chat runs an LLM tool-use loop against the servers you expose to the model. It needs a key for Anthropic, OpenAI, or OpenRouter. There are two ways to provide one.

| Option | How | When to use it |
|---|---|---|
| Browser key (default) | **Settings**, choose a provider and paste the key | Personal use. The key is stored in this browser's `localStorage` and sent with each `/api/chat` request |
| Server key | Put `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`, `OPENROUTER_API_KEY`) and `CHAT_ALLOW_SERVER_KEYS=true` in the root `.env`, then run `docker compose up -d --wait` again to recreate the `frontend` container | A trusted machine or team. Anyone who can reach the Frontend can spend this key, so it is off unless you set the flag |

A browser key always wins over a server key. Then:

1. Open **Chat**.
2. Under **Tools exposed to the model**, tick `mock-repo-mcp`.
3. Ask, for example: `List the repositories and show the README of the first one.`

The model calls `list_repositories` and `get_file_content`, and the Trace panel shows each LLM request and tool call on a timeline. The toolbar lets you change the model, the maximum iterations (1 to 20, default 5), the approval mode (**Auto** or **Manual**), and shows the token usage the provider reported. In Manual mode each tool call waits for **Approve** or **Deny**. Default models are `claude-sonnet-4-6`, `gpt-4o`, and `anthropic/claude-sonnet-4.6` on OpenRouter.

Conversations are saved in the browser's IndexedDB and listed in the Chat sidebar.

## 5. The CLI

The CLI (`scripts/mcp_cli.py`) reads the same registry and talks to stdio servers (it starts them) and HTTP servers (they must be running).

```bash
make init-dev            # pins Python 3.12.12, creates .venv, installs dependencies and pre-commit hooks
make cli-list-servers    # prints the registry: name, transport, endpoint
make cli-call-starter    # echo({"text":"hi"}) on the stdio starter server
```

`make cli-call-starter` prints the same JSON as the Inspector call above. More commands:

```bash
uv run python scripts/mcp_cli.py list-tools --server starter-mcp
uv run python scripts/mcp_cli.py call --server starter-mcp --tool add --params '{"a":2,"b":3}'
uv run python scripts/mcp_cli.py list-resources --server starter-mcp
uv run python scripts/mcp_cli.py read-resource --server starter-mcp --uri starter://about
uv run python scripts/mcp_cli.py get-prompt --server starter-mcp --name explain_tool --args '{"tool_name":"echo"}'
uv run python scripts/mcp_cli.py call --server starter-mcp-http --tool echo --params '{"text":"hi"}'   # HTTP, needs :8001
```

Scenario files run many checks at once. The starter file runs over stdio, so nothing needs to be started:

```bash
uv run python scripts/mcp_cli.py test tests/scenarios/starter.yaml   # or: make test-scenarios-starter
# Total 15 cases: PASS=15 FAIL=0 ERROR=0 SKIP=0
# Result: OK
```

`test` also takes `--junit report.xml`, `--tag`, `--id`, `--server`, `--timeout`, and `--jobs`. It exits with 0 on success, 1 on failures, and 2 on invalid input. The file format is in [scenario-format.md](scenario-format.md).

When `MCP_API_KEY` is set, the CLI sends it as `X-MCP-API-Key` to HTTP servers.

## 6. NL2SQL with the sample database

The `nl2sql-mcp` container starts on the Mock backend, an in-memory copy of the [Pagila](https://github.com/devrimgunduz/pagila) catalog. To run real SQL on PostgreSQL 17 with Pagila:

```bash
make nl2sql-sample-db    # starts the sample DB and recreates nl2sql-mcp with backend=real, waits until healthy
make nl2sql-mock         # back to the Mock backend; the sample DB keeps running
make sample-db-down      # stop the sample DB, keeping its data volume
```

The first `make nl2sql-sample-db` builds the database image and downloads Pagila. Then, in the Inspector, pick `nl2sql-mcp-http` and call `run_sql_query` with:

```sql
SELECT staff_id, SUM(amount) AS total FROM payment
WHERE payment_date >= DATE '2022-03-01' AND payment_date < DATE '2022-06-01'
GROUP BY staff_id
```

Pagila dates are in 2022, so always give both date bounds. Try `SELECT email FROM customer WHERE customer_id = 1` or `DELETE FROM payment` to see the guardrails block a query. [guardrails.md](guardrails.md) explains each check.

## Local development without Docker

Run each piece on the host. If the Docker stack is up, stop it first (`docker compose down`), because the ports are the same.

```bash
make init-dev
cp .env.example .env

# MCP servers, one terminal each
make run-starter-mcp-http    # :8001
make run-mock-repo-mcp       # :8002
make run-nl2sql-mcp-http     # :8004 (Mock backend)

# Frontend
make frontend-install
cp frontend/.env.example frontend/.env.local
make frontend-dev            # http://localhost:3000
```

Differences from Docker:

- The Frontend dev server reads `frontend/.env.local`, not the root `.env`. Put `MCP_API_KEY`, `CHAT_ALLOW_SERVER_KEYS`, server LLM keys, and `MCP_ALLOW_RUNTIME_PROXY` there.
- Leave `MCP_USE_INTERNAL_URL` empty so the proxy uses the registry `url` (`http://localhost:80xx/mcp`) instead of the compose service names.
- The stdio servers need no terminal: `make run-starter-mcp` and `make run-nl2sql-mcp` exist for IDE integration, and the CLI starts them itself.
- To point the host NL2SQL server at the sample DB: `make sample-db-up`, then `NL2SQL_DB_BACKEND=real make run-nl2sql-mcp-http`.

## Troubleshooting

### A port is already in use

The stack uses 3000, 8001, 8002, 8004, and 5432 (sample DB, `NL2SQL_PG_PORT`). Find the process with `lsof -i :8001` (macOS, Linux). The usual cause is running a server on the host while its container is up, or the other way around. Stop one side: `docker compose stop starter-mcp` or stop the `make run-*` process. `make run-nl2sql-mcp-http` in particular needs `docker compose stop nl2sql-mcp` first.

On macOS, Docker can publish a port even when a host process already listens on it over IPv4. `docker compose up` then succeeds, but `localhost:8002` reaches the host process instead of the container. The Inspector is not affected (the proxy uses the internal Docker address), so if the CLI or curl answers differently from the Inspector, check `lsof -iTCP:8002 -sTCP:LISTEN`.

### A server shows as offline

The Dashboard checks each HTTP server through the proxy and shows an offline badge with a recovery command, such as `docker compose up -d starter-mcp` or `make run-starter-mcp-http`. Check:

- `docker compose ps` and `docker compose logs <service>` for the container state.
- That a server you run on the host listens on the port in `configs/mcp_servers.yaml`.
- For a "rejected the request" error: `MCP_API_KEY` must be the same on the servers and the Frontend. With Docker, both come from the root `.env`. With `make frontend-dev`, the Frontend reads `frontend/.env.local`.

### CORS errors

Registry servers never need CORS: the browser calls the same-origin proxy. CORS matters only for a **runtime server** added with **Add server** in the default **Browser direct** mode, because then the browser connects to the target itself.

- The target must allow the Frontend origin and expose the `mcp-session-id` header.
- For the servers in this repository, the allowed origins come from `MCP_CORS_ORIGINS` (comma separated, default `http://localhost:3000`). Set it in the root `.env` or in the process environment (the process environment wins), for example `MCP_CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000`, then restart the server. For containers, check the `environment` block of the service in `docker-compose.yaml`.
- Opening the UI as `http://127.0.0.1:3000` instead of `http://localhost:3000` is a different origin.
- For a target you cannot change, use the server proxy instead: set `MCP_ALLOW_RUNTIME_PROXY=true` on the Frontend and choose the proxy connection when adding the server. Read [the security notes](architecture.md#runtime-server-boundary) first.

### Chat says the API key is not set

Enter a key in **Settings**, or set a server key together with `CHAT_ALLOW_SERVER_KEYS=true` (the flag must be the word `true`) and recreate the container. A server key alone is ignored.

### Manual approval fails with "does not match" after a restart

Without `CHAT_APPROVAL_SECRET`, each Frontend process signs approvals with its own random key, so a pending approval cannot survive a restart. Ask the model again, or set a shared secret of at least 16 characters. See [architecture.md](architecture.md#approval-tokens).

### NL2SQL returns no rows or `DATE_RANGE_EXCEEDED`

Queries on `payment` and `rental` without a date condition get a "last 3 months" condition added, and Pagila data is from 2022. Give both bounds within 12 months.

## Next steps

- [architecture.md](architecture.md): components, request paths, and security boundaries
- [writing-a-server.md](writing-a-server.md): add your own MCP server, with or without Claude Code
- [guardrails.md](guardrails.md): the NL2SQL guardrails and the shared `_common` helpers
- [faq.md](faq.md): common questions
