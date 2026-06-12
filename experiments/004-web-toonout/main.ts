import { toonoutMatting } from "../../src/web/toonout.js";
import { compositeOn, crop, type RawImage } from "../../src/core/image.js";

const status = document.getElementById("status")!;
const log = (s: string) => { status.textContent += "\n" + s; console.log("[toonout-test]", s); };

function draw(id: string, img: RawImage) {
  const c = document.getElementById(id) as HTMLCanvasElement;
  c.width = img.width; c.height = img.height;
  c.getContext("2d")!.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
}

async function loadCell(): Promise<RawImage> {
  const img = new Image();
  img.src = "./lisa.spritesheet.png";
  await img.decode();
  const c = new OffscreenCanvas(img.width, img.height);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height);
  const sheet: RawImage = { width: d.width, height: d.height, data: d.data };
  return crop(sheet, 0, 0, Math.floor(sheet.width / 8), sheet.height);
}

declare global { interface Window { __result?: string } }

try {
  status.textContent = `webgpu: ${"gpu" in navigator ? "available" : "NOT available"}`;
  const cell = compositeOn(await loadCell(), [128, 128, 128]); // kill alpha — the model earns it back
  draw("before", cell);
  log("fetching model (~470MB, cached after first load)…");
  const t0 = performance.now();
  const [matted] = await toonoutMatting([cell]);
  const ms = Math.round(performance.now() - t0);
  draw("after", matted);
  const transparent = Array.from({ length: matted.width * matted.height })
    .filter((_, p) => matted.data[p * 4 + 3] < 16).length;
  const pct = Math.round((100 * transparent) / (matted.width * matted.height));
  log(`matted in ${ms}ms — ${pct}% of pixels transparent`);
  window.__result = pct > 20 && pct < 90 ? `OK ${ms}ms ${pct}%` : `SUSPECT ${ms}ms ${pct}%`;
} catch (e) {
  log(`FAILED: ${e}`);
  window.__result = `FAILED: ${e}`;
}
