"""Screenshots of Colossus 01 in the real game (dev build), posed exactly: one browser, one page per shot.

    npm run dev      # in another shell (port 4173)
    python3 tools/colossus-lab/game_shot.py outdir shots.json

shots.json is a list of shots; every key is optional:
  {"name": "ground_day", "hour": 14, "at": [x, z], "look": [x, z, metres above ground], "eye": 1.7, "pitch": 0, "yaw": 0,
   "pose": {"x": -120, "z": -1300, "yaw": 0, "cycles": 0.1, "speed": 2.2, "turn": 0, "calm": 0, "gaze": [0.3, 0.1]},
   "lod": 0, "advance": 0, "wait": 2000, "size": [1280, 720]}
`pose` is colossus.debug.pose (it also freezes the walk so the picture is the pose); `advance` runs the walk forward that many seconds first (from the
pose, with its dust and footprints), then freezes; `lod` forces a level (0, 1 or 2) and waits until it has arrived (lod0 is a 42 MB download).
`variants` is a list of {"name": ..., "tune": {...}, "advance": seconds}: one page, one picture per variant, each trying other look numbers first
(colossus.debug.tune: hide, plate, sky, sheen, ground, glow {day, night}) and/or walking on (`advance`, seconds; needs "walk": true in the pose);
it saves reloading and downloading the model for every try.
`at` and `look` are the game's own fixtures (src/main.js). The colossus's start is at (-50, -1260); the flat plain is round (-120, -1300).
Prints each file name, page errors and the colossus telemetry. About 20 to 60 s a shot in the software renderer.
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
        page.on("console", lambda m, name=name: problems.append(f"{name}: console.error {m.text}") if m.type == "error" and not any(s in m.text for s in IGNORED) else None)
        query = {"start": "oasis", "hour": spec.get("hour", 14)}
        if "at" in spec:
            query["at"] = ",".join(str(v) for v in spec["at"])
        if "look" in spec:
            query["look"] = ",".join(str(v) for v in spec["look"])
        for key in ("eye", "pitch", "yaw"):
            if key in spec:
                query[key] = spec[key]
        page.goto(f"{BASE}/?{urlencode(query, safe=',')}")
        # the start panel and the buttons are not part of the picture
        page.add_style_tag(content="#welcome, #menu, #inventory-toggle, #touch-controls { display: none !important; }")
        page.wait_for_function("document.querySelector('canvas') && document.querySelector('canvas').dataset.render", timeout=240000)
        page.wait_for_function("window.__colossus && window.__colossus.ready", timeout=120000)
        lod = spec.get("lod")
        if lod is not None:
            page.evaluate(f"window.__colossus.debug.load({lod})")
            page.evaluate(f"window.__colossus.debug.lod({lod})")
            page.wait_for_function(f"window.__colossus.list()[0] && window.__colossus.list()[0].loaded[{lod}]", timeout=240000)
        pose = spec.get("pose")
        if pose:
            page.evaluate(f"window.__colossus.debug.pose({json.dumps(pose)})")
        if spec.get("advance"):
            page.evaluate(f"window.__colossus.debug.advance({float(spec['advance'])})")
        if pose or spec.get("advance"):
            page.evaluate("window.__colossus.debug.freeze(true)")
        # one page, several pictures: each variant may try other look numbers (colossus.debug.tune) before its picture
        for variant in spec.get("variants", [{}]):
            if variant.get("tune"):
                page.evaluate(f"window.__colossus.debug.tune({json.dumps(variant['tune'])})")
            if variant.get("advance"):
                page.evaluate(f"window.__colossus.debug.advance({float(variant['advance'])})")
                page.evaluate("window.__colossus.debug.freeze(true)")

            page.wait_for_timeout(int(spec.get("wait", 2500)))
            suffix = f"_{variant['name']}" if variant.get("name") else ""
            out = os.path.join(outdir, f"{n:02d}_{name}{suffix}.png")
            page.screenshot(path=out)
            telemetry = page.evaluate("document.querySelector('canvas').dataset.colossus || ''")
            render = page.evaluate("document.querySelector('canvas').dataset.render || ''")
            print(out, telemetry[:200], render, flush=True)
        page.close()
    browser.close()
print("\n".join(problems) if problems else "no page errors")
