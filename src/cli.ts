#!/usr/bin/env node
/** sprited CLI.
 *
 *   sprited build <character.yaml>
 *   sprited extract <sheet.png> [--row N] [--skip-ref N] -o <dir>
 *   sprited extract-anim <sheet.png> --frames 8 [--row N] [--skip-ref N] [--fps 8] -o <dir>
 */
import { parseArgs } from "node:util";
import { join, relative } from "node:path";
import YAML from "yaml";
import { extractDirections, extractAnimation, SPIN_ORDER, GENERATED_DIRECTIONS, MIRRORED, type Direction } from "./core/extract.js";
import { centerOnCanvas, createImage, paste, flipX, type RawImage } from "./core/image.js";
import { toonoutMatting, hasReplicateToken } from "./node/matting.js";
import { makeSpriteSheet } from "./core/sheet.js";
import { makeEntity } from "./core/entity.js";
import { writeFileSync, readdirSync, existsSync } from "node:fs";
import { readImage, writePng, writeAnimatedWebp } from "./node/io.js";
import { loadConfig, resolveConfig } from "./config.js";
import type { CharacterConfig, ResolvedConfig } from "./config.js";
import { startProgress } from "./node/progress.js";
import { generateSheet, defaultPrompt } from "./node/generate.js";
import { pasteIntoSlot } from "./core/image.js";

const [cmd, sheetPath, ...rest] = process.argv.slice(2);

// ~417ms per direction — slow enough to actually look at each pose
const TURNTABLE_FPS = 2.4;

function usage(): never {
  console.error('usage: sprited gen char [name] [-d "description"] [-r reference.png] [--seed N] [-o dir] [--sheet]');
  console.error('       sprited build <name> [flags as above]');
  console.error("       sprited build <name.sprited.yaml|json>");
  console.error("       sprited extract <sheet.png> [--row N] [--skip-ref N] -o <dir>");
  console.error("       sprited extract-anim <sheet.png> --frames N [--row N] [--skip-ref N] [--fps N] [--canvas 256] -o <dir>");
  process.exit(1);
}

if (!cmd || !sheetPath) usage();

/** Next free char-NNN in the output dir — predictable, sortable filenames
 * for unnamed builds. */
function nextCharName(dir: string): string {
  const used = new Set<number>();
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    const m = /^char-(\d+)\./.exec(f);
    if (m) used.add(Number(m[1]));
  }
  let n = 1;
  while (used.has(n)) n++;
  return `char-${String(n).padStart(3, "0")}`;
}

function configFromFlags(name: string | undefined, args: string[]): { cfg: ResolvedConfig; template?: string } {
  const { values: b } = parseArgs({
    args,
    options: {
      description: { type: "string", short: "d" },
      reference: { type: "string", short: "r" },
      seed: { type: "string" },
      output: { type: "string", short: "o" },
      sheet: { type: "boolean" },
      template: { type: "string" },
      provider: { type: "string" },
    },
  });
  if (b.seed !== undefined && b.seed !== "random" && !Number.isInteger(Number(b.seed))) {
    throw new Error(`--seed wants an integer or "random", got "${b.seed}"`);
  }
  const cfg = resolveConfig({
    name,
    description: b.description,
    reference: b.reference,
    seed: b.seed === undefined || b.seed === "random" ? undefined : Number(b.seed),
    output: b.output ?? ".",
    template: b.template,
    model: b.provider ? { provider: b.provider as NonNullable<CharacterConfig["model"]>["provider"] } : undefined,
    outputs: b.sheet ? { sheet: true } : undefined,
  }, process.cwd());
  // resolveConfig swaps the template name for its spec — keep the name for the yaml
  return { cfg, template: b.template };
}

/** Flag builds drop a config next to the outputs, with the resolved name and
 * seed baked in — `sprited build <name>.sprited.yaml` reruns the exact build.
 * Paths are written relative to the yaml, which is how loadConfig reads them. */
function buildYaml(cfg: ResolvedConfig, templateName: string | undefined, name: string): string {
  return YAML.stringify({
    name,
    ...(cfg.description && { description: cfg.description }),
    ...(cfg.reference && { reference: relative(cfg.output, cfg.reference) }),
    seed: cfg.seed,
    ...(templateName && { template: templateName }),
    ...(cfg.model?.provider && { model: { provider: cfg.model.provider } }),
    ...(cfg.outputs?.sheet && { outputs: { sheet: cfg.outputs.sheet } }),
  });
}

if (cmd === "build" || cmd === "gen" || cmd === "generate") {
  let cfg: ResolvedConfig;
  // set for flag-driven builds (vs a config file) — those also write a yaml
  let flags: { cfg: ResolvedConfig; template?: string } | undefined;
  if (cmd === "build") {
    if (/\.(ya?ml|json)$/.test(sheetPath)) {
      cfg = loadConfig(sheetPath);
    } else {
      flags = configFromFlags(sheetPath, rest);
      cfg = flags.cfg;
    }
  } else {
    // gen char[acter] [name] — everything defaults, flags optional
    if (!/^char(acter)?$/.test(sheetPath)) usage();
    const named = rest[0] !== undefined && !rest[0].startsWith("-");
    flags = configFromFlags(named ? rest[0] : undefined, named ? rest.slice(1) : rest);
    cfg = flags.cfg;
  }
  const template = await readImage(cfg.template!.image);
  // measure the extraction panel on the CLEAN template (before pasting a
  // reference whose background could fuse with the panel), then scale to
  // the generated sheet's dimensions
  const cleanPanels = (await import("./core/extract.js")).findPanels(template);
  const cleanPanel = cleanPanels[cfg.template!.row ?? cleanPanels.length - 1];
  if (cfg.reference && cfg.template!.inputSlot) {
    pasteIntoSlot(template, await readImage(cfg.reference), cfg.template!.inputSlot);
  }
  const prompt = defaultPrompt(Boolean(cfg.reference), cfg.description);
  const { seed } = cfg;
  const name = cfg.name ?? nextCharName(cfg.output);
  const provider = cfg.model?.provider ?? "gemini";
  const progress = startProgress(`${name} · ${provider} · seed ${seed}`, provider === "gemini" ? 45_000 : 60_000);
  let sheet;
  try {
    sheet = await generateSheet(template, prompt, { ...cfg.model, seed });
  } finally {
    progress.done(`${name} · generated`);
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
  let useToonout = cfg.matting === "toonout";
  if (useToonout && !hasReplicateToken()) {
    console.error("warning: matting: toonout requested but no REPLICATE_API_TOKEN found — falling back to the built-in color keyer (lower edge quality on hair/translucency)");
    useToonout = false;
  }
  let sprites: Record<Direction, RawImage>;
  if (useToonout) {
    const inset = 4;
    const rawCells = extractDirections(sheet, { panel, raw: true, inset });
    const rawList = GENERATED_DIRECTIONS.map((d) => rawCells[d]);
    console.error("matting via sprited/birefnet-toonout (cold boot can take ~2min)...");
    const matted = await toonoutMatting(rawList);
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
  const ordered = SPIN_ORDER.map((d) => sprites[d]);
  if (cfg.outputs?.sheet) await writePng(join(cfg.output, cfg.outputs.sheet === true ? `${name}.sheet.png` : cfg.outputs.sheet), sheet);
  await writePng(join(cfg.output, `${name}.spritesheet.png`), makeSpriteSheet(ordered));
  await writeAnimatedWebp(join(cfg.output, `${name}.turntable.webp`), ordered, TURNTABLE_FPS);
  const entity = makeEntity(name, ordered[0].width, ordered[0].height, seed);
  writeFileSync(join(cfg.output, `${name}.entity.json`), JSON.stringify(entity, null, 2) + "\n");
  if (flags) writeFileSync(join(cfg.output, `${name}.sprited.yaml`), buildYaml(cfg, flags.template, name));
  const exts = ["spritesheet.png", "turntable.webp", "entity.json", ...(flags ? ["sprited.yaml"] : [])];
  console.log(`"${name}" -> ${cfg.output}/${name}.{${exts.join(",")}}`);
  process.exit(0);
}

const { values: v } = parseArgs({
  args: rest,
  options: {
    output: { type: "string", short: "o" },
    row: { type: "string" },
    "skip-ref": { type: "string" },
    frames: { type: "string" },
    fps: { type: "string" },
    canvas: { type: "string" },
  },
});
if (!v.output) usage();

const sheet = await readImage(sheetPath);
const opts = {
  row: v.row !== undefined ? Number(v.row) : undefined,
  skipRef: v["skip-ref"] !== undefined ? Number(v["skip-ref"]) : undefined,
};

if (cmd === "extract") {
  const sprites = extractDirections(sheet, opts);
  const ordered = SPIN_ORDER.map((d) => sprites[d]);
  await writePng(join(v.output, "spritesheet.png"), makeSpriteSheet(ordered));
  await writeAnimatedWebp(join(v.output, "turntable.webp"), ordered, TURNTABLE_FPS);
  console.log(`spritesheet.png [${SPIN_ORDER.join(" ")}] + turntable.webp -> ${v.output} (SW/W/NW mirrored)`);
} else if (cmd === "extract-anim") {
  if (!v.frames) usage();
  const size = v.canvas !== undefined ? Number(v.canvas) : 256;
  const fps = v.fps !== undefined ? Number(v.fps) : 8;
  const frames = extractAnimation(sheet, Number(v.frames), opts).map((f) => centerOnCanvas(f, size));
  await writePng(join(v.output, "spritesheet.png"), makeSpriteSheet(frames));
  await writeAnimatedWebp(join(v.output, "anim.webp"), frames, fps);
  console.log(`${frames.length} frames -> ${v.output} (spritesheet.png + anim.webp @${fps}fps)`);
} else usage();
