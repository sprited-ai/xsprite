#!/usr/bin/env node
/** xsprite CLI.
 *
 *   xsprite build <character.yaml>
 *   xsprite extract <sheet.png> [--row N] [--skip-ref N] -o <dir>
 *   xsprite extract-anim <sheet.png> --frames 8 [--row N] [--skip-ref N] [--fps 8] -o <dir>
 */
import { parseArgs } from "node:util";
import { join } from "node:path";
import { extractDirections, extractAnimation, SPIN_ORDER } from "./core/extract.js";
import { centerOnCanvas } from "./core/image.js";
import { makeSpriteSheet } from "./core/sheet.js";
import { makeEntity } from "./core/entity.js";
import { writeFileSync } from "node:fs";
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
  console.error('usage: xsprite gen char [name] [-d "description"] [-r reference.png] [--seed N] [-o dir] [--sheet]');
  console.error('       xsprite build <name> [flags as above]');
  console.error("       xsprite build <name.xsprite.yaml|json>");
  console.error("       xsprite extract <sheet.png> [--row N] [--skip-ref N] -o <dir>");
  console.error("       xsprite extract-anim <sheet.png> --frames N [--row N] [--skip-ref N] [--fps N] [--canvas 256] -o <dir>");
  process.exit(1);
}

if (!cmd || !sheetPath) usage();

function configFromFlags(name: string, args: string[]): ResolvedConfig {
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
  return resolveConfig({
    name,
    description: b.description,
    reference: b.reference,
    seed: b.seed === undefined || b.seed === "random" ? undefined : Number(b.seed),
    output: b.output,
    template: b.template,
    model: b.provider ? { provider: b.provider as NonNullable<CharacterConfig["model"]>["provider"] } : undefined,
    outputs: b.sheet ? { sheet: true } : undefined,
  }, process.cwd());
}

if (cmd === "build" || cmd === "gen" || cmd === "generate") {
  let cfg: ResolvedConfig;
  if (cmd === "build") {
    cfg = /\.(ya?ml|json)$/.test(sheetPath) ? loadConfig(sheetPath) : configFromFlags(sheetPath, rest);
  } else {
    // gen char[acter] [name] — everything defaults, flags optional
    if (!/^char(acter)?$/.test(sheetPath)) usage();
    const named = rest[0] !== undefined && !rest[0].startsWith("-");
    cfg = configFromFlags(named ? rest[0] : "character", named ? rest.slice(1) : rest);
  }
  const template = await readImage(cfg.template.image);
  // measure the extraction panel on the CLEAN template (before pasting a
  // reference whose background could fuse with the panel), then scale to
  // the generated sheet's dimensions
  const cleanPanels = (await import("./core/extract.js")).findPanels(template);
  const cleanPanel = cleanPanels[cfg.template.row ?? cleanPanels.length - 1];
  if (cfg.reference && cfg.template.inputSlot) {
    pasteIntoSlot(template, await readImage(cfg.reference), cfg.template.inputSlot);
  }
  const prompt = defaultPrompt(Boolean(cfg.reference), cfg.description);
  const seed = typeof cfg.seed === "number" ? cfg.seed : Math.floor(Math.random() * 2 ** 31);
  const provider = cfg.model?.provider ?? "gemini";
  const progress = startProgress(`${cfg.name} · ${provider} · seed ${seed}`, provider === "gemini" ? 45_000 : 60_000);
  let sheet;
  try {
    sheet = await generateSheet(template, prompt, { ...cfg.model, seed });
  } finally {
    progress.done(`${cfg.name} · generated`);
  }
  if (cfg.outputs?.sheet) await writePng(join(cfg.output, cfg.outputs.sheet === true ? `${cfg.name}.sheet.png` : cfg.outputs.sheet), sheet);
  const s = sheet.width / template.width;
  const g = cfg.template.grid;
  const rect = g
    ? { x: g.x, y: g.y, width: g.cellWidth * g.columns, height: g.cellHeight }
    : cleanPanel;
  const panel = rect && {
    x: Math.round(rect.x * s), y: Math.round(rect.y * s),
    width: Math.round(rect.width * s), height: Math.round(rect.height * s),
  };
  const sprites = extractDirections(sheet, { panel });
  const ordered = SPIN_ORDER.map((d) => sprites[d]);
  await writePng(join(cfg.output, `${cfg.name}.spritesheet.png`), makeSpriteSheet(ordered));
  await writeAnimatedWebp(join(cfg.output, `${cfg.name}.turntable.webp`), ordered, TURNTABLE_FPS);
  const entity = makeEntity(cfg.name, ordered[0].width, ordered[0].height, seed);
  writeFileSync(join(cfg.output, `${cfg.name}.entity.json`), JSON.stringify(entity, null, 2) + "\n");
  console.log(`"${cfg.name}" -> ${cfg.output}/${cfg.name}.{spritesheet.png,turntable.webp,entity.json}`);
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
