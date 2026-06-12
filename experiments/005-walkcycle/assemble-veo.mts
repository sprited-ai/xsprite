/** Find the gait period by autocorrelation, pick 8 frames across one cycle,
 * key the flat background, center, write spritesheet + loop webp. */
import { readImage, writePng, writeAnimatedWebp } from "/Users/jin/dev/sprited/src/node/io.js";
import { crop, centerOnCanvas, type RawImage } from "/Users/jin/dev/sprited/src/core/image.js";
import { keyCell } from "/Users/jin/dev/sprited/src/core/keyer.js";
import { makeSpriteSheet } from "/Users/jin/dev/sprited/src/core/sheet.js";

const N = 96, FPS = 24;
const frames: RawImage[] = [];
for (let i = 1; i <= N; i++) frames.push(await readImage(`frames-veo/f${String(i).padStart(3, "0")}.png`));

// character region (1088x1920 video, subject centered)
const box = { x: 160, y: 300, w: 400, h: 680 };
const small = frames.map((f) => {
  const c = crop(f, box.x, box.y, box.w, box.h);
  // 8x downsample by striding pixels
  const w = Math.floor(c.width / 8), h = Math.floor(c.height / 8), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = ((y * 8) * c.width + x * 8) * 4;
    out[y * w + x] = c.data[p] + c.data[p + 1] + c.data[p + 2];
  }
  return out;
});
const diff = (a: Float32Array, b: Float32Array) => {
  let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length;
};
// autocorrelate around the middle of the clip
const ref = 48;
let bestK = 0, bestD = Infinity;
for (let k = 12; k <= 40; k++) {
  const d = diff(small[ref], small[ref + k]);
  if (d < bestD) { bestD = d; bestK = k; }
}
console.log(`gait period ≈ ${bestK} frames (${(bestK / FPS).toFixed(2)}s) at ref ${ref}, residual ${bestD.toFixed(1)}`);

const picks = Array.from({ length: 8 }, (_, i) => ref + Math.round((i * bestK) / 8));
console.log("frames:", picks.join(" "));
const cells = picks.map((i) => {
  const c = crop(frames[i], box.x, box.y, box.w, box.h);
  return centerOnCanvas(keyCell(c), 256);
});
await writePng("walkcycle-E-veo.spritesheet.png", makeSpriteSheet(cells));
await writeAnimatedWebp("walkcycle-E-veo.webp", cells, FPS / bestK * 8);
console.log("walkcycle-E-veo.spritesheet.png + walkcycle-E-veo.webp");
