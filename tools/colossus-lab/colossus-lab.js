import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { installNightFill, nightFill } from '../../src/night-fill.js';
import { exposureGlow } from '../../src/glow.js';

// A scratch page that stands Colossus 01 up in a plain gravel yard, lit roughly like the game, so the model can be judged from every side
// without walking out to it. npm run dev, then open /tools/colossus-lab/colossus-lab.html?cam=tq (see lab_shot.py).
//
//   lod     0 | 1 | 2 (default 0; 1 and 2 are the stopgap files)
//   cam     tq | front | side | back | top | under | head | foot | routes | belly | knee | crest | custom (cx,cy,cz + tx,ty,tz)
//   night   1 for the night light and glow
//   person  1 adds a 1.7 m figure; person=x,z places it (default beside the front left foot)
//   pose    bone:axis:degrees list, turned in world space about each bone's own pivot, e.g. pose=leg_FL_upper:x:25,neck_03:y:10
//   fov     field of view in degrees; w, h  canvas size
//   bind    0 leaves the bones where the file's nodes put them (default 1 resets to the bind pose, which is what the game does)
//   glow    day,night displayed brightness of the crystals (default 0.55,0.5)

const params = new URLSearchParams(location.search);
const night = params.get('night') === '1';
const lod = Number(params.get('lod') ?? 0);
const camMode = params.get('cam') || 'tq';
const BASE = import.meta.env?.BASE_URL ?? '/';
const FILES = { 0: 'colossus_01_lod0.glb', 1: 'colossus_01_lod1_stopgap.glb', 2: 'colossus_01_lod2_stopgap.glb' };

installNightFill();
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(Number(params.get('w') ?? 1500), Number(params.get('h') ?? 850));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = night ? 0.035 : 0.7;
document.body.appendChild(renderer.domElement);
nightFill.value = night ? 1 : 0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(night ? 0x02040a : 0x7d98a2);
scene.fog = night ? null : new THREE.Fog(0x7d98a2, 400, 1800);
// a low golden sun like the game's, from the creature's front left
const sun = new THREE.DirectionalLight(0xffd7a0, night ? 0.0 : 3.4);
sun.position.set(90, 38, 70);
scene.add(sun, new THREE.HemisphereLight(0xa9c4cc, 0x8a6a48, night ? 0.0 : 1.0));
if (night) scene.add(new THREE.DirectionalLight(0x6f8cff, 8), new THREE.HemisphereLight(0x4a68c8, 0x101820, 4));

const grid = document.createElement('canvas');
grid.width = grid.height = 256;
{
  const g = grid.getContext('2d');
  g.fillStyle = night ? '#1a1510' : '#b8946a';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = night ? '#221b14' : '#c4a074';
  g.fillRect(0, 0, 128, 128);
  g.fillRect(128, 128, 128, 128);
}
const gridTex = new THREE.CanvasTexture(grid);
gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping;
gridTex.colorSpace = THREE.SRGBColorSpace;
gridTex.repeat.set(60, 60); // each light/dark square is 10 m
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: gridTex, roughness: 1 }));
scene.add(ground);

function personFigure() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xe8541c, roughness: 0.8, emissive: night ? 0x331000 : 0x000000 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.62, 12), mat);
  body.position.y = 1.1;
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.1, 0.8, 12), mat);
  legs.position.y = 0.4;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), mat);
  head.position.y = 1.58;
  const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8), mat);
  armL.position.set(0.28, 1.1, 0);
  const armR = armL.clone();
  armR.position.x = -0.28;
  g.add(body, legs, head, armL, armR);
  return g;
}

const glowDay = params.has('glow') ? Number(params.get('glow').split(',')[0]) : 0.55;
const glowNight = params.has('glow') ? Number(params.get('glow').split(',')[1]) : 0.5;
const glowMaterials = [];

new GLTFLoader().loadAsync(`${BASE}models/colossus/${FILES[lod]}`).then(gltf => {
  const root = gltf.scene;
  const bones = {};
  root.traverse(object => {
    if (object.isBone) bones[object.name] = object;
    if (!object.isMesh) return;
    object.frustumCulled = false;
    const mat = object.material;
    if (mat?.name === 'Colossus crystal' || mat?.name === 'Colossus glow') {
      if (!glowMaterials.includes(mat)) glowMaterials.push(mat);
    }
    if (mat?.name === 'Colossus crystal' && !mat.userData.tinted) {
      mat.userData.tinted = true;
      // glTF vertex colour only touches the base colour, so violet crystals would still glow cyan: take the hue of the emissive from it
      mat.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', `vec3 totalEmissiveRadiance = emissive;
#ifdef USE_COLOR
          vec3 hue = vColor.rgb / max(max(vColor.r, max(vColor.g, vColor.b)), 0.001);
          float lumE = dot(emissive, vec3(0.2126, 0.7152, 0.0722));
          totalEmissiveRadiance = hue * min(lumE / max(dot(hue, vec3(0.2126, 0.7152, 0.0722)), 0.2), lumE * 5.0);
#endif`);
      };
    }
  });
  scene.add(root);
  root.updateMatrixWorld(true);
  if (params.get('bind') !== '0') root.traverse(o => { if (o.isSkinnedMesh) o.skeleton.pose(); });
  root.updateMatrixWorld(true);
  // optional pose: world-space turns about each bone's own pivot
  if (params.has('pose')) {
    const axes = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
    for (const spec of params.get('pose').split(',')) {
      const [name, axis, deg] = spec.split(':');
      const bone = bones[name];
      if (!bone) { console.error('no bone ' + name); continue; }
      const qd = new THREE.Quaternion().setFromAxisAngle(axes[axis], THREE.MathUtils.degToRad(Number(deg)));
      const pq = new THREE.Quaternion();
      const bq = new THREE.Quaternion();
      bone.parent.getWorldQuaternion(pq);
      bone.getWorldQuaternion(bq);
      bone.quaternion.copy(pq.invert().multiply(qd.multiply(bq)));
      root.updateMatrixWorld(true);
    }
  }
  window.__bones = bones;

  const personAt = params.has('person') && params.get('person') !== '1' ? params.get('person').split(',').map(Number) : [16.2, 24.5];
  if (params.has('person') && params.get('person') !== '0') {
    const p = personFigure();
    p.position.set(personAt[0], 0, personAt[1]);
    scene.add(p);
  }

  const camera = new THREE.PerspectiveCamera(Number(params.get('fov') ?? 32), renderer.domElement.width / renderer.domElement.height, 0.1, 6000);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const views = {
    tq: [V(170, 52, 190), V(0, 26, 6), 32],
    front: [V(0, 20, 260), V(0, 27, 0), 32],
    side: [V(270, 28, 0), V(0, 27, 0), 32],
    back: [V(0, 30, -250), V(0, 27, 0), 32],
    top: [V(0, 420, 1), V(0, 0, 0), 28],
    under: [V(0, 1.7, -6), V(0, 30, 10), 85],
    head: [V(38, 33, 100), V(0, 28, 62), 34],
    foot: [V(27, 2.2, 38), V(11, 4.5, 21), 55],
    routes: [V(60, 95, -115), V(0, 44, 5), 38],
    belly: [V(0, 1.7, 40), V(0, 33, -10), 80],
    knee: [V(40, 20, 50), V(10, 23, 17), 45],
    crest: [V(30, 75, 90), V(0, 40, 40), 38],
  };
  let [pos, target, fov] = views[camMode] ?? views.tq;
  if (camMode === 'custom') {
    pos = V(Number(params.get('cx')), Number(params.get('cy')), Number(params.get('cz')));
    target = V(Number(params.get('tx')), Number(params.get('ty')), Number(params.get('tz')));
  }
  camera.fov = params.has('fov') ? Number(params.get('fov')) : fov;
  camera.updateProjectionMatrix();
  camera.position.copy(pos);
  camera.lookAt(target);
  const exposure = renderer.toneMappingExposure;
  let tick = 0;
  function frame() {
    for (const mat of glowMaterials) mat.emissiveIntensity = exposureGlow(exposure, { day: glowDay, night: glowNight }) * (mat.name === 'Colossus glow' ? 1 : 1.25);
    renderer.render(scene, camera);
    if (++tick === 4) window.__ready = true;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}).catch(error => { document.title = 'ERROR ' + error.message; console.error(error); window.__ready = true; });
