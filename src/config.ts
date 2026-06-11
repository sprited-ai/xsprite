/** Character config — declare a character once, `xsprite build` does the rest:
 * compose reference into the template, generate via the model, extract, key,
 * assemble. JSON or YAML. */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import YAML from "yaml";
import { PACKAGE_ROOT } from "./node/pkg.js";

export interface Slot { x: number; y: number; width: number; height: number }

export interface TemplateSpec {
  image: string;
  /** Where the reference gets pasted (the blank cell of the inference row). */
  inputSlot?: Slot;
  /** Exact cell grid of the inference row, in template coordinates.
   * Preferred over panel auto-detection — no detection fuzz. */
  grid?: { x: number; y: number; cellWidth: number; cellHeight: number; columns: number };
  /** Panel to extract after generation (fallback when no grid). */
  row?: number;
}

/** Templates shipped with the package — name them instead of spelling out
 * image paths and slot coordinates. */
export const BUILTIN_TEMPLATES: Record<string, TemplateSpec> = {
  "8dir-v1": {
    image: join(PACKAGE_ROOT, "templates", "xsprite-8dir-v1.png"),
    inputSlot: { x: 32, y: 352, width: 160, height: 256 },
    grid: { x: 192, y: 352, cellWidth: 160, cellHeight: 256, columns: 5 },
  },
};

export const DEFAULT_TEMPLATE = "8dir-v1";

export interface CharacterConfig {
  name: string;
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

  outputs?: {
    /** Keep the raw filled sheet: true → <name>.sheet.png, or a filename. */
    sheet?: string | boolean;
  };
}

export type ResolvedConfig = CharacterConfig & { template: TemplateSpec; output: string };

export function loadConfig(path: string): ResolvedConfig {
  const raw = readFileSync(path, "utf8");
  const cfg = (path.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw)) as CharacterConfig;
  if (!cfg.name) throw new Error("config needs at least: name");
  const templateName = typeof cfg.template === "string" ? cfg.template : undefined;
  if (templateName && !BUILTIN_TEMPLATES[templateName]) {
    throw new Error(`unknown template "${templateName}" — builtins: ${Object.keys(BUILTIN_TEMPLATES).join(", ")}`);
  }
  // resolve paths relative to the config file (builtin template paths are
  // already absolute, anchored at the package root)
  const base = dirname(resolve(path));
  const rel = (p: string) => resolve(base, p);
  if (cfg.reference) cfg.reference = rel(cfg.reference);
  const template = typeof cfg.template === "object"
    ? { ...cfg.template, image: rel(cfg.template.image) }
    : { ...BUILTIN_TEMPLATES[templateName ?? DEFAULT_TEMPLATE] };
  return { ...cfg, template, output: rel(cfg.output ?? ".") };
}
