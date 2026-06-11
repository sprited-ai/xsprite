/** Slice filled template sheets into sprites. Port of the lab scripts
 * (harvest_v2.py / walk_harvest.py): auto-detect the light-gray sprite panel,
 * split into cells, key each cell; for direction sheets, mirror SE/E/NE into
 * SW/W/NW so 5 generated views become 8. */
import { crop, flipX, createImage, paste, type RawImage } from "./image.js";
import { keyCell, type KeyOptions } from "./keyer.js";

export const GENERATED_DIRECTIONS = ["S", "SE", "E", "NE", "N"] as const;
export const MIRRORED: Record<string, string> = { SW: "SE", W: "E", NW: "NE" };
/** Clockwise turnaround order. */
export const SPIN_ORDER = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"] as const;

export type Direction = (typeof SPIN_ORDER)[number];

export interface Panel { x: number; y: number; width: number; height: number }

/** Find wide light-gray panels (the sprite rows of a template), top to bottom. */
export function findPanels(img: RawImage): Panel[] {
  const { width: w, height: h, data } = img;
  const gray = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && r > 100 && r < 200) gray[p] = 1;
  }
  const labels = new Int32Array(w * h);
  const boxes: Panel[] = [];
  let next = 0;
  const stack: number[] = [];
  for (let p0 = 0; p0 < w * h; p0++) {
    if (!gray[p0] || labels[p0]) continue;
    next++;
    let minX = w, maxX = 0, minY = h, maxY = 0;
    labels[p0] = next;
    stack.push(p0);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h) continue;
        if (Math.abs((q % w) - x) > 1) continue; // no row wrap
        if (gray[q] && !labels[q]) { labels[q] = next; stack.push(q); }
      }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    if (bw > w * 0.4 && bh > 100) boxes.push({ x: minX, y: minY, width: bw, height: bh });
  }
  return boxes.sort((a, b) => a.y - b.y);
}

export interface ExtractOptions extends KeyOptions {
  /** Panel index, top to bottom. Default: last panel (the inference row). */
  row?: number;
  /** Leading cells to skip (e.g. a reference cell inside the panel). */
  skipRef?: number;
  /** Explicit panel rect (in sheet coordinates) — skips auto-detection.
   * Use when the sheet's backgrounds make detection ambiguous (e.g. a pasted
   * reference photo); measure on the clean template and scale. */
  panel?: Panel;
  /** Edge inset: crop this many px off each cell side before keying (kills
   * grid-line/border contamination), restored as transparent padding after.
   * Output cell size is unchanged. Default 4. */
  inset?: number;
}

/** Direction sheet → 8 keyed sprites (5 generated + 3 mirrored). */
export function extractDirections(sheet: RawImage, opts: ExtractOptions = {}): Record<Direction, RawImage> {
  const cells = extractCells(sheet, GENERATED_DIRECTIONS.length, opts);
  const sprites = {} as Record<Direction, RawImage>;
  GENERATED_DIRECTIONS.forEach((d, i) => { sprites[d] = cells[i]; });
  for (const [dst, src] of Object.entries(MIRRORED)) {
    sprites[dst as Direction] = flipX(sprites[src as Direction]);
  }
  return sprites;
}

/** Animation strip → keyed frames, left to right. */
export function extractAnimation(sheet: RawImage, frameCount: number, opts: ExtractOptions = {}): RawImage[] {
  return extractCells(sheet, frameCount, opts);
}

function extractCells(sheet: RawImage, count: number, opts: ExtractOptions): RawImage[] {
  let panel = opts.panel;
  if (!panel) {
    const panels = findPanels(sheet);
    if (!panels.length) throw new Error("no sprite panel found (expected a wide light-gray region)");
    panel = panels[opts.row ?? panels.length - 1];
  }
  const skip = opts.skipRef ?? 0;
  const total = count + skip;
  const cells: RawImage[] = [];
  const inset = opts.inset ?? 4;
  for (let i = skip; i < total; i++) {
    // rounded per-cell boundaries — avoids floor() drift accumulating
    const x0 = panel.x + Math.round((i * panel.width) / total);
    const x1 = panel.x + Math.round(((i + 1) * panel.width) / total);
    const w = x1 - x0, h = panel.height;
    // inset before keying so cell borders/grid lines can't contaminate,
    // then restore size with transparent padding
    const inner = crop(sheet, x0 + inset, panel.y + inset, w - 2 * inset, h - 2 * inset);
    const keyed = keyCell(inner, opts);
    const padded = createImage(w, h, [0, 0, 0, 0]);
    paste(padded, keyed, inset, inset);
    cells.push(padded);
  }
  return cells;
}
