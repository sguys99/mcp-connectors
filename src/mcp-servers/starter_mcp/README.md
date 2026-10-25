# starter-mcp

The canonical starter server: four tools, four resources and two prompts with no external backend, written to show how a server in this repository uses `_common/`.

## What it is for

- **Learning step 1.** Read it before `mock_repo_mcp` and `nl2sql_mcp`. Every tool calls a `_common` module in plain sight, so you can copy the patterns into a new server.
- **Regression baseline.** It has no external dependency, so `make test-starter-mcp`, `make test-scenarios-starter`, `make cli-call-starter` and the Inspector should always give the same result. If they change after an infrastructure edit, the edit broke something.
- **Primitive coverage.** It exposes all three MCP primitives (tools, resources, prompts) and every tool content block type (text, image, embedded resource), so clients such as the Inspector can be checked against it.
- **Transport reference.** One entry point serves both stdio and Streamable HTTP.

## Tools, resources and prompts

Tools are called by the model, resources are read by the application, and prompts are picked by the user.

| Kind | Name | Arguments | Behavior |
|---|---|---|---|
| Tool | `echo` | `text: str` | Returns `{"metadata": {"length": N}, "untrusted_content": {"content": text}}`. Empty `text` raises `InvalidInputError`. |
| Tool | `add` | `a: int`, `b: int` | Returns `a + b`. Logs the call with a SHA256 short hash of the parameters in the `params_hash` field. |
| Tool | `current_time` | `tz: str = "UTC"` | Returns the current time in an IANA time zone as ISO 8601. An unknown zone raises `InvalidInputError`. |
| Tool | `sample_content` | `message: str = "Hello from starter-mcp"` | Returns three content blocks: text (the wrapped message), image (a 16x16 PNG) and an embedded resource (`starter://about`). Empty `message` raises `InvalidInputError`. |
| Resource | `starter://about` | | Static markdown overview (`text/markdown`). |
| Resource | `starter://config` | | Non-secret configuration as JSON: HTTP port, `auth_enabled` (true or false, never the key) and primitive names. |
| Resource template | `starter://greeting/{name}` | `name` from the URI | JSON greeting with the name isolated by `wrap_untrusted`. Empty names and names over 50 characters are rejected. |
| Resource | `starter://logo.png` | | Binary PNG (`image/png`, sent as a base64 `blob`). The PNG is generated in code. |
| Prompt | `explain_tool` | `tool_name` (required), `audience` (`beginner` or `expert`, default `beginner`) | One user message asking the model to explain a tool. Any other `audience` is rejected. |
| Prompt | `code_review_session` | `language` (required), `focus` (default `correctness`) | Three messages (user, assistant, user) that set up a code review. |

Registering any resource or prompt makes FastMCP advertise the `resources` and `prompts` capabilities in `initialize`, on both transports.

### Where `_common` is used

| Module | Used in | Pattern |
|---|---|---|
| `_common.trust.wrap_untrusted` | `echo`, `sample_content`, `greeting` resource | External text goes into `untrusted_content` so the LLM does not read it as instructions. |
| `_common.logging.setup_logger`, `hash_params` | `tools.py` module level, `add` | Structured JSON logs with a parameter hash instead of raw values. |
| `_common.errors.InvalidInputError` | `echo`, `current_time`, `sample_content`, `greeting`, `explain_tool` | Input validation errors returned to the client. |
| `_common.auth.build_http_middleware` | `server.py`, HTTP branch only | CORS plus `X-MCP-API-Key` checking. |
| `_common.env.env_files` | `config.py` | Reads the repository root `.env` and an optional package `.env`. |

Two implementation notes. `primitives.py` does not use `from __future__ import annotations`, because FastMCP compares prompt argument types with `str` directly and string annotations add a JSON schema hint to the argument description. The `greeting` template returns a `ResourceResult` so its mime type is `application/json` instead of the template default `text/plain`.

## Run

| Transport | Command | Endpoint |
|---|---|---|
| stdio | `make run-starter-mcp` | spawned as a child process (registry name `starter-mcp`) |
| Streamable HTTP | `make run-starter-mcp-http` | `http://localhost:8001/mcp` (registry name `starter-mcp-http`) |
| Docker | `make docker-up` (whole stack) or `docker compose up -d starter-mcp` | `http://localhost:8001/mcp`, `http://starter-mcp:8001/mcp` inside the compose network |

Direct commands, from `src/mcp-servers`:

```bash
uv run python -m starter_mcp.server --transport stdio   # default
uv run python -m starter_mcp.server --transport http    # port from STARTER_MCP_PORT
```

The stdio variant is not part of the Docker stack. IDEs and the CLI start it on the host.

## Configuration

Settings come from `config.py` (pydantic-settings). Values are read in this order, later wins: the repository root `.env`, then `src/mcp-servers/starter_mcp/.env` (optional override), then OS environment variables. See [`.env.example`](.env.example) and the root `.env.example`.

| Variable | Default | Meaning |
|---|---|---|
| `STARTER_MCP_PORT` | `8001` | Port for Streamable HTTP. Ignored for stdio. |
| `MCP_API_KEY` | empty | When set, HTTP requests must send it in `X-MCP-API-Key`, otherwise they get 401. Empty disables the check. stdio is never affected. |
| `MCP_CORS_ORIGINS` | `http://localhost:3000` | Comma-separated origins allowed for direct browser connections (HTTP only). Read by `_common/cors.py` with the same rules as other settings: the process environment wins, then the package `.env`, then the root `.env`. Docker Compose passes it through from the root `.env`. |

When `MCP_API_KEY` is set, `scripts/mcp_cli.py` and the Frontend proxy add the header for you.

## Example CLI calls

Run from the repository root. The stdio server starts automatically.

```bash
uv run python scripts/mcp_cli.py list-tools --server starter-mcp
uv run python scripts/mcp_cli.py call --server starter-mcp --tool echo --params '{"text":"hi"}'
uv run python scripts/mcp_cli.py call --server starter-mcp --tool add --params '{"a":2,"b":3}'
uv run python scripts/mcp_cli.py call --server starter-mcp --tool current_time --params '{"tz":"Asia/Seoul"}'
uv run python scripts/mcp_cli.py list-resources --server starter-mcp
uv run python scripts/mcp_cli.py read-resource --server starter-mcp --uri starter://greeting/Ada
uv run python scripts/mcp_cli.py list-prompts --server starter-mcp
uv run python scripts/mcp_cli.py get-prompt --server starter-mcp --name explain_tool --args '{"tool_name":"echo"}'
```

`make cli-call-starter` runs the `echo` call above. The output contains:

```json
{
  "metadata": {
    "length": 2
  },
  "untrusted_content": {
    "content": "hi"
  }
}
```

To call the HTTP variant, start `make run-starter-mcp-http` (or Docker) and use `--server starter-mcp-http`.

## Testing

```bash
make test-starter-mcp         # pytest tests/starter_mcp/ (31 tests, in-memory client)
make test-scenarios-starter   # tests/scenarios/starter.yaml over stdio (15 cases, pass threshold 100%)
make test-http                # Streamable HTTP transport tests, API key on and off
```

| File | Covers |
|---|---|
| `tests/starter_mcp/conftest.py` | FastMCP in-memory `Client` fixture |
| `tests/starter_mcp/test_tools.py` | Each tool, error cases, `_common` call traces |
| `tests/starter_mcp/test_primitives.py` | Capabilities, resources, prompts, `sample_content` blocks |
| `tests/starter_mcp/test_mcp_contract.py` | `list_tools` and `inputSchema` contract |
| `tests/scenarios/starter.yaml` | End-to-end scenarios through `mcp_cli.py test` |

`tests/starter_mcp/` has no `__init__.py` on purpose: it would clash with the `starter_mcp` package. pytest runs with `--import-mode=importlib`.

## File layout

```
src/mcp-servers/starter_mcp/
├── __init__.py
├── server.py       # FastMCP instance, registers tools, resources and prompts, --transport stdio|http
├── tools.py        # echo, add, current_time, sample_content (plain async functions)
├── primitives.py   # resource and prompt functions (registered in server.py)
├── config.py       # pydantic-settings: STARTER_MCP_PORT, MCP_API_KEY
├── models.py       # documentation models for the response shapes
└── .env.example
```

Tool and primitive functions carry no decorators. `server.py` is the only place that binds them to FastMCP (`mcp.add_tool`, `mcp.resource`, `mcp.prompt`), which keeps the `_common` patterns easy to read.

## Using it as a template

1. Copy `__init__.py`, `server.py`, `tools.py`, `config.py`, `models.py` and `.env.example` to `src/mcp-servers/<snake_name>/` and rename the `starter_mcp` imports.
2. Replace the tools. Keep the patterns: `wrap_untrusted` for external data, `InvalidInputError` for bad input, `hash_params` in logs.
3. Add new settings to both `Settings` in `config.py` and `.env.example`.
4. Write `tests/<snake_name>/` with `conftest.py`, `test_tools.py` and `test_mcp_contract.py`, without `__init__.py`.
5. Add `run-<name>`, `run-<name>-http` and `test-<name>` Makefile targets and a `configs/mcp_servers.yaml` entry.

The `/mcp-server-builder` skill does all of this from a spec. See [docs/writing-a-server.md](../../../docs/writing-a-server.md).

## Related documents

- Spec: [docs/mcp-spec/starter-mcp_v0.2.md](../../../docs/mcp-spec/starter-mcp_v0.2.md)
- [docs/getting-started.md](../../../docs/getting-started.md)
- [docs/writing-a-server.md](../../../docs/writing-a-server.md)
- [docs/guardrails.md](../../../docs/guardrails.md)
- Next example: [mock_repo_mcp](../mock_repo_mcp/README.md)
