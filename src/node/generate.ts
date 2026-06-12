/** Node wiring for the generation pipeline (src/core/gen.ts): sharp-backed
 * codec, API keys from the environment / .env files. Same call signatures
 * the CLI and build pipeline always had. */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { RawImage } from "../core/image.js";
import type { Codec } from "../core/codec.js";
import {
  generateSheet as genCore, checkSpritesheet as checkCore, fixSpritesheet as fixCore,
  buildFixGrid as gridCore, defaultPrompt, type GenContext, type GenerateOptions,
  type Provider, type SheetCheck,
} from "../core/gen.js";
import { decodeImage, encodePng } from "./io.js";
import { PACKAGE_ROOT } from "./pkg.js";

export { defaultPrompt };
export type { GenerateOptions, Provider, SheetCheck };

function apiKey(envKey: string): string {
  if (process.env[envKey]) return process.env[envKey]!;
  for (const dir of [process.cwd(), PACKAGE_ROOT]) {
    const file = join(dir, ".env");
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.startsWith(`${envKey}=`)) return line.slice(envKey.length + 1).trim();
    }
  }
  throw new Error(`no ${envKey} in env, ./.env, or sprute/.env`);
}

const codec: Codec = {
  encodePng,
  decodeImage,
  async drawLabel(text: string, width: number, height: number): Promise<RawImage> {
    const svg =
      `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<text x="${Math.round(width / 2)}" y="${Math.round(height * 0.7)}" ` +
      `font-family="sans-serif" font-size="${Math.round(height * 0.5)}" text-anchor="middle" fill="black">${text}</text></svg>`;
    const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
  },
};

const ctx: GenContext = { codec, apiKey };

export function generateSheet(template: RawImage, prompt: string, opts: GenerateOptions = {}): Promise<RawImage> {
  return genCore(ctx, template, prompt, opts);
}

export function checkSpritesheet(sheet: RawImage, description?: string): Promise<SheetCheck> {
  return checkCore(ctx, sheet, description);
}

export async function fixSpritesheet(
  cells: RawImage[], description?: string, opts: GenerateOptions = {},
): Promise<{ cells: RawImage[]; report?: string; clean: boolean; gridPng: Buffer; raw?: RawImage }> {
  const r = await fixCore(ctx, cells, description, opts);
  return { ...r, gridPng: Buffer.from(r.gridPng) };
}

/** Exported for inspection/tests — `fixSpritesheet` is the real consumer. */
export async function buildFixGrid(cells: RawImage[], barH: number): Promise<Buffer> {
  return Buffer.from(await gridCore(ctx, cells, barH));
}
