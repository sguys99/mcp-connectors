# Screenshots and demo GIFs

Captured from the real app running on the Docker Compose stack (all three MCP servers, NL2SQL on its Mock backend).
Nothing in the UI is faked. Chat uses the real Anthropic API with `claude-haiku-4-5`, so the model's wording changes
from run to run. Before each shot the script hides the Getting started card and any toast, and it never types an API key
(Chat uses the server key, see below).

Screenshots are 1440x900 at 2x (2880x1800) in light and dark, English UI. The GIFs are 1200x750, light theme.

## Screenshots (`<name>-light.png`, `<name>-dark.png`)

| Name | State |
|---|---|
| `dashboard` | Dashboard with all HTTP servers online, KPI tiles, latency sparklines on the shared adaptive scale (0 to 200 ms here) and the recent checks log |
| `add-server` | Add runtime server dialog, empty form, Browser direct connection selected |
| `inspector-call` | Inspector on `nl2sql-mcp-http`, `run_sql_query` with a SELECT and its OK response under the Mock sample data notice |
| `inspector-log` | Same call with the JSON-RPC log dock enlarged and the `tools/call` response row expanded |
| `inspector-resources` | Resources tab on `starter-mcp-http`, `starter://about` read and rendered as markdown |
| `client-config` | Client config dialog for `starter-mcp-http` (Claude Desktop tab, key header as a placeholder) |
| `chat` | Chat after a finished tool-use run: final answer, Trace waterfall, the first tool span selected |
| `settings` | Settings, LLM provider and model section, "Applies on Save" badges, nothing unsaved |
| `mobile-dashboard` | Dashboard at 390x844 (2x), bottom navigation |

## Demo GIFs (`../demo/`)

| File | Flow |
|---|---|
| `inspector-call.gif` | Pick `nl2sql-mcp-http` in the explorer, choose `run_sql_query`, type the SQL, Run, response appears |
| `chat-tool-use.gif` | Type a question, Send, the model calls `search_tables_schema` and `get_table_schema`, the answer streams in while the Trace fills |

The orange dot in the GIFs is a cursor marker drawn by the capture script.

## Regenerate

From the repo root, with the root `.env` holding `ANTHROPIC_API_KEY`:

```bash
make frontend-install                                     # Playwright comes from frontend/node_modules
CHAT_ALLOW_SERVER_KEYS=true docker compose up -d --build --wait
node docs/revamp/scripts/p6_capture.mjs                   # all shots and GIFs, writes into docs/assets/
docker compose down
```

`CHAT_ALLOW_SERVER_KEYS=true` lets Chat fall back to the server's key, so no key is typed into the browser.
Options: `--only shots|gifs`, `--themes light,dark`, `--model claude-haiku-4-5`, `--base http://localhost:3000`,
`--raw <dir>` (keeps the unoptimized PNGs and GIF frames), `--no-post`.

Post-processing runs `docs/revamp/scripts/p6_capture_post.py` through `uv run --no-project --with pillow`. It quantizes
each PNG to 256 colors (target under 400 KB) and builds each GIF from the recorded frames with a shared palette, lowering
fps and colors until the file is under 480 KB. To redo only that step on a kept raw folder:

```bash
uv run --no-project --with pillow python docs/revamp/scripts/p6_capture_post.py \
  --raw <dir> --shots docs/assets/screenshots --demo docs/assets/demo
```
