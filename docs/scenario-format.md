# MCP scenario YAML format

This is the scenario format read by `python scripts/mcp_cli.py test <file or directory>`. It works with any server in the registry (`configs/mcp_servers.yaml`) and supports both stdio and Streamable HTTP. Besides tools (tools/call), it also checks resources (resources/read) and prompts (prompts/get).

The format is the same as the file the Inspector writes when you export call history as scenario YAML. That is why the keys are kept to a minimum and the version is fixed at `version: 1`. The JSON Schema for machine validation is [configs/schemas/scenario.schema.json](../configs/schemas/scenario.schema.json), and the frontend reads it as is.

## Minimal example

```yaml
version: 1
server: starter-mcp          # configs/mcp_servers.yaml 의 서버 이름
cases:
  - id: add-integers
    tool: add
    params: {a: 2, b: 3}
    expect:
      checks:
        - {field: result, op: eq, value: 5}
```

Run it like this:

```bash
python scripts/mcp_cli.py test tests/scenarios/starter.yaml
make test-scenarios-starter            # runs the same file over stdio (no separate server needed)
```

## Top-level keys

| Key | Required | Description |
|---|---|---|
| `version` | No | Format version. Only `1` is allowed for now |
| `name` | No | Human-readable name. Defaults to the file name |
| `description` | No | Description |
| `server` | No | Server name in the registry. `--server NAME` takes precedence when given |
| `defaults` | No | Defaults for the whole file (`timeout`, `env`) |
| `cases` | Yes | List of cases (must not be empty) |

If neither `server` nor `--server` is given, the run ends with exit code 2.

`defaults` has two keys:

* `timeout`: time limit per case, in seconds. Defaults to 60. `--timeout` on the CLI takes precedence
* `env`: environment variables layered onto the stdio server process. A case's `env` overrides the same keys. It does not apply to HTTP servers, which are already running

## Cases

| Key | Required | Description |
|---|---|---|
| `id` | No | A string unique within the file. If missing, cases are numbered `case-1`, `case-2`, and so on |
| `name` | No | Name shown in reports. Defaults to `id` |
| `tags` | No | List of strings. Select cases to run with `--tag` |
| `required` | No | If `true`, the whole run fails when this case does not pass, regardless of the pass rate. Combined with `skip`, a SKIP also counts as not passed |
| `skip` | No | A reason string (or `true`). The case is not run and is reported as SKIP |
| `env` | No | Environment variables for this case's stdio server only (a new server is started for each case) |
| Step keys | Yes | Write the keys from "Steps" below directly on the case, or as a `steps` list |

A case is either a single call, with step keys written directly on it, or multi-step, using `steps`. Mixing the two is an error. A multi-step case runs its steps in order within one connected session and stops at the first failure.

## Steps

A step has exactly one of `tool`, `resource`, or `prompt`.

| Kind | Keys | MCP method |
|---|---|---|
| Tool | `tool: name`, `params: {...}` | `tools/call` |
| Resource | `resource: URI` | `resources/read` |
| Prompt | `prompt: name`, `arguments: {...}` | `prompts/get` |

The common keys are `expect` and `repeat`. `repeat: N` sends the same call N times and judges the last response (default 1).

```yaml
cases:
  - id: about-resource
    name: about 리소스를 읽는다
    resource: starter://about
    expect:
      checks:
        - {field: "contents[0].mimeType", op: eq, value: text/markdown}

  - id: prompt-with-args
    prompt: explain_tool
    arguments: {tool_name: add}
    expect:
      checks:
        - {field: messages | length, op: gte, value: 1}

  - id: reset-then-count        # 다단계형
    steps:
      - tool: reset
        expect: {status: any}   # 준비 단계라 응답은 판정하지 않습니다
      - tool: count
        expect:
          checks:
            - {field: result, op: eq, value: 0}
```

(The comments in this example mark the multi-step case and say that the preparation step's response is not judged.)

## Response shape (what checks paths apply to)

`field` paths apply to the normalized response below.

| Step | Response |
|---|---|
| Tool | `structured_content` if present, otherwise `data`, otherwise the array of content blocks |
| Resource | `{"contents": [{"uri", "mimeType", "text"}]}` (`blob` for binary) |
| Prompt | `{"description", "messages": [{"role", "content": {"type", "text"}}]}` |
| Error | `{"error": {"code", "message"}}`. For tool errors, the `[CODE]` tag is read as the code, or `TOOL_ERROR` if there is none. The default codes for resource and prompt errors are `RESOURCE_ERROR` and `PROMPT_ERROR` |

The output of `mcp_cli.py call`, `read-resource`, and `get-prompt` has exactly this shape, so it is easiest to check the response with the CLI first and then pick your paths.

## expect

| Key | Default | Description |
|---|---|---|
| `status` | `success` | One of `success`, `error`, `any`. `any` accepts both success and error |
| `error_code` | none | The expected error code when `status: error` |
| `checks` | none | List of `{field, op, value}`. All of them must hold |

If `expect` is omitted, only `status: success` is checked.

### Paths (`field`)

| Notation | Meaning |
|---|---|
| `a.b` | Key access |
| `a[0]`, `a[-1]` | Index (negative counts from the end) |
| `a[*].b` | List of `b` from every item in the list |
| `a[?k=='v'].b` | `b` of the items where `k` is `v` |
| `a \| length` | Length (list, object, string) |

A pipe `|` is read as a pipe only when it is outside brackets and quotes. So in `a[?k=='x|y'].b`, `x|y` is compared as the filter value as is.

A missing path is treated as "absent", so you can check it with `exists: false`.

In YAML flow notation (`{field: ..., op: ...}`), a path containing `[` must be quoted (`field: "a[0].b"`). Without quotes it is a YAML syntax error. Block notation (keys on separate lines) does not need quotes.

### Operators (`op`)

| Group | Operators |
|---|---|
| Comparison | `eq`, `ne`, `gt`, `gte`, `lt`, `lte` |
| Presence | `exists`, `not_empty`, `is_null`, `not_null` |
| Containment | `contains`, `not_contains`, `contains_any`, `contains_all`, `contains_field` |
| Membership | `in`, `not_in` |
| Length | `length_eq`, `length_gte`, `length_lte` |
| Pattern | `matches_regex` |
| Manual review | `note` (left out of judging; kept only as a note for a person to read) |

## Running and exit codes

```bash
python scripts/mcp_cli.py test <file|dir> [--server NAME] [--junit out.xml] \
    [--id 'add-*'] [--tag smoke] [--min-pass-rate 100] [--timeout 30] [--jobs 4]
```

* Given a directory, it runs the `*.yaml` and `*.yml` files under it in name order. Files in the old NL2SQL format (`tests:`) are skipped
* `--min-pass-rate` is the pass rate excluding SKIPs (default 100). Cases with `required: true` must all PASS regardless of this threshold. A required case skipped with `skip` also counts as not passed and gives exit code 1
* `--jobs N` runs N cases concurrently. Over stdio a new server is started for each case, so cases do not affect each other

| Exit code | Meaning |
|---|---|
| 0 | Passed |
| 1 | A case FAILed or ERRORed, a required case did not pass (including SKIP), or the pass rate was below the threshold |
| 2 | Invalid input (YAML syntax, format violation, unknown server, missing file, no cases matched the filters) |

A format violation is reported with the file and location, for example `cases[1] (id=bad): unknown key(s) ['expected']; allowed: [...]`. If anything is invalid, no case runs and the run ends with exit code 2.

### JUnit XML

`--junit PATH` writes XML that test reporters such as GitHub Actions read.

* One `testsuite` per file and one `testcase` per case (`classname` is `<server>.<file name>`, `name` is `id: name`)
* FAIL is recorded as `<failure>`, ERROR as `<error>`, and SKIP as `<skipped>`, with the expected and actual values in the message
* `tags` and `required` are kept in `<properties>`
* A file that could not run because of a format violation is recorded as an `<error>` on a `load` case
* A `testsuite`'s `time` is the wall-clock time spent running the file. With `--jobs`, it is shorter than the sum of the case `time` values
* Control characters that XML cannot hold (`\x00`~`\x08`, `\x0b`, `\x0c`, `\x0e`~`\x1f`, and so on) are replaced with `U+FFFD`

```yaml
# .github/workflows 예시
- run: uv run python scripts/mcp_cli.py test tests/scenarios --junit reports/scenarios.xml
- uses: mikepenz/action-junit-report@v4
  if: always()
  with: {report_paths: reports/scenarios.xml}
```

## Relation to the NL2SQL runner

The 280-case NL2SQL scenarios (`docs/nl2sql-mcp-test-data/`) use the `tests:` format and are still run by `scripts/run_mcp_tests.py` (`make test-scenarios`, `make test-scenarios-real`). Per-case `env`, `setup_calls`, `requires`, `expected_by_backend`, `audit_verification`, the 95% threshold, and the required-case gate remain in that runner's NL2SQL profile.

Both runners share the judging engine (`scripts/scenario_core.py`). Operators, paths, and error recognition rules are the same, so `checks` under `expect` mean the same thing in both formats.

## Exporting from Inspector call history

In the History tab of the Inspector's bottom panel, select records (all of them if none is selected) and press "Export scenario" (or "Export N as scenario") to get a file in this format. Copy or download it and pass it straight to `mcp_cli.py test`.

* One record becomes one case. A tool call becomes `tool`+`params`, a resource read becomes `resource` (a template becomes the filled-in URI), and a prompt becomes `prompt`+`arguments`. Records are put back in chronological order. `id` is built from the target name, with `-2`, `-3` appended on collisions
* `expect` is derived from the response observed at the time. On success: `eq` on a few top-level values, `matches_regex` that checks only the shape of timestamps and UUIDs, and `not_empty` for long or truncated strings. On error: `status: error`, `error_code` when a `[CODE]` tag is present, and the beginning of a tool error message (`error.message contains`)
* To mark the checks as derived, each case gets an `op: note` check at the top (left out of judging), `derived` in `tags`, and a comment at the top of the file. Review and fix them before relying on them
* Cancelled records and records that failed to send cannot become scenarios, so they are left out. A case whose input had secret values (keys, tokens, passwords) masked when it was recorded is exported with a `skip` reason. Fill in the values and then remove `skip`

```bash
python scripts/mcp_cli.py test starter-mcp-http-history-2026-10-23.yaml
```

## Writing a new scenario

1. Check the response with `mcp_cli.py call`, `read-resource`, or `get-prompt`
2. Turn the values you want to check into `field` entries under `checks`
3. Add at least one error path too (`status: error`)
4. Put `required: true` and `tags: [smoke]` on the key cases
5. Run it with `python scripts/mcp_cli.py test <file>`
