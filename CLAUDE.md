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
5. **Kane checks important 3D models before they ship.** For new or changed hand-built models (like the
   campfire, hero tree, creatures), send him the `.glb` with SendUserFile (or leave it in an open PR) and
   do not merge it until he says it looks right. Claude tends to miss stray vertices, inside-out faces and
   bad blends. Run `tools/campfire/check_mesh.py` style checks on every model, but that does not replace
   his look. Code, shader and gameplay changes do not need this.
6. **Quest performance comes first.** No post-processing passes, no big shadow maps, no per-frame
   allocations, keep triangle counts and draw calls modest. Desktop screenshots cannot prove headset
   frame rate; say so when relevant.

## Working on this repo

- Tests: `npm test` (node --test, no browser). Build: `npx vite build`. Dev: `npm run dev`.
- `gh pr create` fails here (GraphQL is blocked). Use the REST API:
  `gh api repos/permabulk69420-pixel/oasis/pulls -X POST -f title=... -f head=BRANCH -f base=main -F body=@file`
  then `gh api repos/permabulk69420-pixel/oasis/pulls/N/merge -X PUT -f merge_method=squash`.
- Dev-only URL fixtures (stripped from production): `?view=...`, `?hour=N` (0 night, 14 day),
  `?camp=lit|unlit`, `?campd=<metres>`. Add one when a new feature needs a repeatable screenshot.
- Screenshots: Playwright with Chromium (SwiftShader) against `npm run dev`. Look at them; do not assume.
- Day/night uses ACES tone mapping with very low night exposure (~0.035 vs day 0.82). Emissive and light
  levels must compensate for exposure, and night visibility relies on additive fills after tone mapping.
- Place objects on `createHeightField().sample` (mesh-accurate), not the analytic `terrainHeight`.
- Blender is headless (`import bpy` before `import bmesh`). glTF winding matters in three.js.
- Tests live in `tests/`. Add tests for game logic. Keep constants in one table at the top of a module.

## Roadmap (Kane's order of interest)

Campfire (done) -> cold nights and fuel -> fire and night visuals -> atmosphere -> first threat
(sandworm, titan blocker or boss; needs Kane's model check) -> building and more crafting.
Not yet tested on a real headset: keep reporting that honestly.
