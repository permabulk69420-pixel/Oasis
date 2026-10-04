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
- Around the oasis: blue alien palms (see The blue palms), green ferns, alien desert plants, loose sticks and stones. The glowing 81 m veil tree stands a short walk from the pool (`?hero=crimson` swaps the old 60 m tree back in for comparison); small glow fruit lie around its base.
- A short day/night cycle (3 min day, 3 min night while testing; `DAY_SECONDS` / `NIGHT_SECONDS` in `src/day-night.js`) with 2,400 twinkling stars, a moon with a face and a phase, a Milky Way band and now and then a shooting star (`src/night-sky.js`), desert ambience, sand footsteps, and a lightable torch. Night is dark and moonlit; the veil tree's pods glow and light the ground beneath them. Wind blows sand along the dunes: fine grains skimming the ground, soft veils spilling over the crests and big slow clouds of dust, all moved on the GPU (`src/wind-sand.js`). The air is calm at the oasis. The grass, ferns, reeds, desert plants and alien trees sway in the same wind, bending downwind with the gusts that throw the sand, with ripples running across the grass field; it is all in the vertex shader from one time uniform, with nothing for the CPU to do per frame (`src/wind.js`; the hero tree stays still). Lit objects (props, trees, hands, tools) get a faint moonlit fill and a thin cool rim at night so they read as shapes instead of black holes (`src/night-fill.js`).
- Alien birds fly over by day, and now and then one lands on the bank to drink (see Alien birds in the game).
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
- **You:** a left and right hip slot, a Back slot for the backpack, plus health, stamina, food, water and carry
  weight against your carry limit (all live).
- **Details:** whatever is selected, with its actions: craft, put on the left or right hip,
  send a hip tool back to your inventory, or take the backpack off.

| Starter recipe | Materials | Result |
| --- | --- | --- |
| Stone axe | 3 sticks + 2 stones | 1 axe in your inventory |
| Torch | 2 sticks + 1 stone | 1 torch in your inventory |
| Stone-tipped spear | 3 sticks + 1 stone | 1 spear in your inventory (see The spear) |
| Campfire | 6 sticks + 5 stones | 1 campfire in your inventory (placeable) |

**Tools in the world** (`src/tools.js`): every axe, torch and spear is a real object. Grab one with
either hand. Let go next to a hip to holster it there, at your chest to pack it away in your
inventory, anywhere else to drop it. Grab it back off the hip whenever you like. Light a held
torch with **B** (right hand) or **X** (left hand).

**Chopping:** swing the axe into a blue alien tree. Six solid hits fell it; it drops two logs
(Wood) and three sticks along where it fell, sinks away, and regrows after three minutes.
Pick up sticks, stones and logs with grip and let go at your chest to pack them.
Everything you carry is one shared pool with a weight per item (stick 4, stone 8, wood 6, axe 10, torch 5, spear 10, campfire 25).
Your pockets carry 40; past the limit you walk at half speed, easing off to a standstill at twice the limit. Wearing the
backpack lifts the limit to 100 (see The backpack). Inventory is session-only; reloading starts with an empty inventory.

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
`?campd=<metres>` for the distance), `?bird=perch|fly|flare` (see Alien birds in the game), `?view=pack` (beside the backpack), `?pack=worn` (start wearing it, see The backpack) and `?view=spear` (beside the spear), plus `?hour=N` to fix the time of day.

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

## The backpack

A rucksack you pick up and put on, which raises how much you can carry before it slows you down. It lies in the sand a couple of
metres from where you start, beside the axe and the torch. It is a stylised alien-expedition pack: teal canvas gone dusty at the
base, a darker flap with a coral band and a pale cyan glowing trim, a cream bedroll held on by two leather straps with brass
buckles, two side pockets and a leather carry handle on top. The trim and the little diamond mark on the flap are emissive, so you
can find the pack at night.

### In the game

`src/backpack.js` is the pack as a thing in the world. The numbers to tune (where it lies, the reach, the back zone, the pulses)
are in one table, `PACK`, at the top; the carry limits are in `src/inventory.js`.

- **Pick it up:** squeeze grip with an empty hand at the handle (within half a metre). The hand closes round the strap and the
  pack hangs from it, upright, front facing out. Sliding into reach with grip already held is not a grab: it has to be a fresh squeeze.
- **Put it on:** carry it behind your shoulder (the hand ticks once when it reaches the spot, which is behind and a little below
  your head, well clear of your chest) and let go. It leaves your hand: you are wearing it. Nothing is drawn on your back, because
  in VR there is no body to hang it on; the menu is where you see it.
- **If it will not go on:** the spot is a zone about 56 cm across, centred 22 cm behind your head and 34 cm below your eyes,
  so a hand about shoulder height, level with or just behind your ears (over the shoulder, like drawing an arrow from a quiver),
  or round at your upper back, is in it. The buzz tells you when you are in; if you feel none, you are not there yet, and letting
  go just drops the pack on the ground behind you. Two things move the zone: it is measured from your body's facing, which is the
  way you were going when you last started walking (it does not follow your head, or you turning on the spot), and Quest
  controllers can lose tracking when they are hidden behind you, so reaching just behind the ear works better than all the way
  round.
- **Take it off:** reach behind you with an empty hand and squeeze grip, and it comes off into that hand. Or open the menu, pick
  the **Back** slot and press **Take off**, and it is set down three quarters of a metre in front of you, facing you. It only comes
  off when everything you carry fits in your pockets (40), so taking it off never leaves you stuck; if it does not fit, the hand gives a
  short buzz and the menu button is greyed.
- Let go anywhere else and it drops upright where it is, front towards you. A controller that disconnects while holding it drops it.
- **Carry limit:** 40 in your pockets, 100 with the pack on. The menu shows the weight against the limit, and a Back slot that says whether
  the pack is on.
- **Cost:** 3 draw calls and 3,364 triangles while it is lying in the world or in a hand, none once it is on you; nothing is created
  per frame (the grip, the back zone and the glow are all plain arithmetic on a few reused vectors). Like everything you pick up,
  it needs the VR hands: on desktop it just lies there.
- A hold lab for judging how a hand takes a held thing, never shipped: with `npm run dev` open
  `/tools/hold-lab/hold-lab.html?item=pack&side=right&pitch=-90` (`item=pack|spear|torch|axe`, `side=left`, `roll=`, `close=1` for
  close-ups, `player=1` for what the player sees, `debug=1` for the contact outline, `map=%2By,%2Bz` to try another way round the pack).
- Development-only fixtures: `?view=pack` (stand beside the pack, looking at it) and `?pack=worn` (start with it on).

### The model

- `public/models/backpack/backpack.glb`: 3,364 triangles, 116 KB, no textures (one colour per vertex, two single-sided
  materials: `Pack` and `Glow`), one level of detail on purpose (it is held at arm's length or lying in the sand, a
  single hand-sized object, so a lighter copy would never be used). Two named objects, `Backpack` and `CarryHandle`: the game
  puts the grip on the handle only, so a hand closes round the strap and not the canvas. The origin is the middle of the
  bottom, +y up, the bedroll and flap in front (+z), about 0.47 m wide, 0.55 m tall and 0.34 m deep.
- Built headless in Blender from one parametric script: `python3 tools/backpack/build_backpack.py --out
  public/models/backpack/backpack.glb`, then `python3 tools/backpack/check_mesh.py` (every part a closed solid, no inside-out
  shells, names, materials, triangle budget) and `python3 tools/backpack/render_preview.py` for Cycles previews
  (`--views threeq,front,back,side,top,flap,low`, `--night` for the glow).

## The spear

A hand tool like the axe and the torch, and nothing more than that: it does not hurt or hunt anything. It stands planted in the
sand a couple of metres from where you start, beside the other tools, and can be crafted (3 sticks and a stone). It is a
1.47 m straight shaft of weathered brown wood with a leather-wrapped grip, a knapped blue-grey stone point lashed on with cream and
coral sinew, and a small tassel of teal, coral and navy feathers hanging from the lashing on a cord, with one tiny glowing cyan
bead so you can find it at night (the same glow trick as the backpack, shared in `src/glow.js`).

### In the game

`src/spear.js` is a tool kind for `src/tools.js`, like `src/axe.js` and `src/torch.js`. The numbers to tune (where it stands, how
far you can reach it, how bright the bead is, how it hangs) are at the top of the file.

- **Pick it up:** squeeze grip with an empty hand near the shaft (within about half a metre). The hand closes round the leather wrap,
  with the point up and the tassel behind it, so you see the point and the feathers over the top of your fist.
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
  the middle of the grip, +y runs up to the stone point (0.955 m above the origin) and the butt end is 0.52 m below it; the tassel hangs on
  the -z side.
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
| `alien_tree_lod0.glb` | 0 m | 4,774 | every frond a feather: a thin rachis with 17 pairs of tapering, drooping leaflets; banded trunk, 5 roots, 6 veils |
| `alien_tree_lod1.glb` | 20 m | 1,584 | every frond one saw-toothed ribbon (the teeth are the leaflets); plain trunk, no roots or veils |
| `alien_tree_lod2.glb` | 55 m | 476 | half of the fronds, 3 teeth each, a slightly darker tone (a solid ribbon catches more light than thin leaflets) |

All three grow their fronds from the same seeds, so a frond has the same length, angle and droop at every level and the tree does not change
shape when one takes over from another. Each level is one object with two materials, so a tree costs 2 draw calls at any distance, and the
whole file set is 348 KB (the first trees were 2.2 MB). At the pond that took the view from 688,000 to 563,000 triangles.

- `?trees=old` puts the first blue trees back to compare (their files are still in `public/models/vegetation/alien-tree/`). Dev build only:
  `?treelod=0|1|2` draws every tree at one level, to judge it on its own.
- Built headless in Blender from one parametric script: `python3 tools/alien-tree/build_alien_tree.py --outdir
  public/models/vegetation/alien-tree`, then `python3 tools/alien-tree/check_mesh.py` (bark is closed solids facing outward, leaves are sheets
  with no loose or degenerate faces, names, materials, budgets, height, a straight trunk in the axe's chop zone, clearance under the fronds) and
  `python3 tools/alien-tree/render_preview.py` for Cycles previews (`--views lods,lodsabove,threeq,side,below,crown,base`).
