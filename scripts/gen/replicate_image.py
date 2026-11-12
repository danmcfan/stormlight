#!/usr/bin/env python3
"""Generate one image with a Replicate model (default black-forest-labs/flux-schnell).

Cheap (~$0.003 an image) and used for terrain and prop textures. flux-schnell
takes no reference images, so the style reference can't be passed; prompts
still follow docs/art.md (camera, scene, mood, light and palette, materials,
finish, closing line). Every run is logged to runs.jsonl in the parent of
--out-dir: model, inputs, estimated cost, status and files. Never prints the key.

  python3 scripts/gen/replicate_image.py --out-dir art/source/terrain/<slug>/flux-v1 \
      --name NAME --prompt-file PROMPT.txt [--aspect 1:1] [--seed N] [--dry-run]
"""
import argparse, datetime, json, os, pathlib, sys, time, urllib.error, urllib.request

API = "https://api.replicate.com/v1"
EST_COST = {"black-forest-labs/flux-schnell": 0.003}


def call(url, body=None, method="GET", wait=False):
    headers = {"Authorization": f"Bearer {os.environ['REPLICATE_API_TOKEN']}", "Content-Type": "application/json"}
    if wait:
        headers["Prefer"] = "wait=60"
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read() or b"{}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--prompt-file", required=True)
    ap.add_argument("--model", default="black-forest-labs/flux-schnell")
    ap.add_argument("--aspect", default="1:1")
    ap.add_argument("--seed", type=int)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    prompt = pathlib.Path(a.prompt_file).read_text().strip()
    if not prompt.endswith("no text, no signature."):
        sys.exit("prompt must end with the closing line: 'Full-bleed, no borders, no black bars, no text, no signature.'")
    inputs = {"prompt": prompt, "aspect_ratio": a.aspect, "output_format": "png", "num_outputs": 1,
              "go_fast": True, "megapixels": "1"}
    if a.seed is not None:
        inputs["seed"] = a.seed
    est = EST_COST.get(a.model)
    print(f"model={a.model} aspect={a.aspect} est_cost=${est}")
    if a.dry_run:
        return
    if "REPLICATE_API_TOKEN" not in os.environ:
        sys.exit("REPLICATE_API_TOKEN is not set")

    out = pathlib.Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    error, files, pred = None, [], {}
    try:
        pred = call(f"{API}/models/{a.model}/predictions", {"input": inputs}, "POST", wait=True)
        while pred.get("status") in ("starting", "processing"):
            time.sleep(1.5)
            pred = call(pred["urls"]["get"])
        if pred.get("status") != "succeeded":
            error = pred.get("error") or pred.get("status")
        outputs = pred.get("output") or []
        for i, url in enumerate(outputs if isinstance(outputs, list) else [outputs]):
            path = out / (f"{a.name}.png" if i == 0 else f"{a.name}-{i}.png")
            with urllib.request.urlopen(url, timeout=120) as r:
                path.write_bytes(r.read())
            files.append(str(path))
    except urllib.error.HTTPError as err:
        error = f"HTTP {err.code}: {err.read().decode(errors='replace')[:500]}"
    prompt_path = out / f"{a.name}.prompt.txt"
    prompt_path.write_text(prompt + "\n")
    entry = {"time": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "model": a.model,
             "status": "failed" if error else "succeeded", "error": error,
             "inputs": {**{k: v for k, v in inputs.items() if k != "prompt"}, "prompt": f"@{prompt_path}"},
             "est_cost": est, "cost": None, "prediction": pred.get("id"),
             "predict_time": (pred.get("metrics") or {}).get("predict_time"), "files": files}
    with open(out.parent / "runs.jsonl", "a") as f:
        f.write(json.dumps(entry) + "\n")
    print(json.dumps({k: entry[k] for k in ("status", "error", "files")}))
    if error:
        sys.exit(1)


if __name__ == "__main__":
    main()
