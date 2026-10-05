"""Screenshot colossus-lab pages (several at once, one browser, one load of the 41 MB model per shot).

    npm run dev            # in another shell (port 4173)
    python3 tools/colossus-lab/lab_shot.py outdir "cam=tq&person=1" "cam=head&night=1" ...

Each query string becomes <outdir>/<n>_<query with & replaced by _>.png.
"""
import sys, os, re
from playwright.sync_api import sync_playwright

if len(sys.argv) < 3:
    sys.exit(__doc__)
outdir = sys.argv[1]
os.makedirs(outdir, exist_ok=True)
logs = []
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    for n, query in enumerate(sys.argv[2:]):
        from urllib.parse import parse_qs
        q = parse_qs(query)
        page = browser.new_page(viewport={"width": int(q.get("w", ["1500"])[0]), "height": int(q.get("h", ["850"])[0])})
        page.on("console", lambda m: logs.append(m.text) if m.type in ("warning", "error") else None)
        page.on("pageerror", lambda e: logs.append("PAGEERROR " + str(e)))
        page.goto(f"http://localhost:4173/tools/colossus-lab/colossus-lab.html?{query}")
        try:
            page.wait_for_function("window.__ready === true", timeout=180000)
            page.wait_for_timeout(1500)
        except Exception as e:
            logs.append("TIMEOUT " + str(e))
        name = re.sub(r"[^A-Za-z0-9=,.:-]+", "_", query)
        out = os.path.join(outdir, f"{n:02d}_{name}.png")
        page.screenshot(path=out)
        print(out, flush=True)
        page.close()
    browser.close()
print("\n".join(l for l in logs if "GL Driver" not in l))
