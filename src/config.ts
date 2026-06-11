/** Character config — declare a character once, `xsprite build` does the rest:
 * compose reference into the template, generate via the model, extract, key,
 * assemble. JSON or YAML. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import YAML from "yaml";

export interface Slot { x: number; y: number; width: number; height: number }

export interface CharacterConfig {
  name: string;
  /** Reference image path. Omit to let the model invent the character. */
  reference?: string;
  /** Extra guidance, e.g. "Character is Lisa and she is a fairy". */
  description?: string;
  output: string;

  template: {
    image: string;
    /** Where the reference gets pasted (the blank cell of the inference row). */
    inputSlot?: Slot;
    /** Panel to extract after generation. Default: last (inference row). */
    row?: number;
  };

  model?: {
    provider?: "gemini" | "novita-seedream" | "novita-qwen";
    id?: string;
    envKey?: string;
  };

  outputs?: {
    gif?: string;        // turnaround gif filename
    sheet?: string;      // keep the raw filled sheet
  };
}

export function loadConfig(path: string): CharacterConfig {
  const raw = readFileSync(path, "utf8");
  const cfg = (path.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw)) as CharacterConfig;
  if (!cfg.name || !cfg.template?.image || !cfg.output) {
    throw new Error("config needs at least: name, template.image, output");
  }
  // resolve paths relative to the config file
  const base = dirname(resolve(path));
  const rel = (p: string) => resolve(base, p);
  if (cfg.reference) cfg.reference = rel(cfg.reference);
  cfg.template.image = rel(cfg.template.image);
  cfg.output = rel(cfg.output);
  return cfg;
}
