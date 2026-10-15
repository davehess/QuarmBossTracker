// Client-side owner of the 2D parchment background: fetches a zone's floors once, paints the floor wash into an
// offscreen canvas once per (zone, size bucket), and hands the board that canvas to draw under the wall lines.
// Browser only (fetch, canvas); the maths is in lib/zoneFloor.ts and the keys in lib/mapBackdrop.ts.
//
// Off the main thread, in practice: the mesh is the same `floors=only` request the 3D view makes (so the browser's
// one-day cache serves whichever view asks second), shaded in one pass (~60k triangles, a few ms), and the pixels
// are painted in slices of a few milliseconds each in idle time (requestIdleCallback, a short timeout where it is
// missing), never in one block. Until a zone's raster exists the board shows paper alone; when a pane crosses a
// size bucket the previous raster keeps showing until the new one is done. Redraw is by bucket, not by pixel.
import { unpackMesh } from './zoneMesh';
import { FloorRaster, planRaster, shadeFloors, PAPER_RGB, type FloorShade, type RasterPlan } from './zoneFloor';
import { lruSet, parchmentKey, rasterBucket } from './mapBackdrop';
import type { View } from './spectator';

export type ParchmentStatus = 'idle' | 'loading' | 'ready' | 'none' | 'error';
export type ParchmentLayer = { canvas: HTMLCanvasElement; plan: RasterPlan };

type Shape = { status: ParchmentStatus; fs: FloorShade | null; pos: Float32Array | null };

const MAX_SHAPES = 4;     // zones whose shaded floors are kept (a split screen shows two)
const MAX_LAYERS = 4;     // rasters kept (two zones, each possibly at two buckets while a resize settles)
const SLICE_MS = 6;       // paint budget per slice: well inside a 16 ms frame
const IDLE_TIMEOUT_MS = 250;

type Idle = { timeRemaining: () => number };
const whenIdle = (fn: (d: Idle) => void) => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: IDLE_TIMEOUT_MS });
  else setTimeout(() => fn({ timeRemaining: () => SLICE_MS }), 16);
};

export class ParchmentStore {
  private shapes = new Map<string, Shape>();
  private layers = new Map<string, ParchmentLayer>();
  private building = new Set<string>();
  private aborts = new Map<string, AbortController>();
  private dead = false;

  /** `onChange` is called when a status changes or a raster lands: redraw, and refresh anything that shows the status. */
  constructor(private readonly onChange: () => void) {}

  status(zone: string): ParchmentStatus {
    return this.shapes.get(zone)?.status ?? 'idle';
  }

  /**
   * The raster to draw for a pane of w x h CSS pixels, or null while there is none yet. Cheap enough for every
   * frame: a key lookup. It starts the fetch and the paint as a side effect, once.
   */
  layer(zone: string, w: number, h: number): ParchmentLayer | null {
    const bucket = rasterBucket(w, h);
    const key = parchmentKey(zone, bucket);
    const have = this.layers.get(key);
    if (have) return have;
    const shape = this.shapes.get(zone);
    if (!shape) this.fetchShape(zone);
    else if (shape.status === 'ready') this.build(zone, bucket);
    // The raster of another bucket for this zone is a fine stand-in while the right one is painted.
    for (const [k, l] of this.layers) if (k.startsWith(zone + '|')) return l;
    return null;
  }

  retry(zone: string) {
    if (this.shapes.get(zone)?.status === 'error') { this.shapes.delete(zone); this.onChange(); }
  }

  dispose() {
    this.dead = true;
    for (const a of this.aborts.values()) a.abort();
    this.aborts.clear();
    this.layers.clear();
    this.shapes.clear();
  }

  private setShape(zone: string, s: Shape) {
    const evicted = lruSet(this.shapes, zone, s, MAX_SHAPES);
    for (const z of evicted) for (const k of [...this.layers.keys()]) if (k.startsWith(z + '|')) this.layers.delete(k);
    this.onChange();
  }

  private fetchShape(zone: string) {
    this.setShape(zone, { status: 'loading', fs: null, pos: null });
    const ac = new AbortController();
    this.aborts.set(zone, ac);
    const fail = (status: ParchmentStatus) => { if (!this.dead && !ac.signal.aborted) this.setShape(zone, { status, fs: null, pos: null }); };
    fetch('/api/spectator/mesh?floors=only&zone=' + encodeURIComponent(zone), { signal: ac.signal })
      .then(async res => {
        if (res.status === 404) return fail('none');
        if (!res.ok) return fail('error');
        const u = unpackMesh(await res.arrayBuffer());
        if (this.dead || ac.signal.aborted) return;
        const fs = u.tris ? shadeFloors(u.pos) : null;
        if (!fs || !fs.n) return fail('none');
        this.setShape(zone, { status: 'ready', fs, pos: u.pos });
      })
      .catch(() => fail('error'))
      .finally(() => { if (this.aborts.get(zone) === ac) this.aborts.delete(zone); });
  }

  private build(zone: string, bucket: number) {
    const key = parchmentKey(zone, bucket);
    const shape = this.shapes.get(zone);
    if (this.building.has(key) || !shape?.fs || !shape.pos) return;
    this.building.add(key);
    const { fs, pos } = shape;
    const plan = planRaster(fs.min[0], fs.max[0], fs.min[1], fs.max[1], bucket);
    const job = new FloorRaster(fs, pos, plan);
    const slice = (d: Idle) => {
      if (this.dead || this.shapes.get(zone)?.pos !== pos) { this.building.delete(key); return; }
      const budget = Math.max(2, Math.min(SLICE_MS, d.timeRemaining() - 1));
      if (!job.step(performance.now() + budget)) { whenIdle(slice); return; }
      const canvas = document.createElement('canvas');
      canvas.width = plan.w;
      canvas.height = plan.h;
      canvas.getContext('2d')?.putImageData(new ImageData(job.rgba, plan.w, plan.h), 0, 0);
      this.building.delete(key);
      lruSet(this.layers, key, { canvas, plan }, MAX_LAYERS);
      this.onChange();
    };
    whenIdle(slice);
  }
}

// ── drawing ───────────────────────────────────────────────────────────────────────────────────────────────────

const GRAIN = 128;
const grainTiles = new WeakMap<CanvasRenderingContext2D, CanvasPattern | null>();

// A small tile of fixed pseudo-random flecks (dark and light, low alpha), repeated over the paper. It lives in
// screen space and is cheap to fill, so the grain stays fine at any zoom, which a grain baked into the zone raster
// would not. Seeded, so the same page always grains the same way.
function grainFor(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (grainTiles.has(ctx)) return grainTiles.get(ctx) ?? null;
  let pat: CanvasPattern | null = null;
  try {
    const tile = document.createElement('canvas');
    tile.width = tile.height = GRAIN;
    const tctx = tile.getContext('2d');
    if (tctx) {
      const img = tctx.createImageData(GRAIN, GRAIN);
      let s = 0x9e3779b9;
      const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      for (let i = 0; i < GRAIN * GRAIN; i++) {
        const r = rnd(), dark = rnd() < 0.55;
        const v = dark ? 70 : 255;
        img.data[4 * i] = v; img.data[4 * i + 1] = dark ? 50 : 250; img.data[4 * i + 2] = dark ? 30 : 235;
        img.data[4 * i + 3] = Math.round(r * r * (dark ? 26 : 34));
      }
      tctx.putImageData(img, 0, 0);
      pat = ctx.createPattern(tile, 'repeat');
    }
  } catch { /* no grain: plain paper is still a parchment */ }
  grainTiles.set(ctx, pat);
  return pat;
}

/** The paper under everything: a warm flat tone and the grain. Fills the whole pane. */
export function paintPaper(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.globalAlpha = 1;
  ctx.fillStyle = `rgb(${PAPER_RGB[0]},${PAPER_RGB[1]},${PAPER_RGB[2]})`;
  ctx.fillRect(0, 0, w, h);
  const g = grainFor(ctx);
  if (g) { ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
}

/** The floor wash, placed by the board's view (screen px = unit * scale + offset; the plan's u0/v0 are in picture units). */
export function drawParchmentLayer(ctx: CanvasRenderingContext2D, layer: ParchmentLayer, v: View, ox: number, oy: number) {
  const { plan, canvas } = layer;
  const s = v.scale / plan.k;
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, plan.u0 * v.scale + ox, plan.v0 * v.scale + oy, plan.w * s, plan.h * s);
}
