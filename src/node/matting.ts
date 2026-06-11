/** External matting via the hosted ToonOut endpoint
 * (https://replicate.com/sprited/birefnet-toonout — BiRefNet anime fine-tune
 * by Muratori & Seytre, MIT). BYOK: REPLICATE_API_TOKEN.
 * The CLI tier gets this; the browser core stays on the floodfill keyer
 * (running a 244M-param matting net client-side is not practical). */
import { readFileSync, existsSync } from "node:fs";
import sharp from "sharp";
import type { RawImage } from "../core/image.js";

const MODEL = "sprited/birefnet-toonout";
const API = "https://api.replicate.com/v1";

export function hasReplicateToken(): boolean {
  try { token(); return true; } catch { return false; }
}

function token(): string {
  if (process.env.REPLICATE_API_TOKEN) return process.env.REPLICATE_API_TOKEN;
  if (existsSync(".env")) {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      if (line.startsWith("REPLICATE_API_TOKEN=")) return line.split("=", 1 + 1)[1].trim();
    }
  }
  throw new Error("matting: toonout needs REPLICATE_API_TOKEN in env or ./.env");
}

async function latestVersion(auth: string): Promise<string> {
  const res = await fetch(`${API}/models/${MODEL}`, { headers: { Authorization: `Bearer ${auth}` } });
  if (!res.ok) throw new Error(`replicate model lookup ${res.status}`);
  return ((await res.json()) as any).latest_version.id;
}

async function matteOne(cell: RawImage, version: string, auth: string): Promise<RawImage> {
  const png = await sharp(Buffer.from(cell.data.buffer, cell.data.byteOffset, cell.data.byteLength), {
    raw: { width: cell.width, height: cell.height, channels: 4 },
  }).png().toBuffer();
  let create: Response | undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    create = await fetch(`${API}/predictions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ version, input: { image: `data:image/png;base64,${png.toString("base64")}` } }),
    });
    if (create.status !== 429) break;
    // low-credit accounts are throttled to ~6 predictions/min — back off and retry
    await new Promise((r) => setTimeout(r, 12_000));
  }
  if (!create!.ok) throw new Error(`toonout predict ${create!.status}: ${(await create!.text()).slice(0, 200)}`);
  let pred = (await create!.json()) as any;
  for (let i = 0; i < 120 && !["succeeded", "failed", "canceled"].includes(pred.status); i++) {
    await new Promise((r) => setTimeout(r, 2500));
    pred = await (await fetch(`${API}/predictions/${pred.id}`, {
      headers: { Authorization: `Bearer ${auth}` } })).json() as any;
  }
  if (pred.status !== "succeeded") throw new Error(`toonout ${pred.status}: ${(pred.logs || "").slice(-200)}`);
  const bytes = Buffer.from(await (await fetch(pred.output)).arrayBuffer());
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}

/** Matte each cell through the hosted ToonOut model. Cold boot on the first
 * call can add ~1-2 minutes; warm predictions are ~1-2s each. */
export async function toonoutMatting(cells: RawImage[], concurrency = 2): Promise<RawImage[]> {
  const auth = token();
  const version = await latestVersion(auth);
  const out: RawImage[] = new Array(cells.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, cells.length) }, async () => {
    while (next < cells.length) {
      const i = next++;
      out[i] = await matteOne(cells[i], version, auth);
    }
  }));
  return out;
}
