/** Entity descriptor — sprite-dx-compatible shape (id/name/kind/initialState/
 * textureSize/states/animations) extended with directional spritesheet
 * metadata. v0 ships an idle state per direction; animation states (walk,
 * sit, ...) get added as their templates land. */
import { SPIN_ORDER, MIRRORED } from "./extract.js";

export interface EntityDescriptor {
  id: string;
  name: string;
  kind: string;
  initialState: string;
  textureSize: [number, number];
  directions: { order: readonly string[]; mirrored: string[] };
  spritesheet: { texture: string; cellWidth: number; cellHeight: number };
  states: Record<string, { animation: string; nextState: string }>;
  animations: Record<string, { texture: string; directional: boolean; frames: number[]; loopCount: number }>;
  media: Record<string, string>;
}

export function makeEntity(name: string, cellWidth: number, cellHeight: number): EntityDescriptor {
  const suffix = Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join("");
  return {
    id: `${name}-${suffix}`,
    name,
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
