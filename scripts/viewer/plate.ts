/**
 * Shardplate preview: the Plate in the game's shading, with the construction references
 * beside it.
 *
 * Each sidebar card puts a reference view next to a live render of the current model from
 * the same side, at the same scale and framing (an orthographic camera fitted to the
 * reference figure's bounds), so the two can be compared, or overlaid in the lightbox.
 * Focusing a piece ghosts the rest, crops every card to that piece, shows its target sizes
 * from docs/models/shardplate.md and pulls its part sheet to the top. Everything re-renders
 * when a build rewrites the GLB (scripts/viewer/server.ts pushes the reload).
 *
 *   bun run view     ->  http://localhost:5178/plate.html
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { APOSE, REST, type Pose, poseShardplate } from './pose';
import { LOOK, PLATE_MATS, addGameLights } from './shading';

const MODEL = 'shardplate.glb';

/** The pose scripts/blender/compare_reference.py renders the comparisons in. */
const COMPARE_POSE: Pose = { arm: 45, elbow: -37, leg: 5 };
const POSES: Record<string, Pose> = { compare: COMPARE_POSE, apose: APOSE, rest: REST };

type Side = 'front' | 'left' | 'back';

/**
 * The reference views, as compare_reference.py defines them: the sheet, the crop of it
 * (x0, x1 in sheet pixels), the side the camera looks from, and how the model is scaled.
 * 'h' fits the model's height to the drawn figure's; the helm sheet has a fixed scale
 * (its widest point, 346 px, is 0.31 m) and a deeper mantle than the model, so it is
 * top-aligned at that scale instead.
 */
const VIEWS: {
  key: string;
  label: string;
  sheet: string;
  crop: [number, number] | null;
  side: Side;
  pieces: 'plate' | 'helm';
}[] = [
  { key: 'plate-front', label: 'Front', sheet: 'shardplate-front', crop: null, side: 'front', pieces: 'plate' },
  { key: 'plate-side', label: 'Side', sheet: 'shardplate-side-back', crop: [0, 690], side: 'left', pieces: 'plate' },
  { key: 'plate-back', label: 'Back', sheet: 'shardplate-side-back', crop: [690, 1376], side: 'back', pieces: 'plate' },
  { key: 'helm-front', label: 'Helm front', sheet: 'shardplate-helm', crop: [0, 512], side: 'front', pieces: 'helm' },
  { key: 'helm-side', label: 'Helm side', sheet: 'shardplate-helm', crop: [512, 1024], side: 'left', pieces: 'helm' },
];
const HELM_PX_PER_M = 346 / 0.31;
const HELM_PIECES = ['helm', 'helm_crest', 'gorget'];

const sheetUrl = (name: string) => `/art/source/${name}/nb21-v1/${name}.jpg`;

/**
 * Pieces grouped the way you'd iterate on them: left and right as one, the helm with its
 * crest. `rows` are the rows of the target-size table in docs/models/shardplate.md;
 * `parts` the part sheets (art/source/<name>) that draw it close up.
 */
const GROUPS: { key: string; label: string; match: (n: string) => boolean; rows: string[]; parts: string[] }[] = [
  { key: 'helm', label: 'Helm', match: (n) => n === 'helm' || n === 'helm_crest', rows: ['Helm'], parts: ['shardplate-helm', 'plate-helm-34'] },
  { key: 'gorget', label: 'Collar', match: (n) => n === 'gorget', rows: ['Collar'], parts: ['shardplate-helm', 'shardplate-34'] },
  { key: 'breastplate', label: 'Breastplate', match: (n) => n === 'breastplate', rows: ['Breastplate', 'Gem'], parts: ['shardplate-34'] },
  { key: 'abdomen', label: 'Abdomen', match: (n) => n === 'abdomen', rows: ['Breastplate'], parts: ['shardplate-34', 'plate-waist'] },
  { key: 'belt', label: 'Belt', match: (n) => n === 'belt', rows: ['Belt'], parts: ['plate-waist'] },
  { key: 'fauld', label: 'Fauld', match: (n) => n.startsWith('fauld_'), rows: ['Fauld'], parts: ['plate-waist'] },
  { key: 'tasset', label: 'Tassets', match: (n) => n.startsWith('tasset_'), rows: ['Tasset'], parts: ['plate-waist'] },
  { key: 'pauldron', label: 'Pauldrons', match: (n) => n.startsWith('pauldron_'), rows: ['Pauldron'], parts: ['plate-pauldron'] },
  { key: 'upperarm', label: 'Upper arms', match: (n) => n.startsWith('upperarm_'), rows: ['Elbow'], parts: ['plate-pauldron', 'plate-gauntlet'] },
  { key: 'forearm', label: 'Vambraces', match: (n) => n.startsWith('forearm_'), rows: ['Vambrace', 'Elbow'], parts: ['plate-gauntlet'] },
  { key: 'gauntlet', label: 'Gauntlets', match: (n) => n.startsWith('gauntlet_'), rows: ['Gauntlet'], parts: ['plate-gauntlet'] },
  { key: 'thigh', label: 'Thighs', match: (n) => n.startsWith('thigh_'), rows: ['Knee cop'], parts: ['plate-leg'] },
  { key: 'shin', label: 'Shins', match: (n) => n.startsWith('shin_'), rows: ['Knee cop', 'Greave'], parts: ['plate-leg'] },
  { key: 'boot', label: 'Sabatons', match: (n) => n.startsWith('boot_'), rows: ['Sabaton'], parts: ['plate-leg'] },
];

const PART_SHEETS: { name: string; label: string }[] = [
  { name: 'shardplate-front', label: 'Front' },
  { name: 'shardplate-side-back', label: 'Side / back' },
  { name: 'shardplate-34', label: 'Three-quarter' },
  { name: 'shardplate-helm', label: 'Helm and collar' },
  { name: 'plate-helm-34', label: 'Helm ¾' },
  { name: 'plate-pauldron', label: 'Pauldron' },
  { name: 'plate-gauntlet', label: 'Gauntlet' },
  { name: 'plate-waist', label: 'Waist: belt, fauld, tassets' },
  { name: 'plate-leg', label: 'Leg' },
];

/** Third-party art in art/references (see its README); inspiration only. */
const INSPIRATION = [
  'plate-and-blades-fan-sheet.webp',
  'plate-gem-belt-blue.webp',
  'plate-blue-glow-warcamp.png',
  'plate-helm-underarm-summon-mist.webp',
  'plate-leap-glowing-seams.png',
  'plate-dark-blade-on-shoulder.webp',
];

const state = {
  pose: 'compare',
  focus: null as string | null,
  focusMode: 'ghost' as 'ghost' | 'hide' | 'show',
  ortho: false,
  view: 'three' as Side | 'three',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $<HTMLDivElement>('app');
const statusEl = $<HTMLSpanElement>('status');
const focusTag = $<HTMLDivElement>('focusTag');

// --- Main view ------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = LOOK.exposure;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.prepend(renderer.domElement);

const scene = new THREE.Scene();
const BG = new THREE.Color('#d8dde2');
scene.background = BG;
addGameLights(scene);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(4, 48).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: '#c9b79a', roughness: 0.95, metalness: 0 }),
);
ground.position.y = -0.002;
scene.add(ground);
const grid = new THREE.GridHelper(4, 8, 0x8a8f96, 0xb9bec4);
(grid.material as THREE.Material).opacity = 0.35;
(grid.material as THREE.Material).transparent = true;
scene.add(grid);

const persp = new THREE.PerspectiveCamera(32, 1, 0.02, 100);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = persp;
const controls = new OrbitControls(persp, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotateSpeed = 1.5;

// --- Model ----------------------------------------------------------------------------
const loader = new GLTFLoader();
let model: THREE.Object3D | null = null;
/** Game material per mesh, and the ghost that stands in for unfocused pieces. */
const gameMat = new Map<THREE.Mesh, THREE.Material>();
const ghost = new THREE.MeshStandardMaterial({
  color: '#a6aeb7',
  transparent: true,
  opacity: 0.14,
  depthWrite: false,
  roughness: 0.6,
});

const baseName = (name: string) => name.replace(/_\d+$/, '');

function meshes(): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  model?.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

/** The named piece a mesh belongs to (glTF splits multi-material pieces into children). */
function pieceOf(m: THREE.Mesh): string {
  let o: THREE.Object3D | null = m;
  while (o && o.parent && o.parent !== model) o = o.parent;
  return baseName(o?.name || m.name);
}

const groupOf = (key: string | null) => GROUPS.find((g) => g.key === key) ?? null;

function applyMaterials() {
  const g = groupOf(state.focus);
  for (const m of meshes()) {
    const inFocus = !g || g.match(pieceOf(m));
    m.visible = inFocus || state.focusMode !== 'hide';
    m.material = inFocus || state.focusMode === 'show' ? gameMat.get(m)! : ghost;
    m.renderOrder = inFocus ? 0 : 1;
  }
}

function applyPose() {
  if (!model) return;
  const names = [...new Set(meshes().map(pieceOf))];
  const unknown = poseShardplate(model, POSES[state.pose], names);
  if (unknown.length) console.warn('plate: pieces not placed by pose.ts:', unknown.join(', '));
  model.updateMatrixWorld(true);
}

async function load({ refit = true } = {}) {
  statusEl.textContent = `loading ${MODEL}…`;
  try {
    const gltf = await loader.loadAsync(`/models/${MODEL}?t=${Date.now()}`);
    if (model) {
      scene.remove(model);
      for (const m of meshes()) m.geometry.dispose();
    }
    model = gltf.scene;
    gameMat.clear();
    for (const m of meshes()) {
      const own = m.material as THREE.MeshStandardMaterial;
      const spec = PLATE_MATS[own.name];
      gameMat.set(m, spec ? new THREE.MeshStandardMaterial(spec) : own);
    }
    scene.add(model);
    applyPose();
    applyMaterials();
    buildPieceList();
    if (refit) frameMain();
    const tris = meshes().reduce((s, m) => s + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0);
    statusEl.textContent = `${MODEL} · ${Math.round(tris).toLocaleString()} tris · loaded ${new Date().toLocaleTimeString()}`;
    renderCards();
  } catch (e) {
    statusEl.textContent = `failed to load ${MODEL}: ${(e as Error).message}`;
    console.error(e);
  }
}

/** World bounds of the given meshes' vertices (exact, not the rotated boxes' hull). */
function boundsOf(list: THREE.Mesh[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const m of list) box.union(new THREE.Box3().setFromObject(m, true));
  return box;
}

function focusMeshes(): THREE.Mesh[] {
  const g = groupOf(state.focus);
  if (!g) return meshes();
  // A left/right pair frames on the character's left piece; the right one mirrors it.
  const hits = meshes().filter((m) => g.match(pieceOf(m)));
  const left = hits.filter((m) => pieceOf(m).endsWith('_l'));
  return left.length ? left : hits;
}

const VIEW_DIRS: Record<Side | 'three', THREE.Vector3> = {
  front: new THREE.Vector3(0, 0, 1),
  left: new THREE.Vector3(1, 0, 0),
  back: new THREE.Vector3(0, 0, -1),
  three: new THREE.Vector3(0.62, 0.22, 0.75).normalize(),
};

function frameMain() {
  if (!model) return;
  const box = boundsOf(focusMeshes());
  if (box.isEmpty()) return;
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = size.length() / 2;
  const dir = VIEW_DIRS[state.view];
  const dist = (radius / Math.sin(THREE.MathUtils.degToRad(persp.fov) / 2)) * 1.05;
  camera.position.copy(centre).addScaledVector(dir, dist);
  controls.target.copy(centre);
  if (camera === ortho) {
    ortho.userData.half = radius * 1.1;
    ortho.near = 0.01;
    ortho.far = dist * 4;
  } else {
    persp.near = Math.max(0.01, dist / 200);
    persp.far = dist * 20;
  }
  resize();
  controls.update();
}

function setCamera(useOrtho: boolean) {
  state.ortho = useOrtho;
  const next = useOrtho ? ortho : persp;
  next.position.copy(camera.position);
  next.quaternion.copy(camera.quaternion);
  camera = next;
  controls.object = camera;
  frameMain();
}

// --- Piece list -----------------------------------------------------------------------
function buildPieceList() {
  const nav = $<HTMLElement>('pieces');
  const counts = new Map<string, number>();
  for (const m of meshes()) {
    const g = GROUPS.find((gr) => gr.match(pieceOf(m)));
    if (!g) continue;
    const t = (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
    counts.set(g.key, (counts.get(g.key) ?? 0) + t);
  }
  nav.innerHTML = '<h2>Focus a piece</h2>';
  const all = document.createElement('button');
  all.className = 'piece' + (state.focus ? '' : ' on');
  all.innerHTML = '<span>Whole Plate</span><span></span>';
  all.onclick = () => setFocus(null);
  nav.appendChild(all);
  for (const g of GROUPS) {
    if (!counts.has(g.key)) continue;
    const b = document.createElement('button');
    b.className = 'piece' + (state.focus === g.key ? ' on' : '');
    const k = counts.get(g.key)!;
    b.innerHTML = `<span>${g.label}</span><span>${k >= 1000 ? `${(k / 1000).toFixed(1)}k` : Math.round(k)}</span>`;
    b.title = `${Math.round(k).toLocaleString()} triangles`;
    b.onclick = () => setFocus(state.focus === g.key ? null : g.key);
    nav.appendChild(b);
  }
}

function setFocus(key: string | null) {
  state.focus = key;
  const url = new URL(location.href);
  if (key) url.searchParams.set('piece', key);
  else url.searchParams.delete('piece');
  history.replaceState(null, '', url);
  applyMaterials();
  buildPieceList();
  frameMain();
  showTargets();
  buildParts();
  renderCards();
}

// --- Target sizes (docs/models/shardplate.md) ------------------------------------------
let targets: { piece: string; front: string; side: string }[] = [];

async function loadTargets() {
  try {
    const md = await (await fetch('/docs/models/shardplate.md')).text();
    targets = md
      .split('\n')
      .filter((l) => l.startsWith('| ') && !l.startsWith('| Piece') && !l.startsWith('|--'))
      .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
      .filter((c) => c.length >= 3)
      .map(([piece, front, side]) => ({ piece, front, side }));
  } catch {
    targets = [];
  }
  showTargets();
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

function showTargets() {
  const g = groupOf(state.focus);
  if (!g) {
    focusTag.style.display = 'none';
    return;
  }
  const rows = targets.filter((t) => g.rows.some((r) => t.piece.startsWith(r)));
  focusTag.style.display = 'block';
  focusTag.innerHTML =
    `<b>${g.label}</b> <span style="color:var(--muted)">target sizes, m (docs/models/shardplate.md)</span>` +
    (rows.length
      ? `<table>${rows
          .map(
            (r) =>
              `<tr><td>${esc(r.piece)}</td><td>${esc(r.front)}${r.side && r.side !== '–' ? `<br><i>side/back:</i> ${esc(r.side)}` : ''}</td></tr>`,
          )
          .join('')}</table>`
      : '<div>no row in the table</div>');
}

// --- Reference cards ------------------------------------------------------------------
/** Offscreen renderer for the cards, so they don't disturb the main view. */
const snap = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
snap.toneMapping = THREE.ACESFilmicToneMapping;
snap.toneMappingExposure = LOOK.exposure;
snap.outputColorSpace = THREE.SRGBColorSpace;
const snapCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
/**
 * The drawings are flat-lit, and the game sun leaves the side and back views in shadow;
 * a fill from the card's camera, on only while a card renders, keeps them readable.
 */
const cardFill = new THREE.DirectionalLight('#ffffff', 0);
scene.add(cardFill);

type RefInfo = { img: HTMLImageElement; sx: number; sw: number; sh: number; bg: string; fig: [number, number, number, number] };
const refCache = new Map<string, Promise<RefInfo>>();

/**
 * Load a view's reference crop and find the drawn figure's bounds in it (pixels that
 * differ from the flat background, sampled at the corners).
 */
function refInfo(v: (typeof VIEWS)[number]): Promise<RefInfo> {
  const key = v.key;
  if (!refCache.has(key)) {
    refCache.set(
      key,
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const [sx, ex] = v.crop ?? [0, img.naturalWidth];
          const sw = ex - sx;
          const sh = img.naturalHeight;
          const c = document.createElement('canvas');
          c.width = sw;
          c.height = sh;
          const ctx = c.getContext('2d', { willReadFrequently: true })!;
          ctx.drawImage(img, sx, 0, sw, sh, 0, 0, sw, sh);
          const d = ctx.getImageData(0, 0, sw, sh).data;
          const px = (x: number, y: number) => [d[(y * sw + x) * 4], d[(y * sw + x) * 4 + 1], d[(y * sw + x) * 4 + 2]];
          const corners = [px(4, 4), px(sw - 5, 4), px(4, sh - 5), px(sw - 5, sh - 5)];
          const bg = [0, 1, 2].map((i) => corners.reduce((s, p) => s + p[i], 0) / 4);
          const rowHits = new Array(sh).fill(0);
          const colHits = new Array(sw).fill(0);
          for (let y = 0; y < sh; y++)
            for (let x = 0; x < sw; x++) {
              const i = (y * sw + x) * 4;
              const diff = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
              if (diff > 45) {
                rowHits[y]++;
                colHits[x]++;
              }
            }
          const first = (a: number[]) => a.findIndex((n) => n > 2);
          const last = (a: number[]) => a.length - 1 - [...a].reverse().findIndex((n) => n > 2);
          resolve({
            img,
            sx,
            sw,
            sh,
            bg: `rgb(${bg.map(Math.round).join(',')})`,
            fig: [first(colHits), first(rowHits), last(colHits), last(rowHits)],
          });
        };
        img.onerror = reject;
        img.src = sheetUrl(v.sheet);
      }),
    );
  }
  return refCache.get(key)!;
}

/** Camera-plane axes for a side: u to the image right, v up. */
function axes(side: Side) {
  const back = VIEW_DIRS[side];
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up, back).normalize();
  return { back, up, right };
}

/** Project a box's corners onto the camera plane: [umin, vmin, umax, vmax]. */
function planeBounds(box: THREE.Box3, right: THREE.Vector3): [number, number, number, number] {
  let u0 = Infinity, u1 = -Infinity;
  for (const x of [box.min.x, box.max.x])
    for (const z of [box.min.z, box.max.z]) {
      const u = x * right.x + z * right.z;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
    }
  return [u0, box.min.y, u1, box.max.y];
}

type Shot = {
  view: (typeof VIEWS)[number];
  ref: RefInfo;
  model: HTMLCanvasElement;
  /** The focused piece's region in crop pixels, or null for the whole view. */
  roi: [number, number, number, number] | null;
};
const shots = new Map<string, Shot>();

/**
 * Render the model from a view's side, framed so its pixels line up with the reference
 * crop: same canvas size, same pixels per metre, the figure in the same place.
 */
async function shoot(v: (typeof VIEWS)[number]): Promise<Shot | null> {
  if (!model) return null;
  const ref = await refInfo(v);
  const { back, up, right } = axes(v.side);
  const all = meshes();
  const shown = v.pieces === 'helm' ? all.filter((m) => HELM_PIECES.includes(pieceOf(m))) : all;
  const [u0, v0, u1, v1] = planeBounds(boundsOf(shown), right);
  const [fx0, fy0, fx1, fy1] = ref.fig;

  let s: number; // pixels per metre
  let vTop: number; // world v at crop pixel row 0
  if (v.pieces === 'helm') {
    const helm = all.filter((m) => pieceOf(m) === 'helm');
    const top = planeBounds(boundsOf(helm), right)[3];
    s = HELM_PX_PER_M;
    vTop = top + fy0 / s;
  } else {
    s = (fy1 - fy0) / (v1 - v0);
    vTop = v0 + fy1 / s; // bottom-aligned: row fy1 is the model's lowest point
  }
  // Horizontal: the figure's centre column on the model's centre.
  const uc = (u0 + u1) / 2;
  const xc = (fx0 + fx1) / 2;

  snapCam.left = uc - xc / s;
  snapCam.right = uc + (ref.sw - xc) / s;
  snapCam.top = vTop;
  snapCam.bottom = vTop - ref.sh / s;
  snapCam.position.copy(back).multiplyScalar(20);
  snapCam.up.copy(up);
  snapCam.lookAt(0, 0, 0);
  snapCam.near = 0.1;
  snapCam.far = 40;
  snapCam.updateProjectionMatrix();

  // Card renders: the reference's background, no ground, only this view's pieces.
  const hidden: THREE.Object3D[] = [ground, grid];
  if (v.pieces === 'helm') for (const m of all) if (!shown.includes(m) && m.visible) hidden.push(m);
  for (const o of hidden) o.visible = false;
  scene.background = new THREE.Color(ref.bg);
  cardFill.position.copy(back).multiplyScalar(10).add(new THREE.Vector3(0, 6, 0));
  cardFill.intensity = 1.4;
  const scale = Math.min(1, 900 / Math.max(ref.sw, ref.sh));
  snap.setPixelRatio(1);
  snap.setSize(Math.round(ref.sw * scale), Math.round(ref.sh * scale), false);
  snap.render(scene, snapCam);
  cardFill.intensity = 0;
  for (const o of hidden) o.visible = true;
  applyMaterials();
  scene.background = BG;

  const out = document.createElement('canvas');
  out.width = ref.sw;
  out.height = ref.sh;
  out.getContext('2d')!.drawImage(snap.domElement, 0, 0, ref.sw, ref.sh);

  let roi: Shot['roi'] = null;
  const g = groupOf(state.focus);
  if (g) {
    const hits = shown.filter((m) => g.match(pieceOf(m)));
    if (hits.length) {
      // On a front/back view a pair spans both sides; frame the side nearest the viewer.
      const pick = v.side === 'left' ? hits.filter((m) => pieceOf(m).endsWith('_l')) : hits;
      const [a0, b0, a1, b1] = planeBounds(boundsOf(pick.length ? pick : hits), right);
      const toX = (u: number) => xc + (u - uc) * s;
      const toY = (vv: number) => (vTop - vv) * s;
      const pad = Math.max(24, 0.18 * Math.max((a1 - a0) * s, (b1 - b0) * s));
      const x0 = Math.max(0, toX(a0) - pad);
      const x1 = Math.min(ref.sw, toX(a1) + pad);
      const y0 = Math.max(0, toY(b1) - pad);
      const y1 = Math.min(ref.sh, toY(b0) + pad);
      roi = [x0, y0, x1 - x0, y1 - y0];
    }
  }
  return { view: v, ref, model: out, roi };
}

/** Draw a shot's reference or model half, cropped to the focus region if there is one. */
function drawHalf(shot: Shot, which: 'ref' | 'model', maxW = 600): HTMLCanvasElement {
  const [x, y, w, h] = shot.roi ?? [0, 0, shot.ref.sw, shot.ref.sh];
  // A focus crop is small, so it may scale up (to 3x); a whole view only scales down.
  const k = Math.min(shot.roi ? 3 : 1, maxW / w);
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const ctx = c.getContext('2d')!;
  if (which === 'ref') ctx.drawImage(shot.ref.img, shot.ref.sx + x, y, w, h, 0, 0, c.width, c.height);
  else ctx.drawImage(shot.model, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}

let scores: Record<string, { iou: number | null; lines_f: number | null; trim_f: number | null; worst_bands?: string[] }> = {};

async function loadScores() {
  try {
    const r = await fetch('/scores', { cache: 'no-store' });
    scores = r.ok ? await r.json() : {};
  } catch {
    scores = {};
  }
}

const scoreSpan = (label: string, v: number | null | undefined, good: number) =>
  v == null ? '' : `<span class="${v >= good ? 's-good' : v >= good - 0.15 ? 's-ok' : 's-weak'}" title="${label}">${label} ${v.toFixed(2)}</span>`;

let renderToken = 0;

async function renderCards() {
  const token = ++renderToken;
  const host = $<HTMLDivElement>('compare');
  const g = groupOf(state.focus);
  const frag = document.createDocumentFragment();
  for (const v of VIEWS) {
    const shot = await shoot(v);
    if (token !== renderToken) return; // a newer render started (pose or focus changed)
    if (!shot) continue;
    shots.set(v.key, shot);
    const sc = scores[v.key];
    const relevant = v.pieces === 'plate' || !g || ['helm', 'gorget'].includes(g.key);
    const card = document.createElement('section');
    card.className = 'card' + (relevant ? '' : ' dim');
    card.innerHTML = `
      <div class="card-head"><b>${v.label}</b>
        <span class="scores">${sc ? scoreSpan('IoU', sc.iou, 0.95) + scoreSpan('lines', sc.lines_f, 0.8) + scoreSpan('trim', sc.trim_f, 0.8) : ''}</span>
      </div>
      <div class="pair"><figure data-k="ref"><figcaption>reference</figcaption></figure><figure data-k="model"><figcaption>model, live</figcaption></figure></div>
      <div class="card-foot">
        <button data-act="overlay">overlay</button>
        <button data-act="look">look from here</button>
        <button data-act="sheet" title="The Blender comparison sheet from compare_reference.py">sheet</button>
        <button data-act="detail" title="Interior lines and trim">lines</button>
        <button data-act="profile" title="Silhouette extents every 5 cm">profile</button>
      </div>
      ${sc?.worst_bands?.length ? `<div class="notes" title="${esc(sc.worst_bands.join('\n'))}">worst: ${esc(sc.worst_bands[0])}</div>` : ''}`;
    const [fr, fm] = card.querySelectorAll('figure');
    fr.prepend(drawHalf(shot, 'ref', 380));
    fm.prepend(drawHalf(shot, 'model', 380));
    fr.onclick = fm.onclick = () => openPair(v.key);
    card.querySelector<HTMLButtonElement>('[data-act=overlay]')!.onclick = () => openOverlay(v.key);
    card.querySelector<HTMLButtonElement>('[data-act=look]')!.onclick = () => {
      setView(v.side);
      if (!state.ortho) setCamera(true);
    };
    for (const kind of ['sheet', 'detail', 'profile'] as const) {
      card.querySelector<HTMLButtonElement>(`[data-act=${kind}]`)!.onclick = () =>
        openImage(`/renders/compare/${v.key}${kind === 'sheet' ? '' : `-${kind}`}.png?t=${Date.now()}`, `${v.key} ${kind} (Blender, last scored build)`);
    }
    frag.appendChild(card);
  }
  if (token !== renderToken) return;
  host.replaceChildren(frag);
}

// --- Part sheets and inspiration -------------------------------------------------------
function buildParts() {
  const g = groupOf(state.focus);
  const wanted = g?.parts ?? [];
  const ordered = [...PART_SHEETS].sort((a, b) => Number(wanted.includes(b.name)) - Number(wanted.includes(a.name)));
  $<HTMLElement>('partsHead').textContent = g ? `Part sheets: ${g.label.toLowerCase()} first` : 'Part sheets';
  $<HTMLElement>('parts').innerHTML = ordered
    .map(
      (p) =>
        `<figure class="${wanted.includes(p.name) ? 'hit' : ''}" data-src="${sheetUrl(p.name)}" data-cap="${p.label} (art/source/${p.name})"><img loading="lazy" src="${sheetUrl(p.name)}" alt="${p.label}"><figcaption>${p.label}</figcaption></figure>`,
    )
    .join('');
}

function buildInspiration() {
  $<HTMLElement>('inspo').innerHTML = INSPIRATION.map(
    (f) =>
      `<figure data-src="/art/references/${f}" data-cap="${f} (third-party art, see art/references/README.md)"><img loading="lazy" src="/art/references/${f}" alt="${f}"><figcaption>${f.replace(/\.\w+$/, '')}</figcaption></figure>`,
  ).join('');
}

for (const id of ['parts', 'inspo']) {
  $<HTMLElement>(id).addEventListener('click', (e) => {
    const fig = (e.target as HTMLElement).closest('figure');
    if (fig) openImage(fig.dataset.src!, fig.dataset.cap!);
  });
}

// --- Lightbox -------------------------------------------------------------------------
const lightbox = $<HTMLDivElement>('lightbox');
const lbInner = lightbox.querySelector('.inner') as HTMLDivElement;
const lbCap = lightbox.querySelector('.cap') as HTMLDivElement;
let lbKeep = false;

function open(nodes: HTMLElement[], cap: string) {
  lbInner.replaceChildren(...nodes);
  lbCap.textContent = cap;
  lightbox.classList.add('open');
}
lightbox.onclick = () => {
  if (lbKeep) return;
  lightbox.classList.remove('open');
};
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') lightbox.classList.remove('open');
});

function openImage(src: string, cap: string) {
  lbKeep = false;
  const img = new Image();
  img.src = src;
  img.onerror = () => (lbCap.textContent = `${cap}: not rendered yet`);
  open([img], cap);
}

function openPair(key: string) {
  const shot = shots.get(key);
  if (!shot) return;
  lbKeep = false;
  const w = Math.min(1400, innerWidth / 2 - 30);
  open([drawHalf(shot, 'ref', w), drawHalf(shot, 'model', w)], `${key}: reference | model (live)${state.focus ? `, ${state.focus}` : ''}`);
}

/** The model over the reference, with a slider to fade between them. */
function openOverlay(key: string) {
  const shot = shots.get(key);
  if (!shot) return;
  const w = Math.min(1400, innerWidth - 60);
  const r = drawHalf(shot, 'ref', w);
  const m = drawHalf(shot, 'model', w);
  const stack = document.createElement('div');
  stack.style.cssText = 'position:relative;display:inline-block;cursor:default';
  m.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0.5';
  stack.append(r, m);
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = '50';
  slider.style.cssText = 'position:fixed;right:20px;bottom:12px;width:min(320px,50vw)';
  slider.oninput = () => (m.style.opacity = String(Number(slider.value) / 100));
  stack.onclick = (e) => e.stopPropagation();
  slider.onclick = (e) => e.stopPropagation();
  lbKeep = false;
  open([stack, slider], `${key}: model over reference; slide to fade (Esc or click outside to close)`);
}

// --- Controls -------------------------------------------------------------------------
function setView(view: Side | 'three') {
  state.view = view;
  for (const b of document.querySelectorAll<HTMLButtonElement>('#views button')) b.classList.toggle('on', b.dataset.view === view);
  frameMain();
}
for (const b of document.querySelectorAll<HTMLButtonElement>('#views button')) b.onclick = () => setView(b.dataset.view as Side);

$<HTMLInputElement>('ortho').onchange = (e) => setCamera((e.target as HTMLInputElement).checked);
$<HTMLSelectElement>('pose').onchange = (e) => {
  state.pose = (e.target as HTMLSelectElement).value;
  applyPose();
  frameMain();
  renderCards();
};
$<HTMLSelectElement>('focusMode').onchange = (e) => {
  state.focusMode = (e.target as HTMLSelectElement).value as typeof state.focusMode;
  applyMaterials();
  renderCards();
};
$<HTMLInputElement>('spin').onchange = (e) => (controls.autoRotate = (e.target as HTMLInputElement).checked);

// --- Live reload ----------------------------------------------------------------------
const events = new EventSource('/events');
events.addEventListener('model', (ev) => {
  if ((ev as MessageEvent).data === MODEL) load({ refit: false });
});
events.addEventListener('render', async (ev) => {
  // A new comparison sheet or scores landed: refresh the numbers on the cards.
  if (String((ev as MessageEvent).data).includes('compare')) {
    await loadScores();
    renderCards();
  }
});

// --- Loop -----------------------------------------------------------------------------
function resize() {
  const { clientWidth: w, clientHeight: h } = app;
  renderer.setSize(w, h, false);
  const aspect = w / Math.max(1, h);
  persp.aspect = aspect;
  persp.updateProjectionMatrix();
  const half = ortho.userData.half ?? 1.3;
  ortho.left = -half * aspect;
  ortho.right = half * aspect;
  ortho.top = half;
  ortho.bottom = -half;
  ortho.updateProjectionMatrix();
}
addEventListener('resize', resize);
new ResizeObserver(resize).observe(app);
resize();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// --- Start ----------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
state.focus = groupOf(params.get('piece'))?.key ?? null;
setView('three');
buildParts();
buildInspiration();
await Promise.all([loadScores(), loadTargets()]);
await load();

// Hooks for scripted screenshots.
(window as unknown as { __plate: unknown }).__plate = {
  setFocus,
  setView,
  ready: () => shots.size === VIEWS.length,
};
