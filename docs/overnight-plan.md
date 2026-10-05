# Overnight plan (Kane, 5 Oct 2026, written together before he leaves)

This is the rulebook for the unattended run. It only applies once Kane says "go" and leaves. If anything here conflicts with a guess of mine, this wins.

## The two jobs, in order
1. **Colossus 01 (the big one).** Kane's other tool built it; he sends the `.glb` (about 40 MB). Steps:
   - Check it against `tools/colossus/BRIEF.md` (`tools/creature/check_glb.py` style): bone names, scale (about 55 m), symmetry, closed solids, skinning, UVs, three levels of detail. Render every side and look at the cyan hand-holds (are they big enough to grip?). Report anything wrong; do not "fix" it silently.
   - Put it in the game like the stinger: model in `public/models/`, driven from code (no animation in the file). A procedural walk that feels huge and alive: slow, heavy footfalls, weight shift, breathing, a head that looks about, legs solved onto the ground (the stinger's two-bone solver is the pattern), dust where feet land (`src/sand-puffs.js`), footprints. Passive: it does not attack and nothing here is a fight.
   - VR scale (a creature you look up at) is the thing to protect. Check it from the ground, from 50 m and from 300 m, day and night.
   - Where it lives: the flat gravel plain north of the oasis (`AREA.flats`).
2. **The sky island as a place (set dressing).** Make it feel like a real, cool little home that fits the oasis art style: dark, moody twilight, glow carrying the scene. Ideas Kane has agreed to: a small pond up there (not rivers; a waterfall that thins to mist before the ground is allowed), rocks and boulders, plants and glow plants in the oasis style, landmarks, small details. Palms already exist. Keep the start meadow open. Lean on bioluminescence; do not brighten the night.

## Rules (all standing rules still apply)
- Merge what is verified on my own judgement (models too, tonight); mesh-check and look at renders first.
- **Art, animation, atmosphere only.** No new mechanics, no new numbers for play, no plot.
- Not mine to decide: how a colossus is beaten, how the climb works, the glider's feel, what dying means, water or stamina pressure, how you get down to or back up to the island, drinking up there, foundation building, the day/night timing (5 and 5, leave it).
- No sub-agents. Nothing that costs money, no accounts, no keys. Nothing outside the project, the scratchpad or its temp folder (an unattended permission prompt stalls the whole night).
- No sand yacht, no glider (Kane's other model is still coming; check it when it arrives under the normal model rules).
- Quest budget: be bold with triangles (colossus up to 500k / 150k / 30k per the brief), keep draw calls sensible, no post-processing, no per-frame allocations.
- New models get proper UVs at a steady texel density; textures stay 1k.

## Habits
- **Run the smoke test locally before merging anything that touches the start, the world or the scene** (`python3 tools/smoke/smoke_test.py --url http://localhost:5173`, system `/usr/bin/python3`, about 3 minutes, do not edit source while it runs). The island start once broke it and cost a 7 minute failed deploy.
- Confirm each Pages deploy goes green; if one fails, fix it first.
- Task list for every step; keep the time with `TZ=Australia/Sydney date`.
- Questions he would want: fire them off at once (he closes the app after his last message), then decide myself.
- Final report short: what changed, one or two things to look at in the headset, what is merged. No recap of steps, no "untested on a headset".
- Update `CLAUDE.md`, the README and `claude/direction.md` in the Project as things land.
