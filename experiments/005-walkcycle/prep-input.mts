// E-facing lisa cell -> flat-background portrait canvas for video models
import sharp from "sharp";

const CELL = 160, SHEET = "examples/lisa.spritesheet.png";
// SPIN_ORDER = [S SE E NE N NW W SW] -> E is index 2
const cell = await sharp(SHEET).extract({ left: 2 * CELL, top: 0, width: CELL, height: 256 }).toBuffer();
const sprite = await sharp(cell).resize(320, 512, { kernel: "nearest" }).toBuffer();
await sharp({ create: { width: 720, height: 1280, channels: 4, background: "#e8e8e8" } })
  .composite([{ input: sprite, left: (720 - 320) / 2, top: (1280 - 512) / 2 }])
  .flatten({ background: "#e8e8e8" })
  .png().toFile("experiments/005-walkcycle/input-e.png");
console.log("experiments/005-walkcycle/input-e.png");
