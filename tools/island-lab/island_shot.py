"""Screenshots of the sky island in the real game (dev build), one browser, one page per shot.

    npm run dev      # in another shell (port 4173)
    python3 tools/island-lab/island_shot.py outdir shots.json

shots.json is a list of shots; every key is optional:
  {"name": "meadow_day", "hour": 14, "at": [-105, 635], "look": [-190, 500, 1.5], "eye": 1.7, "pitch": 0, "yaw": 0,
   "size": [1280, 720], "wait": 2500, "eval": "window.__skyIsland.lakeLevel", "variants": [{"name": "b", "eval": "..."}]}
`at` is where to stand (world metres; on the island's top it stands on the ground there), `look` what to face (x, z, metres above the ground), `eye` the
camera's height above the ground (60 gives a bird's eye view of the place you stand over), `pitch` and `yaw` in degrees (yaw 0 faces north, -z, positive
turns left), `hour` 0 is night, 14 day, 17 dusk. `eval` runs a JavaScript expression in the page first (a variant's runs before its picture) and its value is
printed. The game starts on the island (`start=island`); add "oasis": true to stand in the oasis instead. About 20 to 60 s a shot in the software renderer.
Prints each file name, the draw calls and triangles in view, and any page errors.
"""
import json
import os
import sys
from urllib.parse import urlencode

from playwright.sync_api import sync_playwright

if len(sys.argv) < 3:
    sys.exit(__doc__)
outdir, specs_path = sys.argv[1], sys.argv[2]
os.makedirs(outdir, exist_ok=True)
specs = json.load(open(specs_path))
BASE = os.environ.get("OASIS_URL", "http://localhost:4173")
IGNORED = ("GL Driver Message", "GPU stall", "Automatic fallback to software WebGL", "WebGL", "AudioContext", "favicon")
problems = []

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    for n, spec in enumerate(specs):
        name = spec.get("name", f"shot{n}")
        w, h = spec.get("size", [1280, 720])
        page = browser.new_page(viewport={"width": w, "height": h})
        page.on("pageerror", lambda e, name=name: problems.append(f"{name}: PAGEERROR {e}"))
        page.on("console", lambda m, name=name: problems.append(f"{name}: console.{m.type} {m.text}") if m.type in ("error", "warning") and not any(s in m.text for s in IGNORED) else None)
        query = {"start": "oasis" if spec.get("oasis") else "island", "hour": spec.get("hour", 14)}
        if "at" in spec:
            query["at"] = ",".join(str(v) for v in spec["at"])
        if "look" in spec:
            query["look"] = ",".join(str(v) for v in spec["look"])
        for key in ("eye", "pitch", "yaw"):
            if key in spec:
                query[key] = spec[key]
        for key, value in spec.get("query", {}).items():
            query[key] = value
        page.goto(f"{BASE}/?{urlencode(query, safe=',')}")
        page.add_style_tag(content="#welcome, #menu, #inventory-toggle, #touch-controls { display: none !important; }")
        page.wait_for_function("document.querySelector('canvas') && document.querySelector('canvas').dataset.render", timeout=240000)
        for variant in spec.get("variants", [{}]):
            for code in (spec.get("eval"), variant.get("eval")):
                if code:
                    print("eval:", json.dumps(page.evaluate(code))[:400], flush=True)
            page.wait_for_timeout(int(spec.get("wait", 2500)))
            suffix = f"_{variant['name']}" if variant.get("name") else ""
            out = os.path.join(outdir, f"{n:02d}_{name}{suffix}.png")
            page.screenshot(path=out)
            render = page.evaluate("document.querySelector('canvas').dataset.render || ''")
            print(out, render, flush=True)
        page.close()
    browser.close()
print("\n".join(problems) if problems else "no page errors")
