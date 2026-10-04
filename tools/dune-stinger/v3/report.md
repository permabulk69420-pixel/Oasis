# Dune Stinger v3 — measured export report

| LOD | Triangles | Bytes | Bones | Closed shells | Dimensions X / Y / Z (m) | Failures |
|---|---:|---:|---:|---:|---|---|
| 0 | 33,088 | 1,456,032 | 55 | 266 | 1.240 / 1.551 / 1.909 | none |
| 1 | 10,988 | 520,036 | 55 | 147 | 1.240 / 1.520 / 1.880 | none |
| 2 | 1,992 | 152,072 | 55 | 53 | 1.239 / 1.516 / 1.874 | none |

Identical names, hierarchy and joint positions across levels: **True**.

Checked on the exported files: every shell closed and outward wound, no coplanar overlaps, at most four weights per vertex summing to 1, identity joint frames, bind matrices, +Z forward / +Y up / left = +X, lowest vertex at y = 0, one mesh, one skin, two materials (Stinger with vertex colour, Glow without), no animation, UVs or textures.
