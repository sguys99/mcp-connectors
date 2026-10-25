# MCP Server Requirements Spec (English Template)

> This is the English edition of [template_v2.md](template_v2.md). The 10 sections, their numbering, the tables, and the `#### ▶ T-NN` tool blocks are identical, so `mcp-server-builder` parses both editions the same way.
> - **📝 Guide** lines explain what to write. **Remove them from the output.**
> - The Korean template carries full worked examples for every section; reuse their level of detail (and [example_code_repo.md](example_code_repo.md)) even when writing in English.
> - Keep the headings below **exactly** as written (they are the parsing contract).

---

## 0. Document Info

| Item | Value |
|---|---|
| Document | `[MCP server name] Requirements Spec` |
| Version | `v0.1` |
| Author | `Name / Team` |
| Date | `YYYY-MM-DD` |
| Server name | `xxx-mcp` |

---

## 1. Overview

### 1.1 Server Name / One-line Summary

📝 Guide: the kebab-case code name and one sentence on which backend it connects to which agent, for what.

- **Server name**: `code-repo-mcp`
- **Summary**: Read-only MCP server that lets a code-review agent browse repositories, read files, and search code in the internal Git server

### 1.2 Purpose and Background

📝 Guide: **Purpose** (why build it), **Background** (current pain), **Expected impact** (quantified when possible).

---

## 2. Scope

### 2.1 In Scope

📝 Guide: the capabilities this server provides, phrased as "system + operation".

### 2.2 Out of Scope

📝 Guide: what readers might assume but this server will **not** do (write operations, other systems, ...).

---

## 3. Users and Key Scenarios

### 3.1 Calling Agents

📝 Guide: calling agent, call volume (per day, peak per minute), read/write mix.

### 3.2 Use Cases

📝 Guide: 2 to 4 use cases. They justify the tool list in §5.

| ID | Scenario | Tools (maps to §5) |
|---|---|---|
| UC-01 | ... | `tool_a`, `tool_b` |

---

## 4. System Architecture

### 4.1 MCP Server

| Item | Value |
|---|---|
| Transport | Streamable HTTP (default) / stdio |
| Deployment | e.g. internal Kubernetes cluster |
| Endpoint | `https://xxx-mcp.example.internal/mcp` |
| MCP SDK | Python FastMCP |
| Primitives | Tools (Resources / Prompts: used or not used) |

### 4.2 Backend Systems

📝 Guide: concrete enough for a developer to configure the connection. Unknown values are written as `**TBD (waiting for <team>)**` with candidate options.

| Item | Value |
|---|---|
| System | ... |
| Type | Code repository / RDB / DW / Catalog / Internal API |
| Endpoint | ... |
| Protocol | HTTPS REST / gRPC / JDBC / native SDK |
| Authentication | PAT / OAuth / DB account / ... |
| Network | internal network, VPC, firewall notes |
| References | API docs link |

---

## 5. Functional Requirements (Tools)

### 5.1 Tool List (Summary)

| Tool ID | Tool Name | Description | readOnly | destructive | idempotent |
|---|---|---|---|---|---|
| T-01 | `get_pr` | Get PR metadata by PR ID | true | false | true |

### 5.2 Tool Details

📝 Guide: repeat the block below for every tool in §5.1. The **LLM Description** is the most important item: it is the only cue the agent has for when to call the tool.

#### ▶ T-01 `get_pr`

- **Description**: Returns PR metadata and the list of changed files for a PR ID

- **LLM Description** (exposed to the model, 3 to 7 lines)
  ```
  Get a pull request's metadata (title, author, status) and its changed files.
  Use it when you need a PR-level summary.
  To see the change inside one file, call get_file_diff afterwards.
  Do not use it when you need a whole file's content.
  Example: "summarize PR 1234" -> get_pr(pr_id="1234")
  ```

- **Input parameters**

  | Parameter | Type | Required | description (exposed to the model) |
  |---|---|---|---|
  | `pr_id` | string | Y | PR identifier, digits only, no prefix (e.g. `"1234"`) |

- **Output example (JSON)**
  ```json
  {
    "pr_id": "1234",
    "title": "Refactor auth module",
    "status": "open",
    "files_changed": [{"path": "src/auth/login.py", "change_type": "modified"}]
  }
  ```

- **Empty result**: `files_changed: []` when the PR exists but has no changed files

- **Response size control**: at most 200 entries in `files_changed`; beyond that return a `cursor`

- **Error responses** (natural-language cause **and** next action, not just a code)

  | Code | Example message |
  |---|---|
  | `PR_NOT_FOUND` | "PR 1234 was not found. pr_id must be a numeric string." |
  | `ACCESS_DENIED` | "You do not have read access to this PR. Check the agent's permissions." |

### 5.3 Resources / Prompts (optional)

📝 Guide: include only when §4.1 says Resources or Prompts are used. Otherwise omit this subsection.

| Kind | URI or name | MIME type / arguments | Description (exposed to the model) |
|---|---|---|---|
| Resource | `xxx://schema` | `application/json` | ... |
| Resource template | `xxx://items/{item_id}` | `application/json` | ... |
| Prompt | `review_session` | `language` (required) | ... |

---

## 6. Non-functional Requirements

### 6.1 Performance

📝 Guide: measurable targets. Limit response size in **both bytes and tokens** (protects the model's context window).

### 6.2 Security

📝 Guide: always cover MCP authentication, backend credentials, authorization boundary, indirect prompt-injection defense (external text isolated in a separate field), and sensitive-data masking.

### 6.3 Logging

📝 Guide: fields (time, agent ID, tool, parameter hash, latency, result code), retention, collection system.

---

## 7. Error Handling

| Category | Handling |
|---|---|
| Input / permission errors | `isError: true` + message with cause and next action |
| Backend errors | `isError: true` + whether a retry may help |

- Backend call timeout: 5 s
- Retry: once on backend 5xx (exponential backoff)

---

## 8. Deliverables

- [ ] Source repository and access
- [ ] Tool specification (Markdown or MCP schema)
- [ ] Install / run / operations guide
- [ ] Unit and integration tests with results
- [ ] **LLM tool-calling evaluation set** (10+ utterance to expected-call cases) and pass-rate report

---

## 9. Schedule

| Milestone | Due |
|---|---|
| Requirements frozen (this spec v1.0) | YYYY-MM-DD |
| Development complete | YYYY-MM-DD |
| Integration test / UAT | YYYY-MM-DD |
| Production handover | YYYY-MM-DD |

---

## 10. Acceptance Criteria

- [ ] Every tool in §5 behaves as specified (inputs, outputs, error cases)
- [ ] §6.1 performance targets met (load-test report)
- [ ] §6.2 security requirements met (secret handling, masking verified)
- [ ] **LLM tool-calling evaluation pass rate ≥ 90%**
- [ ] All §8 deliverables submitted and reviewed
