'use client';
// The 3D view of the /spectator/replay board: the zone's walls raised from the EQEmu collision mesh and the
// raiders as spheres. Loaded with next/dynamic (ssr: false) so nobody on the 2D view downloads three.js.
//
// What this file does NOT own: the playhead, the night, the zone pick and the 15-minute data windows. Those
// stay in ReplayBoard's one playback loop, which hands this view each painted frame through `bridgeRef.feed`
// (the zone, and the raiders already interpolated and in the SERVER frame). So 2D and 3D can never disagree
// about who is where, or when.
//
// Frame: lib/zoneMesh.ts serverToThree. Top-down it is the 2D board's picture (X = screen x, Z = screen y, Y up
// is EQ's z). The camera starts south of the raid looking north, so the first picture is "north up" like the 2D.
//
// Drawing rules: render on demand (a feed, a camera move, a resize), never a free-running loop, so a paused
// replay costs nothing. Walls are one BufferGeometry, flat-shaded and tinted by height, see-through and not
// written to the depth buffer; raiders draw last, so a raider behind a wall is still seen. Sphere size follows
// camera distance so a dot stays about as big on screen as the 2D board's, wherever the camera is.
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  AmbientLight, BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera, Quaternion, Scene, SphereGeometry, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { classAbbr, classColor, coreRaiders } from '@/lib/spectator';
import { heightHue, positionsToThree, serverToThree, unpackMesh } from '@/lib/zoneMesh';

export type Placed3D = { name: string; cls: string | null; hp: number | null; x: number; y: number; z: number };   // server frame
export type Bridge3D = {
  feed: (zone: string | null, raiders: Placed3D[]) => void;
  zoom: (factor: number) => void;
  fitRaid: () => void;
  fitZone: () => void;
};
type Props = {
  zone: string | null;
  bridgeRef: MutableRefObject<Bridge3D | null>;
  onReady: () => void;                      // the bridge is live: ask for a frame
  onFail: () => void;                       // no WebGL: the board goes back to 2D
  onKeyDown: (e: React.KeyboardEvent) => void;
  label: string;
};

const BG = 0x0d1117;
const FOV = 50;
const TILT = 0.75;                // radians off straight-down for a fresh fit
const MAX_RAIDERS = 160;
const LIFT = 4;                   // a raider's z is at the feet; the dot is centred a little above the floor
const DOT_PX = 0.011;             // sphere radius as a fraction of camera distance (~6 px on a 500 px canvas)
const MIN_DOT = 2.5;
const REACH = { mouse: 12, touch: 22 };
const PALETTE = 64;

type Status = 'idle' | 'loading' | 'ready' | 'none' | 'error';
type Ctx = {
  renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; controls: OrbitControls;
  inst: InstancedMesh; wall: Mesh | null; label: HTMLDivElement;
  raiders: Placed3D[]; feedZone: string | null; fitted: 'none' | 'mesh' | 'raid'; moved: boolean;
  hover: string | null; selected: string | null;
  box: { cx: number; cy: number; cz: number; span: number } | null;     // the wall mesh, three frame
  w: number; h: number; raf: number; dead: boolean;
  request: () => void; fitTo: (cx: number, cz: number, y: number, span: number) => void;
};

const tmpV = new Vector3();
const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpC = new Color();

export default function Replay3D({ zone, bridgeRef, onReady, onFail, onKeyDown, label }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [tries, setTries] = useState(0);
  const readyRef = useRef(onReady);
  const failRef = useRef(onFail);
  readyRef.current = onReady;
  failRef.current = onFail;

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
    controls.minDistance = 20;
    controls.maxDistance = 30000;
    controls.maxPolarAngle = Math.PI * 0.495;

    const dotGeo = new SphereGeometry(1, 12, 8);
    const dotMat = new MeshBasicMaterial({ transparent: true });   // transparent only to draw after the walls
    const inst = new InstancedMesh(dotGeo, dotMat, MAX_RAIDERS);
    inst.count = 0;
    inst.frustumCulled = false;
    inst.renderOrder = 2;
    inst.setColorAt(0, tmpC.set('#ffffff'));
    scene.add(inst);

    const tag = document.createElement('div');
    tag.style.cssText = 'position:absolute;display:none;pointer-events:none;white-space:nowrap;padding:2px 6px;'
      + 'font:12px "Cascadia Code",Consolas,ui-monospace,monospace;color:#c9d1d9;background:#161b22;border:1px solid #30363d;border-radius:3px';
    host.appendChild(tag);

    const c: Ctx = {
      renderer, scene, camera, controls, inst, wall: null, label: tag,
      raiders: [], feedZone: null, fitted: 'none', moved: false, hover: null, selected: null, box: null,
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

    const dotRadius = (p: Vector3, name: string) => {
      const base = Math.max(MIN_DOT, camera.position.distanceTo(p) * DOT_PX);
      return base * (name === c.selected ? 1.6 : name === c.hover ? 1.3 : 1);
    };

    // Screen position of a raider, or null when it is behind the camera.
    const project = (p: Placed3D) => {
      const [X, Y, Z] = serverToThree(p.x, p.y, p.z + LIFT);
      tmpV.set(X, Y, Z).project(camera);
      if (tmpV.z > 1) return null;
      return { px: (tmpV.x * 0.5 + 0.5) * c.w, py: (-tmpV.y * 0.5 + 0.5) * c.h };
    };

    const placeLabel = () => {
      const names = [c.selected, c.hover].filter((n): n is string => !!n);
      const p = c.raiders.find(r => names.includes(r.name));
      const s = p ? project(p) : null;
      if (!p || !s) { tag.style.display = 'none'; return; }
      tag.textContent = `${p.name} · ${classAbbr(p.cls)}${p.hp != null ? ` · ${p.hp}%` : ''}`;
      tag.style.display = 'block';
      const tw = tag.offsetWidth;
      tag.style.left = `${Math.max(4, Math.min(c.w - tw - 4, s.px + 10))}px`;
      tag.style.top = `${Math.max(4, Math.min(c.h - 26, s.py - 24))}px`;
    };

    function draw() {
      if (c.dead || !c.w || !c.h) return;
      const n = Math.min(c.raiders.length, MAX_RAIDERS);
      for (let i = 0; i < n; i++) {
        const p = c.raiders[i];
        const [X, Y, Z] = serverToThree(p.x, p.y, p.z + LIFT);
        tmpV.set(X, Y, Z);
        const s = dotRadius(tmpV, p.name);
        inst.setMatrixAt(i, tmpM.compose(tmpV, tmpQ, tmpS.set(s, s, s)));
      }
      inst.count = n;
      inst.instanceMatrix.needsUpdate = true;
      renderer.render(scene, camera);
      placeLabel();
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
        const s = project(p);
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
    const onDown = (e: PointerEvent) => { down = local(e); };
    const onUp = (e: PointerEvent) => {
      const p = local(e);
      if (down && Math.abs(p.x - down.x) + Math.abs(p.y - down.y) <= 4) {
        c.selected = hit(p.x, p.y, e.pointerType === 'mouse' ? REACH.mouse : REACH.touch);
        c.request();
      }
      down = null;
    };
    const onLeave = () => { if (c.hover) { c.hover = null; c.request(); } };
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('pointerleave', onLeave);

    // The bridge ReplayBoard drives.
    const raidCentre = () => {
      const core = coreRaiders(c.raiders);
      if (!core.length) return null;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, zs = 0;
      for (const r of core) {
        x0 = Math.min(x0, r.x); x1 = Math.max(x1, r.x);
        y0 = Math.min(y0, r.y); y1 = Math.max(y1, r.y);
        zs += r.z;
      }
      const [cx, cy, cz] = serverToThree((x0 + x1) / 2, (y0 + y1) / 2, zs / core.length);
      return { cx, cy, cz, span: Math.max(x1 - x0, y1 - y0) };
    };
    const fitRaid = () => {
      const r = raidCentre();
      if (r) { c.fitted = 'raid'; c.fitTo(r.cx, r.cz, r.cy, r.span); }
      else if (c.box) { c.fitTo(c.box.cx, c.box.cz, c.box.cy, c.box.span); }
    };
    bridgeRef.current = {
      feed: (zoneNow, raiders) => {
        if (zoneNow !== c.feedZone) {
          c.feedZone = zoneNow;
          c.fitted = 'none';
          c.moved = false;
          c.selected = null;
          c.hover = null;
        }
        const changed = raiders.length !== c.raiders.length || raiders.some((r, i) => r.name !== c.raiders[i]?.name || r.cls !== c.raiders[i]?.cls);
        c.raiders = raiders;
        if (changed) {
          for (let i = 0; i < Math.min(raiders.length, MAX_RAIDERS); i++) inst.setColorAt(i, tmpC.set(classColor(raiders[i].cls)));
          if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        }
        if (c.fitted !== 'raid' && !c.moved && raiders.length) fitRaid();
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
      fitRaid: () => { c.moved = false; fitRaid(); },
      fitZone: () => { if (c.box) { c.moved = true; c.fitTo(c.box.cx, c.box.cz, c.box.cy, c.box.span); } },
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
      if (c.wall) { c.scene.remove(c.wall); c.wall.geometry.dispose(); (c.wall.material as MeshLambertMaterial).dispose(); }
      inst.dispose();
      dotGeo.dispose();
      dotMat.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      dom.remove();
      tag.remove();
    };
  }, [bridgeRef]);

  // ── the walls, per zone ────────────────────────────────────────────────────
  useEffect(() => {
    const c = ctxRef.current;
    if (!c) return;
    if (!zone) { setStatus('idle'); return; }
    const ac = new AbortController();
    setStatus('loading');
    fetch('/api/spectator/mesh?zone=' + encodeURIComponent(zone), { signal: ac.signal })
      .then(async res => {
        if (ac.signal.aborted) return;
        if (res.status === 404) { setStatus('none'); return; }
        if (!res.ok) { setStatus('error'); return; }
        const u = unpackMesh(await res.arrayBuffer());
        if (ac.signal.aborted || c.dead) return;
        if (!u.tris) { setStatus('none'); return; }

        const pos = positionsToThree(u.pos);
        const lo = u.min[2], span = Math.max(1, u.max[2] - u.min[2]);
        const ramp = Array.from({ length: PALETTE }, (_, i) => new Color().setHSL(heightHue(i / (PALETTE - 1)) / 360, 0.42, 0.6));
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
        const wall = new Mesh(geo, mat);
        wall.renderOrder = 1;
        wall.frustumCulled = false;
        c.scene.add(wall);
        c.wall = wall;

        const sx = u.max[0] - u.min[0], sy = u.max[1] - u.min[1];
        const [cx, cy, cz] = serverToThree((u.min[0] + u.max[0]) / 2, (u.min[1] + u.max[1]) / 2, (u.min[2] + u.max[2]) / 2);
        c.box = { cx, cy, cz, span: Math.max(sx, sy) };
        if (c.fitted === 'none' && !c.moved) { c.fitted = 'mesh'; c.fitTo(cx, cz, cy, c.box.span); }
        setStatus('ready');
        c.request();
      })
      .catch(() => { if (!ac.signal.aborted) setStatus('error'); });

    return () => {
      ac.abort();
      if (c.wall) {
        c.scene.remove(c.wall);
        c.wall.geometry.dispose();
        (c.wall.material as MeshLambertMaterial).dispose();
        c.wall = null;
        c.box = null;
        c.request();
      }
    };
  }, [zone, tries]);

  return (
    <div ref={hostRef} tabIndex={0} role="img" aria-label={label} onKeyDown={onKeyDown}
      className="absolute inset-0 overflow-hidden bg-bg focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue"
      style={{ touchAction: 'none' }}>
      <div className="pointer-events-none absolute bottom-2 left-2 max-w-[80%] text-xs text-dim">
        Drag to turn · scroll to zoom · right-drag to pan · north is up at the start
      </div>
      {status === 'loading' && <Note>Loading 3D walls…</Note>}
      {status === 'none' && <Note>No wall mesh for {zone} yet. Showing raiders only.</Note>}
      {status === 'error' && (
        <Note>
          The walls did not load.{' '}
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
