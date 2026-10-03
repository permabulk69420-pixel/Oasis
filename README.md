# Oasis

A VR desert survival game: one kilometre of desert, an oasis to live around, gathering, crafting and chopping, with continuous first-person movement. Built for Meta Quest 3 using Three.js and Vite.

## Explore

Open the published page in Meta Quest Browser and choose **Enter VR**. Use the left thumbstick to walk and the right thumbstick to turn smoothly. Hold the left stick down to move faster. Movement follows the ground; physical leaning and walking remain tracked. There is no teleportation or snap turning.

Desktop: **Explore**, WASD / arrow up and down to walk, mouse to look, Shift to move faster. Q/E or the left/right arrow keys also turn smoothly. Escape opens the controls. Touch screens have a movement pad and drag-to-look.

## World

- The walkable area is 1,000 × 1,000 metres, centred on `(0, 0)`.
- The pool centre is `(300, -400)`, exactly 500 metres from spawn. It is approximately 80 × 68 metres, with an irregular shoreline and a maximum depth of 0.88 metres.
- A bare sandy bank surrounds the water, followed by a textured grass band on a gently sloping shelf.
- Seeded wind-shaped dunes, sand ripples, wet shore sand, and animated shallow water with reeds and fireflies.
- Around the oasis: blue alien trees, green ferns, alien desert plants, loose sticks and stones. The glowing 81 m veil tree stands a short walk from the pool (`?hero=crimson` swaps the old 60 m tree back in for comparison); small glow fruit lie around its base.
- A short day/night cycle (3 min day, 3 min night while testing; `DAY_SECONDS` / `NIGHT_SECONDS` in `src/day-night.js`) with 2,400 twinkling stars, a moon with a face and a phase, a Milky Way band and now and then a shooting star (`src/night-sky.js`), desert ambience, sand footsteps, and a lightable torch. Night is dark and moonlit; the veil tree's pods glow and light the ground beneath them. Wind blows sand along the dunes: fine grains skimming the ground, soft veils spilling over the crests and big slow clouds of dust, all moved on the GPU (`src/wind-sand.js`). The air is calm at the oasis. The grass, ferns, reeds, desert plants and alien trees sway in the same wind, bending downwind with the gusts that throw the sand, with ripples running across the grass field; it is all in the vertex shader from one time uniform, with nothing for the CPU to do per frame (`src/wind.js`; the hero tree stays still). Lit objects (props, trees, hands, tools) get a faint moonlit fill and a thin cool rim at night so they read as shapes instead of black holes (`src/night-fill.js`).
- A coarse continuation of the sand outside the playable square hides the world edge.

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

Terrain uses 62.5 m chunks with four distance-based geometry levels and skirts to seal LOD edges. Collision samples the same triangles as the nearest terrain. Static dune shadows are computed once during startup. There are no real-time shadow maps, reflection cameras, postprocessing passes, imported art assets, or per-frame geometry generation. A 512 × 512 mipmapped sand detail texture and a 513 × 513 packed height texture are generated locally. Water reflects the real sky, drifting clouds and nearby dunes (a short height-field trace), ripples with two scrolling noise layers, and approximates shallow-water absorption; it does not run a second scene render.

VR requests a 72 Hz refresh rate when supported, a framebuffer scale of 1, and fixed foveation of 0.65. Actual headset frame rate still needs verification on Quest 3; desktop/browser checks cannot certify hardware performance.

`src/world.js` owns dimensions, deterministic height generation, water and hero tree placement, and collision. `src/terrain.js` builds the terrain. `src/materials.js` owns the sand, sky, and water shaders. `src/grass-texture.js` configures the grass texture and its repeat size. `src/oasis-vegetation.js` places the trees, bushes and hero tree. `src/hands.js` owns the VR hands (models in `public/models/hands`) and the held objects. `src/main.js` handles input and rendering. Development-only `?view=shore`, `?view=oasis` (elevated overview), and `?view=wide` camera fixtures support visual QA and are removed by the production build.

## Inventory, crafting and hips

Press **Y on the left Quest controller** to open/close the survivor menu. Point either
controller at something and pull its **trigger** to select it. Walking, turning and jumping
are paused while it is open. Desktop: **Y**, then mouse or Tab/Enter; **Y / Escape** closes.

The menu is three glass panels in the style of Ark:

- **Inventory / Crafting:** a 5 × 5 grid. Tiles show the count (top left) and total weight
  (bottom left). On the crafting tab, a gold edge means you have everything for that recipe.
- **You:** a left and right hip slot, plus health, stamina, food, water and carry weight (all live).
- **Details:** whatever is selected, with its actions: craft, put on the left or right hip,
  or send a hip tool back to the backpack.

| Starter recipe | Materials | Result |
| --- | --- | --- |
| Stone axe | 3 sticks + 2 stones | 1 axe in the backpack |
| Torch | 2 sticks + 1 stone | 1 torch in the backpack |
| Campfire | 6 sticks + 5 stones | 1 campfire in the backpack (placeable) |

**Tools in the world** (`src/tools.js`): every axe and torch is a real object. Grab one with
either hand. Let go next to a hip to holster it there, at your chest to pack it in the
backpack, anywhere else to drop it. Grab it back off the hip whenever you like. Light a held
torch with **B** (right hand) or **X** (left hand).

**Chopping:** swing the axe into a blue alien tree. Six solid hits fell it; it drops two logs
(Wood) and three sticks along where it fell, sinks away, and regrows after three minutes.
Pick up sticks, stones and logs with grip and let go at your chest to pack them.
Inventory is session-only; reloading starts with an empty backpack.

## Survival

Deliberately light (`src/survival.js`, rates in one table at the top):

- **Food and water** drain slowly (about 35 and 22 minutes from full). **Stamina** drains while
  sprinting and returns when you stop; run dry and you can't sprint until it recovers a little.
- **Drink** by wading into the pond. **Eat** glow fruit: grab one with the grip button and bring it
  to your mouth. Fruit lie around the veil tree (stone-sized, faintly luminous so they are easy to
  spot at night) and regrow slowly where they were picked.
- **Health** only slides down if food or water hit zero, and recovers when both are comfortable.
  There is no death yet: health stops at a low floor.

## Campfire

Craft a campfire, select it in the menu and press **Place campfire**: it goes down about 1.6 m in
front of you. It refuses water, steep dune slopes and anywhere within 2.5 m of another fire, and you
can have up to three. Hold a lit torch to the fire (within about half a metre) to light it. A lit
fire has billboarded flames, sparks, a plume of smoke that leans downwind (grey by day, glowing orange near the fire at night), a crackle that fades with distance, and lights the ground and
water around it (`src/campfire.js`, `src/fire-effect.js`). By day the light fades out so the stones
don't bleach. For now a lit fire burns forever; fuel, warmth and putting it out come later.

The model is generated headless in Blender: `python3 tools/campfire/build_campfire.py --out
public/models/campfire/campfire.glb`, then `python3 tools/campfire/check_mesh.py` to check for loose
vertices, open edges and inside-out faces. `tools/campfire/render_preview.py` renders previews.

Development-only camera fixtures: `?view=fruit`, `?view=orchard`, `?view=glade`, `?view=approach`,
`?view=wade`, `?view=gust` (across the wind on a dune crest), `?eye=<metres>` (a lower camera), `?yaw=<deg>` and `?pitch=<deg>` (look direction), `?skytime=<seconds>` (pin the sky clock, e.g. to catch a shooting star), `?sandgain=<n>` (exaggerate the blowing sand), `?windtime=<seconds>` (pin the wind clock so two screenshots can be compared), `?windgain=<n>` (exaggerate the sway), `?at=x,z` and `?look=x,z[,height]` (stand at a world position and look at a point), `?camp=lit` or `?camp=unlit` (puts a campfire on the flattest ground near spawn, with
`?campd=<metres>` for the distance), plus `?hour=N` to fix the time of day.

## Alien bird (model and poses)

A slender heron-like alien bird: midnight-blue back, teal wings, a cream belly, a coral crest, two long streamers with cyan
paddles for a tail, and a few glowing cyan details (the wing-tip dots and the eye). It is a single skinned mesh with one
colour per vertex and a tiny second material for the glow: no textures, two draw calls.

- Three levels of detail, all on the same 19-bone skeleton: `public/models/creatures/alien_bird_lod0.glb` (2172
  triangles, close up), `lod1` (880) and `lod2` (300, far away). The wings are built spread and the legs hanging.
- No baked animation. `src/bird-pose.js` turns a handful of numbers (`fold`, `flap`, `flex`, `sweep`, `legs`, `stretch`,
  `dip`, `crest`, `crouch`, ...) into bone rotations, so flapping, gliding, banking, drinking and folding the wings away are all
  the same code, and the game can blend between them. Folding also shortens the wing and squeezes the hand (a scale on the two
  wing bones) so the finger feathers lie nearly parallel on the flank. The numbers to tune are in `JOINTS`.
- Built headless in Blender from one parametric script: `python3 tools/bird/build_bird.py --out-dir
  public/models/creatures`, then `python3 tools/bird/check_mesh.py` (closed solids, no inside-out shells, skin weights,
  one skeleton) and `python3 tools/bird/render_preview.py` for Cycles previews.
- A pose lab for judging the poses in the browser, never shipped: with `npm run dev` open
  `/tools/bird/lab.html?poses=rest,drink,glide,flapUp,flapDown,land&lod=0&yaw=135` (also `view=under|top`, `zoom=`, and
  `j=foldShoulder.sweep:1.4,foldHand.scaleZ:0.4` to try joint numbers).
