/** Try-it panel: the browser build pipeline (sprute/web) wired to a tiny
 * form. The user's key lives in this tab (localStorage only on request) and
 * goes only into x-goog-api-key headers on generativelanguage.googleapis.com. */
import { buildCharacter } from "../src/web/build.js";
import { canvasCodec } from "../src/web/codec.js";
import type { RawImage } from "../src/core/image.js";
import templateUrl from "../templates/sprute-8dir-v1.png";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const keyInput = $<HTMLInputElement>("key");
const remember = $<HTMLInputElement>("remember");
const nameInput = $<HTMLInputElement>("char-name");
const descInput = $<HTMLTextAreaElement>("desc");
const refInput = $<HTMLInputElement>("ref");
const review = $<HTMLInputElement>("review");
const goBtn = $<HTMLButtonElement>("go");
const logEl = $<HTMLPreElement>("log");
const resultEl = $("result");

const KEY_STORE = "sprute.gemini-key";
keyInput.value = localStorage.getItem(KEY_STORE) ?? "";
remember.checked = keyInput.value !== "";
const syncKeyStore = () => {
  if (remember.checked && keyInput.value) localStorage.setItem(KEY_STORE, keyInput.value);
  else localStorage.removeItem(KEY_STORE);
};
remember.addEventListener("change", syncKeyStore);
keyInput.addEventListener("change", syncKeyStore);

function log(line: string): void {
  logEl.hidden = false;
  logEl.textContent += line + "\n";
}

async function decodeBlob(blob: Blob): Promise<RawImage> {
  return canvasCodec.decodeImage(new Uint8Array(await blob.arrayBuffer()));
}

function drawTo(canvas: HTMLCanvasElement, img: RawImage, displayWidth: number): void {
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.style.width = `${displayWidth}px`;
  canvas.getContext("2d")!.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
}

let turntable: ReturnType<typeof setInterval> | undefined;

async function downloadLink(id: string, name: string, blob: Blob): Promise<void> {
  const a = $<HTMLAnchorElement>(id);
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.hidden = false;
}

goBtn.addEventListener("click", async () => {
  const apiKey = keyInput.value.trim();
  if (!apiKey) { keyInput.focus(); return; }
  goBtn.disabled = true;
  logEl.textContent = "";
  resultEl.hidden = true;
  clearInterval(turntable);
  try {
    const template = await decodeBlob(await (await fetch(templateUrl)).blob());
    const reference = refInput.files?.[0] ? await decodeBlob(refInput.files[0]) : undefined;
    const { name, seed, concept, cells, spritesheet, entity } = await buildCharacter({
      apiKey,
      template,
      name: nameInput.value.trim() || undefined,
      description: descInput.value.trim() || undefined,
      reference,
      maxFixes: review.checked ? 1 : 0,
      log,
    });
    log(`done — seed ${seed}`);

    resultEl.hidden = false;
    const conceptCanvas = $<HTMLCanvasElement>("concept");
    conceptCanvas.hidden = !concept;
    if (concept) drawTo(conceptCanvas, concept, 160);
    const turnCanvas = $<HTMLCanvasElement>("turn");
    drawTo($<HTMLCanvasElement>("sheet"), spritesheet, 640);
    let frame = 0;
    drawTo(turnCanvas, cells[0], 160);
    turntable = setInterval(() => drawTo(turnCanvas, cells[frame = (frame + 1) % cells.length], 160), 417);

    const png = await canvasCodec.encodePng(spritesheet);
    await downloadLink("dl-sheet", `${name}.spritesheet.png`, new Blob([png as BlobPart], { type: "image/png" }));
    await downloadLink("dl-entity", `${name}.entity.json`,
      new Blob([JSON.stringify(entity, null, 2) + "\n"], { type: "application/json" }));
  } catch (e) {
    log(`error: ${e instanceof Error ? e.message : e}`);
  } finally {
    goBtn.disabled = false;
  }
});
