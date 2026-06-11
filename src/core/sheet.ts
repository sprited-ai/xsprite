/** Sprite sheet assembly — pack cells into a single horizontal strip.
 * All cells must share dimensions; order is the caller's contract
 * (build uses SPIN_ORDER: S SE E NE N NW W SW). */
import { createImage, paste, type RawImage } from "./image.js";

export function makeSpriteSheet(cells: RawImage[]): RawImage {
  const { width: cw, height: ch } = cells[0];
  const sheet = createImage(cw * cells.length, ch, [0, 0, 0, 0]);
  cells.forEach((c, i) => paste(sheet, c, i * cw, 0));
  return sheet;
}
