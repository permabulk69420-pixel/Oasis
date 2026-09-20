# Oasis

A small WebXR foundation: one kilometre of desert terrain, a shallow water source, and continuous first-person movement. Built for Meta Quest 3 using Three.js and Vite.

## Explore

Open the published page in Meta Quest Browser and choose **Enter VR**. Use the left thumbstick to walk and the right thumbstick to turn smoothly. Hold the left stick down to move faster. Movement follows the ground; physical leaning and walking remain tracked. There is no teleportation or snap turning.

Desktop: **Explore**, WASD / arrow up and down to walk, mouse to look, Shift to move faster. Q/E or the left/right arrow keys also turn smoothly. Escape opens the controls. Touch screens have a movement pad and drag-to-look.

## World

- The walkable area is 1,000 × 1,000 metres, centred on `(0, 0)`.
- The pool centre is `(300, -400)`, exactly 500 metres from spawn. It is approximately 80 × 68 metres, with an irregular shoreline and a maximum depth of 0.88 metres.
- A bare sandy bank surrounds the water, followed by a grass band on a gently sloping shelf. Add your grass texture using the instructions in `public/textures/grass/README.md`; its colour currently uses a lightweight green fallback.
- Seeded wind-shaped dunes, static terrain lighting, mipmapped sand ripples, wet shore sand, and animated shallow water.
- A coarse continuation of the sand outside the playable square hides the world edge.
- Only terrain, water, sky, and movement. No props, vegetation, buildings, survival systems, objectives, or audio.

## Run

```sh
npm ci
npm run dev
npm test
npm run build
```

WebXR requires HTTPS, or localhost during development. A phone/PC on a plain LAN HTTP address can preview the desert but cannot start immersive VR.

## GitHub Pages

`.github/workflows/pages.yml` tests, builds, and publishes on every push to `main`. In repository **Settings → Pages → Build and deployment**, the source must be **GitHub Actions**. Vite uses relative asset paths, so deployment works beneath `/Oasis/` without a CDN dependency.

## Performance and structure

Terrain uses 62.5 m chunks with four distance-based geometry levels and skirts to seal LOD edges. Collision samples the same triangles as the nearest terrain. Static dune shadows are computed once during startup. There are no real-time shadow maps, reflection cameras, postprocessing passes, imported art assets, or per-frame geometry generation. A 512 × 512 mipmapped sand detail texture and a 513 × 513 packed height texture are generated locally. Water reflects the analytic sky and nearby dunes using a short height-field trace, and approximates shallow-water absorption; it does not run a second scene render.

VR requests a 72 Hz refresh rate when supported, a framebuffer scale of 1, and fixed foveation of 0.65. Actual headset frame rate still needs verification on Quest 3; desktop/browser checks cannot certify hardware performance.

`src/world.js` owns dimensions, deterministic height generation, water placement, and collision. `src/terrain.js` builds the terrain. `src/materials.js` owns the sand, sky, and water shaders. `src/grass-texture.js` configures the optional grass texture and its repeat size. `src/main.js` handles input and rendering. Development-only `?view=shore`, `?view=oasis` (elevated overview), and `?view=wide` camera fixtures support visual QA and are removed by the production build.

## Inventory and starter crafting

Press **Y on the left Quest controller** to open/close the survivor menu. Point either
controller at a tab, recipe, or button and press its **trigger** to select it. The panel
stays where it was opened; walking, turning, and jumping inputs are suspended while it
is open. Head tracking remains active. Close and reopen Y to bring it in front of you.
Desktop: **Y**, then mouse or Tab/Enter; **Y / Escape** closes the panel. Touch users can
use the **Inventory / Y** button; the three-column panel scrolls horizontally in portrait.

- **Left:** inventory and crafting tabs, resource counts, ingredient requirements, and
  a Craft 1 button that only enables when the full recipe is available.
- **Middle:** placeholder level, health, stamina, food, water, melee damage, and crafting
  skill. These preview values do not apply effects. Carry weight below is live.
- **Right:** reserved equipment box for later armour, weapons, and gear.

| Starter recipe | Materials | Result |
| --- | --- | --- |
| Stone axe | 3 sticks + 2 stones | 1 axe in inventory |
| Torch | 2 sticks + 1 stone | 1 torch in inventory |

Collect the existing loose sticks and stones around the oasis with grip, then release
them at your chest to store them. These provisional recipes deliberately use currently
gatherable resources. Crafting spends all ingredients together and updates carry weight.
Crafted tools remain in inventory until equipment handling is added; the existing
physical axe and torch pickups still work as before. Inventory is session-only, as it
was before this menu; reloading starts with an empty backpack.

The menu uses one canvas texture in VR, repainted only when its contents or hover state
change. Controller-ray tests run without a headset; final readability and comfort still
need a Quest check.
