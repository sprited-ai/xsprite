# xsprite

Open workflow for generating **8-direction game character sprites** from a
single reference image, using template-guided image models (Nano Banana Pro
and friends).

Made by [Sprited](https://spritedx.com) — this is the workflow behind the
character sheets we've been posting. People kept asking "mind sharing your
workflow?" — this repo is the answer.

![turnaround](examples/lisa/output/turntable.webp)

## The technique

1. **Example-anchored template.** A labeled sheet: top row shows a worked
   example (reference photo → 5 direction sprites), bottom row has your
   reference + empty slots. The model completes the pattern. No fine-tuning,
   no LoRA — one image-edit call.
2. **5 directions, not 8.** Generate S, SE, E, NE, N; mirror SE/E/NE into
   SW/W/NW. Halves the consistency burden. (Caveat: asymmetric details flip.)
3. **Harvest.** Auto-detect the sprite panel, slice cells, remove the
   background with a dependency-light floodfill keyer (no GPU matting needed
   on flat template backgrounds), assemble animated WebP turnarounds.

We use Nano Banana Pro (`gemini-3-pro-image-preview`) — currently the only
model that reliably does both reference-fill and new-character creation while
preserving the template layout. Seedream 4.0 / Qwen-Image-Edit comparisons
(partial successes, failure modes) are in the experiment notes.

## Quick start

```
pnpm install
cp .env.example .env   # add your GEMINI_API_KEY

# character config → generate (NBP) → extract → key → spritesheet + turntable
npx tsx src/cli.ts build examples/lisa/lisa.yaml

# already have a filled sheet? extract directly
npx tsx src/cli.ts extract sheet.png --row 1 -o out/my-character

# animation strip → frames + animated WebP
npx tsx src/cli.ts extract-anim walk-sheet.png --frames 8 --fps 8 -o out/walk-S
```

Each example folder pairs the config with what it produces — copy one to
start your own character.

The pipeline core (`src/core`) is pure TypeScript on `ImageData`-shaped
buffers — no Node APIs — so the same code runs in the browser; only file IO
(`src/node`, backed by sharp) is Node-specific. Template filling currently
goes through the Gemini API (`experiments/001-template-8dir/run_nbp.py`,
needs `GEMINI_API_KEY`) — a TS port is next.

The original Python lab scripts live on in `experiments/` as research notes.

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
