"""P6-2 capture post-processing: optimize PNG screenshots and assemble demo GIFs.

Called by p6_capture.mjs. Can also be run alone on an existing raw folder:

    uv run --no-project --with pillow python docs/revamp/scripts/p6_capture_post.py \
        --raw <raw dir> --shots docs/assets/screenshots --demo docs/assets/demo

Screenshots: quantized to a 256 color palette without dithering (crisp UI text). If a file is still over
--max-png-kb, it is downscaled to 1x (1440 px wide) and quantized again.
GIFs: frames from frames.json, identical neighbours merged, long waits shortened (--max-hold), one shared
palette so unchanged regions stay unchanged between frames, then resized to --gif-width.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageChops


def quantize(img: Image.Image, colors: int = 256) -> Image.Image:
    return img.convert("RGB").quantize(
        colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE
    )


def optimize_png(src: Path, dst: Path, max_kb: int) -> None:
    img = Image.open(src).convert("RGB")
    for attempt in range(3):
        q = quantize(img)
        q.save(dst, optimize=True)
        kb = dst.stat().st_size / 1024
        if kb <= max_kb:
            break
        # Too big: drop to 1x width, then fewer colors.
        if attempt == 0 and img.width > 1440:
            img = img.resize((img.width // 2, img.height // 2), Image.Resampling.LANCZOS)
        else:
            q = quantize(img, 128)
            q.save(dst, optimize=True)
            break
    print(f"png {dst.name}: {img.width}x{img.height}, {dst.stat().st_size / 1024:.0f} KB")


def build_gif(
    frames_dir: Path, dst: Path, width: int, fps: float, max_hold: float, colors: int = 128
) -> float:
    meta = json.loads((frames_dir / "frames.json").read_text())
    frames = meta["frames"]
    end = meta["end"]
    step_ms = 1000 / fps
    picked: list[tuple[Image.Image, float]] = []
    last_t = None
    for i, f in enumerate(frames):
        t = f["t"]
        nxt = frames[i + 1]["t"] if i + 1 < len(frames) else end
        if last_t is not None and t - last_t < step_ms and i + 1 < len(frames):
            # Too close to the previous kept frame: extend the previous one instead.
            img, d = picked[-1]
            picked[-1] = (img, d + (nxt - t))
            continue
        img = Image.open(frames_dir / f["file"]).convert("RGB")
        if picked and ImageChops.difference(img, picked[-1][0]).getbbox() is None:
            prev, d = picked[-1]
            picked[-1] = (prev, d + (nxt - t))
        else:
            picked.append((img, nxt - t))
        last_t = t
    # Shorten long waits (LLM latency) except the final hold.
    out = [
        (img, min(d, max_hold * 1000) if i < len(picked) - 1 else d) for i, (img, d) in enumerate(picked)
    ]
    if width and out[0][0].width != width:
        h = round(out[0][0].height * width / out[0][0].width)
        out = [(img.resize((width, h), Image.Resampling.LANCZOS), d) for img, d in out]
    # Shared palette from a strip of sampled frames.
    sample = [img for img, _ in out[:: max(1, len(out) // 8)]]
    strip = Image.new("RGB", (sample[0].width, sample[0].height * len(sample)))
    for k, img in enumerate(sample):
        strip.paste(img, (0, k * img.height))
    pal = strip.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    q = [img.quantize(palette=pal, dither=Image.Dither.NONE) for img, _ in out]
    durations = [max(20, round(d / 10) * 10) for _, d in out]
    q[0].save(
        dst, save_all=True, append_images=q[1:], duration=durations, loop=0, optimize=True, disposal=1
    )
    total = sum(durations) / 1000
    kb = dst.stat().st_size / 1024
    size = f"{q[0].width}x{q[0].height}"
    print(f"gif {dst.name}: {size}, {len(q)} frames, {total:.1f} s, {colors} colors, {kb:.0f} KB")
    return kb


# Settings tried in order until the GIF fits --max-gif-kb: (fps, colors, width factor).
GIF_LADDER = [(8, 128, 1.0), (6, 96, 1.0), (6, 64, 1.0), (5, 64, 0.9), (5, 48, 0.8)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True, type=Path)
    ap.add_argument("--shots", required=True, type=Path)
    ap.add_argument("--demo", required=True, type=Path)
    ap.add_argument("--max-png-kb", type=int, default=400)
    ap.add_argument("--gif-width", type=int, default=1200)
    ap.add_argument("--max-gif-kb", type=int, default=480)
    ap.add_argument("--max-hold", type=float, default=1.2)
    a = ap.parse_args()
    a.shots.mkdir(parents=True, exist_ok=True)
    a.demo.mkdir(parents=True, exist_ok=True)
    for src in sorted((a.raw / "shots").glob("*.png")):
        optimize_png(src, a.shots / src.name, a.max_png_kb)
    for d in sorted((a.raw / "gifs").iterdir()) if (a.raw / "gifs").exists() else []:
        if (d / "frames.json").exists():
            for fps, colors, factor in GIF_LADDER:
                kb = build_gif(
                    d, a.demo / f"{d.name}.gif", round(a.gif_width * factor), fps, a.max_hold, colors
                )
                if kb <= a.max_gif_kb:
                    break


if __name__ == "__main__":
    main()
