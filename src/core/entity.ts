/** Entity descriptor — sprite-dx-compatible shape (id/name/kind/initialState/
 * textureSize/states/animations) extended with directional spritesheet
 * metadata. v0 ships an idle state per direction; animation states (walk,
 * sit, ...) get added as their templates land. */
import { SPIN_ORDER, MIRRORED } from "./extract.js";

export interface EntityDescriptor {
  id: string;
  name: string;
  /** Generation seed the sheet was sampled with — feed back via config `seed` to reproduce. */
  seed: number;
  kind: string;
  initialState: string;
  textureSize: [number, number];
  directions: { order: readonly string[]; mirrored: string[] };
  spritesheet: { texture: string; cellWidth: number; cellHeight: number };
  states: Record<string, { animation: string; nextState: string }>;
  animations: Record<string, { texture: string; directional: boolean; frames: number[]; loopCount: number }>;
  media: Record<string, string>;
}

export function makeEntity(name: string, cellWidth: number, cellHeight: number, seed: number): EntityDescriptor {
  // id derives from the seed, so a same-seed rebuild is byte-identical
  const suffix = (seed >>> 0).toString(16).padStart(8, "0");
  return {
    id: `${name}-${suffix}`,
    name,
    seed,
    kind: "humanoid",
    initialState: "idle",
    textureSize: [cellWidth, cellHeight],
    directions: { order: SPIN_ORDER, mirrored: Object.keys(MIRRORED) },
    spritesheet: { texture: `${name}.spritesheet.png`, cellWidth, cellHeight },
    states: {
      idle: { animation: "idle", nextState: "idle" },
    },
    animations: {
      // directional: the renderer picks the spritesheet cell by facing
      idle: { texture: `${name}.spritesheet.png`, directional: true, frames: [0], loopCount: 0 },
    },
    media: { turntable: `${name}.turntable.webp` },
  };
}
