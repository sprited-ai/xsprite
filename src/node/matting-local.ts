/** Local BiRefNet-ToonOut matting in Node — onnxruntime-node, no Python, no
 * network after the first run. The fp16 ONNX lives on HF under
 * sprited/birefnet-toonout-onnx and is downloaded once to ~/.cache/sprited.
 * onnxruntime-node is an optionalDependency; when it (or the download) is
 * unavailable the caller falls back to the Replicate endpoint / floodfill.
 * Pixel pre/post processing is shared with the browser glue via
 * core/toonout. */
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { RawImage } from "../core/image.js";
import { TOONOUT_SIZE, toonoutPreprocess, toonoutApplyMask } from "../core/toonout.js";

const MODEL_URL = "https://huggingface.co/sprited/birefnet-toonout-onnx/resolve/main/birefnet-toonout-fp16.onnx";
const MODEL_FILE = "birefnet-toonout-fp16.onnx";

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
  console.error(`downloading ${MODEL_FILE} (~470MB, one-time) -> ${cacheDir()}`);
  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`model download failed: ${res.status}`);
  const tmp = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tmp));
  renameSync(tmp, file);
  return file;
}

async function matteAll(ort: any, sess: any, cells: RawImage[]): Promise<RawImage[]> {
  const out: RawImage[] = [];
  // sequential — the session saturates the device on its own
  for (const cell of cells) {
    const chw = toonoutPreprocess(cell);
    const res = await sess.run({ image: new ort.Tensor("float32", chw, [1, 3, TOONOUT_SIZE, TOONOUT_SIZE]) });
    out.push(toonoutApplyMask(cell, res.mask.data as Float32Array));
  }
  return out;
}

// cached after a successful run — a session that matted one batch will
// handle the next
let cached: { ort: any; sess: any } | undefined;

/** Matte cells through the local model. WebGPU first (~5x faster than the
 * CPU EP on Apple Silicon), CPU fallback — and since an EP can accept the
 * graph at create time yet still fail at run time (CoreML does exactly
 * that), the fallback wraps the run, not just session creation. */
export async function localToonoutMatting(cells: RawImage[]): Promise<RawImage[]> {
  const ort = await loadOrt();
  const path = await modelPath();
  if (cached) {
    try {
      return await matteAll(cached.ort, cached.sess, cells);
    } catch {
      cached = undefined;
    }
  }
  for (const ep of ["webgpu", "cpu"]) {
    try {
      const sess = await ort.InferenceSession.create(path, { executionProviders: [ep], logSeverityLevel: 3 });
      const out = await matteAll(ort, sess, cells);
      cached = { ort, sess };
      return out;
    } catch (e) {
      if (ep === "cpu") throw e;
      console.error(`webgpu matting failed — retrying on cpu (${String(e).slice(0, 120)})`);
    }
  }
  throw new Error("unreachable");
}
