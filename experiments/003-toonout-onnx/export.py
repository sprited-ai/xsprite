# Export joelseytre/toonout (BiRefNet swin_v1_l fine-tune) to ONNX.
# One-time offline tooling — the sprute CLI consumes the resulting .onnx
# via onnxruntime-node; no Python at user runtime.
#
#   .venv/bin/python export.py
#
# Outputs: out/birefnet-toonout.onnx (fp32), out/birefnet-toonout-fp16.onnx
# (fp16 weights, fp32 inputs/outputs so Node never touches Float16Array).
import sys, os, torch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "birefnet-repo"))
from birefnet.models.birefnet import BiRefNet  # noqa: E402

# torchvision::deform_conv2d has no ONNX mapping (and the symbolic-level
# exporter package chokes on BiRefNet's traced shapes), so swap in an exact
# pure-torch reimplementation — K grid_samples + a 1x1 matmul — which traces
# to standard ONNX ops. Verified against torchvision below before export.
import torch.nn.functional as F  # noqa: E402
import birefnet.models.modules.deform_conv as dc_module  # noqa: E402


def deform_conv2d_pure(input, offset, weight, bias=None, stride=(1, 1),
                       padding=(0, 0), dilation=(1, 1), mask=None):
    pair = lambda v: (v, v) if isinstance(v, int) else tuple(v)
    sh, sw = pair(stride); ph, pw = pair(padding); dh, dw = pair(dilation)
    # int() so tracing yields static python ints, not shape Tensors
    B, Cin, H, W = (int(v) for v in input.shape)
    Cout, kh, kw = int(weight.shape[0]), int(weight.shape[2]), int(weight.shape[3])
    K = kh * kw
    Hout = (H + 2 * ph - dh * (kh - 1) - 1) // sh + 1
    Wout = (W + 2 * pw - dw * (kw - 1) - 1) // sw + 1
    base_y = torch.arange(Hout, dtype=input.dtype) * sh - ph
    base_x = torch.arange(Wout, dtype=input.dtype) * sw - pw
    gy, gx = torch.meshgrid(base_y, base_x, indexing="ij")  # (Hout, Wout)
    samples = []
    for k in range(K):
        ky, kx = divmod(k, kw)
        y = gy + ky * dh + offset[:, 2 * k]      # (B, Hout, Wout)
        x = gx + kx * dw + offset[:, 2 * k + 1]
        grid = torch.stack([2 * x / (W - 1) - 1, 2 * y / (H - 1) - 1], dim=-1)
        s = F.grid_sample(input, grid, mode="bilinear", padding_mode="zeros", align_corners=True)
        if mask is not None:
            s = s * mask[:, k:k + 1]
        samples.append(s)
    stacked = torch.stack(samples, dim=2)                      # (B, Cin, K, Hout, Wout)
    cols = stacked.reshape(B, Cin * K, Hout * Wout)
    out = (weight.reshape(Cout, Cin * K) @ cols).reshape(B, Cout, Hout, Wout)
    if bias is not None:
        out = out + bias.reshape(1, Cout, 1, 1)
    return out


# exactness check against torchvision before trusting the export
with torch.no_grad():
    from torchvision.ops import deform_conv2d as dc_tv
    x = torch.randn(2, 8, 16, 16)
    w = torch.randn(4, 8, 3, 3)
    b = torch.randn(4)
    off = torch.randn(2, 18, 16, 16)
    m = torch.rand(2, 9, 16, 16)
    ref = dc_tv(x, off, w, b, stride=(1, 1), padding=(1, 1), mask=m)
    got = deform_conv2d_pure(x, off, w, b, stride=(1, 1), padding=(1, 1), mask=m)
    diff = (ref - got).abs().max().item()
    print("deform_conv2d max abs diff vs torchvision:", diff)
    assert diff < 1e-4, diff

dc_module.deform_conv2d = deform_conv2d_pure

CKPT = os.path.join(os.path.dirname(__file__), "weights", "birefnet_finetuned_toonout.pth")
OUT = os.path.join(os.path.dirname(__file__), "out")
SIZE = 1024

os.makedirs(OUT, exist_ok=True)
model = BiRefNet(bb_pretrained=False)
state = torch.load(CKPT, map_location="cpu", weights_only=True)
if isinstance(state, dict) and "model" in state:
    state = state["model"]
# checkpoint was saved from a DDP-wrapped, torch.compile'd model
state = {k.removeprefix("module.").removeprefix("_orig_mod."): v for k, v in state.items()}
missing, unexpected = model.load_state_dict(state, strict=False)
print("missing:", len(missing), "unexpected:", len(unexpected))
assert not missing, missing[:5]
model.eval()


class Mask(torch.nn.Module):
    """BiRefNet returns a list of multi-scale logits; ship sigmoid(final)."""
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, image):
        return self.m(image)[-1].sigmoid()


wrapped = Mask(model)
dummy = torch.randn(1, 3, SIZE, SIZE)
fp32_path = os.path.join(OUT, "birefnet-toonout.onnx")
torch.onnx.export(
    wrapped, dummy, fp32_path,
    input_names=["image"], output_names=["mask"],
    opset_version=17, do_constant_folding=True,
)
print("fp32 written:", os.path.getsize(fp32_path) >> 20, "MB")

import onnx  # noqa: E402
from onnxconverter_common import float16  # noqa: E402

m = onnx.load(fp32_path)
m16 = float16.convert_float_to_float16(m, keep_io_types=True)
fp16_path = os.path.join(OUT, "birefnet-toonout-fp16.onnx")
onnx.save(m16, fp16_path)
print("fp16 written:", os.path.getsize(fp16_path) >> 20, "MB")
