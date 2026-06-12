import { readFileSync, writeFileSync } from "node:fs";
const KEY = process.env.GEMINI_API_KEY!;
const img = readFileSync("input-e.png").toString("base64");
const MODEL = "veo-3.1-fast-generate-preview";
const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:predictLongRunning`, {
  method: "POST",
  headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    instances: [{
      prompt: "2D anime game character sprite, side view facing right, marching in place with clear leg movement, knees lifting high, arms swinging, full walk cycle, flat cel animation, plain light gray background, character stays centered, no camera movement",
      image: { bytesBase64Encoded: img, mimeType: "image/png" },
    }],
    parameters: { aspectRatio: "9:16", resolution: "720p", durationSeconds: 4 },
  }),
});
const op = await r.json();
if (!op.name) throw new Error(JSON.stringify(op).slice(0, 400));
console.log("operation:", op.name);
let o = op;
while (!o.done) {
  await new Promise((s) => setTimeout(s, 8000));
  o = await (await fetch(`https://generativelanguage.googleapis.com/v1beta/${op.name}`, {
    headers: { "x-goog-api-key": KEY } })).json();
  process.stderr.write(".");
}
if (o.error) throw new Error(JSON.stringify(o.error).slice(0, 400));
const uri = o.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
  ?? o.response?.generatedVideos?.[0]?.video?.uri;
if (!uri) throw new Error("no uri: " + JSON.stringify(o.response).slice(0, 400));
const mp4 = Buffer.from(await (await fetch(uri, { headers: { "x-goog-api-key": KEY } })).arrayBuffer());
writeFileSync("veo-inplace.mp4", mp4);
console.log(`\nveo-inplace.mp4 (${(mp4.length / 1e6).toFixed(1)}MB)`);
