/** Character config — declare a character once, `sprited build` does the rest:
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
    image: join(PACKAGE_ROOT, "templates", "sprited-8dir-v1.png"),
    inputSlot: { x: 32, y: 352, width: 160, height: 256 },
    grid: { x: 192, y: 352, cellWidth: 160, cellHeight: 256, columns: 5 },
  },
};

export const DEFAULT_TEMPLATE = "8dir-v1";

export interface CharacterConfig {
  /** Output/entity name. Omit to auto-name from the seed. */
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

  /** Background removal: "floodfill" (default — fast, dependency-free,
   * browser-parity) or "toonout" (BiRefNet anime matting via the Replicate
   * endpoint; needs REPLICATE_API_TOKEN; best edge quality). */
  matting?: "floodfill" | "toonout";

  outputs?: {
    /** Keep the raw filled sheet: true → <name>.sheet.png, or a filename. */
    sheet?: string | boolean;
  };
}

export type ResolvedConfig = CharacterConfig & {
  seed: number; template: TemplateSpec; output: string;
};

// fallback names when neither the user nor the model supplies one —
// seed-derived: same seed -> same name, same look
const ADJ = ["amber", "brisk", "cinder", "dapple", "ember", "fable", "gleam",
  "hazel", "ivory", "jade", "keen", "lunar", "moss", "nimble", "ochre",
  "pebble", "quill", "rusty", "sage", "thistle", "umber", "velvet", "wisp"];
const NOUN = ["badger", "crow", "drake", "fawn", "gnome", "heron", "imp",
  "knight", "lark", "mole", "newt", "otter", "pixie", "quail", "rogue",
  "sprite", "toad", "urchin", "vole", "wren"];

export function seedName(seed: number): string {
  return `${ADJ[seed % ADJ.length]}-${NOUN[(seed >> 8) % NOUN.length]}`;
}

/** Validate, roll the seed, and resolve relative paths against `base` — the
 * config file's directory, or cwd when the config came from CLI flags. */
export function resolveConfig(cfg: CharacterConfig, base: string): ResolvedConfig {
  const seed = typeof cfg.seed === "number" ? cfg.seed : Math.floor(Math.random() * 2 ** 31);
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
    seed, template, output: rel(cfg.output ?? "."),
  };
}

export function loadConfig(path: string): ResolvedConfig {
  const raw = readFileSync(path, "utf8");
  const cfg = (path.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw)) as CharacterConfig;
  return resolveConfig(cfg, dirname(resolve(path)));
}
