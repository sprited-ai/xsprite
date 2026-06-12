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
import { centerOnCanvas, createImage, paste, flipX, scaleNearest, type RawImage } from "./core/image.js";
import { toonoutMatting, hasReplicateToken } from "./node/matting.js";
import { makeSpriteSheet } from "./core/sheet.js";
import { makeEntity } from "./core/entity.js";
import { writeFileSync, readdirSync, existsSync } from "node:fs";
import { readImage, writePng, writeAnimatedWebp, writeBytes } from "./node/io.js";
import { loadConfig, resolveConfig } from "./config.js";
import type { CharacterConfig, ResolvedConfig } from "./config.js";
import { startProgress } from "./node/progress.js";
import { startReport, type Reporter } from "./node/report.js";
import { ZSH, BASH } from "./node/completions.js";
import { generateSheet, defaultPrompt, checkSpritesheet, fixSpritesheet, type SheetCheck } from "./node/generate.js";
import { pasteIntoSlot } from "./core/image.js";

const [cmd, sheetPath, ...rest] = process.argv.slice(2);

// ~417ms per direction — slow enough to actually look at each pose
const TURNTABLE_FPS = 2.4;

function usage(): never {
  console.error('usage: sprited gen char [name] [-d "description"] [-r reference.png] [--seed N] [-o dir] [--sheet] [--matting floodfill|toonout] [--no-check] [--max-fixes N] [--report] [--intermediate]');
  console.error('       sprited build <name> [flags as above]');
  console.error("       sprited build <name.sprited.yaml|json>");
  console.error("       sprited extract <sheet.png> [--row N] [--skip-ref N] -o <dir>");
  console.error("       sprited extract-anim <sheet.png> --frames N [--row N] [--skip-ref N] [--fps N] [--canvas 256] -o <dir>");
  console.error('       sprited check <spritesheet.png> [-d "description"] [--fix [-o out.png]]');
  console.error("       sprited completion [zsh|bash]");
  process.exit(1);
}

if (cmd === "completion") {
  // shell omitted: whatever the user is typing in right now
  const shell = sheetPath ?? (process.env.SHELL?.endsWith("bash") ? "bash" : "zsh");
  if (shell !== "zsh" && shell !== "bash") usage();
  process.stdout.write(shell === "zsh" ? ZSH : BASH);
  process.exit(0);
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
      matting: { type: "string" },
      "no-check": { type: "boolean" },
      "max-fixes": { type: "string" },
      report: { type: "boolean" },
      intermediate: { type: "boolean" },
    },
  });
  if (b.matting !== undefined && b.matting !== "floodfill" && b.matting !== "toonout") {
    throw new Error(`--matting wants "floodfill" or "toonout", got "${b.matting}"`);
  }
  if (b["max-fixes"] !== undefined && !Number.isInteger(Number(b["max-fixes"]))) {
    throw new Error(`--max-fixes wants an integer, got "${b["max-fixes"]}"`);
  }
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
    matting: b.matting as CharacterConfig["matting"],
    check: b["no-check"] ? false : undefined,
    maxFixes: b["max-fixes"] !== undefined ? Number(b["max-fixes"]) : undefined,
    report: b.report || undefined,
    intermediate: b.intermediate || undefined,
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
    ...(cfg.matting && { matting: cfg.matting }),
    ...(cfg.check === false && { check: false }),
    ...(cfg.maxFixes !== undefined && { maxFixes: cfg.maxFixes }),
    ...(cfg.report && { report: true }),
    ...(cfg.intermediate && { intermediate: true }),
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
  const name = cfg.name ?? nextCharName(cfg.output);
  const provider = cfg.model?.provider ?? "gemini";
  let useToonout = cfg.matting === "toonout";
  if (useToonout && !hasReplicateToken()) {
    console.error("warning: matting: toonout requested but no REPLICATE_API_TOKEN found — falling back to the built-in color keyer (lower edge quality on hair/translucency)");
    useToonout = false;
  }

  /** One generation pass: model call + extraction into SPIN_ORDER cells. */
  async function attempt(seed: number, label: string): Promise<{ sheet: RawImage; ordered: RawImage[] }> {
    const progress = startProgress(`${name} · ${provider} · seed ${seed}${label}`, provider === "gemini" ? 45_000 : 60_000);
    let sheet: RawImage;
    try {
      sheet = await generateSheet(template, prompt, { ...cfg.model, seed });
    } finally {
      progress.done(`${name} · generated${label}`);
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
    return { sheet, ordered: SPIN_ORDER.map((d) => sprites[d]) };
  }

  // generate, then hand the result to the image model itself: "find errors,
  // fix them, report" — no pre-computed issue list. maxFixes rounds (default
  // 1), each feeding the previous round's output back; a NO ERRORS reply
  // keeps the current cells untouched.
  const seed = cfg.seed;
  // opt-in build log: every step appended as it happens, images inlined
  const report: Reporter | undefined = cfg.report
    ? startReport(join(cfg.output, `${name}.report.md`), `${name} — build report`)
    : undefined;
  const maxFixes = cfg.check === false ? 0 : Math.max(0, cfg.maxFixes ?? 1);
  // --intermediate: every pipeline image also lands as a numbered PNG
  let stepN = 0;
  const saveStep = async (label: string, img: RawImage | Buffer) => {
    if (!cfg.intermediate) return;
    const file = join(cfg.output, `${name}.intermediate`, `${String(++stepN).padStart(2, "0")}-${label}.png`);
    if (Buffer.isBuffer(img)) writeBytes(file, img);
    else await writePng(file, img);
  };
  report?.log([
    `- provider: \`${provider}\``,
    `- seed: \`${seed}\` (${cfg.seedRolled ? "rolled" : "pinned"})`,
    ...(cfg.description ? [`- description: ${cfg.description}`] : []),
    ...(cfg.reference ? [`- reference: \`${cfg.reference}\``] : []),
    `- matting: \`${useToonout ? "toonout" : "floodfill"}\``,
    `- review/fix rounds: ${maxFixes}`,
  ].join("\n"));
  report?.log("generation prompt:\n\n```\n" + prompt + "\n```");
  await report?.image("composed template (model input)", template);
  await saveStep("template", template);

  const built = await attempt(seed, "");
  report?.log(`## generation — seed \`${seed}\``);
  await report?.image("generated sheet", built.sheet);
  await saveStep("generated-sheet", built.sheet);
  const { sheet } = built;
  let ordered = built.ordered;
  await report?.image("extracted spritesheet", makeSpriteSheet(ordered));
  await saveStep("spritesheet", makeSpriteSheet(ordered));

  for (let f = 1; f <= maxFixes; f++) {
    try {
      const progress = startProgress(`${name} · review & fix${maxFixes > 1 ? ` ${f}/${maxFixes}` : ""}`, 45_000);
      let r;
      try {
        r = await fixSpritesheet(ordered, cfg.description, { ...cfg.model, seed });
      } finally {
        progress.done(`${name} · reviewed`);
      }
      report?.log(`## review round ${f}`);
      report?.png("review input — 3x3 grid", r.gridPng);
      await saveStep(`review${f}-grid`, r.gridPng);
      if (r.report) {
        console.error(`review: ${r.report.replace(/\s*\n\s*/g, " ")}`);
        report?.log(`review report: ${r.report}`);
      }
      if (r.clean) break;
      ordered = r.cells;
      if (r.raw) {
        await report?.image("review output (raw)", r.raw);
        await saveStep(`review${f}-raw`, r.raw);
      }
      await report?.image("spritesheet after fix", makeSpriteSheet(ordered));
      await saveStep(`review${f}-spritesheet`, makeSpriteSheet(ordered));
    } catch (e) {
      console.error(`review skipped (${e instanceof Error ? e.message : e})`);
      report?.log(`review skipped (${e instanceof Error ? e.message : e})`);
      break;
    }
  }
  report?.log(`## result — seed \`${seed}\``);
  await report?.image("final spritesheet", makeSpriteSheet(ordered));
  if (cfg.outputs?.sheet) await writePng(join(cfg.output, cfg.outputs.sheet === true ? `${name}.sheet.png` : cfg.outputs.sheet), sheet);
  await writePng(join(cfg.output, `${name}.spritesheet.png`), makeSpriteSheet(ordered));
  await writeAnimatedWebp(join(cfg.output, `${name}.turntable.webp`), ordered, TURNTABLE_FPS);
  const entity = makeEntity(name, ordered[0].width, ordered[0].height, seed);
  writeFileSync(join(cfg.output, `${name}.entity.json`), JSON.stringify(entity, null, 2) + "\n");
  // the seed that actually produced the kept sheet, not the one we started with
  if (flags) writeFileSync(join(cfg.output, `${name}.sprited.yaml`), buildYaml({ ...cfg, seed }, flags.template, name));
  const exts = ["spritesheet.png", "turntable.webp", "entity.json",
    ...(flags ? ["sprited.yaml"] : []), ...(cfg.report ? ["report.md"] : [])];
  console.log(`"${name}" -> ${cfg.output}/${name}.{${exts.join(",")}}`);
  process.exit(0);
}

if (cmd === "check") {
  // standalone QC: same VLM review the build pipeline runs, exit 1 on defects;
  // --fix hands the sheet to the image model for an in-place repair
  const { values: c } = parseArgs({ args: rest, options: {
    description: { type: "string", short: "d" },
    fix: { type: "boolean" },
    output: { type: "string", short: "o" },
  } });
  const img = await readImage(sheetPath);
  const verdict = await checkSpritesheet(img, c.description);
  if (verdict.ok) {
    console.log("clean");
    process.exit(0);
  }
  for (const i of verdict.issues) console.log(`${i.cell ?? "sheet"} — ${i.note}`);
  if (!c.fix) process.exit(1);
  const strip = extractAnimation(img, 8, { panel: { x: 0, y: 0, width: img.width, height: img.height } });
  const r = await fixSpritesheet(strip, c.description);
  if (r.report) console.error(`fix: ${r.report.replace(/\s*\n\s*/g, " ")}`);
  if (r.clean) {
    console.log("the image model found nothing to fix");
    process.exit(1);
  }
  const out = c.output ?? sheetPath.replace(/\.png$/i, "") + ".fixed.png";
  await writePng(out, makeSpriteSheet(r.cells));
  const after = await checkSpritesheet(makeSpriteSheet(r.cells), c.description);
  console.log(`${after.ok ? "clean after fix" : `${after.issues.length} issue(s) remain after fix`} -> ${out}`);
  process.exit(after.ok ? 0 : 1);
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
