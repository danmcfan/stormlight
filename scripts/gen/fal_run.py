#!/usr/bin/env python3
"""Run one FAL model (queue API) on local images and save its outputs.

Used for image-to-3D (fal-ai/trellis, fal-ai/trellis-2) on construction
references. Images are sent inline as data URIs. Every run is logged to
runs.jsonl in the parent of --out-dir (see docs/art.md): model, inputs,
estimated cost (FAL doesn't return the billed amount; check the model page
before running), status and files. Never prints the key.

  python3 scripts/gen/fal_run.py --model fal-ai/trellis --image IMG.png \
      --out-dir art/source/<slug>/trellis-v1 --name NAME --est-cost 0.02 [--args '{"seed": 1}'] [--dry-run]

The image argument name defaults to image_url (--image-arg to change it).
Every URL in the response that points at a file (GLB, PNG, ...) is downloaded
next to the response JSON.
"""
import argparse, base64, datetime, json, mimetypes, os, pathlib, sys, time, urllib.error, urllib.request

QUEUE = "https://queue.fal.run"


def data_uri(path: pathlib.Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def call(url, body=None, method="GET"):
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), method=method,
                                 headers={"Authorization": f"Key {os.environ['FAL_KEY']}",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read() or b"{}")


def file_urls(obj, path=""):
    if isinstance(obj, dict):
        if isinstance(obj.get("url"), str) and obj["url"].startswith("http"):
            yield path, obj
        for k, v in obj.items():
            yield from file_urls(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from file_urls(v, f"{path}[{i}]")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--image", action="append", default=[])
    ap.add_argument("--image-arg", default="image_url")
    ap.add_argument("--args", default="{}")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--est-cost", type=float, required=True)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    imgs = [pathlib.Path(p) for p in a.image]
    for p in imgs:
        if not p.is_file() or p.stat().st_size < 1000:
            sys.exit(f"image missing or an LFS pointer: {p}")
    body = json.loads(a.args)
    if imgs:
        body[a.image_arg] = data_uri(imgs[0]) if a.image_arg.endswith("_url") else [data_uri(p) for p in imgs]
    print(f"model={a.model} images={[str(p) for p in imgs]} args={a.args} est_cost=${a.est_cost}")
    if a.dry_run:
        return
    if "FAL_KEY" not in os.environ:
        sys.exit("FAL_KEY is not set")
    out = pathlib.Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    error, result, files = None, {}, []
    t0 = time.time()
    try:
        sub = call(f"{QUEUE}/{a.model}", body, "POST")
        status_url, resp_url = sub["status_url"], sub["response_url"]
        while True:
            st = call(status_url)
            if st.get("status") == "COMPLETED":
                break
            if time.time() - t0 > 1200:
                raise TimeoutError("no result after 20 minutes")
            time.sleep(4)
        result = call(resp_url)
        for key, f in file_urls(result):
            name = f.get("file_name") or pathlib.Path(f["url"]).name
            dest = out / f"{a.name}-{key.replace('.', '-').replace('[', '').replace(']', '')}-{name}"
            urllib.request.urlretrieve(f["url"], dest)
            files.append(str(dest))
        (out / f"{a.name}.response.json").write_text(json.dumps(result, indent=1) + "\n")
    except urllib.error.HTTPError as err:
        error = f"HTTP {err.code}: {err.read().decode(errors='replace')[:500]}"
    except Exception as err:  # noqa: BLE001
        error = f"{type(err).__name__}: {err}"
    entry = {"time": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "model": a.model,
             "status": "failed" if error else "succeeded", "error": error,
             "inputs": {**json.loads(a.args), a.image_arg: [f"@{p}" for p in imgs]},
             "est_cost": a.est_cost, "cost": None, "seconds": round(time.time() - t0), "files": files}
    with open(out.parent / "runs.jsonl", "a") as f:
        f.write(json.dumps(entry) + "\n")
    print(json.dumps({k: entry[k] for k in ("status", "error", "est_cost", "seconds", "files")}))
    if error:
        sys.exit(1)


if __name__ == "__main__":
    main()
