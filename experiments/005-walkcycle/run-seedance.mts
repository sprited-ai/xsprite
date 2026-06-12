// Seedance 1 Pro via Replicate: first=last frame walk-in-place loop
import { readFileSync, writeFileSync } from "node:fs";

const TOKEN = process.env.REPLICATE_API_TOKEN!;
const img = `data:image/png;base64,${readFileSync("experiments/005-walkcycle/input-e.png").toString("base64")}`;
const body = {
  input: {
    prompt: "2D anime game character walk cycle animation, side view facing right, walking in place, " +
      "flat cel-shaded animation style, the character stays perfectly centered, plain light gray background, " +
      "no camera movement, no zoom. The character starts and ends in the exact same standing pose.",
    image: img,
    last_frame_image: img,
    duration: 5,
    resolution: "720p",
    camera_fixed: true,
    fps: 24,
  },
};
const r = await fetch("https://api.replicate.com/v1/models/bytedance/seedance-1-pro/predictions", {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const pred = await r.json();
if (!pred.id) throw new Error(JSON.stringify(pred).slice(0, 300));
console.log("prediction:", pred.id, pred.status);

let p = pred;
while (p.status === "starting" || p.status === "processing") {
  await new Promise((s) => setTimeout(s, 5000));
  p = await (await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
    headers: { Authorization: `Bearer ${TOKEN}` } })).json();
  process.stderr.write(".");
}
console.log("\nstatus:", p.status);
if (p.status !== "succeeded") throw new Error(JSON.stringify(p.error).slice(0, 300));
const url = typeof p.output === "string" ? p.output : p.output[0];
const mp4 = Buffer.from(await (await fetch(url)).arrayBuffer());
writeFileSync("experiments/005-walkcycle/seedance-e.mp4", mp4);
console.log(`saved experiments/005-walkcycle/seedance-e.mp4 (${(mp4.length / 1e6).toFixed(1)}MB)`);
