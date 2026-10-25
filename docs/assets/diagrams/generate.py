# ruff: noqa: E501
"""Generate architecture and workflow diagrams (light + dark) from one layout.

Colors come from docs/revamp/design/tokens.css, concept A (final design).
"""

from __future__ import annotations

import sys
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else ".")

THEMES = {
    "light": {
        "canvas": "#f8fbfb",  # --bg
        "canvas_line": "#e2e8ea",  # --line
        "zone": "#f3f6f7",  # --surface-sunken
        "zone_line": "#e2e8ea",  # --line
        "card": "#fcfefe",  # --surface
        "card_line": "#d8e0e2",  # --n-200
        "chip": "#ebf0f2",  # --n-100 (--surface-hover)
        "chip_text": "#3a4547",  # --n-700
        "fg": "#070c0e",  # --fg
        "muted": "#515d60",  # --fg-muted
        "conn": "#828f92",  # --line-strong
        "brand": "#007781",  # --brand
        "brand_text": "#006b74",  # --brand-text
        "brand_subtle": "#def5f8",  # --brand-subtle
        "brand_line": "#50afb9",  # --brand-border
        "brand_fg": "#fcfefe",  # --brand-fg
    },
    "dark": {
        "canvas": "#0d1314",  # --bg
        "canvas_line": "#21292c",  # --line
        "zone": "#131a1b",  # --surface
        "zone_line": "#21292c",  # --line
        "card": "#192123",  # --surface-raised
        "card_line": "#2b3537",  # --n-750 (--surface-active)
        "chip": "#21292c",  # --n-800 (--surface-hover)
        "chip_text": "#c3cccf",  # --n-300
        "fg": "#f8fbfb",  # --fg
        "muted": "#9ba7aa",  # --fg-muted
        "conn": "#6a777a",  # --line-strong
        "brand": "#37d6dd",  # --brand
        "brand_text": "#55dae1",  # --brand-text
        "brand_subtle": "#03343c",  # --brand-subtle
        "brand_line": "#13808a",  # --brand-border
        "brand_fg": "#070c0e",  # --brand-fg
    },
}

SANS = (
    "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', "
    "Helvetica, Arial, sans-serif"
)
MONO = (
    "'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, "
    "'Liberation Mono', monospace"
)

# Radius scale of concept A (--radius: 4px): md 4, lg 6, xl 8
R_ZONE, R_CARD, R_CHIP = 10, 8, 4


def style(t: dict[str, str]) -> str:
    return f"""<style>
.bg{{fill:{t["canvas"]};stroke:{t["canvas_line"]}}}
.zone{{fill:{t["zone"]};stroke:{t["zone_line"]}}}
.card{{fill:{t["card"]};stroke:{t["card_line"]}}}
.card-accent{{fill:{t["brand_subtle"]};stroke:{t["brand_line"]}}}
.chip{{fill:{t["chip"]}}}
.chip-accent{{fill:{t["card"]};stroke:{t["brand_line"]}}}
.rule{{stroke:{t["card_line"]}}}
text{{font-family:{SANS};fill:{t["fg"]}}}
.mono{{font-family:{MONO}}}
.h1{{font-size:24px;font-weight:600;letter-spacing:-0.015em}}
.sub{{font-size:15px;fill:{t["muted"]}}}
.caps{{font-size:12px;font-weight:600;letter-spacing:0.08em;fill:{t["muted"]}}}
.t{{font-size:17px;font-weight:600}}
.tm{{font-size:15.5px;font-weight:600}}
.d{{font-size:14px;fill:{t["muted"]}}}
.dm{{font-size:13.5px;fill:{t["fg"]}}}
.dmm{{font-size:13.5px;fill:{t["muted"]}}}
.c{{font-size:13px;fill:{t["chip_text"]}}}
.ca{{font-size:13px;fill:{t["brand_text"]}}}
.lbl{{font-size:12.5px;fill:{t["muted"]}}}
.lbla{{font-size:12.5px;fill:{t["brand_text"]};font-weight:500}}
.accent{{fill:{t["brand_text"]}}}
.badge{{fill:{t["brand"]}}}
.badge-t{{fill:{t["brand_fg"]};font-size:14px;font-weight:700}}
.w{{fill:none;stroke:{t["conn"]};stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}}
.wa{{fill:none;stroke:{t["brand"]};stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}}
.wd{{stroke-dasharray:5 5}}
.dot{{fill:{t["conn"]}}}
.ph{{fill:none;stroke:{t["conn"]};stroke-dasharray:4 4}}
.chip-dash{{fill:none;stroke:{t["conn"]};stroke-dasharray:3 3}}
.muted{{fill:{t["muted"]}}}
.path{{fill:{t["chip_text"]}}}
.phase{{stroke:{t["card_line"]}}}
.phase-a{{stroke:{t["brand_line"]}}}
.ah{{fill:none;stroke:{t["conn"]};stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}}
.aha{{fill:none;stroke:{t["brand"]};stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}}
</style>"""


def defs() -> str:
    # Open chevron arrowheads, one per connector color.
    return """<defs>
<marker id="ah" viewBox="0 0 12 12" refX="10.5" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path class="ah" d="M4.5 2.5 L10.5 6 L4.5 9.5"/></marker>
<marker id="aha" viewBox="0 0 12 12" refX="10.5" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path class="aha" d="M4.5 2.5 L10.5 6 L4.5 9.5"/></marker>
</defs>"""


# ---------------------------------------------------------------- primitives


def txt(x, y, s, cls, anchor="start", extra=""):
    a = "" if anchor == "start" else f' text-anchor="{anchor}"'
    return f'<text x="{x:g}" y="{y:g}" class="{cls}"{a}{extra}>{escape(s)}</text>'


def rect(x, y, w, h, cls, r=R_CARD):
    return f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="{r}" class="{cls}"/>'


CHAR_W = {"mono13": 7.83, "sans13": 7.25}


def chip_w(s, mono=True, pad=None):
    pad = (10 if mono else 8) if pad is None else pad
    cw = CHAR_W["mono13" if mono else "sans13"]
    return round(len(s) * cw + pad * 2)


def chip(x, y, s, mono=True, accent=False, h=24, dashed=False):
    w = chip_w(s, mono)
    if dashed:
        return (
            rect(x + 0.5, y + 0.5, w - 1, h - 1, "chip-dash", R_CHIP)
            + txt(x + w / 2, y + h / 2 + 4.5, s, "c" + (" mono" if mono else ""), "middle")
        ), w
    cls = "chip-accent" if accent else "chip"
    tcls = ("ca" if accent else "c") + (" mono" if mono else "")
    out = rect(
        x + 0.5 if accent else x,
        y + 0.5 if accent else y,
        w - (1 if accent else 0),
        h - (1 if accent else 0),
        cls,
        R_CHIP,
    )
    out += txt(x + w / 2, y + h / 2 + 4.5, s, tcls, "middle")
    return out, w


def chips(x, y, items, gap=6, mono=True, accent_first=False, dashed_last=False):
    out, cx = [], x
    for i, s in enumerate(items):
        c, w = chip(
            cx, y, s, mono, accent=accent_first and i == 0, dashed=dashed_last and i == len(items) - 1
        )
        out.append(c)
        cx += w + gap
    return "".join(out), cx - gap - x


def path(points, cls="w", r=10, marker="ah", start_marker=None):
    """Orthogonal polyline with rounded corners."""
    d = [f"M{points[0][0]:g} {points[0][1]:g}"]
    for i in range(1, len(points) - 1):
        (x0, y0), (x1, y1), (x2, y2) = points[i - 1], points[i], points[i + 1]
        l1 = abs(x1 - x0) + abs(y1 - y0)
        l2 = abs(x2 - x1) + abs(y2 - y1)
        rr = min(r, l1 / 2, l2 / 2)
        ux0, uy0 = (x1 - x0) / l1, (y1 - y0) / l1
        ux1, uy1 = (x2 - x1) / l2, (y2 - y1) / l2
        p1 = (x1 - ux0 * rr, y1 - uy0 * rr)
        p2 = (x1 + ux1 * rr, y1 + uy1 * rr)
        d.append(f"L{p1[0]:g} {p1[1]:g} Q{x1:g} {y1:g} {p2[0]:g} {p2[1]:g}")
    d.append(f"L{points[-1][0]:g} {points[-1][1]:g}")
    m = f' marker-end="url(#{marker})"' if marker else ""
    if start_marker:
        m += f' marker-start="url(#{start_marker})"'
    return f'<path d="{" ".join(d)}" class="{cls}"{m}/>'


def svg(w, h, title, desc, body, theme):
    t = THEMES[theme]
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
        f'role="img" aria-labelledby="title desc">\n'
        f'<title id="title">{escape(title)}</title>\n<desc id="desc">{escape(desc)}</desc>\n'
        f"{style(t)}\n{defs()}\n"
        f'<rect x="0.5" y="0.5" width="{w - 1}" height="{h - 1}" rx="14" class="bg"/>\n'
        f"{body}\n</svg>\n"
    )


def zone(x, y, w, h, label, path_label=None, pad=24):
    out = rect(x + 0.5, y + 0.5, w - 1, h - 1, "zone", R_ZONE)
    out += txt(x + pad, y + 30, label.upper(), "caps")
    if path_label:
        lw = len(label) * 8.6 + 10
        out += txt(x + pad + lw, y + 30, path_label, "lbl mono")
    return out


def card(x, y, w, h, accent=False):
    return rect(x + 0.5, y + 0.5, w - 1, h - 1, "card-accent" if accent else "card", R_CARD)


# ---------------------------------------------------------------- architecture


def architecture(theme):
    W, _H = 1200, 900
    b = []
    b.append(txt(40, 58, "MCP Connectors architecture", "h1"))
    b.append(
        txt(
            40,
            84,
            "Skills generate servers. The CLI and the Frontend find them in one registry and call them.",
            "sub",
        )
    )

    # Columns
    LX, LW = 40, 436  # servers column (and left part of build strip)
    CX, CW = 548, 372  # clients column
    DX, DW = 968, 192  # external column
    TOP = 112

    # ---- Build strip (over servers + clients)
    sy, sh = TOP, 128
    b.append(zone(LX, sy, CX + CW - LX, sh, "Build with Claude Code skills"))
    cy, ch = sy + 48, 60
    c1 = (LX + 24, 232)
    c2 = (c1[0] + c1[1] + 44, 272)
    c3 = (c2[0] + c2[1] + 44, CX + CW - 24 - (c2[0] + c2[1] + 44))
    # c1 spec writer
    b.append(card(c1[0], cy, c1[1], ch, accent=True))
    b.append(txt(c1[0] + 16, cy + 25, "/mcp-spec-writer", "tm mono accent"))
    b.append(txt(c1[0] + 16, cy + 46, "Interview, 10-section spec", "d"))
    # c2 spec doc
    b.append(card(c2[0], cy, c2[1], ch))
    b.append(txt(c2[0] + 16, cy + 25, "Server spec", "tm"))
    b.append(txt(c2[0] + 16, cy + 46, "docs/mcp-spec/<name>_v0.X.md", "dmm mono"))
    # c3 builder
    b.append(card(c3[0], cy, c3[1], ch, accent=True))
    b.append(txt(c3[0] + 16, cy + 25, "/mcp-server-builder", "tm mono accent"))
    b.append(txt(c3[0] + 16, cy + 46, "Server, tests, registry entry", "d"))
    my = cy + ch / 2
    b.append(path([(c1[0] + c1[1] + 6, my), (c2[0] - 6, my)], "wa", marker="aha"))
    b.append(path([(c2[0] + c2[1] + 6, my), (c3[0] - 6, my)], "wa", marker="aha"))

    # ---- Legend (external column, top)
    b.append(rect(DX + 0.5, sy + 0.5, DW - 1, sh - 1, "zone", R_ZONE))
    b.append(txt(DX + 20, sy + 30, "LEGEND", "caps"))
    ly = sy + 54
    items = [
        ("wa", "aha", "", "Generates, writes"),
        ("w", "ah", "", "Calls at runtime"),
        ("w wd", "ah", "", "Opt-in or optional"),
        ("w", None, "dot", "Joins a path"),
    ]
    for i, (cls, mk, kind, label) in enumerate(items):
        yy = ly + i * 21
        if kind == "dot":
            b.append(path([(DX + 20, yy), (DX + 50, yy)], cls, marker=None))
            b.append(f'<circle cx="{DX + 35}" cy="{yy}" r="3.5" class="dot"/>')
        else:
            b.append(path([(DX + 20, yy), (DX + 50, yy)], cls, marker=mk))
        b.append(txt(DX + 62, yy + 4.5, label, "lbl"))

    # ---- Lower zones
    ZY = 296
    # Servers zone
    sx, sw = LX, LW
    ix, iw = sx + 24, sw - 48
    y = ZY + 48
    srv = []
    # _common first: generated on the first builder run, imported by every server
    com_h = 104
    srv.append(card(ix, y, iw, com_h))
    srv.append(txt(ix + 16, y + 27, "_common/", "tm mono"))
    srv.append(txt(ix + 16 + 84, y + 27, "Shared modules, used by every server", "d"))
    mods = ["auth", "cors", "env", "errors", "logging", "masking", "retry", "trust"]
    c, _ = chips(ix + 16, y + 42, mods[:4])
    srv.append(c)
    c, _ = chips(ix + 16, y + 72, mods[4:])
    srv.append(c)
    y += com_h + 16

    def server(y, name, desc, transports, h=82, extra=None):
        o = [card(ix, y, iw, h)]
        o.append(txt(ix + 16, y + 27, name, "tm mono"))
        tw = sum(chip_w(s) for s in transports) + 6 * (len(transports) - 1)
        c, _ = chips(ix + iw - 16 - tw, y + 11, transports)
        o.append(c)
        o.append(txt(ix + 16, y + 50, desc, "d"))
        if extra:
            o.append(extra(y))
        return "".join(o), h

    s, h = server(
        y, "starter_mcp", "Canonical starter and regression baseline", ["stdio", "HTTP :8001"], h=70
    )
    srv.append(s)
    y += h + 16
    s, h = server(y, "mock_repo_mcp", "Code repository baseline on fixtures", ["HTTP :8002"], h=70)
    srv.append(s)
    y += h + 16

    def nl2sql_extra(yy):
        o = [txt(ix + 16, yy + 84, "DB", "lbl")]
        c, _ = chips(
            ix + 42,
            yy + 67,
            ["Mock (default)", "PostgreSQL + Pagila", "Oracle"],
            mono=False,
            dashed_last=True,
        )
        o.append(c)
        return "".join(o)

    s, h = server(
        y,
        "nl2sql_mcp",
        "Natural language to SQL with guardrails",
        ["stdio", "HTTP :8004"],
        h=106,
        extra=nl2sql_extra,
    )
    srv.append(s)
    y += h
    zone_h = y + 24 - ZY

    # Clients zone
    kx, kw = CX, CW
    jx, jw = kx + 24, kw - 48
    cl = []
    yy = ZY + 48
    reg_y, reg_h = yy, 60
    cl.append(card(jx, reg_y, jw, reg_h))
    cl.append(txt(jx + 16, reg_y + 25, "Server registry", "tm"))
    cl.append(txt(jx + 16, reg_y + 46, "configs/mcp_servers.yaml", "dmm mono"))
    cli_y, cli_h = reg_y + reg_h + 40, 104
    cl.append(card(jx, cli_y, jw, cli_h))
    cl.append(txt(jx + 16, cli_y + 27, "CLI", "t"))
    cl.append(txt(jx + 52, cli_y + 27, "scripts/mcp_cli.py", "dmm mono"))
    c, _ = chips(jx + 16, cli_y + 44, ["list-tools", "call", "test"])
    cl.append(c)
    cl.append(txt(jx + 16, cli_y + 90, "test replays scenario YAML files", "lbl"))
    fe_y = cli_y + cli_h + 28
    rows_y0 = fe_y + 162
    row_gap = 40
    fe_h = rows_y0 + 2 * row_gap + 26 - fe_y
    cl.append(card(jx, fe_y, jw, fe_h))
    cl.append(txt(jx + 16, fe_y + 28, "Frontend", "t"))
    cl.append(txt(jx + 98, fe_y + 28, "Next.js", "d"))
    cl.append(txt(jx + 16, fe_y + 56, "PAGES", "caps"))
    c, _ = chips(jx + 16, fe_y + 66, ["Dashboard", "Inspector", "Chat", "Settings"], mono=False)
    cl.append(c)
    cl.append(
        f'<line x1="{jx + 16}" y1="{fe_y + 106.5}" x2="{jx + jw - 16}" y2="{fe_y + 106.5}" class="rule"/>'
    )
    cl.append(txt(jx + 16, fe_y + 134, "SERVER ROUTES", "caps"))
    routes = [
        ("/api/mcp/[server]", "Proxy, adds the API key"),
        ("/api/mcp-runtime", "Runtime proxy, opt-in"),
        ("/api/chat", "LLM tool-use loop"),
    ]
    for i, (r_, d_) in enumerate(routes):
        ry = rows_y0 + i * row_gap
        cl.append(txt(jx + 16, ry + 5, r_, "dm mono"))
        cl.append(txt(jx + jw - 16, ry + 5, d_, "lbl", "end"))
    r1, r2, r3 = rows_y0, rows_y0 + row_gap, rows_y0 + 2 * row_gap

    # External column (lower part): LLM card centered on /api/chat, runtime card below
    ex_ix, ex_iw = DX, DW
    rt_y, rt_h = ZY + 48, 112
    llm_y, llm_h = r3 - 40, 80
    bottom = max(y + 24, fe_y + fe_h + 24, llm_y + llm_h + 16)

    # placeholder for the next server, fills the servers column
    ph_y = y + 16
    ph_h = min(bottom - 24 - ph_y, 66)
    if ph_h >= 56:
        srv.append(
            f'<rect x="{ix + 0.5:g}" y="{ph_y + 0.5:g}" width="{iw - 1:g}" height="{ph_h - 1:g}" '
            f'rx="{R_CARD}" class="ph"/>'
        )
        srv.append(txt(ix + 16, ph_y + 27, "<your_server>/", "tm mono muted"))
        srv.append(txt(ix + 16, ph_y + 49, "Next server, generated from its spec", "d"))

    zone_h = bottom - ZY
    b.append(zone(sx, ZY, sw, zone_h, "MCP servers", "src/mcp-servers/"))
    b.extend(srv)
    b.append(zone(kx, ZY, kw, zone_h, "Clients"))
    b.extend(cl)

    b.append(txt(DX + 4, ZY + 30, "EXTERNAL", "caps"))
    b.append(card(ex_ix, llm_y, ex_iw, llm_h))
    b.append(txt(ex_ix + 16, llm_y + 25, "LLM providers", "tm"))
    for i, p in enumerate(["Anthropic, OpenAI,", "and OpenRouter"]):
        b.append(txt(ex_ix + 16, llm_y + 48 + i * 19, p, "d"))
    b.append(card(ex_ix, rt_y, ex_iw, rt_h))
    b.append(txt(ex_ix + 16, rt_y + 25, "Runtime servers", "tm"))
    b.append(txt(ex_ix + 16, rt_y + 48, "Added in the UI,", "d"))
    b.append(txt(ex_ix + 16, rt_y + 67, "session only", "d"))
    b.append(txt(ex_ix + 16, rt_y + 90, "Browser direct", "lbl"))
    b.append(txt(ex_ix + 16, rt_y + 106, "or opt-in proxy", "lbl"))

    # ---- Connectors
    # generates: builder -> servers zone (elbow through the gap)
    gx0 = c3[0] + 40
    gy = sy + sh + 28
    b.append(
        path(
            [(gx0, cy + ch + 6), (gx0, gy), (LX + LW / 2, gy), (LX + LW / 2, ZY - 6)], "wa", marker="aha"
        )
    )
    b.append(txt((LX + LW / 2 + gx0) / 2, gy - 8, "generates the server package", "lbla", "middle"))
    # adds entry: builder -> registry (straight down)
    ax = c3[0] + c3[1] - 56
    b.append(path([(ax, cy + ch + 6), (ax, reg_y - 6)], "wa", marker="aha"))
    b.append(txt(ax + 10, gy - 8, "adds entry", "lbla"))
    # registry -> CLI (reads)
    rx = jx + 40
    b.append(path([(rx, reg_y + reg_h + 4), (rx, cli_y - 6)], "w", marker="ah"))
    b.append(txt(rx + 10, reg_y + reg_h + 24, "reads", "lbl"))
    # registry -> Frontend (right lane through the clients/external gap)
    lane = kx + kw + 18
    b.append(
        path(
            [
                (jx + jw + 2, reg_y + reg_h / 2),
                (lane, reg_y + reg_h / 2),
                (lane, fe_y + 24),
                (jx + jw + 6, fe_y + 24),
            ],
            "w",
            marker="ah",
        )
    )
    # CLI -> servers
    cy_mid = cli_y + 56
    b.append(path([(jx - 2, cy_mid), (sx + sw + 6, cy_mid)], "w", marker="ah"))
    b.append(txt((jx + sx + sw) / 2, cy_mid - 9, "stdio, HTTP", "lbl", "middle"))
    # /api/mcp/[server] and /api/chat -> servers (HTTP, key attached server side)
    b.append(path([(jx - 2, r1), (sx + sw + 6, r1)], "w", marker="ah"))
    b.append(txt((jx + sx + sw) / 2, r1 - 9, "HTTP", "lbl", "middle"))
    jx_mid = (jx + sx + sw) / 2
    b.append(path([(jx - 2, r3), (jx_mid, r3), (jx_mid, r1)], "w", marker=None, r=8))
    b.append(f'<circle cx="{jx_mid:g}" cy="{r1:g}" r="3.5" class="dot"/>')
    # /api/chat -> LLM providers
    b.append(path([(jx + jw + 2, r3), (ex_ix - 6, r3)], "w", marker="ah"))
    # /api/mcp-runtime -> runtime servers (opt-in)
    rt_mid = rt_y + 25 - 5
    bend = kx + kw + 32
    b.append(
        path([(jx + jw + 2, r2), (bend, r2), (bend, rt_mid), (ex_ix - 6, rt_mid)], "w wd", marker="ah")
    )

    desc = (
        "Claude Code skills /mcp-spec-writer and /mcp-server-builder generate MCP servers under "
        "src/mcp-servers (starter_mcp, mock_repo_mcp, nl2sql_mcp) on shared _common modules, and "
        "add entries to configs/mcp_servers.yaml. The CLI and the Next.js Frontend read that registry. "
        "The Frontend reaches registered servers through /api/mcp/[server], runs Chat through /api/chat "
        "with LLM providers, and reaches runtime servers directly or through the opt-in /api/mcp-runtime."
    )
    return svg(W, bottom + 40, "MCP Connectors architecture", desc, "\n".join(b), theme)


# ---------------------------------------------------------------- workflow


def workflow(theme):
    W = 1200
    b = []
    b.append(txt(40, 58, "Adding a server", "h1"))
    b.append(
        txt(
            40,
            84,
            "From a spec to a server that passes its tests and works in the CLI, Inspector, and Chat.",
            "sub",
        )
    )
    widths = [190, 262, 184, 170, 186]
    gap = (W - 80 - sum(widths)) / 4
    top, ch = 168, 296
    steps = [
        (
            "Spec",
            "Describe the system",
            "/mcp-spec-writer",
            True,
            "Writes",
            [
                ("docs/mcp-spec/", "p"),
                ("<name>_v0.X.md", "p"),
                ("", None),
                ("10 sections from", "d"),
                ("a short interview", "d"),
            ],
        ),
        (
            "Implement",
            "Generate the server",
            "/mcp-server-builder",
            True,
            "Writes",
            [
                ("src/mcp-servers/<name>/", "p"),
                ("tests/<name>/", "p"),
                ("tests/scenarios/<name>.yaml", "p"),
                ("configs/mcp_servers.yaml", "p"),
                ("Makefile targets", "d"),
            ],
        ),
        (
            "Test",
            "Run the regression",
            "make test-<name>",
            False,
            "Runs",
            [
                ("pytest on", "d"),
                ("tests/<name>/", "p"),
                ("", None),
                ("mcp_cli.py test", "p"),
                ("on scenario YAML", "d"),
            ],
        ),
        (
            "CLI check",
            "Call one tool",
            "mcp_cli.py call",
            False,
            "Checks",
            [("--server --tool", "p"), ("--params", "p"), ("", None), ("Over stdio or HTTP", "d")],
        ),
        (
            "Visual check",
            "See it in the UI",
            "make frontend-dev",
            False,
            "Checks",
            [
                ("Inspector", "s"),
                ("Tools, resources,", "d"),
                ("and prompts", "d"),
                ("", None),
                ("Chat", "s"),
                ("LLM tool-use loop", "d"),
            ],
        ),
    ]
    xs = []
    x = 40
    for w in widths:
        xs.append(x)
        x += w + gap

    # phase headers
    def phase(i0, i1, label, accent):
        x0, x1 = xs[i0], xs[i1] + widths[i1]
        o = txt(x0 + 2, 132, label.upper(), "caps" + (" accent" if accent else ""))
        o += (
            f'<line x1="{x0}" y1="146.5" x2="{x1}" y2="146.5" '
            f'class="{"phase-a" if accent else "phase"}"/>'
        )
        return o

    b.append(phase(0, 1, "Author with Claude Code skills", True))
    b.append(phase(2, 4, "Verify locally", False))

    for i, (title, purpose, cmd, skill, head, lines) in enumerate(steps):
        x, w = xs[i], widths[i]
        b.append(card(x, top, w, ch))
        b.append(f'<circle cx="{x + 30}" cy="{top + 32}" r="13" class="badge"/>')
        b.append(txt(x + 30, top + 37, str(i + 1), "badge-t", "middle"))
        b.append(txt(x + 52, top + 38, title, "t"))
        b.append(txt(x + 18, top + 68, purpose, "d"))
        c, _ = chip(x + 18, top + 84, cmd, mono=True, accent=skill)
        b.append(c)
        b.append(
            f'<line x1="{x + 18}" y1="{top + 128.5}" x2="{x + w - 18}" y2="{top + 128.5}" class="rule"/>'
        )
        b.append(txt(x + 18, top + 156, head.upper(), "caps"))
        ly = top + 182
        for s_, kind in lines:
            if kind is None:
                ly += 10
                continue
            cls = {"p": "dm mono path", "d": "d", "s": "tm"}[kind]
            b.append(txt(x + 18, ly, s_, cls))
            ly += 22
    # step arrows, centered on the badge row
    for i in range(4):
        x0 = xs[i] + widths[i]
        x1 = xs[i + 1]
        b.append(path([(x0 + 6, top + 32), (x1 - 6, top + 32)], "wa", marker="aha"))

    # loop back: Inspector history -> scenario YAML -> mcp_cli.py test
    lx0 = xs[4] + widths[4] / 2
    lx1 = xs[2] + widths[2] / 2
    ly = top + ch + 36
    b.append(
        path([(lx0, top + ch + 6), (lx0, ly), (lx1, ly), (lx1, top + ch + 6)], "w wd", marker="ah", r=12)
    )
    mx = (lx0 + lx1) / 2
    b.append(
        txt(
            mx,
            ly + 26,
            "Export Inspector History as scenario YAML, then replay it with mcp_cli.py test",
            "lbl",
            "middle",
        )
    )
    H = ly + 60
    desc = (
        "Five steps: 1 write the spec with /mcp-spec-writer, 2 implement with /mcp-server-builder "
        "(server package, tests, scenario YAML, registry entry, Makefile targets), 3 run make test-<name> "
        "and mcp_cli.py test, 4 call one tool with mcp_cli.py call, 5 check it in Inspector and Chat. "
        "Inspector History can be exported as scenario YAML and replayed with mcp_cli.py test."
    )
    return svg(W, H, "Adding a server", desc, "\n".join(b), theme)


for theme in ("light", "dark"):
    (OUT / f"architecture-{theme}.svg").write_text(architecture(theme))
    (OUT / f"workflow-{theme}.svg").write_text(workflow(theme))
print("ok")
