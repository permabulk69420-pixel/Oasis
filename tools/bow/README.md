# Bow, arrow and quiver

Made for Oasis by a separate model (OpenAI Codex) from the owner's brief, 7 Oct, in headless Blender: `build_bow.py`, `build_arrow.py`,
`build_quiver.py` (each self-contained, Blender 4.5), checked by `check_assets.py`. Their report is `report.md`, the measurements
`verification.json`, the overview `preview_overview.png`.

The game's copies are `public/models/bow/{bow,arrow,quiver}.glb` (+Y up, -Z forward, embedded 1K PBR atlases).
`src/bow.js` loads the bow as a normal tool; `src/archery.js` handles the shoulder quiver, nocking, draw morph and runtime string, arrow flight and hits.

- bow.glb: 5,370 triangles. Origin = the grip. Morph target `Draw` (0 rest, 1 full draw: tips 0.12 m back, 0.05 m in). No string mesh (the
  game draws it). Markers: grip, arrow_rest, string_top, string_bottom, string_top_drawn, string_bottom_drawn, nock_rest (the string side is +Z).
- arrow.glb: 320 triangles, 0.75 m. Origin = the nock; markers nock, tip (0, 0, -0.75).
- quiver.glb: 2,696 triangles, with five decorative arrows merged in. Origin = its upper back mounting point; marker opening.
