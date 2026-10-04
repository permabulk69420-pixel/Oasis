"""Smoke test: loads the real game in headless Chromium and fails if it is broken.

    python3 tools/smoke/smoke_test.py [--url http://localhost:4173] [--shots out_dir]

Run against the dev server (npm run dev), because the numbers it reads (draw calls, triangles, where the creatures are) are the dev-only
telemetry on the canvas (src/main.js). The Pages workflow runs it before every deploy, so a merge made while nobody is looking cannot ship
a game that does not start. It checks, by day and by night:
  - no uncaught page error and no console.error (the software GL driver's own chatter is ignored),
  - the first frame is drawn and the telemetry appears,
  - the picture is not blank,
  - the scene stays inside a blow-out budget (draw calls and triangles at the spawn point; this catches a runaway, it is not a Quest budget),
  - the stinger's model loads and it shows up in the telemetry,
  - the desert finds (src/mining.js) are laid out, and striking one with a pickaxe takes health off it and drops a stone,
  - saving (src/save-game.js): what you carry, a lit campfire and where you stand come back after a reload, and ?fresh=1 starts clean.
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
    problems += check_finds(page, hour)
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


def check_finds(page, hour):
    """The things to mine: laid out, struck by a pickaxe, and the stone they drop gets made once its model has loaded."""
    problems = []
    if hour != 14:
        return problems
    finds = json.loads(page.evaluate("document.querySelector('canvas').dataset.finds || '{}'") or "{}")
    stats = finds.get("stats", {})
    if stats.get("nodes", 0) < 80:
        problems.append(f"hour {hour}: only {stats.get('nodes', 0)} desert finds were laid out")
        return problems
    hit = page.evaluate("window.__mining && window.__mining.debug.strike('r00', 26, 'pickaxe', { x: 281, z: -306 })")
    if not hit or not hit.get("hit") or hit.get("health", 999) >= 138:
        problems.append(f"hour {hour}: a pickaxe blow on the first outcrop did nothing ({hit})")
    # a few more blows: items must be made (the stone model loads in the background, so the debt is paid once it has)
    for _ in range(3):
        page.evaluate("window.__mining.debug.strike('r00', 26, 'pickaxe', { x: 281, z: -306 })")
    owed = 99
    for _ in range(60):
        owed = page.evaluate("window.__mining.stats().owed")
        if owed == 0:
            break
        page.wait_for_timeout(1000)
    if owed != 0:
        problems.append(f"hour {hour}: broken stone was never made ({owed} drops still owed)")
    wrong = page.evaluate("window.__mining.debug.strike('r01', 30, 'axe', { x: 299, z: -270 })")
    if not wrong or wrong.get("health", 0) < 100:
        problems.append(f"hour {hour}: an axe should only ring off a rock ({wrong})")
    return problems


def check_save(browser, base):
    """Saving: carry something, light a fire and move, reload, and it is all still there; ?fresh=1 then starts a new game.
    The dev build only saves when the address says ?save=1, so the other checks never touch a save. This page has storage of its own."""
    problems = []
    context = browser.new_context(viewport={"width": 640, "height": 360})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
    page.on("console", lambda m: errors.append("console.error " + m.text) if m.type == "error" and not any(s in m.text for s in IGNORED_CONSOLE) else None)

    def open_game(query):
        page.goto(f"{base}/?save=1{query}")
        page.wait_for_function("window.__save && window.__save.autosave.status().active", timeout=LOAD_TIMEOUT_MS)

    try:
        open_game("")
        put = page.evaluate("""async () => {
          const inventory = await import('/src/inventory.js');
          const w = window.__save.world;
          inventory.importInventoryItems([{ type: 'stick', count: 4 }, { type: 'crystal', count: 2 }]);
          let fire = null;
          for (let r = 0; r < 14 && !fire; r += 1.5) for (let a = 0; a < 6.3 && !fire; a += 0.7) {
            const x = 336 + Math.cos(a) * r, z = -304 + Math.sin(a) * r;
            if (w.campfires.canPlace(x, z).ok) fire = w.campfires.place(x, z, { lit: true });
          }
          w.rig.position.x = 338; w.rig.position.z = -308; w.rig.rotation.y = 0.8;
          w.dayNight.setTimeOfDay(20.5);
          return { fire: Boolean(fire), flushed: window.__save.autosave.flush(), bytes: (localStorage.getItem('oasis-save') || '').length };
        }""")
        if not put["fire"] or not put["flushed"] or not (100 < put["bytes"] < 20_000):
            problems.append(f"save: nothing sensible was written ({put})")
        open_game("")
        back = page.evaluate("""async () => {
          const inventory = await import('/src/inventory.js');
          const w = window.__save.world;
          return {
            start: window.__save.start,
            sticks: inventory.getInventoryCount('stick'), crystals: inventory.getInventoryCount('crystal'),
            fires: w.campfires.list().map(f => f.lit),
            at: [w.rig.position.x, w.rig.position.z, w.rig.rotation.y],
            hours: w.dayNight.getState().hours,
          };
        }""")
        if back["start"] != "loaded":
            problems.append(f"save: the second start did not load the save ({back['start']})")
        if back["sticks"] != 4 or back["crystals"] != 2:
            problems.append(f"save: what you carried did not come back ({back['sticks']} sticks, {back['crystals']} crystals)")
        if back["fires"] != [True]:
            problems.append(f"save: the lit campfire did not come back ({back['fires']})")
        if abs(back["at"][0] - 338) > 0.5 or abs(back["at"][1] + 308) > 0.5 or abs(back["at"][2] - 0.8) > 0.05:
            problems.append(f"save: you did not come back where you were ({back['at']})")
        if abs(back["hours"] - 20.5) > 1.0:
            problems.append(f"save: the time of day did not come back ({back['hours']})")
        open_game("&fresh=1")
        fresh = page.evaluate("""async () => {
          const inventory = await import('/src/inventory.js');
          return { start: window.__save.start, items: inventory.getInventoryItems().length, search: location.search, kept: Boolean(window.__save.store.kept()) };
        }""")
        if fresh["start"] != "fresh" or fresh["items"] != 0 or "fresh" in fresh["search"] or not fresh["kept"]:
            problems.append(f"save: ?fresh=1 did not start a new game and keep the old save aside ({fresh})")
    except Exception as exc:  # a timeout waiting for the game, or a script error
        problems.append(f"save: the check could not finish ({exc.__class__.__name__}: {str(exc)[:200]})")
    for e in errors[:8]:
        problems.append(f"save: {e}")
    context.close()
    return problems


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
        found = check_save(browser, args.url.rstrip("/"))
        print(f"save: {'ok' if not found else 'PROBLEMS'}")
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
