/** Character config — declare a character once, `sprited build` does the rest:
 * compose reference into the template, generate via the model, extract, key,
 * assemble. JSON or YAML. */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import YAML from "yaml";
import { PACKAGE_ROOT } from "./node/pkg.js";
import { TEMPLATE_GEOMETRY, type TemplateGeometry, type Slot } from "./core/templates.js";

export type { Slot };

/** Geometry (src/core/templates.ts — platform-neutral) plus the image path,
 * which is a Node concern: builtins anchor at the package root, a browser
 * app fetches the PNG as an asset instead. */
export interface TemplateSpec extends TemplateGeometry {
  image: string;
}

/** Templates shipped with the package — name them instead of spelling out
 * image paths and slot coordinates. */
export const BUILTIN_TEMPLATES: Record<string, TemplateSpec> = Object.fromEntries(
  Object.entries(TEMPLATE_GEOMETRY).map(([name, geometry]) => [
    name, { image: join(PACKAGE_ROOT, "templates", `sprited-${name}.png`), ...geometry },
  ]),
);

export const DEFAULT_TEMPLATE = "8dir-v1";

export interface CharacterConfig {
  /** Output/entity name. Omit for the next free char-NNN in the output dir. */
  name?: string;
  /** Reference image path. Omit to let the model invent the character. */
  reference?: string;
  /** Extra guidance, e.g. "Character is Lisa and she is a fairy". */
  description?: string;
  /** Generation seed. A number reproduces a build; "random" or omitted rolls
   * a fresh one. The resolved value lands in <name>.entity.json. */
  seed?: number | "random";
  /** Output directory. Defaults to the config file's directory. */
  output?: string;

  /** A builtin template name ("8dir-v1"), a full spec, or omitted for the
   * default builtin. */
  template?: string | TemplateSpec;

  model?: {
    provider?: "gemini" | "novita-seedream" | "novita-qwen";
    id?: string;
    envKey?: string;
  };

  /** Background removal: "toonout" (default — BiRefNet anime matting via the
   * Replicate endpoint, needs REPLICATE_API_TOKEN, best edge quality; builds
   * without a token quietly fall back to floodfill) or "floodfill" (fast,
   * dependency-free, browser-parity). */
  matting?: "floodfill" | "toonout";

  /** Post-generation QC (default true): a VLM reviews the assembled
   * spritesheet for defects; on a rolled (non-pinned) seed, defects trigger
   * regeneration with a fresh seed, keeping the cleanest attempt. */
  check?: boolean;

  /** Max in-place repair rounds per generation attempt when the check finds
   * defects (default 1; 0 = check only, defects go straight to a fresh-seed
   * regeneration). Each round feeds the previous round's output back. */
  maxFixes?: number;

  /** Write <name>.report.md — a streaming build log with every generated
   * image inlined as a data URI (sheets, check verdicts, fix rounds). */
  report?: boolean;

  /** Also drop every intermediate image (composed template, generated sheet,
   * review grids and raw outputs, per-round spritesheets) as numbered PNGs
   * under <name>.intermediate/. */
  intermediate?: boolean;

  outputs?: {
    /** Keep the raw filled sheet: true → <name>.sheet.png, or a filename. */
    sheet?: string | boolean;
  };
}

export type ResolvedConfig = CharacterConfig & {
  seed: number; template: TemplateSpec; output: string;
  /** True when the seed was rolled (not pinned by the user) — a failed QC
   * check may retry with a fresh seed; a pinned seed never retries. */
  seedRolled: boolean;
};

/** Validate, roll the seed, and resolve relative paths against `base` — the
 * config file's directory, or cwd when the config came from CLI flags. */
export function resolveConfig(cfg: CharacterConfig, base: string): ResolvedConfig {
  const seedRolled = typeof cfg.seed !== "number";
  const seed = seedRolled ? Math.floor(Math.random() * 2 ** 31) : cfg.seed as number;
  const templateName = typeof cfg.template === "string" ? cfg.template : undefined;
  if (templateName && !BUILTIN_TEMPLATES[templateName]) {
    throw new Error(`unknown template "${templateName}" — builtins: ${Object.keys(BUILTIN_TEMPLATES).join(", ")}`);
  }
  // builtin template paths are already absolute, anchored at the package root
  const rel = (p: string) => resolve(base, p);
  const template = typeof cfg.template === "object"
    ? { ...cfg.template, image: rel(cfg.template.image) }
    : { ...BUILTIN_TEMPLATES[templateName ?? DEFAULT_TEMPLATE] };
  return {
    ...cfg,
    ...(cfg.reference && { reference: rel(cfg.reference) }),
    seed, seedRolled, template, output: rel(cfg.output ?? "."),
  };
}

export function loadConfig(path: string): ResolvedConfig {
  const raw = readFileSync(path, "utf8");
  const cfg = (path.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw)) as CharacterConfig;
  return resolveConfig(cfg, dirname(resolve(path)));
}
