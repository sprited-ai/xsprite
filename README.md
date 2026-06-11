# xsprite

Open workflow for generating **8-direction game character sprites** from a
single reference image, using template-guided image models (Nano Banana Pro
and friends).

Made by [Sprited](https://spritedx.com) — this is the workflow behind the
character sheets we've been posting. People kept asking "mind sharing your
workflow?" — this repo is the answer.

![turnaround](experiments/001-template-8dir/harvested/v2-fairy/spin.gif)

## The technique

1. **Example-anchored template.** A labeled sheet: top row shows a worked
   example (reference photo → 5 direction sprites), bottom row has your
   reference + empty slots. The model completes the pattern. No fine-tuning,
   no LoRA — one image-edit call.
2. **5 directions, not 8.** Generate S, SE, E, NE, N; mirror SE/E/NE into
   SW/W/NW. Halves the consistency burden. (Caveat: asymmetric details flip.)
3. **Harvest.** Auto-detect the sprite panel, slice cells, remove the
   background with a dependency-light floodfill keyer (no GPU matting needed
   on flat template backgrounds), assemble turnaround GIFs / animated WebP.

Works with any image model that preserves canvas layout and follows visual
examples — we use Nano Banana Pro (`gemini-3-pro-image-preview`); Seedream 4.0
and Qwen-Image-Edit results are in the experiment notes.

## Quick start

```
# fill a template via Gemini API
python experiments/001-template-8dir/run_nbp.py template.png -o out/filled.png

# harvest a filled sheet → 8 keyed sprites + spinning turnaround GIF
python experiments/001-template-8dir/harvest_v2.py out/filled.png \
    --row 1 -o harvested/my-character --gif spin.gif

# harvest an animation strip → entity-ready 256x256 animated WebP
python experiments/001-template-8dir/walk_harvest.py walk-sheet.png \
    --frames 8 --fps 8 -o harvested/walk-S
```

Needs Python 3.10+, Pillow, NumPy, SciPy, and a `GEMINI_API_KEY`.

## Status

Early research, moving fast. Current experiments:

| # | name | question | status |
|---|------|----------|--------|
| 001 | template-8dir | Can NBP fill an 8-direction sheet by analogy? | **works** — see notes |
| 002 | adaptive-chroma | Green-screen keying with drift-tolerant key detection | prototype |

Roadmap: walk-cycle templates, a proper `xsprite` CLI, MCP server.

## Why open source?

See [docs/why-oss.md](docs/why-oss.md).

## License

MIT
