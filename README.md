# Oasis

A VR desert game for Meta Quest 3 (three.js and Vite): a four kilometre desert with an oasis, a floating jungle island to start on, light survival and crafting, and giant creatures to climb. Ark-lite, with Shadow of the Colossus at the heart.

The long, detailed write-up of every feature (how each thing works, the numbers, the oddities) used to live here. It is now in `docs/readme-archive.md`: search it for the feature you need, do not read it whole.

## Explore

Open the published page in Meta Quest Browser and choose **Enter VR**. Left thumbstick walks, right thumbstick turns smoothly, hold the left stick down to move faster. Click both thumbsticks together (T on a keyboard) for turbo, 10 times speed, for crossing the 4 km world. No teleport or snap turning.

Desktop: WASD or arrow keys to walk, mouse to look, Shift to move faster, Q/E to turn, Escape opens the controls. Touch screens have a movement pad and drag-to-look.

## Run

```sh
npm ci
npm run dev      # port 4173
npm test         # quick checks, no browser
npm run build
```

WebXR needs HTTPS, or localhost in development. Pushing to `main` builds and deploys to GitHub Pages (`.github/workflows/pages.yml`; Settings, Pages, source must be GitHub Actions).

## Where things are

- `src/world.js`, `src/zones.js`, `src/terrain*.js`: the 4 km height field, zones and the terrain tiles. `src/materials.js`: sand, sky and water shaders.
- `src/main.js`: input and rendering. `src/hands.js`: VR hands and held things. `src/survival.js`: health, food, water, stamina.
- Tools and pickups: `src/axe.js`, `spear.js`, `pickaxe.js`, `torch.js`, `backpack.js`, `campfire`. Mining and finds: `src/mining.js`, `src/desert-finds.js`.
- The sand sail kart (`src/sand-kart.js`, model `public/models/sand-kart/`): waits on flat sand by the oasis start. Grab its handle to sit in and roll, turn the handle to steer, let go to coast to a stop. Hands lock onto the grips (either hand, one is enough); seated, your view climbs and rolls with the kart. Desktop: F by the kart, A/D steer.
- The glider (`src/glider.js`, model `public/models/glider/`): you start with one in the inventory. Raise both hands above your head and squeeze both grips to open it; step off the island's edge (or a cliff) and it flies. Lower a hand to bank and turn, hands forward to dive, back to float; let go with both hands to fold it away. Landings do no harm. Desktop: G opens it, A/D bank, W/S pitch.
- Handles on things (the kart's grips, the glider's bar, anything new): `src/handle-hold.js` puts the hollow of the closed hand on the handle's axis, fitted by the same contact solver as held tools, with the handle's thickness measured from its mesh. A new handle needs only a marker empty in its model (position on the handle, plus which local axis the handle runs along). Check the fit without a headset in the grip lab: `npm run dev`, then `python3 tools/grip-lab/grip_shot.py outdir` (pictures plus numbers; it flags any hand skin inside the handle or a hand off its axis). Add the model to `MODELS` in `tools/grip-lab/lab.js`.
- Creatures: the dune stinger (`src/dune-stinger.js`, `stinger-*.js`) and Colossus 01 (`src/colossus*.js`).
- The sky island and its jungle: `src/sky-island-*.js`, `src/island-*.js` (every plant and landmark a `.glb` in `public/models/island/` built in headless Blender, loaded by `island-glb.js`, drawn by `island-flora.js`; grass `island-grass*.js`).
- Models are in `public/models/`, textures in `public/textures/`, build tools and labs in `tools/`, notes in `docs/`.
- Saving is off unless the address has `?save=1`; `?fresh=1` starts a new game. Dev-only URL fixtures for screenshots (stripped from production): `?at=x,z&look=x,z,h&eye=metres&pitch=deg`, `?view=...`, `?hour=N` (0 night, 14 day), `?camp=lit|unlit`, `?bird=perch|fly|flare`, `?treelod=0|1|2`, `?start=oasis`.
