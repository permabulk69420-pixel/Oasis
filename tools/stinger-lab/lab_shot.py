"""Screenshot a stinger-lab page.

    npm run dev            # in another shell
    python3 tools/stinger-lab/lab_shot.py "poses=rest,alert,windup,strike&cam=side" out.png
"""
import sys
from playwright.sync_api import sync_playwright

if len(sys.argv) != 3:
    sys.exit(__doc__)
query, out = sys.argv[1], sys.argv[2]
logs = []
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    from urllib.parse import parse_qs
    q = parse_qs(query)
    page = browser.new_page(viewport={"width": int(q.get("w", ["1500"])[0]), "height": int(q.get("h", ["800"])[0])})
    page.on("console", lambda m: logs.append(m.text) if m.type in ("warning", "error") else None)
    page.on("pageerror", lambda e: logs.append("PAGEERROR " + str(e)))
    page.goto(f"http://localhost:4173/tools/stinger-lab/stinger-lab.html?{query}")
    try:
        page.wait_for_function("window.__ready === true", timeout=60000)
        page.wait_for_timeout(2500)  # let the model arrive
    except Exception as e:
        logs.append("TIMEOUT " + str(e))
    page.screenshot(path=out)
    browser.close()
print("\n".join(l for l in logs if "GL Driver" not in l))
