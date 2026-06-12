/** The character build pipeline as a library: compose template → generate →
 * extract & matte → model self-review/fix rounds → entity. No file writes,
 * no console, no process.exit — those belong to the caller (the CLI, a
 * server, an editor). Diagnostics flow through hooks. */
import { existsSync, readdirSync } from "node:fs";
import { findPanels, extractDirections, SPIN_ORDER, GENERATED_DIRECTIONS, MIRRORED, type Direction } from "../core/extract.js";
import { createImage, paste, flipX, pasteIntoSlot, type RawImage } from "../core/image.js";
import { makeSpriteSheet } from "../core/sheet.js";
import { makeEntity, type EntityDescriptor } from "../core/entity.js";
import { readImage } from "./io.js";
import { generateSheet, defaultPrompt, fixSpritesheet } from "./generate.js";
import { toonoutMatting, hasReplicateToken } from "./matting.js";
import { localToonoutMatting, hasLocalToonout } from "./matting-local.js";
import type { ResolvedConfig } from "../config.js";
import type { Reporter } from "./report.js";

export interface BuildHooks {
  /** Diagnostic lines a CLI would send to stderr. */
  log?(line: string): void;
  /** A long opaque model call starts; the returned closer ends it. */
  progress?(label: string, expectedMs: number): (finalLabel?: string) => void;
  /** Every pipeline image as it is produced (intermediate dumps). */
  stage?(label: string, image: RawImage | Buffer): void | Promise<void>;
  /** Structured build report (markdown + inline images). */
  reporter?: Reporter;
}

export interface BuildResult {
  name: string;
  seed: number;
  /** Raw generated sheet (template filled by the model). */
  sheet: RawImage;
  /** SPIN_ORDER cells after matting and review/fix. */
  cells: RawImage[];
  spritesheet: RawImage;
  entity: EntityDescriptor;
}

/** Next free char-NNN in the output dir — predictable, sortable filenames
 * for unnamed builds. */
export function nextCharName(dir: string): string {
  const used = new Set<number>();
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    const m = /^char-(\d+)\./.exec(f);
    if (m) used.add(Number(m[1]));
  }
  let n = 1;
  while (used.has(n)) n++;
  return `char-${String(n).padStart(3, "0")}`;
}

export async function buildCharacter(cfg: ResolvedConfig, hooks: BuildHooks = {}): Promise<BuildResult> {
  const log = hooks.log ?? (() => {});
  const progress = hooks.progress ?? (() => () => {});
  const stage = hooks.stage ?? (() => {});
  const report = hooks.reporter;

  const template = await readImage(cfg.template!.image);
  // measure the extraction panel on the CLEAN template (before pasting a
  // reference whose background could fuse with the panel), then scale to
  // the generated sheet's dimensions
  const cleanPanels = findPanels(template);
  const cleanPanel = cleanPanels[cfg.template!.row ?? cleanPanels.length - 1];
  if (cfg.reference && cfg.template!.inputSlot) {
    pasteIntoSlot(template, await readImage(cfg.reference), cfg.template!.inputSlot);
  }
  const prompt = defaultPrompt(Boolean(cfg.reference), cfg.description);
  const name = cfg.name ?? nextCharName(cfg.output);
  const provider = cfg.model?.provider ?? "gemini";
  const seed = cfg.seed;

  // toonout by default — best edges; floodfill is the explicit opt-out.
  // Local ONNX first (no network, no credits), the Replicate endpoint when
  // onnxruntime-node isn't installed, floodfill as the last resort.
  let matting: "local" | "replicate" | "floodfill" = "floodfill";
  if (cfg.matting !== "floodfill") {
    if (await hasLocalToonout()) matting = "local";
    else if (hasReplicateToken()) matting = "replicate";
    else if (cfg.matting === "toonout") {
      log("warning: matting: toonout requested but neither onnxruntime-node nor REPLICATE_API_TOKEN is available — falling back to the built-in color keyer");
    }
  }
  const maxFixes = cfg.check === false ? 0 : Math.max(0, cfg.maxFixes ?? 1);

  report?.log([
    `- provider: \`${provider}\``,
    `- seed: \`${seed}\` (${cfg.seedRolled ? "rolled" : "pinned"})`,
    ...(cfg.description ? [`- description: ${cfg.description}`] : []),
    ...(cfg.reference ? [`- reference: \`${cfg.reference}\``] : []),
    `- matting: \`${matting === "floodfill" ? "floodfill" : `toonout (${matting})`}\``,
    `- review/fix rounds: ${maxFixes}`,
  ].join("\n"));
  report?.log("generation prompt:\n\n```\n" + prompt + "\n```");
  await report?.image("composed template (model input)", template);
  await stage("template", template);

  // one generation pass: model call + extraction into SPIN_ORDER cells
  const done = progress(`${name} · ${provider} · seed ${seed}`, provider === "gemini" ? 45_000 : 60_000);
  let sheet: RawImage;
  try {
    sheet = await generateSheet(template, prompt, { ...cfg.model, seed });
  } finally {
    done(`${name} · generated`);
  }
  const s = sheet.width / template.width;
  const g = cfg.template!.grid;
  const rect = g
    ? { x: g.x, y: g.y, width: g.cellWidth * g.columns, height: g.cellHeight }
    : cleanPanel;
  const panel = rect && {
    x: Math.round(rect.x * s), y: Math.round(rect.y * s),
    width: Math.round(rect.width * s), height: Math.round(rect.height * s),
  };
  let sprites: Record<Direction, RawImage>;
  if (matting !== "floodfill") {
    const inset = 4;
    const rawCells = extractDirections(sheet, { panel, raw: true, inset });
    const rawList = GENERATED_DIRECTIONS.map((d) => rawCells[d]);
    log(matting === "local"
      ? "matting via local birefnet-toonout (onnxruntime)..."
      : "matting via sprited/birefnet-toonout on Replicate (cold boot can take ~2min)...");
    const matted = matting === "local" ? await localToonoutMatting(rawList) : await toonoutMatting(rawList);
    const pad = (img: RawImage): RawImage => {
      const padded = createImage(img.width + 2 * inset, img.height + 2 * inset, [0, 0, 0, 0]);
      paste(padded, img, inset, inset);
      return padded;
    };
    sprites = {} as Record<Direction, RawImage>;
    GENERATED_DIRECTIONS.forEach((d, i) => { sprites[d] = pad(matted[i]); });
    for (const [dst, src] of Object.entries(MIRRORED)) sprites[dst as Direction] = flipX(sprites[src as Direction]);
  } else {
    sprites = extractDirections(sheet, { panel });
  }
  let cells = SPIN_ORDER.map((d) => sprites[d]);

  report?.log(`## generation — seed \`${seed}\``);
  await report?.image("generated sheet", sheet);
  await stage("generated-sheet", sheet);
  await report?.image("extracted spritesheet", makeSpriteSheet(cells));
  await stage("spritesheet", makeSpriteSheet(cells));

  // hand the result to the image model itself: "find errors, fix them,
  // report" — no pre-computed issue list. Each round feeds the previous
  // round's output back; a NO ERRORS reply keeps the current cells.
  for (let f = 1; f <= maxFixes; f++) {
    try {
      const done = progress(`${name} · review & fix${maxFixes > 1 ? ` ${f}/${maxFixes}` : ""}`, 45_000);
      let r;
      try {
        r = await fixSpritesheet(cells, cfg.description, { ...cfg.model, seed });
      } finally {
        done(`${name} · reviewed`);
      }
      report?.log(`## review round ${f}`);
      report?.png("review input — 3x3 grid", r.gridPng);
      await stage(`review${f}-grid`, r.gridPng);
      if (r.report) {
        log(`review: ${r.report.replace(/\s*\n\s*/g, " ")}`);
        report?.log(`review report: ${r.report}`);
      }
      if (r.clean) break;
      cells = r.cells;
      if (r.raw) {
        await report?.image("review output (raw)", r.raw);
        await stage(`review${f}-raw`, r.raw);
      }
      await report?.image("spritesheet after fix", makeSpriteSheet(cells));
      await stage(`review${f}-spritesheet`, makeSpriteSheet(cells));
    } catch (e) {
      log(`review skipped (${e instanceof Error ? e.message : e})`);
      report?.log(`review skipped (${e instanceof Error ? e.message : e})`);
      break;
    }
  }

  const spritesheet = makeSpriteSheet(cells);
  report?.log(`## result — seed \`${seed}\``);
  await report?.image("final spritesheet", spritesheet);
  const entity = makeEntity(name, cells[0].width, cells[0].height, seed);
  return { name, seed, sheet, cells, spritesheet, entity };
}
