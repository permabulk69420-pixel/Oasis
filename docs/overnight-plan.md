# Overnight plan (the owner, 5 Oct 2026, written together before he leaves)

This is the rulebook for the unattended run. It only applies once the owner says "go" and leaves. If anything here conflicts with a guess of mine, this wins.

## The two jobs, in order
1. **Colossus 01 (the big one).** the owner's other tool built it; he sends the `.glb` (about 40 MB). **Only lod0 is likely to arrive** (the owner, 5 Oct). Steps:
   - Check it against `tools/colossus/BRIEF.md` (`tools/creature/check_glb.py` style): bone names, scale (about 55 m), symmetry, closed solids, skinning, UVs, levels of detail. Render every side and look at the cyan hand-holds (are they big enough to grip?). Report anything wrong; do not "fix" it silently.
   - **Missing LODs:** if lod1 and lod2 are not there, report the gap. Do not quietly generate them (the brief wants all three on the identical skeleton). Rough decimated stand-ins only if the owner asks for them, clearly labelled as a stopgap. He has not asked.
   - Put it in the game like the stinger: model in `public/models/`, driven from code (no animation in the file). A procedural walk that feels huge and alive: slow, heavy footfalls, weight shift, breathing, a head that looks about, legs solved onto the ground (the stinger's two-bone solver is the pattern), dust where feet land (`src/sand-puffs.js`), footprints. Passive: it does not attack and nothing here is a fight.
   - VR scale (a creature you look up at) is the thing to protect. Check it from the ground, from 50 m and from 300 m, day and night.
   - Where it lives: the flat gravel plain north of the oasis (`AREA.flats`).
2. **The sky island as a place (set dressing).** The island is going to be the player's **main home base**, so it has to hold attention over many visits: variety, distinct places, a reason to wander. It should feel like a real, cool little home that fits the oasis art style: dark, moody twilight, glow carrying the scene. Lean on bioluminescence; do not brighten the night. Keep the start meadow open.

   **The lake (the owner, 5 Oct: a real lake, but not big).** About **100 m long and 50 m wide**, roughly 2% of the top, so it is one focal point among several, not the main event. Not a small circle: an irregular shoreline with a bay on one side and a rocky headland or small spit on the other. Off-centre, clear of the start meadow. Reuse the oasis pond's water look. Ring it with glow reeds and lantern blooms in the oasis cyan, boulders and a few palms on the banks, and one or two rock outcrops in the water. Scenery only: no drinking, no swimming, no gameplay. A thin waterfall may spill over the cliff rim and must thin to mist before the ground is allowed. No rivers.

   **A handful of small, distinct places you can see from each other:**
   - **The meadow:** the open start, kept clear.
   - **The lake:** as above; the glowing centrepiece at night.
   - **A palm grove:** the existing oasis palms grouped into a shaded stand, not spread evenly.
   - **A rocky rise:** boulders, a lookout ledge and a tall landmark rock visible from anywhere on top.
   - **An edge with a view:** the cliff rim where the waterfall spills over, looking out at the desert, the colossus plain and the planet.
   - **A hollow or overhang:** a sheltered nook (a possible later camp or house spot).

   Low, readable, winding paths between them, with small details along the way: scattered glow plants, fallen logs, small stones, a few pale bones as a quiet echo of the colossi. The glow marks each place so you can navigate by it at night. Keep the layout loose enough that foundation building, paths and a camp spot can be added later without redoing anything.

   **New island-only models (the owner, 5 Oct: add more unique models and plants so it is not the oasis copied up there).** Oasis style: dark forms with cyan glow. No new crystals (the owner is not sold on them); the glow lives in plants and thin seams.
   - **Plants:**
     - a tall weeping glow-tree, smaller than the oasis hero tree
     - hanging vine curtains off the cliff rim and the overhang
     - fern-like frond clumps
     - low mossy cushions on the rocks
     - big pale flowers that open at night
     - fungus shelves on fallen logs
     - seed puffs drifting near the meadow (scenery only; holding on and drifting stays the owner's call)
   - **Landmarks:**
     - a twisted tree-root arch
     - one or two standing stones with faint glow seams
     - a broken, weathered ruin of a ribcage, echoing the colossus bones
   - **Small things:** driftwood at the lake, stepping stones, moss-covered boulders, little glowing mushrooms along the paths.
   - **If there is time:** a small creature that moves around the lake (a drifting glow-fly or a bird). Passive, no gameplay.
   - Give each plant type its own spot rather than scattering evenly, so every part of the island has its own look.
   - Every new model: proper UVs at a steady texel density, textures 1k at most, instanced where there are many, so Quest draw calls stay sensible.

## Rules (all standing rules still apply)
- Merge what is verified on my own judgement (models too, tonight); mesh-check and look at renders first.
- **Art, animation, atmosphere only.** No new mechanics, no new numbers for play, no plot.
- Not mine to decide: how a colossus is beaten, how the climb works, the glider's feel, what dying means, water or stamina pressure, how you get down to or back up to the island, drinking up there, foundation building, the day/night timing (5 and 5, leave it).
- No sub-agents. Nothing that costs money, no accounts, no keys. Nothing outside the project, the scratchpad or its temp folder (an unattended permission prompt stalls the whole night).
- No sand yacht, no glider (the owner's other model is still coming; check it when it arrives under the normal model rules).
- Quest budget: be bold with triangles (colossus up to 500k / 150k / 30k per the brief), keep draw calls sensible, no post-processing, no per-frame allocations.
- New models get proper UVs at a steady texel density; textures stay 1k.

## Habits
- **Run the smoke test locally before merging anything that touches the start, the world or the scene** (`python3 tools/smoke/smoke_test.py --url http://localhost:5173`, system `/usr/bin/python3`, about 3 minutes, do not edit source while it runs). The island start once broke it and cost a 7 minute failed deploy.
- Confirm each Pages deploy goes green; if one fails, fix it first.
- Task list for every step; keep the time with `date` in the owner's time zone.
- Questions he would want: fire them off at once (he closes the app after his last message), then decide myself.
- Final report short: what changed, one or two things to look at in the headset, what is merged. No recap of steps, no "untested on a headset".
- Update `CLAUDE.md`, the README and `claude/direction.md` in the Project as things land.
