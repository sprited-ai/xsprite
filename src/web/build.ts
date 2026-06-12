/** Browser character build: same pipeline as sprute/build minus the Node
 * concerns — the caller supplies the decoded template image and the API key,
 * matting is the pure floodfill keyer (browser ToonOut is still WIP, see
 * ./toonout.ts), and results come back as RawImages for the app to render
 * or download. */
import { findPanels, extractDirections, SPIN_ORDER } from "../core/extract.js";
import { crop, pasteIntoSlot, type RawImage } from "../core/image.js";
import { makeSpriteSheet } from "../core/sheet.js";
import { makeEntity, type EntityDescriptor } from "../core/entity.js";
import { generateSheet, fixSpritesheet, defaultPrompt, type GenContext, type GenerateOptions } from "../core/gen.js";
import { TEMPLATE_GEOMETRY, type TemplateGeometry } from "../core/templates.js";
import { canvasCodec } from "./codec.js";

export { canvasCodec } from "./codec.js";

export interface WebBuildOptions {
  /** Gemini API key, exactly as the user provided it — it goes only into
   * `x-goog-api-key` headers on generativelanguage.googleapis.com calls. */
  apiKey: string;
  /** Decoded template image (fetch the bundled PNG, decode via canvas). */
  template: RawImage;
  /** Slot/grid coordinates; defaults to the bundled 8dir-v1 geometry. */
  geometry?: TemplateGeometry;
  name?: string;
  description?: string;
  /** Decoded reference image; omit to let the model invent the character. */
  reference?: RawImage;
  /** A number reproduces a build; omitted rolls a fresh one. */
  seed?: number;
  /** Self-review repair rounds (default 1, 0 disables). */
  maxFixes?: number;
  model?: Pick<GenerateOptions, "provider" | "model">;
  log?(line: string): void;
  /** Every pipeline image as it is produced. */
  stage?(label: string, image: RawImage): void;
}

export interface WebBuildResult {
  name: string;
  seed: number;
  /** Raw generated sheet (template filled by the model). */
  sheet: RawImage;
  /** The inference row's reference cell: the model's full concept render for
   * invented characters, the pasted reference otherwise. */
  concept?: RawImage;
  /** SPIN_ORDER cells after keying and review/fix. */
  cells: RawImage[];
  spritesheet: RawImage;
  entity: EntityDescriptor;
}

export async function buildCharacter(opts: WebBuildOptions): Promise<WebBuildResult> {
  const log = opts.log ?? (() => {});
  const stage = opts.stage ?? (() => {});
  const ctx: GenContext = { codec: canvasCodec, apiKey: () => opts.apiKey };
  const geometry = opts.geometry ?? TEMPLATE_GEOMETRY["8dir-v1"];
  const name = opts.name || "char";
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);

  // work on a copy — pasting the reference must not mutate the caller's template
  const template: RawImage = { ...opts.template, data: new Uint8ClampedArray(opts.template.data) };
  // measure the extraction panel on the CLEAN template (before pasting a
  // reference whose background could fuse with the panel), then scale to
  // the generated sheet's dimensions
  const cleanPanels = findPanels(template);
  const cleanPanel = cleanPanels[geometry.row ?? cleanPanels.length - 1];
  if (opts.reference && geometry.inputSlot) {
    pasteIntoSlot(template, opts.reference, geometry.inputSlot);
  }
  stage("template", template);

  const prompt = defaultPrompt(Boolean(opts.reference), opts.description);
  log(`${name} · ${opts.model?.provider ?? "gemini"} · seed ${seed}`);
  const sheet = await generateSheet(ctx, template, prompt, { ...opts.model, seed });
  log(`${name} · generated`);
  stage("generated-sheet", sheet);

  const s = sheet.width / template.width;
  const slot = geometry.inputSlot;
  const concept = slot
    ? crop(sheet, Math.round(slot.x * s), Math.round(slot.y * s),
        Math.round(slot.width * s), Math.round(slot.height * s))
    : undefined;
  if (concept) stage("concept", concept);
  const g = geometry.grid;
  const rect = g
    ? { x: g.x, y: g.y, width: g.cellWidth * g.columns, height: g.cellHeight }
    : cleanPanel;
  const panel = rect && {
    x: Math.round(rect.x * s), y: Math.round(rect.y * s),
    width: Math.round(rect.width * s), height: Math.round(rect.height * s),
  };
  const sprites = extractDirections(sheet, { panel });
  let cells = SPIN_ORDER.map((d) => sprites[d]);
  stage("spritesheet", makeSpriteSheet(cells));

  // hand the result to the image model itself: "find errors, fix them,
  // report" — same self-review loop the CLI runs
  const maxFixes = Math.max(0, opts.maxFixes ?? 1);
  for (let f = 1; f <= maxFixes; f++) {
    try {
      log(`${name} · review & fix${maxFixes > 1 ? ` ${f}/${maxFixes}` : ""}...`);
      const r = await fixSpritesheet(ctx, cells, opts.description, { ...opts.model, seed });
      if (r.report) log(`review: ${r.report.replace(/\s*\n\s*/g, " ")}`);
      if (r.clean) break;
      cells = r.cells;
      stage(`review${f}-spritesheet`, makeSpriteSheet(cells));
    } catch (e) {
      log(`review skipped (${e instanceof Error ? e.message : e})`);
      break;
    }
  }

  const spritesheet = makeSpriteSheet(cells);
  const entity = makeEntity(name, cells[0].width, cells[0].height, seed);
  return { name, seed, sheet, concept, cells, spritesheet, entity };
}
