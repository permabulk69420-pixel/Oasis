"""Screenshots of the island flora lab (tools/island-lab/flora-lab.html), one page per shot.

    npm run dev      # in another shell (port 4173)
    python3 tools/island-lab/flora_shot.py outdir shots.json

shots.json is a list of {"name": "fern_all", "query": {"models": "fern", "lod": "all", "night": "1", "cam": "tq"}}; see flora-lab.js for the query keys.
Prints each file name and any page errors (shader compile errors show up here).
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
problems = []

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    for n, spec in enumerate(specs):
        name = spec.get("name", f"shot{n}")
        page = browser.new_page(viewport={"width": int(spec.get("query", {}).get("w", 1500)), "height": int(spec.get("query", {}).get("h", 800))})
        page.on("pageerror", lambda e, name=name: problems.append(f"{name}: PAGEERROR {e}"))
        page.on("console", lambda m, name=name: problems.append(f"{name}: console.{m.type} {m.text}") if m.type in ("error", "warning") and "GL Driver" not in m.text and "GPU stall" not in m.text and "Automatic fallback" not in m.text else None)
        page.goto(f"{BASE}/tools/island-lab/flora-lab.html?{urlencode(spec.get('query', {}), safe=',')}")
        try:
            page.wait_for_function("window.__ready === true", timeout=60000)
        except Exception:
            print("\n".join(problems) or "the page never became ready", flush=True)
            raise
        out = os.path.join(outdir, f"{n:02d}_{name}.png")
        page.screenshot(path=out)
        print(out, flush=True)
        page.close()
    browser.close()
print("no page errors" if not problems else "\n".join(problems))
