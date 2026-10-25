<div align="center">

# MCP Connectors

**Build, test, and run MCP servers for your internal systems, the same way every time.**

Spec-driven Claude Code skills write the server, shared guardrails keep it safe, and one local UI lets you call its tools by hand and watch a real LLM use them.

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Python 3.12](https://img.shields.io/badge/python-3.12-3776AB.svg?logo=python&logoColor=white)](pyproject.toml)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000.svg?logo=nextdotjs&logoColor=white)](frontend/package.json)
[![MCP](https://img.shields.io/badge/MCP-stdio%20%7C%20Streamable%20HTTP-007781.svg)](https://modelcontextprotocol.io)

**English** | [한국어](README.ko.md)

</div>

<p align="center">
  <img alt="Chat demo: the user asks which tables hold customer payments, the model calls search_tables_schema and get_table_schema on the NL2SQL server, the answer streams in, and the Trace panel fills with each LLM request and tool call" src="docs/assets/demo/chat-tool-use.gif" width="100%">
</p>

MCP Connectors is a monorepo for teams that connect AI agents to internal systems: code repositories, relational databases, data warehouses, metadata catalogs, and internal APIs. Every server follows the same layout, shares the same security helpers, and is checked with the same CLI and web UI, so the tenth server is as easy to review as the first.

## Contents

- [Why MCP Connectors](#why-mcp-connectors)
- [Quick start (Docker)](#quick-start-docker)
- [Feature tour](#feature-tour)
- [What's included](#whats-included)
- [Architecture](#architecture)
- [Add your own server](#add-your-own-server)
- [Repository layout](#repository-layout)
- [Documentation](#documentation)
- [Contributing, security, license](#contributing)

## Why MCP Connectors

| | What you get |
|---|---|
| **Spec-driven development** | `/mcp-spec-writer` interviews you and writes a reviewable 10-section spec. `/mcp-server-builder` turns that spec into a server, tests, a scenario file, and a registry entry. The spec is what your team reviews, and the code matches it 1:1. |
| **Enterprise guardrails by default** | Shared `_common` modules give every server API key auth, CORS, PII masking, trust-boundary wrapping of external text, retries, and JSON logs that hash arguments instead of printing them. |
| **Inspector and Chat in one place** | Call a single tool, resource, or prompt in the Inspector, then let Anthropic, OpenAI, or OpenRouter models use the same servers in Chat with a trace waterfall, manual approval, and token usage. |
| **An NL2SQL guardrail reference** | `nl2sql_mcp` runs agent-written SQL behind read-only enforcement, row and date limits, mass scan and Cartesian join blocking, PII control, and an audit log. It runs on a Mock backend out of the box and on PostgreSQL (Pagila sample) with one command. |

## Quick start (Docker)

You need Docker with Compose v2. Nothing else is needed on the host for the stack and the web UI.

```bash
git clone https://github.com/sguys99/mcp-connectors.git
cd mcp-connectors
cp .env.example .env
docker compose up -d --wait
```

Open <http://localhost:3000>. The first run builds the images and takes a few minutes; later starts take seconds. After `git pull`, rebuild with `docker compose up -d --build --wait`, because a plain `up` reuses the old images. The stack runs the Frontend on `:3000` and three MCP servers on `:8001`, `:8002`, and `:8004`. The defaults need no edits: authentication is off, NL2SQL uses its in-memory Mock backend, and no LLM key is required.

### Your first call in the Inspector

1. Open <http://localhost:3000/inspector?server=starter-mcp-http&tool=echo> (or open **Inspector**, pick `starter-mcp-http` in the explorer, then the `echo` tool).
2. Type `hi` in the `text` field.
3. Press **Run** (`Cmd+Enter` / `Ctrl+Enter`). The response pane shows **OK** and a text block with `{"metadata": {"length": 2}, "untrusted_content": {"content": "hi"}}` (formatted), followed by the same object as `structuredContent`.

The browser never talks to port 8001 directly. It calls the same-origin proxy `/api/mcp/starter-mcp-http`, and the Frontend server forwards the request and adds `X-MCP-API-Key` when one is set, so keys stay out of the browser.

<p align="center">
  <img alt="Inspector demo: pick nl2sql-mcp-http in the explorer, choose run_sql_query, type a SELECT, press Run, and the OK response appears with the Mock sample data notice" src="docs/assets/demo/inspector-call.gif" width="100%">
</p>

### Optional: Chat with an LLM

Open **Settings**, choose Anthropic, OpenAI, or OpenRouter, and paste a key (it stays in this browser's `localStorage`). Then open **Chat**, tick a server under **Tools exposed to the model**, and ask, for example, `List the repositories and show the README of the first one.` To use a server-side key instead, put it in `.env` with `CHAT_ALLOW_SERVER_KEYS=true` and run `docker compose up -d --wait` again.

### Optional: NL2SQL on a real PostgreSQL

```bash
make nl2sql-sample-db    # PostgreSQL 17 + Pagila, nl2sql-mcp switches to the real backend
make nl2sql-mock         # back to the Mock backend
```

Stop everything with `docker compose down`. The full walkthrough, including the CLI and running without Docker, is in [docs/getting-started.md](docs/getting-started.md).

## Feature tour

Screenshots follow your GitHub theme (light or dark).

### Dashboard

Every server in `configs/mcp_servers.yaml` at a glance: reachability, tool counts, p50 latency with sparklines on one scale shared by every row (it grows with the slowest recent check), and a log of recent health checks. stdio servers are listed as "on demand" because the CLI spawns them per call.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/dashboard-dark.png">
  <img alt="Dashboard: KPI tiles for HTTP reachability, stdio servers, tool count and p50 latency, a table of five registered servers with status, transport, tools, latency sparklines and Inspect buttons, and the recent checks log" src="docs/assets/screenshots/dashboard-light.png">
</picture>

### Inspector

Tools, resources (including URI templates), and prompts, each with a form generated from the schema or a raw JSON editor. Results render per content block, with a Timing view from `Server-Timing`. NL2SQL results from the Mock backend carry `data_source: "mock_sample"`, and the Inspector shows a **Mock sample data** notice above them. The dock at the bottom holds the raw **JSON-RPC log**, a **History** you can replay or export as a scenario YAML, and **Server info**.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/inspector-call-dark.png">
  <img alt="Inspector on nl2sql-mcp-http: the run_sql_query tool with a SELECT on the film table, example queries for blocked cases, an OK response with a Mock sample data notice above the columns and rows, and the JSON-RPC log below" src="docs/assets/screenshots/inspector-call-light.png">
</picture>

### Chat

An LLM tool-use loop over one or more servers. The Trace panel shows every LLM request and tool call on a timeline with inputs and results. The toolbar sets the model, max iterations (1 to 20), and approval mode (**Auto**, or **Manual** to approve or deny each call), and shows the token usage the provider reported. Conversations are saved in the browser's IndexedDB.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/chat-dark.png">
  <img alt="Chat after a finished run: the answer with a table of payment columns, the Trace waterfall with three LLM requests and two tool calls, the selected search_tables_schema span with its input and result, and token counts in the toolbar" src="docs/assets/screenshots/chat-light.png">
</picture>

### More screens

<table>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/inspector-log-dark.png">
        <img alt="Inspector JSON-RPC log enlarged, listing initialize, tools/list, resources/list and tools/call messages, with the tools/call response expanded as JSON" src="docs/assets/screenshots/inspector-log-light.png">
      </picture>
      <br><b>JSON-RPC log.</b> Every message in both directions, with timing and size. Expand a row to see the raw JSON.
    </td>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/inspector-resources-dark.png">
        <img alt="Inspector Resources tab on starter-mcp-http: the starter://about resource read and rendered as markdown" src="docs/assets/screenshots/inspector-resources-light.png">
      </picture>
      <br><b>Resources and prompts.</b> Read <code>starter://about</code> rendered as markdown, fill URI templates, and get prompts.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/add-server-dark.png">
        <img alt="Add runtime server dialog with a Streamable HTTP URL, a name, the Browser direct and Server proxy connection options, and optional headers" src="docs/assets/screenshots/add-server-light.png">
      </picture>
      <br><b>Runtime servers.</b> Connect any Streamable HTTP server by URL for the current tab, directly from the browser or through an opt-in server proxy.
    </td>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/client-config-dark.png">
        <img alt="Client config dialog for starter-mcp-http with tabs for Claude Desktop, Cursor, VS Code and Claude Code, showing a claude_desktop_config.json snippet with the API key as a placeholder" src="docs/assets/screenshots/client-config-light.png">
      </picture>
      <br><b>Client config.</b> Copy a ready-made config for Claude Desktop, Cursor, VS Code, or Claude Code. Secrets are never included.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/settings-dark.png">
        <img alt="Settings page, LLM provider and model section with Anthropic selected, model pickers for each provider, default max iterations and a system prompt override" src="docs/assets/screenshots/settings-light.png">
      </picture>
      <br><b>Settings.</b> Provider, models, API keys, system prompt override, appearance, and local data reset. Each section's badge shows whether its changes apply on Save or are still unsaved.
    </td>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/mobile-dashboard-dark.png">
        <img alt="Dashboard on a phone-sized screen with KPI tiles, server cards and a bottom navigation bar" src="docs/assets/screenshots/mobile-dashboard-light.png" width="60%">
      </picture>
      <br><b>Responsive.</b> Light and dark themes, English and Korean UI, and a mobile layout.
    </td>
  </tr>
</table>

## What's included

### MCP servers

| Server | Registry names (transport, port) | Tools | Use it to learn |
|---|---|---|---|
| [`starter_mcp`](src/mcp-servers/starter_mcp/README.md) | `starter-mcp` (stdio), `starter-mcp-http` (HTTP :8001) | `echo`, `add`, `current_time`, `sample_content`, plus 4 resources and 2 prompts | The canonical layout and the `_common` helpers. Also the regression baseline |
| [`mock_repo_mcp`](src/mcp-servers/mock_repo_mcp/README.md) | `mock-repo-mcp` (HTTP :8002) | `list_repositories`, `get_file_content`, `search_code` | A swappable `BackendClient` (fixtures or REST), pagination, error handling |
| [`nl2sql_mcp`](src/mcp-servers/nl2sql_mcp/README.md) | `nl2sql-mcp` (stdio), `nl2sql-mcp-http` (HTTP :8004) | `search_tables_schema`, `search_columns`, `get_table_schema`, `get_tables_schema`, `run_sql_query` | Schema discovery and read-only SQL behind a guardrail pipeline. PostgreSQL by default, Oracle optional |

### CLI

`scripts/mcp_cli.py` reads the same registry, starts stdio servers itself, and connects to HTTP servers by URL. The CLI runs on the host, so it needs [uv](https://docs.astral.sh/uv/) and make even when the servers run in Docker. A stdio call prints the FastMCP banner and log lines on stderr first; the JSON at the end is the result.

| Command | What it does |
|---|---|
| `list-servers` | Print the registry: name, transport, endpoint |
| `list-tools`, `call` | List tools, call one with JSON parameters |
| `list-resources`, `read-resource`, `list-prompts`, `get-prompt` | The other MCP primitives |
| `test <file\|dir>` | Run scenario YAML files, with `--tag`, `--id`, `--jobs`, and `--junit report.xml` |

```bash
make init-dev                                   # uv sync and pre-commit hooks
uv run python scripts/mcp_cli.py call --server starter-mcp --tool add --params '{"a":2,"b":3}'
make test-scenarios-starter                     # 15 scenario cases over stdio
```

### Frontend

| Page | Purpose |
|---|---|
| `/` Dashboard | Health, latency, and tool counts of registered and runtime servers, client config copy, getting started checklist |
| `/inspector` | Tools, resources, prompts, JSON-RPC log, history with replay and scenario export, server info |
| `/chat` | LLM tool-use loop, trace waterfall, approval mode, token usage, saved conversations with export and import |
| `/settings` | LLM provider, models, keys, system prompt, appearance, local data |

## Architecture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/diagrams/architecture-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/diagrams/architecture-light.svg">
  <img alt="Architecture: Claude Code skills generate MCP servers on shared _common modules and add them to configs/mcp_servers.yaml. The CLI and the Next.js Frontend read the registry and call the servers. The Frontend proxies registered servers through /api/mcp/[server], runs Chat through /api/chat with LLM providers, and reaches runtime servers directly or through the opt-in /api/mcp-runtime." src="docs/assets/diagrams/architecture-light.svg">
</picture>

The skills generate servers on top of the shared `_common` package and add them to `configs/mcp_servers.yaml`, the single registry that both the CLI and the Frontend read. In the Frontend, the browser reaches registered servers only through the same-origin proxy `/api/mcp/[server]`, which attaches `MCP_API_KEY` on the server side, and Chat runs its tool-use loop in `/api/chat`. Request paths, the Docker topology, and the security boundaries are described in [docs/architecture.md](docs/architecture.md).

## Add your own server

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/diagrams/workflow-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/diagrams/workflow-light.svg">
  <img alt="Workflow: 1 spec with /mcp-spec-writer, 2 implement with /mcp-server-builder, 3 test with make test-NAME and mcp_cli.py test, 4 call one tool with mcp_cli.py call, 5 check in Inspector and Chat. Inspector History exports scenario YAML for mcp_cli.py test." src="docs/assets/diagrams/workflow-light.svg">
</picture>

Two skills write and build the server; the CLI and the Frontend verify it. Calls you make in the Inspector can be exported from History as a scenario file and replayed with `mcp_cli.py test`, so manual checks become regression tests.

1. **Spec**: run `/mcp-spec-writer` in Claude Code and describe the system. It writes `docs/mcp-spec/<server-name>_v0.1.md`.
2. **Implement**: run `/mcp-server-builder` with that spec. It generates `src/mcp-servers/<snake_name>/` with a Mock backend, `tests/<snake_name>/`, a scenario YAML, registry entries, and Makefile targets.
3. **Test**: `make test-<server-name>` and `make test-scenarios-<server-name>`.
4. **CLI check**: `uv run python scripts/mcp_cli.py call --server <server-name> --tool <tool> --params '<json>'`.
5. **Visual check**: call the tools in `/inspector`, then let a model use them in `/chat`.

**No Claude Code?** The skills are optional. They follow patterns already in the repository, so you can copy `starter_mcp` (minimal) or `nl2sql_mcp` (lifespan, `state.py`, `register_tools()`) by hand. Both paths are covered step by step in [docs/writing-a-server.md](docs/writing-a-server.md).

## Repository layout

```text
mcp-connectors/
├── src/mcp-servers/
│   ├── _common/            # auth, cors, env, errors, logging, masking, retry, trust
│   ├── starter_mcp/        # canonical starter (stdio, HTTP :8001)
│   ├── mock_repo_mcp/      # code repository with a fixture backend (HTTP :8002)
│   └── nl2sql_mcp/         # NL2SQL guardrail reference (stdio, HTTP :8004)
├── scripts/mcp_cli.py      # typer CLI
├── configs/
│   ├── mcp_servers.yaml    # server registry shared by the CLI and the Frontend
│   └── prompts/            # Chat system prompt
├── frontend/               # Next.js 16: Dashboard, Inspector, Chat, Settings
├── tests/                  # pytest suites and scenario YAML files
├── docker/postgres/        # NL2SQL sample DB (PostgreSQL 17 + Pagila)
├── docs/                   # guides, specs, diagrams, screenshots
└── .claude/skills/         # mcp-spec-writer, mcp-server-builder
```

## Documentation

| Document | Read it when |
|---|---|
| [Getting started](docs/getting-started.md) | You want the stack running, a first Inspector call, a Chat run, and the CLI |
| [Architecture](docs/architecture.md) | You want to know how the pieces fit, how requests travel, and where the security boundaries are |
| [Writing a server](docs/writing-a-server.md) | You are adding an MCP server, with the skills or by hand |
| [Guardrails](docs/guardrails.md) | You want the NL2SQL guardrails, the `_common` helpers, and the error codes |
| [FAQ](docs/faq.md) | You have a practical question (keys, CORS, cost, Oracle, Windows, production) |
| [docs/README.md](docs/README.md) | You want the full index, including specs and reference material |

<a id="contributing"></a>

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the development setup, conventions, checks to run, and commit format. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Security

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in a public issue. This is a development and verification tool: authentication is off by default and the Docker stack publishes its ports on all interfaces, so read the deployment guidance before exposing it to others.

## License

Licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for third-party attributions. The NL2SQL sample database downloads [Pagila](https://github.com/devrimgunduz/pagila) (PostgreSQL License) at build time; Pagila is not included in this repository.

## Acknowledgements

- [FastMCP](https://github.com/jlowin/fastmcp) for the Python server framework
- The [Model Context Protocol](https://modelcontextprotocol.io) and its [Python](https://github.com/modelcontextprotocol/python-sdk) and [TypeScript](https://github.com/modelcontextprotocol/typescript-sdk) SDKs
- [Pagila](https://github.com/devrimgunduz/pagila) by Devrim Gündüz for the NL2SQL sample data
