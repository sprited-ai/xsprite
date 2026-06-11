/** Background removal for template cells. Port of the lab keyer
 * (experiments/001-template-8dir/harvest_v2.py key_cell):
 * estimate the background from the border ring, flood-fill from the borders
 * with an RGB tolerance (works on gray AND chroma backgrounds), soft 1px edge.
 * Pure TS on RawImage — browser-safe. */
import type { RawImage } from "./image.js";

/** Median border-ring color. */
export function estimateBackground(img: RawImage, ringWidth = 2): [number, number, number] {
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const { width: w, height: h, data } = img;
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
  };
  for (let x = 0; x < w; x++) for (let r = 0; r < ringWidth; r++) { push(x, r); push(x, h - 1 - r); }
  for (let y = ringWidth; y < h - ringWidth; y++) for (let r = 0; r < ringWidth; r++) { push(r, y); push(w - 1 - r, y); }
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

/** Flood fill from all border pixels across near-background pixels.
 * Returns a mask: 1 = background (remove), 0 = keep. */
function backgroundMask(img: RawImage, bg: [number, number, number], tol: number): Uint8Array {
  const { width: w, height: h, data } = img;
  const near = new Uint8Array(w * h);
  const tol2 = tol * tol;
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
    if (dr * dr + dg * dg + db * db < tol2) near[p] = 1;
  }
  const mask = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (p: number) => { if (near[p] && !mask[p]) { mask[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (y > 0) seed(p - w);
    if (y < h - 1) seed(p + w);
  }
  return mask;
}

export interface KeyOptions {
  /** RGB distance tolerance to the estimated background. */
  tolerance?: number;
  /** Override background color instead of estimating from the border ring. */
  background?: [number, number, number];
}

/** Remove the background of a cell in place-safe fashion (returns a copy). */
export function keyCell(img: RawImage, opts: KeyOptions = {}): RawImage {
  const tol = opts.tolerance ?? 30;
  const bg = opts.background ?? estimateBackground(img);
  const mask = backgroundMask(img, bg, tol);
  const { width: w, height: h } = img;
  const out: RawImage = { width: w, height: h, data: new Uint8ClampedArray(img.data) };
  for (let p = 0; p < w * h; p++) if (mask[p]) out.data[p * 4 + 3] = 0;
  // soft 1px edge: halve alpha on kept pixels that touch removed ones
  for (let p = 0; p < w * h; p++) {
    if (mask[p]) continue;
    const x = p % w, y = (p / w) | 0;
    const touchesBg =
      (x > 0 && mask[p - 1]) || (x < w - 1 && mask[p + 1]) ||
      (y > 0 && mask[p - w]) || (y < h - 1 && mask[p + w]);
    if (touchesBg) out.data[p * 4 + 3] = out.data[p * 4 + 3] >> 1;
  }
  return out;
}
