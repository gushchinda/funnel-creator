#!/usr/bin/env python3
"""Generate funnel photos with fal.ai from a spec file.

    FAL_KEY=<id>:<secret> python3 scripts/gen_images.py --spec <funnel>/web/images.json [--force] [--only age-]

Spec (paths are relative to the spec file):
    {
      "model": "fal-ai/flux/dev",
      "style": "photorealistic lifestyle photo, soft daylight, warm neutral tones, clean background, no text, no logos",
      "images": [
        {"file": "images/age-18-29.webp", "prompt": "waist-up portrait of a fit woman in her mid-twenties ...",
         "size": "square_hd", "width": 640, "height": 640}
      ]
    }

Existing files are skipped unless --force. Needs Pillow and network access to fal.run and fal.media.
"""
import argparse
import io
import json
import os
import pathlib
import sys
import urllib.request

from PIL import Image


def fal_key():
    # Key format is "<id>:<secret>". Some env editors cut values at ":", so the secret may come separately.
    key = os.environ.get("FAL_KEY", "").strip()
    secret = os.environ.get("FAL_KEY_SECRET", "").strip()
    if secret and ":" not in key:
        key = f"{key}:{secret}"
    return key


def generate(model, prompt, size):
    req = urllib.request.Request(
        f"https://fal.run/{model}", method="POST",
        headers={"Authorization": "Key " + fal_key(), "Content-Type": "application/json"},
        data=json.dumps({"prompt": prompt, "image_size": size, "num_images": 1, "enable_safety_checker": True}).encode())
    with urllib.request.urlopen(req, timeout=180) as r:
        url = json.load(r)["images"][0]["url"]
    with urllib.request.urlopen(url, timeout=120) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGB")


def fit(img, w, h):
    # Cover-crop to the exact box, centred.
    scale = max(w / img.width, h / img.height)
    img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    left, top = (img.width - w) // 2, (img.height - h) // 2
    return img.crop((left, top, left + w, top + h))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", default="", help="generate only files whose name contains this")
    a = ap.parse_args()
    if ":" not in fal_key():
        sys.exit("FAL_KEY must be <id>:<secret> (or put the secret in FAL_KEY_SECRET)")

    spec_path = pathlib.Path(a.spec)
    spec = json.loads(spec_path.read_text())
    model, style = spec.get("model", "fal-ai/flux/dev"), spec.get("style", "")
    for item in spec["images"]:
        out = spec_path.parent / item["file"]
        if a.only not in out.name or (out.exists() and not a.force):
            continue
        prompt = f'{item["prompt"]}. {style}'.strip(". ")
        print("->", out)
        img = generate(model, prompt, item.get("size", "square_hd"))
        if item.get("width") and item.get("height"):
            img = fit(img, item["width"], item["height"])
        out.parent.mkdir(parents=True, exist_ok=True)
        img.save(out, quality=82, method=6) if out.suffix == ".webp" else img.save(out, quality=85)


if __name__ == "__main__":
    main()
