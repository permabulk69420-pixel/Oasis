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
- Creatures: the dune stinger (`src/dune-stinger.js`, `stinger-*.js`) and Colossus 01 (`src/colossus*.js`).
- The sky island and its jungle: `src/sky-island-*.js`, `src/island-*.js` (every plant and landmark a `.glb` in `public/models/island/` built in headless Blender, loaded by `island-glb.js`, drawn by `island-flora.js`; grass `island-grass*.js`).
- Models are in `public/models/`, textures in `public/textures/`, build tools and labs in `tools/`, notes in `docs/`.
- Dev-only URL fixtures for screenshots (`?at=x,z&look=x,z,h`, `?hour=N`, `?start=oasis`, and so on) are listed in `CLAUDE.md`.
