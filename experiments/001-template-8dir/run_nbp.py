"""Send a template to a Gemini image model (NBP family) and save the result.

Reads GEMINI_API_KEY from the environment (or --env-file). Call shape:
composite template image + terse layout prompt, image part back out.

  python run_nbp.py template.png -o out/attempt-1.png [--model ...] [--prompt ...]
"""

import argparse
import base64
import json
import os
import sys
import urllib.request
from pathlib import Path

DEFAULT_MODEL = "gemini-3-pro-image-preview"  # NBP; cam2portrait uses gemini-3.1-flash-image-preview
DEFAULT_PROMPT = (
    "Sheet layout: left column is a character reference (208x512). "
    "To its right is a 4x2 grid of 204x256 slots on pure green (#00FF00). "
    "Fill every green slot with the SAME character from the reference, "
    "full body, same art style, standing idle, seen from these directions — "
    "top row left to right: facing West, facing South (front, toward viewer), "
    "facing North (back, away from viewer), facing East; "
    "bottom row left to right: North-West, South-West, South-East, North-East. "
    "Keep each slot's background pure green #00FF00. "
    "Do not modify the reference column. Consistent identity, outfit, and scale "
    "across all eight slots.\n#game-asset, character-turnaround, 8-direction"
)


def api_key(env_file: str | None) -> str:
    if os.environ.get("GEMINI_API_KEY"):
        return os.environ["GEMINI_API_KEY"]
    if env_file:
        for line in Path(env_file).read_text().splitlines():
            if line.startswith("GEMINI_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"')
    sys.exit("no GEMINI_API_KEY in env (or --env-file)")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("template")
    p.add_argument("-o", "--output", required=True)
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--prompt", default=DEFAULT_PROMPT)
    p.add_argument("--env-file", default=None)
    a = p.parse_args()

    img_b64 = base64.b64encode(Path(a.template).read_bytes()).decode()
    body = {
        "contents": [{
            "parts": [
                {"inline_data": {"mime_type": "image/png", "data": img_b64}},
                {"text": a.prompt},
            ],
        }],
        "generationConfig": {"responseModalities": ["IMAGE"]},
    }
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{a.model}:generateContent")
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key(a.env_file)})

    print(f"calling {a.model} ...", file=sys.stderr)
    try:
        with urllib.request.urlopen(req, timeout=300) as res:
            payload = json.load(res)
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:800]}")

    saved = 0
    out = Path(a.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    for cand in payload.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            data = part.get("inlineData") or part.get("inline_data")
            if data:
                target = out if saved == 0 else out.with_stem(f"{out.stem}-{saved}")
                target.write_bytes(base64.b64decode(data["data"]))
                print(f"saved {target}")
                saved += 1
            elif part.get("text"):
                print(f"[model text] {part['text'][:300]}", file=sys.stderr)
    if not saved:
        sys.exit(f"no image in response: {json.dumps(payload)[:500]}")


if __name__ == "__main__":
    main()
