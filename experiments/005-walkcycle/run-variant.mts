// usage: tsx run-variant.mts <name> <input.png> <prompt> [--last]
import { readFileSync, writeFileSync } from "node:fs";
const [name, input, prompt, lastFlag] = process.argv.slice(2);
const TOKEN = process.env.REPLICATE_API_TOKEN!;
const img = `data:image/png;base64,${readFileSync(input).toString("base64")}`;
const body = { input: { prompt, image: img, ...(lastFlag === "--last" ? { last_frame_image: img } : {}),
  duration: 5, resolution: "720p", camera_fixed: true, fps: 24 } };
const r = await fetch("https://api.replicate.com/v1/models/bytedance/seedance-1-pro/predictions", {
  method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(body) });
const pred = await r.json();
if (!pred.id) throw new Error(JSON.stringify(pred).slice(0, 300));
let p = pred;
while (p.status === "starting" || p.status === "processing") {
  await new Promise((s) => setTimeout(s, 5000));
  p = await (await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
    headers: { Authorization: `Bearer ${TOKEN}` } })).json();
}
if (p.status !== "succeeded") throw new Error(JSON.stringify(p.error).slice(0, 300));
const url = typeof p.output === "string" ? p.output : p.output[0];
writeFileSync(`${name}.mp4`, Buffer.from(await (await fetch(url)).arrayBuffer()));
console.log(`${name}.mp4 done`);
