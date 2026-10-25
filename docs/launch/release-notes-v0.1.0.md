# MCP Connectors v0.1.0

The first public release of MCP Connectors: a monorepo for building, testing, and running MCP servers that connect AI agents to internal systems (code repositories, relational databases, data warehouses, metadata catalogs, internal APIs), the same way every time.

Spec-driven Claude Code skills write the server, shared guardrails keep it safe, and one local web UI lets you call its tools by hand and watch a real LLM use them.

![Chat demo: the model calls search_tables_schema and get_table_schema on the NL2SQL server while the Trace panel fills with each LLM request and tool call](https://raw.githubusercontent.com/sguys99/mcp-connectors/v0.1.0/docs/assets/demo/chat-tool-use.gif)

## Highlights

- **Three reference servers** in one layout: `starter_mcp` (4 tools, 4 resources, 2 prompts over stdio and Streamable HTTP), `mock_repo_mcp` (swappable mock backend), and `nl2sql_mcp`, an NL2SQL guardrail reference with read-only enforcement, row and date limits, mass scan and Cartesian join blocking, PII control, and an audit log.
- **Shared `_common` security modules**: API key auth, CORS, `.env` loading, `[CODE]` tagged errors, JSON logs that hash arguments, PII masking, retry, and trust-boundary wrapping of external text.
- **Inspector and Chat in one UI**: call a single tool, resource, or prompt with a JSON-RPC log and replayable history, then let Anthropic, OpenAI, or OpenRouter models use the same servers with a trace waterfall, manual approval, and token usage. English and Korean, light and dark, mobile layouts.
- **CLI and scenario runner**: `mcp_cli.py` covers every MCP primitive, and `mcp_cli.py test` runs YAML scenarios with JUnit XML output. Inspector history exports straight to a scenario file.
- **Spec-driven workflow**: `/mcp-spec-writer` writes a 10-section spec, `/mcp-server-builder` turns it into a server, tests, scenarios, and registry entries.
- **One-command start** with Docker Compose, plus an optional PostgreSQL 17 sample database (Pagila) for NL2SQL.

![Inspector on nl2sql-mcp-http: run_sql_query with an OK response and the Mock sample data notice](https://raw.githubusercontent.com/sguys99/mcp-connectors/v0.1.0/docs/assets/screenshots/inspector-call-light.png)

## Quick start

```bash
git clone https://github.com/sguys99/mcp-connectors.git
cd mcp-connectors
cp .env.example .env
docker compose up -d --wait
```

Then open <http://localhost:3000/inspector?server=starter-mcp-http&tool=echo>, type `hi`, and press **Run**. No LLM key is needed for the Inspector. The [Getting started guide](https://github.com/sguys99/mcp-connectors/blob/v0.1.0/docs/getting-started.md) covers Chat, the CLI, and running without Docker.

## What's included

| Part | Contents |
|---|---|
| MCP servers | `starter_mcp` (:8001), `mock_repo_mcp` (:8002), `nl2sql_mcp` (:8004), stdio and Streamable HTTP |
| Shared code | `src/mcp-servers/_common` (auth, cors, env, errors, logging, masking, retry, trust) |
| CLI | `scripts/mcp_cli.py` with `list-*`, `call`, `read-resource`, `get-prompt`, and `test` |
| Frontend | Next.js 16 app: Dashboard, Inspector, Chat, Settings, runtime servers, client config copy |
| Sample data | `docker/postgres` (PostgreSQL 17 + Pagila, read-only account) |
| Skills | `.claude/skills/mcp-spec-writer`, `.claude/skills/mcp-server-builder` |
| Quality | pytest, vitest, Playwright (with axe checks), scenario suites, GitHub Actions CI, gitleaks, Dependabot |

The full list of changes is in the [changelog](https://github.com/sguys99/mcp-connectors/blob/v0.1.0/CHANGELOG.md).

## Known limitations

- This is a development and verification tool. Authentication is off by default and the Docker stack publishes its ports on all interfaces; read the [deployment guidance](https://github.com/sguys99/mcp-connectors/blob/v0.1.0/SECURITY.md#deployment-guidance) before exposing it to others.
- The Docker host ports (3000, 8001, 8002, 8004) are fixed in `docker-compose.yaml`. Stop anything else listening on them first, or edit the `ports` entries.
- Runtime servers added from the UI last only for the current browser tab, and browser-direct connections need CORS on the target server.
- Chat needs your own LLM API key (Anthropic, OpenAI, or OpenRouter). Keys stay in the browser unless you opt in to server-side keys.
- `nl2sql_mcp` targets PostgreSQL by default; Oracle is an optional dialect and is not covered by CI.
- The Frontend has been checked with axe and an automated screen reader approximation; a manual VoiceOver and NVDA pass is still pending.
- On mobile, the Inspector and Chat paint their main content after the MCP connection is set up, so mobile LCP is around 5 seconds on a throttled profile.

## Documentation

- [README](https://github.com/sguys99/mcp-connectors/blob/v0.1.0/README.md) ([한국어](https://github.com/sguys99/mcp-connectors/blob/v0.1.0/README.ko.md))
- [Getting started](https://github.com/sguys99/mcp-connectors/blob/v0.1.0/docs/getting-started.md)
- [Architecture](https://github.com/sguys99/mcp-connectors/blob/v0.1.0/docs/architecture.md)
- [Writing a server](https://github.com/sguys99/mcp-connectors/blob/v0.1.0/docs/writing-a-server.md)
- [Guardrails](https://github.com/sguys99/mcp-connectors/blob/v0.1.0/docs/guardrails.md)
- [FAQ](https://github.com/sguys99/mcp-connectors/blob/v0.1.0/docs/faq.md)
- [Contributing](https://github.com/sguys99/mcp-connectors/blob/v0.1.0/CONTRIBUTING.md)
