'use client';
// The 3D view of the /spectator/replay board: the zone's walls raised from the EQEmu collision mesh, its floors
// under them, the raiders as spheres and the mobs the raid had targeted as red diamonds. Loaded with next/dynamic
// (ssr: false) so nobody on the 2D view downloads three.js. A split screen mounts one of these per pane.
//
// What this file does NOT own: the playhead, the night, the zone pick, the picks and the 15-minute data windows.
// Those stay in ReplayBoard's one playback loop, which hands this view each painted frame through
// `bridgeRef.feed` (the zone, the raiders already interpolated and in the SERVER frame, who is highlighted and
// followed, and the targets and spawn points to mark). So 2D and 3D can never disagree about who is where, or when.
//
// Frame: lib/zoneMesh.ts serverToThree. Top-down it is the 2D board's picture (X = screen x, Z = screen y, Y up
// is EQ's z). The camera starts south of the raid looking north, so the first picture is "north up" like the 2D.
//
// The camera (lib/replayCamera.ts) stays INSIDE the zone: it orbits the centre of the nearest 80% of the raiders,
// a modest height above them, clamped to the mesh's extent and pulled in along the line to the target to just
// short of any wall (a third-person game camera). It holds still until the picture is clearly wrong (the same
// hysteresis as the 2D board), then glides to a new spot; a scrub, a zone change or Fit raid snaps. The wall test
// is a grid lookup over the mesh's triangles, not a three.js raycast over all of them. Any orbit, pan or zoom by
// the viewer takes the camera over until they press Fit raid; Fit zone is the one deliberate view from outside.
//
// Drawing rules: render on demand (a feed, a camera move, a resize, a follow still gliding), never a free-running
// loop, so a paused replay costs nothing. Walls are one BufferGeometry, flat-shaded and tinted by height,
// see-through and not written to the depth buffer. The floors are a second, OPAQUE one: no textures, just vertex
// colours baked once per mesh load by lib/zoneFloor.ts (height ramp x slope x a north-west light, unlit material,
// roofs left out), fetched as 'floors=only', which the Floors toggle hides without a refetch. Raiders and marks
// draw last with the depth test OFF, so one standing under a roof, on a lower storey or behind a wall is still seen.
// Sphere size follows camera distance so a dot stays about as big on screen as the 2D board's, wherever the camera is.
//
// Following a raider moves the orbit TARGET and the camera by the same step, so the angle and the zoom the viewer
// chose are kept. Only the offset between the camera's target and the raider decays (the glide to a newly picked
// raider); the raider's own movement carries the camera with it, so playback has no lag. See lib/replayFollow.ts.
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  AmbientLight, BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, OctahedronGeometry, PerspectiveCamera, Quaternion, Scene, SphereGeometry,
  SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { classAbbr, classColor } from '@/lib/spectator';
import { heightHue, positionsToThree, serverToThree, unpackMesh, type UnpackedMesh } from '@/lib/zoneMesh';
import { floorVertexColors, shadeFloors } from '@/lib/zoneFloor';
import { FOLLOW_SETTLED, FOLLOW_TAU_MS } from '@/lib/replayFollow';
import { exceedsHysteresis } from '@/lib/replayFraming';
import {
  boundsFromServer, buildTriGrid, constrainCamera, desiredRig, easeRig, raidFocus,
  type Bounds3, type TriGrid, type V3,
} from '@/lib/replayCamera';

export type Placed3D = { name: string; cls: string | null; hp: number | null; x: number; y: number; z: number };   // server frame
export type PlacedTarget3D = { name: string; n: number; x: number; y: number; z: number };
export type PlacedSpawn3D = { name: string; x: number; y: number; z: number };
export type Feed3D = {
  hl: ReadonlySet<string>;              // lower-case names of the highlighted raiders
  follow: string | null;
  targets: PlacedTarget3D[];
  spawns: PlacedSpawn3D[];
  snap: boolean;                        // the playhead jumped (a scrub or a new session): frame the raid at once
};
export type Bridge3D = {
  feed: (zone: string | null, raiders: Placed3D[], extra: Feed3D) => void;
  zoom: (factor: number) => void;
  fitRaid: () => void;
  fitZone: () => void;
};
type Props = {
  zone: string | null;
  floors: boolean;
  /** Where the packed walls come from; the members' route when omitted (the public share page passes its own). */
  meshUrl?: (zone: string, floors: '' | '1' | 'only') => string;
  bridgeRef: MutableRefObject<Bridge3D | null>;
  onReady: () => void;                      // the bridge is live: ask for a frame
  onFail: () => void;                       // no WebGL: the board goes back to 2D
  onPick: (name: string) => void;           // a tap on a raider
  onPanAway: () => void;                    // the viewer panned: they have taken the camera back from a follow
  onKeyDown: (e: React.KeyboardEvent) => void;
  label: string;
};

const BG = 0x0d1117;
const FOV = 50;
const TILT = 0.75;                // radians off straight-down for a fresh fit
const MAX_RAIDERS = 160;
const MAX_MARKS = 48;
const MAX_TAGS = 40;
const LIFT = 4;                   // a raider's z is at the feet; the dot is centred a little above the floor
const DOT_PX = 0.011;             // sphere radius as a fraction of camera distance (~6 px on a 500 px canvas)
const MIN_DOT = 2.5;
const REACH = { mouse: 12, touch: 22 };
const PALETTE = 64;
const FOLLOW_SPAN = 700;          // how much ground a fresh fit on a followed raider shows
const TARGET_RED = 0xef4444;
const SPAWN_AMBER = 0xb7791f;
const EDGE_NDC = 0.94;            // a raider past this (of the -1..1 screen) counts as outside the picture
const MIN_ORBIT = 25;
const MAX_ORBIT = 8000;           // until a mesh says how big the zone is

type Status = 'idle' | 'loading' | 'ready' | 'none' | 'error';
type Kind = 'pick' | 'hover' | 'target' | 'spawn';
type Ctx = {
  renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; controls: OrbitControls;
  inst: InstancedMesh; halo: InstancedMesh; tgt: InstancedMesh; spawn: InstancedMesh;
  wall: Mesh | null; floor: Mesh | null; tags: HTMLDivElement[];
  raiders: Placed3D[]; targets: PlacedTarget3D[]; spawns: PlacedSpawn3D[]; hl: ReadonlySet<string>;
  followName: string | null; kick: boolean; off: Vector3; lastDraw: number;
  feedZone: string | null; fitted: 'none' | 'mesh' | 'raid'; moved: boolean; hover: string | null;
  box: { cx: number; cy: number; cz: number; span: number } | null;     // the wall mesh, three frame
  bounds: Bounds3 | null; wallGrid: TriGrid | null; floorGrid: TriGrid | null;   // what keeps the camera inside
  snap: boolean;                                                       // frame the raid at once on the next draw
  goal: { target: V3; pos: V3 } | null;                                // the glide under way, if any
  w: number; h: number; raf: number; dead: boolean;
  request: () => void; fitTo: (cx: number, cz: number, y: number, span: number) => void;
};

const tmpV = new Vector3();
const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpC = new Color();
const bgColor = new Color(BG);
const colorCache = new Map<string, Color>();
const colorOf = (cls: string | null) => {
  const k = classColor(cls);
  let c = colorCache.get(k);
  if (!c) colorCache.set(k, c = new Color(k));
  return c;
};

const TAG_BASE = 'position:absolute;display:none;pointer-events:none;white-space:nowrap;padding:2px 6px;border-radius:3px;'
  + 'font:12px "Cascadia Code",Consolas,ui-monospace,monospace;';
const TAG_LOOK: Record<Kind, string> = {
  pick: 'color:#f0f6fc;background:#161b22;border:1px solid #f0f6fc',
  hover: 'color:#c9d1d9;background:#161b22;border:1px solid #30363d',
  target: 'color:#fecaca;background:#2a1215;border:1px solid #ef4444',
  spawn: 'color:#a8884a;background:#161b22;border:1px dashed #6b5a2e;opacity:0.85',
};

/** The walls of an unpacked mesh as a flat-shaded, height-tinted, see-through mesh. */
function buildMesh(u: UnpackedMesh): Mesh {
  const pos = positionsToThree(u.pos);
  const lo = u.min[2], span = Math.max(1, u.max[2] - u.min[2]);
  const ramp = Array.from({ length: PALETTE }, (_, i) =>
    new Color().setHSL(heightHue(i / (PALETTE - 1)) / 360, 0.42, 0.6));
  const col = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const k = ramp[Math.min(PALETTE - 1, Math.max(0, Math.round(((pos[i + 1] - lo) / span) * (PALETTE - 1))))];
    col[i] = k.r; col[i + 1] = k.g; col[i + 2] = k.b;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.computeVertexNormals();   // not indexed, so every triangle has its own: flat shading
  const mat = new MeshLambertMaterial({
    vertexColors: true, flatShading: true, transparent: true, opacity: 0.5, side: DoubleSide, depthWrite: false,
  });
  const m = new Mesh(geo, mat);
  m.renderOrder = 1;
  m.frustumCulled = false;
  return m;
}

/**
 * The floors of an unpacked `floors=only` mesh as an opaque, unlit surface whose vertex colours were baked once
 * (lib/zoneFloor.ts): height ramp x slope x a north-west light. Roofs are left out (a cave roof would hide the
 * cave from above); the camera still treats them as solid through `grid`, which is built from every triangle.
 */
function buildFloorMesh(u: UnpackedMesh): { mesh: Mesh | null; grid: TriGrid | null } {
  const all = positionsToThree(u.pos);
  const grid = buildTriGrid(all);
  const fs = shadeFloors(u.pos);
  if (!fs.n) return { mesh: null, grid };
  const pos = new Float32Array(fs.n * 9);
  for (let i = 0; i < fs.n; i++) pos.set(all.subarray(9 * fs.tri[i], 9 * fs.tri[i] + 9), 9 * i);
  const srgb = floorVertexColors(fs);
  const col = new Float32Array(srgb.length);
  for (let i = 0; i < srgb.length; i += 3) {
    tmpC.setRGB(srgb[i], srgb[i + 1], srgb[i + 2], SRGBColorSpace);   // the renderer expects the working (linear) space
    col[i] = tmpC.r; col[i + 1] = tmpC.g; col[i + 2] = tmpC.b;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  const mat = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });   // opaque, writes depth, no lights
  const m = new Mesh(geo, mat);
  m.renderOrder = 0;
  m.frustumCulled = false;
  return { mesh: m, grid };
}

function disposeMesh(c: Ctx, m: Mesh | null) {
  if (!m) return;
  c.scene.remove(m);
  m.geometry.dispose();
  (m.material as MeshLambertMaterial | MeshBasicMaterial).dispose();
}

export default function Replay3D({ zone, floors, meshUrl, bridgeRef, onReady, onFail, onPick, onPanAway, onKeyDown, label }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [floorStatus, setFloorStatus] = useState<Status>('idle');
  const [tries, setTries] = useState(0);
  const readyRef = useRef(onReady);
  const failRef = useRef(onFail);
  const pickRef = useRef(onPick);
  const panRef = useRef(onPanAway);
  const floorsRef = useRef(floors);
  readyRef.current = onReady;
  failRef.current = onFail;
  pickRef.current = onPick;
  panRef.current = onPanAway;
  floorsRef.current = floors;

  // ── the renderer, once ─────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    } catch {
      failRef.current();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(BG, 1);
    const dom = renderer.domElement;
    dom.style.display = 'block';
    dom.style.width = '100%';
    dom.style.height = '100%';
    host.appendChild(dom);

    const scene = new Scene();
    scene.add(new AmbientLight(0xffffff, 2.0));
    const sun = new DirectionalLight(0xffffff, 2.4);
    sun.position.set(-0.5, 1, 0.6);
    scene.add(sun);

    const camera = new PerspectiveCamera(FOV, 1, 5, 60000);
    camera.position.set(0, 1500, 1500);

    const controls = new OrbitControls(camera, dom);
    controls.screenSpacePanning = false;
    controls.minDistance = MIN_ORBIT;
    controls.maxDistance = MAX_ORBIT;
    controls.maxPolarAngle = Math.PI * 0.495;

    const dotGeo = new SphereGeometry(1, 12, 8);
    // Dots and marks skip the depth test: the floors now write depth, and a raider on a lower storey, under a roof or
    // a few units into a slope (the mesh and the reported z never agree exactly) must still be seen.
    const dotMat = new MeshBasicMaterial({ transparent: true, depthTest: false });   // transparent only to draw after the walls
    const inst = new InstancedMesh(dotGeo, dotMat, MAX_RAIDERS);
    inst.count = 0;
    inst.frustumCulled = false;
    inst.renderOrder = 3;
    inst.setColorAt(0, tmpC.set('#ffffff'));
    scene.add(inst);

    // A halo behind each highlighted raider: a bigger, faint white sphere.
    const haloMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false, depthTest: false });
    const halo = new InstancedMesh(dotGeo, haloMat, MAX_RAIDERS);
    halo.count = 0;
    halo.frustumCulled = false;
    halo.renderOrder = 2;
    scene.add(halo);

    // Targets: solid red diamonds. Spawn points: amber wireframe diamonds, dimmer, so they read as "here is where it spawns".
    const diaGeo = new OctahedronGeometry(1);
    const tgtMat = new MeshBasicMaterial({ color: TARGET_RED, transparent: true, depthTest: false });
    const tgt = new InstancedMesh(diaGeo, tgtMat, MAX_MARKS);
    tgt.count = 0;
    tgt.frustumCulled = false;
    tgt.renderOrder = 4;
    scene.add(tgt);
    const spawnMat = new MeshBasicMaterial({ color: SPAWN_AMBER, wireframe: true, transparent: true, opacity: 0.7, depthTest: false });
    const spawn = new InstancedMesh(diaGeo, spawnMat, MAX_MARKS);
    spawn.count = 0;
    spawn.frustumCulled = false;
    spawn.renderOrder = 3;
    scene.add(spawn);

    const c: Ctx = {
      renderer, scene, camera, controls, inst, halo, tgt, spawn, wall: null, floor: null, tags: [],
      raiders: [], targets: [], spawns: [], hl: new Set(), followName: null, kick: false, off: new Vector3(), lastDraw: 0,
      feedZone: null, fitted: 'none', moved: false, hover: null, box: null,
      bounds: null, wallGrid: null, floorGrid: null, snap: false, goal: null,
      w: 0, h: 0, raf: 0, dead: false,
      request: () => {
        if (c.raf || c.dead) return;
        c.raf = requestAnimationFrame(() => { c.raf = 0; draw(); });
      },
      fitTo: (cx, cz, y, span) => {
        const half = Math.tan((FOV * Math.PI) / 360);
        const aspect = c.w && c.h ? c.w / c.h : 1;
        const d = (Math.max(span, 300) * 1.15) / (2 * half * Math.min(1, aspect));
        controls.target.set(cx, y, cz);
        camera.position.set(cx, y + d * Math.cos(TILT), cz + d * Math.sin(TILT));
        controls.update();
        c.request();
      },
    };
    ctxRef.current = c;

    const radiusAt = (p: Vector3) => Math.max(MIN_DOT, camera.position.distanceTo(p) * DOT_PX);
    const lower = (s: string) => s.toLowerCase();
    const picked = (name: string) => c.hl.has(lower(name));
    const followed = () => {
      const f = c.followName ? lower(c.followName) : null;
      return f ? c.raiders.find(r => lower(r.name) === f) ?? null : null;
    };

    // Screen position of a point in the server frame, or null when it is behind the camera.
    const project = (x: number, y: number, z: number) => {
      const [X, Y, Z] = serverToThree(x, y, z);
      tmpV.set(X, Y, Z).project(camera);
      if (tmpV.z > 1) return null;
      return { px: (tmpV.x * 0.5 + 0.5) * c.w, py: (-tmpV.y * 0.5 + 0.5) * c.h };
    };

    const tagAt = (i: number) => {
      while (c.tags.length <= i) {
        const t = document.createElement('div');
        host.appendChild(t);
        c.tags.push(t);
      }
      return c.tags[i];
    };
    const placeLabels = () => {
      let used = 0;
      const put = (text: string, kind: Kind, x: number, y: number, z: number) => {
        if (used >= MAX_TAGS) return;
        const s = project(x, y, z);
        if (!s) return;
        const tag = tagAt(used++);
        tag.style.cssText = TAG_BASE + TAG_LOOK[kind] + ';display:block';
        tag.textContent = text;
        const tw = tag.offsetWidth;
        tag.style.left = `${Math.max(4, Math.min(c.w - tw - 4, s.px + 10))}px`;
        tag.style.top = `${Math.max(4, Math.min(c.h - 26, s.py - 24))}px`;
      };
      for (const p of c.raiders) {
        const pick = picked(p.name);
        if (!pick && p.name !== c.hover) continue;
        put(`${p.name} · ${classAbbr(p.cls)}${p.hp != null ? ` · ${p.hp}%` : ''}`, pick ? 'pick' : 'hover', p.x, p.y, p.z + LIFT);
      }
      for (const t of c.targets.slice(0, MAX_MARKS)) put(`${t.name}${t.n > 1 ? ` ×${t.n}` : ''}`, 'target', t.x, t.y, t.z + LIFT);
      for (const s of c.spawns.slice(0, MAX_MARKS)) put(`${s.name} (spawn point)`, 'spawn', s.x, s.y, s.z + LIFT);
      for (let i = used; i < c.tags.length; i++) c.tags[i].style.display = 'none';
    };

    // Share of the raiders outside the picture the camera shows now (behind it, or past the screen's edge).
    const outsideShare = () => {
      if (!c.raiders.length) return 0;
      camera.updateMatrixWorld();
      let out = 0;
      for (const r of c.raiders) {
        const [X, Y, Z] = serverToThree(r.x, r.y, r.z + LIFT);
        tmpV.set(X, Y, Z).project(camera);
        if (tmpV.z > 1 || Math.abs(tmpV.x) > EDGE_NDC || Math.abs(tmpV.y) > EDGE_NDC) out++;
      }
      return out / c.raiders.length;
    };
    const place = (target: V3, pos: V3) => {
      controls.target.set(target[0], target[1], target[2]);
      camera.position.set(pos[0], pos[1], pos[2]);
      controls.update();
    };
    // Frames the nearest 80% of the raid from inside the zone. Returns true while a glide is still under way.
    const autoFrame = (dt: number): boolean => {
      if (c.moved || followed() || !c.raiders.length || !c.w || !c.h) return false;
      const foc = raidFocus(c.raiders);
      if (!foc) return false;
      const rig = desiredRig(foc, c.w / c.h, FOV);
      const goal = {
        target: rig.target,
        pos: constrainCamera(rig.target, rig.pos, { bounds: c.bounds, grids: [c.wallGrid, c.floorGrid] }).pos,
      };
      if (c.snap || c.fitted !== 'raid') {
        c.snap = false;
        c.goal = null;
        c.fitted = 'raid';
        place(goal.target, goal.pos);
        return false;
      }
      if (!c.goal) {
        const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        const have = camera.position.distanceTo(controls.target);
        const want = dist(goal.pos, goal.target);
        if (want > 0 && exceedsHysteresis(have / want, outsideShare())) c.goal = goal;
      }
      if (!c.goal) return false;
      const e = easeRig(
        { target: [controls.target.x, controls.target.y, controls.target.z], pos: [camera.position.x, camera.position.y, camera.position.z] },
        c.goal, dt);
      place(e.target, e.pos);
      if (e.done) c.goal = null;
      return !e.done;
    };

    function draw() {
      if (c.dead || !c.w || !c.h) return;
      const now = performance.now();
      const dt = c.lastDraw ? Math.min(100, now - c.lastDraw) : 0;
      c.lastDraw = now;
      if (autoFrame(dt)) c.request();

      // Follow: the camera's target rides (followed raider + a decaying offset), the camera moves by the same step.
      const fp = followed();
      if (fp) {
        const [X, Y, Z] = serverToThree(fp.x, fp.y, fp.z + LIFT);
        if (c.kick) { c.off.set(controls.target.x - X, controls.target.y - Y, controls.target.z - Z); c.kick = false; }
        c.off.multiplyScalar(Math.exp(-dt / FOLLOW_TAU_MS));
        const gliding = c.off.length() >= FOLLOW_SETTLED;
        if (!gliding) c.off.set(0, 0, 0);
        tmpV.set(X, Y, Z).add(c.off).sub(controls.target);
        if (tmpV.lengthSq() > 1e-6) {
          controls.target.add(tmpV);
          camera.position.add(tmpV);
          controls.update();
        }
        if (gliding) c.request();
      }

      const any = c.hl.size > 0;
      const n = Math.min(c.raiders.length, MAX_RAIDERS);
      let halos = 0;
      for (let i = 0; i < n; i++) {
        const p = c.raiders[i];
        const [X, Y, Z] = serverToThree(p.x, p.y, p.z + LIFT);
        tmpV.set(X, Y, Z);
        const pick = any && picked(p.name);
        const base = radiusAt(tmpV);
        const s = base * (pick ? 1.5 : p.name === c.hover ? 1.3 : 1);
        inst.setMatrixAt(i, tmpM.compose(tmpV, tmpQ, tmpS.set(s, s, s)));
        // Everyone else dims toward the background while anyone is picked.
        inst.setColorAt(i, any && !pick ? tmpC.copy(colorOf(p.cls)).lerp(bgColor, 0.7) : colorOf(p.cls));
        if (pick) halo.setMatrixAt(halos++, tmpM.compose(tmpV, tmpQ, tmpS.set(s * 1.9, s * 1.9, s * 1.9)));
      }
      inst.count = n;
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      halo.count = halos;
      halo.instanceMatrix.needsUpdate = true;

      const nt = Math.min(c.targets.length, MAX_MARKS);
      for (let i = 0; i < nt; i++) {
        const t = c.targets[i];
        const [X, Y, Z] = serverToThree(t.x, t.y, t.z + LIFT);
        tmpV.set(X, Y, Z);
        const r = radiusAt(tmpV) * 1.8 * (1 + Math.min(t.n, 8) * 0.18);
        tgt.setMatrixAt(i, tmpM.compose(tmpV, tmpQ, tmpS.set(r, r * 1.5, r)));
      }
      tgt.count = nt;
      tgt.instanceMatrix.needsUpdate = true;
      const ns = Math.min(c.spawns.length, MAX_MARKS);
      for (let i = 0; i < ns; i++) {
        const s = c.spawns[i];
        const [X, Y, Z] = serverToThree(s.x, s.y, s.z + LIFT);
        tmpV.set(X, Y, Z);
        const r = radiusAt(tmpV) * 1.8;
        spawn.setMatrixAt(i, tmpM.compose(tmpV, tmpQ, tmpS.set(r, r * 1.5, r)));
      }
      spawn.count = ns;
      spawn.instanceMatrix.needsUpdate = true;

      renderer.render(scene, camera);
      placeLabels();
    }

    const size = () => {
      const r = host.getBoundingClientRect();
      c.w = Math.max(1, Math.floor(r.width));
      c.h = Math.max(1, Math.floor(r.height));
      renderer.setSize(c.w, c.h, false);
      camera.aspect = c.w / c.h;
      camera.updateProjectionMatrix();
      c.request();
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(host);

    controls.addEventListener('change', c.request);
    controls.addEventListener('start', () => { c.moved = true; });

    // Hover (mouse) and tap, by nearest projected dot, the way the 2D board picks.
    const hit = (x: number, y: number, reach: number): string | null => {
      let best: string | null = null;
      let bd = reach * reach;
      for (const p of c.raiders) {
        const s = project(p.x, p.y, p.z + LIFT);
        if (!s) continue;
        const q = (s.px - x) ** 2 + (s.py - y) ** 2;
        if (q <= bd) { bd = q; best = p.name; }
      }
      return best;
    };
    const local = (e: PointerEvent) => {
      const r = dom.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    let down: { x: number; y: number } | null = null;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.buttons) return;
      const p = local(e);
      const name = hit(p.x, p.y, REACH.mouse);
      if (name !== c.hover) { c.hover = name; c.request(); }
    };
    const onDown = (e: PointerEvent) => {
      down = local(e);
      // OrbitControls pans on a right drag or with a modifier held: that takes the camera back from a follow.
      if (e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey) panRef.current();
    };
    const onUp = (e: PointerEvent) => {
      const p = local(e);
      if (down && Math.abs(p.x - down.x) + Math.abs(p.y - down.y) <= 4) {
        const name = hit(p.x, p.y, e.pointerType === 'mouse' ? REACH.mouse : REACH.touch);
        if (name) pickRef.current(name);
      }
      down = null;
    };
    const onLeave = () => { if (c.hover) { c.hover = null; c.request(); } };
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('pointerleave', onLeave);

    // The bridge ReplayBoard drives.
    const fitRaid = () => {
      const f = followed();
      if (f) {   // following: a close fit on the raider, not the whole raid
        const [cx, cy, cz] = serverToThree(f.x, f.y, f.z);
        c.fitted = 'raid';
        c.fitTo(cx, cz, cy, FOLLOW_SPAN);
        return;
      }
      if (c.raiders.length) { c.snap = true; c.request(); }   // autoFrame frames it, inside the zone
      else if (c.box) { c.fitTo(c.box.cx, c.box.cz, c.box.cy, c.box.span); }
    };
    bridgeRef.current = {
      feed: (zoneNow, raiders, extra) => {
        if (zoneNow !== c.feedZone) {
          c.feedZone = zoneNow;
          c.fitted = 'none';
          c.moved = false;
          c.hover = null;
          c.goal = null;
        }
        c.raiders = raiders;
        c.targets = extra.targets;
        c.spawns = extra.spawns;
        c.hl = extra.hl;
        if (extra.snap) { c.snap = true; c.goal = null; }
        if (extra.follow !== c.followName) { c.followName = extra.follow; c.kick = !!extra.follow; }
        c.request();
      },
      zoom: (factor) => {
        c.moved = true;
        tmpV.copy(camera.position).sub(controls.target);
        const d = Math.min(controls.maxDistance, Math.max(controls.minDistance, tmpV.length() / factor));
        camera.position.copy(controls.target).add(tmpV.setLength(d));
        controls.update();
        c.request();
      },
      fitRaid: () => { c.moved = false; c.goal = null; fitRaid(); },
      fitZone: () => { if (c.box) { c.moved = true; c.goal = null; c.fitTo(c.box.cx, c.box.cz, c.box.cy, c.box.span); } },
    };
    readyRef.current();

    return () => {
      c.dead = true;
      if (c.raf) cancelAnimationFrame(c.raf);
      bridgeRef.current = null;
      ctxRef.current = null;
      ro.disconnect();
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointerleave', onLeave);
      controls.dispose();
      disposeMesh(c, c.wall);
      disposeMesh(c, c.floor);
      inst.dispose();
      halo.dispose();
      tgt.dispose();
      spawn.dispose();
      dotGeo.dispose();
      diaGeo.dispose();
      dotMat.dispose();
      haloMat.dispose();
      tgtMat.dispose();
      spawnMat.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      dom.remove();
      for (const t of c.tags) t.remove();
    };
  }, [bridgeRef]);

  // ── the walls, per zone ────────────────────────────────────────────────────
  useEffect(() => {
    const c = ctxRef.current;
    if (!c) return;
    if (!zone) { setStatus('idle'); return; }
    const ac = new AbortController();
    setStatus('loading');
    setFloorStatus('idle');
    fetch(meshUrl ? meshUrl(zone, '') : '/api/spectator/mesh?zone=' + encodeURIComponent(zone), { signal: ac.signal })
      .then(async res => {
        if (ac.signal.aborted) return;
        if (res.status === 404) { setStatus('none'); return; }
        if (!res.ok) { setStatus('error'); return; }
        const u = unpackMesh(await res.arrayBuffer());
        if (ac.signal.aborted || c.dead) return;
        if (!u.tris) { setStatus('none'); return; }

        const wall = buildMesh(u);
        c.scene.add(wall);
        c.wall = wall;
        c.wallGrid = buildTriGrid(wall.geometry.getAttribute('position').array as Float32Array);
        c.bounds = boundsFromServer(u.min, u.max);

        const sx = u.max[0] - u.min[0], sy = u.max[1] - u.min[1];
        const [cx, cy, cz] = serverToThree((u.min[0] + u.max[0]) / 2, (u.min[1] + u.max[1]) / 2, (u.min[2] + u.max[2]) / 2);
        c.box = { cx, cy, cz, span: Math.max(sx, sy) };
        c.controls.maxDistance = Math.max(4000, c.box.span * 3);
        if (c.fitted === 'none' && !c.moved) { c.fitted = 'mesh'; c.fitTo(cx, cz, cy, c.box.span); }
        else if (!c.moved) c.snap = true;   // the raid was framed before the walls were here: do it again inside them
        setStatus('ready');
        c.request();
      })
      .catch(() => { if (!ac.signal.aborted) setStatus('error'); });

    return () => {
      ac.abort();
      if (c.wall || c.floor) {
        disposeMesh(c, c.wall);
        disposeMesh(c, c.floor);
        c.wall = null;
        c.floor = null;
        c.box = null;
        c.bounds = null;
        c.wallGrid = null;
        c.floorGrid = null;
        c.goal = null;
        c.controls.maxDistance = MAX_ORBIT;
        c.request();
      }
    };
  }, [zone, tries]);

  // ── the floors, under the walls: fetched once the toggle is on, then only shown and hidden ──
  useEffect(() => {
    const c = ctxRef.current;
    if (!c || !zone || !floors) return;
    if (c.floor) { c.floor.visible = true; c.request(); return; }
    const ac = new AbortController();
    setFloorStatus('loading');
    fetch(meshUrl ? meshUrl(zone, 'only') : '/api/spectator/mesh?floors=only&zone=' + encodeURIComponent(zone), { signal: ac.signal })
      .then(async res => {
        if (ac.signal.aborted) return;
        if (res.status === 404) { setFloorStatus('none'); return; }
        if (!res.ok) { setFloorStatus('error'); return; }
        const u = unpackMesh(await res.arrayBuffer());
        if (ac.signal.aborted || c.dead) return;
        if (!u.tris) { setFloorStatus('none'); return; }
        const built = buildFloorMesh(u);
        // Floors and ceilings stop the camera too (a cave roof between it and the raid), shown or not.
        c.floorGrid = built.grid;
        if (!built.mesh) { setFloorStatus('none'); c.request(); return; }
        const floor = built.mesh;
        floor.visible = floorsRef.current;
        c.scene.add(floor);
        c.floor = floor;
        setFloorStatus('ready');
        c.request();
      })
      .catch(() => { if (!ac.signal.aborted) setFloorStatus('error'); });
    return () => ac.abort();
  }, [zone, tries, floors]);

  // The toggle off: hide, keep the geometry.
  useEffect(() => {
    const c = ctxRef.current;
    if (c?.floor && !floors) { c.floor.visible = false; c.request(); }
  }, [floors]);

  return (
    <div ref={hostRef} tabIndex={0} role="img" aria-label={label} onKeyDown={onKeyDown}
      className="absolute inset-0 overflow-hidden bg-bg focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue"
      style={{ touchAction: 'none' }}>
      <div className="pointer-events-none absolute bottom-2 left-2 max-w-[80%] text-xs text-dim">
        Drag to turn · scroll to zoom · right-drag to pan · tap a raider to highlight · north is up at the start
      </div>
      {status === 'loading' && <Note>Loading 3D walls…</Note>}
      {status === 'none' && <Note>No wall mesh for {zone} yet. Showing raiders only.</Note>}
      {status === 'error' && (
        <Note>
          The walls did not load.{' '}
          <button type="button" className="pointer-events-auto underline" onClick={() => setTries(t => t + 1)}>Retry</button>
        </Note>
      )}
      {status === 'ready' && floors && floorStatus === 'loading' && <Note>Loading floors…</Note>}
      {status === 'ready' && floors && floorStatus === 'error' && (
        <Note>
          The floors did not load.{' '}
          <button type="button" className="pointer-events-auto underline" onClick={() => setTries(t => t + 1)}>Retry</button>
        </Note>
      )}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute left-2 top-2 max-w-[80%] rounded border border-border bg-panel/90 px-2 py-1 text-xs text-dim">
      {children}
    </div>
  );
}
