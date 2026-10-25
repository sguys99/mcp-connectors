# Security Policy

## Supported versions

MCP Connectors is in pre-release. Security fixes are made on the latest `0.1.x` code on the `main` branch; there are no backports to older snapshots.

| Version | Supported |
|---|---|
| 0.1.x (pre-release, `main`) | Yes |
| Anything older | No |

## Reporting a vulnerability

Please do **not** open a public issue, discussion, or pull request for a security problem.

Report it privately through one of these channels:

1. **GitHub private vulnerability reporting**: <https://github.com/sguys99/mcp-connectors/security/advisories/new>
2. **Email**: sguys99@gmail.com (use the subject prefix `[security] mcp-connectors`)

Include as much of the following as you can:

- The affected component (an MCP server, `_common`, the CLI, or a Frontend route such as `/api/chat`)
- The commit hash or version you tested
- Steps to reproduce, a proof of concept, or a failing test
- The configuration involved (which environment variables were set, Docker or local)
- The impact you expect (for example, key disclosure, SSRF, SQL guardrail bypass)

Do not include real credentials or personal data in the report.

## What to expect

This is a volunteer-maintained project, so the timelines below are best-effort targets, not guarantees. We aim to:

- Acknowledge your report within **7 days**
- Share an initial assessment within **14 days**
- Keep you updated until a fix is released, and credit you in the advisory and `CHANGELOG.md` unless you prefer to stay anonymous

Please give us a reasonable time to release a fix before any public disclosure. We will coordinate the disclosure date with you.

## Security model

MCP Connectors is a **local development and verification tool**. It is designed to run on a developer machine or inside a trusted internal network. The boundaries below describe what the code actually enforces today; anything not listed here should be treated as not protected. For an overview of the components and request paths, see [docs/architecture.md](docs/architecture.md#security-boundaries).

### MCP server authentication

- Every Streamable HTTP server uses the shared ASGI middleware in `src/mcp-servers/_common/auth.py`. It checks the `X-MCP-API-Key` header against `MCP_API_KEY` with a constant-time comparison and returns `401` with a JSON-RPC error body when the key is missing or wrong.
- **When `MCP_API_KEY` is unset or empty, authentication is disabled.** This is the default for local development.
- `OPTIONS` (CORS preflight) requests pass without a key. The stdio transport has no HTTP layer and is not affected.

### CORS

- `src/mcp-servers/_common/cors.py` allows the origins listed in `MCP_CORS_ORIGINS` (comma separated). When unset, only `http://localhost:3000` is allowed.
- Credentials (cookies, `Authorization`) are not allowed (`allow_credentials=False`). `mcp-session-id` and `mcp-protocol-version` are exposed so browser clients can keep a session.

### Registry servers and the Frontend proxy

- The browser never talks to registry servers directly. It calls the same-origin proxy `/api/mcp/[server]`, which only forwards to `streamable_http` entries in `configs/mcp_servers.yaml` (no arbitrary URLs).
- The proxy attaches `X-MCP-API-Key` from the Frontend server's `MCP_API_KEY` environment variable. **The key is added on the server side only** and is never sent to the browser. `/api/registry` omits `internalUrl` and `headers` from what it returns.
- Requests with an `Origin` header from a different host are rejected with `403`. Only an allowlist of request headers is forwarded (`accept`, `content-type`, `mcp-session-id`, `mcp-protocol-version`, `last-event-id`), so a browser cannot inject its own `X-MCP-API-Key` or cookies. Upstream redirects are not followed.

### Runtime servers (Add server)

Servers added from the UI are meant for quick checks of MCP servers outside the registry.

The request paths and the reasoning behind this boundary are in [docs/architecture.md](docs/architecture.md#runtime-server-boundary).

- They are stored in the browser's `sessionStorage` only, so they disappear when the tab is closed. Header values are not written to `localStorage`, logs, call history, or exports.
- **By default the browser connects directly** to the runtime server, which therefore needs CORS that allows the Frontend origin. Header values stay in the browser.
- The server-side proxy `/api/mcp-runtime` is **off by default**. It only works when the Frontend server has `MCP_ALLOW_RUNTIME_PROXY=true`; otherwise it returns `403` without contacting anything. When enabled, the proxy:
  - accepts only `http` and `https` URLs without credentials in the URL, passed in a request header rather than the URL
  - rejects link-local and cloud metadata targets (`169.254.0.0/16`, `fe80::/10`, `fd00:ec2::254`, `metadata.google.internal` and similar)
  - does not follow redirects
  - caps the time to the first response at 60 seconds (`MCP_RUNTIME_PROXY_TIMEOUT_MS`), the response body at 10 MiB (`MCP_RUNTIME_PROXY_MAX_BYTES`), and the request body at 2 MiB
  - forwards only the headers the user entered (at most 20, each value at most 4096 characters, no control characters) and refuses reserved headers such as `Host`
  - **never attaches the server's `MCP_API_KEY`**
  - applies the same same-origin check as the registry proxy
- Chat can use runtime servers only through the same switch (`MCP_ALLOW_RUNTIME_PROXY=true`). It applies the same URL, host, and header checks, does not follow redirects, never attaches `MCP_API_KEY`, rejects names that collide with registry servers, and truncates each runtime tool result at 256 Ki characters.
- Limits of this design: loopback (`127.0.0.1`, `localhost`) and private ranges (`10/8`, `172.16/12`, `192.168/16`) are **not** blocked, because local and internal MCP servers are the main use case. The host check looks at the URL text and does not resolve DNS, so a hostname that resolves to a metadata address is not caught. Only enable the proxy in an environment you trust.

### Chat

- LLM keys entered in Settings are stored in the browser's `localStorage` and sent with each `/api/chat` request.
- Server-side LLM keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`) are used as a fallback **only when `CHAT_ALLOW_SERVER_KEYS=true`**, because anyone who can reach the Frontend could spend them. The browser only learns whether a server key exists, never its value.
- `/api/chat` rejects cross-origin requests (`Origin` from another host or `Sec-Fetch-Site: cross-site`) and requires `Content-Type: application/json`, so other sites cannot trigger tool calls with simple form posts.
- **Manual approval mode** keeps the server stateless. When the model wants to call tools, the server returns an approval token: an HMAC-SHA256 signature over the pending calls (id, name, input), the iterations used so far, the issue time, and a random nonce. On resume the server checks that:
  - the signature matches the pending calls, so the SQL or arguments shown on screen cannot be swapped and the iteration limit cannot be reset
  - the token is less than **30 minutes** old
  - the token has not been used before (**one-time use**, tracked in process memory)
  - every pending call has exactly one decision, and the client did not supply tool results itself (results come only from calls the server executed)
- The signing key is `CHAT_APPROVAL_SECRET` (at least 16 characters). Without it each server process uses its own random key, so approvals fail after a restart. **If you run more than one Frontend instance, give all of them the same `CHAT_APPROVAL_SECRET`.** The one-time-use list is per instance, so replay protection only covers resends to the same instance. The operating conditions, including multi-instance deployments, are in [docs/architecture.md](docs/architecture.md#approval-tokens).
- The fake LLM used by tests (`CHAT_MOCK_LLM`) needs an extra `CHAT_MOCK_LLM_ALLOW_PRODUCTION` flag in production builds, so it cannot be turned on by accident.
- The Inspector's JSON-RPC log, call history, scenario export, and conversation exports hide values that look like secrets (by header or key name such as `Authorization` or `*api-key*`, and by value shape such as Bearer tokens, JWTs, or `sk-` keys).

### Data returned to the LLM

- **Untrusted content wrapping**: tool responses that carry external text use `wrap_untrusted(metadata, untrusted_content)` from `src/mcp-servers/_common/trust.py`, which separates server-generated metadata from external text. This marks the boundary; it does not sanitize the text. Telling the model not to follow instructions inside `untrusted_content` is the agent's responsibility (for example, in its system prompt).
- **PII masking**: `src/mcp-servers/_common/masking.py` masks card numbers, Korean resident registration numbers, long digit runs, email addresses, phone numbers, and account numbers with regular expressions. It is pattern based and will not catch every form of personal data.

### NL2SQL guardrails

`nl2sql_mcp` is the reference for database access and enforces read-only use in several layers:

- An AST-based check (sqlglot) allows only `SELECT`, `WITH ... SELECT`, and set operations, and blocks writes hidden inside them (`WITH x AS (DELETE ...)`, `SELECT ... INTO`), stacked statements, and dynamic SQL or server file access (`EXECUTE`, `PREPARE`, `DO`, `COPY`).
- PostgreSQL sessions start with `default_transaction_read_only=on`, use read-only transactions, and set `statement_timeout`. Oracle sessions start with `SET TRANSACTION READ ONLY`.
- Additional guardrails enforce row limits and date ranges, block mass scans and forbidden or risky constructs, control PII columns and mask results, and write every call (allowed or blocked) to an audit log.
- Use a dedicated read-only database account. The guardrails are a second line of defense, not a replacement for database permissions.

### Repository hygiene

- The pre-commit configuration runs gitleaks (rules in `.gitleaks.toml`) on staged changes, alongside ruff and basic file checks. Run `make init-dev` to install the hooks.
- `.env` files are git-ignored. The `.env.example` files contain only placeholders and local sample values.

## Deployment guidance

- Treat this as a local development and verification tool. **Do not expose the Frontend to the public internet without an authentication layer in front of it** (for example, a reverse proxy with SSO). The Frontend itself has no user login.
- Set `MCP_API_KEY` on every MCP server and on the Frontend whenever the servers are reachable by anyone other than you. In HTTP mode the servers listen on `0.0.0.0`, and `docker compose` publishes ports 3000, 8001, 8002, and 8004 on all interfaces.
- Keep `MCP_ALLOW_RUNTIME_PROXY` and `CHAT_ALLOW_SERVER_KEYS` off unless every person who can reach the Frontend is trusted.
- Set a strong, shared `CHAT_APPROVAL_SECRET` if you run more than one Frontend instance or need approvals to survive restarts.
- Limit `MCP_CORS_ORIGINS` to the origins you actually use.
- Point `nl2sql_mcp` only at read-only accounts, and keep the audit log (`AUDIT_LOG_PATH`) somewhere you can review.
- Rotate any key that was ever committed, pasted into an issue, or shared in a screenshot.
