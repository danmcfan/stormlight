/**
 * Model viewer: a Three.js inspector for the GLBs in public/models.
 *
 * Loads any model, lights it like the game (so the shading you judge is the shading the
 * player sees), and lists pieces with triangle counts so a rebuild can be checked piece
 * by piece. Live-reloads when a GLB on disk changes (scripts/viewer/server.ts).
 *
 *   bun run view     ->  http://localhost:5178/
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import GUI from 'lil-gui';
import { APOSE, type Pose, poseShardplate } from './pose';

import { LOOK, PLATE_MATS, addGameLights } from './shading';

const state = {
  model: 'shardplate.glb',
  background: '#d8dde2',
  plateMaterials: true,
  wireframe: false,
  flatShading: false,
  autoRotate: false,
  showPiece: -1,
  pose: { arm: APOSE.arm, elbow: APOSE.elbow, leg: APOSE.leg },
  /** Plate pieces are stored at their joints, so they need posing; blades don't. */
  posing: true,
};

const app = document.getElementById('app') as HTMLDivElement;
const panel = document.getElementById('panel') as HTMLDivElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;

// --- Renderer, scene, camera ------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = LOOK.exposure;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(state.background);

const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
camera.position.set(2.6, 1.4, 3.4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 1.1, 0);
controls.autoRotateSpeed = 1.2;

// --- Lighting: the game's sun and sky ---------------------------------------------
addGameLights(scene);

// Neutral ground so the model has something to sit on; the game's ground is sand.
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(6, 48).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: '#c9b79a', roughness: 0.95, metalness: 0 }),
);
ground.position.y = -0.002;
scene.add(ground);

// A 1 m grid helps read the models' scale against their target sizes.
const grid = new THREE.GridHelper(6, 6, 0x8a8f96, 0xb9bec4);
grid.material.opacity = 0.35;
grid.material.transparent = true;
scene.add(grid);

// --- Loading ----------------------------------------------------------------------
const loader = new GLTFLoader();
let current: THREE.Object3D | null = null;
/** The model's own loaded materials, kept so the "game materials" toggle can restore them. */
let originalMats = new Map<THREE.Mesh, THREE.Material>();

function disposeCurrent() {
  if (!current) return;
  scene.remove(current);
  current.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat.dispose?.();
    }
  });
  current = null;
  originalMats = new Map();
}

/** Apply the game's per-name plate materials, or restore the GLB's own. */
function styleMaterials() {
  if (!current) return;
  current.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (!mat) return;
    if (!originalMats.has(mesh)) originalMats.set(mesh, mat);
    if (state.plateMaterials) {
      const spec = PLATE_MATS[mat.name];
      mesh.material = spec ? new THREE.MeshStandardMaterial({ ...spec, flatShading: state.flatShading }) : mat;
    } else {
      mesh.material = originalMats.get(mesh)!;
    }
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (m && 'wireframe' in m) m.wireframe = state.wireframe;
  });
}

/**
 * Move each piece from its joint origin into the body pose. Only the Shardplate is built
 * that way; a blade is already a single object at its grip, so posing is skipped for it.
 */
function applyPose() {
  if (!current) return;
  const names = pieceNames(current);
  const isPlate = names.some((n) => n.startsWith('pauldron_') || n === 'gorget');
  state.posing = isPlate;
  if (!isPlate) return;
  const unknown = poseShardplate(current, state.pose, names);
  if (unknown.length) console.warn('viewer: pieces not placed by pose.ts:', unknown.join(', '));
}

/**
 * The GLB names one object per piece (`helm`), but glTF splits a multi-material mesh into
 * primitives, which three.js loads as children named `helm_1`, `helm_2`. So pieces group by
 * the name with that suffix removed.
 */
function baseName(name: string): string {
  return name.replace(/_\d+$/, '');
}

function pieceNames(root: THREE.Object3D): string[] {
  const out: string[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && o.name) {
      const b = baseName(o.name);
      if (!out.includes(b)) out.push(b);
    }
  });
  return out;
}

/**
 * Frame the model, or just its visible pieces. `pad` widens the fit so the silhouette
 * never touches the edge of the canvas.
 */
function frameModel(root: THREE.Object3D, pad = 1.35, visibleOnly = false) {
  const box = new THREE.Box3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (visibleOnly) {
      let vis = true;
      for (let p: any = o; p; p = p.parent) if (!p.visible) vis = false;
      if (!vis) return;
    }
    box.expandByObject(m);
  });
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.5;
  const dist = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2)) * pad;
  controls.target.copy(centre);
  camera.position.copy(centre).add(new THREE.Vector3(0.55, 0.28, 0.78).normalize().multiplyScalar(dist));
  camera.near = Math.max(0.01, dist / 500);
  camera.far = dist * 20;
  camera.updateProjectionMatrix();
  controls.update();
}

function buildPanel(root: THREE.Object3D) {
  panel.innerHTML = '';
  const rows: { name: string; tris: number; meshes: number }[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !o.name) return;
    const g = m.geometry as THREE.BufferGeometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const name = baseName(o.name);
    const hit = rows.find((r) => r.name === name);
    if (hit) {
      hit.tris += tris;
      hit.meshes += 1;
    } else {
      rows.push({ name, tris, meshes: 1 });
    }
  });
  rows.sort((a, b) => b.tris - a.tris);
  const total = rows.reduce((s, r) => s + r.tris, 0);

  const head = document.createElement('div');
  head.className = 'row head';
  head.innerHTML = `<span>piece</span><span>${rows.length}</span><span>${Math.round(total).toLocaleString()} tris</span>`;
  panel.appendChild(head);

  rows.forEach((r, i) => {
    const el = document.createElement('button');
    el.className = 'row' + (state.showPiece === i ? ' on' : '');
    el.innerHTML = `<span>${r.name}</span><span>${r.meshes}</span><span>${Math.round(r.tris).toLocaleString()}</span>`;
    el.onclick = () => {
      state.showPiece = state.showPiece === i ? -1 : i;
      applyIsolation();
      buildPanel(root);
    };
    panel.appendChild(el);
  });
}

/** Show only the selected piece, so a rebuilt helm can be judged on its own. */
function applyIsolation() {
  if (!current) return;
  const rows = pieceNames(current);
  const keep = state.showPiece >= 0 ? rows[state.showPiece] : null;
  current.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.visible = !keep || baseName(o.name) === keep;
  });
}

async function load(model: string, { refit = true } = {}) {
  state.model = model;
  statusEl.textContent = `loading ${model}…`;
  try {
    const gltf = await loader.loadAsync(`/models/${model}?t=${Date.now()}`);
    disposeCurrent();
    current = gltf.scene;
    // glTF is Y-up already; the game's pieces sit at their modelled origins.
    scene.add(current);
    state.showPiece = -1;
    styleMaterials();
    applyPose();
    if (refit) frameModel(current);
    buildPanel(current);
    const box = new THREE.Box3().setFromObject(current);
    const s = box.getSize(new THREE.Vector3());
    statusEl.textContent = `${model} — ${s.x.toFixed(2)} × ${s.z.toFixed(2)} × ${s.y.toFixed(2)} m (x,y,z)`;
  } catch (e) {
    statusEl.textContent = `failed to load ${model}: ${(e as Error).message}`;
    console.error(e);
  }
}

// --- UI ---------------------------------------------------------------------------
const gui = new GUI({ title: 'viewer' });
gui.add(state, 'background').onChange((v) => (scene.background = new THREE.Color(v)));
gui.add(state, 'plateMaterials').name('game materials').onChange(styleMaterials);
gui.add(state, 'wireframe').onChange(styleMaterials);
gui.add(state, 'flatShading').name('flat shading').onChange(styleMaterials);
gui.add(state, 'autoRotate').name('spin').onChange((v) => (controls.autoRotate = v));
const poseFolder = gui.addFolder('pose (Plate)');
for (const [key, lo, hi] of [['arm', -10, 80], ['elbow', -120, 20], ['leg', -20, 40]] as const) {
  poseFolder
    .add(state.pose, key, lo, hi, 1)
    .name(key === 'arm' ? 'arm abduction' : key)
    .onChange(() => {
      applyPose();
      if (current) frameModel(current);
    });
}
gui.close();

const select = document.getElementById('model') as HTMLSelectElement;
fetch('/models.json')
  .then((r) => r.json())
  .then((files: string[]) => {
    select.innerHTML = files.map((f) => `<option value="${f}">${f}</option>`).join('');
    select.value = state.model;
    if (!files.includes(state.model) && files.length) state.model = files[0];
    load(state.model);
  });
select.onchange = () => load(select.value);

document.getElementById('reset')!.onclick = () => {
  state.showPiece = -1;
  if (current) applyIsolation();
  if (current) frameModel(current);
};

// --- Live reload ------------------------------------------------------------------
// The server pushes an event when a GLB changes; reload that file (or the list).
const events = new EventSource('/events');
events.addEventListener('model', (ev) => {
  const name = (ev as MessageEvent).data;
  if (name === state.model) load(name, { refit: false }); // keep the camera where it was
  else if (name) statusEl.textContent = `${name} rebuilt (reload from the list to view)`;
});
events.addEventListener('error', () => {
  statusEl.textContent = 'live reload disconnected — refresh to reconnect';
});

// --- Loop -------------------------------------------------------------------------
function resize() {
  const { clientWidth: w, clientHeight: h } = app;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// Hooks for scripts/viewer/shot.mjs (scripted screenshots).
(window as unknown as { __viewer: unknown }).__viewer = {
  camera,
  controls,
  scene,
  isolate(name: string) {
    current?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.visible = baseName(o.name) === name;
    });
  },
  frameAll() {
    if (current) frameModel(current, 1);
  },
  /** Frame only the pieces that are currently visible. */
  frameVisible() {
    if (current) frameModel(current, 1, true);
  },
};
