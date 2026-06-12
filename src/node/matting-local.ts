/** Local BiRefNet-ToonOut matting — onnxruntime-node, no Python, no network
 * after the first run. The fp16 ONNX (fp32 IO) lives on HF under
 * sprited/birefnet-toonout-onnx and is downloaded once to ~/.cache/sprited.
 * onnxruntime-node is an optionalDependency; when it (or the download) is
 * unavailable the caller falls back to the Replicate endpoint / floodfill. */
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import type { RawImage } from "../core/image.js";

const MODEL_URL = "https://huggingface.co/sprited/birefnet-toonout-onnx/resolve/main/birefnet-toonout-fp16.onnx";
const MODEL_FILE = "birefnet-toonout-fp16.onnx";
const SIZE = 1024;
// ImageNet normalization, BiRefNet's training preprocessing
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

function cacheDir(): string {
  return process.env.SPRITED_CACHE_DIR ?? join(homedir(), ".cache", "sprited");
}

let ortPromise: Promise<any> | undefined;
function loadOrt(): Promise<any> {
  // dynamic import so the CLI works without the optional native dep
  return (ortPromise ??= import("onnxruntime-node").then((m: any) => m.default ?? m));
}

export async function hasLocalToonout(): Promise<boolean> {
  try {
    await loadOrt();
    return true;
  } catch {
    return false;
  }
}

async function modelPath(): Promise<string> {
  const file = join(cacheDir(), MODEL_FILE);
  if (existsSync(file) && statSync(file).size > 100 * 1024 * 1024) return file;
  mkdirSync(cacheDir(), { recursive: true });
  console.error(`downloading ${MODEL_FILE} (~440MB, one-time) -> ${cacheDir()}`);
  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`model download failed: ${res.status}`);
  const tmp = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tmp));
  renameSync(tmp, file);
  return file;
}

let sessionPromise: Promise<any> | undefined;
function session(): Promise<any> {
  return (sessionPromise ??= (async () => {
    const ort = await loadOrt();
    const path = await modelPath();
    // CPU only: the CoreML EP accepts the graph at create time, then fails
    // at run time on this model (grid_sample-heavy decoder)
    // errors only — session creation logs pages of benign constant-folding
    // warnings otherwise
    return ort.InferenceSession.create(path, { executionProviders: ["cpu"], logSeverityLevel: 3 });
  })());
}

async function matteOne(ort: any, sess: any, cell: RawImage): Promise<RawImage> {
  // letterbox-free: BiRefNet is trained on plain square resize
  const resized = await sharp(Buffer.from(cell.data.buffer, cell.data.byteOffset, cell.data.byteLength), {
    raw: { width: cell.width, height: cell.height, channels: 4 },
  }).flatten({ background: { r: 128, g: 128, b: 128 } })
    .resize(SIZE, SIZE, { fit: "fill" })
    .raw().toBuffer();
  const chw = new Float32Array(3 * SIZE * SIZE);
  for (let p = 0; p < SIZE * SIZE; p++) {
    for (let c = 0; c < 3; c++) {
      chw[c * SIZE * SIZE + p] = (resized[p * 3 + c] / 255 - MEAN[c]) / STD[c];
    }
  }
  const out = await sess.run({ image: new ort.Tensor("float32", chw, [1, 3, SIZE, SIZE]) });
  const mask = out.mask.data as Float32Array;
  const mask8 = Buffer.alloc(SIZE * SIZE);
  for (let p = 0; p < SIZE * SIZE; p++) mask8[p] = Math.round(Math.min(1, Math.max(0, mask[p])) * 255);
  // sharp may promote 1-channel raw to 3 channels on resize — honor the
  // reported channel stride instead of assuming 1
  const { data: alpha, info } = await sharp(mask8, { raw: { width: SIZE, height: SIZE, channels: 1 } })
    .resize(cell.width, cell.height, { fit: "fill" })
    .raw().toBuffer({ resolveWithObject: true });
  const result: RawImage = { width: cell.width, height: cell.height, data: new Uint8ClampedArray(cell.data) };
  for (let p = 0; p < cell.width * cell.height; p++) {
    result.data[p * 4 + 3] = Math.min(result.data[p * 4 + 3], alpha[p * info.channels]);
  }
  return result;
}

/** Matte cells through the local model, sequentially (the session saturates
 * the cores on its own; concurrency only adds memory pressure). */
export async function localToonoutMatting(cells: RawImage[]): Promise<RawImage[]> {
  const ort = await loadOrt();
  const sess = await session();
  const out: RawImage[] = [];
  for (const cell of cells) out.push(await matteOne(ort, sess, cell));
  return out;
}
