"""Screenshot a finds-lab page.

    npm run dev            # in another shell
    python3 tools/finds-lab/lab_shot.py "what=rock&night=0" out.png
"""
import sys
from playwright.sync_api import sync_playwright

if len(sys.argv) != 3:
    sys.exit(__doc__)
query, out = sys.argv[1], sys.argv[2]
logs = []
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    page = browser.new_page(viewport={"width": 1500, "height": 800})
    page.on("console", lambda m: logs.append(m.text) if m.type in ("warning", "error") else None)
    page.on("pageerror", lambda e: logs.append("PAGEERROR " + str(e)))
    page.goto(f"http://localhost:4173/tools/finds-lab/finds-lab.html?{query}")
    try:
        page.wait_for_function("window.__ready === true", timeout=60000)
        page.wait_for_timeout(2500)  # let the textures arrive
    except Exception as e:
        logs.append("TIMEOUT " + str(e))
    page.screenshot(path=out)
    browser.close()
print("\n".join(l for l in logs if "GL Driver" not in l))
