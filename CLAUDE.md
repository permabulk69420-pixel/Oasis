# Oasis: instructions for Claude

Oasis is a three.js WebXR desert game for Meta Quest 3 (light survival and crafting, heading towards colossus fights; see "Game direction"). The owner (Kane, a solo VR dev in Sydney)
tests by opening the deployed GitHub Pages URL on the headset. Pushing to `main` deploys. Read `README.md`
for how the game works. These are standing rules from Kane; they apply to every session and survive compaction.

## Game direction (Kane, 5 Oct 2026; read this before choosing what to build)

His words: it is "very ark lite", "just enough survival crafting stuff to be fun", and "way more like some sort of Shadow of the Colossus thing".
Beat a colossus and it unlocks something to craft, first idea a **glider that gets you to the next area**. "That's basically all I've got in my head at
the moment", so keep it loose: he said not to get into too much of the specifics.
- The loop: gather and craft lightly, go out, face a colossus, unlock a craft (the glider), reach the next area, a bigger colossus. The colossi are the point;
  survival only feeds them. The stinger is the practice run. Crystals are the likely material for what a colossus unlocks (my lean, not decided; no fuel system). The giant bones are scenery. VR scale (a creature you look up at) is the thing to protect.
- My read, which he liked: the hardest part and the biggest risk is the climb (gripping something huge and moving by hand). A rough prototype of that comes
  before more survival or world detail. How a colossus is beaten, the glider's feel, what dying means and water/stamina pressure are HIS calls: do not
  invent them.
- Dropped or parked so they stop competing: co-op, cold nights and fuel as a survival system, and water as a hard leash. Base building is parked for now but likely comes back later as **foundation-and-house building, Ark style** (Kane, 5 Oct): you would spend a lot of the night inside, which gives a reason to go out for resources, and you might set up camps along the way. Not now, not designed.
- **Later ideas, not decisions (Kane, 5 Oct):** a head-mounted light you tap on, maybe night vision (he is not sure). The darkness is liked: do not go crazy brightening the night.
- **Colossus 01 brief (Kane, 5 Oct):** Kane is having another tool build the first colossus in Blender (a multi-day job, he expects several tries). The brief I wrote for it is `tools/colossus/BRIEF.md` (also `claude/colossus-brief.md` in the Project): a 55 m passive four-legged walker, a living relative of the giant bones, ivory plates over dark hide, cyan crystal hand-holds for the climb, one skeleton, three levels (up to 500k, 150k, 30k triangles), UVs and basic colour only. When the model comes back: check it against the brief (`tools/creature/check_glb.py` style, bone names, scale, symmetry, closed solids, skinning), then drive it from code like the stinger (the walk is procedural, no animation in the file). A crude stand-in on the same skeleton, with an adjustable triangle count to find the headset's ceiling and to prototype the climb, is the offered next step; he has not asked for it yet. How a colossus is beaten and how the climb works are his calls.
- **A sand yacht is a later idea (Kane, 5 Oct):** a three-wheeled land sailer you steer by holding the sail, so the game's wind (the gusts that move the sand and plants) would matter. He has a model from another tool (teal frame, cream sail with a rust stripe; it has UVs and basic colour only, to be reworked later) and has not sent the file. It overlaps the glider's job, so how they relate is his call; parked until after the climb prototype. Not in the game; do not build driving or sail mechanics unasked.
- **New models get UVs (Kane, 5 Oct).** He plans a bigger PBR texture pass later, so every new model needs proper non-overlapping UVs at a steady texel density, not vertex colours only. Textures stay 1k unless something is super important up close.
- The setting is a desert moon with a ringed planet in the sky and giant bones in the dunes: atmosphere only, with no story attached. Do not invent a plot.
- **The look is a twilight planet (Kane, 5 Oct, still loose).** His words, roughly: the sun should come up lower and the days be darker, with similar hours of night or even
  more, because the game is "still a little bit too bright", it "has a better vibe at night", the darkness hides a lot of flaws, and the game leans on bioluminescence. So lean
  darker and moodier, with the glow carrying the scene. **First pass done (5 Oct, #97): the sun now tops out at 14 degrees and slides round the horizon, dusky sky, darker days; he said "we'll work that out later" for how it changes by area.** Day length and the exact balance are not decided ("I don't know yet"), so do not change the day/night timing without
  asking (he set 5 and 5 himself on 5 Oct). Lighting and exposure are art, so those are mine to try and show (current: 5 minutes day, 5 minutes night, `src/day-night.js`: Kane asked for 5 and 5 on 5 Oct, "I need more time"; it was 3 and 3; day exposure about 0.62, night about 0.035; since 5 Oct the sun never climbs past 14 degrees, see README "The ringed planet and the sun's path").
- **Climbing is in, and gliding too (Kane, 5 Oct).** Both tie into stamina, which already exists (`src/survival.js`). It is the colossus climb above and probably a general
  ability as well. What each costs in stamina and how they feel are his calls, not mine to invent.
- **The world is 4 km now (Kane, 5 Oct):** the oasis is the start, with a gravel plain (the colossus's likely home), ridges, mesas, a canyon, badlands and a salt pan, one biome, no new crystals. See "The wider world" below.
- **Where the base lives: a floating island (STATUS, 5 Oct evening: it IS built as a place and you now start on it, see "You now START on the sky island" below; the rest of this bullet is the older thinking, where "do not build it unasked" is superseded by `docs/overnight-plan.md`).** His worry: the oasis is too small and barren to stay in, and walking the desert takes ages. His idea: a big floating island as the lush, dense home (trees, mining, caves, places to build), probably where you START (maybe "where you crash": no plot, do not write one), with smaller islands above it; you glide down to explore the dangerous desert, and the oasis would be the one safe spot on the ground. A flying mount is another idea of his. It would replace the "forest quarter" (a green south-west corner of the 4 km map, away from the colossus plain, the salt pan and the canyon), which stays as the fallback. The desert may stay sparse as long as the base is rich: he likes the expedition loop (gear up with water, weapons, maybe heat, then go down to a landmark or a new part of the desert). That would bring back water or heat pressure, which was parked, so that is his call when he gets there. Islands would be meshes, not heightfield, so caves and overhangs are possible there (the ground heightfield cannot do them); an island needs its own ground field for grass, trees and building. Order I proposed: rough glider prototype (I asked how it should be controlled; my guess was arms out like wings, rough and swappable), then ONE test island above the oasis, then he decides. How you get back up to the island is open. Do not build any of it unasked.
- **(Superseded in part: you now start there and can walk on it; no teleport, grass blades, caves, a way down or back up are still open.) The sky island exists as scenery (5 Oct, first pass, #111; Kane: "get that island up there... spend your time making sure it looks decent and the rock underneath looks okay; no teleport, I'll see it from the ground first; if it works I'll change my spawn up there after").** About 500 m across at (-150, 700), top 250 m above the dunes, hanging rock underneath, 90 palms on top, grass texture only. No way up, no walking on it, no gameplay. README "The sky island" has the details and what was left out. He also has another model making the glider; check its file when it arrives (same rules as other models). If he likes it, next steps are his: spawn up there, grass blades, a stream or pond, caves, how you get down and back up.
- **You now START on the sky island (Kane, 5 Oct, #113):** a flat grassy meadow at (-105, 635), facing -z, with a second set of the tools (axe, torch, spear, pickaxe) and the one backpack beside you; the oasis keeps its own tools. No invisible edge (his word): walk off and you drop to the desert ground 250 m down. No water, sticks or stones up there. `?start=oasis` starts by the pond; a dev build with a screenshot fixture (`?at`, `?view` and so on) stays in the oasis unless `&start=island` (`src/start-place.js`, `src/sky-island-ground.js`, `groundAt` in `src/main.js`). Island palms are scenery (no chopping). Not smoke-tested after this change (Kane asked to ship quickly).
- **You fall now (Kane, 5 Oct):** when the ground drops away (the island's edge, a cliff) you fall under gravity (`src/player-fall.js`, `FALL`; the numbers are mine) and landing faster than 9 m/s hurts (2.5 health per m/s over, cap 90, health still floors at 10), with a strong buzz. He said damage is fine, no death yet. Shipping habit: for a quick change, make it, test, build, ship, stop; run the smoke test locally before merging anything that touches the start or the world (the island start broke it once and cost him a 7 minute failed deploy).
- **Overnight plan (Kane, 5 Oct): `docs/overnight-plan.md` (also `claude/overnight-plan.md` in the Project).** Colossus 01 model check and procedural life first, then the sky island as set dressing. Read it before an unattended run; it only applies once he says go.
- The full write-up is `claude/direction.md` in the Project (the `Projects` tool). Keep it and this section in step.

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
- **Be bolder with the triangle budget (Kane, 5 Oct).** His words: "I think we do pussyfoot with the budget somewhat... I'm never gonna know if I don't really hit these
  limits." Meta's own guidance for Quest 3 and 3S is about 1.3 to 1.8 million triangles a frame and, by how busy the scene is, 200 to 300 (busy), 400 to 600 (medium) or
  700 to 1000 (light) draw calls (developers.meta.com/vr/documentation/unity/unity-perf/). Oasis is far under that (roughly 0.4 to 0.56 million triangles and under 100 draw calls
  at the spawn and shore views). A browser adds some cost, mostly to draw calls and per-frame code, perhaps 10 to 20 percent: that is a guess, not measured. His other VR game
  runs a million-triangle house fine. So spend triangles where they show, build generously, and let his headset find the ceiling; do not trim detail on caution alone. The hero tree
  (117k triangles, one level of detail) is fine for now and still gets a look later, with his OK first. A stress-test scene to find the real ceiling is an idea he has not asked for yet.
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
   when he says so, as he did on both nights; do not assume it in an ordinary daytime session. Even then it covers art, atmosphere and animation only: no new
   mechanics, no plot, and no colossus work unless he says so (**for the run planned on 5 Oct, he has said the colossus IS the job: see `docs/overnight-plan.md`, which wins over this line**).
   For that run he also said: do not be afraid to throw away hours of work if it is not good (bin it and redo it, no sunk cost); keep track of the
   time yourself (the clock tool says only the date here, so use `date` in the shell; he is in Sydney, `TZ=Australia/Sydney date`; the run began at
   22:33 AEDT on 4 Oct); his usage and permissions are set to the maximum, so nothing should stop the run; and if I have a question he wants it fired
   off straight away because he closes the app after his last message (then decide it myself).
   **Nothing may touch a path outside the project, the scratchpad or its own temp folder in an unattended run:** that raises a permission prompt and the
   whole run sits there until he is back. On 5 Oct it cost 3.5 hours (03:50 to 07:33) because of a stray `cat > $TMPDIR/dummy`: `$TMPDIR` was unset, so the
   path became `/dummy` at the root of the disk. Scratch files go in the scratchpad (`$SP`), a variable is checked before it is used in a path, and a command
   that waits on stdin (a bare `cat >`) is never run. If a run seems to have stalled for no reason, the likely cause is a prompt nobody can answer.
6. **Quest performance comes first.** No post-processing passes, no big shadow maps, no per-frame
   allocations, keep triangle counts and draw calls sensible and measured (but see "Be bolder with the triangle budget" above: do not be timid). Kane knows desktop checks cannot prove how
   something looks, feels or runs on the headset, so never add "not tested on a headset" to a report or a
   PR. Only flag a specific thing worth looking at there (shimmer, tracking, frame rate) and say what to look for.
7. **Art and atmosphere over mechanics.** Kane wants to be involved in important gameplay and UI decisions
   (fuel, cold, how things work). Do not invent game mechanics or UI beyond what he asked for. Visual art
   direction is where he trusts me most. Anything substantial (trees, creatures, big props) needs proper LODs
   (3 levels, with triangle counts checked against a Quest budget). Leave the hero tree alone.

## Working on this repo

- Tests: `npm test` (node --test, no browser). Build: `npx vite build`. Dev: `npm run dev`.
- Smoke test (loads the real game headless, day and night, fails on page errors, a blank picture or a blown draw-call/triangle budget; also runs in the
  Pages workflow before every deploy): `python3 tools/smoke/smoke_test.py --shots <dir>` against `npm run dev`. Use the system `/usr/bin/python3` (it has Playwright).
- Long procedures live in project skills (`.claude/skills/`): `ship-a-change`, `grip-debug`, `perf-triangles`. Load one when the job matches; add a new
  skill when a procedure needs more than a few lines here (Kane gave me full authority over this file and the skills).
- `gh pr create` fails here (GraphQL is blocked): use the REST API. Commands, merge routine and stop-hook notes are in the `ship-a-change` skill.
- `?fresh=1` starts a new game (only matters with `?save=1`; the old save is kept aside, see "Saving" below). Saving is off unless the address has `?save=1` (any build), so the fixtures below never meet a save.
- Dev-only URL fixtures (stripped from production): `?at=x,z&look=x,z,h&eye=metres&pitch=deg` anywhere in the 4 km world (`eye` is the camera height above the ground, so `&eye=300&pitch=-30` is a bird's eye view; the far haze hides most of the world from high up), `?view=...`, `?hour=N` (0 night, 14 day),
  `?camp=lit|unlit`, `?campd=<metres>`, `?bird=perch|fly|flare`, `?view=pack`, `?pack=worn`, `?view=spear`, `?treelod=0|1|2` (every tree at
  one level of detail). `?trees=old` also works in production (the first blue trees, for comparison). Add one when a new
  feature needs a repeatable screenshot.
- Held things (grip clipping, the hold lab, `lab_shot.py`, `probe_grip_point.py`): see the `grip-debug` skill.
- Screenshots: Playwright with Chromium (SwiftShader) against `npm run dev`. Look at them; do not assume.
- Triangle and draw-call counts per object: see the `perf-triangles` skill.
- Day/night uses ACES tone mapping with very low night exposure (~0.035 vs day 0.62). Emissive and light
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
- **The torch and campfire find the terrain material through `findTerrainMesh` (`src/night-fill.js`, any tile named `sand-...`), never by an exact tile name.** The 4 km rewrite (#107) renamed the tiles and silently broke both lights on every bit of ground, the oasis included (Kane noticed on 5 Oct; fixed with a test). If you rename tiles, use `tileName` in `src/terrain-tiles.js`.
- **The torch light hooks into the terrain and water shaders by matching exact lines** (`TORCH_SHADER_MARKERS` in `src/night-fill.js`, used by `src/torch.js`). Editing one of those lines in `src/materials.js` makes the torch silently stop lighting the sand (it happened in #99; fixed in the next PR). A test now fails if they drift: change the marker and the shader together.
- Tests live in `tests/`. Add tests for game logic. Keep constants in one table at the top of a module.

## Roadmap

Campfire (done). Direction is in "Game direction" at the top: Ark-lite plus colossi, with a glider as the first unlock. Cold nights, fuel, base building
and co-op are parked or dropped (5 Oct). Visual direction now: dust and sand, fire smoke and heat haze, night sky, plant sway (done), an
ambient alien bird (done), a physical backpack (done), a spear (done), newer trees with LODs (done). Next big thing: a colossus, starting with a rough
climb prototype once Kane says go (how it is beaten is his call). Kane tests on the headset himself: do not keep saying it is untested, say what to look for.
Art-only extras still open (no decision needed): dust devils by day, a dawn and dusk look (part of the twilight direction in "Game direction"), a small skittering critter, a bone texture pass, and a `creature-pipeline`
skill in `.claude/skills/` (the Blender to pose code to game procedure, written from the stinger v3 build).

Campfire placement ghost (my call on the buttons, Kane asked for "a logical button and some ghost"; `src/placement.js`, `tests/placement.test.js`): the menu's Place starts a green/red ghost that follows your aim; VR: the hand that
pressed Place aims, its trigger confirms (armed once released), Y/menu cancels; desktop: click or Enter, Y/Esc cancels; touch: tap. Item is spent only on confirm. Spot snaps to 0.2 m (so the ghost's turn, a hash of x,z, is stable and a reloaded fire sits the same way).
Oddities to tell Kane: the hint text and ghost colours are mine; the ghost ring ignores depth so it never sinks into a slope; no sound.

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

Glow plants (my call on the look, done; README "The glow plants", `src/glow-garden.js`, `tools/glow-plants/`, `tests/glow-garden.test.js`): glow reeds round the water and lantern blooms on the banks and in a grove round the hero tree, in the hero tree's cyan, three levels each, with UVs for the later PBR pass.
Kane saw the first renders and said "I like what you're doing too, don't worry about needing to show me", so these were merged without waiting for his OK on the models (that waiver is for this pass; new models still wait by default). Oddities to tell Kane: bulb brightness and halo size are my numbers (`glow`, `halo` in `GLOW_GARDEN`);
no collision and nothing to harvest; the lantern has no violet; the stems go dark at night so the bulbs seem to float; the models carry vertex colours plus UVs but no textures yet; the plants add a few draw calls (one per material per level).

Plants give way to you (Kane's idea, 5 Oct; my call on the numbers; README "Plants that give way to you", `PUSH` in `src/wind.js`, `src/plant-push.js`): feet and both hands shove nearby grass, ferns and glow plants away, shader only, no memory. `?push=0` compares with it off. Grass is pushed per vertex, everything else leans rigidly from its root (the first version pushed every vertex and warped the glow plants when a hand came near; Kane noticed). Oddities to tell Kane: the radii (0.62 m feet, 0.42 m hands) and the reach are my numbers; a plant snaps back the instant you leave it; the cost on a Quest is my guess (10 to 20 percent more plant vertex work), not measured, so if the frame rate dips trim `push` on the grass first. He liked the idea of a lantern bloom glowing brighter when brushed, to try after he has felt this.

The wider world (Kane, 5 Oct: the oasis is "fucking small", "we need way larger areas or something to explore"; "you just want to work on making this feel like a bigger sort of environment with other areas"; my call on the places; README "The wider world", `src/zones.js`, `src/terrain-tiles.js`, `src/terrain.js`, `tests/zones.test.js`):
the desert is now 4 km by 4 km (x -1500 to 2500, z -2500 to 1500, `AREA.bounds`) with the oasis square (-500 to 500) **exactly** as it was (a test pins twelve of its heights; do not touch `homeHeight` in `src/world.js`).
It is one biome, as Kane asked: where the bedrock comes through (ridges, mesas, a canyon plateau, badlands of buttes and gravel washes), a flat gravel plain north of the oasis (`AREA.flats`, framed by ridges, left empty on purpose as the likely colossus ground, his idea of "flat areas, maybe the Colossus in one"),
a salt pan south, and mountains round the whole edge that the player is stopped inside (`WALK`). **No new crystals (Kane: "not 100% sold on those crystals... too colourful funky less realistic", he plans to thin them out): the wider world has plain sandstone outcrops and spire plants only, glow stays rare. Do not add crystals out there unless he asks.**
Zones are a data table (`AREA`) plus `shapeTerrain`, so the next area is a new table, not new terrain code. The ground is a lazy tile cache (`createHeightField`), the sand a quadtree of tiles (62.5 m chunks with the old two levels of detail near the player, then 125, 250, 500, 1000 m), the sand shader reads a `zone` vertex attribute
(rock, salt, gravel) for strata, salt and pebbles; the wind-blown sand reads its own 128 cell window of the ground round the player (`src/ground-window.js`) because the old fixed height texture covered only the oasis square (the water shaders still use that).
Heights past 64 m exist now: anything that packs or assumes a height range under 64 m must change (the oasis height texture is only the old square, which is fine). `FINDS` has a second pass (`wild*`) with its own random stream so the oasis' node ids never move.
The air thickens more slowly past 600 m (`air` in `src/materials.js`) so far mesas read. Things I did not do yet, on purpose, because he asked to see this first: more giant bones out there, a second colossus-sized landmark, anything living in the new areas (no new creatures: that is gameplay),
resources beyond rocks and spires (no wood out there), a map or a compass (UI), fast travel. Oddities to tell Kane: a mesa is a cliff you can walk straight up (there is no slope limit, as before); the canyon floor and the plain are the nice places to look first; new tiles are built a few at a time as you walk,
so a very fast walk could show a coarse tile for a moment; the mountain wall is steep but the invisible stop is on its slope, so you can walk a little way up it; the terrain is about 70 draw calls and 80k triangles in view (measured in the desktop run with the sand hidden and shown; the smoke test at spawn reads 188 calls and 497k triangles in all); the strata look and the pale salt are mine.

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
the same skeleton: `tools/creature/check_glb.py`, then retarget `src/stinger-pose.js` and the `hitParts` bone names in `src/dune-stinger.js` to its bones. (The redesign was done on the night of 4 to 5 Oct under his blanket go-ahead, see "Second overnight"; no paid or AI-mesh tool without his say-so still stands.)
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


## Second overnight (4 to 5 Oct 2026, Kane asleep from about 22:30, full authority)
Kane's words: "you don't ask anything or when I leave you overnight you just merge and do whatever you feel is right that's one hundred percent
on you... just don't fire off subagent or do anything crazy"; "don't be afraid to throw away hours of work"; no gameplay mechanics ("let's not think
about gameplay mechanic that's going to be something I really need to test and do myself"), no sound effects yet ("way more intentional later"). He
wants "something more than just visual" and a reason to go out into the desert: a pickaxe, good stones or crystals, a "not a cactus" alien plant, PBR.
Plan: pickaxe + desert finds, dune stinger v3 (Blender), fight effects, saving, footprints, giant bones, a direction doc in the Project. Keep the time
(`TZ=Australia/Sydney date`). Done so far: #75 (smoke test in CI), #76 the pickaxe and desert finds, #77 the dune stinger v3, #78 fight effects (all below), #79 saving, #80 footprints, #81 giant bones, #82 the ringed planet and the smooth sun path, #83 crystal motes (below, last paragraphs). Not done when Kane woke (lost 3.5 hours to a permission prompt, see rule 5): dust devils by day, a dawn and dusk look pass, a skittering critter, the `creature-pipeline` skill.

Pickaxe and desert finds (my call, done; see README "The desert finds and the pickaxe"): `src/pickaxe.js` (a stone pickaxe like the axe, crafted from 3 sticks +
3 stones, also stands by the starting tools, hurts the stinger for 26), `src/desert-finds.js` (fixed-seed layout of about 120 nodes in 25 sites),
`src/find-shapes.js` + `src/find-materials.js` (procedural sandstone outcrops with Poly Haven "Cliff Side" 1k PBR, glowing violet and cyan crystal
clusters, spiny teal spire plants, all with three levels of detail), `src/mining.js` (rules, instanced rendering, hits, drops, regrowing, solid
rocks), `src/loose-finds.js` (the crystal shard and the fibre bundle you pick up), `src/bursts.js` (flying chips). Tools hit by passing the tool
instance through `weapon-hits.js`. Oddities to tell Kane: the pickaxe recipe (3 sticks + 3 stones), its 26 damage and where it stands are my numbers;
stone drops are a piece per 30 damage and a rock gives about 6 to 8 (weight 8 each, so five fill your pockets); crystal shards weigh 4 and do nothing yet
(current lean: material for a colossus unlock); respawn times 900 s (rock), 700 s (crystal), 300 s (spire); the first crystals sit on the stinger's ground on purpose;
rocks are solid but the stinger walks through them; the sandstone is a dark red photo lifted warmer in `SANDSTONE.lift`.

Dune stinger v3 (my call, built from scratch in Blender, done; `tools/dune-stinger/v3/build_stinger_v3.py` on the shared `tools/creature/kit.py`, models in `public/models/creatures/`, README
"The dune stinger in the game"): a real scorpion instead of v2's 16-legged centipede: plated carapace with a ridge and an eye cluster (two big eyes, a ring of small ones), four pairs of three-part legs
(thigh, shin, claw foot, knobbly knees), two jointed pincers (left a size bigger) that raise, spread and snap, toothed jaws, six abdomen plates and a five segment tail about 2 m long with a lancet sting.
33,088 / 10,988 / 1,992 triangles (ceiling 50k, 1.4 MB / 0.5 MB / 0.15 MB), 55 bones, 2 draw calls a level, cyan glow in the eyes, flank dashes, tail seams and sting (`glow` brightness 0.5 day, 0.4 night:
brighter than about 0.5 clips the cyan to white; the windup flare is what takes it to white). `src/stinger-pose.js` was rewritten for it: **the legs are solved, not swung** (two-bone solver per leg on the loaded skeleton,
feet stay planted on the sand, legs bend deeper in the crouch and fold when it dies), the tail poses were found by search (`node tools/stinger-lab/tail_explore.mjs strike|dead`) so the strike arcs over the body and lands the
sting on the ground 0.94 m (2.35 m in the game) ahead of the middle, which is what `BRAIN.strikeReach` assumed, and the dead tail lies on the sand curled to one side. The fight logic and every `BRAIN` number are unchanged.
Hit test is capsules along the head, body, tail pieces, sting and claws (`DUNE_STINGER.hitParts`; a test checks they cover 94%+ of the skin). Dev: `window.__stinger` in the dev build, the pose lab `tools/stinger-lab/`
(`stinger-lab.html?poses=rest,alert,windup,strike&cam=side`, `lab_shot.py`), `tests/helpers/stinger-model.js` reads the real GLB for tests. Oddities to tell Kane: its body and claws are as long as v2's (about 3.8 m at scale 2.5) but it is wider (the legs span about 3 m) and the tail rears higher (3.5 m at rest, 4 m cocked; v2's was 2.8 m):
`DUNE_STINGER.scale` is the knob (2.2 brings the cocked tail to about 3.6 m); the legs are thin spikes and may shimmer at a distance; the claws are animation only (no pincer attack); the feet read the ground at four points so they can float or sink a few cm on steep faces; it still walks through rocks and has no sound; the glow is dimmer than v2's on purpose.

Fight effects (my call, done, #78; README "The dune stinger in the game"): `src/sand-puffs.js` is a generic pool of soft dust clouds for anything heavy that lands on the dunes (instanced camera-facing quads, one draw call, 96 at most,
CPU simulated, `impact`/`kick`/`collapse`/`trickle` presets, a fade near the ground so there is no hard cut where a quad meets the sand). `src/dune-stinger.js` uses it: sand kicked up behind the lunge, a ring plus plume where the sting
lands, chitin chips (the mining's `bursts.js` pool) and a puff when a blow connects, a cloud and chips when it dies, the dead body sinking into the dune from 6 s to 38.5 s (`DUNE_STINGER.sink`) and a new one climbing out of the sand
over 2.6 s at its home. No sound and no screen effect when you are hit (haptics only, still). Oddities to tell Kane: the dust is pale and soft on purpose, so look for it at the sting's landing and when it falls; at night it is a faint
moonlit smudge; the dead body is under the sand by about 38 s, which is just before the 40 s it lingers.

Saving (my call, done; **switched off on 5 Oct at Kane's word: he is testing and wants a fresh world each time, and would rather the player chooses to save later; `?save=1` turns it on in any build, everything below is how it behaves then**; README "Saving", `src/save-game.js`): a silent autosave in local storage every 10 s and when the page is hidden, the headset comes off, a VR session ends or the menu closes. Saved: inventory,
health/food/water/stamina, time of day, where you stand and face (a VR session starts there too, not at the world's start), every tool (hip, lying, planted, a burning torch), campfires and whether lit, the backpack, the rocks you have
broken (mining already had `serialize()/restore()`). Not saved on purpose: trees (they regrow in 3 minutes), loose sticks, stones and fruit (scattered again), the creatures. Rules that keep it safe: nothing is written until every saved
part has been put back and the models (tools, fire, pack) have loaded; every number in a save is checked on the way in (`cleanSave`), a damaged part is dropped and the rest kept; a save the game cannot read, or that has been through two
starts that never drew for 3 s, is set aside under `oasis-save-kept` and the game starts clean; local storage that refuses is fine. A tool kind the save never heard of keeps its starting tool (that is how a new tool reaches an old save).
When something new needs to survive a reload: add a slot in `src/main.js` (`createAutosave` list) and a cleaner in `CLEANERS` (`src/save-game.js`), and a test; bump `SAVE.version` only if an old save can no longer be read.
Oddities to tell Kane: he comes back where he left off, so to see the start of the world (the starting tools, the stinger's ground) open the page with `?fresh=1`; the sticks, stones and fruit you picked up are back on the ground next time
while the ones in your inventory stay (a small duplication, left alone for now); a stick or stone in your hand when the page closes is lost.

Footprints (my call, done; README "Footprints", `src/footprints.js`, `tests/footprints.test.js`): your feet alternate every 0.74 m (1.05 running), the stinger lays a four-claw mark wherever a foot really comes down
(`plantedFeet` in `src/stinger-pose.js`); a decal that multiplies the sand, shaded as a dent lit from the sun's side, filled in by the wind (holds 18% of its life, 150 s yours, 220 s the stinger's). Two rings of 480 slots, one
instanced draw call, nothing per frame, not saved, no sound. The quad is laid flat so it faces down: the material MUST stay `DoubleSide` (it was invisible until then). `flat` is a reserved word in GLSL ES 3.00, so
a variable called `flat` kills the shader. Dev handle `window.__prints`. Oddities to tell Kane: look along a dune ridge in low sun (the dents show best from the sun's side and fade at noon), at night they hardly show
(only the pressed floor), a trail is gone after about two and a half minutes, prints are not laid on grass or in the pond.

Giant bones (my call on the look and the places, done, #81; README "The giant bones", `src/giant-bones.js`, `tools/giant-bones/build_bones.py`, `tests/giant-bones.test.js`): a colossal skull lying open-jawed in the dunes 230 m from the start, turned to face you,
with the ribcage of the same animal 43 m behind it (a row of tall arches with a collapsed stretch of spine, one pair missing, snapped ends, fallen ribs), and a smaller ribcage 320 m out the other way. The carcass is searched for
(`layoutBones`: level ground, clear of the pond, hero tree, stinger home and every find, ribs in sight of the start); the lone ribcage is at least 240 m from it. Models in `public/models/bones/giant_{ribs,skull}_lod{0,1,2}.glb`
(23,592 / 5,716 / 2,256 and 17,088 / 4,476 / 1,496 triangles, one draw call each, vertex colours, one material `Bone`). The runtime fetches only the far level at the start, the others as you approach (prefetch at 1.5 times the distance), and keeps the
nearest arrived level on screen meanwhile. Built with the shared `tools/props/propkit.py`, which had a bug I fixed on the way: the two end caps of a tube faced the same way, so one cap per tube was inside out (invisible from outside, and it made every skull
tooth fail `check_mesh.py` with "inside_out"); other props built with it before are unaffected (their volumes are dominated by the sides) but a rebuild will now be correct. Another bug worth remembering: a random offset drawn inside a
list comprehension is drawn once PER POINT; I drew the ribs' sideways nudge that way and every ring of every rib shifted, which made ledges all down the bone (the Blender close-up showed it, the game's distant shots did not): draw once, then apply it.
When a mesh looks faceted in the game, render a close-up of the GLB in Blender first (`tools/props/render_preview.py ... --views close --focus x,y,z --dist 9`) to see whether the geometry or the shading is at fault.
Oddities to tell Kane: you can walk through the bones (no collision), they cast no shadow, there is no sound; they are big (the skull about 18 m long, the ribs about 14 m tall with spines above); the close level is a 1.1 MB download that only
starts when you are about 190 m from the ribs; at night they are a thin moonlit silhouette against the stars like the trees. The skull's mouth is dark inside and the bone is plain ivory with a faint mottle, so a texture pass (cracks, a real bone photo) is the obvious next step if he wants it closer.

Crystal motes (my call, done; README "The desert finds and the pickaxe", `src/crystal-motes.js`, `tests/crystal-motes.test.js`): at night small violet specks (a fifth of them cyan) rise off every standing crystal, wander, lean with the wind's gusts and fade out; one `Points` draw, all the motion in the vertex shader, none by day, thinned out from 70 m and gone by 150 m. A broken crystal takes its motes with it and they return as it regrows. The point size is in metres through `uViewHeight` (so the Quest and a monitor agree), not a fixed pixel count. They are meant to be subtle: if they are too faint or too many in the headset, `MOTES` (`perNode`, `size`, `brightness`) is the whole dial. To see one in a screenshot: `?hour=0&at=262,-155&look=263,-163,3.2` (the crystal field 160 m up the dunes). The pond already had fireflies, which is why these are at the crystals.

Ringed planet and the sun's path (my call, done; README "The ringed planet and the sun's path", `src/night-sky.js`, `src/sun-path.js`, `tests/sun-path.test.js`): a teal banded gas giant with cream rings hangs in the sky 25 degrees right of the way you first look and 21 degrees up, fixed for ever (the moon is locked to it),
lit by the sun so it has phases, with ring shadows both ways; all in the sky shader (`planetLight`, early-out for the rest of the sky), star points behind it are zeroed in `createNightStars`. Day: pale ghost, only the lit side and the rings. The sky shader composites it over everything else
(premultiplied), so the Milky Way and stars never show through the disc. **I also fixed a bug in the day cycle:** the old sun kept one compass bearing all morning, then flipped to the opposite one at noon (and again at midnight), so the sun, the lighting and the moon each jumped 63 degrees across the sky once a cycle.
`sun-path.js` keeps the rise and set points, every height, and the exact starting sun, and swings the bearing smoothly (`swing(angle) = angle - sin(2 angle)/2`); the cost is that mornings and afternoons are lit from a slightly different bearing than before (up to about 16 degrees at the
start time, more near noon). If Kane preferred the old light, the quickest way back is `SUNRISE_BEARING`/`swing` in `sun-path.js` (a constant bearing gives the old morning), but the noon and midnight jump should not come back. Oddities to tell Kane: look up and to the right from the start; the planet is faint and ghostly by day;
the rings are foreshortened so their outer edge can shimmer a little in the headset (if so, widen `edge` in `ringDensity`); a quick way to see it in a screenshot is `?hour=21&pitch=14` (night) or `?hour=7&yaw=-62&pitch=21`.


- **Stamina is x20 for testing (Kane, 5 Oct)**: `staminaSprintPerSecond` 0.25 instead of 5 in `src/survival.js` (about 400 s of sprint). Put it back to 5 when he says, or when stamina starts to matter (climb, glide).
- **Turbo movement (Kane, 5 Oct, testing aid):** click both thumbsticks together in VR (T on a keyboard) to toggle 10x movement speed (`TURBO` in `src/turbo.js`; a lone stick click is sprint or crouch, a hair late so the two-stick click can be told apart). Not saved. He asked for it because the 4 km world is too slow to test on foot; a rough glider is the next idea he agreed to later, his call on the feel. The hero tree needs lower levels of detail, one cheap enough to be always drawn as a landmark (he agreed, 5 Oct), old model unchanged up close.
- **Testing start kit (Kane, 5 Oct)**: a new game starts with one campfire in the pockets (`TESTING_START_KIT` in `src/main.js`), so he can test placing and lighting without gathering. Saving is off, so every page load is a new game. Empty the list when the real start is wanted.
