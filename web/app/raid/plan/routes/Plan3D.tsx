'use client';
// The route planner's 3D views (?v=b and ?v=c on /raid/plan/routes), both PREVIEWS awaiting the guild lead's pick. View
// only: the plan is edited in 2D. Loaded with next/dynamic (ssr: false) from RoutePlanner, so the 2D page never downloads
// three.js.
//
//   b  Stacked floors: each floor is its own flat slab (its 2D wall lines), the slabs spread apart in height with a slider,
//      the route, the teleports and the pathers drawn between them. No mesh download, so it works for any zone with floors.
//   c  True 3D: the zone's real collision mesh (GET /api/spectator/mesh, the same packed walls and floors the replay
//      draws), the plan at its pins' real heights, and a floor clip that hides everything above a chosen floor.
//
// WHERE things go is lib/routePlanner/view3d.ts (pure, tested); this file only draws what it returns. The drawing follows
// spectator/replay/Replay3D.tsx: render on demand (never a free-running loop), see-through height-tinted walls over opaque
// floors (its two mesh builders are reused), markers drawn with the depth test OFF so a pin under a roof or on a lower floor
// is still seen, dot size following camera distance, DOM tags projected from 3D for labels.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AmbientLight, BoxGeometry, BufferGeometry, Color, DirectionalLight, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial,
  LineLoop, LineSegments, Material, Mesh, MeshBasicMaterial, OctahedronGeometry, PerspectiveCamera, Plane, PlaneGeometry, Scene,
  SphereGeometry, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { unpackMesh } from '@/lib/zoneMesh';
import type { Mob, Plan, ZoneData } from '@/lib/routePlanner/types';
import {
  KIND_HEX, LINK_HEX, PATHER_HEX, baseSpacing, buildView3D, clipHeight, floorOrder, type Pt3, type View3D,
} from '@/lib/routePlanner/view3d';
import { buildFloorMesh, buildMesh } from '@/app/spectator/replay/Replay3D';

export type Plan3DProps = {
  zone: ZoneData;
  extraMobs: Mob[];
  plan: Plan;
  skipOptional: boolean;
  variant: 'b' | 'c';
  /** A pin was clicked: select it the way the 2D map does (the host wires this to the engine). */
  onSelect: (pinId: string) => void;
  /** No WebGL: the host goes back to the 2D map. */
  onFail: () => void;
};

const BG = 0x0a0e13;                 // --map-bg
const FOV = 50;
const DOT_PX = 0.0058;               // dot radius as a fraction of camera distance (about 3.5 px on a 500 px canvas)
const MIN_DOT = 3;
const LIFT = 6;                      // a pin at the feet of a mob: the dot sits a little above the floor
const REACH = { mouse: 14, touch: 24 };
const MAX_TAGS = 260;
const SPREAD = { min: 0.4, max: 3, step: 0.1 };

type Item = { id: string; pin: boolean; num: string; text: string; v: Vector3; color: string; mesh: Mesh; k: number; layer: 'pin' | 'link' };
type Status = 'idle' | 'loading' | 'ready' | 'none' | 'error';
type Box = { cx: number; cy: number; cz: number; r: number };

type Ctx = {
  renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; controls: OrbitControls; clip: Plane;
  slabsG: Group; meshG: Group; dynG: Group; gPathers: Group; gLinks: Group; gPins: Group;
  halo: Mesh; items: Item[]; slabTags: { text: string; color: string; v: Vector3 }[];
  lineMats: LineMaterial[]; dynFree: (() => void)[]; slabFree: (() => void)[];
  wall: Mesh | null; floor: Mesh | null;
  sel: string | null; hover: string | null; clipY: number; showPins: boolean; showLinks: boolean;
  box: Box; moved: boolean; w: number; h: number; raf: number; dead: boolean; tags: HTMLDivElement[];
  request: () => void; fit: () => void;
};

const tmpV = new Vector3();
const toThree = (p: Pt3): [number, number, number] => [-p[0], p[2], -p[1]];

const TAG_BASE = 'position:absolute;display:none;pointer-events:none;white-space:nowrap;border-radius:3px;font:11px system-ui,sans-serif;';
const TAG_LOOK = {
  num: 'padding:0 4px;min-width:16px;text-align:center;font-weight:700;background:#0a0e13cc;border:1px solid',
  full: 'padding:2px 6px;font-size:12px;color:#f0f6fc;background:#161b22;border:1px solid #f0f6fc',
  slab: 'padding:1px 6px;font-weight:600;background:#0a0e13cc;border:1px solid',
} as const;

const disposeMat = (m: Material | Material[]) => (Array.isArray(m) ? m : [m]).forEach(x => x.dispose());

export default function Plan3D({ zone, extraMobs, plan, skipOptional, variant, onSelect, onFail }: Plan3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const selectRef = useRef(onSelect);
  const failRef = useRef(onFail);
  selectRef.current = onSelect;
  failRef.current = onFail;

  const stack = variant === 'b';
  const [spread, setSpread] = useState(1);
  const [layers, setLayers] = useState({ pathers: true, links: true });
  const [clipKey, setClipKey] = useState('');
  const [wallsOn, setWallsOn] = useState(true);
  // phones: the second mesh (the floors, up to a megabyte) waits until asked for
  const [floorsOn, setFloorsOn] = useState(() => typeof window === 'undefined' || window.innerWidth >= 820);
  const [wallStatus, setWallStatus] = useState<Status>('idle');
  const [floorStatus, setFloorStatus] = useState<Status>('idle');
  const [tries, setTries] = useState(0);
  const [sel, setSel] = useState<string | null>(null);

  const spacing = baseSpacing(zone.bounds) * spread;
  const view = useMemo<View3D>(
    () => buildView3D({ zone, extraMobs, plan, skipOptional, mode: stack ? 'stack' : 'mesh', spacing }),
    [zone, extraMobs, plan, skipOptional, stack, spacing],
  );
  const viewRef = useRef(view);
  viewRef.current = view;
  const wallsRef = useRef(wallsOn);
  wallsRef.current = wallsOn;
  const guessed = view.pins.filter(p => p.src === 'near' || p.src === 'floor').length;
  const clipFloors = useMemo(() => floorOrder(zone.floors).reverse(), [zone.floors]);
  const clipZ = !stack && clipKey ? clipHeight(zone.floors, clipKey) : null;

  // ── the renderer, once ─────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current, layer = layerRef.current;
    if (!host || !layer) return;
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
    dom.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
    host.insertBefore(dom, host.firstChild);

    const scene = new Scene();
    scene.add(new AmbientLight(0xffffff, 2.0));
    const sun = new DirectionalLight(0xffffff, 2.4);
    sun.position.set(-0.5, 1, 0.6);
    scene.add(sun);
    const camera = new PerspectiveCamera(FOV, 1, 5, 80000);
    const controls = new OrbitControls(camera, dom);
    controls.screenSpacePanning = true;
    controls.minDistance = 30;
    controls.maxPolarAngle = Math.PI * 0.495;

    const clip = new Plane(new Vector3(0, -1, 0), 0);   // keeps y <= constant: a floor clip hides what is above
    const slabsG = new Group(), meshG = new Group(), dynG = new Group();
    const gPathers = new Group(), gLinks = new Group(), gPins = new Group();
    dynG.add(gPathers, gLinks, gPins);
    scene.add(slabsG, meshG, dynG);
    const halo = new Mesh(new SphereGeometry(1, 12, 8), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false }));
    halo.renderOrder = 4;
    halo.visible = false;
    scene.add(halo);

    const c: Ctx = {
      renderer, scene, camera, controls, clip, slabsG, meshG, dynG, gPathers, gLinks, gPins, halo,
      items: [], slabTags: [], lineMats: [], dynFree: [], slabFree: [], wall: null, floor: null,
      sel: null, hover: null, clipY: Infinity, showPins: true, showLinks: true,
      box: { cx: 0, cy: 0, cz: 0, r: 2000 }, moved: false, w: 0, h: 0, raf: 0, dead: false, tags: [],
      request: () => {
        if (c.raf || c.dead) return;
        c.raf = requestAnimationFrame(() => { c.raf = 0; draw(); });
      },
      fit: () => {
        const half = Math.tan((FOV * Math.PI) / 360), aspect = c.w && c.h ? c.w / c.h : 1;
        const d = (c.box.r * (stack ? 1.3 : 0.95)) / Math.min(half, half * aspect);
        controls.target.set(c.box.cx, c.box.cy, c.box.cz);
        camera.position.copy(controls.target).addScaledVector(tmpV.set(0.4, 0.5, 1).normalize(), d);
        controls.maxDistance = Math.max(4000, c.box.r * 6);
        controls.update();
        c.request();
      },
    };
    ctxRef.current = c;

    const tagAt = (i: number) => {
      while (c.tags.length <= i) { const t = document.createElement('div'); layer.appendChild(t); c.tags.push(t); }
      return c.tags[i];
    };
    // screen position of a three-frame point, or null when it is behind the camera
    const project = (v: Vector3) => {
      tmpV.copy(v).project(camera);
      if (tmpV.z > 1) return null;
      return { px: (tmpV.x * 0.5 + 0.5) * c.w, py: (-tmpV.y * 0.5 + 0.5) * c.h };
    };
    const shown = (it: Item) => (it.layer === 'pin' ? c.showPins : c.showLinks) && it.v.y <= c.clipY + LIFT + 1;
    const placeLabels = () => {
      let used = 0;
      const put = (text: string, look: string, color: string, v: Vector3, dx: number, dy: number, centre: boolean) => {
        if (used >= MAX_TAGS) return;
        const s = project(v);
        if (!s) return;
        const t = tagAt(used++);
        t.style.cssText = TAG_BASE + look + (color ? ';color:' + color + ';border-color:' + color : '') + ';display:block';
        t.textContent = text;
        const tw = t.offsetWidth;
        t.style.left = `${Math.max(2, Math.min(c.w - tw - 2, s.px + dx - (centre ? tw / 2 : 0)))}px`;
        t.style.top = `${Math.max(2, Math.min(c.h - 22, s.py + dy))}px`;
      };
      for (const s of c.slabTags) if (s.v.y <= c.clipY + 1) put(s.text, TAG_LOOK.slab + (c.w < 600 ? ';font-size:10px;padding:0 4px' : ''), s.color, s.v, 0, -10, false);
      for (const it of c.items) if (it.pin && shown(it) && it.id !== c.sel && it.id !== c.hover) put(it.num, TAG_LOOK.num, it.color, it.v, 0, -26, true);
      for (const id of new Set([c.sel, c.hover])) {
        const it = id ? c.items.find(x => x.id === id) : undefined;
        if (it && shown(it)) put(it.text, TAG_LOOK.full, '', it.v, 12, -34, false);
      }
      for (let i = used; i < c.tags.length; i++) c.tags[i].style.display = 'none';
    };

    function draw() {
      if (c.dead || !c.w || !c.h) return;
      for (const it of c.items) {
        const r = Math.max(MIN_DOT, camera.position.distanceTo(it.v) * DOT_PX) * it.k;
        it.mesh.scale.setScalar(r);
        it.mesh.visible = shown(it);
      }
      const hi = c.sel ? c.items.find(x => x.id === c.sel) : undefined;
      c.halo.visible = !!hi && shown(hi);
      if (hi) {
        c.halo.position.copy(hi.v);
        c.halo.scale.setScalar(Math.max(MIN_DOT, camera.position.distanceTo(hi.v) * DOT_PX) * hi.k * 1.9);
      }
      renderer.clippingPlanes = c.clipY === Infinity ? [] : [clip];
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
      for (const m of c.lineMats) m.resolution.set(c.w, c.h);
      if (!c.moved) c.fit(); else c.request();
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(host);
    controls.addEventListener('change', c.request);
    controls.addEventListener('start', () => { c.moved = true; });

    // hover (mouse) and tap, by nearest projected marker, as the replay picks raiders
    const hit = (x: number, y: number, reach: number): Item | null => {
      let best: Item | null = null, bd = reach * reach;
      for (const it of c.items) {
        if (!shown(it)) continue;
        const s = project(it.v);
        if (!s) continue;
        const q = (s.px - x) ** 2 + (s.py - y) ** 2;
        if (q <= bd) { bd = q; best = it; }
      }
      return best;
    };
    const local = (e: PointerEvent) => { const r = dom.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    let down: { x: number; y: number } | null = null;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.buttons) return;
      const p = local(e), it = hit(p.x, p.y, REACH.mouse);
      const id = it ? it.id : null;
      if (id !== c.hover) { c.hover = id; dom.style.cursor = id ? 'pointer' : ''; c.request(); }
    };
    const onDown = (e: PointerEvent) => { down = local(e); };
    const onUp = (e: PointerEvent) => {
      const p = local(e);
      if (down && Math.abs(p.x - down.x) + Math.abs(p.y - down.y) <= 4) {
        const it = hit(p.x, p.y, e.pointerType === 'mouse' ? REACH.mouse : REACH.touch);
        setSel(it ? it.id : null);
        if (it && it.pin) selectRef.current(it.id.slice(4));
      }
      down = null;
    };
    const onLeave = () => { if (c.hover) { c.hover = null; c.request(); } };
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('pointerleave', onLeave);

    return () => {
      c.dead = true;
      if (c.raf) cancelAnimationFrame(c.raf);
      ctxRef.current = null;
      ro.disconnect();
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointerleave', onLeave);
      controls.dispose();
      c.dynFree.forEach(f => f());
      c.slabFree.forEach(f => f());
      for (const m of [c.wall, c.floor]) if (m) { m.geometry.dispose(); disposeMat(m.material); }
      halo.geometry.dispose();
      disposeMat(halo.material);
      renderer.dispose();
      renderer.forceContextLoss();
      dom.remove();
      for (const t of c.tags) t.remove();
    };
  }, []);

  // ── 'b': the slabs and the zone's own wall lines on them (again when the spread moves) ──
  useEffect(() => {
    const c = ctxRef.current;
    if (!c || !stack) return;
    c.slabFree.forEach(f => f());
    c.slabFree = [];
    c.slabsG.clear();
    c.slabTags = [];
    const view = viewRef.current;
    const B = zone.bounds, wdt = B.x1 - B.x0, hgt = B.y1 - B.y0;
    const cx = -(B.x0 + B.x1) / 2, cz = -(B.y0 + B.y1) / 2;
    const own = <T extends { dispose(): void }>(o: T) => { c.slabFree.push(() => o.dispose()); return o; };
    const planeGeo = own(new PlaneGeometry(wdt, hgt));
    const edge = [-B.x0, -B.y0, -B.x1, -B.y0, -B.x1, -B.y1, -B.x0, -B.y1];
    const keys: Record<string, number[]> = zone.walls;
    for (const s of view.slabs) {
      const col = new Color(s.color);
      const pm = own(new MeshBasicMaterial({ color: col, transparent: true, opacity: 0.07, side: DoubleSide, depthWrite: false, depthTest: false }));
      const plane = new Mesh(planeGeo, pm);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(cx, s.h, cz);
      plane.renderOrder = 0;
      c.slabsG.add(plane);
      const eg = own(new BufferGeometry());
      eg.setAttribute('position', new Float32BufferAttribute([edge[0], s.h, edge[1], edge[2], s.h, edge[3], edge[4], s.h, edge[5], edge[6], s.h, edge[7]], 3));
      c.slabsG.add(Object.assign(new LineLoop(eg, own(new LineBasicMaterial({ color: col, transparent: true, opacity: 0.35, depthTest: false }))), { renderOrder: 1 }));
      const w = keys[s.key];
      if (w && w.length >= 4) {
        const pos = new Float32Array((w.length / 4) * 6);
        for (let i = 0, o = 0; i + 3 < w.length; i += 4, o += 6) { pos[o] = -w[i]; pos[o + 1] = s.h; pos[o + 2] = -w[i + 1]; pos[o + 3] = -w[i + 2]; pos[o + 4] = s.h; pos[o + 5] = -w[i + 3]; }
        const g = own(new BufferGeometry());
        g.setAttribute('position', new Float32BufferAttribute(pos, 3));
        c.slabsG.add(Object.assign(new LineSegments(g, own(new LineBasicMaterial({ color: col, transparent: true, opacity: 1, depthTest: false }))), { renderOrder: 1 }));
      }
      c.slabTags.push({ text: s.short, color: s.color, v: new Vector3(-B.x1, s.h, -B.y0) });
    }
    // four posts joining the lowest slab to the highest, so the slabs read as one stack
    if (view.slabs.length > 1) {
      const lo = view.slabs[0].h, hi = view.slabs[view.slabs.length - 1].h;
      const p = new Float32Array(24);
      [[-B.x0, -B.y0], [-B.x1, -B.y0], [-B.x1, -B.y1], [-B.x0, -B.y1]].forEach(([x, z], i) => p.set([x, lo, z, x, hi, z], i * 6));
      const g = own(new BufferGeometry());
      g.setAttribute('position', new Float32BufferAttribute(p, 3));
      c.slabsG.add(Object.assign(new LineSegments(g, own(new LineBasicMaterial({ color: 0x30363d, transparent: true, opacity: 0.9, depthTest: false }))), { renderOrder: 0 }));
    }
    const h0 = view.bounds.h0, h1 = view.bounds.h1;
    const cy = (h0 + h1) / 2;
    c.box = { cx, cy, cz, r: Math.hypot(wdt / 2, hgt / 2, (h1 - h0) / 2) };
    if (!c.moved) c.fit(); else c.request();
    // the slabs move with the spacing only; a plan edit must not rebuild the walls or move the camera
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack, zone, spacing]);

  // ── 'c': the zone's mesh (walls, then floors) ──
  useEffect(() => {
    const c = ctxRef.current;
    if (!c || stack) return;
    const ac = new AbortController();
    const B0 = zone.bounds, hb = viewRef.current.bounds;
    c.box = { cx: -(B0.x0 + B0.x1) / 2, cy: (hb.h0 + hb.h1) / 2, cz: -(B0.y0 + B0.y1) / 2, r: Math.hypot((B0.x1 - B0.x0) / 2, (B0.y1 - B0.y0) / 2, (hb.h1 - hb.h0) / 2) };
    if (!c.moved) c.fit();
    setWallStatus('loading');
    fetch('/api/spectator/mesh?zone=' + encodeURIComponent(zone.zone), { signal: ac.signal })
      .then(async res => {
        if (ac.signal.aborted) return;
        if (res.status === 404) { setWallStatus('none'); return; }
        if (!res.ok) { setWallStatus('error'); return; }
        const u = unpackMesh(await res.arrayBuffer());
        if (ac.signal.aborted || c.dead) return;
        if (!u.tris) { setWallStatus('none'); return; }
        const wall = buildMesh(u);
        wall.visible = wallsRef.current;
        c.meshG.add(wall);
        c.wall = wall;
        const B = zone.bounds;
        c.box = {
          cx: -(u.min[0] + u.max[0]) / 2, cy: (u.min[2] + u.max[2]) / 2, cz: -(u.min[1] + u.max[1]) / 2,
          r: Math.hypot(Math.max(u.max[0] - u.min[0], B.x1 - B.x0) / 2, Math.max(u.max[1] - u.min[1], B.y1 - B.y0) / 2, (u.max[2] - u.min[2]) / 2),
        };
        setWallStatus('ready');
        if (!c.moved) c.fit(); else c.request();
      })
      .catch(() => { if (!ac.signal.aborted) setWallStatus('error'); });
    return () => {
      ac.abort();
      if (c.wall) { c.meshG.remove(c.wall); c.wall.geometry.dispose(); disposeMat(c.wall.material); c.wall = null; }
      if (c.floor) { c.meshG.remove(c.floor); c.floor.geometry.dispose(); disposeMat(c.floor.material); c.floor = null; }
      setFloorStatus('idle');
    };
  }, [zone, stack, tries]);

  useEffect(() => {
    const c = ctxRef.current;
    if (!c || stack || !floorsOn || wallStatus !== 'ready' || c.floor) return;
    const ac = new AbortController();
    setFloorStatus('loading');
    fetch('/api/spectator/mesh?floors=only&zone=' + encodeURIComponent(zone.zone), { signal: ac.signal })
      .then(async res => {
        if (ac.signal.aborted) return;
        if (res.status === 404) { setFloorStatus('none'); return; }
        if (!res.ok) { setFloorStatus('error'); return; }
        const u = unpackMesh(await res.arrayBuffer());
        if (ac.signal.aborted || c.dead) return;
        const built = u.tris ? buildFloorMesh(u).mesh : null;
        if (!built) { setFloorStatus('none'); return; }
        c.meshG.add(built);
        c.floor = built;
        setFloorStatus('ready');
        c.request();
      })
      .catch(() => { if (!ac.signal.aborted) setFloorStatus('error'); });
    return () => ac.abort();
  }, [zone, stack, floorsOn, wallStatus, tries]);

  useEffect(() => {
    const c = ctxRef.current;
    if (!c) return;
    if (c.wall) c.wall.visible = wallsOn;
    if (c.floor) c.floor.visible = floorsOn;
    c.request();
  }, [wallsOn, floorsOn, floorStatus]);

  // ── the plan: pins, legs, teleports, doors, pathers (again whenever the plan or the spacing moves) ──
  useEffect(() => {
    const c = ctxRef.current;
    if (!c) return;
    c.dynFree.forEach(f => f());
    c.dynFree = [];
    c.lineMats = [];
    for (const g of [c.gPathers, c.gLinks, c.gPins]) g.clear();
    c.items = [];
    const own = <T extends { dispose(): void }>(o: T) => { c.dynFree.push(() => o.dispose()); return o; };
    const u = Math.max(8, Math.max(zone.bounds.x1 - zone.bounds.x0, zone.bounds.y1 - zone.bounds.y0) / 260);   // one "dash", in world units
    const line = (g: Group, pts: Pt3[], color: string, width: number, opts: { dashed?: boolean; opacity?: number; order?: number } = {}) => {
      if (pts.length < 2) return;
      const geo = own(new LineGeometry());
      geo.setPositions(pts.flatMap(toThree));
      const mat = own(new LineMaterial({ color: new Color(color).getHex(), linewidth: width, transparent: true, opacity: opts.opacity ?? 1, depthTest: false, depthWrite: false }));
      if (opts.dashed) { mat.dashed = true; mat.dashSize = u * 1.2; mat.gapSize = u; }
      mat.resolution.set(c.w || 1, c.h || 1);
      c.lineMats.push(mat);
      const l = new Line2(geo, mat);
      if (opts.dashed) l.computeLineDistances();
      l.renderOrder = opts.order ?? 2;
      l.frustumCulled = false;
      g.add(l);
    };

    for (const pa of view.pathers) line(c.gPathers, pa.pts, PATHER_HEX, 1.4, { dashed: true, opacity: 0.8, order: 2 });

    const sphere = own(new SphereGeometry(1, 14, 10)), octa = own(new OctahedronGeometry(1)), box = own(new BoxGeometry(1.5, 1.5, 1.5));
    const mats = new Map<string, MeshBasicMaterial>();
    const matOf = (color: string, opacity: number) => {
      const k = color + opacity;
      let m = mats.get(k);
      if (!m) { m = own(new MeshBasicMaterial({ color: new Color(color), transparent: true, opacity, depthTest: false })); mats.set(k, m); }
      return m;
    };
    const addItem = (layer: 'pin' | 'link', g: Group, id: string, num: string, text: string, p: Pt3, color: string, geo: BufferGeometry, k: number, opacity: number) => {
      const mesh = new Mesh(geo, matOf(color, opacity));
      mesh.renderOrder = 5;
      mesh.frustumCulled = false;
      const v = new Vector3(...toThree([p[0], p[1], p[2] + LIFT]));
      mesh.position.copy(v);
      g.add(mesh);
      c.items.push({ id, pin: layer === 'pin', num, text, v, color, mesh, k, layer });
    };

    for (const lk of view.links) {
      if (lk.arc) line(c.gLinks, lk.arc, LINK_HEX, 2.2, { dashed: true, order: 3 });
      else if (lk.to && (lk.kind === 'flag' || lk.kind === 'locked')) line(c.gLinks, [lk.from, lk.to], lk.kind === 'flag' ? '#ffa657' : '#f85149', 1.2, { dashed: true, opacity: 0.8, order: 2 });
      const col = lk.kind === 'teleport' ? LINK_HEX : lk.kind === 'flag' ? '#ffa657' : lk.kind === 'locked' ? '#f85149' : '#58a6ff';
      addItem('link', c.gLinks, 'lnk:' + lk.i, '', lk.label, lk.from, col, lk.kind === 'teleport' ? octa : box, lk.kind === 'teleport' ? 0.9 : 0.75, 0.95);
      if (lk.to && lk.kind === 'teleport') addItem('link', c.gLinks, 'lnt:' + lk.i, '', lk.label + ' (lands here)', lk.to, col, sphere, 0.5, 0.8);
    }

    for (const lg of view.legs) {
      for (const w of lg.walks) line(c.gPins, w, '#0a0e13', 6, { opacity: 0.6, order: 2 });
      for (const w of lg.walks) line(c.gPins, w, lg.color, 3, { dashed: lg.dashed, order: 3 });
      if (lg.arc) line(c.gPins, lg.arc, LINK_HEX, 2.2, { dashed: true, order: 3 });
    }
    for (const p of view.pins) {
      const col = KIND_HEX[p.kind];
      const guess = p.src === 'near' || p.src === 'floor' ? ' · height guessed' : '';
      addItem('pin', c.gPins, 'pin:' + p.id, p.num, `${p.num}. ${p.label} · z ${Math.round(p.z)}${guess}`, [p.x, p.y, p.h], col, sphere, p.kind === 'boss' ? 1.35 : 1, p.optional ? 0.55 : 1);
    }
    c.gPathers.visible = layers.pathers;
    c.gLinks.visible = layers.links;
    c.showLinks = layers.links;
    c.request();
    // the layer flags are applied by their own effect; this one rebuilds, so it must not depend on them
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, zone]);

  useEffect(() => {
    const c = ctxRef.current;
    if (!c) return;
    c.gPathers.visible = layers.pathers;
    c.gLinks.visible = layers.links;
    c.showLinks = layers.links;
    c.request();
  }, [layers]);

  useEffect(() => {
    const c = ctxRef.current;
    if (!c) return;
    c.sel = sel;
    c.request();
  }, [sel]);

  // the floor clip: everything above the chosen floor's top is hidden; the plane sits at the clip height
  useEffect(() => {
    const c = ctxRef.current;
    if (!c) return;
    c.clipY = clipZ === null ? Infinity : clipZ;
    c.clip.constant = clipZ === null ? 0 : clipZ;
    c.request();
  }, [clipZ]);

  const zoom = (f: number) => {
    const c = ctxRef.current;
    if (!c) return;
    c.moved = true;
    tmpV.copy(c.camera.position).sub(c.controls.target);
    const d = Math.min(c.controls.maxDistance, Math.max(c.controls.minDistance, tmpV.length() / f));
    c.camera.position.copy(c.controls.target).add(tmpV.setLength(d));
    c.controls.update();
    c.request();
  };
  const fitZone = () => { const c = ctxRef.current; if (c) { c.moved = false; c.fit(); } };

  const label = stack
    ? `${zone.name}: the floors as stacked slabs with the plan between them`
    : `${zone.name}: the zone mesh in 3D with the plan at its real heights`;

  return (
    <div className="p3" ref={hostRef} role="img" aria-label={label}>
      <div className="p3-layer" ref={layerRef} />
      <div className="p3-bar">
        <span className="p3-tag">{stack ? 'Stacked floors' : 'True 3D'} · view only</span>
        <button type="button" className="sm" onClick={fitZone}>Fit zone</button>
        <button type="button" className="sm" onClick={() => zoom(1.4)} aria-label="Zoom in">+</button>
        <button type="button" className="sm" onClick={() => zoom(1 / 1.4)} aria-label="Zoom out">&minus;</button>
        {stack && (
          <label className="p3-field" title="How far apart the floors are drawn">Spread
            <input type="range" min={SPREAD.min} max={SPREAD.max} step={SPREAD.step} value={spread} onChange={e => setSpread(Number(e.target.value))} aria-label="Spacing between floors" />
            <span>{spread.toFixed(1)}&times;</span>
          </label>
        )}
        {!stack && (
          <label className="p3-field" title="Hide everything above a floor to look into it">Floor
            <select value={clipKey} onChange={e => setClipKey(e.target.value)} aria-label="Hide everything above a floor">
              <option value="">all floors</option>
              {clipFloors.map(f => <option key={f.key} value={f.key}>up to: {f.label.replace(/\s*\([^)]*\)/g, '')}</option>)}
            </select>
          </label>
        )}
        <label className="p3-chk"><input type="checkbox" checked={layers.pathers} onChange={e => setLayers(l => ({ ...l, pathers: e.target.checked }))} />Pathers</label>
        <label className="p3-chk"><input type="checkbox" checked={layers.links} onChange={e => setLayers(l => ({ ...l, links: e.target.checked }))} />Doors &amp; teleports</label>
        {!stack && <label className="p3-chk"><input type="checkbox" checked={wallsOn} onChange={e => setWallsOn(e.target.checked)} />Walls</label>}
        {!stack && <label className="p3-chk"><input type="checkbox" checked={floorsOn} onChange={e => setFloorsOn(e.target.checked)} />Floors</label>}
      </div>
      <div className="p3-foot">
        Drag to turn &middot; scroll to zoom &middot; right-drag to pan &middot; tap a pin to select it &middot; edit in 2D
        {guessed > 0 && <> &middot; {guessed} pin{guessed === 1 ? ' has' : 's have'} no height of {guessed === 1 ? 'its' : 'their'} own and stand{guessed === 1 ? 's' : ''} at the nearest mob&apos;s</>}
      </div>
      {!stack && wallStatus === 'loading' && <div className="p3-note">Loading the zone mesh…</div>}
      {!stack && wallStatus === 'none' && <div className="p3-note">No wall mesh for this zone yet. The plan is drawn without walls.</div>}
      {!stack && wallStatus === 'error' && <div className="p3-note">The mesh did not load. <button type="button" className="sm" onClick={() => setTries(t => t + 1)}>Retry</button></div>}
      {!stack && wallStatus === 'ready' && floorsOn && floorStatus === 'loading' && <div className="p3-note">Loading the floors…</div>}
      {!stack && wallStatus === 'ready' && floorsOn && floorStatus === 'error' && <div className="p3-note">The floors did not load. <button type="button" className="sm" onClick={() => setTries(t => t + 1)}>Retry</button></div>}
    </div>
  );
}
