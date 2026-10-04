# Oasis: instructions for Claude

Oasis is a three.js WebXR desert survival game for Meta Quest 3. The owner (Kane, a solo VR dev in Sydney)
tests by opening the deployed GitHub Pages URL on the headset. Pushing to `main` deploys. Read `README.md`
for how the game works. These are standing rules from Kane; they apply to every session and survive compaction.

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
- `gh pr create` fails here (GraphQL is blocked). Use the REST API:
  `gh api repos/permabulk69420-pixel/oasis/pulls -X POST -f title=... -f head=BRANCH -f base=main -F body=@file`
  then `gh api repos/permabulk69420-pixel/oasis/pulls/N/merge -X PUT -f merge_method=squash`.
- Dev-only URL fixtures (stripped from production): `?view=...`, `?hour=N` (0 night, 14 day),
  `?camp=lit|unlit`, `?campd=<metres>`, `?bird=perch|fly|flare`, `?view=pack`, `?pack=worn`, `?view=spear`, `?treelod=0|1|2` (every tree at
  one level of detail). `?trees=old` also works in production (the first blue trees, for comparison). Add one when a new
  feature needs a repeatable screenshot.
- `tools/hold-lab/hold-lab.html` (with `npm run dev`; `?item=pack|spear|torch|axe&side=right&player=1`) shows how a hand takes a held
  thing. Probing the real hands in a headless page needs a temporary `window.__oasis` hook in `src/main.js` (fake controllers,
  fake `renderer.xr.isPresenting`); never commit it. After editing a `src/` file that scratch scripts import with a bare
  `import('/src/x.js')`, restart the dev server, because Vite then serves the app a `?t=` copy and the script gets a second module.
- Screenshots: Playwright with Chromium (SwiftShader) against `npm run dev`. Look at them; do not assume.
- Where the triangles go: with the same temporary `window.__oasis` hook (just `scene, camera, renderer, THREE`), walk `scene.traverseVisible`,
  keep the meshes whose bounding sphere meets the camera frustum, add each one's draw-range index count / 3 (times `count` for an
  InstancedMesh) and group by the first three names up the parents. It agrees with `renderer.info` to within 1%.
- Day/night uses ACES tone mapping with very low night exposure (~0.035 vs day 0.82). Emissive and light
  levels must compensate for exposure, and night visibility relies on additive fills after tone mapping.
- Place objects on `createHeightField().sample` (mesh-accurate), not the analytic `terrainHeight`.
- Blender is headless (`import bpy` before `import bmesh`). It is not preinstalled in a fresh session, but it is
  free and installs fine: `pip install bpy --break-system-packages` (a big download, so do it only when a model
  needs building). Kane has said this is fine, no need to ask. glTF winding matters in three.js.
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
- Stop the dev server with `fuser -k 4173/tcp`. `pkill -f vite` or `pgrep -f` matches its own shell and kills the command.
- After a squash merge, `git checkout -B main origin/main` and `git branch -D` the feature branch. The stop hook counts
  the unsquashed local commit as unpushed and nags, even though the work is already on `main`.
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
The little cyan bead on the tassel keeps its brightness at night through `src/glow.js` (shared with the backpack). Oddities to
tell Kane: the butt end reaches the sand in a deep crouch (the hip hangs from the head position).

Blue palms (done, `tools/alien-tree/`, `src/tree-sets.js`; my call on the look, Kane said to make my own visual choices): the sixteen
regular trees round the pool are now banded blue palms with feathery fronds and a few pale hanging veils, in 3 LODs (5,544, 1,884 and 560 triangles after the texture pass, up from 4,774, 1,584 and 476,
against the first blue trees' 40,000, 24,000 and 12,500). The axe, the wind sway (found by material name) and the projected
shadow work as before. The first trees' files are still in the repo and `?trees=old` shows them. LOD distances scale with each tree's
scale. The materials carry a small flat emissive floor in the model so the shaded side of the crown is teal, not black. Bark and leaf detail is shared: `src/surface-textures.js` draws it in code and puts it on any material named `Banded teal bark` / `Waxy blue leaf tissue` (UV rules are in its header), so new trees and logs can reuse the same bark. Oddities to tell
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
Tasks left: the morning summary for Kane.
