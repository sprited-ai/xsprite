/** Node-only IO, backed by sharp (libvips — fast native decode/encode).
 * Browser apps use Canvas/ImageData + a wasm webp shim instead; the core
 * never touches the filesystem. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import sharp from "sharp";
import type { RawImage } from "../core/image.js";

export async function readImage(path: string): Promise<RawImage> {
  const { data, info } = await sharp(path).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}

export async function decodeImage(bytes: ArrayBuffer | Buffer): Promise<RawImage> {
  const { data, info } = await sharp(Buffer.from(bytes as ArrayBuffer)).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}

export async function encodePng(img: RawImage): Promise<Buffer> {
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
    raw: { width: img.width, height: img.height, channels: 4 },
  }).png().toBuffer();
}

export async function writePng(path: string, img: RawImage): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
    raw: { width: img.width, height: img.height, channels: 4 },
  }).png().toFile(path);
}

/** Lossless animated WebP — the entity texture format. */
export async function writeAnimatedWebp(path: string, frames: RawImage[], fps: number): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  const { width, height } = frames[0];
  // array join can't take raw buffers — encode frames to PNG buffers first
  const pngs = await Promise.all(frames.map((f) =>
    sharp(Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength), {
      raw: { width, height, channels: 4 },
    }).png().toBuffer()));
  // sharp applies a scalar delay to the first frame only — spell it out per frame
  const delay = frames.map(() => Math.round(1000 / fps));
  await sharp(pngs, { join: { animated: true } })
    .webp({ lossless: true, delay, loop: 0 })
    .toFile(path);
}

export function writeBytes(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}
