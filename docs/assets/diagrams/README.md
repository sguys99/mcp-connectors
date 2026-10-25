# Diagrams

Hand-written SVG diagrams used by `README.md` and `README.ko.md`. Each diagram has a light and a dark variant.

| File | Shows |
|---|---|
| `architecture-light.svg`, `architecture-dark.svg` | The two Claude Code skills, the servers in `src/mcp-servers/` and their shared `_common/` modules, the registry `configs/mcp_servers.yaml`, the CLI and the Frontend (pages and server routes), and the external LLM providers and runtime servers |
| `workflow-light.svg`, `workflow-dark.svg` | The five steps for adding a server (spec, implement, test, CLI check, visual check) and the loop from Inspector History back to `mcp_cli.py test` |

## Embedding

GitHub picks the variant from the viewer's color scheme through `<picture>`. Paths below are relative to the repository root, so they work as is in `README.md` and `README.ko.md`:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/diagrams/architecture-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/diagrams/architecture-light.svg">
  <img alt="Architecture: Claude Code skills generate MCP servers on shared _common modules and add them to configs/mcp_servers.yaml. The CLI and the Next.js Frontend read the registry and call the servers. The Frontend proxies registered servers through /api/mcp/[server], runs Chat through /api/chat with LLM providers, and reaches runtime servers directly or through the opt-in /api/mcp-runtime." src="docs/assets/diagrams/architecture-light.svg">
</picture>
```

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/diagrams/workflow-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/diagrams/workflow-light.svg">
  <img alt="Workflow: 1 spec with /mcp-spec-writer, 2 implement with /mcp-server-builder, 3 test with make test-NAME and mcp_cli.py test, 4 call one tool with mcp_cli.py call, 5 check in Inspector and Chat. Inspector History exports scenario YAML for mcp_cli.py test." src="docs/assets/diagrams/workflow-light.svg">
</picture>
```

From a file inside `docs/`, drop the `docs/` prefix (for example `assets/diagrams/architecture-light.svg`). Leave out `width` on `<img>`: the SVGs carry their own size (1200 px wide) and GitHub scales them down to the column width.

## Design rules

The colors, radii, and fonts come from the product design tokens in [`docs/revamp/design/tokens.css`](../../revamp/design/tokens.css), concept A (the final design, see [`final.html`](../../revamp/design/final.html) and [`tokens.md`](../../revamp/design/tokens.md)), so the diagrams match the app screenshots.

| Role | Token | Light | Dark |
|---|---|---|---|
| Canvas | `--bg` | `#f8fbfb` | `#0d1314` |
| Zone (group) | `--surface-sunken` / `--surface` | `#f3f6f7` | `#131a1b` |
| Card | `--surface` / `--surface-raised` | `#fcfefe` | `#192123` |
| Card border | `--n-200` / `--n-750` | `#d8e0e2` | `#2b3537` |
| Zone and canvas border | `--line` | `#e2e8ea` | `#21292c` |
| Chip | `--n-100` / `--n-800` | `#ebf0f2` | `#21292c` |
| Chip text, paths | `--n-700` / `--n-300` | `#3a4547` | `#c3cccf` |
| Text | `--fg` | `#070c0e` | `#f8fbfb` |
| Secondary text | `--fg-muted` | `#515d60` | `#9ba7aa` |
| Connector | `--line-strong` | `#828f92` | `#6a777a` |
| Accent (skills, build path, step badges) | `--brand` | `#007781` | `#37d6dd` |
| Accent text | `--brand-text` | `#006b74` | `#55dae1` |
| Accent fill and border | `--brand-subtle`, `--brand-border` | `#def5f8`, `#50afb9` | `#03343c`, `#13808a` |

- Every text color passes WCAG AA (4.5:1) on its background, and connectors pass 3:1.
- Radii: zones 10, cards 8, chips 4. Spacing sits on the 4 px grid, with 24 px padding inside zones and 16 px inside cards.
- Fonts: IBM Plex Sans and JetBrains Mono come first, but an `<img>` cannot load web fonts, so the stacks fall back to system fonts (`-apple-system`, `Segoe UI`, `Helvetica`, `Arial`, then `ui-monospace`, `SFMono-Regular`, `Menlo`, `Consolas`). Leave about 10 percent slack in each box for wider fallback fonts.
- Minimum font size is 12 px at 1200 px wide, which stays readable when GitHub shows the image at about 880 px.
- Lines: solid gray for runtime calls, solid accent for generated or written files, dashed for opt-in or optional, and a dot where one line joins another. Arrowheads are small open chevrons.
- Text is English only. Do not use the em dash or the middle dot.
- Keep the files self-contained: no scripts, external fonts, images, or links.

## Editing

The light and dark files share the same geometry and differ only in the color values inside the `<style>` block. Both are generated from one layout by `generate.py` (standard library only), so edit the script instead of the SVGs and regenerate both themes at once:

```bash
python3 docs/assets/diagrams/generate.py docs/assets/diagrams
```

After regenerating:

1. Check that the XML is valid: `xmllint --noout docs/assets/diagrams/*.svg`.
2. Open each SVG in a browser on white (`#ffffff`) and on GitHub dark (`#0d1117`) at about 880 px wide, and check that no label overflows its box or overlaps a line.
3. Update the facts only from the code: `configs/mcp_servers.yaml`, `docker-compose.yaml`, `src/mcp-servers/`, `frontend/src/app/api/`, and `frontend/src/lib/mcp/`.
