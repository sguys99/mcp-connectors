# Documentation

Start with [getting-started.md](getting-started.md). The project overview is the root [README](../README.md).

## Guides (English)

| Document | Read it when |
|---|---|
| [getting-started.md](getting-started.md) | You want the stack running and a first Inspector call, Chat run, and CLI call |
| [architecture.md](architecture.md) | You want to know how the skills, servers, registry, CLI, and Frontend fit together, how requests travel, and where the [security boundaries](architecture.md#security-boundaries) are |
| [writing-a-server.md](writing-a-server.md) | You are adding an MCP server, with the skills or by hand |
| [guardrails.md](guardrails.md) | You want the NL2SQL guardrails, the shared `_common` helpers, and the error codes |
| [faq.md](faq.md) | You have a practical question (keys, CORS, cost, Oracle, Windows, production) |

Related documents outside `docs/`:

- Server READMEs: [starter_mcp](../src/mcp-servers/starter_mcp/README.md), [mock_repo_mcp](../src/mcp-servers/mock_repo_mcp/README.md), [nl2sql_mcp](../src/mcp-servers/nl2sql_mcp/README.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md), [SECURITY.md](../SECURITY.md), [CHANGELOG.md](../CHANGELOG.md)
- Skills: [mcp-spec-writer](../.claude/skills/mcp-spec-writer/SKILL.md), [mcp-server-builder](../.claude/skills/mcp-server-builder/SKILL.md)

## Reference

| Path | Content | Language |
|---|---|---|
| [scenario-format.md](scenario-format.md) | The scenario YAML format read by `mcp_cli.py test` and written by the Inspector History export. JSON Schema: [configs/schemas/scenario.schema.json](../configs/schemas/scenario.schema.json) | English |
| [mcp-spec/](mcp-spec/) | MCP server specs written with `/mcp-spec-writer`, one per server (`<server-name>_v0.X.md`) | Korean |
| [assets/](assets/) | Diagrams (light and dark SVG), screenshots, and demo GIFs used by the READMEs and these guides | |
| [launch/promotion-kit.md](launch/promotion-kit.md) | Where to list and announce the project (awesome lists, directories, Show HN, Reddit, GeekNews), their submission rules, and ready-to-paste drafts | English, Korean posts |

## NL2SQL test plan and data

| Path | Content |
|---|---|
| [nl2sql-mcp-test-plan.md](nl2sql-mcp-test-plan.md) | The NL2SQL verification plan: scenario cases per tool and guardrail, required cases, pass criteria (Korean) |
| [nl2sql-mcp-test-data/](nl2sql-mcp-test-data/) | Scenario YAML files read by `scripts/run_mcp_tests.py` (`make test-scenarios`, `make test-scenarios-real`). `results/` is git-ignored run output |

## Records (Korean)

These are kept for history. They may not match the current code; when they disagree, the code and the guides above win.

| Path | Content |
|---|---|
| [update-plan.md](update-plan.md) | The revamp plan and progress log for the open source release (the current plan of record) |
| [revamp/](revamp/) | Internal revamp records: baselines, design concepts and tokens, QA reports, security scans, skill evals, audit scripts |
| [history/](history/) | MVP design records: PRD, task plan, meta prompt, and the original NL2SQL development plan |
