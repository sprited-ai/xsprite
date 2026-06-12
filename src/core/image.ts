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

/** Bilinear resize (RGBA). Nearest keeps pixel art crisp for display;
 * bilinear is for model I/O, where nets expect smooth resampling. */
export function resizeBilinear(img: RawImage, w: number, h: number): RawImage {
  const out = createImage(w, h);
  const sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, Math.min(img.height - 1, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(img.height - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, Math.min(img.width - 1, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(img.width - 1, x0 + 1), wx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const v00 = img.data[(y0 * img.width + x0) * 4 + c], v01 = img.data[(y0 * img.width + x1) * 4 + c];
        const v10 = img.data[(y1 * img.width + x0) * 4 + c], v11 = img.data[(y1 * img.width + x1) * 4 + c];
        out.data[(y * w + x) * 4 + c] =
          v00 * (1 - wx) * (1 - wy) + v01 * wx * (1 - wy) + v10 * (1 - wx) * wy + v11 * wx * wy;
      }
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
