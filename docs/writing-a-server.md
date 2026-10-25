# Writing a server

This guide adds a new MCP server to the repository. With Claude Code, two skills do most of the work. Without it, you copy the patterns of the existing servers by hand. Either way the result is the same: a package under `src/mcp-servers/`, tests, a scenario file, a registry entry, and Makefile targets, after which the CLI, the Inspector, and Chat work with the new server without further changes.

<picture><source media="(prefers-color-scheme: dark)" srcset="assets/diagrams/workflow-dark.svg"><img alt="Workflow: 1 spec with /mcp-spec-writer, 2 implement with /mcp-server-builder, 3 test with make test-NAME and mcp_cli.py test, 4 call one tool with mcp_cli.py call, 5 check in Inspector and Chat. Inspector History exports scenario YAML for mcp_cli.py test." src="assets/diagrams/workflow-light.svg" width="100%"></picture>

## Contents

- [With Claude Code](#with-claude-code)
- [Without Claude Code](#without-claude-code)
- [Conventions](#conventions)
- [Verify the server](#verify-the-server)
- [Show it in the Docker Frontend](#show-it-in-the-docker-frontend)

## With Claude Code

### 1. Write a spec with `/mcp-spec-writer`

Run `/mcp-spec-writer` and describe the system you want to connect (for example, "an MCP server over our internal metadata catalog API"). The skill interviews you section by section, asking at most four questions at a time, and writes `docs/mcp-spec/<server-name>_v0.1.md`.

- **Language**: English or Korean. The skill follows the language you name, otherwise the language of your request. Both templates (`.claude/skills/mcp-spec-writer/references/template_v2.en.md` and `template_v2.md`) have the same section numbers, headings, and table layout.
- **Sections 0 to 10**: document info, overview, scope, users and scenarios, system architecture (transport, backends), functional requirements (the tool list in 5.1 and one `#### ▶ T-NN` block per tool in 5.2, optional resources and prompts in 5.3), non-functional requirements, error handling, deliverables, schedule, acceptance criteria.
- **Tool blocks** define everything the builder needs: the LLM description (what, when to call, when not to call, example), parameters, an output example, empty results, size limits, and error codes.
- Facts only you can provide (endpoints, owners, auth) can stay as **확인 필요** / "to be confirmed". The builder turns them into TODO markers.

A finished example is `.claude/skills/mcp-spec-writer/references/example_code_repo.md`. The specs of the bundled servers are in [docs/mcp-spec/](mcp-spec/).

### 2. Build it with `/mcp-server-builder`

Run `/mcp-server-builder` with the spec path. The skill validates the spec, asks up to four questions about missing facts, and generates:

| Output | Content |
|---|---|
| `src/mcp-servers/<snake_name>/` | `server.py` (FastMCP with a lifespan, `register_tools()`, `--transport stdio\|http`, `--host`, `--port`), `state.py`, `tools.py` or `tools/`, `client.py` (a `BackendClient` protocol, a Mock client that returns the spec's examples, a real client stub), `config.py`, optional `primitives.py` and `models.py`, `.env.example`, `README.md` |
| `tests/<snake_name>/` | `conftest.py`, `test_tools.py`, `test_mcp_contract.py`, and `test_auth_middleware.py` for HTTP servers. No `__init__.py` |
| `tests/scenarios/<kebab-name>.yaml` | A smoke case and a typical error case per tool for `mcp_cli.py test` |
| `configs/mcp_servers.yaml` | `<kebab-name>` (stdio) and `<kebab-name>-http` (streamable_http) with `description` and `description_ko` |
| `Makefile` | `run-<kebab-name>`, a `-stdio` or `-http` variant, `test-<kebab-name>`, `test-scenarios-<kebab-name>` |
| `pyproject.toml`, `.env.example` | The package in ruff `known-first-party`, a `<UPPER_NAME>_PORT` line in the root `.env.example` |

It does not touch `_common/`, and it picks a port that does not clash with 8001, 8002, or 8004. Then it runs `ruff format`, `ruff check`, `make test-<kebab-name>`, and `make test-scenarios-<kebab-name>` and fixes failures until all pass. Spec items that were not confirmed become `# TODO(스펙 미정: ...)` markers; list them with `grep -rn "TODO(스펙 미정" src/mcp-servers/<snake_name>/`.

The Mock backend is the default (`<UPPER_NAME>_BACKEND_URL` empty), so the server runs end to end before any real integration exists. To connect the real system, replace the `NotImplementedError` methods of the real client and set the URL. The tests and scenarios written against the Mock become your regression baseline.

## Without Claude Code

The skills write code that follows patterns already in the repository, so you can apply them by hand. The builder's templates are in `.claude/skills/mcp-server-builder/references/server_skeleton.md` (comments in Korean, code in English). Use these servers as references:

| Pattern | Reference |
|---|---|
| Tools, resources, prompts, both transports, minimal config | `src/mcp-servers/starter_mcp/` |
| Backend client protocol, Mock and HTTP clients, retries | `src/mcp-servers/mock_repo_mcp/client.py` |
| Lifespan, `state.py`, `register_tools()`, tools split into modules | `src/mcp-servers/nl2sql_mcp/server.py`, `state.py`, `tools/__init__.py` |

The starter is the shortest example: it has no backend, so it has no lifespan or `state.py`, and it binds its decorator-free functions in `server.py` with `mcp.add_tool(...)`. A server with a backend should follow the nl2sql layout below.

### 1. Package

Create `src/mcp-servers/<snake_name>/` (snake_case, so it imports) with:

**`config.py`**: pydantic-settings that read the root `.env` and an optional package `.env`, wherever the process starts.

```python
from pydantic_settings import BaseSettings, SettingsConfigDict

from _common.env import env_files


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=env_files(__file__), env_file_encoding="utf-8", extra="ignore")

    my_server_mcp_port: int = 8010           # MY_SERVER_MCP_PORT
    my_server_mcp_backend_url: str = ""      # empty means Mock
    mcp_api_key: str | None = None


settings = Settings()
```

**`state.py`**: the backend shared during the server's lifetime. Tools read it here instead of importing `server.py`, which avoids circular imports and lets tests swap the backend.

```python
from dataclasses import dataclass

from _common.errors import BackendUnavailableError


@dataclass
class AppState:
    backend: object | None = None


state = AppState()


def get_backend():
    if state.backend is None:
        raise BackendUnavailableError("The backend client is not initialized. Retry shortly. [BACKEND_UNAVAILABLE]")
    return state.backend
```

**`tools.py`**: plain async functions, no decorators, plus a `TOOLS` tuple and `register_tools()`.

```python
from typing import Annotated, Any

from fastmcp import FastMCP
from pydantic import Field

from _common.errors import InvalidInputError
from _common.masking import mask_pii
from _common.trust import wrap_untrusted
from my_server_mcp.state import get_backend


async def get_item(
    item_id: Annotated[str, Field(description='Item ID from list_items (e.g. "item_001")')],
) -> dict[str, Any]:
    """Return one item's metadata and its free-text description.
    Use it after list_items when you need the details of a specific item.
    Example: "what is item_001?" -> get_item(item_id="item_001")
    """
    if not item_id:
        raise InvalidInputError("item_id is required. [INVALID_INPUT]")
    item = await get_backend().get_item(item_id)
    return wrap_untrusted(
        metadata={"id": item["id"], "name": item["name"]},
        untrusted_content={"description": mask_pii(item["description"])},
    )


_READ_ONLY = {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True}
TOOLS = ((get_item, _READ_ONLY),)


def register_tools(mcp: FastMCP) -> FastMCP:
    for fn, hints in TOOLS:
        mcp.tool(fn, annotations=hints)
    return mcp
```

**`server.py`**: the FastMCP instance with a lifespan that builds the backend once, and `main()` with `--transport`. The HTTP branch is the only place that adds middleware.

```python
mcp = register_tools(FastMCP("my-server-mcp", lifespan=lifespan))


def main() -> None:
    parser = argparse.ArgumentParser(prog="my-server-mcp")
    parser.add_argument("--transport", choices=["stdio", "http"], default="http")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=settings.my_server_mcp_port)
    args = parser.parse_args()
    if args.transport == "stdio":
        mcp.run(transport="stdio")
    else:
        mcp.run(transport="http", host=args.host, port=args.port,
                middleware=build_http_middleware(settings.mcp_api_key))
```

For resources and prompts, add a `primitives.py` like `starter_mcp/primitives.py` and register its functions in `server.py` with `mcp.resource(...)` and `mcp.prompt(...)`. FastMCP then advertises the capabilities and the Inspector shows the Resources and Prompts tabs. Also add `.env.example` (your keys plus `MCP_API_KEY` and `MCP_CORS_ORIGINS`) and a `README.md`.

### 2. Wire it into the repository

1. **ruff**: add `<snake_name>` to `known-first-party` under `[tool.ruff.lint.isort]` in `pyproject.toml`, otherwise ruff reports I001 on `_common` imports.
2. **Registry**: append both entries to `configs/mcp_servers.yaml`.

   ```yaml
     - name: my-server-mcp
       transport: stdio
       command: ["uv", "run", "python", "-m", "my_server_mcp.server", "--transport", "stdio"]
       description: "Items catalog (1 tool, mock backend by default), stdio"
       description_ko: "아이템 카탈로그 (도구 1종, 기본 Mock 백엔드), stdio"

     - name: my-server-mcp-http
       transport: streamable_http
       url: http://localhost:8010/mcp
       description: "Items catalog, Streamable HTTP"
       description_ko: "아이템 카탈로그, Streamable HTTP"
   ```

   The CLI runs stdio commands from `src/mcp-servers/`. Add `internalUrl` only when you also add a compose service (see [below](#show-it-in-the-docker-frontend)).
3. **Makefile**: kebab-case targets, also listed in `.PHONY`.

   ```makefile
   run-my-server-mcp:  ## Run my-server-mcp (Streamable HTTP, port 8010)
   	cd src/mcp-servers && uv run python -m my_server_mcp.server --transport http

   test-my-server-mcp:  ## Test my-server-mcp
   	uv run pytest tests/my_server_mcp/ -v

   test-scenarios-my-server-mcp:  ## Run my-server-mcp YAML scenarios over stdio
   	uv run python scripts/mcp_cli.py test tests/scenarios/my-server-mcp.yaml $(ARGS)
   ```

4. **Root `.env.example`**: add `MY_SERVER_MCP_PORT=8010`.

### 3. Tests

Put tests in `tests/<snake_name>/` and **do not create `__init__.py`** there. The test folder has the same name as the server package, and pytest runs with `--import-mode=importlib` (and `asyncio_mode = "auto"`) so each test module loads in its own namespace. `pythonpath = [".", "src/mcp-servers"]` makes `from my_server_mcp.tools import ...` and `from _common...` work.

Use the in-memory FastMCP client and swap the backend through `state`:

```python
import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from my_server_mcp.server import mcp
from my_server_mcp.state import state


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setattr(state, "backend", FakeBackend())
    async with Client(mcp) as c:
        yield c


async def test_get_item_missing(client):
    with pytest.raises(ToolError, match=r"\[ITEM_NOT_FOUND\]"):
        await client.call_tool("get_item", {"item_id": "missing"})
```

The builder's test templates are in `.claude/skills/mcp-server-builder/references/test_patterns.md`.

### 4. Scenario file

Add `tests/scenarios/<kebab-name>.yaml` in the format of [scenario-format.md](scenario-format.md):

```yaml
version: 1
server: my-server-mcp          # stdio entry: the runner starts the server
cases:
  - id: get-item-smoke
    required: true
    tool: get_item
    params: {item_id: item_001}
    expect:
      checks:
        - {field: metadata.id, op: eq, value: item_001}
  - id: get-item-not-found
    tool: get_item
    params: {item_id: missing}
    expect:
      status: error
      error_code: ITEM_NOT_FOUND
```

`error_code` is compared with the `[CODE]` at the end of the error message. In flow style, quote any path that contains `[`, for example `{field: "items[0].id", op: exists}`, or the YAML fails to parse.

### 5. Spec

Even without the skill, write a spec in `docs/mcp-spec/` from the template, so reviewers can compare the code with the intended behavior.

## Conventions

| Rule | Detail |
|---|---|
| English for everything the LLM sees | Tool docstrings, `Field(description=...)`, resource and prompt descriptions, error messages. Code comments and logs may be in another language |
| Docstrings as instructions | State what the tool does, when to call it, when not to, and an example call |
| `[CODE]` suffix on errors | Raise a `_common.errors` subclass whose message ends with an upper-case code, for example `"Table 'films' was not found. Confirm the exact name with search_tables_schema. [TABLE_NOT_FOUND]"`. The CLI, the scenario runner, and the Inspector read the code from the brackets; without it they show `TOOL_ERROR` |
| `wrap_untrusted` for external text | File bodies, descriptions, comments, query rows, user input go into `untrusted_content`; IDs, paths, counts go into `metadata` |
| `mask_pii` before returning text | Apply it to string values from external systems |
| Log hashes, not arguments | `setup_logger("<kebab-name>")` and `extra={"params_hash": hash_params(params)}` |
| One client per process | Create backend clients in the lifespan and close them on shutdown, not per call. Wrap transient failures with `_common.retry.with_backoff` |
| Naming | Package snake_case (`my_server_mcp`); FastMCP name, registry name, Makefile targets kebab-case (`my-server-mcp`); env vars `<UPPER_NAME>_*`; shared `MCP_API_KEY` and `MCP_CORS_ORIGINS` without a prefix |
| `_common` is read only | Import from it; do not add server code to it |

[guardrails.md](guardrails.md) explains the `_common` helpers and the NL2SQL guardrails in more detail.

## Verify the server

Run these from the repository root, in order:

```bash
uv run ruff format src/mcp-servers/my_server_mcp tests/my_server_mcp
uv run ruff check src/mcp-servers/my_server_mcp tests/my_server_mcp
make test-my-server-mcp                       # unit and contract tests
uv run python scripts/mcp_cli.py list-tools --server my-server-mcp
uv run python scripts/mcp_cli.py call --server my-server-mcp --tool get_item --params '{"item_id":"item_001"}'
make test-scenarios-my-server-mcp             # scenario file over stdio, add ARGS="--junit out.xml" for CI
```

Then check it visually:

1. Start the HTTP variant: `make run-my-server-mcp`.
2. Run the Frontend on the host (`make frontend-dev`, see [getting-started.md](getting-started.md#local-development-without-docker)). It reads the registry on every request, so the new server appears without a restart.
3. **Inspector**: pick `my-server-mcp-http`, call each tool, and check the JSON-RPC log and Server info.
4. **Chat**: expose the server under **Tools exposed to the model** and ask a question that needs it. Manual approval mode lets you inspect each call before it runs. A tool the model never picks usually needs a clearer docstring.
5. **History to scenario**: in the Inspector dock, open **History**, select calls, and use **Export scenario**. The file uses the same format as `mcp_cli.py test`, with expected values derived from the observed responses (marked with `derived` tags and a `note` check). Review it, save it under `tests/scenarios/`, and run it with `uv run python scripts/mcp_cli.py test <file>`. Exported cases target the server you called, so the HTTP server must be running, or change `server:` to the stdio name.

## Show it in the Docker Frontend

The Docker Frontend cannot reach a server you run on the host: inside the container, `localhost` is the container itself, and the registry is copied into the image at build time. To make the new server part of the stack:

1. Add a compose service like `starter-mcp` in `docker-compose.yaml` (shared `Dockerfile`, `command: ["my_server_mcp.server", "--transport", "http"]`, port mapping, `MCP_API_KEY: ${MCP_API_KEY:-}`), and add it to the `frontend` service's `depends_on`.
2. Add `internalUrl: http://<service-name>:<port>/mcp` to the `-http` registry entry.
3. Add the service name to `COMPOSE_SERVICES` in `frontend/src/lib/dashboard/offline.ts`, so the Dashboard can suggest `docker compose up -d <service>` when it is offline (a test compares this list with the compose file).
4. Rebuild: `docker compose up -d --build --wait`.

The `nl2sql-mcp` service is a complete example, including a health check and a volume.
