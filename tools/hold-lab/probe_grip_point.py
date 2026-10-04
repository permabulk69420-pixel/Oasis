"""Try grip points on each axis and say which ones the grip solver can fit ("solved true").

    npm run dev            # in another shell
    python3 tools/hold-lab/probe_grip_point.py fruit right
    python3 tools/hold-lab/probe_grip_point.py fruit left

"solved false" means the solver gave up and the fingers close on the plain authored pose, through the object.
The two hands are mirrored, so a point that works for one usually needs its X flipped for the other. A point that
solves is not always a good hold: render it with lab_shot.py (close=1) and look before choosing.
"""
import sys
from playwright.sync_api import sync_playwright

item = sys.argv[1] if len(sys.argv) > 1 else "fruit"
side = sys.argv[2] if len(sys.argv) > 2 else "right"
values = [-0.07, -0.05, -0.03, 0.0, 0.03, 0.05, 0.07]
candidates = []
for axis in range(3):
    for v in values:
        point = [0.0, 0.0, 0.0]
        point[axis] = v
        candidates.append(point)
with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    for point in candidates:
        page = browser.new_page(viewport={"width": 300, "height": 100})
        logs = []
        page.on("console", lambda m: logs.append(m.text))
        page.goto(f"http://localhost:4173/tools/hold-lab/hold-lab.html?item={item}&side={side}&w=300&h=100&point={','.join(map(str, point))}")
        try:
            page.wait_for_function("window.__ready === true", timeout=60000)
        except Exception:
            logs.append("TIMEOUT")
        line = [l for l in logs if l.startswith("attached")]
        print(point, line[0].split(" bounds")[0] if line else logs[-3:])
        page.close()
    browser.close()
