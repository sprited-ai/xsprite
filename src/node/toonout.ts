/** Node entry of the "sprited/toonout" subpath. Browser bundlers get
 * src/web/toonout.ts via the exports "browser" condition; this side runs on
 * onnxruntime-node with the ~/.cache/sprited model download. */
import type { RawImage } from "../core/image.js";
import { localToonoutMatting, hasLocalToonout } from "./matting-local.js";

export { hasLocalToonout };

export function toonoutMatting(cells: RawImage[]): Promise<RawImage[]> {
  return localToonoutMatting(cells);
}
