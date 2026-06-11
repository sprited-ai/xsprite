"""Harvest a filled template: crop the 8 direction cells, chroma-key each,
save per-direction RGBA sprites + a contact sheet for grading.

Works on any model output that preserved the template geometry. The output
image is rescaled to template coordinates first, so a 2048x1024 render of a
1024x512 template still crops correctly.

  python harvest.py out/qwen-bootstrap-0.png --rows 1 -o harvested/qwen
  python harvest.py filled-2block.png --rows 2 -o harvested/nbp   # crops the
      INPUT block (block index --block, default last)

Outputs: <out>/<DIR>.png (RGBA, keyed) and <out>/contact.png.
"""

import argparse
import importlib.util
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location(
    "keyer", HERE.parent / "002-adaptive-chroma" / "keyer.py")
keyer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(keyer)

from make_template import CELL_H, CELL_W, COLUMNS, REF_H, REF_W  # noqa: E402

TEMPLATE_W = REF_W + 4 * CELL_W  # 1024


def crop_cells(img: Image.Image, rows_of_blocks: int, block: int):
    """Yield (direction, cell_image) for one block of a filled template."""
    scale = img.width / TEMPLATE_W
    expected_h = REF_H * rows_of_blocks * scale
    if abs(img.height - expected_h) > img.height * 0.05:
        print(f"warning: height {img.height} vs expected {expected_h:.0f} — "
              "model changed aspect; crops may be off", file=sys.stderr)
    y_base = block * REF_H * scale
    for col, pair in enumerate(COLUMNS):
        for row, direction in enumerate(pair):
            x0 = (REF_W + col * CELL_W) * scale
            y0 = y_base + row * CELL_H * scale
            yield direction, img.crop(
                (round(x0), round(y0),
                 round(x0 + CELL_W * scale), round(y0 + CELL_H * scale)))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("filled")
    p.add_argument("--rows", type=int, default=1, help="blocks in the template")
    p.add_argument("--block", type=int, default=-1, help="block to harvest (default last)")
    p.add_argument("--no-key", action="store_true", help="crop only, skip chroma key")
    p.add_argument("-o", "--output", required=True)
    a = p.parse_args()

    img = Image.open(a.filled).convert("RGBA")
    block = a.block % a.rows
    outdir = Path(a.output)
    outdir.mkdir(parents=True, exist_ok=True)

    cells = []
    for direction, cell in crop_cells(img, a.rows, block):
        if not a.no_key:
            cell = keyer.key_frame(cell, key=None, floodfill=True, debug=False)
        cell.save(outdir / f"{direction}.png")
        cells.append((direction, cell))

    # contact sheet: keyed cells on checkerboard-ish gray for grading
    cw, ch = cells[0][1].size
    sheet = Image.new("RGB", (cw * 4, ch * 2), "#9a9a9a")
    order = [d for pair in COLUMNS for d in (pair[0],)] + \
            [d for pair in COLUMNS for d in (pair[1],)]
    by_name = dict(cells)
    for i, d in enumerate(order):
        sheet.paste(by_name[d], ((i % 4) * cw, (i // 4) * ch), by_name[d])
    sheet.save(outdir / "contact.png")
    print(f"harvested 8 cells → {outdir} (contact.png for grading)")


if __name__ == "__main__":
    main()
