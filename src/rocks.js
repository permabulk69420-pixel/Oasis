import * as THREE from 'three';

const ROCK_TEXTURE = `${import.meta.env.BASE_URL}textures/rocks/pickup-rock/rock1.png`;
const TOTAL_ROCKS = 128;
const DRAW_DISTANCE = 150;

function makeRockGeometry() {
  // 320 triangles: intentionally small enough that a separate LOD is not useful yet.
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const position = geometry.getAttribute('position');

  for (let i = 0; i < position.count; i++) {
    const ox = position.getX(i);
    const oy = position.getY(i);
    const oz = position.getZ(i);
    const warp = 1
      + 0.085 * Math.sin(2.7 * ox + 1.1 * oz)
      + 0.055 * Math.sin(4.3 * oz - 0.8 * oy)
      + 0.035 * Math.sin(5.1 * ox + 2.2 * oy);

    let x = ox * warp * 0.110;
    let y = oy * warp * 0.070;
    let z = oz * warp * 0.090;

    // Broader at the bottom, slightly tighter at the crown, and asymmetrical enough
    // that repeated instances do not immediately read as spheres.
    const height01 = THREE.MathUtils.clamp((oy + 1) * 0.5, 0, 1);
    const lowerBulge = 1.08 - 0.15 * height01;
    x *= lowerBulge;
    z *= lowerBulge;
    x += 0.012 * (y / 0.070);
    z += 0.005 * Math.sin((y / 0.070) * 2.5);

    // Flatten only the lowest part so instances sit naturally on the terrain.
    y = Math.max(y, -0.055) + 0.055;
    position.setXYZ(i, x, y, z);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = 'Pickup desert rock — 320 triangles';
  return geometry;
}

function seededRandom(seed = 0x51a3d9) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makePlacements(field) {
  const random = seededRandom();
  const placements = [];

  function add(x, z) {
    const baseScale = 0.72 + random() * 0.62;
    placements.push({
      x,
      y: field.sample(x, z) - (0.008 + random() * 0.018),
      z,
      rx: (random() - 0.5) * 0.16,
      ry: random() * Math.PI * 2,
      rz: (random() - 0.5) * 0.16,
      sx: baseScale * (0.86 + random() * 0.26),
      sy: baseScale * (0.88 + random() * 0.22),
      sz: baseScale * (0.86 + random() * 0.26),
    });
  }

  // A handful near spawn guarantees the material can actually be inspected without
  // turning the opening area into a rock garden.
  for (let i = 0; i < 14; i++) {
    const angle = random() * Math.PI * 2;
    const radius = 7 + Math.sqrt(random()) * 42;
    add(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }

  // The rest are genuinely sparse across the kilometre-square desert.
  while (placements.length < TOTAL_ROCKS) {
    const x = (random() * 2 - 1) * 480;
    const z = (random() * 2 - 1) * 480;
    if (Math.hypot(x, z) < 55) continue;
    add(x, z);
  }

  return placements;
}

export function createPickupRocks({ field, renderer = null }) {
  const geometry = makeRockGeometry();
  const material = new THREE.MeshStandardMaterial({
    color: 0x745f4b,
    roughness: 0.92,
    metalness: 0,
  });
  material.name = 'Pickup rock — rock1';

  new THREE.TextureLoader().load(
    ROCK_TEXTURE,
    texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      if (renderer) texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      material.map = texture;
      material.color.set(0xffffff);
      material.needsUpdate = true;
    },
    undefined,
    () => console.warn('[Oasis rocks] rock1.png could not be loaded; using the fallback rock colour.'),
  );

  const placements = makePlacements(field);
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  mesh.name = `Pickup rocks — ${placements.length} sparse instances`;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const dummy = new THREE.Object3D();
  const maxDistanceSq = DRAW_DISTANCE * DRAW_DISTANCE;

  function update(playerX, playerZ) {
    let visible = 0;
    for (const rock of placements) {
      const dx = rock.x - playerX;
      const dz = rock.z - playerZ;
      if (dx * dx + dz * dz > maxDistanceSq) continue;

      dummy.position.set(rock.x, rock.y, rock.z);
      dummy.rotation.set(rock.rx, rock.ry, rock.rz);
      dummy.scale.set(rock.sx, rock.sy, rock.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(visible++, dummy.matrix);
    }
    mesh.count = visible;
    mesh.instanceMatrix.needsUpdate = true;
    return visible;
  }

  update(0, 0);
  return { mesh, update, total: placements.length, drawDistance: DRAW_DISTANCE };
}
