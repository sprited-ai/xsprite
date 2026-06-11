/** Self-contained <name>.preview.html — double-click to inspect a build.
 * Zero dependencies, works over file:// (entity data is inlined; images are
 * sibling-relative <img>/background refs). */
import type { EntityDescriptor } from "../core/entity.js";

export function renderPreviewHtml(entity: EntityDescriptor): string {
  const e = JSON.stringify(entity);
  return `<!doctype html>
<meta charset="utf-8">
<title>${entity.name} — xsprite preview</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center;
         justify-content: center; gap: 24px; background: #1c1c1e; color: #ddd;
         font: 13px/1.4 ui-monospace, Menlo, monospace; }
  h1 { font-size: 14px; font-weight: 600; letter-spacing: .04em; margin: 0; }
  h1 small { color: #777; font-weight: 400; }
  .checker { background: repeating-conic-gradient(#2a2a2d 0% 25%, #232325 0% 50%) 0 0 / 16px 16px;
             border-radius: 10px; padding: 16px; }
  .stage { display: flex; gap: 32px; align-items: flex-end; }
  .cell { image-rendering: pixelated; }
  img.turntable { image-rendering: pixelated; display: block; }
  .dirs { display: flex; gap: 4px; }
  .dirs button { background: #2c2c2f; color: #bbb; border: 0; border-radius: 6px;
                 padding: 6px 9px; font: inherit; cursor: pointer; }
  .dirs button.active { background: #e8e4df; color: #111; }
  .label { color: #777; text-align: center; margin-top: 8px; }
</style>
<h1>${entity.name} <small>${entity.id}</small></h1>
<div class="stage">
  <div>
    <div class="checker"><div class="cell" id="cell"></div></div>
    <div class="label">spritesheet · <span id="dirLabel"></span></div>
  </div>
  <div>
    <div class="checker"><img class="turntable" id="turntable"></div>
    <div class="label">turntable</div>
  </div>
</div>
<div class="dirs" id="dirs"></div>
<script>
const E = ${e};
const SCALE = 2;
const { cellWidth: cw, cellHeight: ch, texture } = E.spritesheet;
const order = E.directions.order;
const cell = document.getElementById("cell");
cell.style.width = cw * SCALE + "px";
cell.style.height = ch * SCALE + "px";
cell.style.background = "url('" + texture + "') no-repeat";
cell.style.backgroundSize = (cw * order.length * SCALE) + "px " + (ch * SCALE) + "px";
const tt = document.getElementById("turntable");
tt.src = E.media.turntable;
tt.width = cw * SCALE;
const dirs = document.getElementById("dirs");
function show(i) {
  cell.style.backgroundPosition = (-i * cw * SCALE) + "px 0";
  document.getElementById("dirLabel").textContent = order[i] +
    (E.directions.mirrored.includes(order[i]) ? " (mirrored)" : "");
  [...dirs.children].forEach((b, j) => b.classList.toggle("active", i === j));
}
order.forEach((d, i) => {
  const b = document.createElement("button");
  b.textContent = d;
  b.onclick = () => show(i);
  dirs.append(b);
});
show(0);
</script>
`;
}
