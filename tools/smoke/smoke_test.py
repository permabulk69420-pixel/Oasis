"""Smoke test: loads the real game in headless Chromium and fails if it is broken.

    python3 tools/smoke/smoke_test.py [--url http://localhost:4173] [--shots out_dir]

Run against the dev server (npm run dev), because the numbers it reads (draw calls, triangles, where the creatures are) are the dev-only
telemetry on the canvas (src/main.js). The Pages workflow runs it before every deploy, so a merge made while nobody is looking cannot ship
a game that does not start. It checks, by day and by night:
  - no uncaught page error and no console.error (the software GL driver's own chatter is ignored),
  - the first frame is drawn and the telemetry appears,
  - the picture is not blank,
  - the scene stays inside a blow-out budget (draw calls and triangles at the spawn point; this catches a runaway, it is not a Quest budget),
  - the stinger's model loads and it shows up in the telemetry.
Add a check here when a new system could silently fail to load. Exit code 0 is a pass.
"""
import argparse
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

# Generous ceilings: they catch a mistake like drawing everything twice, not a few thousand triangles (see the perf-triangles skill for those).
BUDGET = {"calls": 250, "triangles": 800_000, "geometries": 400, "textures": 120}
LOAD_TIMEOUT_MS = 240_000
IGNORED_CONSOLE = ("GL Driver Message", "GPU stall", "Automatic fallback to software WebGL", "WebGL", "AudioContext", "favicon")


def check_view(browser, base, hour, shots):
    problems = []
    page = browser.new_page(viewport={"width": 960, "height": 540})
    errors = []
    page.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
    page.on("console", lambda m: errors.append("console.error " + m.text) if m.type == "error" and not any(s in m.text for s in IGNORED_CONSOLE) else None)
    started = time.time()
    page.goto(f"{base}/?hour={hour}")
    try:
        page.wait_for_function("document.querySelector('canvas') && document.querySelector('canvas').dataset.render", timeout=LOAD_TIMEOUT_MS)
    except Exception as exc:  # timeout
        problems.append(f"hour {hour}: the first frame never drew ({exc.__class__.__name__})")
        page.close()
        return problems, {}
    drawn = time.time() - started
    # the stinger is loaded in the background; give it time
    stinger = []
    for _ in range(120):
        raw = page.evaluate("document.querySelector('canvas').dataset.stinger || '[]'")
        stinger = json.loads(raw)
        if stinger:
            break
        page.wait_for_timeout(1000)
    page.wait_for_timeout(2500)
    render = json.loads(page.evaluate("document.querySelector('canvas').dataset.render"))
    if not stinger:
        problems.append(f"hour {hour}: the dune stinger never loaded")
    for key, limit in BUDGET.items():
        if render.get(key, 0) > limit:
            problems.append(f"hour {hour}: {key} {render[key]} is over the blow-out budget {limit}")
    path = os.path.join(shots, f"smoke_hour{hour}.png") if shots else None
    png = page.screenshot(path=path)
    # a blank picture has almost no variation between pixels
    from io import BytesIO
    from PIL import Image, ImageStat
    spread = max(ImageStat.Stat(Image.open(BytesIO(png)).convert("L")).stddev)
    if spread < 3:
        problems.append(f"hour {hour}: the picture is blank (pixel spread {spread:.1f})")
    for e in errors[:8]:
        problems.append(f"hour {hour}: {e}")
    info = {"first_frame_s": round(drawn, 1), "render": render, "stinger": bool(stinger), "pixel_spread": round(spread, 1)}
    page.close()
    return problems, info


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:4173")
    parser.add_argument("--shots", default=None, help="directory to keep the screenshots in")
    parser.add_argument("--hours", default="14,0", help="comma separated hours of day to test (14 is day, 0 is night)")
    args = parser.parse_args()
    if args.shots:
        os.makedirs(args.shots, exist_ok=True)
    problems = []
    with sync_playwright() as p:
        launch = {"args": ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]}
        browser = p.chromium.launch(**launch)
        for hour in [int(h) for h in args.hours.split(",")]:
            found, info = check_view(browser, args.url.rstrip("/"), hour, args.shots)
            print(f"hour {hour}: {json.dumps(info)}")
            problems += found
        browser.close()
    if problems:
        print("\nSMOKE TEST FAILED")
        for line in problems:
            print(" -", line)
        sys.exit(1)
    print("smoke test passed")


if __name__ == "__main__":
    main()
