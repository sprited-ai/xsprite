/** Model providers: composed template in → filled sheet out. */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { crop, createImage, paste, scaleNearest, type RawImage } from "../core/image.js";
import { keyCell } from "../core/keyer.js";
import { SPIN_ORDER } from "../core/extract.js";
import { decodeImage, encodePng } from "./io.js";
import { PACKAGE_ROOT } from "./pkg.js";

export type Provider = "gemini" | "novita-seedream" | "novita-qwen";

const DEFAULT_MODEL: Record<Provider, string> = {
  gemini: "gemini-3-pro-image-preview",
  "novita-seedream": "seedream-4.0",
  "novita-qwen": "qwen-image-edit",
};
const DEFAULT_ENV: Record<Provider, string> = {
  gemini: "GEMINI_API_KEY",
  "novita-seedream": "NOVITA_API_KEY",
  "novita-qwen": "NOVITA_API_KEY",
};

function apiKey(envKey: string): string {
  if (process.env[envKey]) return process.env[envKey]!;
  for (const dir of [process.cwd(), PACKAGE_ROOT]) {
    const file = join(dir, ".env");
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.startsWith(`${envKey}=`)) return line.slice(envKey.length + 1).trim();
    }
  }
  throw new Error(`no ${envKey} in env, ./.env, or sprited/.env`);
}

export interface GenerateOptions {
  provider?: Provider;
  model?: string;
  envKey?: string;
  seed?: number;
}

export async function generateSheet(template: RawImage, prompt: string, opts: GenerateOptions = {}): Promise<RawImage> {
  const provider = opts.provider ?? "gemini";
  const model = opts.model ?? DEFAULT_MODEL[provider];
  const key = apiKey(opts.envKey ?? DEFAULT_ENV[provider]);
  const png = await encodePng(template);
  const b64 = png.toString("base64");

  if (provider === "gemini") {
    // the model occasionally answers with no image part — one retry covers it
    for (let attempt = 0; ; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: "image/png", data: b64 } },
            { text: prompt },
          ] }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            ...(opts.seed !== undefined && { seed: opts.seed }),
          },
        }),
      });
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json() as any;
    for (const part of json.candidates?.[0]?.content?.parts ?? []) {
      const d = part.inlineData ?? part.inline_data;
      if (d) return decodeImage(Buffer.from(d.data, "base64"));
    }
    if (attempt < 1) continue;
    throw new Error("gemini returned no image");
    }
  }

  if (provider === "novita-seedream") {
    const res = await fetch("https://api.novita.ai/v3/seedream-4.0", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        prompt,
        images: [`data:image/png;base64,${b64}`],
        size: `${template.width}x${template.height}`,
        watermark: false,
        ...(opts.seed !== undefined && { seed: opts.seed }),
      }),
    });
    if (!res.ok) throw new Error(`seedream ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const { images } = await res.json() as { images: string[] };
    return decodeImage(await (await fetch(images[0])).arrayBuffer());
  }

  // novita-qwen (async task + poll)
  const submit = await fetch(`https://api.novita.ai/v3/async/${model}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      prompt, image: `data:image/png;base64,${b64}`, output_format: "png",
      ...(opts.seed !== undefined && { seed: opts.seed }),
    }),
  });
  if (!submit.ok) throw new Error(`qwen ${submit.status}: ${(await submit.text()).slice(0, 300)}`);
  const { task_id } = await submit.json() as { task_id: string };
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const poll = await fetch(`https://api.novita.ai/v3/async/task-result?task_id=${task_id}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const json = await poll.json() as any;
    const status = json.task?.status;
    if (status === "TASK_STATUS_SUCCEED") {
      return decodeImage(await (await fetch(json.images[0].image_url)).arrayBuffer());
    }
    if (status === "TASK_STATUS_FAILED") throw new Error(`qwen failed: ${JSON.stringify(json).slice(0, 200)}`);
  }
  throw new Error("qwen poll timeout");
}

export interface SheetCheck {
  ok: boolean;
  issues: { cell?: string; note: string }[];
}

/** Screen-relative facing per SPIN_ORDER slot, this template's convention:
 * the turnaround rotates clockwise toward screen-right (verified on lisa). */
const FACINGS = ["front", "front-right", "right", "back-right", "back", "back-left", "left", "front-left"] as const;

/** Front/back component of a facing: front=2 ... side=0 ... back=-2. Only
 * this axis enters the verdict — tested on the same sheet twice, the VLM's
 * left/right reading of pixel-art profiles flips between runs, while
 * front-vs-back (face visible or not) is stable. */
const FRONTNESS: Record<string, number> = {
  front: 2, "front-left": 1, "front-right": 1, left: 0, right: 0,
  "back-left": -1, "back-right": -1, back: -2,
};
/** Expected front/back per SPIN_ORDER slot (S SE E NE N NW W SW). */
const EXPECTED_FRONTNESS = [2, 1, 0, -1, -2, -1, 0, 1];

async function vlmJson(b64: string, key: string, prompt: string): Promise<any> {
  // the model occasionally breaks its own JSON (unescaped quotes in a note) —
  // one fresh call covers it
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: "image/png", data: b64 } },
            { text: prompt },
          ] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
      });
    if (!res.ok) throw new Error(`check ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json() as any;
    const text = (json.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
    try {
      return JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
    } catch {
      if (attempt >= 1) throw new Error(`check: unparseable VLM reply: ${text.slice(0, 120)}`);
    }
  }
}

const slotName = (i: number) => (FACINGS[i] ? `${FACINGS[i]} view (${SPIN_ORDER[i]})` : `cell ${i}`);

/** Facing + per-cell defects + identity drift. */
async function checkFacingAndDefects(b64: string, key: string, description?: string): Promise<SheetCheck["issues"]> {
  const prompt =
    "This image is a horizontal strip of 8 cells, numbered 0-7 left to right, " +
    "each showing the same game character from a different angle." +
    (description ? ` The character: ${description}.` : "") +
    "\nFor each cell report:\n" +
    `- facing: one of ${FACINGS.join(", ")} — screen-relative: "front" = face toward the viewer, ` +
    '"left" = profile looking at the image\'s left edge, "back" = back of the head\n' +
    "- defects: real rendering mistakes only (extra/missing/garbled limbs or face, a second " +
    "character in the cell, leftover background patches, head or feet cut off). [] if clean.\n" +
    'Also "identity": ways the character is NOT the same across all 8 cells — outfit, colors, or ' +
    "proportions that change between cells (allowing for the viewing angle). [] if consistent.\n" +
    'Reply as JSON: {"cells": [{"cell": 0, "facing": "front", "defects": []}, ...], "identity": []}';
  const parsed = await vlmJson(b64, key, prompt) as {
    cells?: { cell?: number; facing?: string; defects?: string[] }[];
    identity?: string[];
  };
  const issues: SheetCheck["issues"] = [];
  (parsed.cells ?? []).forEach((c, idx) => {
    const i = c.cell ?? idx;
    const got = FRONTNESS[c.facing ?? ""];
    if (got !== undefined && i < EXPECTED_FRONTNESS.length && Math.abs(got - EXPECTED_FRONTNESS[i]) > 1) {
      issues.push({ cell: slotName(i), note: `faces ${c.facing}, slot expects ${FACINGS[i]}` });
    }
    for (const note of c.defects ?? []) issues.push({ cell: slotName(i), note });
  });
  for (const note of parsed.identity ?? []) issues.push({ note });
  return issues;
}

/** Attached-part consistency (wings, tails, hats...). The VLM describes each
 * part per cell with a coarse outline/spread vocabulary — independently, no
 * cross-cell judgment — and cells disagreeing with the majority are flagged
 * here. Catches e.g. slim fairy wings that turn into broad butterfly wings in
 * the back view, which "is this consistent?" questions rationalize away as
 * perspective (tested: they pass it, this catches it). */
async function checkPartConsistency(b64: string, key: string): Promise<SheetCheck["issues"]> {
  const prompt =
    "This image is a horizontal strip of 8 cells, numbered 0-7 left to right, one game character rotating in place.\n" +
    "For each cell, describe each attached part or accessory (wings, tail, hat, weapon, bag — not body or clothes) " +
    "with exactly these fields:\n" +
    '- name (same name for the same part in every cell)\n' +
    '- outline: "pointed" | "rounded" | "square" | "irregular"\n' +
    '- spread: "tall" (clearly taller than wide) | "wide" (clearly wider than tall) | "even"\n' +
    "Describe only what is visible in that cell, independently — do not harmonize across cells.\n" +
    'Reply as JSON: {"cells": [{"cell": 0, "parts": [{"name": "wings", "outline": "...", "spread": "..."}]}, ...]}';
  const parsed = await vlmJson(b64, key, prompt) as {
    cells?: { cell?: number; parts?: { name?: string; outline?: string; spread?: string }[] }[];
  };
  const OUTLINES = ["pointed", "rounded", "square", "irregular"];
  const SPREADS = ["tall", "wide", "even"];
  const seen: Record<string, { cell: number; outline?: string; spread?: string }[]> = {};
  (parsed.cells ?? []).forEach((c, idx) => {
    for (const p of c.parts ?? []) {
      if (!p.name) continue;
      (seen[p.name.trim().toLowerCase()] ??= []).push({ cell: c.cell ?? idx, outline: p.outline, spread: p.spread });
    }
  });
  const issues: SheetCheck["issues"] = [];
  for (const [part, list] of Object.entries(seen)) {
    for (const [field, valid] of [["outline", OUTLINES], ["spread", SPREADS]] as const) {
      const obs = list.filter((e) => valid.includes(e[field] ?? ""));
      const counts = new Map<string, number>();
      for (const e of obs) counts.set(e[field]!, (counts.get(e[field]!) ?? 0) + 1);
      const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      // a clear majority with dissenting cells = the part changes look mid-turnaround
      if (!majority || majority[1] < 5) continue;
      for (const e of obs.filter((e) => e[field] !== majority[0])) {
        issues.push({ cell: slotName(e.cell), note: `${part} looks ${e[field]} here but ${majority[0]} in the other cells` });
      }
    }
  }
  return issues;
}

/** Post-generation QC. The VLM only *observes* — facings, defects, part
 * descriptions; verdicts are computed in code from the observations. */
export async function checkSpritesheet(sheet: RawImage, description?: string): Promise<SheetCheck> {
  const key = apiKey("GEMINI_API_KEY");
  const b64 = (await encodePng(sheet)).toString("base64");
  // part observation is flaky on borderline shapes even at temperature 0 —
  // three independent passes, union of findings
  const [facing, ...parts] = await Promise.all([
    checkFacingAndDefects(b64, key, description),
    checkPartConsistency(b64, key),
    checkPartConsistency(b64, key),
    checkPartConsistency(b64, key),
  ]);
  const issues = [...facing, ...parts.flat()];
  const deduped = [...new Map(issues.map((i) => [`${i.cell ?? ""}|${i.note}`, i])).values()];
  return { ok: deduped.length === 0, issues: deduped };
}

/** 3x3 compass layout for the fix round-trip: a 1x8 strip is 5:1 and the
 * editor's vision encoder starves each cell of pixels; near-square keeps
 * per-cell detail. Position encodes direction, a label under each view
 * spells it out, the center stays empty. */
const FIX_GRID: (number | null)[][] = (() => {
  const at = (d: string) => SPIN_ORDER.indexOf(d as typeof SPIN_ORDER[number]);
  return [
    [at("NW"), at("N"), at("NE")],
    [at("W"), null, at("E")],
    [at("SW"), at("S"), at("SE")],
  ];
})();

/** Exported for inspection/tests — `fixSpritesheet` is the real consumer. */
export async function buildFixGrid(cells: RawImage[], barH: number): Promise<Buffer> {
  const { width: cw, height: ch } = cells[0];
  const slotH = ch + barH;
  const overlays: sharp.OverlayOptions[] = [];
  let labels = "";
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const slot = FIX_GRID[r][c];
      if (slot === null) continue;
      overlays.push({ input: await encodePng(cells[slot]), left: c * cw, top: r * slotH });
      labels +=
        `<text x="${Math.round((c + 0.5) * cw)}" y="${Math.round(r * slotH + ch + barH * 0.7)}" ` +
        `font-family="sans-serif" font-size="${Math.round(barH * 0.5)}" text-anchor="middle" fill="black">${FACINGS[slot]}</text>`;
    }
  }
  const svg = `<svg width="${cw * 3}" height="${slotH * 3}" xmlns="http://www.w3.org/2000/svg">${labels}</svg>`;
  overlays.push({ input: Buffer.from(svg), left: 0, top: 0 });
  // mid-gray 128,128,128 — the neutral gray the model already knows from the
  // template's sprite panels, and translucent parts stay visible against it
  return sharp({
    create: { width: cw * 3, height: slotH * 3, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 1 } },
  }).composite(overlays).png().toBuffer();
}

/** Slice a (possibly rescaled) fixed grid back into SPIN_ORDER cells: crop
 * each slot, drop its label strip, key the background, restore cell size. */
function sliceFixGrid(img: RawImage, cellWidth: number, cellHeight: number, barH: number): RawImage[] {
  const sw = img.width / 3, sh = img.height / 3;
  const contentH = sh * (cellHeight / (cellHeight + barH));
  const out: RawImage[] = new Array(8);
  const inset = Math.max(2, Math.round(sw / 64));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const slot = FIX_GRID[r][c];
      if (slot === null) continue;
      const inner = crop(img,
        Math.round(c * sw) + inset, Math.round(r * sh) + inset,
        Math.round(sw) - 2 * inset, Math.round(contentH) - 2 * inset);
      const keyed = keyCell(inner);
      const padded = createImage(Math.round(sw), Math.round(contentH), [0, 0, 0, 0]);
      paste(padded, keyed, inset, inset);
      out[slot] = padded.width === cellWidth ? padded : scaleNearest(padded, cellWidth / padded.width);
    }
  }
  return out;
}

/** Self-review repair: hand the views to the image model with an open "find
 * errors, fix them, report" brief — the model spots and repairs defects in
 * one pass, no pre-computed issue list. When it answers NO ERRORS the
 * original cells are returned untouched (re-slicing a no-op edit would only
 * add pixel drift). */
export async function fixSpritesheet(
  cells: RawImage[], description?: string, opts: GenerateOptions = {},
): Promise<{ cells: RawImage[]; report?: string; clean: boolean; gridPng: Buffer; raw?: RawImage }> {
  const model = opts.model ?? DEFAULT_MODEL.gemini;
  const key = apiKey(opts.envKey ?? "GEMINI_API_KEY");
  const { width: cw, height: ch } = cells[0];
  const barH = Math.max(24, Math.round(ch * 0.1));
  const gridPng = await buildFixGrid(cells, barH);
  const b64 = gridPng.toString("base64");
  const prompt =
    "This is a 3x3 grid of views of one game character; the label under each view names its " +
    "facing direction, the center cell is empty." +
    (description ? ` The character: ${description}.` : "") +
    "\nCan you look at the image and see if there are any errors — anatomy glitches, a view facing " +
    "the wrong direction for its label, parts (wings, tail, hat, ...) that change size, shape, or " +
    "style between views, leftover background, cropped heads or feet?\n" +
    "If there are errors, fix them and report the changes in text. Keep everything else exactly " +
    "as it is: same character, same art style, same grid layout, same labels, same image size, " +
    'same background. If there are no errors, reply with the text "NO ERRORS".';
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: "image/png", data: b64 } },
            { text: prompt },
          ] }],
          generationConfig: {
            responseModalities: ["IMAGE", "TEXT"],
            ...(opts.seed !== undefined && { seed: opts.seed }),
          },
        }),
      });
    if (!res.ok) throw new Error(`fix ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json() as any;
    let image: RawImage | undefined;
    let report = "";
    for (const part of json.candidates?.[0]?.content?.parts ?? []) {
      const d = part.inlineData ?? part.inline_data;
      if (d) image = await decodeImage(Buffer.from(d.data, "base64"));
      if (part.text) report += part.text;
    }
    const text = report.trim() || undefined;
    if (/\bno errors?\b/i.test(report)) return { cells, report: text, clean: true, gridPng, raw: image };
    if (image) return { cells: sliceFixGrid(image, cw, ch, barH), report: text, clean: false, gridPng, raw: image };
    if (attempt >= 1) throw new Error("fix: model returned no image");
  }
}

export function defaultPrompt(hasReference: boolean, description?: string): string {
  // Terse prompts, proven with NBP (see blog "SpriteDX - New Horizon Work").
  // Heavier instructions make weaker editors recompose the canvas instead of
  // filling blanks — keep these minimal and let the template carry the spec.
  const base = hasReference
    ? "fill in bottom characters. don't touch the top half."
    : "on the bottom create a new character while keeping top half the same. " +
      "The bottom character should be similar in style with top character's vibe.";
  return description ? `${base}\n\n${description}` : base;
}
