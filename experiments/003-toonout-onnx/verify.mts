// Run a lisa cell through the local ONNX matting and write the result for
// eyeballing. SPRUTE_CACHE_DIR=out npx tsx verify.mts
import { readImage, writePng } from "../../src/node/io.js";
import { extractAnimation } from "../../src/core/extract.js";
import { compositeOn } from "../../src/core/image.js";
import { localToonoutMatting } from "../../src/node/matting-local.js";

const sheet = await readImage(new URL("../../examples/lisa.spritesheet.png", import.meta.url).pathname);
// raw cells: keep original pixels, kill the existing alpha so the model does the work
const cells = extractAnimation(sheet, 8, { panel: { x: 0, y: 0, width: sheet.width, height: sheet.height }, raw: true, inset: 0 });
const flat = cells.map((c) => compositeOn(c, [128, 128, 128]));
console.time("matting x2");
const matted = await localToonoutMatting([flat[0], flat[4]]);
console.timeEnd("matting x2");
await writePng(new URL("./out/verify-S.png", import.meta.url).pathname, matted[0]);
await writePng(new URL("./out/verify-N.png", import.meta.url).pathname, matted[1]);
console.log("written out/verify-{S,N}.png");
