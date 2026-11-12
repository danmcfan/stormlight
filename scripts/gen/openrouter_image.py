#!/usr/bin/env python3
"""Generate one image with OpenRouter's Image API (POST /api/v1/images).

Modelled on danmcfan/ingardia's scripts/openrouter/run_model.py, without that
campaign's house rules (square-only, mandatory painted reference). Every paid
run needs the user's explicit yes first (see docs/art.md).

Usage:
  python3 scripts/gen/openrouter_image.py --out-dir art/source/<slug>/<tag> --name NAME \
      --prompt-file PROMPT.txt [--aspect 16:9] [--resolution 1K] [--ref path ...] [--dry-run]

Saves NAME.<ext> and NAME.prompt.txt in --out-dir and appends a line to
runs.jsonl in its parent: model, inputs, billed cost, files. Never prints the key.
"""
import argparse, base64, datetime, json, mimetypes, os, pathlib, sys, urllib.error, urllib.request

API = "https://openrouter.ai/api/v1/images"
MODEL = "google/gemini-nano-banana-2.1"
EST_COST = {"1K": 0.039, "2K": 0.06}


def data_uri(path: pathlib.Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def suffix(data: bytes, media_type: str | None) -> str:
    if media_type:
        return mimetypes.guess_extension(media_type) or ".png"
    return ".jpg" if data.startswith(b"\xff\xd8") else ".webp" if data[8:12] == b"WEBP" else ".png"


def unique(path: pathlib.Path) -> pathlib.Path:
    n, cand = 2, path
    while cand.exists():
        cand = path.with_name(f"{path.stem}-{n}{path.suffix}")
        n += 1
    return cand


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--prompt-file", required=True)
    ap.add_argument("--aspect", default="16:9")
    ap.add_argument("--resolution", default="1K")
    ap.add_argument("--model", default=MODEL)
    ap.add_argument("--ref", action="append", default=[], help="reference image path (repeatable)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    prompt = pathlib.Path(a.prompt_file).read_text().strip()
    if not prompt.endswith("no text, no signature."):
        sys.exit("prompt must end with the closing line: 'Full-bleed, no borders, no black bars, no text, no signature.'")
    refs = [pathlib.Path(r) for r in a.ref]
    for r in refs:
        if not r.is_file() or r.stat().st_size < 1000:
            sys.exit(f"reference missing or not an image (LFS pointer?): {r}")
    body = {"model": a.model, "prompt": prompt, "aspect_ratio": a.aspect, "resolution": a.resolution, "n": 1}
    if refs:
        body["input_references"] = [{"type": "image_url", "image_url": {"url": data_uri(r)}} for r in refs]
    est = EST_COST.get(a.resolution)
    print(f"model={a.model} aspect={a.aspect} resolution={a.resolution} refs={[str(r) for r in refs]} est_cost=${est}")
    if a.dry_run:
        return
    if "OPENROUTER_API_KEY" not in os.environ:
        sys.exit("OPENROUTER_API_KEY is not set")

    req = urllib.request.Request(API, data=json.dumps(body).encode(), method="POST", headers={
        "Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}", "Content-Type": "application/json"})
    error, result = None, {}
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            result = json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as err:
        error = f"HTTP {err.code}: {err.read().decode(errors='replace')[:500]}"

    out = pathlib.Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    files = []
    for item in result.get("data") or []:
        if item.get("b64_json"):
            data = base64.b64decode(item["b64_json"])
            path = unique(out / f"{a.name}{suffix(data, item.get('media_type'))}")
            path.write_bytes(data)
            files.append(str(path))
    prompt_path = unique(out / f"{a.name}.prompt.txt")
    prompt_path.write_text(prompt + "\n")
    if not error and not files:
        error = (result.get("error") or {}).get("message") if isinstance(result.get("error"), dict) else result.get("error") or "no image returned"
    cost = (result.get("usage") or {}).get("cost")
    entry = {"time": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "model": a.model,
             "status": "failed" if error else "succeeded", "error": error,
             "inputs": {"prompt": f"@{prompt_path}", "aspect_ratio": a.aspect, "resolution": a.resolution,
                        "input_references": [f"@{r}" for r in refs]},
             "est_cost": est, "cost": cost, "files": files}
    with open(out.parent / "runs.jsonl", "a") as f:
        f.write(json.dumps(entry) + "\n")
    print(json.dumps({k: entry[k] for k in ("status", "error", "cost", "files")}))
    if error:
        sys.exit(1)


if __name__ == "__main__":
    main()
