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
import { readImage, writePng, writeAnimatedWebp } from "./node/io.js";
import { loadConfig } from "./config.js";
import { generateSheet, defaultPrompt } from "./node/generate.js";
import { pasteIntoSlot } from "./core/image.js";

const [cmd, sheetPath, ...rest] = process.argv.slice(2);

function usage(): never {
  console.error("usage: xsprite build <character.yaml|json>");
  console.error("       xsprite extract <sheet.png> [--row N] [--skip-ref N] -o <dir>");
  console.error("       xsprite extract-anim <sheet.png> --frames N [--row N] [--skip-ref N] [--fps N] [--canvas 256] -o <dir>");
  process.exit(1);
}

if (!cmd || !sheetPath) usage();

if (cmd === "build") {
  const cfg = loadConfig(sheetPath);
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
  console.log(`generating "${cfg.name}" via ${cfg.model?.provider ?? "gemini"}...`);
  const sheet = await generateSheet(template, prompt, cfg.model ?? {});
  if (cfg.outputs?.sheet) await writePng(join(cfg.output, cfg.outputs.sheet), sheet);
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
  for (const d of SPIN_ORDER) await writePng(join(cfg.output, `${d}.png`), sprites[d]);
  await writeAnimatedWebp(join(cfg.output, "spin.webp"), SPIN_ORDER.map((d) => sprites[d]), 6);
  console.log(`"${cfg.name}" -> ${cfg.output} (8 sprites + spin.webp)`);
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
  for (const d of SPIN_ORDER) await writePng(join(v.output, `${d}.png`), sprites[d]);
  await writeAnimatedWebp(join(v.output, "spin.webp"), SPIN_ORDER.map((d) => sprites[d]), 6);
  console.log(`8 sprites -> ${v.output} (+ spin.webp) (SW/W/NW mirrored)`);
} else if (cmd === "extract-anim") {
  if (!v.frames) usage();
  const size = v.canvas !== undefined ? Number(v.canvas) : 256;
  const fps = v.fps !== undefined ? Number(v.fps) : 8;
  const frames = extractAnimation(sheet, Number(v.frames), opts).map((f) => centerOnCanvas(f, size));
  for (const [i, f] of frames.entries()) await writePng(join(v.output, `frame-${String(i).padStart(2, "0")}.png`), f);
  await writeAnimatedWebp(join(v.output, "anim.webp"), frames, fps);
  console.log(`${frames.length} frames -> ${v.output} (${size}x${size}, anim.webp @${fps}fps)`);
} else usage();
