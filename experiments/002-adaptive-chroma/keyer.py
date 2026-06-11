"""Adaptive chroma keyer — exp 002.

Generation models drift the requested 0x00ff00 background slightly (and
sometimes non-uniformly) across animation frames, so a fixed key fails.
Instead: estimate the actual key color from the border ring of each frame,
then key by chroma distance with a soft zone + despill.

Usage:
  python keyer.py frame.png -o out.png            # auto key from border ring
  python keyer.py frame.png -o out.png --key '#00ff00'
  python keyer.py frame.png -o out.png --no-floodfill --debug

Prior art: our cam2portrait emotion-sheet keyer
(fixed-green, greenness = G - max(R,B), two thresholds, soft-zone despill).
This generalizes the key color and adds background-connectivity so
key-colored pixels *inside* the character survive.
"""

import argparse
import sys

import numpy as np
from PIL import Image

RING_WIDTH = 4          # border ring sampled for key estimation, px
QUANT = 32              # quantization step for dominant-color voting
SOFT_DIST = 0.10        # chroma distance where alpha starts to fade
FULL_DIST = 0.22        # chroma distance below which alpha = 0
MIN_KEY_SATURATION = 0.15  # sanity check: a key color must be saturated


def estimate_key(rgb: np.ndarray) -> np.ndarray:
    """Dominant color of the border ring, as float [0,1] RGB."""
    h, w, _ = rgb.shape
    ring = np.concatenate([
        rgb[:RING_WIDTH].reshape(-1, 3),
        rgb[-RING_WIDTH:].reshape(-1, 3),
        rgb[RING_WIDTH:-RING_WIDTH, :RING_WIDTH].reshape(-1, 3),
        rgb[RING_WIDTH:-RING_WIDTH, -RING_WIDTH:].reshape(-1, 3),
    ])
    bins = (ring // QUANT).astype(np.int32)
    keys = bins[:, 0] * 64 * 64 + bins[:, 1] * 64 + bins[:, 2]
    dominant = np.bincount(keys).argmax()
    members = ring[keys == dominant]
    key = members.mean(axis=0) / 255.0

    sat = key.max() - key.min()
    if sat < MIN_KEY_SATURATION:
        print(f"warning: border color {key} barely saturated (sat={sat:.2f}) — "
              "background may not be a solid key; results will be poor",
              file=sys.stderr)
    return key


def chroma_distance(rgb01: np.ndarray, key: np.ndarray) -> np.ndarray:
    """Distance in the rg-chromaticity plane (luma-invariant), so a darker or
    brighter drift of the same green still keys out."""
    def chroma(c):
        s = c.sum(axis=-1, keepdims=True) + 1e-6
        return (c / s)[..., :2]
    return np.linalg.norm(chroma(rgb01) - chroma(key[None, None, :]), axis=-1)


def background_mask(near_key: np.ndarray) -> np.ndarray:
    """Restrict keying to near-key pixels reachable from the border, so green
    shirts survive. Enclosed holes (between arm and body) are NOT reached —
    acceptable for exp grading; revisit with hole heuristics if it matters."""
    try:
        from scipy import ndimage
    except ImportError:
        print("warning: scipy missing — flood fill skipped, keying by color only",
              file=sys.stderr)
        return near_key
    labels, _ = ndimage.label(near_key)
    border_labels = np.unique(np.concatenate([
        labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    border_labels = border_labels[border_labels != 0]
    return np.isin(labels, border_labels)


def key_frame(img: Image.Image, key: np.ndarray | None,
              floodfill: bool, debug: bool) -> Image.Image:
    rgba = np.asarray(img.convert("RGBA")).astype(np.float32)
    rgb01 = rgba[..., :3] / 255.0

    if key is None:
        key = estimate_key(rgba[..., :3].astype(np.uint8))
        if debug:
            print(f"estimated key: #{''.join(f'{int(c*255):02x}' for c in key)}",
                  file=sys.stderr)

    dist = chroma_distance(rgb01, key)

    # alpha: 0 inside FULL_DIST, 1 outside SOFT_DIST+FULL_DIST band
    fade = np.clip((dist - FULL_DIST) / (SOFT_DIST), 0.0, 1.0)

    if floodfill:
        near = dist < FULL_DIST + SOFT_DIST
        bg = background_mask(near)
        fade = np.where(bg, fade, np.maximum(fade, 1.0 * ~near + fade * near))
        fade[~bg] = 1.0  # non-background-connected pixels keep full alpha

    rgba[..., 3] *= fade

    # despill: in the fade band, pull the key-dominant channel down to the
    # max of the other two (generalization of the cam2portrait G-clamp)
    band = (fade > 0) & (fade < 1)
    k = int(np.argmax(key))
    others = [c for c in range(3) if c != k]
    ceiling = np.maximum(rgba[..., others[0]], rgba[..., others[1]])
    rgba[..., k] = np.where(band, np.minimum(rgba[..., k], ceiling), rgba[..., k])

    return Image.fromarray(rgba.astype(np.uint8), "RGBA")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("input")
    p.add_argument("-o", "--output", required=True)
    p.add_argument("--key", default=None, help="hex like '#00ff00'; default auto")
    p.add_argument("--no-floodfill", action="store_true")
    p.add_argument("--debug", action="store_true")
    args = p.parse_args()

    key = None
    if args.key:
        s = args.key.lstrip("#")
        key = np.array([int(s[i:i+2], 16) for i in (0, 2, 4)]) / 255.0

    out = key_frame(Image.open(args.input), key,
                    floodfill=not args.no_floodfill, debug=args.debug)
    out.save(args.output)


if __name__ == "__main__":
    main()
