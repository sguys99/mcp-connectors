#!/usr/bin/env python3
"""Inline tokens.css into an HTML file between the @tokens markers.

Usage:
    python3 docs/revamp/design/scripts/inline_tokens.py docs/revamp/design/tokens.html [more.html ...]

The HTML must contain, inside its <style>:
    /* @tokens:start ... */
    /* @tokens:end */
Everything between the two markers is replaced with the current tokens.css.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

TOKENS = Path(__file__).resolve().parent.parent / "tokens.css"
PATTERN = re.compile(r"(/\* @tokens:start[^*]*\*/\n).*?(/\* @tokens:end \*/)", re.S)


def main(paths: list[str]) -> int:
    css = TOKENS.read_text(encoding="utf-8").rstrip() + "\n"
    for p in paths:
        path = Path(p)
        html = path.read_text(encoding="utf-8")
        new, n = PATTERN.subn(lambda m: m.group(1) + css + m.group(2), html)
        if n != 1:
            print(f"{p}: expected one @tokens block, found {n}", file=sys.stderr)
            return 1
        path.write_text(new, encoding="utf-8")
        print(f"{p}: inlined {len(css.splitlines())} lines")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
