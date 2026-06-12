# Why open source?

Short version: people asked, and secrecy wasn't buying us anything.

## The signal

We posted our character work on Reddit. The single most repeated comment —
ahead of any feature request — was some version of:

> "Wow this is really impressive. Tell me about your workflow."
> "Looks really good. Mind sharing your workflow?"
> "What model did you use?"

When four strangers independently ask for the recipe instead of the dish,
the recipe is the product. This repo is the recipe.

## Secrecy stopped being a moat

Our earlier pipeline leaned on custom models and a long ComfyUI graph, and we
treated that as IP. Then the current generation of image models (Nano Banana
Pro and friends) made most of it unnecessary: an example-anchored template,
one image-edit call, and a dependency-light harvest script produce results
our old pipeline needed a GPU farm for.

A workflow that fits in a 1024px PNG and ~300 lines of Python cannot be kept
secret. Anyone who saw our Reddit post could rebuild it in a weekend. The
options were: pretend otherwise, or publish it well and be the reference
implementation. We picked the second.

## What we get

- **Distribution.** Tools like this spread through GitHub, not ads. Stars
  are an economy; forks for niche styles make the technique better and lead
  back here.
- **Trust.** Game developers are (rightly) wary of asset tools with opaque
  pipelines. Being inspectable is a feature.
- **Speed.** We already build in public on the blog; the repo just removes
  the lag between "we figured something out" and "you can use it."

We've done this before — [OpenClaw](https://github.com/openclaw) went open
and it was the right call there too.

## What stays a product

[spritedx.com](https://spritedx.com) — the hosted, integrated experience:
generation queue, character library, animation states, billing, no setup.
sprute is the workshop; spritedx is the store. If you'd rather run scripts
and bring your own API keys, this repo is genuinely enough. If you want
one-click characters, that's what we sell.

## The honest trade

Everything here is copyable, including by competitors. We're betting that
velocity, taste, and a hosted product beat a head start kept in a drawer.
If we're wrong, at least the ecosystem got a good sprite workflow out of it.
