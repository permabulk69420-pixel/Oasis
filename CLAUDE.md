# Oasis: instructions for Claude

Oasis is a three.js WebXR desert game for Meta Quest 3 (light survival and crafting, heading towards colossus fights). The owner (Kane, a solo VR dev in Sydney)
tests by opening the deployed GitHub Pages URL on the headset. Pushing to `main` deploys. These are standing rules from Kane; they apply to every session and survive compaction.

**Keep this file short (target under 20 KB).** It is loaded on every turn, so every line costs usage all night. History, logs, roadmap and per-feature detail live in
`docs/claude-history.md` and `README.md`: read a section of those only when the job needs it, never the whole file. Game direction: Project doc `claude/direction.md`.

## Where we are (update this block, keep it to a few lines)

- Ark-lite with Shadow of the Colossus at the heart: gather and craft lightly, face a colossus, unlock a craft (first idea: a glider), reach the next area. VR scale is the thing to protect.
- You start on a floating island (home base, dense jungle, scenery only) above a 4 km desert; the oasis is the one ground start (`?start=oasis`). Colossus 01 (55 m, passive) paces the gravel plain north of the oasis, driven from code.
- **The island is wild: no paths, trails, footpaths or any sign of people** (Kane, 6 Oct: "there's no other humans here"; paths let you see everything). Dense jungle, short sight lines, explore by wandering, glow marks each place at night. Old plan lines asking for paths are superseded.
- Not mine to decide: how a colossus is beaten, the climb, the glider, what dying means, water or stamina pressure, how you get to and from the island, building, day/night timing (5 and 5).
- Island art order (Kane, 6 Oct, wants fidelity over caution, no pop-in): grass (done), bushes and trees (roots are the trunk's own flare, no loose fins; LOD distances pushed out), then leaf variety and softer edges, then forest-floor shade (`vData.r`). Own models only, textures fine; do not brighten the night.
- Detail for each of these: `README.md` is a short map; the old long README is `docs/readme-archive.md` and the old long notes are `docs/claude-history.md` (grep them, never read whole).

## Usage budget (Kane hits the 5 hour cap; this matters)

- **Screenshots are the biggest cost. One question, one shot.** Decide what the picture must answer before taking it, then take only that view.
  Default is ONE day shot at the distance that matters (close for texture and shape, far only when scale or a level of detail is the question). Add a night shot only when the change is about light or glow.
  Never run a far, medium, close, day and night sweep for one change. At most 3 images per check in total; if more seem needed, pick the most telling and say what I skipped.
  After a fix, re-shoot only the view that changed. Do not re-look at a view that was already fine. Judge by eye at full size; no stitching.
- Do not read all of `README.md` or `docs/claude-history.md`: grep for the section, read that part.
- **No smoke test, no full test run** (Kane, 6 Oct). GitHub runs `npm test` (15 files) before every deploy. For an art change run nothing, or only the one test file that covers that module if there is one. Do not write new tests or harnesses for art tweaks; reuse the existing labs (`tools/island-lab/flora_shot.py`, `island_shot.py`) and add no new tool unless nothing existing does the job.
- Update `CLAUDE.md`, the README and the Project docs once at the end of a run, not as each thing lands.
- Do not pipe long logs into the conversation: tail, grep, or write to a file and read the summary line.
- Keep tool waits short; long idle gaps can drop the prompt cache. Poll a background job with a few quick checks, not a long sleep.

## How we work (Kane and me)

Kane is casual, often away from the headset and happy to hand me a stretch of work.

- **Make the call on art and atmosphere.** "You make the call what you think is best, we can always change it." Pick, build, show it, say what to look at. No menus for visual choices. Ask first on gameplay and UI (new mechanics, how things work) and on anything that costs money or touches an account.
- **Say what I think.** When he asks "what do you think", give a recommendation with reasons; say so plainly if I disagree.
- **Short reports.** What changed, one or two specific things to check in the headset, whether a PR is merged or waiting. No recap of steps and no "untested on a headset" (he knows).
- **Black rectangles in his headset screenshots are a Quest capture bug.** Ignore them.
- **He reads the screenshots in the tool log**, so render and actually look (one shot per question, see the usage budget above) and send the key before/after images with anything visual. I can judge stills, not motion or headset feel.
- **New hand-built models wait for his OK** (send the `.glb` and renders, leave the PR open) except under overnight authority (rule 5). Code, shader, texture-plumbing and docs changes get merged once verified. Wait for his headset feedback before changing a feature he has not tested yet.
- **Performance:** be bold with triangles (Kane, 6 Oct: "stop caring so much about the triangles"; Meta's Quest 3 guide is about 1.3 to 1.8M triangles a frame, about 1.4 to 1.6M is fine in a browser, cut later if it ever runs badly). Draw calls are the thing to watch (200 to 1000 by how busy the scene is); instance things, keep it sensible, no post-processing, no big shadow maps, no per-frame allocations. Real 1k CC0 PBR textures (Poly Haven, ambientCG) are fine where they show up close, at 1k not 2k, not on thin leaves.
- **He often talks by text-to-speech with an Australian accent**, so messages come long, unpunctuated, with mis-heard words. Read for meaning; if a mishearing would change what I build (which tree, which file, which look), ask one short question. **Watch "can", "can't" and "don't"**: the transcriber swaps them ("don't change it" arriving as "can change it"). If one of those words decides whether I act, and the rest does not settle it, check before touching anything.
- **Ark-like with VR controls**, not Green Hell or Boneworks. Light, purposeful physics (things falling, thrown); no gimmicky everything-is-physical systems. He does not get motion sickness: no comfort features unless he asks.
- **Do not hand models to another model** (Astra was a bust for the creature). I build creatures myself in Blender (mesh-check, render, send the `.glb` for his OK first).
- **Keep it relaxed.** Mate to mate: plain words, a joke when one fits, no padding.
- **Put new things straight into the real game**; no dev-only fixtures unless I need one to screenshot.
- **Do not make him repeat himself.** A fact, rule or preference he gives goes in this file before the session ends; if I hit the same pain twice, add a note and tell him.

## Standing rules (do not lose these)

1. **No sub-agents.** Never use the Agent tool or spawn helpers here (they burn his usage fast, inherit permissions, and a lower-effort helper once botched a Blender build). Ask first if one would ever help.
2. **Nothing that costs money, and nothing odd, without asking.** No paid APIs, no logging into or creating accounts. Free APIs and packages (pip, npm) are fine. If a call needs a key, an account or a card, ask first. The sandbox reaches most sites, so try before assuming a block.
3. **Never paste, print or commit API keys, tokens or login codes.**
4. **Commit only when it makes sense, and if you commit, merge.** Finished, verified work on a branch, open a PR, squash merge, confirm the Pages deploy goes green. Verified: `npm test` passes, `npx vite build` works, visual changes looked at in screenshots. If not good enough, leave the PR open and say why. A stop-hook asking for a commit is not Kane asking.
5. **Models and overnight authority.** By default, send new hand-built models (`.glb` via SendUserFile) and wait for his OK (stray vertices, inside-out faces, bad blends); always mesh-check (`tools/campfire/check_mesh.py` style) and look at renders first. When he leaves me overnight and says so ("you just merge and do whatever you feel is right"), merge everything on my own judgement, models included, still mesh-checked and rendered. That authority covers art, animation, atmosphere, effects only: no new mechanics, no plot, no new numbers for play. The run's own plan (`docs/overnight-plan.md`) wins over any line here. Do not assume the authority in a daytime session. In an unattended run: do not stop to ask (fire any question off at once, he closes the app, then decide), do not fear throwing away hours of work, keep time with `TZ=Australia/Sydney date`.
   **Nothing may touch a path outside the project, the scratchpad or its temp folder in an unattended run:** a permission prompt stalls the whole run (it cost 3.5 hours on 5 Oct from `cat > $TMPDIR/dummy` with `$TMPDIR` unset). Scratch files go in the scratchpad, a variable is checked before it is used in a path, and a command that waits on stdin is never run. A run that seems stalled for no reason probably hit a prompt nobody can answer.
6. **Quest performance comes first** (see the performance bullet above). Never add "not tested on a headset" to a report; flag only a specific thing worth looking at (shimmer, tracking, frame rate).
7. **Art and atmosphere over mechanics.** Do not invent mechanics or UI beyond what he asked for. Substantial models need three LODs with triangle counts checked against the Quest budget. Leave the hero tree alone.

## Working on this repo

- Tests: `npm test` (node --test, no browser). Build: `npx vite build`. Dev: `npm run dev` (port 4173).
- **Cut on 6 Oct (Kane: the tests and harnesses were as big as the game):** the smoke test and the colossus, hold, stinger and finds labs are deleted (restore from git history with `git show <old commit>:path` only if he asks), and `tests/` is down from 78 files to 15 that guard real logic (saves, survival, crafting, world and zones heights, shader markers, sun path). The `grip-debug` skill refers to the deleted hold lab. The only shot tools left are `tools/island-lab/` (flora lab, `island_shot.py`). Do not rebuild harnesses.
- Long procedures live in project skills (`.claude/skills/`): `ship-a-change`, `grip-debug`, `perf-triangles`. Load one when the job matches.
- `gh pr create` fails here (GraphQL blocked): use the REST API (see `ship-a-change`).
- Stop-hook "N unpushed commits and no remote branch" is this clone's fault: run `git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*' && git fetch origin` once per session.
- Saving is off unless the address has `?save=1`; `?fresh=1` starts a new game. Dev-only URL fixtures (stripped from production): `?at=x,z&look=x,z,h&eye=metres&pitch=deg`, `?view=...`, `?hour=N` (0 night, 14 day), `?camp=lit|unlit`, `?bird=perch|fly|flare`, `?treelod=0|1|2`, `?start=oasis`. Add one when a feature needs a repeatable screenshot.
- Screenshots: Playwright with Chromium (SwiftShader) against `npm run dev`. A shot takes 20 to 60 s in software (the dense forest 60 to 90 s, colossus lod0 more): run long jobs with `nohup ... > log 2>&1 &` and poll the log with quick checks.
- **Do not edit any `.js` under `src/` or `tools/` that a page imports (the flora lab counts) while a shot or smoke run is going**: vite reloads the page and the run dies ("Execution context was destroyed"). Tests, docs and Python tools are safe.
- Place objects on `createHeightField().sample` (mesh-accurate), not the analytic `terrainHeight`.
- Day/night uses ACES tone mapping with very low night exposure (~0.035 vs day 0.62): emissive and light levels must compensate; night visibility relies on additive fills after tone mapping.
- Torch and campfire hook into the terrain and water shaders by matching exact lines (`TORCH_SHADER_MARKERS`, `src/night-fill.js`, shared by both) and find the ground via `findTerrainMesh` (any tile named `sand-...`; if you rename tiles use `tileName` in `src/terrain-tiles.js`). Editing a marked shader line in `src/materials.js` silently breaks the lights: change the marker and shader together; a test checks it.
- Leaf materials use a plain alpha cut-out (`LEAF_ALPHA_TEST`, `src/island-flora.js`), not alpha-to-coverage (it made a web of outlines in the software renderer). If the headset shows crawling leaf edges it is a deliberate trade.
- A model black once a texture goes on? Check `COLOR_0` (vertex colours multiply the texture by about 0.1): turn `vertexColors` off or use `normaliseVertexColours` (`src/plant-colours.js`).
- Blender is headless (`import bpy` before `import bmesh`): `pip install bpy --break-system-packages` only when a model needs building (big download; Kane says fine). glTF winding matters in three.js. If a mesh looks faceted in the game, render a Blender close-up first to see whether geometry or shading is at fault.
- Kane cannot see a deployed change? Pages sends `cache-control: max-age=600`; assets carry `?v=<build id>` (`src/asset-version.js`); open the URL with an extra query (`?x=1`) to get past a cached page. Compare `content-length` of the live file with `public/`.
- Free texture sources: `python3 tools/textures/make_bark.py` shows the pattern (1k Poly Haven set, neutral grey detail plus normal map, credit in `public/textures/<name>/CREDITS.md`, a test that the files exist and are small).
- Tests live in `tests/`. Add a test only for real game logic (saving, rules), not for art. Keep constants in one table at the top of a module.
