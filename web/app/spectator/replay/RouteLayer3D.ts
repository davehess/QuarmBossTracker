// The raid's path in the 3D replay (lib/replayPath.ts has the rules). One object owned by Replay3D: it adds its lines to
// the scene, and Replay3D asks it to update before each render and to place its kill badges after. Nothing here runs on
// its own: no loop, no timers, so a paused replay still costs nothing.
//
// The path is the median position of the raiders in the zone, per frame, WITH the median z (the recorder stores every
// raider's z), so it sits on the floor it was walked on and needs no draping onto the mesh. Lines are fat lines
// (three's LineSegments2, a width in screen pixels) drawn with the depth test off, like the raiders: a path under a
// roof or behind a wall is still seen. The night's path is drawn faint, the part the playhead has passed solid (the
// same geometry, a different segment count), a head dot at the playhead, DOM badges for the numbered kills.
import { Mesh, MeshBasicMaterial, Scene, SphereGeometry, type PerspectiveCamera } from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { serverToThree } from '@/lib/zoneMesh';
import { buildSegments, headAt, segmentsDone, type PathPt, type RouteFeed, type Segments } from '@/lib/replayPath';

const PATH_HEX = 0x58a6ff;
const BG_HEX = 0x0d1117;
const LIFT = 2;                 // the path rides a little above the floor it was walked on
const MAX_PINS = 40;
const DOT_PX = 0.011;           // the same sphere-size-per-distance as Replay3D's dots
const KILL_LABEL_MS = 3 * 60 * 1000;
const PIN_BASE = 'position:absolute;display:none;pointer-events:none;white-space:nowrap;height:20px;border-radius:10px;padding:0 6px;'
  + 'text-align:center;font:600 12px/16px "Cascadia Code",Consolas,ui-monospace,monospace;box-sizing:border-box;';
const PIN_DONE = 'color:#f0f6fc;background:#161b22;border:2px solid #d29922;';
const PIN_TODO = 'color:#d29922;background:#161b22;border:2px dashed #d29922;opacity:0.6;';

type Project = (x: number, y: number, z: number) => { px: number; py: number } | null;

const fatMat = (width: number, opacity: number, color: number) =>
  new LineMaterial({ color, linewidth: width, transparent: true, opacity, depthTest: false, depthWrite: false });

export class RouteLayer3D {
  private faint: LineSegments2 | null = null;
  private halo: LineSegments2 | null = null;
  private solid: LineSegments2 | null = null;
  private faintGeo: LineSegmentsGeometry | null = null;
  private doneGeo: LineSegmentsGeometry | null = null;
  private series: readonly PathPt[] | null = null;
  private seg: Segments | null = null;
  private readonly dot: Mesh;
  private readonly ring: Mesh;
  private readonly mats: LineMaterial[] = [];
  private readonly faintMat = fatMat(3.5, 0.6, PATH_HEX);
  private readonly haloMat = fatMat(8, 0.55, BG_HEX);
  private readonly solidMat = fatMat(4.5, 1, PATH_HEX);
  private readonly sphere = new SphereGeometry(1, 14, 10);
  private readonly pins: HTMLDivElement[] = [];
  private marks: RouteFeed['marks'] = [];
  private t = 0;
  private on = false;

  constructor(private readonly scene: Scene, private readonly camera: PerspectiveCamera, private readonly host: HTMLElement) {
    this.mats.push(this.faintMat, this.haloMat, this.solidMat);
    this.ring = new Mesh(this.sphere, new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }));
    this.dot = new Mesh(this.sphere, new MeshBasicMaterial({ color: PATH_HEX, depthTest: false, depthWrite: false }));
    for (const m of [this.ring, this.dot]) { m.frustumCulled = false; m.visible = false; scene.add(m); }
    this.ring.renderOrder = 4;
    this.dot.renderOrder = 4.1;
  }

  setSize(w: number, h: number): void {
    for (const m of this.mats) m.resolution.set(w, h);
  }

  /** Brings the lines to `route` (null: nothing drawn). Cheap when only the playhead moved. */
  update(route: RouteFeed | null): void {
    this.on = !!route;
    this.marks = route?.marks ?? [];
    this.t = route?.t ?? 0;
    if (this.faint) this.faint.visible = this.on;
    if (this.halo) this.halo.visible = this.on;
    if (this.solid) this.solid.visible = this.on;
    this.dot.visible = false;
    this.ring.visible = false;
    if (!route) return;

    const head = headAt(route.series, route.t);
    this.updateWhole(route);
    if (head) {
      const [X, Y, Z] = serverToThree(head.x, head.y, head.z + LIFT);
      this.dot.position.set(X, Y, Z);
      this.ring.position.set(X, Y, Z);
      const r = Math.max(3, this.camera.position.distanceTo(this.dot.position) * DOT_PX * 0.8);
      this.dot.scale.setScalar(r);
      this.ring.scale.setScalar(r * 1.5);
      this.dot.visible = this.ring.visible = true;
    }
  }

  private updateWhole(route: RouteFeed): void {
    if (route.series !== this.series) {
      this.series = route.series;
      this.seg = buildSegments(route.series);
      this.disposeWhole();
      const seg = this.seg;
      if (seg.count > 0) {
        const arr = new Float32Array(seg.count * 6);
        for (let k = 0; k < seg.count; k++) {
          const a = route.series[seg.from[k]], b = route.series[seg.from[k] + 1];
          arr.set(serverToThree(a.x, a.y, a.z + LIFT), 6 * k);
          arr.set(serverToThree(b.x, b.y, b.z + LIFT), 6 * k + 3);
        }
        this.faintGeo = new LineSegmentsGeometry();
        this.faintGeo.setPositions(arr);
        this.doneGeo = new LineSegmentsGeometry();
        this.doneGeo.setPositions(arr);
        this.faint = new LineSegments2(this.faintGeo, this.faintMat);
        this.halo = new LineSegments2(this.doneGeo, this.haloMat);
        this.solid = new LineSegments2(this.doneGeo, this.solidMat);
        this.faint.renderOrder = 2;
        this.halo.renderOrder = 2.1;
        this.solid.renderOrder = 2.2;
        for (const l of [this.faint, this.halo, this.solid]) { l.frustumCulled = false; this.scene.add(l); }
      }
    }
    const seg = this.seg;
    if (!seg || !this.doneGeo || !this.faint || !this.halo || !this.solid) return;
    const done = segmentsDone(seg, route.t);
    this.doneGeo.instanceCount = done;
    this.halo.visible = this.solid.visible = done > 0;
    this.faint.visible = true;
  }

  /** The numbered kill badges, after the render (they are DOM, placed from the camera's view). */
  place(project: Project, w: number, h: number): void {
    let used = 0;
    if (this.on) {
      let latest = -1;
      this.marks.forEach((m, i) => { if (m.done && m.t <= this.t && this.t - m.t <= KILL_LABEL_MS && (latest < 0 || m.t > this.marks[latest].t)) latest = i; });
      for (let i = 0; i < this.marks.length && used < MAX_PINS; i++) {
        const m = this.marks[i];
        const s = project(m.x, m.y, m.z + LIFT);
        if (!s) continue;
        while (this.pins.length <= used) {
          const d = document.createElement('div');
          this.host.appendChild(d);
          this.pins.push(d);
        }
        const el = this.pins[used++];
        el.style.cssText = PIN_BASE + (m.done ? PIN_DONE : PIN_TODO) + 'display:block';
        el.textContent = i === latest ? `${m.n} · ${m.name}` : String(m.n);
        const tw = Math.max(20, el.offsetWidth);
        el.style.left = `${Math.max(2, Math.min(w - tw - 2, s.px - tw / 2))}px`;
        el.style.top = `${Math.max(2, Math.min(h - 22, s.py - 10))}px`;
      }
    }
    for (let i = used; i < this.pins.length; i++) this.pins[i].style.display = 'none';
  }

  private disposeWhole(): void {
    for (const l of [this.faint, this.halo, this.solid]) if (l) this.scene.remove(l);
    this.faint = this.halo = this.solid = null;
    this.faintGeo?.dispose();
    this.doneGeo?.dispose();
    this.faintGeo = this.doneGeo = null;
  }

  dispose(): void {
    this.disposeWhole();
    this.scene.remove(this.dot, this.ring);
    for (const m of this.mats) m.dispose();
    (this.dot.material as MeshBasicMaterial).dispose();
    (this.ring.material as MeshBasicMaterial).dispose();
    this.sphere.dispose();
    for (const p of this.pins) p.remove();
  }
}
