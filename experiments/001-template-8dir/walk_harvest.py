"""Harvest a walk-cycle (or any animation) strip into keyed frames + an
animated WebP in entity.json texture format (square canvas, centered,
transparent bg).

Reuses harvest_v2's panel auto-detection and gray-safe floodfill keyer.
Cells in the detected panel are FRAMES of one animation, left to right.

  python walk_harvest.py sheet.png --frames 8 -o harvested/walk-S \
      --fps 8 --canvas 256 --row 0

Outputs: <out>/frame-00.png .. + <out>/anim.webp + <out>/anim.gif (preview).
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

from harvest_v2 import find_panels, key_cell


def center_on_canvas(img: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    f = img.copy()
    f.thumbnail((size, size), Image.LANCZOS)
    canvas.paste(f, ((size - f.width) // 2, size - f.height), f)  # feet-anchored
    return canvas


def main():
    p = argparse.ArgumentParser()
    p.add_argument("sheet")
    p.add_argument("--frames", type=int, required=True, help="cells in the strip")
    p.add_argument("--row", type=int, default=0, help="panel index, top to bottom")
    p.add_argument("--skip-ref", type=int, default=0,
                   help="leading cells to skip (e.g. 1 if a reference cell is inside the panel)")
    p.add_argument("--fps", type=float, default=8)
    p.add_argument("--canvas", type=int, default=256, help="entity texture size")
    p.add_argument("-o", "--output", required=True)
    a = p.parse_args()

    rgb = np.asarray(Image.open(a.sheet).convert("RGB"))
    panels = find_panels(rgb)
    if not panels:
        raise SystemExit("no light-gray panel found")
    y0, x0, y1, x1 = panels[a.row]
    total = a.skip_ref + a.frames
    cw = (x1 - x0) // total
    print(f"panel {a.row}: x={x0}..{x1} y={y0}..{y1}; {total} cells of {cw}px")

    outdir = Path(a.output)
    outdir.mkdir(parents=True, exist_ok=True)
    frames = []
    for i in range(a.skip_ref, total):
        cell = rgb[y0:y1, x0 + i * cw: x0 + (i + 1) * cw]
        keyed = Image.fromarray(key_cell(cell), "RGBA")
        framed = center_on_canvas(keyed, a.canvas)
        framed.save(outdir / f"frame-{i - a.skip_ref:02d}.png")
        frames.append(framed)

    dur = round(1000 / a.fps)
    frames[0].save(outdir / "anim.webp", save_all=True, append_images=frames[1:],
                   duration=dur, loop=0, lossless=True)
    # gif preview on a neutral bg (gif alpha is binary; webp is the real artifact)
    bg_frames = []
    for f in frames:
        b = Image.new("RGB", f.size, "#fdf6e3")
        b.paste(f, (0, 0), f)
        bg_frames.append(b)
    bg_frames[0].save(outdir / "anim.gif", save_all=True, append_images=bg_frames[1:],
                      duration=dur, loop=0)
    print(f"{len(frames)} frames → {outdir} (anim.webp {a.fps}fps, entity-ready)")


if __name__ == "__main__":
    main()
