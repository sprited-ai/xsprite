# 002 — adaptive-chroma

**Question.** Can prompted-green (0x00ff00) backgrounds + adaptive chroma keying
replace BiRefNet Toonout in the pipeline entirely?

**Jin's insight (2026-06-11):** generations drift the background color slightly
across animation frames → don't assume pure green; detect the actual key from
edge pixels per frame.

**Method** (`keyer.py`):
1. Estimate key = dominant color of a 4px border ring (quantized vote → cluster mean).
2. Key by distance in rg-chromaticity (luma-invariant, so darker/brighter drift
   of the same hue still keys). Two thresholds → soft alpha band.
3. Flood-fill restriction: only key near-key pixels connected to the border —
   green clothing/eyes survive. (Enclosed holes between limbs are missed; punt.)
4. Despill: in the soft band, clamp the key-dominant channel to max(other two)
   — generalizes the cam2portrait keyer's G-clamp.

**Grading — head-to-head vs Toonout** on the same generated frames:
- edge quality at hair/limb boundaries (fringing, halos)
- semi-transparent features: shadows, glows, motion blur
- failure rate: in-character key-colored pixels, non-uniform drift (gradients)
- also test magenta 0xff00ff key (rarer in character palettes than green)

**Known risks** (from competitor research: Gamelabs uses chroma and edge quality
is its cited weakness; bg-removal quality is the moat the Reddit thread
validated): spill on anti-aliased edges, soft shadows keying to hard cutouts.
If chroma alone fringes, hybrid is the fallback: chroma for animation frames
(cheap, per-frame), Toonout as a quality pass for stills/hero shots.

**Win =** chroma output visually indistinguishable from Toonout on ≥90% of
frames → GPU matting leaves the hot path; pipeline becomes CPU-only
(Worker-runnable), ex-runpod ex-comfy gets dramatically easier.
