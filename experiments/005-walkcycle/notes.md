# 005 — walk cycles from one turnaround cell

Question: can a video model turn one NBP turnaround cell (E-facing) into a
usable walk-cycle spritesheet — and does the Gemini key alone cover it?

## Pipeline (fully automatic, feature-shaped)

cell → flat-bg portrait canvas → image-to-video "marching in place" →
autocorrelation gait-period detection → pick 8 frames across one period →
floodfill key → center → spritesheet + loop webp. See `assemble.mts`.

## Results

| | Seedance 1 Pro (Replicate) | Veo 3.1 fast (Gemini API) |
|---|---|---|
| walks at all | ✓ (after prompt fix) | ✓ first try |
| style fidelity | **better** — chunky proportions, flat cel look kept | slight redesign: slimmer, more rendered shading |
| gait quality | softer, timid stride | **better** — big clear strides, period exactly 1.00s |
| period residual | 22.0 | 16.9 |
| cost | ~$0.4 / 5s | ~$0.6 / 4s (fast; audio always on, discarded) |

Artifacts: `walkcycle-E.spritesheet.png` (+webp) = Seedance,
`walkcycle-E-veo.*` = Veo, `compare.png` side-by-side.

## Learnings

1. **first=last standing frame pins motion dead** — Seedance produced an
   idle wave instead of a walk. Drop the last-frame constraint and say
   "marching in place, knees lifting high, arms swinging".
2. Period detection by autocorrelation on downsampled luma works fine on
   flat backgrounds; both clips landed in 22–24 frames @24fps (~1s gait).
3. **GEMINI_API_KEY alone can carry walk cycles** — overturns the "Google
   video is meh for this" prior, at least for stylized sprites. Softens
   multi-vendor urgency for the animation roadmap; Seedance keeps the
   fidelity edge (via Replicate token or Comfy partner nodes).
4. Veo REST quirks vs docs: image goes as `bytesBase64Encoded` (docs show
   `inlineData` — rejected), `durationSeconds` must be a JSON number.
5. Replicate throttles hard under $5 credit (6 req/min, burst 1) — top up.
6. Both models honored "no camera movement" with camera_fixed / prompt.

## Next

- Per-direction walks (S/SE/E/NE/N + mirror) ≈ 5 clips/character ≈ $2-3.
- Try Seedance with a bigger-stride prompt; try Veo with style-lock
  reference images (it supports up to 3) to close the fidelity gap.
- Same pipeline for idle/attack states (prompt swap only).
