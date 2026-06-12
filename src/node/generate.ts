/** Model providers: composed template in → filled sheet out. */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { RawImage } from "../core/image.js";
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

async function toPngBuffer(img: RawImage): Promise<Buffer> {
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
    raw: { width: img.width, height: img.height, channels: 4 },
  }).png().toBuffer();
}

async function fromBytes(bytes: ArrayBuffer | Buffer): Promise<RawImage> {
  const { data, info } = await sharp(Buffer.from(bytes as ArrayBuffer)).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
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
  const png = await toPngBuffer(template);
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
      if (d) return fromBytes(Buffer.from(d.data, "base64"));
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
    return fromBytes(await (await fetch(images[0])).arrayBuffer());
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
      return fromBytes(await (await fetch(json.images[0].image_url)).arrayBuffer());
    }
    if (status === "TASK_STATUS_FAILED") throw new Error(`qwen failed: ${JSON.stringify(json).slice(0, 200)}`);
  }
  throw new Error("qwen poll timeout");
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
