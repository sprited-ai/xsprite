# sprited

Open workflow for generating **8-direction game character sprites** from a
single reference image, using template-guided image models (Nano Banana Pro
and friends).

Made by [Sprited](https://spritedx.com) — this is the workflow behind the
character sheets we've been posting. People kept asking "mind sharing your
workflow?" — this repo is the answer.

![turnaround](https://raw.githubusercontent.com/sprited-ai/sprited/main/examples/monet.turntable.webp)

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

One command, zero config (needs a [Gemini API key](https://aistudio.google.com/apikey)):

```sh
GEMINI_API_KEY=... npx sprited gen char
```

That invents a character on the spot, filed as `char-001` (then `char-002`,
and so on — whatever's next in the output directory). Pass your own name and
steer the look:

```sh
GEMINI_API_KEY=... npx sprited build fairy -d "A small forest fairy with green wings."
```

Have a reference image? Add `-r ./fairy.png` — or omit `-d` entirely and let
the reference carry the look. Flag builds also drop a `fairy.sprited.yaml`
next to the outputs with the name and seed baked in, so any one-off build can
be re-run exactly. The same file is what you'd write by hand for a
config-first workflow:

```yaml
# fairy.sprited.yaml
name: fairy
description: "A small forest fairy with green wings."
reference: ./fairy.png   # optional — omit to let the model invent the look
```

```sh
GEMINI_API_KEY=... npx sprited build fairy.sprited.yaml
```

Either way the call composes the bundled 8-direction template, generates via
Nano Banana Pro, extracts and keys the sprites, and writes:

- `fairy.spritesheet.png` — 8 directions, one row
- `fairy.turntable.webp` — animated turnaround
- `fairy.entity.json` — sprite metadata (directions, states, seed)
- `fairy.sprited.yaml` — flag builds only: the config that reproduces this build

After generation the views go back to the image model itself, laid out as a
labeled 3x3 compass grid: *"any errors? fix them and report the changes"*.
Anatomy glitches, wrong facings, parts that change shape mid-turnaround get
repaired in place — same character, defects fixed — and the model's text
report is printed. `--max-fixes N` sets the number of review rounds (default
1), `--no-check` / `check: false` skips review entirely. A separate
observational check is available standalone:

```sh
npx sprited check sheet.png -d "a fairy"        # report defects, exit 1 if any
npx sprited check sheet.png --fix               # also repair -> sheet.fixed.png
```

The key can also live in a `.env` file in your working directory. Useful
options beyond the basics (flag form / config field form):

| flag | config field | default | meaning |
|------|--------------|---------|---------|
| `--seed N` | `seed` | random | a number reproduces a build; the seed used is recorded in `<name>.entity.json` |
| `-o dir` | `output` | cwd / config's directory | where outputs land |
| `--sheet` | `outputs.sheet` | off | keep the raw generated sheet as `<name>.sheet.png` |
| `--template` | `template` | `8dir-v1` (bundled) | a builtin template name; config form also takes a full `{image, inputSlot, grid}` spec |
| `--provider` | `model.provider` | `gemini` | also: `novita-seedream`, `novita-qwen` (need `NOVITA_API_KEY`) |
| `--matting` | `matting` | `floodfill` | `toonout` = BiRefNet anime matting via Replicate (needs `REPLICATE_API_TOKEN`; best edges on hair/translucency) |
| `--no-check` | `check: false` | review on | skip the post-generation review/fix |
| `--max-fixes N` | `maxFixes` | `1` | review/fix rounds per build; each round feeds the previous round's output back |
| `--report` | `report: true` | off | stream a build log to `<name>.report.md` with every generated image inlined as a data URI |
| `--intermediate` | `intermediate: true` | off | write every intermediate image as numbered PNGs under `<name>.intermediate/` |

Already have a filled sheet, or an animation strip? Extract directly:

```sh
npx sprited extract sheet.png --row 1 -o out/my-character
npx sprited extract-anim walk-sheet.png --frames 8 --fps 8 -o out/walk-S
```

Tab completion for commands, flags, and flag values (needs `sprited` on your
PATH, e.g. `npm i -g sprited` — the shell can't complete one-off `npx` runs):

```sh
eval "$(sprited completion zsh)"    # ~/.zshrc
eval "$(sprited completion bash)"   # ~/.bashrc
```

## Working from source

```sh
pnpm install
cp .env.example .env   # add your GEMINI_API_KEY
npx tsx src/cli.ts build examples/lisa.sprited.yaml
```

`examples/` is flat: each character is a config (`<name>.sprited.yaml`), its
reference (`<name>.reference.png`), and the outputs it produces
(`<name>.spritesheet.png`, `<name>.turntable.webp`, `<name>.entity.json`).
Copy an `.sprited.yaml` to start your own character.

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

MIT — except the Monet character assets in `examples/` (`monet.*`), which are
Sprited's character and for demonstration only. See [LICENSE](LICENSE).
