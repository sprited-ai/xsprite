/** Browser BiRefNet-ToonOut matting — onnxruntime-web (webgpu, wasm
 * fallback). Bundlers resolve `import ... from "sprute/toonout"` to this
 * file via the exports "browser" condition; Node gets the onnxruntime-node
 * glue instead. onnxruntime-web is an optional peer — install it in apps
 * that use this. The model (~470MB) is fetched from HF and kept in the
 * Cache API, so it downloads once per origin. */
import type { RawImage } from "../core/image.js";
import { TOONOUT_SIZE, TOONOUT_MODEL_URL, toonoutPreprocess, toonoutApplyMask } from "../core/toonout.js";

let cached: Promise<{ ort: any; sess: any }> | undefined;

async function fetchModel(url: string): Promise<ArrayBuffer> {
  if (typeof caches !== "undefined") {
    const cache = await caches.open("sprute-models");
    let res = await cache.match(url);
    if (!res) {
      await cache.add(url);
      res = await cache.match(url);
    }
    if (res) return res.arrayBuffer();
  }
  return (await fetch(url)).arrayBuffer();
}

function session(modelUrl: string, eps: string[]): Promise<{ ort: any; sess: any }> {
  return (cached ??= (async () => {
    const m: any = await import("onnxruntime-web");
    const ort = m.default ?? m;
    const model = new Uint8Array(await fetchModel(modelUrl));
    for (const ep of eps) {
      try {
        return { ort, sess: await ort.InferenceSession.create(model, { executionProviders: [ep] }) };
      } catch (e) {
        if (ep === eps[eps.length - 1]) throw e;
      }
    }
    throw new Error("unreachable");
  })());
}

/** Matte cells through BiRefNet-ToonOut, fully client-side. */
export interface ToonoutOptions {
  modelUrl?: string;
  /** EP order. KNOWN ISSUES (Chrome 143, ort-web 1.26, fp16 model): webgpu
   * runs but returns compressed mask values (~0.3-0.5 instead of 0/1 —
   * suspected fp16 precision in JSEP shaders); wasm hits the 32-bit heap
   * wall (std::bad_alloc). Next experiment: the fp32 model on webgpu. */
  eps?: string[];
}

export async function toonoutMatting(cells: RawImage[], opts: ToonoutOptions = {}): Promise<RawImage[]> {
  const { ort, sess } = await session(opts.modelUrl ?? TOONOUT_MODEL_URL, opts.eps ?? ["webgpu", "wasm"]);
  const out: RawImage[] = [];
  for (const cell of cells) {
    const chw = toonoutPreprocess(cell);
    const res = await sess.run({ image: new ort.Tensor("float32", chw, [1, 3, TOONOUT_SIZE, TOONOUT_SIZE]) });
    out.push(toonoutApplyMask(cell, res.mask.data as Float32Array));
  }
  return out;
}
