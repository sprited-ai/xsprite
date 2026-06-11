#!/usr/bin/env node
/** xsprite CLI.
 *
 *   xsprite build <character.yaml>
 *   xsprite extract <sheet.png> [--row N] [--skip-ref N] [--gif spin.gif] -o <dir>
 *   xsprite extract-anim <sheet.png> --frames 8 [--row N] [--skip-ref N] [--fps 8] -o <dir>
 */
import { parseArgs } from "node:util";
import { join } from "node:path";
import { extractDirections, extractAnimation, SPIN_ORDER } from "./core/extract.js";
import { encodeGif, turnaroundGif } from "./core/assemble.js";
import { centerOnCanvas } from "./core/image.js";
import { readImage, writePng, writeBytes, writeAnimatedWebp } from "./node/io.js";
import { loadConfig } from "./config.js";
import { generateSheet, defaultPrompt } from "./node/generate.js";
import { pasteIntoSlot } from "./core/image.js";

const [cmd, sheetPath, ...rest] = process.argv.slice(2);

function usage(): never {
  console.error("usage: xsprite build <character.yaml|json>");
  console.error("       xsprite extract <sheet.png> [--row N] [--skip-ref N] [--gif name.gif] -o <dir>");
  console.error("       xsprite extract-anim <sheet.png> --frames N [--row N] [--skip-ref N] [--fps N] [--canvas 256] -o <dir>");
  process.exit(1);
}

if (!cmd || !sheetPath) usage();

if (cmd === "build") {
  const cfg = loadConfig(sheetPath);
  const template = await readImage(cfg.template.image);
  if (cfg.reference && cfg.template.inputSlot) {
    pasteIntoSlot(template, await readImage(cfg.reference), cfg.template.inputSlot);
  }
  const prompt = defaultPrompt(Boolean(cfg.reference), cfg.description);
  console.log(`generating "${cfg.name}" via ${cfg.model?.provider ?? "gemini"}...`);
  const sheet = await generateSheet(template, prompt, cfg.model ?? {});
  if (cfg.outputs?.sheet) await writePng(join(cfg.output, cfg.outputs.sheet), sheet);
  const sprites = extractDirections(sheet, { row: cfg.template.row });
  for (const d of SPIN_ORDER) await writePng(join(cfg.output, `${d}.png`), sprites[d]);
  const gif = cfg.outputs?.gif ?? "spin.gif";
  writeBytes(join(cfg.output, gif), turnaroundGif(sprites));
  console.log(`"${cfg.name}" -> ${cfg.output} (8 sprites + ${gif})`);
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
    gif: { type: "string" },
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
  if (v.gif) writeBytes(join(v.output, v.gif), turnaroundGif(sprites));
  console.log(`8 sprites -> ${v.output}${v.gif ? ` (+ ${v.gif})` : ""} (SW/W/NW mirrored)`);
} else if (cmd === "extract-anim") {
  if (!v.frames) usage();
  const size = v.canvas !== undefined ? Number(v.canvas) : 256;
  const fps = v.fps !== undefined ? Number(v.fps) : 8;
  const frames = extractAnimation(sheet, Number(v.frames), opts).map((f) => centerOnCanvas(f, size));
  for (const [i, f] of frames.entries()) await writePng(join(v.output, `frame-${String(i).padStart(2, "0")}.png`), f);
  await writeAnimatedWebp(join(v.output, "anim.webp"), frames, fps);
  writeBytes(join(v.output, "anim.gif"), encodeGif(frames, { delayMs: Math.round(1000 / fps), scale: 1 }));
  console.log(`${frames.length} frames -> ${v.output} (${size}x${size}, anim.webp + anim.gif @${fps}fps)`);
} else usage();
