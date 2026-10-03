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
   Nano Banana, ElevenLabs and so on), no installing or logging into accounts, no surprises.
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
   allocations, keep triangle counts and draw calls modest. Desktop screenshots cannot prove headset
   frame rate; say so when relevant.
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
  `?camp=lit|unlit`, `?campd=<metres>`, `?bird=perch|fly|flare`. Add one when a new feature needs a repeatable screenshot.
- Screenshots: Playwright with Chromium (SwiftShader) against `npm run dev`. Look at them; do not assume.
- Day/night uses ACES tone mapping with very low night exposure (~0.035 vs day 0.82). Emissive and light
  levels must compensate for exposure, and night visibility relies on additive fills after tone mapping.
- Place objects on `createHeightField().sample` (mesh-accurate), not the analytic `terrainHeight`.
- Blender is headless (`import bpy` before `import bmesh`). glTF winding matters in three.js.
- Tests live in `tests/`. Add tests for game logic. Keep constants in one table at the top of a module.

## Roadmap

Campfire (done). Kane is not sure about cold nights or fuel yet, so those are parked until he decides how
they should work. Visual direction now: dust and sand, fire smoke and heat haze, night sky, plant sway (done), an
ambient alien bird (done), a physical backpack, then newer trees with LODs. Later: first threat (sandworm, titan
blocker or boss), building and more crafting. Not yet tested on a real headset: keep reporting that honestly.

Backpack design (my call, Kane approved): a physical pack you grab (reaching behind your back is the VR habit)
and put on; it then disappears into the normal menu and expands the menu inventory. Keep it simple and note
anything odd for him.

## Overnight progress log (3 to 4 Oct 2026)

Merged so far (PR numbers, newest last): #25 campfire, #26 and #27 CLAUDE.md, #28 wind-blown sand and dust, #29 fire
smoke plus a moonlit fill/rim for lit objects at night, #30 the night sky (moon, Milky Way, shooting stars), #31 plant
sway (grass, ferns, reeds, desert plants and the alien trees lean with the same gusts as the sand; `src/wind.js`;
the hero tree is left still), #32 the alien bird's model (3 LODs, 19 bones), pose code and pose lab, #33 the alien bird in the game (by day one flies in,
circles the pond and lands to drink, or just crosses the sky; `src/alien-bird.js`, `src/bird-brain.js`,
`src/bird-flight.js`; none of it affects gameplay; dev fixture `?bird=perch|fly|flare`).
Kane also asked (while asleep) for a spear, if there is time: a held tool like the axe and torch, my call on the
design, no combat mechanics. Heat haze was skipped on purpose (it needs a full-screen copy of the scene: too costly on Quest). Tasks left in
order: backpack, spear, newer trees with LODs, perf check.
