/** Locate the installed xsprite package root by walking up from this file
 * until a package.json appears. Works from src/ (tsx) and from the flattened
 * dist/ bundle alike — a fixed "../.." breaks when tsup changes the depth. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function findRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("xsprite package root not found");
    dir = parent;
  }
  return dir;
}

export const PACKAGE_ROOT = findRoot();
