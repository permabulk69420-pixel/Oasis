"""Screenshot a hold-lab page and print what it logged (look for "solved true|false").

    npm run dev            # in another shell
    python3 tools/hold-lab/lab_shot.py "item=fruit&side=right&close=1&debug=1" out.png

The query string is the hold lab's own (see the top of hold-lab.js). Needs Playwright for Python with Chromium;
the SwiftShader flags are what make WebGL work in the headless sandbox.
"""
import sys
from playwright.sync_api import sync_playwright

if len(sys.argv) != 3:
    sys.exit(__doc__)
query, out = sys.argv[1], sys.argv[2]
logs = []
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    page = browser.new_page(viewport={"width": 1500, "height": 520})
    page.on("console", lambda m: logs.append(m.text))
    page.on("pageerror", lambda e: logs.append("PAGEERROR " + str(e)))
    page.goto(f"http://localhost:4173/tools/hold-lab/hold-lab.html?{query}")
    try:
        page.wait_for_function("window.__ready === true", timeout=60000)
    except Exception as e:
        logs.append("TIMEOUT " + str(e))
    page.screenshot(path=out)
    browser.close()
print("\n".join(logs))
