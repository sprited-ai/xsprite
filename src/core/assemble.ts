/** Assemble extracted sprites into shareable artifacts. Browser-safe
 * (gifenc is pure JS). */
// @ts-expect-error gifenc ships no types (CJS default export)
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { compositeOn, scaleNearest, type RawImage } from "./image.js";
import { SPIN_ORDER, type Direction } from "./extract.js";

export interface GifOptions {
  /** Solid background color (GIF alpha is binary; we composite). */
  background?: [number, number, number];
  /** Nearest-neighbor scale factor. */
  scale?: number;
  /** Per-frame delay in ms. */
  delayMs?: number;
}

export function encodeGif(frames: RawImage[], opts: GifOptions = {}): Uint8Array {
  const bg = opts.background ?? [253, 246, 227];
  const scale = opts.scale ?? 2;
  const delay = opts.delayMs ?? 160;
  const gif = GIFEncoder();
  for (const frame of frames) {
    const flat = compositeOn(scale === 1 ? frame : scaleNearest(frame, scale), bg);
    const palette = quantize(flat.data, 256);
    const index = applyPalette(flat.data, palette);
    gif.writeFrame(index, flat.width, flat.height, { palette, delay });
  }
  gif.finish();
  return gif.bytes();
}

/** Clockwise turnaround GIF from an 8-direction sprite set. */
export function turnaroundGif(sprites: Record<Direction, RawImage>, opts: GifOptions = {}): Uint8Array {
  return encodeGif(SPIN_ORDER.map((d) => sprites[d]), opts);
}
