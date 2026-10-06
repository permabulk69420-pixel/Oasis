---
name: perf-triangles
description: Use to find where the triangles and draw calls go in a scene (a performance check for Quest), or to compare before and after a model change.
---

# Where the triangles go

A project skill, loaded only when the job needs it. The owner's standing rules are kept outside this public repo.

- Where the triangles go: with the same temporary `window.__oasis` hook (just `scene, camera, renderer, THREE`), walk `scene.traverseVisible`,
  keep the meshes whose bounding sphere meets the camera frustum, add each one's draw-range index count / 3 (times `count` for an
  InstancedMesh) and group by the first three names up the parents. It agrees with `renderer.info` to within 1%.

Quest performance comes first (a standing rule): no post-processing, no big shadow maps, no per-frame allocations. Desktop SwiftShader counts say what is drawn, not how fast a Quest draws it.
