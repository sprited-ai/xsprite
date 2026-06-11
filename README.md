# xsprite

Open workflow for generating **8-direction game character sprites** from a
single reference image, using template-guided image models (Nano Banana Pro
and friends).

Made by [Sprited](https://spritedx.com) — this is the workflow behind the
character sheets we've been posting. People kept asking "mind sharing your
workflow?" — this repo is the answer.

![turnaround](examples/lisa.turntable.webp)

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

Describe a character in a tiny YAML file:

```yaml
# fairy.xsprite.yaml
name: fairy
description: "A small forest fairy with green wings."
reference: ./fairy.png   # optional — omit to let the model invent the look
```

Build it (needs a [Gemini API key](https://aistudio.google.com/apikey)):

```sh
GEMINI_API_KEY=... npx @sprited/xsprite build fairy.xsprite.yaml
```

That one call composes the bundled 8-direction template, generates via Nano
Banana Pro, extracts and keys the sprites, and writes next to your config:

- `fairy.spritesheet.png` — 8 directions, one row
- `fairy.turntable.webp` — animated turnaround
- `fairy.entity.json` — sprite metadata (directions, states, seed)

The key can also live in a `.env` file in your working directory. Useful
config fields beyond the basics:

| field | default | meaning |
|-------|---------|---------|
| `seed` | random | a number reproduces a build; the seed used is recorded in `<name>.entity.json` |
| `output` | config's directory | where outputs land |
| `outputs.sheet` | off | `true` keeps the raw generated sheet as `<name>.sheet.png` |
| `template` | `8dir-v1` (bundled) | a builtin template name, or a full `{image, inputSlot, grid}` spec |
| `model.provider` | `gemini` | also: `novita-seedream`, `novita-qwen` (need `NOVITA_API_KEY`) |

Already have a filled sheet, or an animation strip? Extract directly:

```sh
npx @sprited/xsprite extract sheet.png --row 1 -o out/my-character
npx @sprited/xsprite extract-anim walk-sheet.png --frames 8 --fps 8 -o out/walk-S
```

## Working from source

```sh
pnpm install
cp .env.example .env   # add your GEMINI_API_KEY
npx tsx src/cli.ts build examples/lisa.xsprite.yaml
```

`examples/` is flat: each character is a config (`<name>.xsprite.yaml`), its
reference (`<name>.reference.png`), and the outputs it produces
(`<name>.spritesheet.png`, `<name>.turntable.webp`, `<name>.entity.json`).
Copy an `.xsprite.yaml` to start your own character.

The pipeline core (`src/core`) is pure TypeScript on `ImageData`-shaped
buffers — no Node APIs — so the same code runs in the browser; only file IO
and the model call (`src/node`, backed by sharp) are Node-specific.

The original Python lab scripts live on in `experiments/` as research notes.

## Status

Early research, moving fast. Current experiments:

| # | name | question | status |
|---|------|----------|--------|
| 001 | template-8dir | Can NBP fill an 8-direction sheet by analogy? | **works** — see notes |
| 002 | adaptive-chroma | Green-screen keying with drift-tolerant key detection | prototype |

Roadmap: walk-cycle templates, MCP server.

## Why open source?

See [docs/why-oss.md](docs/why-oss.md).

## License

MIT
