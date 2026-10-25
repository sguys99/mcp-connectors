# nl2sql-mcp

An NL-to-SQL server that lets an agent explore a large relational schema on demand and run read-only SELECT queries behind a guardrail pipeline.

## What it is for

- **Schema discovery for agents.** Instead of pasting a whole schema into the prompt, the agent searches tables and columns and loads only the schemas it needs.
- **Safe query execution.** `run_sql_query` accepts a single SELECT and runs it only after the guardrails pass: write blocking, date range limits, row limits, a timeout, forbidden and risky SQL detection, mass scan blocking, PII blocking and masking, and an audit log. All of these are implemented and tested; see [Guardrails](#guardrails).
- **Two dialects, two backends.** PostgreSQL is the default dialect and Oracle is optional. The default backend is an in-memory Mock built from the Pagila sample schema, so it runs without a database. The real backend connects to PostgreSQL (for example the bundled Pagila sample DB) or Oracle.
- **Learning step 3.** It is the reference for a database-facing server in this repository.

## Tools

Spec section 5.1 defines five tools. There are no resources or prompts. Response shapes are the pydantic models in [`models.py`](models.py); they are the tools' return types, so `tools/list` publishes them as `outputSchema` and responses carry structured content.

| Tool | Arguments | Behavior | Guardrails |
|---|---|---|---|
| `search_tables_schema` | `pattern: str` (SQL LIKE, for example `"CUST%"`), `limit: int = 20` (1 to 50) | Tables and views whose name matches: owner, name, comment, column count, estimated rows. More matches than `limit` raises `TOO_MANY_TABLES`. | 7.8, 7.9 |
| `search_columns` | `column_pattern: str` (SQL LIKE, for example `"%amount%"`), `limit: int = 50` (capped at 200) | Columns whose name matches, with their table, type, comment and `pii`. More matches than the limit raises `TOO_MANY_COLUMNS`. | 7.6 (`pii` flag), 7.8, 7.9 |
| `get_table_schema` | `table_name: str` (may be schema-qualified) | Columns (type, nullable, comment, `pii`), primary key and foreign keys. Unknown tables raise `TABLE_NOT_FOUND`. | 7.6 (`pii` flag), 7.8, 7.9 |
| `get_tables_schema` | `table_names: list[str]` (1 to 20) | Several schemas in one call, duplicates removed (case-insensitive), plus `not_found`. | 7.6 (`pii` flag), 7.8, 7.9 |
| `run_sql_query` | `sql: str` (one SELECT), `max_rows: int = 1000` (capped at `GUARDRAIL_MAX_LIMIT`) | Columns, rows, `row_count`, `truncated`, `masked_columns`, `explain`, `data_source` (`mock_sample` on the Mock backend, else `database`) and `notice`. | 7.1 to 7.9 |

Name matching is case-insensitive. Pagila identifiers are lowercase. The schema tools never return system objects, because the catalog SQL in `db/dialects/` excludes system schemas (7.9 for schema tools).

Every error message ends with `[CODE]`. The codes are listed in [`error_codes.py`](error_codes.py): `WRITE_BLOCKED`, `DATE_RANGE_EXCEEDED`, `FORBIDDEN_SQL_BLOCKED`, `PII_COLUMN_BLOCKED`, `MASS_SCAN_BLOCKED`, `RISKY_SQL_BLOCKED` and `ACCESS_DENIED` count as blocked; `INVALID_INPUT`, `INVALID_SQL`, `TABLE_NOT_FOUND`, `TOO_MANY_TABLES`, `TOO_MANY_COLUMNS`, `QUERY_TIMEOUT` and `BACKEND_UNAVAILABLE` count as errors.

## Guardrails

Section numbers (7.1 to 7.9) refer to the spec. `run_sql_query` runs them in this order: 7.1, 7.5, 7.9, 7.6 (input check), 7.7, 7.2, 7.3, then executes under 7.4 and masks the result (7.6 output). Checks work on the sqlglot AST and on code text with comments removed and string literals blanked, so `WHERE email = 'a@b.com'`, a `/* UNION SELECT */` comment or a column named `copy` do not cause false positives. Every guardrail function takes a `dialect` argument and falls back to `NL2SQL_DB_DIALECT`. The cross-server overview is in [docs/guardrails.md](../../../docs/guardrails.md).

| Guardrail | Module | What it does |
|---|---|---|
| 7.1 Read-only | `enforce_select_only.py` | Allows only SELECT, WITH and set operations (UNION, UNION ALL, INTERSECT, EXCEPT). Anything else, including `DELETE ... RETURNING` inside a CTE and `SELECT ... INTO`, raises `WRITE_BLOCKED`. Several statements joined by semicolons raise `FORBIDDEN_SQL_BLOCKED`. |
| 7.2 Date range | `enforce_date_range.py` | Finds the lower and upper bounds of date comparisons in WHERE. A span over `GUARDRAIL_MAX_MONTHS` (calendar months) raises `DATE_RANGE_EXCEEDED`. A lower bound alone counts up to today; an upper bound alone is open and counts as exceeded. Relative expressions such as `CURRENT_DATE - INTERVAL '6 months'` and `ADD_MONTHS(SYSDATE, -6)` are evaluated. |
| 7.2 Date injection | `enforce_date_range.py` | If a query reads a table listed in `GUARDRAIL_DATE_COLUMNS` and has no date comparison, it ANDs `>= N months ago` (`GUARDRAIL_DEFAULT_MONTHS`) on that table's date column. The condition goes into the AST, so it lands before GROUP BY and LIMIT. |
| 7.3 Row limit | `enforce_row_limit.py` | Adds `max_rows + 1` to the top-level query (the whole set for UNION) or lowers a larger limit. The result is cut to `max_rows` and `truncated` is true when more rows existed. |
| 7.4 Timeout | `enforce_timeout.py` | Wraps execution in `asyncio.wait_for(GUARDRAIL_TIMEOUT_SEC)` and raises `QUERY_TIMEOUT`. On PostgreSQL the same value is set as `statement_timeout`. |
| 7.5 Forbidden constructs | `block_forbidden_constructs.py` | Dialect block list (see below). Dynamic SQL (EXECUTE, PREPARE, DO) and COPY are detected by statement type. On Oracle it also blocks the SYS and SYSTEM schemas, DBA_ and CDB_ views and V$ and GV$ views. Raises `FORBIDDEN_SQL_BLOCKED`. Switch with `GUARDRAIL_FORBIDDEN_ENABLED`. |
| 7.6 PII control | `enforce_pii_control.py` | Table-aware catalog. `block` columns in the SELECT list raise `PII_COLUMN_BLOCKED` before execution; `mask` columns are returned masked. See [PII control](#pii-control-76). |
| 7.7 Mass scan | `block_mass_scan.py` | A SELECT without WHERE (an outer WHERE counts) is allowed only when every table it reads has an estimated row count of `GUARDRAIL_MASS_SCAN_ROW_THRESHOLD` or less; unknown tables count as large. Aggregates follow the same rule and LIMIT is not an exemption. Joins of two or more tables without ON, USING or WHERE (comma joins, CROSS JOIN) are blocked as Cartesian joins. `WHERE 1=1`, `WHERE TRUE` and `OR 1=1` are blocked when `GUARDRAIL_BLOCK_TAUTOLOGY` is on. Raises `MASS_SCAN_BLOCKED`. |
| 7.8 Audit log | `audit_log.py` | Every call of all five tools, successful, blocked or failed, writes one row to SQLite. See [Audit log](#audit-log-78). |
| 7.9 Risky SQL | `detect_risky_sql.py` | Blocks dialect risky functions, UNION branches that select only constants without FROM (`UNION SELECT 1`, `FROM DUAL`) or read system catalogs, and unbalanced quotes. Raises `RISKY_SQL_BLOCKED`. Switch with `GUARDRAIL_RISKY_SQL_ENABLED`. |

Other input errors: empty SQL is `INVALID_INPUT`; a syntax error is `INVALID_SQL`, or `WRITE_BLOCKED` when the first word is a write keyword.

On the Pagila data, `film` (1000 rows), `actor` (200) and `customer` (599) can be read without WHERE, while `rental` and `payment` (about 16,000 rows each) are blocked. The real backend takes row estimates from catalog statistics for tables and from `EXPLAIN` for plain views.

When 7.2 injects a condition or 7.3 lowers a limit, the SQL is regenerated by sqlglot. The meaning is the same but the spelling can change (for example `DATE '...'` becomes `CAST(... AS DATE)`, comments move).

### PII control (7.6)

PII is decided per `(table, column)` pair. The default catalog is `PAGILA_PII_CATALOG` in [`pii_catalog.py`](pii_catalog.py); `PII_CATALOG_RAW` replaces it.

| Action | Effect | Pagila defaults |
|---|---|---|
| `block` | In the SELECT list: rejected before execution with `PII_COLUMN_BLOCKED` | `customer.first_name`, `last_name`, `email`; `staff.email`, `password`, `picture`; `address.address`, `address2`, `phone`; `customer_list.name`, `address`, `phone`; `staff_list.address`, `phone` |
| `mask` | Returned, with strings reduced to the first character plus `***` (for example `M***`) and the column listed in `masked_columns` | `staff.first_name`, `last_name`, `username`; `address.postal_code`; `customer_list."zip code"`, `staff_list."zip code"`; `staff_list.name`; `sales_by_store.manager` |
| none | Returned as is | for example `actor.first_name`, `city`, `country` |

- Tables are resolved on the AST: aliases (`c.email`), schema prefixes, JOINs, subqueries and CTE aliases, `SELECT *` and `t.*` expansion, and columns inside aggregates (`COUNT(email)`). An unqualified column that exists in several tables gets the strongest action.
- PII columns in WHERE, JOIN ON and ORDER BY are allowed because they do not leave the database (the SELECT list of a WHERE subquery is still checked). `SELECT * FROM film` passes because `film` has no `block` column.
- As a value-level safety net, every string in the result also goes through the `_common/masking.py` patterns (email, phone number, card number, resident registration number, account number, runs of 10 to 14 digits).
- The schema tools add `pii` (`"block"`, `"mask"` or `null`) to each column so the agent can leave blocked columns out.

The `(PII)` text in some catalog comments is descriptive only. The catalog above decides what is blocked or masked; for example `actor.first_name` is commented `First name (PII)` but is not in the catalog.

### Audit log (7.8)

Each tool call writes a row to the `audit_log` table of the SQLite file at `AUDIT_LOG_PATH` (default `var/nl2sql_mcp/audit.db` under the repository root, git-ignored). Rows older than `AUDIT_RETENTION_DAYS` are deleted at server start. If writing fails, the tool response is still returned and a warning is logged.

```bash
sqlite3 var/nl2sql_mcp/audit.db \
  "SELECT call_time, tool_name, result_status, error_type, latency_ms, sql_text FROM audit_log ORDER BY id DESC LIMIT 5"
```

| Column | Content |
|---|---|
| `call_time` | UTC, ISO 8601 |
| `session_id` | MCP session ID (`mcp-session-id` over HTTP, a per-connection UUID over stdio) |
| `tool_name` | Tool called |
| `sql_text` | Input SQL with PII patterns applied. Dates and IDs stay; emails, phone numbers, card numbers and 10 to 14 digit runs are masked. |
| `result_status` | `success`, `blocked` (guardrail or database permission denial) or `error` (bad input, timeout, missing table and so on) |
| `latency_ms`, `row_count` | Duration and row or match count |
| `error_type` | The `[CODE]` of the error, for example `PII_COLUMN_BLOCKED` |
| `params` | Non-SQL inputs as JSON |

## Dialects and backends

`NL2SQL_DB_DIALECT` and `NL2SQL_DB_BACKEND` are independent.

| Setting | Values | Meaning |
|---|---|---|
| `NL2SQL_DB_DIALECT` | `postgres` (default), `oracle` | SQL parsing, row limit syntax, date expressions, block lists, catalog queries |
| `NL2SQL_DB_BACKEND` | `mock` (default), `real` | `mock` serves the Pagila fixtures in memory; `real` opens the connector for the dialect |

Dialect differences live in `db/dialects/`:

| Item | `postgres` | `oracle` |
|---|---|---|
| Row limit injection (7.3) | `LIMIT N` (also recognizes `FETCH FIRST`) | `FETCH FIRST N ROWS ONLY` (also recognizes `ROWNUM`) |
| Date injection (7.2) | `CURRENT_DATE - INTERVAL 'N months'` | `ADD_MONTHS(SYSDATE, -N)` |
| Date literals recognized | `DATE '...'`, `'...'::date`, `CAST(... AS DATE)`, `TIMESTAMP '...'`, `to_date(...)` | `DATE '...'`, `TO_DATE(...)` |
| Forbidden constructs (7.5) | system catalogs such as `pg_catalog.`, `information_schema.`, `pg_shadow`; `dblink()`; `EXECUTE`, `PREPARE`, `DO`, `COPY`; risky hints | `@dblink`, `SYS.`, `DBMS_`, `EXECUTE IMMEDIATE`, risky hints |
| Risky functions (7.9) | `pg_read_file`, `pg_ls_dir`, `pg_sleep`, `pg_terminate_backend`, `lo_export`, `set_config`, `query_to_xml` and others | `UTL_FILE`, `UTL_HTTP`, `UTL_TCP`, `UTL_RAW`, `DBMS_SQL`, `DBMS_PIPE` |
| Catalog queries | `pg_class`, `pg_attribute`, `pg_constraint`, `obj_description` | `ALL_TABLES`, `ALL_TAB_COLUMNS`, `ALL_CONSTRAINTS`, comment views |
| Driver | psycopg 3 (default dependency) | oracledb (`uv sync --extra oracle`) |
| Read-only at the connection | `default_transaction_read_only=on`, `BEGIN READ ONLY`, `statement_timeout` | `SET TRANSACTION READ ONLY` |

### Mock backend

The Mock holds the Pagila 3.x `public` schema: 15 tables, 7 views and 1 materialized view (23 objects). Names, types, nullability, primary and foreign keys and comments match the sample DB catalog; `tests/nl2sql_mcp/test_sample_db_files.py` checks the comments against `docker/postgres/initdb/03-pagila-comments.sql` without Docker. Estimated rows are the real row counts, and plain views report `null` like the real catalog. Value formats match the real backend (`db/values.py`): numerics as numbers, timestamps as ISO 8601 strings.

The Mock is not a SQL engine. `db/mock_query.py` applies simple WHERE conditions, aggregates, ordering and LIMIT to sample rows, but it does not filter on dates, functions or subquery conditions and does not really join. Because of that, `run_sql_query` on the Mock returns `data_source: "mock_sample"` with a `notice` saying the rows, counts and totals describe the sample only; the Inspector shows this as a "Mock sample data" alert. `NL2SQL_MOCK_DELAY_SEC` adds a delay before each query so the timeout guardrail can be reproduced.

### Adding a database

Implement `SQLDialect` (`db/dialects/base.py`), register it in `SUPPORTED_DIALECTS`, and, if needed, write a connector that extends `CatalogBackend` (`db/catalog_backend.py`).

## Run

### Host

```bash
make run-nl2sql-mcp        # stdio (registry name nl2sql-mcp)
make run-nl2sql-mcp-http   # Streamable HTTP on http://localhost:8004/mcp (registry name nl2sql-mcp-http)
```

Without any configuration this is `dialect=postgres`, `backend=mock`, so no database is needed. From `src/mcp-servers` the direct command is `uv run python -m nl2sql_mcp.server --transport stdio|http [--port N]`; the default transport is `http`.

The Docker container also publishes port 8004. Stop it first (`docker compose stop nl2sql-mcp`) before running the HTTP server on the host.

### Docker

The default stack (`make docker-up` or `docker compose up -d --wait nl2sql-mcp`) includes `nl2sql-mcp` on port 8004 with the Mock backend. The Frontend Inspector and Chat reach it as `nl2sql-mcp-http`.

```bash
make nl2sql-sample-db   # start the Pagila sample DB and recreate the container with backend=real
make nl2sql-mock        # recreate the container with backend=mock (the sample DB keeps running)
```

- Both targets only change the compose variable `NL2SQL_CONTAINER_BACKEND` (`mock` by default). Do not set it in `.env`; the container ignores `NL2SQL_DB_BACKEND` from `.env`.
- With `real`, the container connects to `postgres:5432` on the compose network with `NL2SQL_PG_USER` and `NL2SQL_PG_PASSWORD`. `NL2SQL_PG_HOST` and `NL2SQL_PG_PORT` from `.env` apply to host runs only.
- The container runs as a non-root user. The audit log is written to `/app/var/nl2sql_mcp/audit.db` on the `nl2sql-var` volume.
- If `MCP_API_KEY` is set in the root `.env`, the container checks `X-MCP-API-Key` and the Frontend proxy adds it.

### Pagila sample DB

The sample DB is PostgreSQL 17 with Pagila, started from the `sample-db` compose profile. You can use it from a server on the host as well as from the container.

```bash
make sample-db-up     # build and start it on NL2SQL_PG_PORT (5432), downloads Pagila on the first build
NL2SQL_DB_BACKEND=real make run-nl2sql-mcp-http
make sample-db-psql   # psql as the read-only account
make sample-db-down   # stop, keeping the data volume
make sample-db-reset  # drop the volume and seed again
```

| Item | Value |
|---|---|
| Image | `docker/postgres/Dockerfile` (`postgres:17.10-alpine`) |
| Database | `pagila`, schema `public` (15 tables, 7 views, 1 materialized view, 7 monthly partitions of `payment`) |
| Server account | `NL2SQL_PG_USER` / `NL2SQL_PG_PASSWORD` (default `nl2sql_ro` / `nl2sql_ro_local_sample`) |
| Superuser | `postgres` / `PAGILA_ADMIN_PASSWORD`, used by the init scripts only |
| Host port | `NL2SQL_PG_PORT` (default 5432) |

Init scripts in `docker/postgres/initdb/` run once, when the volume is empty:

1. `01-pagila-schema.sql` and `02-pagila-data.sql`: upstream Pagila, downloaded at build time from a pinned commit and checked with sha256.
2. `03-pagila-comments.sql`: English table and column comments (the same text as the Mock fixtures), `REFRESH` of the materialized view and `ANALYZE`.
3. `04-readonly-role.sh`: creates the read-only account.

The comments are applied only when the volume is created. A volume created before the comments were translated keeps the old Korean comments until you run `make sample-db-reset`.

The read-only account blocks writes at the database level too, so SQL that somehow got past the guardrails still fails:

- Grants: CONNECT on `pagila`, USAGE on `public`, SELECT on tables, views and sequences (and, through default privileges, on later objects).
- Revoked: CREATE on `public` (Pagila grants it to PUBLIC), TEMP on the database, connecting to `postgres` and `template1`.
- Role attributes: NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOINHERIT, NOREPLICATION, NOBYPASSRLS, 20 connections.
- Session defaults: `default_transaction_read_only=on`, `statement_timeout=30s`, `idle_in_transaction_session_timeout=60s`.
- `pg_authid`, `pg_shadow` and server file functions such as `pg_read_file` stay inaccessible under the default PostgreSQL privileges.

The connector maps database errors that mean the same as a guardrail to the same code: timeout to `QUERY_TIMEOUT`, read-only violation to `WRITE_BLOCKED`, missing privilege to `ACCESS_DENIED`, connection failure to `BACKEND_UNAVAILABLE`. Other SQL errors such as an unknown column pass the database message through.

Pagila dates are in 2022 (`payment` January to July, `rental` February to August). A query without a date condition gets the "last 3 months" injection and returns no rows, so give both bounds, for example `payment_date >= DATE '2022-03-01' AND payment_date < DATE '2022-06-01'`. A lower bound alone counts up to today and exceeds the 12 month limit.

### Oracle

Install the driver extra only when you connect to a real Oracle database:

```bash
uv sync --extra oracle
NL2SQL_DB_DIALECT=oracle NL2SQL_DB_BACKEND=real make run-nl2sql-mcp-http
```

## Configuration

Settings come from `config.py` (pydantic-settings). Values are read in this order, later wins: the repository root `.env`, then `src/mcp-servers/nl2sql_mcp/.env` (optional override), then OS environment variables. See [`.env.example`](.env.example) and the root `.env.example`.

| Variable | Default | Meaning |
|---|---|---|
| `NL2SQL_MCP_PORT` | `8004` | Port for Streamable HTTP |
| `MCP_API_KEY` | empty | When set, HTTP requests must send it in `X-MCP-API-Key`. Empty disables the check. |
| `MCP_CORS_ORIGINS` | `http://localhost:3000` | Origins allowed for direct browser connections. Process environment first, then the package `.env`, then the root `.env` (same rules as other settings). Docker Compose passes it through from the root `.env`. |
| `NL2SQL_DB_DIALECT` | `postgres` | `postgres` or `oracle` |
| `NL2SQL_DB_BACKEND` | `mock` | `mock` (Pagila fixtures) or `real` (database connector) |
| `NL2SQL_PG_DSN` | empty | PostgreSQL DSN. Takes precedence over the separate values below. |
| `NL2SQL_PG_HOST` | `localhost` | PostgreSQL host |
| `NL2SQL_PG_PORT` | `5432` | PostgreSQL port, also the sample DB host port |
| `NL2SQL_PG_DATABASE` | `pagila` | Database name |
| `NL2SQL_PG_USER` | `nl2sql_ro` | Read-only account |
| `NL2SQL_PG_PASSWORD` | empty | Password (`.env.example` has the sample DB value `nl2sql_ro_local_sample`) |
| `NL2SQL_ORACLE_DSN` | empty | Oracle DSN. Takes precedence over host, port and service. |
| `NL2SQL_ORACLE_HOST` | `localhost` | Oracle host |
| `NL2SQL_ORACLE_PORT` | `1521` | Oracle port |
| `NL2SQL_ORACLE_SERVICE` | `ORCL` | Oracle service name |
| `NL2SQL_ORACLE_USER` | `nl2sql_ro` | Read-only account |
| `NL2SQL_ORACLE_PASSWORD` | empty | Password |
| `NL2SQL_ORACLE_THICK_MODE` | `false` | Use Oracle Instant Client |
| `NL2SQL_ORACLE_CLIENT_LIB_DIR` | empty | Instant Client path (enables thick mode) |
| `GUARDRAIL_MAX_LIMIT` | `10000` | Maximum rows per query (7.3) |
| `GUARDRAIL_DEFAULT_MONTHS` | `3` | Months injected when a query has no date condition (7.2) |
| `GUARDRAIL_MAX_MONTHS` | `12` | Maximum date span (7.2) |
| `GUARDRAIL_TIMEOUT_SEC` | `30` | Query timeout in seconds (7.4), also PostgreSQL `statement_timeout` |
| `GUARDRAIL_FORBIDDEN_ENABLED` | `true` | Forbidden construct checks (7.5) |
| `GUARDRAIL_RISKY_SQL_ENABLED` | `true` | Risky SQL checks (7.9) |
| `GUARDRAIL_REQUIRE_WHERE` | `true` | Queries without WHERE only on small tables (7.7) |
| `GUARDRAIL_MASS_SCAN_ROW_THRESHOLD` | `10000` | Largest estimated row count readable without WHERE (7.7) |
| `GUARDRAIL_BLOCK_TAUTOLOGY` | `true` | Block `WHERE 1=1`, `WHERE TRUE`, `OR 1=1` (7.7) |
| `GUARDRAIL_DATE_COLUMNS` | empty | `table.column` list for date injection (7.2). Empty means `payment.payment_date,rental.rental_date`. |
| `NL2SQL_MOCK_DELAY_SEC` | `0` | Delay in seconds before each Mock query, to reproduce timeouts (7.4) |
| `PII_CATALOG_RAW` | empty | `table.column[:block\|mask]` comma list (action defaults to `block`). A value replaces the Pagila catalog (7.6). |
| `AUDIT_LOG_PATH` | empty | Audit SQLite path. Empty means `<repo>/var/nl2sql_mcp/audit.db`; relative paths resolve from the repository root (7.8). |
| `AUDIT_RETENTION_DAYS` | `30` | Audit rows older than this are deleted at startup |

Unknown variables are ignored. Older names (`ORACLE_NL2SQL_MCP_PORT`, `ORACLE_MOCK_MODE`, `ORACLE_HOST`, `GUARDRAIL_MOCK_DELAY_SEC` and so on) are no longer read. `PII_CATALOG_RAW` used to be a plain column list (`EMAIL,FIRST_NAME`); that format now fails at startup with a format error. `GUARDRAIL_DATE_COLUMNS` is also validated at startup.

## Example CLI calls

Run from the repository root. The stdio server (`nl2sql-mcp`) starts automatically with the Mock backend.

```bash
uv run python scripts/mcp_cli.py list-tools --server nl2sql-mcp
uv run python scripts/mcp_cli.py call --server nl2sql-mcp --tool search_tables_schema --params '{"pattern":"film%"}'
uv run python scripts/mcp_cli.py call --server nl2sql-mcp --tool search_columns --params '{"column_pattern":"%amount%"}'
uv run python scripts/mcp_cli.py call --server nl2sql-mcp --tool get_table_schema --params '{"table_name":"customer"}'
uv run python scripts/mcp_cli.py call --server nl2sql-mcp --tool get_tables_schema --params '{"table_names":["payment","customer"]}'
uv run python scripts/mcp_cli.py call --server nl2sql-mcp --tool run_sql_query \
  --params "{\"sql\": \"SELECT staff_id, SUM(amount) AS total FROM payment WHERE payment_date >= DATE '2022-03-01' AND payment_date < DATE '2022-06-01' GROUP BY staff_id\"}"
```

Guardrails in action:

```bash
# 7.6 block: {"error": {"code": "PII_COLUMN_BLOCKED", ...}}
uv run python scripts/mcp_cli.py call --server nl2sql-mcp --tool run_sql_query --params '{"sql":"SELECT email FROM customer WHERE customer_id = 1"}'
# 7.6 mask: rows like [1, "M***"], "masked_columns": ["first_name"]
uv run python scripts/mcp_cli.py call --server nl2sql-mcp --tool run_sql_query --params '{"sql":"SELECT staff_id, first_name FROM staff"}'
# 7.7: {"error": {"code": "MASS_SCAN_BLOCKED", ...}}
uv run python scripts/mcp_cli.py call --server nl2sql-mcp --tool run_sql_query --params '{"sql":"SELECT rental_id FROM rental"}'
# 7.1: {"error": {"code": "WRITE_BLOCKED", ...}}
uv run python scripts/mcp_cli.py call --server nl2sql-mcp --tool run_sql_query --params '{"sql":"DELETE FROM payment"}'
```

Use `--server nl2sql-mcp-http` for the HTTP server (host or Docker). The stdio server inherits OS environment variables, so `NL2SQL_DB_BACKEND=real uv run python scripts/mcp_cli.py call --server nl2sql-mcp ...` runs against the sample DB.

## Testing

```bash
make test-nl2sql            # pytest tests/nl2sql_mcp/ (318 tests on the Mock, integration tests excluded)
make test-scenarios         # YAML scenarios in docs/nl2sql-mcp-test-data/ on the Mock
make test-scenarios-real    # same scenarios against the sample DB (starts it first)
make test-integration       # integration tests against the sample DB (starts it first, 62 tests)
```

- Unit tests need no database. The PostgreSQL connector tests replace psycopg with fakes to check the read-only settings and timeout handling.
- `make test-scenarios` runs 280 cases: 263 PASS and 17 SKIP (chat cases that need an LLM, run by hand, and cases that only apply to the real backend). It fails below a 95% pass rate or when a required case fails. Results go to `docs/nl2sql-mcp-test-data/results/` (git-ignored). Pass `ARGS="--dir tools"` and similar to narrow the run.
- Integration tests (`tests/nl2sql_mcp/integration/`, marker `integration`) cover the five tools, Mock and real catalog parity, writes that bypass the guardrails and are rejected by the database (INSERT, CREATE and so on), `statement_timeout` through `pg_sleep`, and blocked access to `pg_authid` and other databases. They use the same `NL2SQL_PG_*` settings as the server (an empty password falls back to the sample default), `NL2SQL_IT_PG_DSN` overrides them, and they skip with a reason when the database is unreachable.

The Pagila mapping to the original domain is described in [docs/revamp/nl2sql-pagila-mapping.md](../../../docs/revamp/nl2sql-pagila-mapping.md).

## File layout

```
src/mcp-servers/nl2sql_mcp/
├── server.py           # create_server(): FastMCP with lifespan, register_tools(), main()
├── state.py            # runtime state (backend); tools read it here instead of importing server
├── config.py           # pydantic-settings
├── models.py           # tool return models (outputSchema)
├── error_codes.py      # [CODE] list, blocked versus error
├── pii_catalog.py      # table-aware PII catalog (7.6)
├── date_catalog.py     # date column catalog (7.2, GUARDRAIL_DATE_COLUMNS)
├── tools/
│   ├── __init__.py     # TOOLS, register_tools(mcp)
│   └── <tool>.py       # the five tool functions (no decorators)
├── db/
│   ├── __init__.py             # get_backend(): picks the backend from NL2SQL_DB_BACKEND and NL2SQL_DB_DIALECT
│   ├── dialects/               # base.py (SQLDialect, CatalogQueries), postgres.py, oracle.py
│   ├── catalog_backend.py      # shared logic of real connectors
│   ├── postgres_connector.py   # psycopg 3, read-only connection with statement_timeout
│   ├── oracle_connector.py     # oracledb pool, SET TRANSACTION READ ONLY (imported only for oracle)
│   ├── values.py               # driver value normalization (Decimal, datetime to JSON)
│   ├── mock_query.py           # small query interpreter for the Mock
│   └── mock_backend.py         # Pagila fixtures
├── guardrails/
│   ├── __init__.py             # pipeline: apply_sql_guardrails, annotate_schema_pii
│   ├── sql_ast.py              # shared SQL analysis
│   └── <guardrail>.py          # one module per guardrail, 7.1 to 7.9 (see the table above)
└── .env.example
```

## Known limitations

- The PostgreSQL connector opens a connection per request.
- Plain views have no row statistics, so `search_tables_schema` reports `estimated_rows: null` for them (real and Mock alike). 7.7 uses an `EXPLAIN` estimate on the real backend instead.
- The Mock does not evaluate dates, functions or subquery conditions and does not join (see [Mock backend](#mock-backend)).

## Related documents

- Spec: [docs/mcp-spec/nl2sql-mcp_v0.1.md](../../../docs/mcp-spec/nl2sql-mcp_v0.1.md)
- [docs/guardrails.md](../../../docs/guardrails.md)
- [docs/getting-started.md](../../../docs/getting-started.md)
- [docs/writing-a-server.md](../../../docs/writing-a-server.md)
- Previous example: [mock_repo_mcp](../mock_repo_mcp/README.md)
