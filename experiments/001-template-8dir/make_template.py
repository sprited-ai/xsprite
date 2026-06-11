"""Template compositor for exp 001 — NBP 8-direction fill (Jin's spec 2026-06-11).

Layout (1024x1024, no labels — NBP infers the mapping from the example block):

    [ example ][W ][S ][N ][E ]      refs span 2 rows: 208x512
    [   ref   ][NW][SW][SE][NE]      dir patches:      204x256
    [  input  ][W ][S ][N ][E ]
    [   ref   ][NW][SW][SE][NE]

Column pairing keeps nearby variants adjacent (W/NW, S/SW, N/SE, E/NE).
Patch background = chroma key 0x00FF00 → output cells crop + key via
exp 002's adaptive keyer.

bootstrap mode (no example sheet yet): example dir cells stay green; NBP
generates the first sheet, we curate, curated cells become the anchor.

    python make_template.py --example-ref monet.png --input-ref user.png -o t.png
    python make_template.py --example-ref monet.png --example-cells ./curated \
        --input-ref user.png -o t.png
"""

import argparse
from pathlib import Path

from PIL import Image

KEY = (0, 255, 0)
REF_W, REF_H = 208, 512
CELL_W, CELL_H = 204, 256
# cell columns hold [top-row dir, bottom-row dir]
COLUMNS = [("W", "NW"), ("S", "SW"), ("N", "SE"), ("E", "NE")]
DIRECTIONS = [d for pair in zip(*COLUMNS) for d in pair]  # W S N E NW SW SE NE


def fit(path: str, w: int, h: int, bg) -> Image.Image:
    """Image centered on a w x h tile of bg color."""
    tile = Image.new("RGB", (w, h), bg)
    img = Image.open(path).convert("RGBA")
    img.thumbnail((w, h), Image.LANCZOS)
    tile.paste(img, ((w - img.width) // 2, (h - img.height) // 2), img)
    return tile


def block(canvas: Image.Image, y: int, ref_path: str, cells_dir: str | None):
    """One 2-row block: ref spanning both rows + 4x2 direction patches."""
    canvas.paste(fit(ref_path, REF_W, REF_H, "#e8e4df"), (0, y))
    for col, pair in enumerate(COLUMNS):
        for row, direction in enumerate(pair):
            x = REF_W + col * CELL_W
            cy = y + row * CELL_H
            patch = Image.new("RGB", (CELL_W, CELL_H), KEY)
            if cells_dir:
                p = Path(cells_dir) / f"{direction}.png"
                if p.exists():
                    patch = fit(str(p), CELL_W, CELL_H, KEY)
            canvas.paste(patch, (x, cy))


def make(example_ref, example_cells, input_ref, out):
    """example_ref=None → single-block bootstrap sheet (1024x512): just the
    input ref + 8 green slots, for the very first NBP call that creates the
    anchor example."""
    W = REF_W + 4 * CELL_W   # 208 + 816 = 1024
    blocks = ([(example_ref, example_cells)] if example_ref else []) + [(input_ref, None)]
    H = REF_H * len(blocks)
    canvas = Image.new("RGB", (W, H), KEY)
    for i, (ref, cells) in enumerate(blocks):
        block(canvas, i * REF_H, ref, cells)
    canvas.save(out)
    mode = "full" if example_cells else ("bootstrap-2block" if example_ref else "bootstrap-1block")
    print(f"{out}: {W}x{H} ({mode}); cell order in columns: {COLUMNS}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--example-ref")
    p.add_argument("--example-cells", help="dir with W.png, NW.png, ... per direction")
    p.add_argument("--input-ref", required=True)
    p.add_argument("-o", "--output", default="template.png")
    a = p.parse_args()
    make(a.example_ref, a.example_cells, a.input_ref, a.output)
