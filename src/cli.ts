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
import { readImage, writePng, writeAnimatedWebp } from "./node/io.js";
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
  console.error('usage: sprited gen char [name] [-d "description"] [-r reference.png] [--seed N] [-o dir] [--sheet] [--no-check] [--report]');
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
      "no-check": { type: "boolean" },
      report: { type: "boolean" },
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
    check: b["no-check"] ? false : undefined,
    report: b.report || undefined,
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
    ...(cfg.check === false && { check: false }),
    ...(cfg.report && { report: true }),
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

  // generate → VLM QC → on defects, first a targeted in-place fix by the
  // image model (keeps the character), then — rolled seeds only, a pinned
  // seed is a reproduction request — a fresh-seed regen. Cleanest wins.
  const MAX_ATTEMPTS = 2;
  let seed = cfg.seed;
  // opt-in build log: every step appended as it happens, images inlined
  const report: Reporter | undefined = cfg.report
    ? startReport(join(cfg.output, `${name}.report.md`), `${name} — build report`)
    : undefined;
  report?.log([
    `- provider: \`${provider}\``,
    `- seed: \`${seed}\` (${cfg.seedRolled ? "rolled" : "pinned"})`,
    ...(cfg.description ? [`- description: ${cfg.description}`] : []),
    ...(cfg.reference ? [`- reference: \`${cfg.reference}\``] : []),
    `- matting: \`${useToonout ? "toonout" : "floodfill"}\``,
    `- check: ${cfg.check === false ? "off" : "on"}`,
  ].join("\n"));
  const issuesMd = (issues: SheetCheck["issues"]) =>
    issues.map((i) => `- ${i.cell ? `**${i.cell}** — ` : ""}${i.note}`).join("\n");
  let best: { sheet: RawImage; ordered: RawImage[]; seed: number; issues: SheetCheck["issues"] } | undefined;
  const consider = (cand: NonNullable<typeof best>) => {
    if (!best || cand.issues.length < best.issues.length) best = cand;
  };
  for (let n = 1; ; n++) {
    const built = await attempt(seed, n > 1 ? ` · retry ${n - 1}` : "");
    report?.log(`## attempt ${n} — seed \`${seed}\``);
    await report?.image("generated sheet", built.sheet);
    const strip = makeSpriteSheet(built.ordered);
    await report?.image("extracted spritesheet", strip);
    if (cfg.check === false) { best = { ...built, seed, issues: [] }; break; }
    let verdict: SheetCheck;
    try {
      verdict = await checkSpritesheet(strip, cfg.description);
    } catch (e) {
      console.error(`check skipped (${e instanceof Error ? e.message : e})`);
      report?.log(`check skipped (${e instanceof Error ? e.message : e})`);
      best = { ...built, seed, issues: [] };
      break;
    }
    if (verdict.ok) {
      console.error("check: clean");
      report?.log("check: **clean**");
      best = { ...built, seed, issues: [] };
      break;
    }
    for (const i of verdict.issues) console.error(`check: ${i.cell ?? "sheet"} — ${i.note}`);
    report?.log(`check found ${verdict.issues.length} issue(s):\n\n${issuesMd(verdict.issues)}`);
    consider({ ...built, seed, issues: verdict.issues });
    try {
      const progress = startProgress(`${name} · fixing ${verdict.issues.length} issue(s)`, 45_000);
      let fixed;
      try {
        fixed = await fixSpritesheet(built.ordered, verdict.issues, { ...cfg.model, seed });
      } finally {
        progress.done(`${name} · fixed`);
      }
      if (fixed.report) console.error(`fix: ${fixed.report.replace(/\s*\n\s*/g, " ")}`);
      if (fixed.report) report?.log(`fix report: ${fixed.report}`);
      const ordered = fixed.cells;
      const fixedStrip = makeSpriteSheet(ordered);
      await report?.image("spritesheet after fix", fixedStrip);
      const after = await checkSpritesheet(fixedStrip, cfg.description);
      if (after.ok) {
        console.error("check: clean after fix");
        report?.log("check after fix: **clean**");
        best = { sheet: built.sheet, ordered, seed, issues: [] };
        break;
      }
      for (const i of after.issues) console.error(`check (after fix): ${i.cell ?? "sheet"} — ${i.note}`);
      report?.log(`check after fix — ${after.issues.length} issue(s) remain:\n\n${issuesMd(after.issues)}`);
      consider({ sheet: built.sheet, ordered, seed, issues: after.issues });
    } catch (e) {
      console.error(`fix skipped (${e instanceof Error ? e.message : e})`);
      report?.log(`fix skipped (${e instanceof Error ? e.message : e})`);
    }
    if (!cfg.seedRolled) {
      console.error("check: seed is pinned — keeping the build");
      report?.log("seed is pinned — keeping the build as generated");
      break;
    }
    if (n >= MAX_ATTEMPTS) {
      console.error(`check: keeping the cleanest attempt (seed ${best!.seed}, ${best!.issues.length} issue(s))`);
      break;
    }
    seed = Math.floor(Math.random() * 2 ** 31);
  }
  const { sheet, ordered } = best!;
  seed = best!.seed;
  report?.log(`## result — seed \`${seed}\`, ${best!.issues.length} issue(s)`);
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
  const { cells, report } = await fixSpritesheet(strip, verdict.issues);
  if (report) console.error(`fix: ${report.replace(/\s*\n\s*/g, " ")}`);
  const out = c.output ?? sheetPath.replace(/\.png$/i, "") + ".fixed.png";
  await writePng(out, makeSpriteSheet(cells));
  const after = await checkSpritesheet(makeSpriteSheet(cells), c.description);
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
