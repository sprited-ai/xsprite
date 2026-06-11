/** Browser-safe raw image: same shape as DOM ImageData (RGBA, row-major).
 * Everything in src/core operates on this — no Node, no Canvas, no deps —
 * so the pipeline runs identically in CLI, app, and browser contexts. */
export interface RawImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function createImage(width: number, height: number, fill?: [number, number, number, number]): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = fill[3];
    }
  }
  return { width, height, data };
}

export function crop(img: RawImage, x: number, y: number, w: number, h: number): RawImage {
  const out = createImage(w, h);
  for (let row = 0; row < h; row++) {
    const src = ((y + row) * img.width + x) * 4;
    out.data.set(img.data.subarray(src, src + w * 4), row * w * 4);
  }
  return out;
}

export function flipX(img: RawImage): RawImage {
  const out = createImage(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4;
      const d = (y * img.width + (img.width - 1 - x)) * 4;
      out.data[d] = img.data[s]; out.data[d + 1] = img.data[s + 1];
      out.data[d + 2] = img.data[s + 2]; out.data[d + 3] = img.data[s + 3];
    }
  }
  return out;
}

export function scaleNearest(img: RawImage, factor: number): RawImage {
  const w = Math.round(img.width * factor), h = Math.round(img.height * factor);
  const out = createImage(w, h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / factor));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / factor));
      const s = (sy * img.width + sx) * 4, d = (y * w + x) * 4;
      out.data[d] = img.data[s]; out.data[d + 1] = img.data[s + 1];
      out.data[d + 2] = img.data[s + 2]; out.data[d + 3] = img.data[s + 3];
    }
  }
  return out;
}

/** Alpha-composite onto a solid background (for GIF frames). */
export function compositeOn(img: RawImage, bg: [number, number, number]): RawImage {
  const out = createImage(img.width, img.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3] / 255;
    out.data[i] = img.data[i] * a + bg[0] * (1 - a);
    out.data[i + 1] = img.data[i + 1] * a + bg[1] * (1 - a);
    out.data[i + 2] = img.data[i + 2] * a + bg[2] * (1 - a);
    out.data[i + 3] = 255;
  }
  return out;
}

/** Center horizontally, anchor to the bottom (feet), on a square canvas. */
export function centerOnCanvas(img: RawImage, size: number): RawImage {
  const scale = Math.min(size / img.width, size / img.height, 1);
  const scaled = scale < 1 ? scaleNearest(img, scale) : img;
  const out = createImage(size, size, [0, 0, 0, 0]);
  const ox = Math.floor((size - scaled.width) / 2);
  const oy = size - scaled.height;
  for (let y = 0; y < scaled.height; y++) {
    const src = y * scaled.width * 4;
    out.data.set(scaled.data.subarray(src, src + scaled.width * 4), ((oy + y) * size + ox) * 4);
  }
  return out;
}

/** Paste src onto dst at (x, y), respecting src alpha. */
export function paste(dst: RawImage, src: RawImage, x: number, y: number): void {
  for (let sy = 0; sy < src.height; sy++) {
    const dy = y + sy;
    if (dy < 0 || dy >= dst.height) continue;
    for (let sx = 0; sx < src.width; sx++) {
      const dx = x + sx;
      if (dx < 0 || dx >= dst.width) continue;
      const s = (sy * src.width + sx) * 4, d = (dy * dst.width + dx) * 4;
      const a = src.data[s + 3] / 255;
      dst.data[d] = src.data[s] * a + dst.data[d] * (1 - a);
      dst.data[d + 1] = src.data[s + 1] * a + dst.data[d + 1] * (1 - a);
      dst.data[d + 2] = src.data[s + 2] * a + dst.data[d + 2] * (1 - a);
      dst.data[d + 3] = Math.max(dst.data[d + 3], src.data[s + 3]);
    }
  }
}

/** Scale src to fit a slot (preserve aspect), centered. */
export function pasteIntoSlot(dst: RawImage, src: RawImage, slot: { x: number; y: number; width: number; height: number }): void {
  const f = Math.min(slot.width / src.width, slot.height / src.height);
  const scaled = scaleNearest(src, f);
  paste(dst, scaled, slot.x + ((slot.width - scaled.width) >> 1), slot.y + ((slot.height - scaled.height) >> 1));
}
