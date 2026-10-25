#!/usr/bin/env python3
"""tokens.css WCAG contrast checker (standard library only).

Reads docs/revamp/design/tokens.css, resolves the custom properties for every
concept (a, b, c) and theme (light, dark), converts oklch to sRGB and checks
WCAG 2.x contrast ratios for the pairs that the UI actually renders.

Usage:
    python3 docs/revamp/design/scripts/check_contrast.py            # text report
    python3 docs/revamp/design/scripts/check_contrast.py --markdown # tables for tokens.md
    python3 docs/revamp/design/scripts/check_contrast.py --hex      # resolved hex per token

Exit code is 1 when a required pair fails or when the system-dark values differ
from the explicit data-theme="dark" values.
"""

from __future__ import annotations

import argparse
import ast
import math
import operator
import re
import sys
from dataclasses import dataclass
from pathlib import Path

TOKENS = Path(__file__).resolve().parent.parent / "tokens.css"
CONCEPTS = {"a": "A Console", "b": "B Studio", "c": "C Workbench"}

# (foreground token, background token, minimum ratio, group label)
TEXT = 4.5
UI = 3.0
PAIRS: list[tuple[str, str, float, str]] = [
    # body text
    *[
        ("--fg", bg, TEXT, "본문")
        for bg in (
            "--bg",
            "--bg-subtle",
            "--surface",
            "--surface-raised",
            "--surface-sunken",
            "--surface-hover",
            "--surface-active",
        )
    ],
    *[
        ("--fg-muted", bg, TEXT, "보조 텍스트")
        for bg in ("--bg", "--bg-subtle", "--surface", "--surface-sunken", "--surface-hover")
    ],
    ("--fg-on-inverse", "--inverse", TEXT, "본문"),
    # icons, disabled, large text only
    ("--fg-subtle", "--bg", UI, "아이콘/큰 텍스트"),
    ("--fg-subtle", "--surface", UI, "아이콘/큰 텍스트"),
    # UI boundaries
    ("--line-strong", "--bg", UI, "UI 경계"),
    ("--line-strong", "--surface", UI, "UI 경계"),
    ("--line-strong", "--surface-sunken", UI, "UI 경계"),
    ("--focus-ring", "--bg", UI, "UI 경계"),
    ("--focus-ring", "--surface", UI, "UI 경계"),
    ("--focus-ring", "--bg-subtle", UI, "UI 경계"),
    # brand
    ("--brand-fg", "--brand", TEXT, "브랜드"),
    ("--brand-fg", "--brand-hover", TEXT, "브랜드"),
    ("--brand-text", "--bg", TEXT, "브랜드"),
    ("--brand-text", "--surface", TEXT, "브랜드"),
    ("--brand-text", "--bg-subtle", TEXT, "브랜드"),
    ("--brand-text", "--brand-subtle", TEXT, "브랜드"),
    ("--fg", "--brand-subtle", TEXT, "브랜드"),
    ("--fg", "--selection", TEXT, "브랜드"),
    # charts (graphical objects)
    *[(f"--chart-{i}", "--surface", UI, "차트") for i in range(1, 7)],
    # trace spans (waterfall bars, kind squares). Bars sit on --surface and
    # on the trace column (--surface-sunken, --bg-subtle); the kind square
    # draws its icon in --surface on top of the span color.
    *[
        (f"--span-{k}", bg, UI, "트레이스 스팬")
        for k in ("llm", "tool", "guard", "proxy", "err", "wait")
        for bg in ("--surface", "--surface-sunken", "--bg-subtle")
    ],
    *[
        ("--surface", f"--span-{k}", UI, "트레이스 스팬")
        for k in ("llm", "tool", "guard", "proxy", "err", "wait")
    ],
    # JSON syntax
    *[
        (f"--syntax-{k}", bg, TEXT, "JSON 구문")
        for k in ("key", "string", "number", "boolean", "null", "punct")
        for bg in ("--surface-sunken", "--surface")
    ],
    # log levels
    *[
        (f"--log-{k}", "--surface-sunken", TEXT, "로그")
        for k in ("debug", "info", "warn", "error", "request", "response")
    ],
]
for _s in ("success", "warning", "danger", "info"):
    PAIRS += [
        (f"--{_s}-fg", f"--{_s}-bg", TEXT, "의미 색 텍스트"),
        (f"--{_s}-fg", "--bg", TEXT, "의미 색 텍스트"),
        (f"--{_s}-fg", "--surface", TEXT, "의미 색 텍스트"),
        (f"--{_s}-solid-fg", f"--{_s}-solid", TEXT, "의미 색 텍스트"),
        (f"--{_s}-border", "--bg", UI, "의미 색 경계/점"),
        (f"--{_s}-border", "--surface", UI, "의미 색 경계/점"),
        (f"--{_s}-solid", "--bg", UI, "의미 색 경계/점"),
    ]

# Reported but not failing: brand solid as a button fill. WCAG 1.4.11 does not
# require a boundary when the button is identified by its text label.
ADVISORY: list[tuple[str, str, float, str]] = [
    ("--brand", "--bg", UI, "버튼 면(참고)"),
    ("--brand", "--surface", UI, "버튼 면(참고)"),
]


# ---------------------------------------------------------------- CSS parsing
@dataclass
class Rule:
    selector: str
    media: str | None
    decls: dict[str, str]
    order: int


def parse_css(text: str) -> list[Rule]:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    rules: list[Rule] = []
    order = 0

    def parse_block(body: str, media: str | None) -> None:
        nonlocal order
        i = 0
        while i < len(body):
            brace = body.find("{", i)
            if brace == -1:
                break
            head = body[i:brace].strip()
            depth, j = 1, brace + 1
            while depth and j < len(body):
                depth += {"{": 1, "}": -1}.get(body[j], 0)
                j += 1
            inner = body[brace + 1 : j - 1]
            if head.startswith("@media"):
                parse_block(inner, head[len("@media") :].strip())
            else:
                decls = {}
                for part in inner.split(";"):
                    if ":" in part:
                        k, v = part.split(":", 1)
                        if k.strip().startswith("--"):
                            decls[k.strip()] = " ".join(v.split())
                for sel in head.split(","):
                    rules.append(Rule(sel.strip(), media, decls, order))
                order += 1
            i = j

    parse_block(text, None)
    return rules


SEL_ROOT = re.compile(r"^:root((?:\[[^\]]+\]|:not\(\[[^\]]+\]\))*)$")
COND = re.compile(r'(:not\()?\[([\w-]+)(?:="([^"]*)")?\]\)?')


def match(rule: Rule, ctx: dict[str, str | None]) -> int | None:
    """Return specificity if the rule applies to the context, else None."""
    if rule.media:
        m = re.search(r"prefers-color-scheme:\s*(\w+)", rule.media)
        if not m or m.group(1) != ctx["prefers"]:
            return None
    m = SEL_ROOT.match(rule.selector)
    if not m:
        return None
    spec = 1
    for neg, attr, val in COND.findall(m.group(1)):
        actual = ctx.get(attr.replace("data-", ""))
        ok = actual == val if val else actual is not None
        if bool(neg) == ok:
            return None
        spec += 1
    return spec


def cascade(rules: list[Rule], ctx: dict[str, str | None]) -> dict[str, str]:
    winners: dict[str, tuple[int, int, str]] = {}
    for r in rules:
        spec = match(r, ctx)
        if spec is None:
            continue
        for k, v in r.decls.items():
            if k not in winners or (spec, r.order) >= winners[k][:2]:
                winners[k] = (spec, r.order, v)
    return {k: v[2] for k, v in winners.items()}


_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}


def _arith(node: ast.AST) -> float:
    """Evaluate +, -, *, / on numbers only (enough for calc() in tokens.css)."""
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -_arith(node.operand)
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_arith(node.left), _arith(node.right))
    raise ValueError("unsupported calc expression")


def resolve(name: str, props: dict[str, str], depth: int = 0) -> str:
    if depth > 20:
        raise ValueError(f"var() cycle at {name}")
    value = props[name]

    def sub(m: re.Match[str]) -> str:
        return resolve(m.group(1), props, depth + 1)

    while "var(" in value:
        value = re.sub(r"var\((--[\w-]+)\)", sub, value)

    def calc(m: re.Match[str]) -> str:
        expr = m.group(1)
        if not re.fullmatch(r"[\d.\s+\-*/()]+", expr):
            raise ValueError(f"unsupported calc: {expr}")
        return repr(_arith(ast.parse(expr, mode="eval").body))

    while "calc(" in value:
        value = re.sub(r"calc\(([^()]*)\)", calc, value)
    return value


def is_solid_color(name: str, props: dict[str, str]) -> bool:
    try:
        v = resolve(name, props)
    except ValueError:
        return False
    return v.startswith("oklch(") and "/" not in v


# ------------------------------------------------------------- color math
def oklch_to_linear_srgb(L: float, C: float, H: float) -> tuple[float, float, float]:
    a = C * math.cos(math.radians(H))
    b = C * math.sin(math.radians(H))
    l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_,
    )


def in_gamut(rgb: tuple[float, float, float]) -> bool:
    return all(-1e-4 <= c <= 1 + 1e-4 for c in rgb)


def to_linear_rgb(color: str, clip: bool = False) -> tuple[tuple[float, float, float], bool]:
    """Parse oklch() and map into sRGB.

    clip=False reduces chroma at constant L and H (CSS Color 4 gamut mapping),
    clip=True clamps each channel (what some browsers do on sRGB screens).
    The checker evaluates both and keeps the worse ratio.
    """
    m = re.fullmatch(r"oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.\-]+)\s*(?:/\s*[\d.]+%?)?\s*\)", color)
    if not m:
        raise ValueError(f"not an oklch color: {color}")
    L = float(m.group(1)) / (100 if m.group(2) else 1)
    C, H = float(m.group(3)), float(m.group(4))
    rgb = oklch_to_linear_srgb(L, C, H)
    if in_gamut(rgb) or clip:
        return tuple(min(1.0, max(0.0, c)) for c in rgb), not in_gamut(rgb)
    lo, hi = 0.0, C
    for _ in range(30):
        mid = (lo + hi) / 2
        if in_gamut(oklch_to_linear_srgb(L, mid, H)):
            lo = mid
        else:
            hi = mid
    return tuple(min(1.0, max(0.0, c)) for c in oklch_to_linear_srgb(L, lo, H)), True


def luminance(rgb: tuple[float, float, float]) -> float:
    r, g, b = (min(1.0, max(0.0, c)) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def to_hex(rgb: tuple[float, float, float]) -> str:
    def enc(c: float) -> int:
        c = min(1.0, max(0.0, c))
        v = 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
        return round(v * 255)

    return "#" + "".join(f"{enc(c):02x}" for c in rgb)


def ratio(a: float, b: float) -> float:
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


# ------------------------------------------------------------------- main
def contexts():
    for c in CONCEPTS:
        yield c, "light", {"concept": c, "theme": "light", "prefers": "light"}
        yield c, "dark", {"concept": c, "theme": "dark", "prefers": "light"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--markdown", action="store_true")
    ap.add_argument("--hex", action="store_true")
    args = ap.parse_args()

    rules = parse_css(TOKENS.read_text(encoding="utf-8"))
    results = []  # (concept, theme, fg, bg, need, ratio, group, required)
    problems: list[str] = []
    hex_table: dict[tuple[str, str], dict[str, str]] = {}

    for concept, theme, ctx in contexts():
        props = cascade(rules, ctx)
        colors: dict[tuple[str, bool], tuple[float, float, float]] = {}

        def col(name: str, clip: bool = False, colors=colors, props=props) -> tuple[float, float, float]:
            if (name, clip) not in colors:
                colors[(name, clip)] = to_linear_rgb(resolve(name, props), clip)[0]
            return colors[(name, clip)]

        for fg, bg, need, group in PAIRS + ADVISORY:
            r = min(
                ratio(luminance(col(fg, cf)), luminance(col(bg, cb)))
                for cf in (False, True)
                for cb in (False, True)
            )
            results.append((concept, theme, fg, bg, need, r, group, (fg, bg, need, group) in PAIRS))

        hex_table[(concept, theme)] = {k: to_hex(col(k)) for k in props if is_solid_color(k, props)}

        if theme == "dark":  # system dark must equal explicit dark
            sys_props = cascade(rules, {"concept": concept, "theme": None, "prefers": "dark"})
            for k in props:
                if is_solid_color(k, props) and resolve(k, props) != resolve(k, sys_props):
                    problems.append(f"{concept}: system-dark differs from data-theme=dark for {k}")

    fails = [r for r in results if r[7] and r[5] < r[4]]

    if args.hex:
        names = sorted({k for t in hex_table.values() for k in t})
        print("| token | " + " | ".join(f"{c}/{t}" for c, t in hex_table) + " |")
        print("|---" * (len(hex_table) + 1) + "|")
        for n in names:
            print(f"| `{n}` | " + " | ".join(hex_table[k].get(n, "") for k in hex_table) + " |")
    elif args.markdown:
        print("| 시안 | 테마 | 필수 검사 | 미달 | 최소 대비(본문 4.5 기준) | 최소 대비(UI 3.0 기준) |")
        print("|---|---|---:|---:|---|---|")
        for concept, theme, _ in contexts():
            rows = [r for r in results if r[0] == concept and r[1] == theme and r[7]]
            t = min((r for r in rows if r[4] == TEXT), key=lambda r: r[5])
            u = min((r for r in rows if r[4] == UI), key=lambda r: r[5])
            nf = sum(1 for r in rows if r[5] < r[4])
            print(
                f"| {CONCEPTS[concept]} | {theme} | {len(rows)} | {nf} | "
                f"{t[5]:.2f} (`{t[2]}` / `{t[3]}`) | {u[5]:.2f} (`{u[2]}` / `{u[3]}`) |"
            )
        print()
        groups = list(dict.fromkeys(r[6] for r in results))
        print("| 검사 그룹 | 기준 | " + " | ".join(f"{c.upper()} {t}" for c, t, _ in contexts()) + " |")
        print("|---|---:|" + "---:|" * 6)
        for g in groups:
            need = next(r[4] for r in results if r[6] == g)
            cells = []
            for concept, theme, _ in contexts():
                rs = [r[5] for r in results if r[6] == g and r[0] == concept and r[1] == theme]
                cells.append(f"{min(rs):.2f}")
            print(f"| {g} | {need} | " + " | ".join(cells) + " |")
    else:
        for concept, theme, _ in contexts():
            rows = [r for r in results if r[0] == concept and r[1] == theme]
            print(f"== {CONCEPTS[concept]} / {theme}")
            for _, _, fg, bg, need, r, group, req in rows:
                flag = "ok " if r >= need else ("FAIL" if req else "adv")
                print(f"  {flag} {r:5.2f} >= {need:<3} {fg} on {bg} ({group})")
        print(f"\nrequired pairs: {sum(1 for r in results if r[7])}, failures: {len(fails)}")

    for p in problems:
        print(p, file=sys.stderr)
    return 1 if fails or any(not p.startswith("[info]") for p in problems) else 0


if __name__ == "__main__":
    sys.exit(main())
