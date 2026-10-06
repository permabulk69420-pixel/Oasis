"""Pictures and numbers from the grip lab (tools/grip-lab/lab.js): a hand on each handle, through the game's own grip code.

    npm run dev      # in another shell (port 4173)
    python3 tools/grip-lab/grip_shot.py outdir [model ...]        (models: kart glider; default both)

For each model, side and view it saves a picture and prints the fit: axisGap (the hollow of the hand to the handle's axis, metres, should be 0),
inside (hand skin vertices inside the handle, should be 0), minRadial (closest the skin comes to the handle's axis, about the handle's radius).
Env: OASIS_URL (default http://localhost:4173), VIEWS (default "end,outside,above,front,wide"), CASES (extra "off;roll" cases, e.g. "0,0,0;30|4,-5,3;-25").
"""
import json
import os
import sys
from urllib.parse import urlencode

from playwright.sync_api import sync_playwright

outdir = sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__)
models = sys.argv[2:] or ['kart', 'glider']
os.makedirs(outdir, exist_ok=True)
BASE = os.environ.get('OASIS_URL', 'http://localhost:4173')
views = os.environ.get('VIEWS', 'end,outside,above,front,wide').split(',')
cases = [tuple(c.split(';')) for c in os.environ.get('CASES', '').split('|') if c]
failed = False
with sync_playwright() as p:
    browser = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    for model in models:
        for side in ('right', 'left'):
            runs = [(v, None, None) for v in views] + [('end', off, roll) for off, roll in cases]
            for view, off, roll in runs:
                page = browser.new_page(viewport={'width': 640, 'height': 480})
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                q = {'model': model, 'side': side, 'view': view}
                if off: q['off'] = off
                if roll: q['roll'] = roll
                page.goto(f"{BASE}/tools/grip-lab/index.html?{urlencode(q, safe=',')}")
                try:
                    page.wait_for_function('window.__grip', timeout=120000)
                    page.wait_for_timeout(800)
                    fit = page.evaluate('window.__grip')
                except Exception as e:
                    fit = {'error': str(e)[:200]}
                tag = f"{model}_{side}_{view}" + (f"_off{off}_roll{roll}" if off else '')
                page.screenshot(path=os.path.join(outdir, tag.replace(',', '_') + '.png'))
                bad = 'error' in fit or not fit.get('contact') or (fit.get('axisGap') or 0) > 0.003 or fit.get('inside', 1) > 0
                failed |= bad
                print(('BAD ' if bad else 'ok  ') + tag, json.dumps(fit), ' '.join(errors)[:300], flush=True)
                page.close()
    browser.close()
sys.exit(1 if failed else 0)
