# mock-repo-mcp

A code repository server with three read tools, backed by local fixtures by default and by a real REST API when you set one URL.

## What it is for

- **Learning step 2.** It adds what `starter_mcp` leaves out: a backend client behind a `Protocol`, a mock implementation you can swap for a real one, pagination, empty results and not-found errors.
- **Swappable backend.** `tools.py` depends only on `BackendClient`. `MockBackendClient` reads `fixtures/`; `HttpBackendClient` calls a REST API with retries. Setting `MOCK_REPO_BACKEND_URL` switches between them, so you can follow the same shape when you connect a real internal system.
- **Trust boundary example.** File contents are external text and are returned inside `untrusted_content`.
- **Demo and E2E target.** The Inspector and Chat demos use it, and `make test-e2e` starts it automatically for Playwright.

## Tools

The server exposes tools only (no resources or prompts).

| Tool | Arguments | Behavior |
|---|---|---|
| `list_repositories` | `name_pattern: str \| None = None`, `limit: int = 20`, `offset: int = 0` | Returns `{"repositories": [...], "total_count": N}`. `name_pattern` is a case-insensitive substring match on the repository name. `total_count` counts all matches before paging. A negative `limit` or `offset` raises `InvalidInputError`. |
| `get_file_content` | `repository_id: str`, `path: str`, `revision: str \| None = None` | Returns `{"metadata": {"path", "revision", "size"}, "untrusted_content": {"content"}}`. `size` is the UTF-8 byte length. A missing file raises `NotFoundError` with `FILE_NOT_FOUND: <repo>:<path>`. The mock ignores `revision`. |
| `search_code` | `query: str`, `repository_id: str \| None = None`, `limit: int = 50` | Returns `{"matches": [{"repository_id", "path", "line_number", "preview"}]}`. The mock does a case-sensitive substring match per line and stops at `limit`. Empty `query` or negative `limit` raises `InvalidInputError`. |

Each tool logs its call with a `params_hash` field (`_common.logging.hash_params`) instead of raw parameters.

### Where `_common` is used

| Module | Where | Pattern |
|---|---|---|
| `_common.trust.wrap_untrusted` | `get_file_content` in `tools.py` | File content isolated as `untrusted_content` |
| `_common.errors.InvalidInputError` | `list_repositories`, `search_code` | Negative `limit` or `offset`, empty `query` |
| `_common.errors.NotFoundError` | both clients in `client.py` | `FILE_NOT_FOUND` |
| `_common.errors.BackendUnavailableError` | `HttpBackendClient` | Retries exhausted, or a 4xx other than 404, ends with `[BACKEND_UNAVAILABLE]` |
| `_common.retry.with_backoff` | `HttpBackendClient._get_json` | Retries network errors, timeouts, 5xx and 429 with exponential backoff |
| `_common.logging.setup_logger`, `hash_params` | `tools.py` | Structured logs |
| `_common.auth.build_http_middleware` | `server.py`, HTTP branch only | CORS plus `X-MCP-API-Key` checking |

## Backends

### Mock (default)

`MockBackendClient` loads everything into memory once at startup:

- `fixtures/repos.json`: three repositories (`repo-alpha` / `alpha-service`, `repo-beta` / `beta-frontend`, `repo-gamma` / `gamma-utils`), each with `id`, `name`, `description` and `default_branch`.
- `fixtures/files/<repository_id>/<path>`: the file tree for each repository. Files added here show up in `get_file_content` and `search_code` after a restart.

### HTTP

When `MOCK_REPO_BACKEND_URL` is set, `tools.py` builds an `HttpBackendClient` (httpx, 10 s timeout, 2 attempts) that expects this REST contract:

```
GET {base_url}/repositories?name_pattern=&limit=&offset=      -> {"repositories": [...], "total_count": N}
GET {base_url}/repositories/{repository_id}/files?path=&revision= -> {"content": "..."}
GET {base_url}/search?query=&repository_id=&limit=             -> {"matches": [...]}
```

A 404 becomes `NotFoundError` without retry. If your API uses other paths, change them in [client.py](client.py).

For tests, inject a client with `monkeypatch.setattr("mock_repo_mcp.tools._client", MockBackendClient(fixtures_dir=...))`.

## Run

| Transport | Command | Endpoint |
|---|---|---|
| Streamable HTTP (default) | `make run-mock-repo-mcp` | `http://localhost:8002/mcp` (registry name `mock-repo-mcp`) |
| Docker | `make docker-up` (whole stack) or `docker compose up -d mock-repo-mcp` | `http://localhost:8002/mcp`, `http://mock-repo-mcp:8002/mcp` inside the compose network |
| stdio | `uv run python -m mock_repo_mcp.server --transport stdio` (from `src/mcp-servers`) | Not in the registry or the Makefile. Kept so every server has the same entry point. |

The default transport is `http`, so `uv run python -m mock_repo_mcp.server` with no flag also starts Streamable HTTP.

## Configuration

Settings come from `config.py` (pydantic-settings). Values are read in this order, later wins: the repository root `.env`, then `src/mcp-servers/mock_repo_mcp/.env` (optional override), then OS environment variables. See [`.env.example`](.env.example).

| Variable | Default | Meaning |
|---|---|---|
| `MOCK_REPO_MCP_PORT` | `8002` | Port for Streamable HTTP. Ignored for stdio. |
| `MOCK_REPO_BACKEND_URL` | empty | Root URL of a real repository REST API. Empty uses the fixture mock. |
| `MCP_API_KEY` | empty | When set, HTTP requests must send it in `X-MCP-API-Key`, otherwise they get 401. Empty disables the check. |
| `MCP_CORS_ORIGINS` | `http://localhost:3000` | Comma-separated origins allowed for direct browser connections. Process environment first, then the package `.env`, then the root `.env` (same rules as other settings). Docker Compose passes it through from the root `.env`. |

## Example CLI calls

Start the server first (`make run-mock-repo-mcp` or `make docker-up`), then run from the repository root:

```bash
uv run python scripts/mcp_cli.py list-tools --server mock-repo-mcp
uv run python scripts/mcp_cli.py call --server mock-repo-mcp --tool list_repositories --params '{"name_pattern":"alpha"}'
uv run python scripts/mcp_cli.py call --server mock-repo-mcp --tool get_file_content --params '{"repository_id":"repo-alpha","path":"README.md"}'
uv run python scripts/mcp_cli.py call --server mock-repo-mcp --tool search_code --params '{"query":"def ","limit":3}'
```

The first call returns:

```json
{
  "repositories": [
    {
      "id": "repo-alpha",
      "name": "alpha-service",
      "description": "Payments domain backend service (sample)",
      "default_branch": "main"
    }
  ],
  "total_count": 1
}
```

A missing path returns an error object:

```bash
uv run python scripts/mcp_cli.py call --server mock-repo-mcp --tool get_file_content --params '{"repository_id":"repo-alpha","path":"nope.md"}'
# {"error": {"code": "TOOL_ERROR", "message": "FILE_NOT_FOUND: repo-alpha:nope.md"}}
```

## Testing

```bash
make test-mock-repo-mcp   # pytest tests/mock_repo_mcp/ (23 tests, no server or network needed)
make test-http            # Streamable HTTP transport tests, including API key checks on this server
make test-e2e             # Frontend Playwright E2E, starts mock-repo-mcp itself
```

| File | Covers |
|---|---|
| `tests/mock_repo_mcp/conftest.py` | FastMCP in-memory `Client` fixture |
| `tests/mock_repo_mcp/test_tools.py` | Success, `FILE_NOT_FOUND`, empty results, pagination |
| `tests/mock_repo_mcp/test_http_client.py` | `HttpBackendClient` with `httpx.MockTransport`: retries and error mapping |
| `tests/mock_repo_mcp/test_mcp_contract.py` | `list_tools` and `inputSchema` contract |

`tests/mock_repo_mcp/` has no `__init__.py` on purpose (it would clash with the package name; pytest uses `--import-mode=importlib`).

## File layout

```
src/mcp-servers/mock_repo_mcp/
├── __init__.py
├── server.py       # FastMCP instance, registers the 3 tools, --transport http|stdio (default http)
├── tools.py        # tool functions, delegate to the module-level _client
├── client.py       # BackendClient Protocol, MockBackendClient, HttpBackendClient
├── config.py       # pydantic-settings: MOCK_REPO_MCP_PORT, MOCK_REPO_BACKEND_URL, MCP_API_KEY
├── models.py       # documentation models for the response shapes
├── .env.example
└── fixtures/
    ├── repos.json
    └── files/
        ├── repo-alpha/
        ├── repo-beta/
        └── repo-gamma/
```

## Related documents

- Spec: [docs/mcp-spec/mock_repo_mcp_v0.1.md](../../../docs/mcp-spec/mock_repo_mcp_v0.1.md)
- [docs/getting-started.md](../../../docs/getting-started.md)
- [docs/writing-a-server.md](../../../docs/writing-a-server.md)
- [docs/guardrails.md](../../../docs/guardrails.md)
- Previous example: [starter_mcp](../starter_mcp/README.md). Next example: [nl2sql_mcp](../nl2sql_mcp/README.md)
