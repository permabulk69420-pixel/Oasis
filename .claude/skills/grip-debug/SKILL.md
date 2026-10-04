---
name: grip-debug
description: Use when a held object (fruit, pack, spear, torch, axe) clips through the fingers, or when checking how a hand takes a held item with the hold lab.
---

# Held objects and the hold lab

Moved out of CLAUDE.md so it only loads when needed. Kane's standing rules are still in CLAUDE.md.

- `tools/hold-lab/hold-lab.html` (with `npm run dev`; `?item=pack|spear|torch|axe&side=right&player=1`) shows how a hand takes a held
  thing. Probing the real hands in a headless page needs a temporary `window.__oasis` hook in `src/main.js` (fake controllers,
  fake `renderer.xr.isPresenting`); never commit it. After editing a `src/` file that scratch scripts import with a bare
  `import('/src/x.js')`, restart the dev server, because Vite then serves the app a `?t=` copy and the script gets a second module.
- **Something clips through the fingers when held?** Nearly always the grip solver (`src/adaptive-grip.js`) gave up. It
  shifts the object off the palm by at most 6 cm (`MAX_PALM_SHIFT`); if the open hand still intersects it, `solve`
  returns false and the hand closes on the plain authored pose, with no fitting and no warning. Find out first: the hold
  lab logs `solved true|false` (`item=fruit` and the others; `debug=1` draws the contact outline). Fix it with a grip
  offset on the object, not by touching the solver: the palm normal is the grip socket's X axis, so the point goes
  along X, and the two hands are mirrored (the fruit needs -X on the right hand and +X on the left, see
  `FRUIT.gripOffset` in `src/glow-fruit.js`). Keep one frozen surface object per hand so the solved grip is cached, and
  check both hands. `python3 tools/hold-lab/probe_grip_point.py <item> <side>` tries offsets on every axis (solving is
  not the same as looking right, so render the winners with `tools/hold-lab/lab_shot.py` and look). The solver is
  independent of arm pose, so one good lab render covers the pose in the game.
- Screenshots of the hold lab: `python3 tools/hold-lab/lab_shot.py "<hold-lab query>" out.png` with `npm run dev` running
  (Playwright for Python, Chromium in `/opt/pw-browsers`, SwiftShader flags are in the script).
