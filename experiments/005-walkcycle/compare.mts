import sharp from "sharp";
const a = await sharp("walkcycle-E.spritesheet.png").resize(1024).toBuffer();
const b = await sharp("walkcycle-E-veo.spritesheet.png").resize(1024).toBuffer();
const h = 128;
await sharp({ create: { width: 1024, height: h * 2 + 8, channels: 4, background: "#202028" } })
  .composite([{ input: a, top: 0, left: 0 }, { input: b, top: h + 8, left: 0 }])
  .png().toFile("compare.png");
console.log("compare.png (top: seedance, bottom: veo)");
