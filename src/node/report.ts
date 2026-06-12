/** Streaming markdown build report: appended step by step as the build runs,
 * so a long or crashed build still leaves a readable trail. Images are
 * inlined as PNG data URIs — the .report.md is self-contained. */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RawImage } from "../core/image.js";
import { encodePng } from "./io.js";

export interface Reporter {
  log(md: string): void;
  image(alt: string, img: RawImage): Promise<void>;
  png(alt: string, png: Buffer): void;
}

export function startReport(path: string, title: string): Reporter {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `# ${title}\n\n_${new Date().toISOString()}_\n\n`);
  const png = (alt: string, buf: Buffer) =>
    appendFileSync(path, `**${alt}**\n\n![${alt}](data:image/png;base64,${buf.toString("base64")})\n\n`);
  return {
    log: (md) => appendFileSync(path, md + "\n\n"),
    image: async (alt, img) => png(alt, await encodePng(img)),
    png,
  };
}
