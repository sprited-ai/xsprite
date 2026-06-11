"""Harvest Jin's v2 NBP sheets (gray panels, labeled, 5 directions) into
8-direction RGBA sets + a turnaround GIF.

5 generated directions (S, SE, E, NE, N) + horizontal mirrors (SE→SW, E→W,
NE→NW) = 8. Mirroring caveat: asymmetric details (side bows, bags) flip.

Panel detection: the sprite panel is the widest light-gray connected region;
it is split into 5 equal columns. Keying: flood fill from cell borders with
RGB tolerance (gray-safe — no chroma assumption), soft 1px edge.

  python harvest_v2.py v2/7.png --row 1 -o harvested/v2-blue --gif spin.gif
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

GEN = ["S", "SE", "E", "NE", "N"]
MIRROR = {"SW": "SE", "W": "E", "NW": "NE"}
SPIN = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"]  # clockwise turnaround


def find_panels(rgb: np.ndarray):
    """Bounding boxes of wide light-gray panels, top to bottom."""
    r, g, b = rgb[..., 0].astype(int), rgb[..., 1].astype(int), rgb[..., 2].astype(int)
    gray = (abs(r - g) < 14) & (abs(g - b) < 14) & (r > 100) & (r < 200)
    labels, n = ndimage.label(gray)
    boxes = []
    for sl in ndimage.find_objects(labels):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if w > rgb.shape[1] * 0.4 and h > 100:
            boxes.append((sl[0].start, sl[1].start, sl[0].stop, sl[1].stop))
    return sorted(boxes)


def key_cell(cell: np.ndarray) -> np.ndarray:
    """RGBA cell with background flood-removed from the borders."""
    h, w, _ = cell.shape
    ring = np.concatenate([cell[0], cell[-1], cell[:, 0], cell[:, -1]]).astype(float)
    bg = np.median(ring, axis=0)
    dist = np.linalg.norm(cell.astype(float) - bg, axis=-1)
    near = dist < 30
    labels, _ = ndimage.label(near)
    edge_labels = np.unique(np.concatenate(
        [labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    bg_mask = np.isin(labels, edge_labels[edge_labels != 0])
    alpha = np.where(bg_mask, 0, 255).astype(np.uint8)
    # 1px soft edge: average alpha with its eroded self
    eroded = ndimage.binary_erosion(alpha > 0)
    alpha = ((alpha / 255 + eroded) / 2 * 255).astype(np.uint8)
    return np.dstack([cell, alpha])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("sheet")
    p.add_argument("--row", type=int, default=0, help="panel index, top to bottom")
    p.add_argument("-o", "--output", required=True)
    p.add_argument("--gif", help="also write a turnaround GIF with this name")
    p.add_argument("--gif-bg", default="#fdf6e3")
    a = p.parse_args()

    rgb = np.asarray(Image.open(a.sheet).convert("RGB"))
    panels = find_panels(rgb)
    if not panels:
        raise SystemExit("no light-gray panel found")
    y0, x0, y1, x1 = panels[a.row]
    print(f"panel {a.row}: x={x0}..{x1} y={y0}..{y1} of {len(panels)} panels")

    outdir = Path(a.output)
    outdir.mkdir(parents=True, exist_ok=True)
    cw = (x1 - x0) // len(GEN)
    sprites = {}
    for i, d in enumerate(GEN):
        cell = rgb[y0:y1, x0 + i * cw: x0 + (i + 1) * cw]
        sprites[d] = Image.fromarray(key_cell(cell), "RGBA")
        sprites[d].save(outdir / f"{d}.png")
    for d, src in MIRROR.items():
        sprites[d] = sprites[src].transpose(Image.FLIP_LEFT_RIGHT)
        sprites[d].save(outdir / f"{d}.png")
    print(f"8 sprites → {outdir} (W/SW/NW mirrored)")

    if a.gif:
        cw_, ch_ = sprites["S"].size
        frames = []
        for d in SPIN:
            f = Image.new("RGB", (cw_ * 2, ch_ * 2), a.gif_bg)
            big = sprites[d].resize((cw_ * 2, ch_ * 2), Image.NEAREST)
            f.paste(big, (0, 0), big)
            frames.append(f)
        frames[0].save(outdir / a.gif, save_all=True, append_images=frames[1:],
                       duration=160, loop=0)
        print(f"turnaround → {outdir / a.gif}")


if __name__ == "__main__":
    main()
