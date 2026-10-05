# Oasis

A VR desert game: a four kilometre desert with an oasis to start at and other places to find, light survival, gathering and crafting, with continuous first-person movement. It is heading towards Shadow of the Colossus style fights with giant creatures; for now there is one small creature to fight. Built for Meta Quest 3 using Three.js and Vite.

## Explore

Open the published page in Meta Quest Browser and choose **Enter VR**. Use the left thumbstick to walk and the right thumbstick to turn smoothly. Hold the left stick down to move faster. Movement follows the ground; physical leaning and walking remain tracked. There is no teleportation or snap turning.

Desktop: **Explore**, WASD / arrow up and down to walk, mouse to look, Shift to move faster. Q/E or the left/right arrow keys also turn smoothly. Escape opens the controls. Touch screens have a movement pad and drag-to-look.

## World

- The walkable area is 4,000 × 4,000 metres: x from -1,500 to 2,500 and z from -2,500 to 1,500 (`AREA` in `src/zones.js`; mountains close it in, see "The wider world"). The oasis square, x and z from -500 to 500, is the world as it was before it grew and is unchanged.
- The pool centre is `(300, -400)`, exactly 500 metres from spawn. It is approximately 80 × 68 metres, with an irregular shoreline and a maximum depth of 0.88 metres.
- A bare sandy bank surrounds the water, followed by a textured grass band on a gently sloping shelf.
- Seeded wind-shaped dunes, sand ripples, wet shore sand, and animated shallow water with fireflies (the first plain reeds were removed on 5 Oct, the glow reeds took their place).
- Around the oasis: blue alien palms (see The blue palms), green ferns, alien desert plants, loose sticks and stones. The glowing 81 m veil tree stands a short walk from the pool (`?hero=crimson` swaps the old 60 m tree back in for comparison); small glow fruit lie around its base.
- A short day/night cycle (3 min day, 3 min night while testing; `DAY_SECONDS` / `NIGHT_SECONDS` in `src/day-night.js`) with 2,400 twinkling stars, a moon with a face and a phase, a Milky Way band, now and then a shooting star and the great ringed planet this moon circles (`src/night-sky.js`, see "The ringed planet and the sun's path"), desert ambience, sand footsteps, and a lightable torch. Night is dark and moonlit; the veil tree's pods glow and light the ground beneath them. Wind blows sand along the dunes: fine grains skimming the ground, soft veils spilling over the crests and big slow clouds of dust, all moved on the GPU (`src/wind-sand.js`). The air is calm at the oasis. The grass, ferns, glow plants, desert plants and alien trees sway in the same wind, bending downwind with the gusts that throw the sand, with ripples running across the grass field; it is all in the vertex shader from one time uniform, with nothing for the CPU to do per frame (`src/wind.js`; the hero tree stays still). Lit objects (props, trees, hands, tools) get a faint moonlit fill and a thin cool rim at night so they read as shapes instead of black holes (`src/night-fill.js`).
- Alien birds fly over by day, and now and then one lands on the bank to drink (see Alien birds in the game).
- Beyond the walkable area a mountain rim carries on out of sight, so there is no edge to see.

## The wider world

The desert is 4 km by 4 km, and the oasis (the old 1 km square, x and z from -500 to 500) sits in it exactly as it was: `terrainHeight` is the old function inside that square and `tests/zones.test.js` pins twelve of its heights. Everything new is in `src/zones.js`, which is data (`AREA`) plus `shapeTerrain`, so a later area is a new table rather than new terrain code. It is still one biome; the variety is where the bedrock comes through and where the dunes flatten out.

- **The gravel plain** (a 1 km oval north of the oasis, centre `(-120, -1300)`, level at 11.5 m) is the likely home of the first colossus: flat, empty of finds on purpose, and framed by a long ridge on its north and west sides, with the open dunes to its east and south.
- **The mesa landmark** (`(420, -1960)`, 125 m high, stepped cliffs) stands 1.7 km north of the oasis and shows over the dunes from the start. There are two more mesas.
- **Badlands** east (`(1750, -250)`) and west (`(-1050, 380)`): dunes give way to layered bedrock cut into buttes and gravel washes (noise stepped into strata, `badlands` in `AREA`).
- **The canyon**: a plateau at `(1700, -1250)` with a winding cut through it from west to east, a floor you can walk and walls 70 m high.
- **The salt pan** south (`(450, 950)`): a pale, perfectly flat floor lower than the dunes, with a ridge behind it.
- **The rim**: from 140 m inside the edge the ground rises into mountains (up to about 270 m), carries on outside the walkable area and ends in a coarse horizon mesh out to 12 km. The player is stopped 40 m inside the edge, already on the mountain side (`WALK`).

The ground reads the zones from a third vertex attribute, `zone` (rock, salt, gravel, each 0 to 1), which the sand shader uses for strata colours (banded by height, wobbled, faded with distance so far mountains do not shimmer), pale salt and pebbly gravel. Inside the oasis square the zone is zero and the shader is unchanged. Slopes and the zones do not change how the player moves.

How it is drawn (`src/terrain-tiles.js` chooses, `src/terrain.js` builds and shows):
- A quadtree of square tiles around the player. The smallest is the old 62.5 m chunk with the old two levels of detail (32 segments within 140 m, 16 beyond), so the oasis looks as it did; tiles double in size to 125, 250, 500 and 1,000 m with distance (`TERRAIN.sizes`; a tile splits into four when the player is within `split` metres). Skirts (deeper for coarser tiles) hide the cracks between levels.
- Heights come from a lazy tile cache (`createHeightField` in `src/world.js`, tiles of 32 cells with a one cell apron). Nothing is computed until someone walks or looks near it. `sample` is still mesh-accurate. Coarser tiles read `terrainHeight` directly.
- Tiles the player will need soon (`TERRAIN.lead`, 25% further out) are built a few at a time, nearest first (`buildBudgetMs` per update), and old geometry is dropped when more than `cacheLimit` are held. A tile that is on screen and not yet built is built at once, so there are never holes.
- The oasis' water shaders still read their own fixed 513 x 513 height texture of the old square. The wind-blown sand, which can be anywhere, keeps a 128 x 128 window of the ground round the player (`src/ground-window.js`), moved when the player is 36 m off its middle.
- Beyond a 600 m haze distance the air thickens more slowly than before (`air` in `src/materials.js`), so a mesa a kilometre or two away still reads.

Finds: the wider world has 16 rock groups and 11 spire groves (`wild*` in `FINDS`, `src/desert-finds.js`), placed by a second pass with its own random stream so the oasis' 123 nodes and their ids are untouched. No new crystals (Kane, 5 Oct). Not on the gravel, the salt or the rim.

Dev: `?at=x,z&look=x,z,h&eye=metres` puts the camera anywhere (`eye` is the camera height above the ground, so `&eye=300&pitch=-30` is a bird's eye view). `window.__terrain` in the dev build shows the tile counts.

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

Terrain is a quadtree of tiles around the player (see "The wider world"), with skirts to seal the edges between levels of detail. Collision samples the same triangles as the nearest terrain. Static dune shadows are computed once during startup. There are no real-time shadow maps, reflection cameras, postprocessing passes, imported art assets, or per-frame geometry generation. A 512 × 512 mipmapped sand detail texture and a 513 × 513 packed height texture are generated locally. Water reflects the real sky, drifting clouds and nearby dunes (a short height-field trace), ripples with two scrolling noise layers, and approximates shallow-water absorption; it does not run a second scene render.

VR requests a 72 Hz refresh rate when supported, a framebuffer scale of 1, and fixed foveation of 0.65. Actual headset frame rate still needs verification on Quest 3; desktop/browser checks cannot certify hardware performance.

`src/world.js` owns dimensions, deterministic height generation, water and hero tree placement, and collision; `src/zones.js` shapes the ground beyond the oasis. `src/terrain.js` builds the terrain. `src/materials.js` owns the sand, sky, and water shaders. `src/grass-texture.js` configures the grass texture and its repeat size. `src/oasis-vegetation.js` places the trees, bushes and hero tree. `src/hands.js` owns the VR hands (models in `public/models/hands`) and the held objects. `src/main.js` handles input and rendering. Development-only `?view=shore`, `?view=oasis` (elevated overview), and `?view=wide` camera fixtures support visual QA and are removed by the production build.

## Inventory, crafting and hips

Press **Y on the left Quest controller** to open/close the survivor menu. Point either
controller at something and pull its **trigger** to select it. Walking, turning and jumping
are paused while it is open. Desktop: **Y**, then mouse or Tab/Enter; **Y / Escape** closes.

The menu is three glass panels in the style of Ark:

- **Inventory / Crafting:** a 5 × 5 grid. Tiles show the count (top left) and total weight
  (bottom left). On the crafting tab, a gold edge means you have everything for that recipe.
- **You:** a left and right hip slot, a Back slot for the backpack, plus health, stamina, food, water and carry
  weight against your carry limit (all live).
- **Details:** whatever is selected, with its actions: craft, put on the left or right hip,
  send a hip tool back to your inventory, or take the backpack off.

| Starter recipe | Materials | Result |
| --- | --- | --- |
| Stone axe | 3 sticks + 2 stones | 1 axe in your inventory |
| Torch | 2 sticks + 1 stone | 1 torch in your inventory |
| Stone-tipped spear | 3 sticks + 1 stone | 1 spear in your inventory (see The spear) |
| Stone pickaxe | 3 sticks + 3 stones | 1 pickaxe in your inventory (see The desert finds) |
| Campfire | 6 sticks + 5 stones | 1 campfire in your inventory (placeable) |

**Tools in the world** (`src/tools.js`): every axe, torch and spear is a real object. Grab one with
either hand. Let go next to a hip to holster it there, at your chest to pack it away in your
inventory, anywhere else to drop it. Grab it back off the hip whenever you like. Light a held
torch with **B** (right hand) or **X** (left hand).

**Dropping and throwing** (`src/falling.js`, `src/hand-motion.js`): a tool you let go of in the open no longer snaps to the sand. It falls from
your hand with the speed and turn your hand had over its last tenth of a second, so letting go while you swing throws it. It is not a physics
engine: each tool is a thin rod with a centre of mass, gravity and a little drag act on it in the air, it bounces a little, then topples about the
end that touched until it lies along the ground (an axe also rolls its head flat), so it lies along a slope and never through it. A spear coming
down point-first at a decent speed sticks in the sand; slower or flatter it lies. Things do not hit each other, and the ground is the mesh-accurate
height field. Pick a lying tool up by reaching for any part of it (not just the handle end). Constants are in the `FALL` table; each tool kind
carries a `fall` entry (radius, landing `lie`/`stick`, centre of mass). `?view=throws` (dev) throws and drops a few tools in front of the camera.

**Chopping:** swing the axe into a blue alien tree. Six solid hits fell it; it drops two logs
(Wood) and three sticks along where it fell, sinks away, and regrows after three minutes.
Pick up sticks, stones and logs with grip and let go at your chest to pack them.
Everything you carry is one shared pool with a weight per item (stick 4, stone 8, wood 6, fibre 1, crystal 4, axe 10, torch 5, spear 10, pickaxe 12, campfire 25).
Your pockets carry 40; past the limit you walk at half speed, easing off to a standstill at twice the limit. Wearing the
backpack lifts the limit to 100 (see The backpack). The inventory is saved with the rest of the game (see Saving).

## Survival

Deliberately light (`src/survival.js`, rates in one table at the top):

- **Food and water** drain slowly (about 35 and 22 minutes from full). **Stamina** drains while
  sprinting and returns when you stop; run dry and you can't sprint until it recovers a little.
- **Drink** by wading into the pond. **Eat** glow fruit: grab one with the grip button and bring it
  to your mouth. Fruit lie around the veil tree (stone-sized, faintly luminous so they are easy to
  spot at night) and regrow slowly where they were picked.
- **Health** only slides down if food or water hit zero, and recovers when both are comfortable.
  There is no death yet: health stops at a low floor.

## Saving

**Saving is switched off for now** (Kane, 5 Oct: he wants a fresh world each time while testing; a save the player chooses may come later). Open the page with `?save=1` to turn it on, in any build; the rest of this section describes it when it is on. The game then saves itself, quietly (`src/save-game.js`): no button and no menu. The Quest browser reloads a page now and then (for instance
after the headset has been off), and with this a reload puts you back where you were.

- **What is saved**: what you carry, health, food, water and stamina, the time of day, where you stand and which way you face, every
  tool (on a hip, lying in the sand, still burning if it is a lit torch, or still standing where it was planted), campfires and whether
  they are lit, the backpack (worn, or lying where you left it), and which rocks you have broken.
- **What is not**: trees (they regrow within minutes anyway), loose sticks, stones and fruit (they are scattered again), and the
  creatures (the stinger starts at home).
- **When**: every 10 seconds while playing, and at once when the page is hidden, the headset comes off, a VR session ends or the menu
  is closed. Nothing is written until everything saved has been put back, and the models (tools, campfire, backpack) have loaded, so a
  slow load can never save an empty world over a full one.
- **A new game**: open the page with `?fresh=1`. The old save is kept aside, not deleted (`oasis-save-kept` in local storage). A save
  that cannot be read, is from another version of the format (`SAVE.version`), or has been through two starts that never got as far as
  drawing for 3 seconds is set aside the same way and the game starts clean. Local storage that is missing or refuses is fine: the game
  just does not save.
- **A VR session starts where the saved game left you** (not at the start of the world). Leaving VR and entering again continues from
  where you left off.
- **Development**: saving is off unless the address has `?save=1` (in every build) (so the screenshot fixtures stay repeatable). The browser
  check is in `tools/smoke/smoke_test.py`. Tools take part with `snapshot()` / `restoreSnapshot()` in `src/tools.js` (a kind adds
  `saveState` / `loadState` for what it keeps about itself, e.g. the torch's flame); the backpack with `snapshot()` / `restore()`;
  the mined rocks with `serialize()` / `restore()` in `src/mining.js`. When a part of the game changes what it holds, add it to the
  list in `src/main.js` and to `CLEANERS` in `src/save-game.js`, and bump `SAVE.version` only if an old save can no longer be read.

## Campfire

Craft a campfire, select it in the menu and press **Place campfire**: the menu closes and a see-through ghost of the fire follows where
you aim (`src/placement.js`), green where it can go and red where it can't, with a line of text above it (what to press, or why not).
In VR the hand that pressed Place aims (a faint line runs from it) and its trigger places it; opening the menu (Y) backs out.
On a monitor you aim with the view centre and click or press Enter; on a touch screen, tap. It sits within 0.9 to 6 m of you and
snaps to a 0.2 m grid (a steady hand, and a fixed turn for each spot). The campfire is only used up when you place it. It refuses water, steep dune slopes and anywhere within 2.5 m of another fire, and you
can have up to three. Hold a lit torch to the fire (within about half a metre) to light it. A lit
fire has billboarded flames, sparks, a plume of smoke that leans downwind (grey by day, glowing orange near the fire at night), a crackle that fades with distance, and lights the ground and
water around it (`src/campfire.js`, `src/fire-effect.js`). By day the light fades out so the stones
don't bleach. A lit fire burns forever.

The model is generated headless in Blender: `python3 tools/campfire/build_campfire.py --out
public/models/campfire/campfire.glb`, then `python3 tools/campfire/check_mesh.py` to check for loose
vertices, open edges and inside-out faces. `tools/campfire/render_preview.py` renders previews.

Development-only camera fixtures: `?view=fruit`, `?view=orchard`, `?view=glade`, `?view=approach`,
`?view=wade`, `?view=gust` (across the wind on a dune crest), `?eye=<metres>` (a lower camera), `?yaw=<deg>` and `?pitch=<deg>` (look direction), `?skytime=<seconds>` (pin the sky clock, e.g. to catch a shooting star), `?sandgain=<n>` (exaggerate the blowing sand), `?windtime=<seconds>` (pin the wind clock so two screenshots can be compared), `?windgain=<n>` (exaggerate the sway), `?at=x,z` and `?look=x,z[,height]` (stand at a world position and look at a point), `?camp=lit` or `?camp=unlit` (puts a campfire on the flattest ground near spawn, with
`?campd=<metres>` for the distance), `?bird=perch|fly|flare` (see Alien birds in the game), `?view=pack` (beside the backpack), `?pack=worn` (start wearing it, see The backpack) `?view=spear` (beside the spear) and `?view=throws` (tools thrown and dropped, see Dropping and throwing), plus `?hour=N` to fix the time of day, and `?save=1` (turn saving on in a dev build, see Saving). `?fresh=1` (a new game) works in production too.

## Alien birds in the game

Now and then an alien bird turns up in daylight. It is scenery and atmosphere only: nothing about it changes how the
game plays. `src/alien-bird.js` makes the birds and picks their model, `src/bird-brain.js` is what one bird does (a small
state machine with no three.js in it) and `src/bird-flight.js` plans its routes. The numbers to tune are at the top of
each file.

- **When:** at most two at a time. The first arrives 12 to 22 seconds into the day and the next one 45 to 90 seconds
  after each one, and no new bird once the light starts to fade. At dusk everything in the air heads away and
  everything perched takes off; nothing arrives at night.
- **A visit:** if you are within a couple of hundred metres of the pond, about two in three come to drink. One flies in
  from 260 m off, circles the pond spiralling down, flares with its wings out and lands on a flat bit of the bank (never
  in the water, on a steep slope, near a campfire or in the glowing fruit under the veil tree). It folds its wings, drinks,
  looks about and stays 26 to 46 seconds, then crouches and takes off into the wind. The rest just cross the sky and soar
  in one lazy circle.
- **Skittish:** a perched bird notices you at 24 m (head up, crest raised) and flies off if you come within 8 m. A landing
  is called off if you are standing near the spot.
- **Flight:** routes are chains of Bézier curves with a steady speed profile, banking into the turns, flapping in bursts
  with glides between, and legs trailing. The bird never flies lower than 12 m above the ground away from its landing.
- **Cost:** up to three draw calls a bird (body, glow, shadow; the far model has no glow), 2,172 triangles close up. The model switches by distance
  (0 to 32 m, 32 to 95 m, beyond), with a little give at each boundary so a bird right on one does not flicker; shaders
  are compiled while loading so the first bird does not hitch a frame; no arrays or objects are created per frame. A soft blob shadow,
  laid on the slope under the bird and thrown away from the sun, gives a bird in the air some weight over the dunes.
- **Development fixtures** (stripped from the production build): `?bird=perch` (standing in front of you, side on),
  `?bird=fly` (circling ahead) or `?bird=flare` (about to land, seen from the side), with `?birdd=<metres>` for how
  far away, `?birdalt=<metres>` for the height, `?birdt=<metres>` for where on the circle, `?birdseed=<n>` to make
  its choices repeatable and `?birdfreeze=0` to let it move instead of freezing it. With no `?bird=` fixture,
  `?birdwait=<seconds>` makes the first bird due that many seconds into the day.

### Model and poses

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

## The dune stinger in the game

One dune stinger (the scorpion, model v3 from `tools/dune-stinger/v3/`: plated carapace, eight three-part legs, two pincers, a long jointed tail) lives in the dunes to the right of where you
start, about 46 m away, and it is a fight (Kane: "this is basically our rat"). It patrols (stands about, glances round, walks a short
way, never further than about 22 m from its patch, never into the pond, the hero tree's clearing or up a steep face). If you come
within 22 m **and it can see you** (a dune between you hides you) it stops, faces you and goes on guard (tail curled up, mandibles
open) for about a second, then **stalks you slowly** (1.15 m/s; you walk at 2.6) with its tail up. Within 4.8 m it winds up: it crouches,
the tail straightens and rears back and the eyes and sting flare bright, for about a second. That is the warning. About 0.6 s in, its
aim locks onto where you are; then the tail whips forward and lands at that spot 0.13 s into a 0.24 s strike, with a short lunge.
**If you have moved out of that spot, it misses**; if not it costs you 18 health (a buzz in both controllers). Then it is open for
about 1.3 s, and winds up again if you are still close.

You hurt it with the **spear** (34 at full speed) or the **axe** (28), held or thrown. What counts is how fast the point or head is
moving relative to your body (so walking into it does nothing), and a blow does between 35% and 100% of the damage by speed. A thrown
tool bounces off. The same tool cannot land two blows within half a second. It has 100 health: a blow makes it flinch (stops what it
was doing), and when it is low it backs off for 3 to 5 s, then comes back. At zero it dies (legs curled in, tail lying on the sand, eyes dark),
lies there for 40 s and then is gone; it **comes back at its home 150 s after dying**. Your health stops at 10 (`healthFloor`), there is
no death yet, and nothing drops from it yet.

- `src/dune-stinger.js` is the scene side: loads the three levels of detail (`public/models/creatures/dune_stinger_lod0..2.glb`,
  33,088 / 10,988 / 1,992 triangles, 55 bones each, switched at 28 m and 80 m), scales it up 2.5 times (`DUNE_STINGER.scale`; the body and
  claws are 1.5 m long in the model, so about 3.8 m in the game, and the tail rears about 3.5 m high), stands it on the ground tilted to the slope
  under its four corners, keeps the glowing eyes and sting at the same look by day and night (`exposureGlow`, like the backpack's trim,
  and flared in the windup and strike), draws a soft shadow under it, checks line of sight over the dunes (`lineOfSight`), and answers
  `hitTest(point, radius)` for blows: a capsule along each part (`DUNE_STINGER.hitParts`: head, body, tail pieces, sting, both claws), only worked out
  when the blow is within 7 m, with the bone positions read once per frame.
- `src/stinger-brain.js` is the behaviour with no three.js in it: modes idle, turn, walk, alert, stalk, windup, strike, recover, hurt,
  retreat, return, dead. `src/stinger-pose.js` turns a handful of numbers (gait, phase, turn, alert, head, windup, strike, hurt, dead)
  into bone rotations, with no baked animation. The eight legs are **solved**: each foot has a spot on the ground and a path (slide back, lift, swing
  forward) and a two-bone solver bends the hip and knee to put the claw tip there, so a foot stays planted while the body walks over it, the legs bend
  deeper in the windup crouch and fold up under the body when it dies. The rest is the body swaying as it walks, breathing, the pincers (raised and open
  on guard, flung wide in the windup, snapping shut in the strike), the jaws, the tail's slow sway, the windup (tail cocked up and back), the strike (the
  tail arches over the body and the sting lands on the ground about 2.3 m ahead of its middle), the flinch and the death (the tail lies on the sand behind it, curled to one side).
  The walking cycle follows the ground covered (`JOINTS.stride`), so the feet do not skate.
- The fight has some weight to it (`src/sand-puffs.js`, one instanced mesh of soft dust clouds for the whole world, 96 puffs at most, simulated on the CPU, lit like the
  wind-blown sand and faded out where they meet the dune): sand is kicked up behind the stinger as it lunges, a ring of dust and a plume jump up where the sting lands,
  a blow that connects knocks off a few dark chitin chips (the same `src/bursts.js` pool the mining uses) and a puff of sand, and when it dies it falls in a cloud with a
  burst of chips. The dead body then **sinks into the dune** over the 40 s it lingers (the terrain hides it) and a new one **climbs out of the sand** at its home
  when it respawns. Numbers are `DUNE_STINGER.sink`, `.rise` and `.fx`; the dev build has `window.__stinger` and `window.__sandPuffs` for screenshots.
- `src/weapon-hits.js` is the other half of a fight: any tool kind with a `hit` entry (`src/spear.js`, `src/axe.js`: the point that does
  the damage, its radius, the speed it must reach and the damage at full speed) is checked every frame against anything with
  `hitTest` and `hurt`. `src/survival.js` has `damagePlayer`.
- Tuning is in the tables at the top of those files: `DUNE_STINGER` (scale, home, glow, hit parts), `BRAIN` (speeds, distances, the
  windup, aim lock and strike times, damage, health, retreat and respawn), `JOINTS` (how far the legs swing and lift, how the tail
  moves in each pose) and `HITS` in `weapon-hits.js`.
- The model is built in Blender by `tools/dune-stinger/v3/build_stinger_v3.py` (see `tools/dune-stinger/README.md`); `tools/stinger-lab/` is a page for judging its poses
  without walking out to it. The tail is 2 m long in the model so a strike can reach a person's head.

## Footprints

Where you have walked on the sand you leave prints, and so does the dune stinger (`src/footprints.js`). Your feet alternate every 0.74 m (1.05 m when you run
faster than 3.7 m/s), each a hand's width off the line you walk and turned a little outward, pointing the way you go. Nothing is laid while you are in the air, standing
still or shuffling in a circle, and not on grass or under the water. The stinger lays a small four-claw mark wherever one of its eight feet comes down (`plantedFeet` in
`src/stinger-pose.js` reads the gait, so a print is where the foot really lands, not near it); each is scaled with the creature.

A print is a decal that **multiplies** the ground under it, so it takes the sand's own colour and light by day, by firelight and at night. It is shaded like a dent
lit from the sun's side (the sole is a parametric foot, heel, arch, ball and toes; the claw mark is four small pits), with a slightly darker, pressed floor and a low rim. At night
the sun gives no light, so only the pressed floor shows. **The wind fills them in:** a print holds for the first 18% of its life, then softens, spreads a little and is gone
(150 s for yours, 220 s for the stinger's). Prints thin out between 34 and 62 m from you. Each kind has its own ring of 480 slots (the oldest is reused, and the creature cannot push yours out),
the whole lot is one instanced draw call, nothing is allocated per frame, and nothing is drawn until the first print is laid. It is not saved: a reload starts with clean sand.
Numbers are in the `PRINTS` table at the top of the file; the dev build has `window.__prints` (`walk`, `plant`, `reset`, `laid`) for screenshots. No sound.

## The desert finds and the pickaxe

Something to walk out into the dunes for. About 120 things stand in 25 places across the world (`src/desert-finds.js`, a fixed seed, so the
world is the same every session): two **sandstone outcrops** and three **spire plants** a short walk from the start, a patch of
**crystals on the stinger's ground** (the first prize costs a fight), and then 24 far sites 105 to 410 m out, the richer ones further.

| Find | What it is | Tool | Gives |
| --- | --- | --- | --- |
| Sandstone outcrop | mesa, hoodoo, boulder or slab, 1.2 to 4.4 m tall. Real CC0 1k PBR sandstone (Poly Haven "Cliff Side": colour + normal in `public/textures/sandstone/`, credited there) wrapped so the beds stay level. **Solid**: you are walked out of it. | pickaxe | stone, a piece for every 30 damage, plus two when it goes |
| Crystal cluster | violet shards (the odd cyan one) that shine most at the tips and glow at night with a soft violet halo, so a field is a smudge of light across the dunes | pickaxe | crystal shards (hand-sized, weight 4; what they are for is still a mystery) |
| Spire plant | tall, spiny, teal alien plant ("not a cactus") | axe (a pickaxe half as well, a spear poke less) | fibre (weight 1) |

- **The blow** (`src/weapon-hits.js` -> `src/mining.js`): the pickaxe's point, swung fast enough (2.3 m/s of the point relative to your body to
  count, 5.8 for full damage 26), takes health off the node, shakes it and throws chips (a crystal throws glowing sparks). The wrong tool just
  rings off it: sparks, a shake and the jolt in your hand, no damage. When the health is gone a rock sinks and crumbles, a crystal shatters,
  a spire falls over; it is gone for 900 / 700 / 300 seconds and then grows back (a rock rises, the others grow). A thrown tool bounces off.
- **The pickaxe** (`src/pickaxe.js`, model `public/models/pickaxe/pickaxe.glb`, 2,344 triangles, built by `tools/pickaxe/build_pickaxe.py`):
  stands in the sand by the other starting tools (3 m left of the axe) and can be crafted. Held like the axe, long pick forward, the fist low on the haft near the butt; carried upside down on a
  hip leaning back. It also hurts the stinger (26).
- **What drops** pops out of the node on the side you hit it from and lands beside it: stone joins the loose stones (`src/stones.js`),
  crystals the same group (`src/loose-finds.js`), fibre the loose sticks. Pick them up with grip, let go at your chest to pack them (the same
  path as a stone or a stick). At most 90 mined items lie about; the oldest one nobody holds is tidied away past that.
- **Cost:** about 120 nodes in a few instanced meshes (one per variant and level of detail: 70 m, 190 m, then far; rocks 324 to 756
  triangles close, 96 to 160 far; crystals 81 to 153; spires about 1,000 close), plus one halo draw and two small particle pools. At the start
  that is 104 draw calls and 276,000 triangles in all.
- **Crystal motes** (`src/crystal-motes.js`, `tests/crystal-motes.test.js`): at night tiny violet specks (one in five cyan, like the odd cyan shard) lift off every
  standing crystal, wander, lean downwind with the sand's gusts and fade out, so a crystal field shimmers from a long way off. One `Points` draw for all
  the crystals (about 600 motes), all the motion in the vertex shader (the CPU sets a clock, and fades a crystal's own motes when it is broken or grows
  back); thin out from 70 m and gone by 150 m; none by day. They are sized in metres (so a mote looks the same on the Quest as on a monitor). The numbers
  (count per crystal, rise, size, brightness) are in `MOTES`. The pond already had fireflies (`src/water-fireflies.js`), so these went to the crystals.
- **Numbers** are in `MINING` (`src/mining.js`): health per kind and variant, damage per drop, what each tool does to each kind, respawn
  times, shake, level-of-detail distances. The layout numbers are `FINDS` (`src/desert-finds.js`).
- **Files:** `src/find-shapes.js` (the shapes, pure procedural geometry with three levels each), `src/find-materials.js`, `src/mining.js`,
  `src/loose-finds.js`, `src/bursts.js` (the flying chips), `tools/finds-lab/` (a scratch page that lays every shape out:
  `python3 tools/finds-lab/lab_shot.py "what=rock|crystal|spire|held&night=1" out.png`), `tools/props/` (Blender helpers for props).
- Development only: `window.__mining.debug.strike('r00', 26, 'pickaxe', { x, z })` strikes a node as if swung (the smoke test uses it);
  `window.__mining.list({x, z}, 60)` lists nearby nodes.

## The giant bones

Something to see on the skyline and walk out to (`src/giant-bones.js`). About 230 m from where you start, the skull of something enormous lies in the dunes with its jaws open and
turned towards you, and the ribcage of the same animal stands behind it, 43 m further out. A smaller ribcage lies a long walk away the other way (about 320 m). Nothing
about them is gameplay: you can walk through them, they cast no shadow and there is no sound. At the carcass's scale (1.6) the skull is about 18 m long, more with its
horns, and the ribs stand about 14 m tall with a row of spines above them.

The layout is a pure function of a seed and the real height field (`layoutBones`), so the world is the same every session. The carcass is found by searching round the start for ground that is level
enough (the highest and lowest ground under a model within 2.2 m per unit of scale), at least 125 m from the pond, 100 m from the hero tree, 75 m from the stinger's home and clear of every
desert find, with the ribs in sight of the start (so the first thing you see is a ribcage over a dune); the skull is turned to face the start (within 0.28 radians). The skull follows the
lean of the ground, the ribs stand upright with their feet buried. The models are single sided, with vertex colours only (ivory, sand stain where they are buried, a little teal mineral).

| Model | Close (within 75 m, times the scale) | Middle (to 200 m) | Far |
| --- | --- | --- | --- |
| Ribs (`GiantRibs`, 53 closed parts) | 23,592 triangles, 630 KB | 5,716, 190 KB | 2,256, 105 KB |
| Skull (`GiantSkull`, 49 parts) | 17,088 triangles, 455 KB | 4,476, 149 KB | 1,496, 62 KB |

- **Levels of detail are fetched as you need them.** Only the far level of each is requested at the start; the middle level is fetched as soon as you are within its distance (that is at the start,
  since the carcass sits in the middle band), and the close level when you come within 1.5 times the distance it takes over at, so it has arrived by the time you reach it. While a better level is
  on its way the nearest level that has arrived stays on screen. Each file is requested once. A file that fails to load reports once and that model is just missing. Nothing is drawn past 900 m.
- **Cost:** one draw call per model on screen; from the start the carcass is 10,200 triangles and the lone ribcage 2,300 (when in view); standing at the ribs with both close levels shown it is about 41,000.
- **Built in Blender** by `tools/giant-bones/build_bones.py` on `tools/props/propkit.py`: every rib is a tube along a curve with lumps and flutes, with a collapsed stretch of spine, one missing pair of ribs, snapped ends,
  fallen ribs and loose vertebrae; the skull has a crest, two horns, brow and cheek spikes, deep eye sockets, an upper row of conical teeth (one lost, two broken) and a lower jaw lying flat with its own teeth.
  Rebuild: `pip install bpy --break-system-packages`, then `python3 tools/giant-bones/build_bones.py --model both --lod all --outdir public/models/bones`; check each file with
  `python3 tools/props/check_mesh.py public/models/bones/giant_skull_lod0.glb --nodes GiantSkull --materials Bone --budget 18000` (every shell must be a closed, outward facing solid);
  preview with `python3 tools/props/render_preview.py --glb <file> --outdir <dir> --tag <name> --views front,side,threeq --ground 0`.
- **Numbers** are in the `BONES` table at the top of `src/giant-bones.js` (seed, distances, scales, the clear distances, the level of detail distances and hysteresis).
- Development only: `window.__bones` (`list()` says which level each site wants and shows, `request(kind, level)`, `sites`) and `canvas.dataset.bones`, which the smoke test reads (all three sites must show a model).
  Tests are `tests/giant-bones.test.js` (the layout rules, the loading with a fake loader, and the six model files).

## The ringed planet and the sun's path

The desert is on a moon, and the planet it circles hangs in the sky (`src/night-sky.js`): a teal banded gas giant, three moons across, with cream rings, to the right of where you first look (about 21 degrees up). The moon always shows it the same face, so
it never rises or sets; it is lit by the sun and goes through phases (a thin crescent in the morning, nearly half by noon), the rings throw their shadow on it and it throws its own across the rings. By night it is the second brightest thing in the sky (the stars behind it
are switched off, so it is a dark disc against the stars where it is unlit); by day it is a pale ghost showing only its lit side and its rings, like the moon in daylight. It is drawn in the sky shader as seen from far off (no geometry, no texture of its own: the cloud
noise texture gives the bands their turbulence), so outside the few percent of the sky it covers it costs one dot product per sky pixel. Everything is in the `PLANET` table at the top of `night-sky.js` (direction, size, ring size and tilt); the colours
are in `planetLight` in the same file.

The sun's path is in `src/sun-path.js`, one smooth arc shared by the sky, the lights and the tests. **It is a twilight planet** (Kane, 5 Oct): the sun comes up over the horizon, slides round it
and sets, never climbing past `SUN_PEAK_DEGREES` (14), so the whole day is a long low golden hour with long dark shadows; the moon is opposite it, so as low by night. The swing round the sky is half a turn per half cycle, eased so it is slowest at the horizons and quickest at the
top (an old bug had the sun jump 63 degrees across the sky at noon and midnight). The game starts at `INITIAL_PHASE` 0.14 (a little after sunrise), the sun on the side it always started on. The look follows the sun's height: `sunHigh()` and `sunColour()` in `src/materials.js` blend the sky (teal-indigo
up high, dusty rose at the horizon, a wide warm glow round the sun), the clouds (slate on the far side, coral toward the sun) and the sun's colour on the sand and water from red (sun on the horizon) to gold (top of its arc); `DAY_EXPOSURE` is 0.62 (it was 0.82) in `src/day-night.js`. The day and night lengths are unchanged (3 minutes each). Tests: `tests/sun-path.test.js`, `tests/night-sky.test.js`.

## The glow plants

The oasis was barren and nothing echoed the hero tree's glow, so the pond now has two glow plants (my call on the look; Kane, 5 Oct: "don't go too crazy", he likes the darkness). Both are built in Blender (`tools/glow-plants/build_glow_plants.py`, checked by `check_mesh.py`: closed solids facing outward, triangle budgets, heights, UVs), live in
`public/models/vegetation/glow-plants/` in three levels of detail and are placed by `src/glow-garden.js` (`GLOW_GARDEN` is the whole dial).
- **Glow reeds** (`glow_reed_lod{0,1,2}.glb`): a clump of 13 slim stalks with leaf blades, each stalk ending in a cyan bulb, with the odd violet one. 22 clumps along the water's edge, spaced at least 5.5 m, scaled 0.85 to 1.3.
- **Lantern blooms** (`lantern_bloom_lod{0,1,2}.glb`): a waist-high plant with a leafy base and drooping cyan pods on tendrils (cyan only, no violet). 12 on the banks and 12 in a loose grove 11 to 28 m round the hero tree.
- Drawn as instanced meshes (one draw per material per level, however many plants), fetched when you come within 260 m of the pond, swapped at 28 m and 75 m, culled by distance (170 m reeds, 190 m lanterns), swaying with the same gusts as the grass (profiles `glow-reed` and `lantern-bloom` in `src/wind.js` terms).
  The bulbs and pods hold the same displayed brightness day and night through `exposureGlow` (0.5 day, 0.95 night); at night each bulb also gets a soft additive halo (the sprites the hero tree's pods and the fruit use), only within 70 m.
- **UVs on purpose** (Kane plans a PBR texture pass, 1k): every material has proper non-overlapping UVs and the meshes also carry a vertex colour for the look today. The materials are named `Glow plant stem`, `Glow plant leaf`, `Glow` and `Glow violet`, which is what the game finds them by.
- Tests: `tests/glow-garden.test.js` (layout rules, level choice, the six model files exist and are small).

## Plants that give way to you

Walk through the grass or brush a plant with a hand and it bends away (Kane's idea, 5 Oct; `src/wind.js` `PUSH`, `src/plant-push.js`, `tests/plant-push.test.js`). It is one more term in the shared sway shader: three points (your feet, on the floor under your head, and each tracked hand) in a
uniform array, and plants within the point's radius (0.62 m feet, 0.42 m hands) are shoved away horizontally, more the higher up the plant it is, with a smooth falloff and a little droop so the tip arcs down instead of stretching. **Grass is shoved vertex by vertex** (a patch is many blades, so it parts blade by blade round your foot); **everything else leans as one piece** from its root, measured from its own axis at that height with a `pushPad` for its width, because pushing each vertex away from a hand tore bulbs and stems apart (the first version did, Kane saw it in the headset).
Which plants: grass, ferns, the glow reeds and lantern blooms fully, the desert plants a third as much (`push` in the profile, `SWAY` in `wind.js`); trunks and palm crowns not at all. No draw calls, no per-plant JavaScript, no memory: a plant springs back the moment you move off it (a trampled trail would need a texture or CPU state).
`?push=0` switches it off in any build (to compare on the headset), `?push=1` forces it on; the radii, reach and the master switch are in `PUSH`. Cost is vertex work only (a distance test per plant vertex, three at most); the grass is nearly all of it.

## The backpack

A rucksack you pick up and put on, which raises how much you can carry before it slows you down. It lies in the sand a couple of
metres from where you start, beside the axe and the torch. It is a stylised alien-expedition pack: teal canvas gone dusty at the
base, a darker flap with a coral band and a pale cyan glowing trim, a cream bedroll held on by two leather straps with brass
buckles, two side pockets and a leather carry handle on top. The trim and the little diamond mark on the flap are emissive, so you
can find the pack at night.

### In the game

`src/backpack.js` is the pack as a thing in the world. The numbers to tune (where it lies, the reach, the back zone, the pulses)
are in one table, `PACK`, at the top; the carry limits are in `src/inventory.js`.

- **Pick it up:** squeeze grip with an empty hand near the shaft (within about half a metre). The spear jumps so the hand closes round
  the leather wrap in the middle of the shaft, near its balance point, and it lies pointing forward out of your fist (turned 35 degrees
  about the palm, `SPEAR_THRUST_TILT`), so the stone point is about 0.95 m ahead of your fist: a steady one-handed poke. With the
  controller pitched about 30 degrees down the shaft is level; pointed straight ahead it rises about 35 degrees. Right and left hands are
  the same. (It was held at the butt end for one build, #59, and that felt odd with one hand.)
- **Throwing grip:** with the spear in your hand, hold the button that lights a torch (B on the right controller, X on the left) and it
  flips in your fist (`SPEAR_FLIP`, 160 degrees about the palm on top of the poke's 35, so the point swings from in front of the fist to
  almost dead behind it; the shaft stays on nearly the same line across your fingers; a buzz marks the switch, and the flip takes about a
  fifth of a second). Let go of the button and it flips back to the poke. Let go of grip to throw it (see Dropping and throwing).
  (The angle and the turn speed are `SPEAR_FLIP` and `SPEAR_SWITCH` in `src/spear.js`; the hold lab shows it with
  `item=spear&pitch=-30&tilt=160`, the 160 added to the 35 of the poke.)
- **Carry it:** let go next to a hip and it holsters there, leaning back about 33 degrees with the point behind your shoulder and the butt
  end about 30 cm off the ground (it only reaches the sand when your head drops below roughly 1.4 m, in a deep crouch). Draw it from the
  hip by grabbing there. Let go at your chest to pack it into the inventory (weight 10); the menu can put it on a hip too.
- **Cost:** 3 draw calls and 2,192 triangles per spear (it shares its geometry and materials with any other copy, and casts no
  shadow), and the bead's glow is set once for all copies; nothing is created per frame.
- Development-only fixture: `?view=spear` (stand beside it, looking at it).

### The model

- `public/models/spear/spear.glb`: 2,192 triangles, 80 KB, no textures (one colour per vertex, two single-sided materials: `Spear` and
  `Glow`), one level of detail on purpose (a hand-sized prop that is held or stands a metre from you, so a lighter copy would never be
  used). Two named objects, `Shaft` and `Spear` (the point, lashing and tassel): the game fits the fingers to the shaft only. The origin is
  the middle of the grip, +y runs up to the stone point (0.955 m above the origin) and the butt end is 0.52 m below it; the tassel hangs
  on the -z side.
- Built headless in Blender from one parametric script: `python3 tools/spear/build_spear.py --out public/models/spear/spear.glb`, then
  `python3 tools/spear/check_mesh.py` (every part a closed solid, no inside-out shells, names, materials, length, triangle budget) and
  `python3 tools/spear/render_preview.py` for Cycles previews (`--views full,back,threeq,head,headside,headback,tassel,grip,butt`,
  `--night` for the glow).

## The blue palms

The sixteen regular trees round the pool are banded blue palms: a slim trunk with pale rings, stilt-like roots and a pale crownshaft,
a fountain of 24 arching fronds in three rings (long drooping ones outside, short upright ones inside, a new pale spear leaf in the
middle) and a few pale veils hanging from the crownshaft, a small echo of the glowing veil tree. They stand 4.6 m tall at scale 1 (the nine
big ones are 2x). They replace the first blue trees (tiered whorls of dark leaves, 40,000 triangles each) and everything that worked with
those still does: the axe fells them (the trunk is straight and on the origin up to the 1.9 m chop height, about 12 cm in radius),
they lean and tremble in the same wind (`src/wind.js` finds the leaf material by its name, `Waxy blue leaf tissue`, and the bark by
`Banded teal bark`), and they cast the same soft projected ground shadow. The fronds hang no lower than 2.6 m, so you can walk under
them. The shaded side of the fronds, which is most of what you see looking up into the crown, would go black under the game's lighting,
so both materials carry a small flat light of their own (an `emissiveFactor` in the model, nothing in code); at night the tiny exposure
hides it.

### Levels of detail

Three, switched by distance from your eye (`src/tree-sets.js`; a tree at scale 2 is twice as big at any distance, so its levels start
twice as far out):

| Level | From | Triangles | What it is |
| --- | --- | --- | --- |
| `alien_tree_lod0.glb` | 0 m | 5,920 | every frond a feather: a thin rachis with 17 pairs of tapering, drooping leaflets; four rings of fronds (the outer one older, hanging low); banded, leaning trunk that swells into six low buttress ridges sunk well into the ground, 6 veils |
| `alien_tree_lod1.glb` | 20 m | 1,884 | every frond one saw-toothed ribbon (the teeth are the leaflets); plain trunk, no ridges or veils |
| `alien_tree_lod2.glb` | 55 m | 560 | half of the fronds, 3 teeth each, a slightly darker tone (a solid ribbon catches more light than thin leaflets) |

**Textures.** The models carry UVs and vertex colours but no image. The game puts shared bark and leaf detail from
`src/surface-textures.js` on any material named `Banded teal bark` or `Waxy blue leaf tissue`; the textures also drive the model's small
emissive floor, so the shaded side keeps its detail. Two versions of the bark:
- A drawn one (128 x 128 greys, made in code), on screen from the first frame and the fallback.
- A real photographed palm bark (**Palm Bark** by Charlotte Baglioni, Poly Haven, CC0; see `public/textures/bark/CREDITS.md`): a neutral grey
  detail map plus a normal map, 1024 x 1024 each, about 0.8 MB, loaded in the background and swapped in when it arrives. The colour comes
  from the vertices, so the same bark can be teal, brown or grey. `python3 tools/textures/make_bark.py <dir>` makes the two files from the
  Poly Haven download.

The fronds wear the alien desert plant's own leaf texture (`public/textures/alien_desert_plant/alien_desert_plant_leaf_albedo.png`, the same file
those plants load, so no extra download), loaded in the background over a drawn grey leaf detail. It replaces the model's vertex colours,
because the blue read too blue. `?leaf=dark|plant|bright|plain` switches the look in production (`plant` is the default; `plain` is the old
blue; the table is `LEAF_LOOKS` in `src/surface-textures.js`).

To use the same bark on a new model, give it UVs with u once round and v = height in metres * 1.25 (`BARK.tilesPerMetre`; a test keeps the
palm builder's constant in step), and name the material `Banded teal bark` (or add a name to `SURFACE_BY_MATERIAL`). The nine outer palms now
each have their own size and turn.

All three grow their fronds from the same seeds, so a frond has the same length, angle and droop at every level and the tree does not change
shape when one takes over from another. Each level is one object with two materials, so a tree costs 2 draw calls at any distance, and the
whole file set is 348 KB (the first trees were 2.2 MB).

**Browser cache.** GitHub Pages lets a browser keep a file for 10 minutes. Every model and texture request therefore carries `?v=<build id>`
(`src/asset-version.js`, the id is set in `vite.config.js` from the commit), so a new deploy is fetched fresh as soon as the new page loads.
To get past a cached page, open the URL with any extra query, such as `?x=1`. Sounds are not versioned. At the pond that took the view from 688,000 to 563,000 triangles.

- `?trees=old` puts the first blue trees back to compare (their files are still in `public/models/vegetation/alien-tree/`). Dev build only:
  `?treelod=0|1|2` draws every tree at one level, to judge it on its own.
- Built headless in Blender from one parametric script: `python3 tools/alien-tree/build_alien_tree.py --outdir
  public/models/vegetation/alien-tree`, then `python3 tools/alien-tree/check_mesh.py` (bark is closed solids facing outward, leaves are sheets
  with no loose or degenerate faces, names, materials, budgets, height, a straight trunk in the axe's chop zone, clearance under the fronds) and
  `python3 tools/alien-tree/render_preview.py` for Cycles previews (`--views lods,lodsabove,threeq,side,below,crown,base`).
