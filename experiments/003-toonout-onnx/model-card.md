---
license: mit
base_model: joelseytre/toonout
pipeline_tag: image-segmentation
tags:
  - background-removal
  - anime
  - onnx
  - birefnet
---

# BiRefNet-ToonOut — ONNX

ONNX export of [joelseytre/toonout](https://huggingface.co/joelseytre/toonout)
(ToonOut: BiRefNet fine-tuned for anime background removal — Muratori &
Seytre, MIT, [paper](https://arxiv.org/abs/2509.06839),
[code](https://github.com/MatteoKartoon/BiRefNet)), converted so the model
runs anywhere ONNX Runtime does — Node.js included, no Python.

Converted with `torch.onnx.export` (opset 17) plus
[`deform_conv2d_onnx_exporter`](https://github.com/masamitsu-murase/deform_conv2d_onnx_exporter)
for the decoder's deformable convolutions. Conversion script:
[`experiments/003-toonout-onnx`](https://github.com/sprited-ai/sprute/tree/main/experiments/003-toonout-onnx)
in the sprute repo.

## Files

- `birefnet-toonout-fp16.onnx` — fp16 weights, **fp32 inputs/outputs** (no
  Float16Array juggling in JS). This is what [sprute](https://github.com/sprited-ai/sprute) downloads.
- `birefnet-toonout.onnx` — fp32 original export.

## I/O

| | name | shape | dtype |
|---|---|---|---|
| input | `image` | `[1, 3, 1024, 1024]` | float32 |
| output | `mask` | `[1, 1, 1024, 1024]` | float32 (sigmoid, 0..1) |

Preprocessing: plain resize to 1024×1024, RGB / 255, ImageNet
normalization (mean `0.485, 0.456, 0.406`, std `0.229, 0.224, 0.225`).
Postprocessing: resize mask back to the source size, use as alpha.

## Usage (Node.js)

```js
import ort from "onnxruntime-node";
const session = await ort.InferenceSession.create("birefnet-toonout-fp16.onnx");
const { mask } = await session.run({ image: new ort.Tensor("float32", chw, [1, 3, 1024, 1024]) });
```

Or just `npx sprute gen char` — sprute uses this model for matting by default.
