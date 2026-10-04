# Oasis: instructions for Claude

Oasis is a three.js WebXR desert survival game for Meta Quest 3. The owner (Kane, a solo VR dev in Sydney)
tests by opening the deployed GitHub Pages URL on the headset. Pushing to `main` deploys. Read `README.md`
for how the game works. These are standing rules from Kane; they apply to every session and survive compaction.

## How we work (Kane and me)

Kane is a solo dev. He is casual, often away from the headset (travelling, testing in bursts) and happy to hand me a stretch of
work. What he has told me, or shown he wants, across sessions:

- **Make the call on art and atmosphere.** His words: "you make the call what you think is best, we can always change it, I'd rather that
  call than me making a bad call." Pick, build, show it, and say what to look at. Do not hand him a menu for a visual choice. Ask first on
  gameplay and UI (fuel, cold, how things work, new mechanics) and on anything that costs money or touches an account.
- **Say what I think.** When he asks "what do you think", give a recommendation with reasons, and say so plainly if I disagree. He
  would rather have an opinion than a list of options.
- **Short reports.** What changed, one or two specific things to check in the headset (shimmer, scale, feel), and whether a PR is
  merged or waiting. No recap of the steps and no "untested on a headset" (he knows).
- **Black rectangles in his headset screenshots are a Quest capture bug**, not something in the game (his words). Ignore them; do not go
  looking for a missing object or a rendering fault because of one.
- **He reads the screenshots in the tool log**, so render and actually look at them, and send the key before/after images with
  anything visual. I can judge stills, not real-time motion or headset feel.
- **New hand-built models wait for his OK** (send the `.glb` and renders, leave the PR open). Code, shader, texture-plumbing and docs
  changes get merged once verified (rule 4). Wait for his headset feedback before changing a feature he has not tested yet (the
  backpack's back zone is waiting on that).
- **Performance in the headset is fine right now** (he says the grass and the hero tree with no level of detail are not a problem), so do
  not optimise them ahead of a real problem. Real 1k CC0 PBR textures are fine where they matter up close (bark, ground), at 1k not 2k, and
  not on thin leaves. Poly Haven (`api.polyhaven.com`) and ambientCG are reachable and free.
- **He often talks to me by text-to-speech, with an Australian accent**, so messages come through long, without punctuation, and sometimes with
  words the transcriber got wrong. Read for the meaning. If a word or a whole request could be a mishearing and the guess would matter (which
  tree, which file, which look), ask him one short question rather than building on it. He asked for exactly that.
  **Watch "can", "can't" and "don't" in particular:** with his accent the transcriber swaps them, and he does not notice, so a sentence can
  mean the opposite of what he said ("don't change it" arriving as "can change it"). If one of those words decides whether I act or not,
  and the rest of the message does not settle it, check with him before touching anything.
- **He does not get motion sickness and is building the game mainly around himself.** Comfort and safety options (vignettes, snap turning,
  seated modes) are a very low priority for now; he will add some later. Do not hold a design back, or add comfort features, on
  motion-sickness grounds unless he asks.
- **The game is "Ark-like with VR controls", not Green Hell or Boneworks.** His words: he wants a real game and physical interaction only
  "where it really makes sense". Keep physics light and purposeful (things falling, being thrown); do not add gimmicky full-body or
  everything-is-physical systems. He is fine with a light custom system, not a full physics engine.
- **Astra (OpenAI's model) was a bust for the creature.** Kane sent it my dune stinger brief (and a sandworm), it took two or three attempts, used about
  70% of his five hour allowance, and he was not happy with the result. Do not suggest handing models to another model again unless he asks. If he
  wants the creature, I build it myself in Blender (free; mesh-check and render it, send the `.glb` for his OK first).
- **Keep it relaxed.** Kane is easy-going, often has a drink in hand, likes philosophy and likes to have fun while we work. Talk to him like a
  mate: laid back, plain words, a joke when one fits. Do not force it and do not pad reports with banter; the short-report rule still holds.
- **Put new things straight into the real game; no dev-only fixtures unless I need one to screenshot.** His words about the stinger: "don't start doing weird stuff with dev only
  features, just get the scorpion into the game, we can roll back super easy... you don't always have to really check these things, I need to see them in VR." He is fine with
  me merging a model once he has said go (he did for the stinger). Existing fixtures stay; do not add new ones for a feature he can simply walk up to in the headset.
- **Do not make him repeat himself.** When he tells me a fact, rule or preference, it goes in this file before the session ends. If I hit
  the same pain twice, add a note here and tell him (he asked for that).
- Everything above sits on top of the standing rules below (no sub-agents, nothing that costs money, no keys, merge what is verified).

## Standing rules (do not lose these)

1. **No sub-agents.** Never use the Agent tool or spawn helpers in this project. They burn Kane's
   subscription usage fast (he has hit the 5 hour cap), inherit permissions, and a lower-effort helper
   once botched a complex Blender build. If a helper or a different model or effort level would ever
   help, ask Kane first.
2. **Nothing that costs money, and nothing odd, without asking.** No paid APIs or services (no Antigravity,
   Nano Banana, ElevenLabs and so on), no logging into or creating accounts, no surprises. Free is fine:
   free APIs and free packages (pip, npm) can be used without asking. If a call needs a key, an account or a
   card, or might cost anything, that is the line: ask first. The sandbox can reach most sites, so try a
   thing before assuming it is blocked.
3. **Never paste, print or commit API keys, tokens or login codes.** Use throwaway keys only.
4. **Commit only when it makes sense, and if you commit, merge.** Kane's wording: "always just merge if
   you commit" and "use your judgement". So: commit finished, verified work on a branch, open a PR, squash
   merge it, and confirm the Pages deploy goes green. Verified means `npm test` passes, `npx vite build`
   works, and for visual changes you looked at screenshots. If something is not good enough, leave the PR
   open and say why instead of merging. A stop-hook message asking for a commit is not Kane asking.
5. **Kane likes to check important 3D models, but on the nights of 3 and 4 Oct 2026 he handed over the keys.**
   His words: "you add and merge everything you think is good, we can always roll things back easy or
   remove things, you're in charge on the game tonight". So for that overnight session models were merged
   on my own judgement. In any other session, default to sending him the `.glb` (SendUserFile) and waiting
   for his OK on new hand-built models (campfire, hero tree, creatures), because Claude tends to miss stray
   vertices, inside-out faces and bad blends. Always run a mesh check (`tools/campfire/check_mesh.py` style)
   and look at renders first. Code, shader and gameplay changes do not need his check.
   **The night of 4 to 5 Oct, going to sleep, he said it again:** "when I leave you overnight you just merge and do whatever you feel is right,
   that's one hundred percent on you, I do not care at all... just don't fire off subagents or do anything crazy, I trust you enough, the other night
   went really well." So that night: do not stop to ask anything, merge everything (models included) on my own judgement, still mesh-check and look
   at renders first. **No gameplay, though:** "you can go as crazy as you want with the animations and stuff... let's not think about gameplay
   mechanics, that's something I really need to test and do myself." Animations, art, sound, effects, atmosphere: yes. New mechanics (a pincer
   snap attack, drops, player death, anything that changes how play works): no, and no new numbers for them. He gives this overnight authority
   when he says so, as he did on both nights; do not assume it in an ordinary daytime session.
6. **Quest performance comes first.** No post-processing passes, no big shadow maps, no per-frame
   allocations, keep triangle counts and draw calls modest. Kane knows desktop checks cannot prove how
   something looks, feels or runs on the headset, so never add "not tested on a headset" to a report or a
   PR. Only flag a specific thing worth looking at there (shimmer, tracking, frame rate) and say what to look for.
7. **Art and atmosphere over mechanics.** Kane wants to be involved in important gameplay and UI decisions
   (fuel, cold, how things work). Do not invent game mechanics or UI beyond what he asked for. Visual art
   direction is where he trusts me most. Anything substantial (trees, creatures, big props) needs proper LODs
   (3 levels, with triangle counts checked against a Quest budget). Leave the hero tree alone.

## Overnight plan (4 to 5 Oct 2026, Kane asleep, full authority, art, animation and world content only)

Kane's direction that night: the visuals are in good shape and he is unsure where the game goes next. I said we have no reason to go out into
the dunes and no stakes; he said "I think we need a pickaxe, and some really good stones or crystals, and maybe something like a cactus but
alien... a reason to go out there... get some PBR stuff". **No sound effects yet** (his words: audio is "something we can do way more
intentional later"), so none of the fight, water or insect sounds. In this order (tick them off in the task list; the morning report is short):
1. A smoke test (headless Chromium loads the real game, fails on page errors or a triangle blowout) run in the Pages workflow before deploy, so an
   unattended merge cannot ship a broken game.
2. The pickaxe (recipe like the axe's, held, hip slot, menu icon, breaks mineable nodes like the axe fells trees) and the desert finds that give it a
   job: sandstone outcrops with a 1k Poly Haven PBR rock (credit file in `public/textures/<name>/`), glowing crystal clusters (visible across the dunes
   at night, first field near the stinger's patch, richer ones further out), and a spiny alien spire plant that gives fibre (an item with no source yet).
   Crystals just go in the pack: what they are FOR (my suggestion to him: alien fuel and light, which would answer cold nights and fuel) is his call.
3. Dune stinger v3 (`tools/dune-stinger/v3/`, built by me in Blender, no paid or AI mesh tools): a plated carapace with a ridge, an eye cluster, four leg
   pairs (thigh, shin, claw foot, knobbly knee), two jointed pincers (one bigger) that guard, flare open in the windup and close, a five segment tail.
   3 LODs, close level roughly 30 to 40k triangles (ceiling 50k), 2 draw calls, cyan glow seams in the spear's cyan. Retarget `src/stinger-pose.js` and
   the `hitBalls`; the fight logic and numbers stay. Feet planted on the sand. Claws are animation only, no pincer attack.
4. Fight effects: sand puffs on the lunge and death, the dead stinger sinks into the sand instead of popping out of the world.
5. Saving: a silent, versioned autosave of inventory, tools, fires, felled trees, position and time (`?fresh=1` starts clean; mismatched saves discarded).
6. Footprints in the sand (player and creature), filled in by the wind, one instanced draw call.
7. Giant bones half buried in the dunes (Blender model with LODs) as landmarks; a crashed expedition wreck if time.
8. A direction doc in the Project (`Projects` tool): the decisions only Kane can make, each with my one-line take, and the story seed we talked through
   (survivor of an expedition that came down on a desert moon with a ringed planet in the sky; the giant bones are what brought the ship down; the
   boss is its grown up version).
9. If time: glow motes by the pond, the ringed planet in the night sky, dust devils by day, a skittering critter, a dawn and dusk look pass.
Add a `creature-pipeline` skill (`.claude/skills/`) when the stinger v3 build is done, since the Blender to pose code to game procedure is longer than a few lines.

## Working on this repo

- Tests: `npm test` (node --test, no browser). Build: `npx vite build`. Dev: `npm run dev`.
- Long procedures live in project skills (`.claude/skills/`): `ship-a-change`, `grip-debug`, `perf-triangles`. Load one when the job matches; add a new
  skill when a procedure needs more than a few lines here (Kane gave me full authority over this file and the skills).
- `gh pr create` fails here (GraphQL is blocked): use the REST API. Commands, merge routine and stop-hook notes are in the `ship-a-change` skill.
- Dev-only URL fixtures (stripped from production): `?view=...`, `?hour=N` (0 night, 14 day),
  `?camp=lit|unlit`, `?campd=<metres>`, `?bird=perch|fly|flare`, `?view=pack`, `?pack=worn`, `?view=spear`, `?treelod=0|1|2` (every tree at
  one level of detail). `?trees=old` also works in production (the first blue trees, for comparison). Add one when a new
  feature needs a repeatable screenshot.
- Held things (grip clipping, the hold lab, `lab_shot.py`, `probe_grip_point.py`): see the `grip-debug` skill.
- Screenshots: Playwright with Chromium (SwiftShader) against `npm run dev`. Look at them; do not assume.
- Triangle and draw-call counts per object: see the `perf-triangles` skill.
- Day/night uses ACES tone mapping with very low night exposure (~0.035 vs day 0.82). Emissive and light
  levels must compensate for exposure, and night visibility relies on additive fills after tone mapping.
- Place objects on `createHeightField().sample` (mesh-accurate), not the analytic `terrainHeight`.
- Blender is headless (`import bpy` before `import bmesh`). It is not preinstalled in a fresh session, but it is
  free and installs fine: `pip install bpy --break-system-packages` (a big download, so do it only when a model
  needs building). Kane has said this is fine, no need to ask. glTF winding matters in three.js.
- Stop-hook "N unpushed commits and no remote branch" is this clone's fault, not a real problem: run
  `git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*' && git fetch origin` once per session. Details in the `ship-a-change` skill. It is never Kane asking for anything.
- Palm close-up for a screenshot (dev build): `?hour=14&at=311.6,-357.7&look=313.5,-351,2.5&treelod=0`; `&eye=1.0` for a low camera at
  the base. Other palms are at `WATER + (cos a * radiusX * r, sin a * radiusZ * r)` for the `angle`/`radius` pairs in
  `TREE_LAYOUT`, `src/oasis-vegetation.js`. `?camp=lit` ignores `?at` (the fire goes near spawn).
- Free texture sources: `python3 tools/textures/make_bark.py` shows the pattern (download the 1k Poly Haven set, reduce it to a neutral
  grey detail map plus a normal map, record the credit in `public/textures/<name>/CREDITS.md`, add a test that the files exist and are small).
- **Kane says he can't see a change that is deployed?** GitHub Pages sends `cache-control: max-age=600`, so a headset browser can show the old
  models for up to 10 minutes. Check the live files first (`curl -sI` the `.glb` or texture on the Pages URL and compare `content-length` with
  `public/`). Since #49 every model and texture request carries `?v=<build id>` (`src/asset-version.js`), so a new deploy is fetched fresh once
  the new page loads; to get past a cached page, open the URL with any extra query (`?x=1`). Sounds are not versioned.
- **A model looks black once a texture goes on it?** Check its `COLOR_0` (vertex colours). Models painted with vertex colour only (the alien desert
  plants, the first trees) multiply the texture by about 0.1. Either turn `vertexColors` off (the palms) or keep only the variation:
  `normaliseVertexColours` in `src/plant-colours.js` divides each channel by its average (the desert plants, #53). Read the accessor
  in the .glb with a few lines of Python before guessing at lights or emissive.
- Tests live in `tests/`. Add tests for game logic. Keep constants in one table at the top of a module.

## Roadmap

Campfire (done). Kane is not sure about cold nights or fuel yet, so those are parked until he decides how
they should work. Visual direction now: dust and sand, fire smoke and heat haze, night sky, plant sway (done), an
ambient alien bird (done), a physical backpack (done), a spear (done), newer trees with LODs (done). Later: first threat (sandworm, titan
blocker or boss), building and more crafting. Kane tests on the headset himself: do not keep saying it is untested, say what to look for.

Backpack (done, `src/backpack.js`; my call, Kane approved): a physical pack you grab by its handle and put on by letting go
behind your shoulder (reaching behind your back is the VR habit); it then disappears into the normal menu (a Back slot) and
raises the carry limit from 40 (pockets) to 100. It only comes off when everything fits in your pockets. Oddities to tell
Kane: the 40 pocket limit is my number and slows you to half speed over it; nothing is drawn on your back; no sound.

Spear (done, `src/spear.js`; Kane asked for it in a queued message, my call on the design): a held tool like the axe and torch
that does nothing else (no combat). Stands in the sand beside the starting tools, crafted from 3 sticks and a stone, weight 10,
carried on a hip leaning back about 33 degrees, packed at the chest. One LOD on purpose (hand-sized, 2,192 tris, 3 draw calls).
The little cyan bead on the tassel keeps its brightness at night through `src/glow.js` (shared with the backpack). Held (Kane's call, #59, #60): the point goes out in front of the fist like a poke (`SPEAR_THRUST_TILT` 35 degrees about the
palm normal in `src/spear.js`; the hold lab `item=spear&pitch=-30` shows it). The hand sits at the middle of the shaft near the balance point
(`SPEAR_GRIP.point` [0,0,0], the leather wrap's centre). #59 tried the butt end for reach and Kane found one hand at the very end weird.
Throwing grip (#62 Kane's idea; #67 flipped it 180 degrees at his word "all you need to do is flip it with that button"; then he said 160, "we're close", so `SPEAR_FLIP` = 160):
hold the torch's button (B right, X left) with the spear in hand and it turns `SPEAR_FLIP` degrees about the palm normal on top of the poke, so the point goes from
in front of the fist to nearly behind it (hold lab `item=spear&pitch=-30&tilt=160` solves on both hands; 180 solved too). Release the button and it flips back
(a buzz marks it; 0.2 s, `SPEAR_SWITCH.turnSpeed` 900 deg/s, to tune by feel). #62 first tried 75 degrees and Kane said it barely moved: when he says flip, he means the
axis reverses; he now wants fine tuning later ("we can sort out those fine details later"). Letting go of grip throws it with the hand's speed (the drop and throw physics, #63); damage and
what it hits wait for the creature, which is Kane's call. A second hand on the shaft for a two-handed poke is also only an idea. Oddities to tell Kane: the butt end reaches the sand in a deep crouch (the hip hangs from the head position); picking it up
snaps it to the hand at the wrap wherever you reached; it does no damage yet (the creature will give it a job).

Blue palms (done, `tools/alien-tree/`, `src/tree-sets.js`; my call on the look, Kane said to make my own visual choices): the sixteen
regular trees round the pool are now banded blue palms with feathery fronds and a few pale hanging veils, in 3 LODs (5,920, 1,884 and 560 triangles after the texture pass, up from 4,774, 1,584 and 476,
against the first blue trees' 40,000, 24,000 and 12,500). The axe, the wind sway (found by material name) and the projected
shadow work as before. The first trees' files are still in the repo and `?trees=old` shows them. LOD distances scale with each tree's
scale. The materials carry a small flat emissive floor in the model so the shaded side of the crown is teal, not black. Bark and leaf detail is shared: `src/surface-textures.js` draws it in code and puts it on any material named `Banded teal bark` / `Waxy blue leaf tissue` (UV rules are in its header), so new trees and logs can reuse the same bark. The bark is a real CC0 photo (Poly Haven Palm Bark, 1k grey detail + normal, `public/textures/bark/`, made by `tools/textures/make_bark.py`) that loads in the background over a drawn fallback; Kane OK'd real 1k PBR textures where they matter (bark, ground), not on thin leaves. The palm fronds wear the alien desert plant's leaf texture (Kane's call: the blue crowns read too blue; the same file those plants load, no extra download); until that 2.9 MB tile arrives (slow data) the fronds are painted its average colour (`LEAF_PHOTO.average`) over the drawn leaf, so a palm is never blue while loading (#72; before that, bad data showed the blue crowns, which Kane noticed; the same on every level of detail). `?leaf=dark|plant|bright|plain` switches the look in production (`plain` is the old blue; code in `src/surface-textures.js`, `LEAF_LOOKS`). The trunk base is six buttress ridges in the trunk mesh, not separate root pieces (those looked like spikes). Oddities to tell
Kane: the look is mine (a palm, not the old tiered tree); thin leaflets may shimmer in the headset (if so, widen them in
`feather()` or lower `pairs`); a felled palm still drops its logs and sticks at the old distances along the fall
line, so the sticks land a little past where the crown ends.

## Overnight progress log (3 to 4 Oct 2026)

Merged so far (PR numbers, newest last): #25 campfire, #26 and #27 CLAUDE.md, #28 wind-blown sand and dust, #29 fire
smoke plus a moonlit fill/rim for lit objects at night, #30 the night sky (moon, Milky Way, shooting stars), #31 plant
sway (grass, ferns, reeds, desert plants and the alien trees lean with the same gusts as the sand; `src/wind.js`;
the hero tree is left still), #32 the alien bird's model (3 LODs, 19 bones), pose code and pose lab, #33 the alien bird in the game (by day one flies in,
circles the pond and lands to drink, or just crosses the sky; `src/alien-bird.js`, `src/bird-brain.js`,
`src/bird-flight.js`; none of it affects gameplay; dev fixture `?bird=perch|fly|flare`), #34 the backpack's model (one LOD, 3,364 tris, `tools/backpack/`),
#35 the backpack in the game (grab it by the handle, let go behind your shoulder to wear it, Back slot in the menu, carry limit 40 to 100; `src/backpack.js`;
dev fixtures `?view=pack`, `?pack=worn`), #36 the spear (model, kind, recipe, menu icon, `?view=spear`; the hold lab moved to `tools/hold-lab/` and
now shows the pack, spear, torch and axe), #37 the blue palms (new tree models in 3 LODs replacing the first blue trees; `?trees=old` to compare).
Heat haze was skipped on purpose (it needs a full-screen copy of the scene: too costly on Quest).

Performance check (3 Oct 2026, after #37; desktop SwiftShader counts at midday, so they say what is drawn, not how fast a Quest draws
it). At `?view=shore`: 563,000 triangles in 91 draw calls (it was 688,000 before the palms). The grass field is 308,000 of them in 2 draw
calls (55%: one InstancedMesh with frustum culling off, so every patch within 190 m is drawn, behind you too; it is 159,000 from the
spawn point and 134,000 from the elevated overview), the veil tree 117,000 in 6 calls (one level of detail only), the alien desert plants
33,000, the ferns 26,000, the reeds 15,000, the 16 palms 15,000 in 17 calls, the fruit 5,500 in 14 calls, water 4,300, the backpack 3,100,
everything else (terrain chunks, sky, stars, tools) a few thousand each. If a headset test shows the frame rate is short, the biggest saving
for the least change is the grass (cull patches behind the view when it rebuilds, or lower `MAX_DRAW_DISTANCE`/`RICH_BLADES`), then a
level of detail for the veil tree (Kane has said to leave that tree alone, so ask first).
## Day session log (4 Oct 2026, Kane and me)

Creature triangle budget (Kane, 4 Oct): he thinks the 6,000 / 2,000 / 600 limits in the first brief were too conservative, since fights happen in the
desert where little else is drawn (measured on desktop: 25k to 80k triangles in open dunes, 376k at spawn, mostly grass). He wants a close-up level of
up to about 50,000. My view: fine as a ceiling for one creature at a time (it adds about 13% to the spawn scene); spend it where it shows at 1 to 5 m
(head, plates, legs), do not pad. Keep three levels and keep the draw calls at two per creature.

Dune stinger v2 (mine, `tools/dune-stinger/v2/`, script `build_stinger.py`): reworked the first build into a spikier, rust-banded creature with ball-jointed arched legs,
glowing eyes and flank dashes and a lit stinger: 11,612 / 4,072 / 626 triangles, same skeleton. Passes the checks; sent to Kane for his OK, not in `public/`.
Kane's rule of thumb: build the high-detail version first, scaling down is easy and scaling up is not.
Dune stinger in the game (Kane, 4 Oct: "just get the scorpion into the game, we can roll back super easy", and he said not to add dev-only extras, he checks things in VR): v2 models are in `public/models/creatures/`,
`src/dune-stinger.js` + `src/stinger-brain.js` + `src/stinger-pose.js`. One stinger, home 46 m to the right of the start, scale 2.5 (3.7 m long, my call, easy to change in `DUNE_STINGER.scale`); it began passive and is a fight now (next paragraph).
Dune stinger fight (Kane, 4 Oct, after feeling the passive one: "that's pretty much exactly the right feel... this is basically our rat... you can take off and do that", and gameplay numbers were left to me, flag them):
patrols, notices you within 22 m only with line of sight over the dunes, stalks slowly (1.15 m/s, you walk 2.6) with the tail up, winds up within 4.8 m (about 1 s: crouch, tail straight and drawn back, eyes and sting flare),
locks its aim 0.62 s in, then the tail whips and lands 0.13 s into a 0.24 s strike with a lunge of up to 2.6 m, so moving out of the spot dodges it. Hit = 18 health and a buzz in both hands; then 1.3 s open before it can wind up again.
Your spear (34) and axe (28), held (speed relative to your body, so walking is not a swing) or thrown (bounces off), hurt it: `src/weapon-hits.js`, `hit` entries in `src/spear.js` / `src/axe.js`, speed 1.8/2.6 m/s to count, full damage at 6/6.5 m/s. It has 100 health,
flinches on a blow, backs off for 3 to 5 s when low, dies at zero (lingers 40 s) and respawns at home 150 s later. Player health floors at 10 (`healthFloor`; no death) via `damagePlayer` in `src/survival.js`.
All the numbers are in `BRAIN` (stinger-brain.js), `JOINTS` (stinger-pose.js), `HITS` (weapon-hits.js) and the `hit` entries. The tail was rebuilt 2.4 times longer (`TAIL_SCALE` in `build_stinger.py`) because the strike could not reach past the head otherwise; at scale 2.5 it arches about 2.8 m high.
Oddities to tell Kane: nothing drops, no sound, no screen effect when you are hit (haptics only), no death for you; the stinger can re-aim until the lock so strafing early does not dodge; legs are not IK, so
feet can skate a little on steep dune faces; the model's 11.6k-triangle close level is the v2 build (the 50k ceiling is not spent); at night only the eyes, flank dashes and sting glow and the rest is a thin moonlit rim like the trees. The creature still reads like a centipede to Kane, so a more complex model is the likely next job (my plan: build it myself in Blender, no paid or AI mesh tools without his OK).
Stinger verdict after Kane saw it in VR (4 Oct): "the centipede thing, we need to make it way more complex". It reads as a centipede because the v2 skeleton has 8 leg pairs (16 legs) and no pincers.
Plan I gave him: a real redesign (4 leg pairs with three-part legs, two pincers that open and close, a heavy plated carapace, curved segmented tail, a close-up level well above 11.6k toward the 50k ceiling, 3 levels),
built by me in Blender. He first agreed the AI should wait for the final model, then (after feeling the passive version) said "this is basically our rat" and told me to go ahead with the fight on this model, so the fight is in. A new model must keep or retarget
the same skeleton: `tools/creature/check_glb.py`, then retarget `src/stinger-pose.js` and the `hitBalls` bone names in `src/dune-stinger.js` to its bones. Do not start the redesign, or any paid or AI-mesh tool, without his say-so.
Dune stinger (first creature, `tools/dune-stinger/`): the other model's first build (3 LODs 4,482 / 1,560 / 582 tris, 49 bones) passes my checks
(`python3 tools/creature/check_glb.py`: numpy + trimesh, no Blender) and loads and bends in three.js, but it is artistically generic and barely
glows. It is kept in `tools/`, NOT in `public/`, and waits for Kane's OK; the plan I gave him is to use it as a base and improve it myself
(bigger head with a lit eye band, thicker legs that differ along the body, banded rust colour, a brighter stinger seam), then wire it to code-driven
animation like the bird. Gameplay (damage, death, behaviour) is still Kane's call.

Dropping and throwing (`src/falling.js`, `src/hand-motion.js`; Kane said "100% go for it"): a tool you let go of falls with your hand's
speed and turn (letting go while swinging throws it), bounces a little, topples and lies along the ground (axe rolls its head flat), and a spear
point-first at 3+ m/s sticks in the sand. A lying tool can be grabbed anywhere along its length. Tools have `fall: { radius, landing, com }` in
their kind; the starting tools still stand planted. Oddities to tell Kane: things do not hit each other or trees; the spear sticks at any angle
steeper than about 18 degrees; dev fixture `?view=throws`; headless tests cannot show the feel of a real throw (check the swing speed and
whether the spear sticks sensibly).

Merged: #39 glow fruit grip fix (mirrored per-hand offset), #40, #41 and #44 notes in this file, #42 backpack haptic tick (stronger, so you can
feel the back zone), #43 Milky Way edge (the band now fades to exactly zero where it is cut), #45 softer wind-blown sand (patchy veils, fewer
hair-thin streaks). Merged after Kane looked: #46 palm pass (shared bark and leaf textures in `src/surface-textures.js`, real
CC0 palm bark with a normal map, buttress base instead of root spikes, a fourth ring of older fronds, more arch, outer palms vary in size
and turn). Then #47 and #48 (this file: how we work, palms merged), #49 (every model and texture request carries `?v=<build id>`, so a deploy
is not hidden by the 10 minute Pages cache), #50 (the stop-hook false alarm and its fix), #51 (palm fronds wear the alien desert plant's leaf
texture because the blue read too blue; default look `plant`, mid-dark; Kane asked about "the much darker one", so `?leaf=dark` is the likely
next default, but he has not said which: ask which look he settled on after the headset). #53: the four alien desert plants were near black (vertex colour times texture), now lit properly (night unchanged). #54: three skills split out of this file. #55 to #58: notes on text-to-speech, relaxed tone, no motion sickness. #59 and #60: spear held pointing forward (the hand at the butt in #59, back at the middle in #60). #61: Quest screenshot black boxes are a capture bug. #62: hold the torch button for the spear's throwing grip. #67 and #68: spear throwing grip flips 160 degrees. #69: the dune stinger in the game (passive). #71: the stinger fight (stalk, telegraphed tail strike, spear and axe hurt it, dies and respawns). Waiting on Kane before touching: the backpack back zone (options if it still feels hard: a repeating buzz, a sound, a bigger zone,
a visual cue). Only if Kane says go: a script and post for his explainer on tokens, API price and plan usage.

