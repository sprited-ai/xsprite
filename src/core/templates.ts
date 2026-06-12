/** Geometry of the bundled templates — slot/grid coordinates are intrinsic
 * to the template image and platform-neutral; only the image *path* is a
 * Node concern (src/config.ts anchors it at the package root, a browser app
 * fetches the PNG as an asset). */

export interface Slot { x: number; y: number; width: number; height: number }

export interface TemplateGeometry {
  /** Where the reference gets pasted (the blank cell of the inference row). */
  inputSlot?: Slot;
  /** Exact cell grid of the inference row, in template coordinates.
   * Preferred over panel auto-detection — no detection fuzz. */
  grid?: { x: number; y: number; cellWidth: number; cellHeight: number; columns: number };
  /** Panel to extract after generation (fallback when no grid). */
  row?: number;
}

export const TEMPLATE_GEOMETRY: Record<string, TemplateGeometry> = {
  // v1 and v2 share the layout pixel-for-pixel; v2's worked example is a
  // cleaner render of the same character
  "8dir-v1": {
    inputSlot: { x: 32, y: 352, width: 160, height: 256 },
    grid: { x: 192, y: 352, cellWidth: 160, cellHeight: 256, columns: 5 },
  },
  "8dir-v2": {
    inputSlot: { x: 32, y: 352, width: 160, height: 256 },
    grid: { x: 192, y: 352, cellWidth: 160, cellHeight: 256, columns: 5 },
  },
};
