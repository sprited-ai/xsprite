import sharp from "sharp";
const CELL = 160, SHEET = "/Users/jin/dev/sprited/examples/lisa.spritesheet.png";
const cell = await sharp(SHEET).extract({ left: 2 * CELL, top: 0, width: CELL, height: 256 }).toBuffer();
const sprite = await sharp(cell).resize(240, 384, { kernel: "nearest" }).toBuffer();
await sharp({ create: { width: 1280, height: 720, channels: 4, background: "#e8e8e8" } })
  .composite([{ input: sprite, left: 150, top: 250 }])
  .flatten({ background: "#e8e8e8" }).png().toFile("input-e-wide.png");
console.log("input-e-wide.png");
