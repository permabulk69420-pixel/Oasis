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
- **Keep it relaxed.** Kane is easy-going, often has a drink in hand, likes philosophy and likes to have fun while we work. Talk to him like a
  mate: laid back, plain words, a joke when one fits. Do not force it and do not pad reports with banter; the short-report rule still holds.
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
5. **Kane likes to check important 3D models, but on the night of 3 Oct 2026 he handed over the keys.**
   His words: "you add and merge everything you think is good, we can always roll things back easy or
   remove things, you're in charge on the game tonight". So for that overnight session models were merged
   on my own judgement. In any other session, default to sending him the `.glb` (SendUserFile) and waiting
   for his OK on new hand-built models (campfire, hero tree, creatures), because Claude tends to miss stray
   vertices, inside-out faces and bad blends. Always run a mesh check (`tools/campfire/check_mesh.py` style)
   and look at renders first. Code, shader and gameplay changes do not need his check.
6. **Quest performance comes first.** No post-processing passes, no big shadow maps, no per-frame
   allocations, keep triangle counts and draw calls modest. Kane knows desktop checks cannot prove how
   something looks, feels or runs on the headset, so never add "not tested on a headset" to a report or a
   PR. Only flag a specific thing worth looking at there (shimmer, tracking, frame rate) and say what to look for.
7. **Art and atmosphere over mechanics.** Kane wants to be involved in important gameplay and UI decisions
   (fuel, cold, how things work). Do not invent game mechanics or UI beyond what he asked for. Visual art
   direction is where he trusts me most. Anything substantial (trees, creatures, big props) needs proper LODs
   (3 levels, with triangle counts checked against a Quest budget). Leave the hero tree alone.

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
The little cyan bead on the tassel keeps its brightness at night through `src/glow.js` (shared with the backpack). Held (Kane's call, #59): the point goes out in front of the fist like a thrusting spear and the hand sits
at the butt end, so the stone reaches 1.3 m ahead (`SPEAR_THRUST_TILT` 35 degrees about the palm normal and `SPEAR_GRIP.point` y -0.39 in
`src/spear.js`; the leather wrap was moved to the butt end in `tools/spear/build_spear.py`; the hold lab `item=spear&pitch=-30` shows it).
Oddities to tell Kane: the butt end reaches the sand in a deep crouch (the hip hangs from the head position); picking it up snaps it to
the hand at the butt wrap wherever you reached; it does no damage yet (the creature will give it a job).

Blue palms (done, `tools/alien-tree/`, `src/tree-sets.js`; my call on the look, Kane said to make my own visual choices): the sixteen
regular trees round the pool are now banded blue palms with feathery fronds and a few pale hanging veils, in 3 LODs (5,920, 1,884 and 560 triangles after the texture pass, up from 4,774, 1,584 and 476,
against the first blue trees' 40,000, 24,000 and 12,500). The axe, the wind sway (found by material name) and the projected
shadow work as before. The first trees' files are still in the repo and `?trees=old` shows them. LOD distances scale with each tree's
scale. The materials carry a small flat emissive floor in the model so the shaded side of the crown is teal, not black. Bark and leaf detail is shared: `src/surface-textures.js` draws it in code and puts it on any material named `Banded teal bark` / `Waxy blue leaf tissue` (UV rules are in its header), so new trees and logs can reuse the same bark. The bark is a real CC0 photo (Poly Haven Palm Bark, 1k grey detail + normal, `public/textures/bark/`, made by `tools/textures/make_bark.py`) that loads in the background over a drawn fallback; Kane OK'd real 1k PBR textures where they matter (bark, ground), not on thin leaves. The palm fronds wear the alien desert plant's leaf texture (Kane's call: the blue crowns read too blue; the same file those plants load, no extra download); `?leaf=dark|plant|bright|plain` switches the look in production (`plain` is the old blue; code in `src/surface-textures.js`, `LEAF_LOOKS`). The trunk base is six buttress ridges in the trunk mesh, not separate root pieces (those looked like spikes). Oddities to tell
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

Merged: #39 glow fruit grip fix (mirrored per-hand offset), #40, #41 and #44 notes in this file, #42 backpack haptic tick (stronger, so you can
feel the back zone), #43 Milky Way edge (the band now fades to exactly zero where it is cut), #45 softer wind-blown sand (patchy veils, fewer
hair-thin streaks). Merged after Kane looked: #46 palm pass (shared bark and leaf textures in `src/surface-textures.js`, real
CC0 palm bark with a normal map, buttress base instead of root spikes, a fourth ring of older fronds, more arch, outer palms vary in size
and turn). Then #47 and #48 (this file: how we work, palms merged), #49 (every model and texture request carries `?v=<build id>`, so a deploy
is not hidden by the 10 minute Pages cache), #50 (the stop-hook false alarm and its fix), #51 (palm fronds wear the alien desert plant's leaf
texture because the blue read too blue; default look `plant`, mid-dark; Kane asked about "the much darker one", so `?leaf=dark` is the likely
next default, but he has not said which: ask which look he settled on after the headset). #53: the four alien desert plants were near black (vertex colour times texture), now lit properly (night unchanged). #54: three skills split out of this file. #55 to #58: notes on text-to-speech, relaxed tone, no motion sickness. #59: spear held pointing forward with the hand at the butt. Waiting on Kane before touching: the backpack back zone (options if it still feels hard: a repeating buzz, a sound, a bigger zone,
a visual cue). Only if Kane says go: a script and post for his explainer on tokens, API price and plan usage.

