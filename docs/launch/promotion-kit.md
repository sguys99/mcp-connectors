# Promotion kit (v0.1.0)

Where to list and announce MCP Connectors after the v0.1.0 release, the rules each channel publishes, and ready-to-paste drafts. Nothing in this document has been posted or submitted. The maintainer posts by hand.

Rules were checked on 2026-10-25 from the pages linked in each row. Directories and subreddits change their rules often, so open the linked page again right before you submit.

## Contents

- [What we lead with](#what-we-lead-with)
- [Channel table](#channel-table)
- [Channels that do not fit now](#channels-that-do-not-fit-now)
- [Recommended order](#recommended-order)
- [Drafts](#drafts)
  - [awesome-mcp-servers (punkpeye)](#awesome-mcp-servers-punkpeye)
  - [awesome-mcp-devtools (punkpeye)](#awesome-mcp-devtools-punkpeye)
  - [appcypher/awesome-mcp-servers](#appcypherawesome-mcp-servers)
  - [Directory forms (Glama, mcp.so, mcpservers.org)](#directory-forms-glama-mcpso-mcpserversorg)
  - [Show HN](#show-hn)
  - [r/mcp](#rmcp)
  - [r/ClaudeAI](#rclaudeai)
  - [dev.to article outline](#devto-article-outline)
  - [GeekNews Show GN (Korean)](#geeknews-show-gn-korean)
  - [OKKY and Disquiet (Korean)](#okky-and-disquiet-korean)
  - [LinkedIn and X](#linkedin-and-x)
- [Launch checklist](#launch-checklist)

## What we lead with

From `docs/update-plan.md` section 7.1, in this order:

1. **NL2SQL guardrail reference.** `nl2sql_mcp` runs agent-written SQL behind read-only enforcement (parser and connection), row and date limits, mass scan, tautology and Cartesian join blocking, PII block and mask rules, risky function blocking, and a SQLite audit log. It runs on a Mock backend with no setup and on PostgreSQL (Pagila) with `make nl2sql-sample-db`. Public examples of a database MCP server with these controls are rare, so this is the hook.
2. **Inspector and Chat in one local UI.** The official MCP Inspector checks one call at a time. Here the same servers are called by hand in the Inspector and then used by Anthropic, OpenAI, or OpenRouter models in Chat, with a trace waterfall, manual approval, and token usage. Inspector history exports to a scenario YAML that `mcp_cli.py test` replays in CI.
3. **Spec-driven workflow.** `/mcp-spec-writer` writes a reviewable 10-section spec, `/mcp-server-builder` turns it into a server with tests, scenarios, and a registry entry. Shared `_common` modules give every server auth, CORS, PII masking, trust-boundary wrapping, retries, and hashed JSON logs.

Say these limitations up front in every long post:

- The spec and builder steps are Claude Code skills. Without Claude Code you copy `starter_mcp` or `nl2sql_mcp` by hand (documented in `docs/writing-a-server.md`). A non-Claude scaffolder CLI is on the Next list, not shipped.
- It is v0.1.0 from one maintainer. Auth is off by default and the Docker stack publishes ports on all interfaces; it is a development and verification tool, not a production gateway. OAuth 2.1 is not implemented yet.
- NL2SQL supports PostgreSQL (default) and Oracle (optional extra). SQLite and MySQL are not supported yet.
- Local development assumes a POSIX shell; on Windows use Docker Desktop or WSL 2.
- Nothing is published to PyPI, npm, or a container registry, so there is no one-line install. You clone the repository.

Images to reuse (absolute URLs on `main`):

| Asset | URL |
|---|---|
| Chat demo GIF (1200x750, 390 KB) | `https://raw.githubusercontent.com/sguys99/mcp-connectors/main/docs/assets/demo/chat-tool-use.gif` |
| Inspector demo GIF (1200x750, 190 KB) | `https://raw.githubusercontent.com/sguys99/mcp-connectors/main/docs/assets/demo/inspector-call.gif` |
| Chat screenshot | `https://raw.githubusercontent.com/sguys99/mcp-connectors/main/docs/assets/screenshots/chat-light.png` |
| Inspector screenshot (NL2SQL call) | `https://raw.githubusercontent.com/sguys99/mcp-connectors/main/docs/assets/screenshots/inspector-call-light.png` |
| Dashboard screenshot | `https://raw.githubusercontent.com/sguys99/mcp-connectors/main/docs/assets/screenshots/dashboard-light.png` |
| Workflow diagram | `https://raw.githubusercontent.com/sguys99/mcp-connectors/main/docs/assets/diagrams/workflow-light.svg` |

Reddit, LinkedIn, and X want an uploaded file, not a URL; download the GIF and attach it.

## Channel table

Fit means how well the channel matches what this repository is: a dev tool and framework (starter servers, shared guardrails, an Inspector and Chat UI), not a single integration server.

| Channel | Fit | Why | Submission method and rules | What to submit | Prerequisites | Order |
|---|---|---|---|---|---|---|
| [punkpeye/awesome-mcp-devtools](https://github.com/punkpeye/awesome-mcp-devtools) | **High** | A list for SDKs, frameworks, testing tools, and templates. The official Inspector, MCPJam, and mcp-cli sit in its "Testing Tools" section, which is the closest match | Fork, edit `README.md`, open a PR. Follow the existing format, one tool per line, "alphabetical order within each category" ([CONTRIBUTING](https://github.com/punkpeye/awesome-mcp-devtools/blob/main/CONTRIBUTING.md)). No Glama badge check in this repo | One line under **Testing Tools** (draft below) | Public repo (done). Release preferred | 2 |
| [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | **High** (reach), medium (category) | The largest MCP list, synced to [glama.ai/mcp/servers](https://glama.ai/mcp/servers). Most sections are integrations, but it has a **Frameworks** section (FastMCP, DotnetFastMCP, gomcp with an inspector UI) | Fork and PR on `README.md` ([CONTRIBUTING](https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md)): "servers with a public GitHub repository", one per line, follow the format. A bot ([check-glama.yml](https://github.com/punkpeye/awesome-mcp-servers/blob/main/.github/workflows/check-glama.yml)) labels each PR: the link text must be `owner/repo`, the link must be `https://github.com/...`, only legend emojis are allowed and at least one is required, duplicates are flagged, and a **Glama score badge** is required (`missing-glama` label otherwise). Merged PRs in October 2026 all carried the badge | One line in **Frameworks** (or, alternatively, one line for `nl2sql_mcp` in **Databases**; pick one, not both) | Glama listing with a passing check and a score badge | 3 |
| [Glama](https://glama.ai/mcp/servers) | **High** (as a gate) | Needed for the awesome-mcp-servers badge, and its directory mirrors that list | "Add Server" on glama.ai/mcp/servers. Per the awesome-mcp-servers bot text: "you must add Dockerfile directly to Glama. For checks to pass, we only need the server to start and respond to introspection requests" | The repository URL and a Dockerfile that starts one server (draft below) | Public repo | 1 |
| [mcp.so](https://mcp.so/submit) | Medium | Large directory, form based, cheap to do | Web form: type (MCP Server, Remote Server, MCP Client, AI Product), repository URL (required), name. A $39 option skips review; the free path is enough | Type "MCP Server", the repo URL | Public repo | 1 |
| [mcpservers.org](https://mcpservers.org/submit) (wong2/awesome-mcp-servers) | Medium | The wong2 list says "We do not accept PRs. Please submit your MCP on the website" | Web form: name, category (Development, Database, ...), short description, link, optional Official MCP Registry name, remote support checkbox, contact email. Free tier: "Review within 2 weeks"; $39 for 24 hours | Category "Development", description below | Public repo, an email for the form | 1 |
| [appcypher/awesome-mcp-servers](https://github.com/appcypher/awesome-mcp-servers) | Low to medium | Smaller and slower (last push 2026-05), but has a "Tools & Utilities" part where similar frameworks (mxcp, ToolHive) are listed | PR per suggestion. Its [CONTRIBUTING](https://github.com/appcypher/awesome-mcp-servers/blob/main/CONTRIBUTING.md) says both "added to the bottom of the relevant category" and "ordered alphabetically"; follow whatever the section currently does | One line under **Tools & Utilities > Server Managers** | None | 4 (optional) |
| [Hacker News, Show HN](https://news.ycombinator.com/showhn.html) | **High** (if it lands), high variance | HN readers care about guarded SQL for agents and local tooling. Show HN is for "something people can try out", "non-trivial", "you should have built it yourself and be available to discuss it", "easy to try without signing up". It fits: `docker compose up` and no key needed | Submit a story whose title begins with "Show HN". Do not ask anyone to upvote or comment ("explicitly not allowed"). Titles: no uppercase tricks or exclamation points, don't editorialize ([guidelines](https://news.ycombinator.com/newsguidelines.html)). One shot; a routine update like "1.3.1 is out" does not qualify later | URL = the GitHub repo, title, and a first comment from the author (drafts below) | v0.1.0 release, README GIF (done), a few hours free to answer comments | 5 |
| r/mcp | **High** | The MCP subreddit; awesome-mcp-servers links it in its header | Reddit pages could not be fetched from here, so the current rules, required flair, and self-promotion limits are **not verified**. Read the sidebar and rules at `https://www.reddit.com/r/mcp/about/rules` before posting and pick the showcase flair if one exists | Text post with the GIF attached (draft below) | A Reddit account with some history; read the rules | 6 |
| r/ClaudeAI | Medium | The workflow uses Claude Code skills, and Chat supports Claude models. Also a risk: readers may see it as Claude-only | A mod post on 2026-04-15 ("Built with Claude" Project Showcase Megathread) says feed-level showcase posts need **total karma 50 or more**, others are sent to the megathread, and showcases must follow "the Showcase requirements in Rule 7" (rule text not verified from here) | A shorter post focused on the two skills, or a megathread comment | Karma 50 for a feed post, otherwise use the megathread | 7 |
| [dev.to](https://dev.to/t/showdev) | Medium | Long-form fits the guardrail story. `#showdev` is "for showing off projects and launching products", "not overly corporate or salesy" | Write a post; tags are capped at four (platform limit reported by several integrations, not checked in dev.to docs) | An article (outline below), tags `showdev`, `mcp`, `python`, `ai` | Release | 9 |
| [GeekNews Show GN](https://news.hada.io/blog/show) | **High** (Korea) | Korean developers, and open source you can try is exactly what Show GN takes | Choose the Show type at `news.hada.io/write?type=show` (the "Show GN:" prefix is added for you). Title format "Service/Project name - core feature", with motivation and story in the body. You must have built it and answer questions. Concise and factual, no marketing language. No upvote requests. The same project cannot be resubmitted within a set period, and a major version does not lift that. Self-made projects must go to Show, not News ([guidelines](https://news.hada.io/guidelines)) | Korean post (draft below) | Release, Korean README (done) | 8 |
| [OKKY](https://okky.kr/community) | Low to medium | Large Korean developer community, but no board is designated for project promotion. Members post their own services in **피드백**, and there is an **AI** board. The 운영정책 page was not readable from here | Post in 피드백 asking for feedback, not as an ad. Read 운영정책 first | Shortened Korean post (draft below) | OKKY account | 10 (optional) |
| [Disquiet](https://disquiet.io/) | Low | A maker community centered on products and maker logs; fits services more than dev tooling. The posting rules were not readable from here | Log in, "글쓰기", or register a product page | Short maker log in Korean | Account | 10 (optional) |
| LinkedIn | Medium | Enterprise data and platform teams are the target users, and they are on LinkedIn | Personal post, no submission rules | EN and KO short posts with the GIF | Release | 8 (same day as GeekNews) |
| X | Low to medium | Reach depends on the existing follower graph | 280 characters on a standard account, so the drafts fit that | EN and KO posts | Release | 8 |

## Channels that do not fit now

| Channel | Status | Why not now | When it would fit |
|---|---|---|---|
| [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) README | Closed to listings | The README now says "If you are looking for a list of MCP servers, you can browse published servers on the MCP Registry" and that the repository is "dedicated to housing just the small number of reference servers maintained by the MCP steering group". Its CONTRIBUTING says "We accept issues, not pull requests" | Never as a listing. Use the MCP Registry instead |
| [Official MCP Registry](https://registry.modelcontextprotocol.io/) | Not now | The registry (still "in preview") hosts metadata that points to a package: npm, PyPI, NuGet, Cargo, OCI images on Docker Hub, GHCR and others, or MCPB files on GitHub releases, or a public remote URL ([about](https://modelcontextprotocol.io/registry/about), [package types](https://modelcontextprotocol.io/registry/package-types)). Ownership is verified per package (`mcp-name:` in the PyPI README, `io.modelcontextprotocol.server.name` label on the image). This repository is a monorepo you clone; none of its servers is published as a package, and the starter and mock servers are learning examples, not something to install | After publishing `nl2sql_mcp` on its own, for example as a GHCR image built from the root `Dockerfile` with the label above, or as a PyPI package. Then add a `server.json` named `io.github.sguys99/nl2sql-mcp` and publish with `mcp-publisher` |
| [PulseMCP](https://www.pulsemcp.com/submit) | Submissions closed | The page says it is "not accepting new MCP server or client submissions right now" and recommends publishing to the Official MCP Registry, which it "will pick up automatically once we are back" | Follows the MCP Registry item |
| [Smithery](https://smithery.ai/docs/build/publish) | Not now | Publishing needs either a public HTTPS Streamable HTTP endpoint or a `.mcpb` bundle for stdio servers | If `nl2sql_mcp` ships as an MCPB bundle or a hosted demo endpoint |

## Recommended order

Wait for P7-9 (v0.1.0 tag and GitHub Release, green CI) and P7-7 (social preview image) before anything public. A link preview without the image looks unfinished on HN, Reddit, LinkedIn, and GeekNews.

| Step | When | What |
|---|---|---|
| 0 | Release day | Publish the v0.1.0 GitHub Release. Check the social preview image |
| 1 | Release day | Submit to Glama, mcp.so, and mcpservers.org. They need review time (mcpservers.org: up to two weeks free) |
| 2 | Day 1 | PR to awesome-mcp-devtools (Testing Tools) |
| 3 | When Glama shows a score | PR to awesome-mcp-servers (Frameworks) with the badge |
| 4 | Optional, day 2 | PR to appcypher/awesome-mcp-servers |
| 5 | A weekday in week 1, US morning (Korea evening to night) | Show HN. Stay online for the next few hours to answer. Do not post Reddit or LinkedIn in the same hour; one channel at a time keeps the replies manageable |
| 6 | 1 to 2 days after HN | r/mcp, then r/ClaudeAI (feed post only if karma is 50 or more, otherwise the megathread) |
| 7 | Week 1, Korean weekday morning | GeekNews Show GN, then LinkedIn and X (EN and KO) the same day |
| 8 | Week 2 | dev.to article, using questions from HN and Reddit to shape it. Optional OKKY and Disquiet |

Post each draft once per channel. Do not cross-post the same text to many subreddits.

## Drafts

### awesome-mcp-servers (punkpeye)

Target section: **Frameworks** (`## Frameworks`, near the end of `README.md`). The list mixes orders in practice, but CONTRIBUTING asks for alphabetical order, so place it alphabetically by link text among the lines there.

Legend emojis used: 🐍 Python, 📇 TypeScript, 🏠 local service, 🍎 macOS, 🐧 Linux. Windows (🪟) is left out because local development needs WSL 2 or Docker; add it only if you are comfortable with that. Replace the Glama path if Glama assigns a different one.

```markdown
- [sguys99/mcp-connectors](https://github.com/sguys99/mcp-connectors) [![sguys99/mcp-connectors MCP server](https://glama.ai/mcp/servers/sguys99/mcp-connectors/badges/score.svg)](https://glama.ai/mcp/servers/sguys99/mcp-connectors) 🐍 📇 🏠 🍎 🐧 - Monorepo for building and verifying MCP servers for internal systems on FastMCP: an NL2SQL reference server with read-only, PII, mass scan and audit guardrails, shared auth and masking modules, a local Inspector plus multi-provider LLM Chat UI with traces, and Claude Code skills that turn a spec into a server.
```

Alternative, if you would rather appear in **Databases** (do not submit both; Glama has one listing per repository, so the badge is the same):

```markdown
- [sguys99/mcp-connectors](https://github.com/sguys99/mcp-connectors/tree/main/src/mcp-servers/nl2sql_mcp) [![sguys99/mcp-connectors MCP server](https://glama.ai/mcp/servers/sguys99/mcp-connectors/badges/score.svg)](https://glama.ai/mcp/servers/sguys99/mcp-connectors) 🐍 🏠 🍎 🐧 - NL2SQL server for PostgreSQL (Oracle optional) with schema search and guarded `run_sql_query`: read-only parser and session, row and date limits, mass scan and Cartesian join blocking, PII block and mask, risky function blocking, and a SQLite audit log. Runs on a Mock backend with no setup.
```

PR title: `Add sguys99/mcp-connectors to Frameworks`

PR body:

```markdown
Adds [mcp-connectors](https://github.com/sguys99/mcp-connectors) to **Frameworks**.

A Python (FastMCP) monorepo for building MCP servers for internal systems with one layout: shared auth, CORS, PII masking and trust-boundary helpers, three example servers (including an NL2SQL server with SQL guardrails), a CLI with a scenario runner, and a Next.js Inspector and LLM Chat UI.

- Listed on Glama: https://glama.ai/mcp/servers/sguys99/mcp-connectors
- Apache-2.0, v0.1.0
- One line, following CONTRIBUTING.md. I maintain this project.
```

### awesome-mcp-devtools (punkpeye)

Target section: **Testing Tools** (`## Testing Tools`). Its legend has language emojis only (no scope or OS emojis), so use 🐍 📇.

```markdown
- [sguys99/mcp-connectors](https://github.com/sguys99/mcp-connectors) 🐍 📇 - Local Inspector and LLM Chat for MCP servers in one UI: tools, resources, prompts and a JSON-RPC log, a tool-use loop over Anthropic, OpenAI or OpenRouter with a trace waterfall and manual approval, history export to scenario YAML, and a CLI runner with JUnit output. Ships FastMCP example servers, including a guarded NL2SQL server.
```

PR title: `Add sguys99/mcp-connectors to Testing Tools`

PR body:

```markdown
Adds [mcp-connectors](https://github.com/sguys99/mcp-connectors) to **Testing Tools**.

It checks MCP servers two ways in one local web UI: single calls in an Inspector (tools, resources, prompts, raw JSON-RPC log) and real LLM tool use in a Chat with traces and per-call approval. Calls can be exported as scenario YAML and replayed with the bundled CLI in CI. Apache-2.0, v0.1.0. I maintain this project.
```

### appcypher/awesome-mcp-servers

Target: **Tools & Utilities > Server Managers**. Format in that section is `- [name](url) - description.` with no badge.

```markdown
- [mcp-connectors](https://github.com/sguys99/mcp-connectors) - Monorepo for building and testing MCP servers for internal systems: FastMCP starter and NL2SQL reference servers with shared guardrails, a CLI scenario runner, and a local Inspector and LLM Chat UI.
```

### Directory forms (Glama, mcp.so, mcpservers.org)

Short description (under 200 characters):

> Build and verify MCP servers for internal systems: an NL2SQL server with SQL guardrails, shared auth and PII helpers, and a local Inspector plus LLM Chat UI.

Long description:

> MCP Connectors is an Apache-2.0 monorepo for teams that connect AI agents to internal systems. Every server uses the same FastMCP layout and shared `_common` modules (API key auth, CORS, PII masking, trust-boundary wrapping, retries, hashed JSON logs). It ships three example servers: a starter, a code repository server with a mock backend, and `nl2sql_mcp`, which runs agent-written SQL behind read-only enforcement, row and date limits, mass scan blocking, PII control, and an audit log, on a Mock backend or PostgreSQL (Pagila). A Next.js UI adds an Inspector, an LLM Chat with traces and manual approval, and a dashboard. Two Claude Code skills write a spec and build a server from it.

Glama needs a Dockerfile entered on Glama that starts one server and answers introspection. The repository's root `Dockerfile` already uses `ENTRYPOINT ["python", "-m"]`, so the Glama build only needs a command for the Mock NL2SQL server over stdio:

```dockerfile
# Same as the repository's root Dockerfile, plus:
CMD ["nl2sql_mcp.server", "--transport", "stdio"]
```

Check it locally before submitting: `docker build -t mcpc-glama .` with that line added, then `docker run -i --rm mcpc-glama` should wait on stdin without errors. The Mock backend needs no database or keys.

mcpservers.org: category **Development**, leave "Official MCP Registry Name" empty, leave "supports remote connections" unchecked (the servers are meant to run locally).

### Show HN

Title options (HN cuts titles at 80 characters; counts in parentheses):

1. `Show HN: MCP Connectors, guarded NL2SQL and a local MCP Inspector with LLM chat` (79)
2. `Show HN: NL2SQL MCP server with SQL guardrails, plus a test UI for MCP servers` (78)
3. `Show HN: MCP Connectors, build and test MCP servers for internal systems` (72)

Option 1 is the recommended one. URL: `https://github.com/sguys99/mcp-connectors`

First comment (post it right after submitting):

```text
Hi HN, I built this while connecting AI agents to internal systems (code repos, relational databases, a data warehouse). Each new MCP server ended up with its own layout, its own idea of auth, and no shared way to check it. MCP Connectors is the cleaned-up, open source version of how I now do it.

The part I'd most like feedback on is nl2sql_mcp. Letting an agent write SQL against a real database worried me, so every query goes through a sqlglot-based pipeline before it runs:

- read only, twice: the parser allows SELECT/WITH/set operations only (writes hidden in a CTE and SELECT INTO are caught), and PostgreSQL sessions are opened with default_transaction_read_only
- no WHERE on a large table, Cartesian joins, and WHERE 1=1 style tautologies are blocked
- row limits and date range limits are rewritten into the query
- PII columns are either rejected in the SELECT list or masked in results
- server file, sleep and session functions (pg_read_file, pg_sleep, set_config, ...) are blocked
- every call, allowed or blocked, goes to an audit log

Each block returns an error ending in a code like [MASS_SCAN_BLOCKED], so the model can read it and retry with a narrower query.

The other half is a local web UI. The official MCP Inspector checks one call at a time; I also wanted to see what a real model does with the same tools. So there is an Inspector (tools, resources, prompts, raw JSON-RPC log) and a Chat that runs a tool-use loop with Anthropic, OpenAI or OpenRouter, with a trace waterfall, per-call manual approval, and token usage. Inspector history exports to a scenario YAML that the CLI replays in CI.

Try it: git clone, cp .env.example .env, docker compose up -d --wait, then open localhost:3000. No API key is needed for the Inspector, and NL2SQL starts on an in-memory Mock backend. make nl2sql-sample-db switches it to PostgreSQL 17 with the Pagila sample.

Limitations, honestly: it's v0.1.0 and mostly one person's work. The "write a spec, generate the server" step uses two Claude Code skills; without Claude Code you copy the starter server by hand (documented). Auth is off by default and it's a dev/verification tool, not a production gateway. NL2SQL supports PostgreSQL and Oracle so far, no MySQL or SQLite yet, and there's no OAuth 2.1.

Python 3.12 + FastMCP for the servers, Next.js for the UI, Apache-2.0. Happy to answer questions, and I'd especially like to hear about guardrail cases I missed.
```

### r/mcp

Confirm the rules and flair first (not verified, see the table). Attach `chat-tool-use.gif`.

Title: `I open-sourced a guarded NL2SQL MCP server and a local UI that runs the Inspector and an LLM chat on the same servers`

Body:

```markdown
I've been building MCP servers for internal systems (repos, Postgres, a warehouse) and kept rewriting the same auth, logging and testing glue. MCP Connectors is my attempt to make every server look the same and be checked the same way. v0.1.0, Apache-2.0.

**What's in it**

- **nl2sql_mcp**: schema search tools plus `run_sql_query` behind guardrails. Read-only at the parser and the session, row and date limits, blocks for no-WHERE scans on big tables, Cartesian joins, tautologies, PII columns (or masks them), and risky functions like `pg_sleep`. Every call is audited. Errors end with a code like `[PII_COLUMN_BLOCKED]` so the model can recover. Mock backend by default, PostgreSQL + Pagila with one command.
- **Inspector + Chat in one UI**: call tools/resources/prompts by hand with a JSON-RPC log, then let Claude, GPT or an OpenRouter model use the same servers with a trace waterfall, manual approval per call, and token counts. You can also point it at any Streamable HTTP server by URL.
- **Shared `_common` modules**: API key auth, CORS, PII masking, wrapping external text as untrusted content, retries, JSON logs that hash arguments.
- **CLI + scenario YAML**: export Inspector history as a scenario and replay it in CI (`--junit`).
- **Spec-driven workflow**: two Claude Code skills, one writes a 10-section spec, the other builds the server from it.

**Try it**: `git clone`, `cp .env.example .env`, `docker compose up -d --wait`, open localhost:3000. No LLM key needed for the Inspector.

**Limits**: the generator skills need Claude Code (manual path is documented). It's a dev/verification tool, auth is off by default, no OAuth 2.1 yet, NL2SQL is PostgreSQL and Oracle only.

Repo: https://github.com/sguys99/mcp-connectors

What guardrail would you add before letting an agent query your production replica?
```

### r/ClaudeAI

Use only if you have karma 50 or more; otherwise post the same text as a comment in the "Built with Claude" Project Showcase Megathread. Check Rule 7 first.

Title: `Two Claude Code skills that interview you for an MCP server spec and then build the server, tests and scenarios from it`

Body:

```markdown
I made `/mcp-spec-writer` and `/mcp-server-builder` for a repo where all MCP servers share one layout.

1. `/mcp-spec-writer` asks section by section (tools, inputs, errors, auth, guardrails) and writes a 10-section spec your team can review.
2. `/mcp-server-builder` turns that spec into a FastMCP server with a Mock backend, pytest tests, a scenario YAML, a registry entry and Makefile targets.
3. You check it in a local web UI: an Inspector for single calls, and a Chat where Claude (or GPT/OpenRouter) uses the tools with a trace and manual approval.

The repo also has an NL2SQL server with SQL guardrails (read-only, mass scan and PII blocking, audit log) as a reference for what "safe" looks like.

The skills are optional; the manual path is documented. v0.1.0, Apache-2.0: https://github.com/sguys99/mcp-connectors

Feedback on the skill prompts is welcome. They live in `.claude/skills/` with evals.
```

### dev.to article outline

Title: `Letting an AI agent write SQL against your database: the guardrails I put in an MCP server`

Tags: `showdev`, `mcp`, `python`, `ai`. Cover image: `chat-light.png` or a frame from the Chat GIF.

1. **The problem** (short). Agents writing SQL is useful and scary. What can go wrong: writes, full table scans, PII in results, `pg_sleep`, catalog reads.
2. **Where the checks live.** MCP server, not the prompt. Defense in depth: parser checks plus a read-only database session plus a read-only account.
3. **The pipeline, check by check.** One small section each with a blocked query and its error code, taken from `docs/guardrails.md`: read-only, multiple statements, forbidden constructs, PII block and mask, mass scan and Cartesian joins, tautologies, risky functions, row and date rewrites, audit log.
4. **Making errors useful to the model.** The `[CODE]` suffix, and how the model retries with a narrower query. Show a Chat trace screenshot.
5. **Testing it without a database.** Mock backend, scenario YAML files, `make test-scenarios`, and the same suite against PostgreSQL in CI.
6. **Testing it with a real model.** Inspector for single calls, Chat for the tool-use loop, manual approval.
7. **Reusing this for your own server.** `_common` modules, the spec and builder skills, the manual path.
8. **Limits and what's next.** v0.1.0, PostgreSQL and Oracle only, no OAuth 2.1, scaffolder CLI planned. Ask readers for missed cases.
9. Links: repo, `docs/guardrails.md`, `docs/getting-started.md`.

Keep code blocks short and real (copy from `docs/guardrails.md`). Do not paste the whole README.

### GeekNews Show GN (Korean)

Show 타입으로 등록하면 "Show GN:" 접두가 자동으로 붙으니 제목에는 쓰지 않습니다. URL은 GitHub 저장소입니다.

제목: `MCP Connectors - 가드레일 갖춘 NL2SQL MCP 서버와 Inspector, LLM Chat 검증 UI`

본문:

```text
사내 시스템(코드 저장소, RDB, DW)을 AI Agent와 연결하는 MCP 서버를 여러 개 만들면서 쓰던 구조를 정리해 오픈소스로 공개했습니다. 제가 직접 만들고 있는 프로젝트이고, v0.1.0이며 라이선스는 Apache-2.0입니다.

무엇인가요
- MCP 서버 여러 개를 같은 레이아웃과 같은 보안 모듈로 만들고, 같은 CLI와 웹 UI로 검증하는 모노레포입니다. Python 3.12 + FastMCP, Frontend는 Next.js입니다.

먼저 봐 주셨으면 하는 부분은 NL2SQL 서버입니다
- Agent가 쓴 SQL을 sqlglot으로 파싱해서 실행 전에 검사합니다.
- 읽기 전용은 두 겹입니다. 파서가 SELECT, WITH, 집합 연산만 통과시키고(CTE 안에 숨긴 쓰기와 SELECT INTO도 막음), PostgreSQL 세션은 default_transaction_read_only로 엽니다.
- 큰 테이블의 WHERE 없는 조회, 카티션 조인, WHERE 1=1 같은 항상 참 조건을 차단합니다.
- 행 수와 기간 제한은 쿼리를 고쳐서 적용하고, PII 컬럼은 SELECT에서 거부하거나 결과에서 마스킹합니다.
- pg_sleep, pg_read_file 같은 위험 함수를 막고, 허용과 차단을 가리지 않고 모든 호출을 감사 로그에 남깁니다.
- 차단 오류는 [MASS_SCAN_BLOCKED]처럼 코드로 끝나서, 모델이 읽고 범위를 좁혀 다시 시도할 수 있어요.
- 설치 직후에는 Mock 백엔드로 돌고, make nl2sql-sample-db 한 번이면 PostgreSQL 17 + Pagila 샘플 DB로 바뀝니다.

Inspector와 Chat을 한 화면 세트에서
- 공식 MCP Inspector는 호출 하나를 점검하는 도구라, 실제 모델이 같은 도구를 어떻게 쓰는지는 따로 봐야 했습니다.
- 여기서는 Inspector에서 도구, 리소스, 프롬프트를 하나씩 호출하고(JSON-RPC 로그 포함), Chat에서 Anthropic, OpenAI, OpenRouter 모델이 같은 서버를 쓰게 합니다. Trace 워터폴, 호출별 수동 승인, 토큰 사용량을 함께 봅니다.
- Inspector 호출 기록은 시나리오 YAML로 내보내서 CLI로 CI에서 다시 돌릴 수 있습니다.

스펙 주도 워크플로우
- Claude Code 스킬 두 개가 들어 있습니다. /mcp-spec-writer가 인터뷰로 10섹션 정의서를 쓰고, /mcp-server-builder가 그 정의서로 서버, 테스트, 시나리오, 레지스트리 항목을 만듭니다.

써 보는 방법
- git clone 후 cp .env.example .env, docker compose up -d --wait 를 실행하고 localhost:3000 을 열면 됩니다. 가입이나 LLM 키 없이 Inspector까지 바로 써 볼 수 있어요.

한계도 적어 둡니다
- 서버 생성 단계는 Claude Code 스킬에 의존합니다. Claude Code가 없으면 starter 서버를 복사해서 직접 만드는 경로(문서화되어 있음)를 써야 합니다.
- 개발과 검증용 도구입니다. 인증은 기본으로 꺼져 있고, OAuth 2.1은 아직 없습니다.
- NL2SQL은 PostgreSQL과 Oracle만 지원합니다. MySQL, SQLite는 다음 순서입니다.

받고 싶은 피드백
- 운영 DB(또는 복제본)에 Agent를 붙인다면 이 외에 어떤 가드레일이 필요할지 의견 주시면 반영하겠습니다.
- 사내 시스템용 MCP 서버를 여러 개 운영하는 팀이라면 이런 구조가 맞는지도 궁금합니다.

데모 GIF와 문서는 README에 있습니다. 한국어 README(README.ko.md)도 함께 있습니다.
```

### OKKY and Disquiet (Korean)

OKKY는 홍보 전용 게시판이 없어서 **피드백** 게시판에 피드백 요청 형식으로 올립니다. 올리기 전에 운영정책을 확인하세요(여기서는 내용을 읽지 못했습니다).

제목: `Agent가 쓴 SQL을 막는 가드레일, 이 정도면 충분할까요? (오픈소스 NL2SQL MCP 서버)`

```text
AI Agent를 사내 DB에 붙이는 MCP 서버를 만들다가, 가드레일 부분을 정리해서 오픈소스로 공개했습니다. 직접 만든 프로젝트이고 아직 v0.1.0입니다.

지금 들어 있는 검사는 이렇습니다.
- 읽기 전용: 파서 검사와 DB 세션 읽기 전용 두 겹
- WHERE 없는 대용량 조회, 카티션 조인, WHERE 1=1 차단
- 행 수와 기간 제한(쿼리 재작성)
- PII 컬럼 거부 또는 마스킹
- pg_sleep 같은 위험 함수 차단
- 모든 호출 감사 로그

docker compose 한 번으로 Mock 백엔드에서 바로 돌려 볼 수 있고, 웹 UI에서 도구를 직접 호출하거나 LLM이 쓰는 과정을 Trace로 볼 수 있습니다.

실무에서 DB 접근을 열어 줄 때 보통 어떤 통제를 추가로 거시는지 궁금합니다. 빠진 케이스가 있으면 알려 주세요.

https://github.com/sguys99/mcp-connectors
```

Disquiet 메이커로그(짧게):

```text
사내 시스템용 MCP 서버를 같은 구조로 만들고 검증하는 오픈소스, MCP Connectors v0.1.0을 공개했습니다. Agent가 쓴 SQL을 실행 전에 검사하는 NL2SQL 서버, 도구를 직접 호출하는 Inspector, 실제 LLM이 도구를 쓰는 과정을 보여 주는 Chat이 한 저장소에 들어 있어요. docker compose 한 번이면 가입이나 키 없이 써 볼 수 있습니다. https://github.com/sguys99/mcp-connectors
```

### LinkedIn and X

LinkedIn, English (attach `chat-tool-use.gif`):

```text
I open-sourced MCP Connectors (v0.1.0, Apache-2.0).

It's the structure I use to connect AI agents to internal systems with MCP: every server gets the same layout, the same auth and PII helpers, and the same tests.

Three things in it:

1. An NL2SQL MCP server with SQL guardrails. Read-only at the parser and the session, mass scan and Cartesian join blocking, row and date limits, PII block or mask, risky function blocking, and an audit log of every call.
2. One local UI to check servers two ways: an Inspector for single calls, and a Chat where Claude, GPT or OpenRouter models use the same tools, with traces and per-call approval.
3. A spec-driven workflow: two Claude Code skills write a reviewable spec and build the server from it.

It's a development and verification tool, not a production gateway, and the generator step needs Claude Code (a manual path is documented).

docker compose up and open localhost:3000 to try it, no key needed.

https://github.com/sguys99/mcp-connectors
```

LinkedIn, Korean:

```text
MCP Connectors를 오픈소스로 공개했습니다(v0.1.0, Apache-2.0).

AI Agent를 사내 시스템에 MCP로 연결할 때 쓰던 구조를 정리한 저장소입니다. 서버마다 같은 레이아웃, 같은 인증과 PII 처리 모듈, 같은 테스트 방식을 씁니다.

핵심은 세 가지입니다.

1. SQL 가드레일을 갖춘 NL2SQL MCP 서버. 파서와 세션 두 겹의 읽기 전용, 대량 조회와 카티션 조인 차단, 행 수와 기간 제한, PII 거부 또는 마스킹, 위험 함수 차단, 모든 호출의 감사 로그가 들어 있습니다.
2. 로컬 UI 하나로 두 가지 검증. Inspector로 도구를 하나씩 호출하고, Chat에서는 Claude, GPT, OpenRouter 모델이 같은 도구를 쓰는 과정을 Trace와 호출별 승인으로 확인합니다.
3. 스펙 주도 워크플로우. Claude Code 스킬 두 개가 리뷰 가능한 정의서를 쓰고, 그 정의서로 서버를 만듭니다.

운영 게이트웨이가 아니라 개발과 검증용 도구이고, 서버 생성 단계는 Claude Code가 필요해요(수동 경로는 문서에 있습니다).

docker compose up 후 localhost:3000을 열면 키 없이 바로 써 볼 수 있습니다.

https://github.com/sguys99/mcp-connectors
```

X, English (fits 280 characters with the link):

```text
I open-sourced MCP Connectors v0.1.0: an NL2SQL MCP server that checks agent-written SQL (read-only, mass scan, PII, audit log) plus one local UI with an MCP Inspector and an LLM chat with traces. docker compose up, no key needed.
https://github.com/sguys99/mcp-connectors
```

X, Korean:

```text
MCP Connectors v0.1.0을 공개했습니다. Agent가 쓴 SQL을 실행 전에 검사하는 NL2SQL MCP 서버(읽기 전용, 대량 조회 차단, PII, 감사 로그)와, MCP Inspector와 LLM Chat을 한 곳에 둔 로컬 UI가 들어 있어요. docker compose 한 번이면 키 없이 써 볼 수 있습니다.
https://github.com/sguys99/mcp-connectors
```

## Launch checklist

Before anything public:

- [ ] v0.1.0 tag and GitHub Release are published (P7-9), and CI on `main` is green
- [ ] The Quick Start works from a fresh clone (`docker compose up -d --wait`, then the Inspector `echo` call)
- [ ] Social preview image is uploaded (P7-7); check the link card on a test post or with a preview tool
- [ ] Repository description and topics are set (done: `mcp`, `model-context-protocol`, `fastmcp`, `mcp-inspector`, `nl2sql` and others)
- [ ] README GIFs load from `main` (raw URLs above)
- [ ] Issues are open, and a few `good first issue` items exist (for example MySQL or SQLite dialect, the scaffolder CLI)

Submissions:

- [ ] Glama listing passes its checks and shows a score; copy the badge path it gives
- [ ] mcp.so and mcpservers.org forms submitted (free tier)
- [ ] awesome-mcp-devtools PR (Testing Tools)
- [ ] awesome-mcp-servers PR (Frameworks) with the Glama badge; check the bot labels (`has-glama`, `has-emoji`, `valid-name`) after opening
- [ ] Optional: appcypher PR

Posts (one channel at a time, and stay to answer):

- [ ] Show HN with the first comment
- [ ] r/mcp after reading its rules; r/ClaudeAI feed post only with karma 50 or more, else the megathread
- [ ] GeekNews Show GN in Korean, then LinkedIn and X (EN and KO)
- [ ] dev.to article in week 2
- [ ] Optional: OKKY 피드백, Disquiet

After:

- [ ] Collect repeated questions into `docs/faq.md`
- [ ] Turn missed guardrail cases into issues
- [ ] Revisit the MCP Registry once `nl2sql_mcp` is published as a package or image (it also unlocks PulseMCP)
