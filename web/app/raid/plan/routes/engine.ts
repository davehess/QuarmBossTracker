// @ts-nocheck
// The route planner's browser engine: the working single-file planner, ported as it was. It draws an SVG map (screen =
// (-x, -y), north up, the server's coordinates), owns the pins / legs / tracks interaction and renders the side panel.
// It is imperative DOM on purpose: this is the code the officers used on 2026-10-21 and "as is" is the brief, so what
// changed is only what had to: no document-wide ids (everything is looked up inside `root`), the zone's data comes in
// through `host`, saving / sharing / versions are the host's (React's) job, and the page has a read-only mode. Added on
// top of the port: floors with dimming, pathers, doors / locks / teleports, optional legs, splits with headcounts, the
// recorded-night overlay, and the fewest-raiders line.
//
// ts-nocheck: a DOM script of this shape (hundreds of querySelector casts) gains nothing from types; the parts that carry
// the rules (plan, build, follow, store, compare, toRaidRoute) live in lib/routePlanner and ARE typed and tested.
import { BRANCH_COLORS, KIND_KEYS, MAX_BRANCHES, MIN_BRANCHES, emptyPlan } from '@/lib/routePlanner/types';
import {
  MAX_SPLITS, activeSplits, allPins, branchPinLabel, dist, findPin, floorOf, legLength, legPoly, planLegs, planTotals, polyLen,
  pruneLines, r1, removePin, sanitize, uid,
} from '@/lib/routePlanner/plan';
import { buildPlanPins } from '@/lib/routePlanner/build';
import { createFollow, FOLLOW_R } from '@/lib/routePlanner/follow';
import { pinNumbers } from '@/lib/routePlanner/compare';
import { fewestLine } from '@/lib/routePlanner/fewest';
import { clampLeg, floorInView, legBarText, legFloorKeys, legIndexForPin, stepLeg } from '@/lib/routePlanner/legFocus';
import { bakeBends, legSig, routeLeg, viaNames } from '@/lib/routePlanner/navroute';
import { annotateRecorded, recText, recordedPolys, useRecordedRoutes } from '@/lib/routePlanner/recorded';
import { floorLevels, pinHeight } from '@/lib/routePlanner/view3d';
import { applyPen, draftAdd, draftFinish, draftLine, draftUndo, drawnLine, MAX_DRAW_BENDS, newDraft, thinStroke } from '@/lib/routePlanner/drawPath';
import { skeletonHtml } from './skeleton';

const NS = 'http://www.w3.org/2000/svg';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const fmtU = n => Math.round(n).toLocaleString('en-US') + ' u';
const fmtT = s => s < 90 ? Math.round(s) + ' s' : Math.floor(s / 60) + 'm ' + String(Math.round(s % 60)).padStart(2, '0') + 's';
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
const loc = (x, y) => `/loc ${r1(y)}, ${r1(x)}`;
const safeUrl = u => (/^https:\/\//.test(u) ? u : '#');
const KINDS = { boss: ['Boss', 'var(--red)'], named: ['Named', 'var(--orange)'], scripted: ['Scripted', 'var(--purple)'], objective: ['Objective', 'var(--green)'], door: ['Door / entrance', 'var(--blue)'], note: ['Note', 'var(--muted)'] };
const PATHER_COLOR = '#56d4dd', LINK_COLOR = '#d2a8ff', ACTUAL_COLOR = '#f0f6fc';
const FLOOR_FALLBACK = ['#a8793a', '#6b788c', '#8fb4d9', '#7fb685', '#c28bd8', '#d6a86a', '#6fb7c9', '#b5b56a'];

/**
 * host: { zone, extraMobs, onPlanNpcs, checklist, cardNote, fewest:Map<npc,row>, readOnly, initialPlan, onChange(plan),
 *         onPreview(on), onOptMode(mode), onTab(tab), legFocus (offer the "One leg" mode), onLegFocus(legKey | null),
 *         floorFollow (?v=floors: with One leg on and floor All, draw only the floors the current leg walks),
 *         draw (?v=draw: the Draw tool: a leg's path by points or with a pen, or a stretch of it redrawn),
 *         navRoute { load(): Promise<Router> } (offer "Walk route"), onRoutes(Map<legKey, Routed>) (the 3D view's copy),
 *         recorded (offer the "Recorded" route source: legs along the average of the recorded nights), onRecorded(Map<legKey, [x,y][]>)
 *         (the 3D view's copy), onNights(keys) (the nights ticked in Layers, for the 3D view), nightsNote (a line under that list) }
 * returns: { destroy, getPlan, setPlan, setStatus, setEdited, previewPlan, exitPreview, setTab, toast, setActual, nodes, selectPin, movePin }
 */
export function mountPlanner(root, host) {
  const Z = host.zone;
  const MOBS = [...Z.mobs, ...(host.extraMobs || [])];
  const MOB = Object.fromEntries(MOBS.map(m => [m.id, m]));
  const ON_PLAN = new Set(host.onPlanNpcs || []);
  const FEWEST = host.fewest || new Map();
  const follow = createFollow(Z.nights);
  const $ = (s, r) => (r || root).querySelector(s);
  const $$ = (s, r) => [...(r || root).querySelectorAll(s)];
  const cleanups = [];
  const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };

  root.innerHTML = skeletonHtml(Z, !!host.readOnly, !!host.legFocus, !!host.draw);

  /* ---------- state ---------- */
  let plan = host.initialPlan ? sanitize(host.initialPlan) : emptyPlan();
  let preview = null;                    // { saved: Plan } while a saved version is on the map
  let actual = null;                     // the recorded night laid over the plan: { path, stops, label }
  const editable = () => !host.readOnly && !preview;
  const LS_UI = 'rp-ui-' + Z.zone;
  const ui = Object.assign({
    mode: 'select', addKind: 'note', floor: 'all', optMode: 'include', buildOrder: 'greedy',
    nights: {}, layers: { avg: false, leash: true, bosses: true, scripted: true, trash: false, minor: false, pathers: false, links: true, actual: true }, tab: 'plan', help: false,
    legOnly: false, legFollow: true, walk: false, src: ''
  },(() => { try { return JSON.parse(lsGet(LS_UI) || '{}'); } catch (e) { return {}; } })());
  // how legs are drawn: straight (the plan's own line), walk (the walkable map), rec (the recorded nights);
  // an earlier visit that only had the Walk route toggle left walk: true
  if (!['straight', 'walk', 'rec'].includes(ui.src)) ui.src = ui.walk ? 'walk' : 'straight';
  ui.layers = Object.assign({ pathers: false, links: true, actual: true }, ui.layers);
  ui.mode = 'select';
  ui.addTo = 'main';
  if (ui.floor !== 'all' && !Z.floors.some(f => f.key === ui.floor)) ui.floor = 'all';
  // a night never ticked before is drawn, except with the live list (a dozen nights at once is a tangle): then the newest three
  Z.nights.forEach((n, i) => { if (!(n.key in ui.nights)) ui.nights[n.key] = host.nightsNote ? i < 3 : true; });
  const saveUi = () => lsSet(LS_UI, JSON.stringify({ addKind: ui.addKind, floor: ui.floor, optMode: ui.optMode, buildOrder: ui.buildOrder, nights: ui.nights, layers: ui.layers, tab: ui.tab, help: ui.help, legOnly: ui.legOnly, legFollow: ui.legFollow, walk: ui.src === 'walk', src: ui.src }));
  let view = { tx: 0, ty: 0, s: 0.2 };
  let selPin = null, followFrom = null, drag = null;
  // "One leg" mode: legIdx is the current leg, legSel the pin selection it last followed, legFramed the leg
  // the map was last framed on, legTold the leg the host (the 3D view) was last told about
  let legIdx = 0, legSel, legFramed = null, legTold = null;
  // Draw tool (?v=draw): drawKind is points or pen; drawLegKey the leg picked by a click or a card (One leg mode uses its current
  // leg instead, curLegKey); pdraft the points clicked so far; chain the new pins dropped with no leg picked; stroke the pen
  // stroke being dragged. A draw reaches the plan, and the save, only when it is finished; Esc drops it.
  let drawKind = 'points', drawLegKey = null, curLegKey = null, pdraft = null, chain = null, stroke = null;
  const legOn = () => !!host.legFocus && !!ui.legOnly;
  const skip = () => ui.optMode === 'skip';

  /* ---------- plan model ---------- */
  const pinById = id => { const h = findPin(plan, id); return h ? h.pin : undefined; };
  const lineFor = (k, create) => { let l = plan.lines.find(x => x.k === k); if (!l && create) { l = { k, pts: [], off: false }; plan.lines.push(l); } return l; };
  // the legs, each annotated with the route source in force: Recorded first (where the nights ran), the walk route for a leg no
  // night covers (or all of them in Walk), else the plan's own line
  const legs = () => {
    const L = planLegs(plan, skip(), Z.links);
    if (recOn()) annotateRecorded(L, follow);
    if (walkOn()) for (const lg of L) if (!(lg.rec && lg.rec.state === 'ok')) annotateWalk(lg);
    return L;
  };
  const pins = () => allPins(plan);
  const numbers = () => pinNumbers(plan);

  function changed(rerenderPanel = true) {
    plan.updatedAt = Date.now();
    pruneLines(plan);
    renderMap();
    if (rerenderPanel) renderPanel();
    host.onChange(plan);
  }

  /** Where a new pin goes: the main route, or the branch picked in the toolbar. */
  function pushPin(pin) {
    const [sid, bid] = String(ui.addTo || 'main').split('|');
    const split = plan.splits.find(s => s.id === sid), branch = split && split.branches.find(b => b.id === bid);
    if (branch) branch.pins.push(pin); else plan.pins.push(pin);
  }
  function deletePin(id) {
    const r = removePin(plan, id);
    if (!r.removed) return;
    if (selPin === id) selPin = null;
    if (r.droppedSplit) toast('That pin anchored a split, so the split (and its branch pins) went with it.');
    changed();
  }
  /** Floors */
  const floorOfZ = z => floorOf(Z.floors, z);
  const floorLabel = z => { const f = floorOfZ(z); return f ? f.label : ''; };
  // the floors the current leg walks while a view is following it (host.floorFollow, One leg, floor All), else null; renderMap sets it
  let autoFloors = null;
  const offFloor = z => { const f = floorOfZ(z); return !!f && !floorInView(f.key, ui.floor, autoFloors); };
  /** The heights the leg is known at, as runs (legFloorKeys): its pins, plus the walked route, the baked bends, or the teleport it jumps through. */
  const legRuns = lg => {
    const rp = recPolyOf(lg), rt = rp ? null : routedFor(lg), runs = [{ zs: [lg.a.z, lg.b.z] }];
    if (rt) { for (const s of rt.segs) runs.push({ zs: s.kind === 'jump' ? [s.from[2], s.to[2]] : s.pts.map(p => p[2]) }); return runs; }
    if (rp) { runs.push({ zs: [lg.a.z, lg.b.z], filled: true }); return runs; }   // the nights carry no height
    const lk = lg.jump && Z.links.find(l => l.label === lg.jump.label && l.from[0] === lg.jump.from[0] && l.from[1] === lg.jump.from[1]);
    if (lg.jump) runs.push({ zs: [lg.a.z, lk && lk.from[2]], filled: true }, { zs: [lk && lk.to && lk.to[2], lg.b.z], filled: true });
    else if (lg.ln && lg.ln.h && lg.ln.h.length) runs.push({ zs: [lg.a.z, ...lg.ln.h.map(p => p[2]), lg.b.z] });
    else runs.push({ zs: [lg.a.z, lg.b.z], filled: true });
    return runs;
  };

  /* ---------- build ---------- */
  function doBuild() {
    if (!editable()) return;
    const order = ui.buildOrder;
    const r = buildPlanPins({ zone: Z, mobs: MOBS, order, onPlanNpcs: host.onPlanNpcs || [], checklist: host.checklist || [] });
    plan.pins = r.pins; plan.lines = []; plan.splits = []; selPin = null;
    plan.built = { order, at: Date.now() };
    changed();
    $('#buildNote').textContent = r.note + (host.cardNote ? ' ' + host.cardNote : '');
    fit(true);
    toast(plan.pins.length + ' pins built' + (r.onPlanPins ? ', ' + r.onPlanPins + ' on the plan' : ''));
  }

  /* ---------- recorded tracks ---------- */
  const NSER = Z.nights.map(n => ({ key: n.key, color: n.color, kill: n.kill, s: n.pts }));
  const PIECES = [];
  for (const n of NSER) {
    let cur = [], pi = 0;
    const flush = () => { if (cur.length > 1) PIECES.push({ id: n.key + ':' + (pi++), night: n.key, color: n.color, pts: cur.map(p => [p[1], p[2]]) }); };
    for (let i = 0; i < n.s.length; i++) {
      const p = n.s[i];
      if (cur.length && p[0] - n.s[i - 1][0] > 15) { flush(); cur = []; }
      cur.push(p);
      if (cur.length >= 30) { flush(); cur = [p]; }
    }
    flush();
  }

  /** The nights ticked in Layers, for the 3D view's own "Recorded nights" layer. */
  const tellNights = () => { if (host.onNights) host.onNights(NSER.filter(n => ui.nights[n.key]).map(n => n.key)); };

  /* ---------- follow recorded paths ---------- */
  const legStats = (A, B) => follow.legStats(A, B);
  function followLeg(L, silent) {
    if (!editable()) return false;
    const r = follow.followPath(L.a, L.b);
    if (!r) { if (!silent) toast(NSER.length ? 'No recorded night passes both ' + L.a.label + ' and ' + L.b.label + ' (within ' + FOLLOW_R + ' units, in that order).' : 'No nights are recorded for this zone yet, so there is nothing to follow.'); return false; }
    const ln = lineFor(L.k, true); ln.pts = r.pts; ln.off = false; ln.follow = r.nights;
    if (!silent) { changed(); toast('Leg follows the average of ' + r.nights + ' recorded night' + (r.nights > 1 ? 's' : '')); }
    return true;
  }

  /** "Use recorded routes" / "Use recorded route": the legs' recorded average becomes their bend points, in one save. */
  function bakeRecorded(lgs) {
    if (!editable()) return;
    const r = useRecordedRoutes(plan, lgs, follow, 40);
    if (!r.baked) { toast(NSER.length ? 'No recorded night passes both pins' + (lgs.length === 1 ? '' : ' of any leg') + '.' : 'No nights are recorded for this zone yet.'); return; }
    changed();
    toast(r.baked + ' leg' + (r.baked === 1 ? '' : 's') + ' now keep the recorded route as bend points' + (r.skipped ? '; ' + r.skipped + ' had no recorded night through both pins' : '') + '.');
  }

  /* ---------- view ---------- */
  const svg = $('#map');
  const W = () => svg.clientWidth || 800, H = () => svg.clientHeight || 600;
  function applyView() {
    $('#world').setAttribute('transform', `translate(${view.tx} ${view.ty}) scale(${view.s})`);
    for (const n of $$('#markers [data-wx]')) n.setAttribute('transform', `translate(${view.tx - n.dataset.wx * view.s} ${view.ty - n.dataset.wy * view.s})` + (n.dataset.rot ? ` rotate(${n.dataset.rot})` : ''));
    svg.style.setProperty('--t2', view.s >= 0.24 ? 'inline' : 'none');
    svg.style.setProperty('--t3', view.s >= 0.45 ? 'inline' : 'none');
    const px = 500 * view.s; $('#scaleBar').style.width = px + 'px'; $('#scaleTxt').textContent = '500 u';
    closePopIfOff();
  }
  function fitBounds(x0, x1, y0, y1) {
    const sx0 = -x1, sx1 = -x0, sy0 = -y1, sy1 = -y0;
    const s = Math.min(W() / (sx1 - sx0), H() / (sy1 - sy0)) * 0.94;
    view.s = s; view.tx = W() / 2 - (sx0 + sx1) / 2 * s; view.ty = H() / 2 - (sy0 + sy1) / 2 * s; applyView();
  }
  function fit(smart) {
    const all = pins();
    if (smart && all.length > 1) {
      const xs = all.map(p => p.x), ys = all.map(p => p.y);
      fitBounds(Math.min(...xs) - 150, Math.max(...xs) + 150, Math.min(...ys) - 150, Math.max(...ys) + 150);
    } else fitBounds(Z.bounds.x0, Z.bounds.x1, Z.bounds.y0, Z.bounds.y1);
  }
  const focusView = () => fitBounds(Z.focus.x0, Z.focus.x1, Z.focus.y0, Z.focus.y1);
  function zoomAt(f, cx, cy) {
    const ns = Math.min(6, Math.max(0.04, view.s * f)); f = ns / view.s;
    view.tx = cx - (cx - view.tx) * f; view.ty = cy - (cy - view.ty) * f; view.s = ns; applyView();
  }
  const toWorld = (cx, cy) => { const r = svg.getBoundingClientRect(); return { x: -((cx - r.left - view.tx) / view.s), y: -((cy - r.top - view.ty) / view.s) }; };
  const toScreen = (x, y) => ({ x: view.tx - x * view.s, y: view.ty - y * view.s });
  function centerOn(x, y, minS) {
    if (minS && view.s < minS) view.s = minS;
    view.tx = W() / 2 + x * view.s; view.ty = H() / 2 + y * view.s; applyView();
  }

  /** What the map was framed on: the leg, and whether that was its walked route (framed again when the route arrives). */
  const frameKey = lg => lg.k + (recPolyOf(lg) ? '|rec' : routedFor(lg) ? '|walk' : '');
  /** Frame one leg (its bends and its teleport too): a quarter of its span of room around it, for the end pin's label and the bar over the map, and never closer than a 450 u box so a short leg does not fill the screen. */
  function frameLeg(lg) {
    const rp = recPolyOf(lg), rt = rp ? null : routedFor(lg), poly = rp || (rt ? routedPoly(rt) : legPoly(lg)), xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);   // the recorded route, else the walked one, when there is one
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const sx = Math.max(...xs) - Math.min(...xs), sy = Math.max(...ys) - Math.min(...ys);
    const hx = Math.max(sx * 0.75 + 60, 225), hy = Math.max(sy * 0.75 + 60, 225);
    fitBounds(cx - hx, cx + hx, cy - hy, cy + hy);
  }

  /* ---------- walk route ----------
     A VIEW, not the plan: with it on, each leg is drawn along the server's own walkable map (lib/routePlanner/navroute.ts), and
     its length is the walked length; the plan keeps the straight or bent line. The map downloads only when the toggle is first
     turned on. Routes are worked out one leg per tick (the current leg first) so the page never stalls, and a leg that has no
     route, or a map that did not load, falls back to its own line and says so. "Use this route" bakes a route into bends. */
  let walkState = 'idle', walkErr = '', router = null, destroyed = false;      // idle | loading | ready | failed
  const routes = new Map();               // leg key -> { sig, routed: Routed | null }
  const routeQueue = new Map();           // leg key -> { sig, spec } still to work out
  let routeTimer = 0, lastRoutePaint = 0, routesTold = '', recTold = '';
  // walk routes are wanted in Walk (every leg) and in Recorded (only for a leg no night covers: legs() annotates just those)
  const walkOn = () => !!host.navRoute && (ui.src === 'walk' || ui.src === 'rec');
  const recOn = () => !!host.recorded && ui.src === 'rec';
  const REAL_LINKS = Z.links.filter(l => l.kind !== 'step').length;   // the step bridges are for the router only
  const LEVELS = floorLevels({ floors: Z.floors, mobs: MOBS, pathers: Z.pathers, links: Z.links });
  const pinPt = p => [p.x, p.y, pinHeight(p, MOBS, LEVELS).z];
  const specOf = lg => {
    const tp = lg.jump ? Z.links.find(t => t.kind === 'teleport' && t.to && t.label === lg.jump.label) : null;
    return { a: pinPt(lg.a), b: pinPt(lg.b), bends: lg.pts, known: lg.ln && lg.ln.h, jump: tp ? { from: tp.from, to: tp.to, label: tp.label } : undefined };
  };
  function annotateWalk(lg) {
    if (walkState === 'failed') { lg.walk = { state: 'none' }; return; }
    const spec = specOf(lg), sig = legSig(spec), e = routes.get(lg.k);
    if (e && e.sig === sig) {
      lg.walk = e.routed ? { state: 'ok', len: e.routed.walkLen, via: viaNames(e.routed), steps: e.routed.steps, ignoredBends: e.routed.ignoredBends } : { state: 'none' };
      return;
    }
    lg.walk = { state: 'pending' };
    if (walkState === 'ready') { routeQueue.set(lg.k, { sig, spec }); kickRoutes(); }
    else if (walkState === 'idle' && ui.src === 'rec') Promise.resolve().then(loadWalk);   // Recorded needs the walkable map only for a leg no night covers
  }
  /** The computed route of a leg, only when it is current for the leg as it stands. */
  const routedFor = lg => (walkOn() && lg.walk && lg.walk.state === 'ok' && routes.get(lg.k) ? routes.get(lg.k).routed : null);
  /** The polyline of a leg the Recorded source draws along the nights (pin to pin), or null when it is not one. */
  const recPolyOf = lg => { if (!lg.rec || lg.rec.state !== 'ok') return null; const r = follow.recorded(lg.a, lg.b); return r ? r.poly : null; };
  const routedPoly = rt => { const o = []; for (const s of rt.segs) { if (s.kind === 'walk') for (const p of s.pts) o.push([p[0], p[1]]); else o.push([s.from[0], s.from[1]], [s.to[0], s.to[1]]); } return o; };
  function kickRoutes() { if (!routeTimer && walkState === 'ready' && routeQueue.size) routeTimer = setTimeout(runRoutes, 30); }
  function runRoutes() {
    routeTimer = 0;
    if (destroyed || walkState !== 'ready' || !walkOn() || !routeQueue.size) return;
    if (drag && drag.moved) { routeTimer = setTimeout(runRoutes, 150); return; }   // not while a pin or a bend is being dragged
    const L = planLegs(plan, skip(), Z.links), cur = L[clampLeg(legIdx, L.length)];
    let k = cur && routeQueue.has(cur.k) ? cur.k : null;
    if (!k && !legOn()) k = routeQueue.keys().next().value;
    if (!k) return;                                   // One leg mode: only the current leg is worked out
    const { sig, spec } = routeQueue.get(k);
    routeQueue.delete(k);
    let routed = null;
    try { routed = routeLeg(router, spec); } catch (e) { routed = null; }
    routes.set(k, { sig, routed });
    const more = [...routeQueue.keys()].some(q => !legOn() || (cur && q === cur.k));
    if (!more || performance.now() - lastRoutePaint > 250) { lastRoutePaint = performance.now(); renderMap(); renderLegs(); }
    if (more) routeTimer = setTimeout(runRoutes, 0);
  }
  /** The walk routes the 3D view draws: the routes of the legs as they stand now. */
  function tellRoutes() {
    if (!host.onRoutes) return;
    const m = new Map();
    const L = planLegs(plan, skip(), Z.links);
    if (recOn()) annotateRecorded(L, follow);
    if (walkOn()) for (const lg of L) { const e = routes.get(lg.k); if (!(lg.rec && lg.rec.state === 'ok') && e && e.routed && e.sig === legSig(specOf(lg))) m.set(lg.k, e.routed); }
    const tag = [...m].map(([k, r]) => k + ':' + r.walkLen.toFixed(1)).join('|');
    if (tag !== routesTold) { routesTold = tag; host.onRoutes(m); }
    // and the recorded legs, for the same view
    if (host.onRecorded) {
      const rec = recOn() ? recordedPolys(L, follow) : new Map();
      const rtag = [...rec].map(([k, p]) => k + ':' + p.length + ':' + p[p.length >> 1].join(',')).join('|');
      if (rtag !== recTold) { recTold = rtag; host.onRecorded(rec); }
    }
  }
  function updateWalkUi() {
    if (!host.legFocus) return;
    for (const b of $$('#srcGrp button')) { const on = b.dataset.src === ui.src; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    const n = $('#walkNote');
    const left = walkOn() && walkState === 'ready' && !legOn() ? routeQueue.size : 0;
    const msg = !walkOn() ? '' : walkState === 'loading' ? 'Loading walkable map…' : walkState === 'failed' ? walkErr + ' Legs keep their own line.' : left > 1 ? 'Finding walking routes… ' + left + ' to go' : '';
    n.textContent = msg; n.classList.toggle('on', !!msg); n.classList.toggle('err', walkOn() && walkState === 'failed');
    tellRoutes();
  }
  async function loadWalk() {
    if (!host.navRoute || walkState === 'loading') return;
    walkState = 'loading'; updateWalkUi();
    try { router = await host.navRoute.load(); walkState = 'ready'; }
    catch (e) { walkState = 'failed'; walkErr = (e && e.message) || 'The walkable map could not be loaded.'; toast(walkErr); }
    if (destroyed) return;
    renderMap(); renderLegs();
  }
  /** Straight / Walk / Recorded. Walk loads the walkable map when first picked; Recorded only when a leg turns out to need it. */
  function setSrc(src) {
    ui.src = src; saveUi();
    legFramed = null;   // the leg is framed on its drawn route, which just changed
    if (src === 'walk' && (walkState === 'idle' || walkState === 'failed')) loadWalk();
    renderMap(); renderLegs();
  }
  /** "Use this route": the computed path becomes the leg's own bend points (a jump is kept as a straight line between its ends). */
  function bakeLeg(lg) {
    const e = routes.get(lg.k);
    if (!editable() || !e || !e.routed) return;
    const h = bakeBends(e.routed, 40), pts = h.map(p => [p[0], p[1]]);
    const ln = lineFor(lg.k, true); ln.pts = pts; ln.h = h; ln.follow = undefined; delete ln.via;
    changed();
    toast('Leg keeps the walking route as ' + pts.length + ' bend point' + (pts.length === 1 ? '' : 's') + (e.routed.jumps.length ? '. A teleporter jump is a straight line in the saved leg.' : '.'));
  }

  /* ---------- static layers ---------- */
  function buildStatic() {
    const g = $('#gWalls'); g.innerHTML = '';
    Z.floors.forEach((f, fi) => {
      const k = f.key, a = Z.walls[k]; if (!a || !a.length) return; let d = '';
      for (let i = 0; i < a.length; i += 4) d += `M${-a[i]} ${-a[i + 1]}L${-a[i + 2]} ${-a[i + 3]}`;
      el('path', { d, 'data-floor': k, fill: 'none', stroke: f.color || `var(--wall-${k}, ${FLOOR_FALLBACK[fi % FLOOR_FALLBACK.length]})`, 'stroke-width': 1.1, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke', opacity: k === 'mid' ? .75 : .85, 'pointer-events': 'none' }, g);
    });
    const gg = $('#gGrid'); gg.innerHTML = '';
    const G = Z.grid;
    for (let x = G.x0; x <= G.x1; x += 500) el('line', { x1: -x, y1: -G.y1 + 100, x2: -x, y2: -G.y0 - 100, stroke: 'var(--grid)', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }, gg);
    for (let y = G.y0; y <= G.y1; y += 500) el('line', { x1: -G.x1, y1: -y, x2: -G.x0, y2: -y, stroke: 'var(--grid)', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }, gg);
    const z = $('#gZones'); z.innerHTML = '';
    const M = Z.marks;
    if (M && M.boxes) for (const b of M.boxes) {   // a leash band: the side the script leaves open runs to the zone's edge
      const B = Z.bounds, x0 = b.x0 ?? B.x0, x1 = b.x1 ?? B.x1, y0 = b.y0 ?? B.y0, y1 = b.y1 ?? B.y1;
      el('rect', { x: -x1, y: -y1, width: x1 - x0, height: y1 - y0, 'data-floor': b.f || '', fill: 'var(--orange)', 'fill-opacity': .04, stroke: 'var(--orange)', 'stroke-width': 1.4, 'stroke-dasharray': '4 6', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }, z);
    }
    if (M && M.leashX != null && M.warlordBox) {
      const edge = Z.bounds.x1 - 20, ly = Z.grid.y1 - 200;
      el('rect', { x: -edge, y: -ly, width: edge - M.leashX, height: 2 * ly, fill: 'var(--orange)', 'fill-opacity': .05, 'pointer-events': 'none' }, z);
      el('line', { x1: -M.leashX, y1: -ly, x2: -M.leashX, y2: ly, stroke: 'var(--orange)', 'stroke-width': 1.6, 'stroke-dasharray': '4 6', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }, z);
      const B = M.warlordBox;
      el('rect', { x: -B.x1, y: -B.y1, width: B.x1 - B.x0, height: B.y1 - B.y0, fill: 'var(--red)', 'fill-opacity': .05, stroke: 'var(--red)', 'stroke-width': 1.6, 'stroke-dasharray': '8 5', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }, z);
    }
    const av = $('#gAvg'); av.innerHTML = '';
    for (const l of Z.avg.legs) if (l.length) el('path', { d: 'M' + l.map(p => `${-p[0]} ${-p[1]}`).join('L'), fill: 'none', stroke: 'var(--gold)', 'stroke-width': 5, opacity: .35, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }, av);
  }
  function applyLayerVis() {
    for (const p of $$('#gWalls path')) p.style.display = floorInView(p.dataset.floor, ui.floor, autoFloors) ? '' : 'none';
    for (const r of $$('#gZones rect[data-floor]')) r.style.display = (!r.dataset.floor || floorInView(r.dataset.floor, ui.floor, autoFloors)) ? '' : 'none';
    $('#gZones').style.display = ui.layers.leash ? '' : 'none';
    $('#gAvg').style.display = ui.layers.avg ? '' : 'none';
    $$('#floorBtns button').forEach(b => {
      b.classList.toggle('active', b.dataset.floor === ui.floor);
      const inView = !!autoFloors && autoFloors.has(b.dataset.floor);   // ?v=floors: the floors the current leg walks
      b.classList.toggle('inview', inView);
      if (inView) b.title = 'The current leg walks this floor'; else b.removeAttribute('title');
    });
  }

  /* ---------- dynamic map ---------- */
  function mk(parent, wx, wy, extra) { const g = el('g', Object.assign({ 'data-wx': wx, 'data-wy': wy }, extra || {}), parent); g.setAttribute('transform', `translate(${view.tx - wx * view.s} ${view.ty - wy * view.s})`); return g; }
  function arrowAt(parent, x, y, angDeg, fill, size) {
    const g = mk(parent, x, y, { 'data-rot': r1(angDeg) }); g.setAttribute('transform', g.getAttribute('transform') + ` rotate(${r1(angDeg)})`);
    const s = size || 1;
    el('path', { d: `M${6 * s} 0L${-4 * s} ${-5 * s}L${-4 * s} ${5 * s}Z`, fill, stroke: 'var(--halo)', 'stroke-width': 1.5, 'pointer-events': 'none' }, g);
    return g;
  }
  const angleOf = (ax, ay, bx, by) => Math.atan2(-(by - ay), -(bx - ax)) * 180 / Math.PI;
  function shape(g, kind, r, opt) {
    const c = KINDS[kind][1], a = { fill: c, 'fill-opacity': opt ? 0 : .9, stroke: c, 'stroke-width': 2 };
    if (opt) a['stroke-dasharray'] = '3 2.5';
    if (kind === 'boss') { el('circle', { r: r + 2, fill: c, 'fill-opacity': .25, stroke: c, 'stroke-width': 2 }, g); el('circle', { r: 3, fill: c }, g); }
    else if (kind === 'named') el('path', { d: `M0 ${-r - 2}L${r + 2} 0L0 ${r + 2}L${-r - 2} 0Z`, ...a, 'fill-opacity': .85 }, g);
    else if (kind === 'scripted') { el('path', { d: `M0 ${-r - 2}L${r + 2} ${r}L${-r - 2} ${r}Z`, ...a, 'fill-opacity': .88, 'stroke-linejoin': 'round' }, g); }
    else if (kind === 'door') el('rect', { x: -r, y: -r, width: 2 * r, height: 2 * r, rx: 2, ...a }, g);
    else el('circle', { r, ...a }, g);
  }
  function label(g, text, dx, cls, color) {
    const t = el('text', { x: dx == null ? 12 : dx, y: 4, class: 'lbl-t ' + (cls || ''), fill: color || 'var(--text)' }, g); t.textContent = text; return t;
  }
  const inPlan = id => pins().some(p => p.mob === id);
  const mobOnCard = m => m.npc !== undefined && ON_PLAN.has(m.npc);
  const dimmed = (g, off) => { if (off) g.setAttribute('opacity', '.28'); return g; };
  /** A quadratic bend for a teleport: the control point sits off the middle of from -> to. */
  function curve(a, b) {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1];
    const cx = mx - dy * 0.22, cy = my + dx * 0.22;
    return { cx, cy, d: `M${-a[0]} ${-a[1]}Q${-cx} ${-cy} ${-b[0]} ${-b[1]}`, endAng: angleOf(cx, cy, b[0], b[1]) };
  }

  function renderMap() {
    const gm = $('#gMobs'), gp = $('#gPins'), gb = $('#gBends'), ga = $('#gArrows'), gl = $('#gLegs'), gt = $('#gTracks'), gd = $('#gDots');
    const gpa = $('#gPathers'), gli = $('#gLinks'), gmk = $('#gMarks'), gac = $('#gActual'), gas = $('#gActualStops');
    for (const g of [gm, gp, gb, ga, gl, gt, gd, gpa, gli, gmk, gac, gas]) g.innerHTML = '';
    const L = legs();
    // One leg mode: the current leg follows the selected pin; the map is framed on it when it changes
    let cur = null;
    if (legOn() && L.length) {
      if (selPin !== legSel) { legSel = selPin; legIdx = legIndexForPin(L, selPin, legIdx); }
      legIdx = clampLeg(legIdx, L.length); cur = L[legIdx];
      if (ui.legFollow && ui.mode !== 'addpin' && !chain && frameKey(cur) !== legFramed) frameLeg(cur);
    }
    legFramed = cur ? frameKey(cur) : null;
    curLegKey = cur ? cur.k : null;
    autoFloors = null;
    if (host.floorFollow && cur && ui.floor === 'all' && Z.floors.length > 1) { const k = legFloorKeys(Z.floors, legRuns(cur)); if (k.size) autoFloors = k; }
    const hidden = new Set(plan.hiddenTracks);
    for (const pc of PIECES) {
      if (!ui.nights[pc.night] || hidden.has(pc.id)) continue;
      const d = 'M' + pc.pts.map(p => `${-p[0]} ${-p[1]}`).join('L');
      el('path', { d, fill: 'none', stroke: 'var(--halo)', 'stroke-width': 4, opacity: .6, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }, gt);
      el('path', { d, fill: 'none', stroke: pc.color, 'stroke-width': 1.8, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }, gt);
      const hit = el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 11, 'vector-effect': 'non-scaling-stroke', 'data-act': 'track', 'data-id': pc.id, style: 'cursor:' + (editable() ? 'pointer' : 'default') }, gt);
      if (editable()) hit.appendChild(Object.assign(document.createElementNS(NS, 'title'), { textContent: 'Click to hide this piece of the ' + pc.night + ' track' }));
    }
    if (ui.layers.trash) for (const t of Z.trash) { const g = mk(gd, t.x, t.y); el('circle', { r: 2.6, fill: Z.trashColors[t.g] || '#888', opacity: .75 }, g); }
    if (ui.layers.minor) for (const t of Z.minor) { const g = mk(gd, t.x, t.y); el('circle', { r: 2.4, fill: 'var(--muted)', opacity: .7 }, g); }

    // pathers: where NPCs walk
    if (ui.layers.pathers) Z.pathers.forEach((pa, pi) => {
      const pts = pa.points; if (pts.length < 2) return;
      const off = !pts.some(q => { const f = floorOfZ(q[2]); return !f || floorInView(f.key, ui.floor, autoFloors); });
      const d = 'M' + pts.map(q => `${-q[0]} ${-q[1]}`).join('L') + (pa.loop ? 'Z' : '');
      const grp = dimmed(el('g', {}, gpa), off);
      el('path', { d, fill: 'none', stroke: PATHER_COLOR, 'stroke-width': 1.3, 'stroke-dasharray': pa.wander ? '1 5' : '4 4', opacity: .85, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }, grp);
      el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 12, 'vector-effect': 'non-scaling-stroke', 'data-act': 'pather', 'data-id': pi, style: 'cursor:pointer' }, grp);
      // direction arrows: one on each long enough segment, at most 14 a path
      const segs = pts.length - 1 + (pa.loop ? 1 : 0), every = Math.max(1, Math.ceil(segs / 14));
      for (let i = 0; i < segs; i += every) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 30) continue;
        const ag = arrowAt(gmk, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, angleOf(a[0], a[1], b[0], b[1]), PATHER_COLOR, .8);
        dimmed(ag, off);
      }
      const lg = mk(gmk, pts[0][0], pts[0][1]); dimmed(lg, off);
      label(lg, (pa.npc_names.join(', ') || 'pather').slice(0, 30) + (pa.wander ? ' (wanders)' : ''), 6, 't2', PATHER_COLOR);
    });

    // doors, locks and teleports
    if (ui.layers.links) Z.links.forEach((lk, li) => {
      if (lk.kind === 'step') return;   // a gap the walk route bridges, not a thing in the zone: never drawn
      const fOff = offFloor(lk.from[2]), tOff = lk.to ? offFloor(lk.to[2]) : fOff, off = fOff && tOff;
      const grp = dimmed(el('g', {}, gli), off);
      if (lk.kind === 'teleport' && lk.to) {
        const c = curve(lk.from, lk.to);
        el('path', { d: c.d, fill: 'none', stroke: LINK_COLOR, 'stroke-width': 2, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }, grp);
        el('path', { d: c.d, fill: 'none', stroke: 'transparent', 'stroke-width': 14, 'vector-effect': 'non-scaling-stroke', 'data-act': 'link', 'data-id': li, style: 'cursor:pointer' }, grp);
        dimmed(arrowAt(gmk, lk.to[0], lk.to[1], c.endAng, LINK_COLOR, 1.1), off);
      } else if (lk.to) {
        el('path', { d: `M${-lk.from[0]} ${-lk.from[1]}L${-lk.to[0]} ${-lk.to[1]}`, fill: 'none', stroke: lk.kind === 'flag' ? 'var(--gold)' : 'var(--red)', 'stroke-width': 1.2, 'stroke-dasharray': '2 4', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }, grp);
      }
      const ic = mk(gmk, lk.from[0], lk.from[1], { 'data-act': 'link', 'data-id': li, style: 'cursor:pointer' }); dimmed(ic, fOff);
      el('circle', { r: 13, fill: 'transparent' }, ic);
      if (lk.kind === 'teleport') { el('circle', { r: 6, fill: 'var(--panel)', stroke: LINK_COLOR, 'stroke-width': 2 }, ic); el('circle', { r: 2, fill: LINK_COLOR }, ic); }
      else if (lk.kind === 'zoneline') { el('rect', { x: -6, y: -6, width: 12, height: 12, rx: 2, fill: 'var(--panel)', stroke: 'var(--blue)', 'stroke-width': 2 }, ic); el('path', { d: 'M-3 0L3 0M0 -3L3 0L0 3', stroke: 'var(--blue)', 'stroke-width': 1.6, fill: 'none' }, ic); }
      else {   // a padlock: locked (red) or flagged (orange)
        const c = lk.kind === 'flag' ? 'var(--orange)' : 'var(--red)';
        el('path', { d: 'M-3.5 -1V-4a3.5 3.5 0 0 1 7 0V-1', fill: 'none', stroke: c, 'stroke-width': 1.8 }, ic);
        el('rect', { x: -5.5, y: -1, width: 11, height: 8, rx: 1.5, fill: 'var(--panel)', stroke: c, 'stroke-width': 1.8 }, ic);
      }
      label(ic, lk.label, 10, 't3', lk.kind === 'teleport' ? LINK_COLOR : 'var(--text)');
    });

    // the recorded night laid over the plan
    if (actual && ui.layers.actual) {
      if (actual.path && actual.path.length > 1) {
        const d = 'M' + actual.path.map(p => `${-p[0]} ${-p[1]}`).join('L');
        el('path', { d, fill: 'none', stroke: 'var(--halo)', 'stroke-width': 5, opacity: .7, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }, gac);
        el('path', { d, fill: 'none', stroke: ACTUAL_COLOR, 'stroke-width': 2.4, 'stroke-dasharray': '1 5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }, gac);
      }
      for (const s of actual.stops || []) {
        if (s.x == null || s.y == null) continue;
        const g = mk(gas, s.x, s.y);
        el('path', { d: 'M0 -9L9 0L0 9L-9 0Z', fill: 'var(--panel)', stroke: ACTUAL_COLOR, 'stroke-width': 2, 'pointer-events': 'none' }, g);
        const t = el('text', { y: 3.5, 'text-anchor': 'middle', class: 'pinnum', fill: ACTUAL_COLOR, style: `fill:${ACTUAL_COLOR};font-size:10px` }, g); t.textContent = s.n;
        label(g, s.name, 13, 't2', ACTUAL_COLOR);
      }
    }

    for (const m of MOBS) {
      const scripted = m.kind === 'scripted';
      if (scripted ? !ui.layers.scripted : !ui.layers.bosses) { if (m.id !== Z.start.mob) continue; }
      const pts = m.pts ? m.pts.map(p => ({ x: p[0], y: p[1] })) : [{ x: m.x, y: m.y }];
      pts.forEach((p, i) => {
        const g = dimmed(mk(gm, p.x, p.y, { 'data-act': 'mob', 'data-id': m.id, 'data-pt': i, style: 'cursor:pointer' }), offFloor(m.z));
        shape(g, m.kind, m.pts ? 5 : 7, false);
        el('circle', { r: 13, fill: 'transparent' }, g);
        if (i === 0) label(g, m.name, 12, m.tier === 1 ? '' : 't' + m.tier, KINDS[m.kind][1]);
        if (inPlan(m.id)) el('circle', { r: 12, fill: 'none', stroke: 'var(--green)', 'stroke-width': 1.5, 'stroke-dasharray': '2 3', 'pointer-events': 'none' }, g);
        if (mobOnCard(m) && i === 0) el('circle', { r: 17, fill: 'none', stroke: 'var(--gold)', 'stroke-width': 1.6, 'pointer-events': 'none' }, g);
      });
    }

    for (const lg of L) {
      if (lg.off && lg !== cur) continue;
      if (legOn() && lg !== cur) continue;
      const rp = recPolyOf(lg), rt = rp ? null : routedFor(lg);
      const poly = rp || (rt ? routedPoly(rt) : legPoly(lg));
      const colour = lg.branch ? lg.branch.branch.color : (rp || (lg.ln && lg.ln.follow) ? 'var(--green)' : 'var(--gold)');
      const dash = lg.dashed ? '8 6' : (walkOn() && lg.walk && lg.walk.state === 'none' ? '2 7' : '');   // dotted: asked for a walking route and there is none
      const draw = (pts, parent) => {
        const d = 'M' + pts.map(p => `${-p[0]} ${-p[1]}`).join('L');
        el('path', { d, fill: 'none', stroke: 'var(--halo)', 'stroke-width': 6, opacity: .7, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }, parent || gl);
        el('path', { d, fill: 'none', stroke: colour, 'stroke-width': 3, 'stroke-dasharray': dash, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }, parent || gl);
      };
      if (rp) draw(poly);
      else if (rt) {
        // the walked route: each walk drawn in runs, a run on another floor than the one picked dims like everything else there
        for (const sg of rt.segs) {
          if (sg.kind === 'jump') {
            const c = curve(sg.from, sg.to);
            const jg = dimmed(el('g', {}, gl), offFloor(sg.from[2]) && offFloor(sg.to[2]));
            el('path', { d: c.d, fill: 'none', stroke: LINK_COLOR, 'stroke-width': 2.2, 'stroke-dasharray': '2 5', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }, jg);
            continue;
          }
          const f = [], pts = sg.pts;
          for (let j = 0; j + 1 < pts.length; j++) f.push(offFloor((pts[j][2] + pts[j + 1][2]) / 2));
          let s = 0;
          for (let j = 1; j <= f.length; j++) if (j === f.length || f[j] !== f[s]) { draw(pts.slice(s, j + 1), dimmed(el('g', {}, gl), f[s])); s = j; }
        }
      } else if (lg.jump) {
        // walk to the teleport, jump (drawn as the teleport's own arrow, not counted), walk on from where it lands
        draw([[lg.a.x, lg.a.y], ...lg.pts, lg.jump.from]);
        draw([lg.jump.to, [lg.b.x, lg.b.y]]);
        const c = curve(lg.jump.from, lg.jump.to);
        el('path', { d: c.d, fill: 'none', stroke: LINK_COLOR, 'stroke-width': 2.2, 'stroke-dasharray': '2 5', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }, gl);
      } else draw(poly);
      const d = 'M' + poly.map(p => `${-p[0]} ${-p[1]}`).join('L');
      el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 14, 'vector-effect': 'non-scaling-stroke', 'data-act': 'leg', 'data-key': lg.k, style: 'cursor:' + (editable() ? (ui.mode === 'draw' ? 'crosshair' : 'copy') : 'default') }, gl);
      const total = polyLen(poly); let acc = 0, ax = poly[0][0], ay = poly[0][1], ang = 0;
      for (let i = 1; i < poly.length; i++) { const sl = Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]); if (acc + sl >= total / 2) { const t = (total / 2 - acc) / (sl || 1); ax = poly[i - 1][0] + (poly[i][0] - poly[i - 1][0]) * t; ay = poly[i - 1][1] + (poly[i][1] - poly[i - 1][1]) * t; ang = angleOf(poly[i - 1][0], poly[i - 1][1], poly[i][0], poly[i][1]); break; } acc += sl; }
      arrowAt(ga, ax, ay, ang, colour);
      if (editable()) {
        const many = lg.pts.length > 8;
        lg.pts.forEach((p, i) => { const b = mk(gb, p[0], p[1], { 'data-act': 'bend', 'data-key': lg.k, 'data-i': i, style: 'cursor:move' + (many ? ';display:var(--t3,none)' : '') }); el('circle', { r: many ? 3.5 : 6, fill: 'var(--panel)', stroke: colour, 'stroke-width': many ? 1.5 : 2 }, b); el('circle', { r: many ? 7 : 11, fill: 'transparent' }, b); });
      }
    }

    const nums = numbers();
    const branchOf = new Map();
    plan.splits.forEach(s => s.branches.forEach(b => b.pins.forEach(p => branchOf.set(p.id, b))));
    pins().forEach(p => {
      const g = dimmed(mk(gp, p.x, p.y, { 'data-act': 'pin', 'data-id': p.id, style: 'cursor:pointer' }), offFloor(p.z));
      const faint = !!cur && p.id !== cur.a.id && p.id !== cur.b.id;   // One leg mode: only the leg's two pins are at full strength
      if (faint) g.setAttribute('opacity', '.3');
      const c = KINDS[p.kind][1], br = branchOf.get(p.id);
      if (p.id === selPin) el('circle', { r: 17, fill: 'none', stroke: 'var(--gold)', 'stroke-width': 2.5 }, g);
      if (followFrom === p.id) el('circle', { r: 20, fill: 'none', stroke: 'var(--green)', 'stroke-width': 2.5, 'stroke-dasharray': '4 3' }, g);
      if (br) el('circle', { r: 15, fill: 'none', stroke: br.color, 'stroke-width': 2.4 }, g);
      el('circle', { r: 11, fill: p.optional ? 'var(--panel)' : c, 'fill-opacity': p.optional ? .85 : 1, stroke: c, 'stroke-width': 2.2, 'stroke-dasharray': p.optional ? '3 2.5' : '' }, g);
      const t = el('text', { y: 4, 'text-anchor': 'middle', class: 'pinnum', fill: p.optional ? c : '#fff', style: p.optional ? `fill:${c}` : '' }, g); t.textContent = nums.get(p.id);
      if (p.onPlan) el('circle', { cx: 9, cy: -9, r: 4, fill: 'var(--gold)', stroke: 'var(--halo)', 'stroke-width': 1.5, 'pointer-events': 'none' }, g);
      if (!faint) label(g, p.label, br ? 19 : 16, '', 'var(--text)');
    });
    applyView(); applyLayerVis();
    updateLegBar(L, cur);
    updateWalkUi();
    renderDraw(L);
  }

  /** The bar over the map, the toggle's state, the current card in the Legs tab, and a word to the host (the 3D view). */
  function updateLegBar(L, cur) {
    if (!host.legFocus) return;
    const on = legOn();
    $('#legBar').classList.toggle('on', on);
    const t = $('#legOnly'); t.classList.toggle('active', on); t.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) {
      $('#legText').textContent = cur ? legBarText(cur, legIdx, L.length, legStats(cur.a, cur.b).median) : 'No legs yet: a leg needs two pins.';
      $('#legPrev').disabled = !cur || legIdx <= 0; $('#legNext').disabled = !cur || legIdx >= L.length - 1;
    }
    markCurLeg();
    const key = cur ? cur.k : null;
    if (key !== legTold) { legTold = key; if (host.onLegFocus) host.onLegFocus(key); }
  }
  const markCurLeg = () => $$('#legList .leg').forEach(n => n.classList.toggle('cur', legOn() && +n.dataset.leg === legIdx));
  /** Make leg i the current one and select its start pin (the arrows, a leg card). */
  function setLeg(i) {
    const L = legs(); if (!L.length) return;
    legIdx = clampLeg(i, L.length); selPin = L[legIdx].a.id; legSel = selPin;
    closePop(); renderMap();
    $$('#pinList .pin').forEach(n => n.classList.toggle('sel', n.dataset.pid === selPin));
  }

  /* ---------- popups ---------- */
  let popFor = null;
  const zText = z => (z != null ? ' &middot; z ' + z + (floorLabel(z) ? ' (' + esc(floorLabel(z)) + ')' : '') : '');
  const fewestFor = npc => { const f = npc !== undefined ? FEWEST.get(npc) : null; return f ? fewestLine(f) : ''; };
  function openPop(at, html, wire) {
    popFor = { x: at.x, y: at.y };
    const pop = $('#pop');
    pop.innerHTML = `<button class="x" aria-label="Close">&times;</button>` + html;
    $('.x', pop).onclick = closePop;
    if (wire) wire(pop);
    pop.classList.add('on'); positionPop();
  }
  function showMobPop(id, pt) {
    const m = MOB[id]; if (!m) return;
    const p = m.pts ? { x: m.pts[pt][0], y: m.pts[pt][1] } : { x: m.x, y: m.y };
    const idx = plan.pins.findIndex(q => q.mob === id), fw = fewestFor(m.npc);
    openPop(p, `<h4>${esc(m.name)}</h4>
      <div class="row" style="margin-bottom:4px"><span class="badge b-${m.kind}">${KINDS[m.kind][0]}</span>${m.kind === 'scripted' ? '<span class="badge b-scripted" title="No spawn point of its own: a script spawns it">no spawn point</span>' : ''}${m.checklist ? `<span class="badge b-objective">${esc(m.checklist)}</span>` : ''}${mobOnCard(m) ? '<span class="badge b-plan" title="This boss has a fight card on the raid planner">on the plan</span>' : ''}</div>
      <div class="kv">${m.npc ? `<b>NPC</b><span>${m.npc}${m.level ? ' &middot; L' + m.level : ''}${m.hp ? ' &middot; ' + m.hp.toLocaleString('en-US') + ' hp' : ''}</span>` : ''}
        <b>Position</b><span><code>${esc(loc(p.x, p.y))}</code>${zText(m.z)}</span>${m.spawn2 ? `<b>spawn2</b><span>${m.spawn2}</span>` : ''}</div>
      ${fw ? `<div class="fewest">${esc(fw)}</div>` : ''}
      ${m.trigger ? `<div class="trig"><b>Spawns when:</b> ${esc(m.trigger)}</div>` : ''}
      ${m.note ? `<div class="small muted" style="margin:4px 0">${esc(m.note)}</div>` : ''}
      ${(m.links || []).length ? `<div class="links">${m.links.map(l => `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer">${esc(l.label)} &rarr; ${esc(l.ref)}</a>`).join('')}</div>` : ''}
      ${editable() ? `<div class="row" style="margin-top:8px"><button class="primary" id="popAdd" ${idx >= 0 ? 'disabled' : ''}>${idx >= 0 ? 'In plan as #' + (idx + 1) : 'Add to plan'}</button></div>` : ''}`,
    pop => { const add = $('#popAdd', pop); if (add) add.onclick = () => { addMobPin(id, pt); closePop(); }; });
  }
  function showPatherPop(pi, at) {
    const pa = Z.pathers[pi]; if (!pa) return;
    let bi = 0, bd = Infinity;
    pa.points.forEach((q, i) => { const d = Math.hypot(q[0] - at.x, q[1] - at.y); if (d < bd) { bd = d; bi = i; } });
    const near = pa.points[bi];
    const zs = pa.points.map(q => q[2]).filter(z => typeof z === 'number'), fl = [...new Set(zs.map(floorLabel).filter(Boolean))];
    openPop({ x: near[0], y: near[1] }, `<h4>Pather: ${esc(pa.npc_names.join(', ') || pa.id)}</h4>
      <div class="row" style="margin-bottom:4px"><span class="badge" style="color:${PATHER_COLOR}">${pa.wander ? 'wanders' : pa.loop ? 'loops' : 'walks and turns back'}</span><span class="badge b-note">${pa.points.length} points</span></div>
      <div class="kv"><b>Walked by</b><span>${esc(pa.npc_names.join(', ') || 'unknown')}</span>
        <b>Nearest point</b><span><code>${esc(loc(near[0], near[1]))}</code>${zText(near[2])}</span>
        ${zs.length ? `<b>Heights</b><span>z ${Math.round(Math.min(...zs))} to ${Math.round(Math.max(...zs))}${fl.length ? ' (' + esc(fl.join(', ')) + ')' : ''}</span>` : ''}</div>
      ${editable() ? '<div class="row" style="margin-top:8px"><button class="primary" id="popAdd">Add to plan</button></div>' : ''}`,
    pop => {
      const add = $('#popAdd', pop);
      if (add) add.onclick = () => {
        const pin = { id: uid(), label: pa.npc_names[0] ? pa.npc_names[0] + ' (pather)' : 'Pather point', kind: pa.npc_names.length ? 'named' : 'note', optional: false, x: r1(near[0]), y: r1(near[1]), z: near[2], note: 'On the path of ' + (pa.npc_names.join(', ') || 'a pather') + (pa.wander ? ' (wanders)' : '') };
        pushPin(pin); selPin = pin.id; changed(); closePop(); toast('Added ' + pin.label);
      };
    });
  }
  function showLinkPop(li) {
    const lk = Z.links[li]; if (!lk) return;
    const kindName = { teleport: 'Teleport', locked: 'Locked door', flag: 'Flag door', zoneline: 'Zone line' }[lk.kind];
    openPop({ x: lk.from[0], y: lk.from[1] }, `<h4>${esc(lk.label)}</h4>
      <div class="row" style="margin-bottom:4px"><span class="badge" style="color:${lk.kind === 'teleport' ? LINK_COLOR : lk.kind === 'flag' ? 'var(--orange)' : lk.kind === 'locked' ? 'var(--red)' : 'var(--blue)'}">${kindName}</span></div>
      <div class="kv"><b>From</b><span><code>${esc(loc(lk.from[0], lk.from[1]))}</code>${zText(lk.from[2])}</span>
        ${lk.to ? `<b>To</b><span><code>${esc(loc(lk.to[0], lk.to[1]))}</code>${zText(lk.to[2])}</span>` : ''}
        ${lk.key ? `<b>${lk.kind === 'flag' ? 'Flag' : 'Key'}</b><span>${esc(lk.key)}</span>` : ''}</div>
      ${lk.kind === 'teleport' ? '<div class="small muted" style="margin:4px 0">Set a leg to go <i>via</i> this teleport on the Legs tab: the jump is drawn but not counted in the length.</div>' : ''}
      ${lk.script ? `<div class="links"><a href="${esc(safeUrl(lk.script.url))}" target="_blank" rel="noopener noreferrer">script &rarr; ${esc(lk.script.ref)}</a></div>` : ''}`);
  }
  function positionPop() {
    if (!popFor) return; const s = toScreen(popFor.x, popFor.y), pop = $('#pop');
    const w = pop.offsetWidth || 310, h = pop.offsetHeight || 200;
    let x = s.x + 18, y = s.y - 20; if (x + w > W() - 6) x = s.x - w - 18; if (x < 6) x = 6; if (y + h > H() - 6) y = H() - h - 6; if (y < 50) y = 50;
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
  }
  function closePop() { popFor = null; $('#pop').classList.remove('on'); }
  function closePopIfOff() { if (popFor) positionPop(); }
  function addMobPin(id, pt) {
    if (!editable()) return;
    const m = MOB[id]; const p = m.pts ? { x: m.pts[pt][0], y: m.pts[pt][1] } : { x: m.x, y: m.y };
    const pin = { id: uid(), label: m.name + (m.pts && m.pts.length > 1 ? ' (point ' + (pt + 1) + ')' : ''), kind: m.kind, optional: false, x: p.x, y: p.y, z: m.z, mob: id, npc: m.npc, note: m.checklist };
    if (mobOnCard(m)) pin.onPlan = true;
    pushPin(pin); selPin = pin.id; changed(); toast('Added ' + pin.label);
  }

  /* ---------- toast / banner ---------- */
  let toastT; function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 4200); }
  function setMode(m) {
    if (m !== 'select' && !editable()) return;
    if (m === 'follow' && !NSER.length) { toast('No nights are recorded for this zone yet, so there is nothing to follow.'); return; }
    if (m === 'draw' && !host.draw) return;
    if (ui.mode === 'draw' && m !== 'draw') { cancelDraw(); drawLegKey = null; }
    ui.mode = m; followFrom = null;
    $$('#modeGrp button').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    svg.classList.toggle('addpin', m === 'addpin');
    svg.classList.toggle('drawing', m === 'draw');
    if (host.draw) $('#drawGrp').style.display = m === 'draw' ? '' : 'none';
    const b = $('#banner');
    b.classList.toggle('on', m !== 'select');
    b.classList.toggle('draw', m === 'draw');
    b.textContent = m === 'addpin' ? 'Add pin: click the map to drop a pin' + (ui.addTo !== 'main' ? ' in the chosen branch' : '') + '. Esc to stop.' : m === 'follow' ? 'Follow paths: click a leg, or click a leg\'s start pin then its end pin. Esc to stop.' : m === 'draw' ? drawBanner() : '';
    if (m === 'draw') {
      if (document.activeElement && root.contains(document.activeElement) && document.activeElement.blur) document.activeElement.blur();   // Enter finishes a draw; on a focused button it would press it
      // a leg is drawn along the plan's own line; a walked or recorded view would hide what was just drawn
      if (host.legFocus && ui.src !== 'straight') { setSrc('straight'); toast('Showing each leg as the plan has it (Straight) while you draw.'); return; }
    }
    renderMap();
  }

  /* ---------- draw tool (?v=draw) ----------
     Lay a leg's path in one go (the guild lead, 2026-10-22: "add in draw with pins or let us redraw a path or segment entirely").
     POINTS: with a leg picked, click its bends in order; with none, click empty map to drop a chain of new pins. PEN: drag along
     the corridor; the stroke replaces the leg's bends, or only the stretch between where it starts and ends (drawPath.ts has the
     maths and the tests). A draw is ONE save: nothing reaches the plan until Enter / the end pin / the end of a stroke, and Esc
     drops it (the chain's pins are the one exception: they sit in the plan, unsaved, until it is finished or cancelled). */
  const DRAW_PX = 14;                 // how near the leg, in screen pixels, a stroke's ends count as on it
  const touchDown = new Set();        // fingers on the map: a second one is a pinch and ends a stroke
  const drawing = () => !!host.draw && ui.mode === 'draw' && editable();
  /** The leg the tool works on: One leg mode's current leg, else the one picked by a click or a card. */
  function drawLeg(L) {
    L = L || legs();
    if (legOn()) return L.length ? L[clampLeg(legIdx, L.length)] : null;
    return drawLegKey ? L.find(l => l.k === drawLegKey) || null : null;
  }
  /** A leg that jumps by teleporter has a walked part and a jump; drawing over it would lose the way to the teleporter. */
  function refuseJump(lg) {
    if (lg.jump) { toast('This leg jumps by teleporter; draw the walked part (bend it in Move, or take the teleporter off the leg first).'); return true; }
    return false;
  }
  /** The leg a press lands on: a leg's line, or a pin that starts a leg. */
  function legAt(act, t, L) {
    if (act === 'leg') return L.find(l => l.k === t.dataset.key) || null;
    if (act === 'pin') return L.find(l => l.a.id === t.dataset.id) || null;
    return null;
  }
  function pickLeg(lg) {
    if (refuseJump(lg)) return false;
    drawLegKey = lg.k; renderDraw(); return true;
  }
  function drawBanner(lg) {
    if (lg === undefined) lg = chain ? null : drawLeg();
    if (chain) return 'Draw · New pins: ' + chain.ids.length + ' dropped. Click for the next one. Backspace takes the last back, Enter or a double click finishes, Esc cancels.';
    if (!lg) return drawKind === 'pen' ? 'Draw · Pen: press on a leg (or on its start pin) and drag along the corridor. Esc to stop.'
      : 'Draw · Points: click a leg (or its start pin) to pick it, or click empty map to drop a chain of new pins. Esc to stop.';
    const way = lg.a.label + ' → ' + lg.b.label;
    if (drawKind === 'pen') return 'Draw · Pen · ' + way + ': drag along the corridor. Pin to pin redraws the leg; a stroke between two bends redraws only that stretch. Shift-drag pans.';
    const n = pdraft && pdraft.key === lg.k ? pdraft.draft.pts.length : 0;
    return 'Draw · Points · ' + way + ': ' + (n ? n + ' point' + (n === 1 ? '' : 's') + '. Click the next bend. Backspace takes the last back, Enter or ' + lg.b.label + ' finishes, Esc cancels.' : 'click the bends in order, ending at ' + lg.b.label + '. Enter or a click on it finishes.');
  }
  const wpath = (pts, parent, dash) => {
    const d = 'M' + pts.map(p => `${-p[0]} ${-p[1]}`).join('L');
    el('path', { d, fill: 'none', stroke: 'var(--halo)', 'stroke-width': 6, opacity: .7, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }, parent);
    el('path', { d, fill: 'none', stroke: '#fff', 'stroke-width': 3, 'stroke-dasharray': dash, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }, parent);
  };
  /** The tool's layer: the picked leg, its two ends, and the draw in progress (dashed, with its points). Cheap enough to run on every pointer move. */
  function renderDraw(L) {
    if (!host.draw) return;
    const gd = $('#gDraw'), gdd = $('#gDrawDots'), gl = $('#gLegs');
    gd.innerHTML = ''; gdd.innerHTML = ''; gl.style.opacity = '';
    if (!drawing()) return;
    if (pdraft && (legOn() ? curLegKey !== pdraft.key : drawLegKey !== pdraft.key)) pdraft = null;   // another leg was picked or stepped to: that draft was for the one before
    const lg = chain ? null : (pdraft && pdraft.lg) || (stroke && stroke.lg) || drawLeg(L);
    $('#banner').textContent = drawBanner(lg);
    if (lg) {
      if (!legOn()) legGlow(legPoly(lg), gd);
      for (const [p, t] of [[lg.a, 'start'], [lg.b, 'end']]) {
        const g = mk(gdd, p.x, p.y);
        el('circle', { r: 21, fill: 'none', stroke: 'var(--blue)', 'stroke-width': 2.5 }, g);
        const tx = el('text', { y: -26, 'text-anchor': 'middle', class: 'lbl-t', fill: 'var(--blue)' }, g); tx.textContent = t;
      }
    }
    if (pdraft && lg && pdraft.key === lg.k) {
      gl.style.opacity = '.4';
      const A = [lg.a.x, lg.a.y], B = [lg.b.x, lg.b.y], cur = pdraft.cursor;
      wpath(draftLine(A, B, pdraft.draft, cur), gd, '8 6');
      if (cur) el('path', { d: `M${-cur[0]} ${-cur[1]}L${-B[0]} ${-B[1]}`, fill: 'none', stroke: '#fff', 'stroke-width': 2, 'stroke-dasharray': '2 7', opacity: .55, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }, gd);
      pdraft.draft.pts.forEach((p, i) => {
        const g = mk(gdd, p[0], p[1]);
        el('circle', { r: 8, fill: '#fff', stroke: 'var(--halo)', 'stroke-width': 2 }, g);
        const t = el('text', { y: 3.5, 'text-anchor': 'middle', class: 'pinnum', style: 'fill:#111;font-size:10px' }, g); t.textContent = i + 1;
      });
    }
    if (stroke && stroke.raw.length > 1) { gl.style.opacity = '.4'; wpath(stroke.raw, gd, '7 5'); }
  }
  /** The picked leg, drawn under everything else as a wide soft line so it can be found among the others. */
  function legGlow(poly, parent) {
    el('path', { d: 'M' + poly.map(p => `${-p[0]} ${-p[1]}`).join('L'), fill: 'none', stroke: 'var(--blue)', 'stroke-width': 10, opacity: .35, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }, parent);
  }
  /** The finished draw, in one save: the leg's bends are replaced, a recorded-route snap is let go, a teleporter is kept. */
  function commitBends(lg, bends, msg) {
    if (!editable()) return;
    drawnLine(lineFor(lg.k, true), bends);
    changed();
    toast(msg);
  }
  const bendText = n => n + ' bend point' + (n === 1 ? '' : 's');
  function addPoint(lg, w, e) {
    if (!pdraft || pdraft.key !== lg.k) pdraft = { key: lg.k, lg, draft: newDraft(), cursor: null };
    const nd = draftAdd(pdraft.draft, [w.x, w.y]);
    if (nd === pdraft.draft && nd.pts.length >= MAX_DRAW_BENDS) toast('That is as many bends as a leg keeps (' + MAX_DRAW_BENDS + '). Press Enter to finish.');
    pdraft.draft = nd;
    if (e.pointerType !== 'mouse') pdraft.cursor = null;
    renderDraw();
  }
  function dropChainPin(w) {
    const lp = chain && chain.ids.length ? pinById(chain.ids[chain.ids.length - 1]) : null;
    if (lp && Math.hypot(lp.x - w.x, lp.y - w.y) < 0.5) return;   // a double click's second click
    const pin = { id: uid(), label: 'Pin ' + (pins().length + 1), kind: ui.addKind, optional: false, x: r1(w.x), y: r1(w.y) };
    pushPin(pin); selPin = pin.id;
    (chain = chain || { ids: [] }).ids.push(pin.id);
    renderMap(); renderPanel();
  }
  let lastFinish = 0;
  function finishDraw() {
    if (!drawing()) return;
    lastFinish = Date.now();
    if (chain) {
      const n = chain.ids.length; chain = null;
      changed();
      toast(n + ' pin' + (n === 1 ? '' : 's') + ' dropped.');
      return;
    }
    const lg = pdraft && pdraft.lg;
    if (!lg) { toast('Nothing to finish: click the bends of a leg first.'); return; }
    const bends = draftFinish(pdraft.draft);
    if (!bends) { toast('Click the bends first, from ' + lg.a.label + ' to ' + lg.b.label + ', then finish.'); return; }
    pdraft = null;
    commitBends(lg, bends, lg.a.label + ' → ' + lg.b.label + ' redrawn with ' + bendText(bends.length) + '.');
  }
  function undoDraw() {
    if (chain) {
      const id = chain.ids.pop();
      if (id) { removePin(plan, id); if (selPin === id) selPin = null; }
      if (!chain.ids.length) chain = null;
      renderMap(); renderPanel();
    } else if (pdraft) { pdraft.draft = draftUndo(pdraft.draft); renderDraw(); }
  }
  /** Drop the draw in progress. True when there was one. */
  function cancelDraw() {
    const had = !!(pdraft || chain || stroke);
    if (chain) for (const id of chain.ids) { removePin(plan, id); if (selPin === id) selPin = null; }
    pdraft = null; chain = null; stroke = null;
    if (had) { renderMap(); renderPanel(); }
    return had;
  }
  function drawKey(e) {
    if (e.key === 'Escape') {
      if (pdraft || chain || stroke) { cancelDraw(); toast('Draw cancelled. The leg is as it was.'); return true; }
      if (drawLegKey && !legOn()) { drawLegKey = null; renderDraw(); return true; }
      return false;   // the next Esc leaves the tool
    }
    if (e.key === 'Enter' && (pdraft || chain)) { e.preventDefault(); finishDraw(); return true; }
    if (e.key === 'Backspace' || e.key === 'Delete') { if (pdraft || chain) { e.preventDefault(); undoDraw(); } return true; }   // never the selected pin
    return false;
  }
  function setDrawKind(k) {
    if (k === drawKind) return;
    cancelDraw();
    drawKind = k;
    $$('#drawGrp button').forEach(b => { const on = b.dataset.draw === k; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    renderDraw();
  }
  /** A press on the map in the Draw tool: the pen starts its stroke, anything else waits to be a click (a drag pans). */
  function drawDown(e) {
    const t = e.target.closest('[data-act]'), act = t ? t.dataset.act : null;
    drag = { act: null, t: null, x0: e.clientX, y0: e.clientY, moved: false, id: e.pointerId, tx: view.tx, ty: view.ty, draw: true, hit: t, hitAct: act };
    svg.setPointerCapture(e.pointerId);
    if (touchDown.size > 1 && stroke) { stroke = null; renderDraw(); }   // a second finger: a pinch, not a drawing
    if (drawKind === 'pen' && !e.shiftKey && touchDown.size <= 1) {
      const L = legs();
      let lg = drawLeg(L);
      if (!lg) { const hit = legAt(act, t, L); if (hit && pickLeg(hit)) lg = hit; }
      if (lg && !refuseJump(lg)) {
        const w = toWorld(e.clientX, e.clientY);
        stroke = { lg, raw: [[w.x, w.y]] }; drag.pen = true;
        renderDraw(L);
        return;
      }
    }
    svg.classList.add('panning');
  }
  /** A click (no drag) in the Draw tool. */
  function drawClick(d, e) {
    const w = toWorld(e.clientX, e.clientY), act = d.hitAct, t = d.hit;
    closePop();
    const L = legs(), lg = chain ? null : drawLeg(L);
    if (drawKind === 'pen') {   // a plain click only picks a leg
      const hit = act === 'leg' && !legOn() ? legAt(act, t, L) : null;
      if (hit) pickLeg(hit); else if (!lg) toast('Pick a leg first: click one, or press on its start pin and draw.');
      return;
    }
    if (chain) { dropChainPin(w); return; }
    if (!lg) {
      const hit = legAt(act, t, L);
      if (hit) pickLeg(hit); else dropChainPin(w);   // nothing picked: a click on empty map starts a chain of new pins
      return;
    }
    if (refuseJump(lg)) return;
    if (act === 'pin' && t.dataset.id === lg.b.id) {
      if (pdraft && pdraft.key === lg.k && pdraft.draft.pts.length) finishDraw();
      else if (Date.now() - lastFinish > 700) toast('Click the bends first, then ' + lg.b.label + '.');   // not on a double click's second half
      return;
    }
    addPoint(lg, w, e);
  }
  /** The end of a pen stroke: simplified, snapped, and laid over the leg (or the stretch of it the stroke covers). */
  function finishStroke(d) {
    const st = stroke; stroke = null;
    if (!st) { renderDraw(); return; }
    const lg = st.lg;
    if (!d.moved) {   // a click, not a drawing: it picks the leg it landed on
      renderDraw();
      const hit = d.hitAct === 'leg' && !legOn() ? legs().find(l => l.k === d.hit.dataset.key) : null;
      if (hit && hit.k !== lg.k) pickLeg(hit);
      return;
    }
    const r = applyPen([lg.a.x, lg.a.y], [lg.b.x, lg.b.y], lg.pts, thinStroke(st.raw, 2 / view.s), { hitR: DRAW_PX / view.s, minLen: 16 / view.s });
    if (!r.ok) { toast(r.reason === 'short' ? 'Too short to be a path: drag along the corridor from one end of the stretch to the other.' : 'That stroke starts and ends in the same place on the leg: draw across the stretch you want to redraw.'); renderDraw(); return; }
    commitBends(lg, r.bends, r.scope === 'whole' ? lg.a.label + ' → ' + lg.b.label + ' redrawn with ' + bendText(r.bends.length) + '.' : 'Redrew a stretch of ' + lg.a.label + ' → ' + lg.b.label + ' (' + r.replaced + ' bend' + (r.replaced === 1 ? '' : 's') + ' replaced, the rest kept).');
  }
  /** The Legs tab's Redraw: pick that leg and open the tool on it. */
  function startDrawOn(lg) {
    if (!editable() || refuseJump(lg)) return;
    if (legOn()) setLeg(lg.idx);
    drawLegKey = lg.k;
    if (ui.mode === 'draw') renderMap(); else setMode('draw');
    if (!legOn()) frameLeg(lg);
  }

  /* ---------- pointer interaction ---------- */
  function nearestSeg(poly, x, y) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i + 1 < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[i + 1], dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2)), d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  }
  listen(svg, 'pointerdown', e => {
    if (e.pointerType === 'touch') touchDown.add(e.pointerId);
    if (e.button === 2) return;
    if (drawing()) { drawDown(e); return; }
    const t = e.target.closest('[data-act]'); let act = t ? t.dataset.act : null;
    if (!editable() && (act === 'bend' || act === 'leg' || act === 'track')) act = null;   // read-only: a drag there just pans
    drag = { act, t: act ? t : null, x0: e.clientX, y0: e.clientY, moved: false, id: e.pointerId, tx: view.tx, ty: view.ty };
    svg.setPointerCapture(e.pointerId);
    if (act === 'pin') { drag.pin = pinById(t.dataset.id); }
    else if (act === 'bend') { drag.ln = lineFor(t.dataset.key, false); drag.i = +t.dataset.i; }
    else if (act === 'leg' && ui.mode === 'select') {
      const lg = legs().find(l => l.k === t.dataset.key); if (lg) {
        const w = toWorld(e.clientX, e.clientY), poly = legPoly(lg), rt = routedFor(lg);
        // on a walked (or recorded) route the new bend goes after the bends that come before the click along the route, not along the plain line
        const rp = recPolyOf(lg) || (rt ? routedPoly(rt) : null), at = rp ? nearestSeg(rp, w.x, w.y) : 0;
        const si = rp ? lg.pts.filter(p => nearestSeg(rp, p[0], p[1]) <= at).length : Math.min(nearestSeg(poly, w.x, w.y), lg.pts.length);
        const ln = lineFor(lg.k, true); ln.pts.splice(si, 0, [r1(w.x), r1(w.y)]); ln.follow = undefined; drag.act = 'bend'; drag.ln = ln; drag.i = si; drag.fresh = true; drag.moved = true;
        renderMap();
      }
    }
    if (!act) svg.classList.add('panning');
  });
  let lastW = null, locRaf = 0;
  function scheduleLoc() { if (locRaf) return; locRaf = requestAnimationFrame(() => { locRaf = 0; if (lastW) $('#loc').textContent = `/loc y, x:  ${Math.round(lastW.y)}, ${Math.round(lastW.x)}`; }); }
  listen(svg, 'pointermove', e => {
    const w = toWorld(e.clientX, e.clientY); lastW = w; scheduleLoc();
    if (pdraft && e.pointerType === 'mouse') { pdraft.cursor = [w.x, w.y]; renderDraw(); }   // Points: the draft runs on to the pointer
    if (!drag) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.pen && stroke) {   // Pen: every couple of pixels is a sample of the stroke
      const last = stroke.raw[stroke.raw.length - 1];
      if (Math.hypot(w.x - last[0], w.y - last[1]) * view.s >= 2) stroke.raw.push([w.x, w.y]);
      renderDraw();
      return;
    }
    if (!drag.moved) return;
    if (drag.act === 'pin' && ui.mode !== 'follow' && editable() && drag.pin) { drag.pin.x = r1(w.x); drag.pin.y = r1(w.y); drag.did = true; renderMap(); }
    else if (drag.act === 'bend' && drag.ln) { drag.ln.pts[drag.i] = [r1(w.x), r1(w.y)]; drag.ln.follow = undefined; drag.did = true; renderMap(); }
    else { view.tx = drag.tx + dx; view.ty = drag.ty + dy; applyView(); }
  });
  listen(svg, 'pointerup', e => {
    const d = drag; drag = null; svg.classList.remove('panning'); touchDown.delete(e.pointerId);
    try { svg.releasePointerCapture(e.pointerId); } catch (x) { }
    if (!d) return;
    if (d.pen) { finishStroke(d); return; }
    if (d.draw) { if (!d.moved) drawClick(d, e); return; }
    if (d.did || d.fresh) { changed(); return; }
    if (d.moved) return;
    if (d.act === 'pin') {
      if (ui.mode === 'follow') return followClickPin(d.pin);
      selPin = d.pin.id; renderMap(); renderPanel(); scrollPinIntoView(d.pin.id); closePop();
    } else if (d.act === 'mob') { if (ui.mode === 'addpin') { addMobPin(d.t.dataset.id, +d.t.dataset.pt); return; } showMobPop(d.t.dataset.id, +d.t.dataset.pt); }
    else if (d.act === 'pather') showPatherPop(+d.t.dataset.id, toWorld(e.clientX, e.clientY));
    else if (d.act === 'link') showLinkPop(+d.t.dataset.id);
    else if (d.act === 'leg' && ui.mode === 'follow') { const lg = legs().find(l => l.k === d.t.dataset.key); if (lg) followLeg(lg); }
    else if (d.act === 'track') { plan.hiddenTracks.push(d.t.dataset.id); changed(); toast('Hid one piece of a track. Layers has "Show all hidden pieces again".'); }
    else if (!d.act) {
      closePop();
      if (ui.mode === 'addpin' && editable()) {
        const w = toWorld(e.clientX, e.clientY);
        const pin = { id: uid(), label: 'Pin ' + (pins().length + 1), kind: ui.addKind, optional: false, x: r1(w.x), y: r1(w.y) };
        pushPin(pin); selPin = pin.id; changed(); scrollPinIntoView(pin.id, true);
      } else if (selPin) { selPin = null; renderMap(); renderPanel(); }
    }
  });
  listen(svg, 'pointercancel', e => { drag = null; svg.classList.remove('panning'); touchDown.delete(e.pointerId); if (stroke) { stroke = null; renderDraw(); } });
  listen(svg, 'dblclick', () => { if (drawing() && (pdraft || chain)) finishDraw(); });   // Draw: a double click finishes (its two clicks already added the point once)
  listen(svg, 'contextmenu', e => {
    const t = e.target.closest('[data-act]'); if (!t) return; e.preventDefault();
    if (!editable()) return;
    if (t.dataset.act === 'bend') { const ln = lineFor(t.dataset.key, false); if (ln) { ln.pts.splice(+t.dataset.i, 1); ln.follow = undefined; changed(); } }
    else if (t.dataset.act === 'leg') { const ln = lineFor(t.dataset.key, true); ln.off = true; changed(); toast('Leg hidden. Restore it in the Legs tab.'); }
    else if (t.dataset.act === 'pin') { const p = pinById(t.dataset.id); if (p) { p.optional = !p.optional; changed(); toast(p.label + (p.optional ? ' is now optional' : ' is now required')); } }
  });
  listen(svg, 'wheel', e => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  function followClickPin(p) {
    if (!followFrom) { followFrom = p.id; renderMap(); toast('Start pin: ' + p.label + '. Now click the end pin.'); return; }
    if (followFrom === p.id) { followFrom = null; renderMap(); return; }
    const lg = legs().find(l => l.a.id === followFrom && l.b.id === p.id);
    followFrom = null;
    if (!lg) { renderMap(); toast('Those two pins are not neighbours in the route. Click the leg itself, or reorder the plan.'); return; }
    followLeg(lg); renderMap();
  }
  /* pinch zoom for touch */
  (() => {
    const ptrs = new Map(); let pd = 0;
    listen(svg, 'pointerdown', e => { if (e.pointerType === 'touch') ptrs.set(e.pointerId, e); });
    listen(svg, 'pointermove', e => {
      if (e.pointerType !== 'touch' || !ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, e);
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); if (pd) { const r = svg.getBoundingClientRect(); zoomAt(d / pd, (a.clientX + b.clientX) / 2 - r.left, (a.clientY + b.clientY) / 2 - r.top); } pd = d; if (drag) drag.moved = true, drag.act = null; } else pd = 0;
    });
    const up = e => { ptrs.delete(e.pointerId); pd = 0; }; listen(svg, 'pointerup', up); listen(svg, 'pointercancel', up);
  })();

  /* ---------- side panel ---------- */
  function scrollPinIntoView(id, focus) {
    setTab('plan');
    const n = $(`#pinList [data-pid="${id}"]`); if (n) { n.scrollIntoView({ block: 'nearest' }); if (focus) { const i = $('input.lbl', n); if (i) { i.focus(); i.select(); } } }
  }
  function setTab(t) { ui.tab = t; $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); $$('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + t)); saveUi(); if (host.onTab) host.onTab(t); }
  function renderPanel() { renderPins(); renderLegs(); renderLayers(); renderMobs(); refreshAddTo(); refreshHeadcount(); }

  /** One pin row. `list` is the array the pin lives in (the main route, or a branch) so reorder and delete work in place. */
  function pinRow(p, i, list, cid, label) {
    const m = p.mob ? MOB[p.mob] : null;
    const can = editable(), dis = can ? '' : ' disabled';
    const d = document.createElement('div'); d.className = 'pin' + (p.id === selPin ? ' sel' : ''); d.dataset.pid = p.id;
    const c = KINDS[p.kind][1], fw = fewestFor(p.npc), fl = floorLabel(p.z);
    d.innerHTML = `<div class="top">
        ${can ? '<span class="handle" title="Drag to reorder">&#8942;&#8942;</span>' : ''}
        <span class="num ${p.optional ? 'opt' : ''}" style="background:${c};color:${p.optional ? c : '#fff'}">${esc(label)}</span>
        <input type="text" class="lbl" value="${esc(p.label)}" aria-label="Pin label"${dis}>
        ${can ? `<button class="sm" data-a="up" title="Move up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
        <button class="sm" data-a="down" title="Move down" aria-label="Move down" ${i === list.length - 1 ? 'disabled' : ''}>&darr;</button>
        <button class="sm danger" data-a="del" title="Delete pin" aria-label="Delete pin">&times;</button>` : ''}</div>
      <div class="meta row">
        <select data-a="kind" aria-label="Kind"${dis}>${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${k === p.kind ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>
        <label><input type="checkbox" data-a="opt" ${p.optional ? 'checked' : ''}${dis}> optional</label>
        ${p.onPlan ? '<span class="badge b-plan" title="This boss has a fight card on the raid planner">on the plan</span>' : ''}
        ${m && m.kind === 'scripted' ? '<span class="badge b-scripted">scripted</span>' : ''}
        <code>${esc(loc(p.x, p.y))}</code>${p.z != null ? `<span title="height">z ${Math.round(p.z)}${fl ? ' &middot; ' + esc(fl) : ''}</span>` : ''}${p.npc ? '<span>npc ' + p.npc + '</span>' : ''}
      </div>
      ${(p.note || m && m.trigger) ? `<div class="meta">${esc(p.note || '')}${m && m.trigger ? '<br><b style="color:var(--purple)">Spawns when:</b> ' + esc(m.trigger) : ''}</div>` : ''}
      ${fw ? `<div class="meta fewest">${esc(fw)}</div>` : ''}
      ${m && m.links && m.links.length ? `<div class="meta">${m.links.map(l => `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer">${esc(l.ref)}</a>`).join(' &middot; ')}</div>` : ''}`;
    d.addEventListener('click', ev => { if (ev.target.closest('input,select,button,a,label')) return; selPin = p.id; renderMap(); $$('#pinList .pin').forEach(n => n.classList.toggle('sel', n.dataset.pid === p.id)); if (!(legOn() && ui.legFollow)) centerOn(p.x, p.y); });
    $('input.lbl', d).addEventListener('focus', () => { selPin = p.id; renderMap(); $$('#pinList .pin').forEach(n => n.classList.toggle('sel', n.dataset.pid === p.id)); });
    if (can) {
      $('input.lbl', d).addEventListener('input', ev => { p.label = ev.target.value; plan.updatedAt = Date.now(); renderMap(); host.onChange(plan); });
      $('[data-a=kind]', d).addEventListener('change', ev => { p.kind = ev.target.value; changed(); });
      $('[data-a=opt]', d).addEventListener('change', ev => { p.optional = ev.target.checked; changed(); });
      $('[data-a=up]', d).addEventListener('click', () => moveIn(list, i, i - 1));
      $('[data-a=down]', d).addEventListener('click', () => moveIn(list, i, i + 1));
      $('[data-a=del]', d).addEventListener('click', () => deletePin(p.id));
      const h = $('.handle', d);
      h.addEventListener('pointerdown', () => { d.draggable = true; });
      d.addEventListener('dragstart', ev => { ev.dataTransfer.setData('text/plain', cid + '|' + i); ev.dataTransfer.effectAllowed = 'move'; });
      d.addEventListener('dragend', () => { d.draggable = false; $$('#pinList .dragover').forEach(n => n.classList.remove('dragover')); });
      d.addEventListener('dragover', ev => { ev.preventDefault(); d.classList.add('dragover'); });
      d.addEventListener('dragleave', () => d.classList.remove('dragover'));
      d.addEventListener('drop', ev => {
        ev.preventDefault(); d.classList.remove('dragover');
        const [fc, fi] = String(ev.dataTransfer.getData('text/plain')).split('|');
        if (fc === cid && !isNaN(+fi)) moveIn(list, +fi, i);   // reordering stays inside one list: a pin changes branch by being re-added
      });
    }
    return d;
  }
  function moveIn(list, from, to) { if (!editable() || to < 0 || to >= list.length || from === to) return; const [p] = list.splice(from, 1); list.splice(to, 0, p); changed(); }

  function renderPins() {
    const box = $('#pinList'); box.innerHTML = '';
    $('#pinEmpty').style.display = pins().length ? 'none' : '';
    const can = editable(), nums = numbers(), act = activeSplits(plan, false);
    plan.pins.forEach((p, i) => {
      box.appendChild(pinRow(p, i, plan.pins, 'main', nums.get(p.id)));
      for (const split of plan.splits.filter(s => s.from === p.id)) box.appendChild(splitCard(split, !!act.get(p.id), nums));
    });
  }

  function splitCard(split, active, nums) {
    const can = editable();
    const from = pinById(split.from), to = pinById(split.to);
    const d = document.createElement('div'); d.className = 'split';
    d.innerHTML = `<div class="split-h"><b>Split</b> at ${esc(from ? from.label : '?')} &rarr; regroup at ${esc(to ? to.label : '?')}
      ${can ? '<span class="split-act"><button class="sm" data-a="addbranch" ' + (split.branches.length >= MAX_BRANCHES ? 'disabled' : '') + '>+ branch</button><button class="sm danger" data-a="rmsplit">Remove split</button></span>' : ''}</div>
      ${active ? '' : '<div class="small" style="color:var(--orange);margin:4px 0">These two pins are not neighbours in the route any more, so the split is not drawn. Put them back next to each other.</div>'}`;
    split.branches.forEach((b, bi) => {
      const bx = document.createElement('div'); bx.className = 'branch'; bx.style.borderLeftColor = b.color;
      bx.innerHTML = `<div class="branch-h"><span class="dot" style="background:${b.color}"></span>
          <input type="text" class="blabel" value="${esc(b.label)}" aria-label="Branch name" maxlength="40"${can ? '' : ' disabled'}>
          <label class="small" title="Raiders on this branch">raiders <input type="number" class="bhc" min="0" max="200" step="1" value="${b.headcount === undefined ? '' : b.headcount}" style="width:54px"${can ? '' : ' disabled'}></label>
          ${can ? `<button class="sm" data-a="here" title="New pins go in this branch">Add pin here</button>${split.branches.length > MIN_BRANCHES ? '<button class="sm danger" data-a="rmbranch" title="Remove this branch and its pins" aria-label="Remove branch">&times;</button>' : ''}` : ''}</div>
        <input type="text" class="broles small" value="${esc(b.roles || '')}" placeholder="roles: 2 tanks, 2 clerics, 1 enchanter" aria-label="Roles" maxlength="200" style="width:100%;margin:4px 0"${can ? '' : ' disabled'}>`;
      if (!b.pins.length) { const e = document.createElement('div'); e.className = 'small muted'; e.textContent = 'No pins in this branch yet.'; bx.appendChild(e); }
      b.pins.forEach((p, j) => bx.appendChild(pinRow(p, j, b.pins, b.id, nums.get(p.id))));
      if (can) {
        $('.blabel', bx).addEventListener('input', ev => { b.label = ev.target.value.slice(0, 40) || ('Team ' + String.fromCharCode(65 + bi)); plan.updatedAt = Date.now(); renderMap(); host.onChange(plan); });
        $('.blabel', bx).addEventListener('change', () => { changed(); });
        $('.bhc', bx).addEventListener('input', ev => { const v = ev.target.value; if (v === '') delete b.headcount; else b.headcount = Math.max(0, Math.min(200, Math.floor(+v) || 0)); plan.updatedAt = Date.now(); host.onChange(plan); });
        $('.broles', bx).addEventListener('input', ev => { const v = ev.target.value.trim(); if (v) b.roles = v.slice(0, 200); else delete b.roles; plan.updatedAt = Date.now(); host.onChange(plan); });
        $('[data-a=here]', bx).onclick = () => { ui.addTo = split.id + '|' + b.id; refreshAddTo(); setMode('addpin'); };
        const rb = $('[data-a=rmbranch]', bx);
        if (rb) rb.onclick = () => { split.branches.splice(bi, 1); changed(); };
      }
      d.appendChild(bx);
    });
    if (can) {
      $('[data-a=addbranch]', d).onclick = () => { if (split.branches.length < MAX_BRANCHES) { const i = split.branches.length; split.branches.push({ id: uid(), label: 'Team ' + String.fromCharCode(65 + i), color: BRANCH_COLORS[i], pins: [] }); changed(); } };
      $('[data-a=rmsplit]', d).onclick = () => { plan.splits = plan.splits.filter(s => s.id !== split.id); if (ui.addTo.startsWith(split.id)) ui.addTo = 'main'; changed(); };
    }
    return d;
  }

  /** The toolbar's "new pins go to" choice: only shown once the plan has a split. */
  function refreshAddTo() {
    const sel = $('#addTo');
    const opts = [['main', 'new pins: main route']];
    for (const s of plan.splits) { const f = pinById(s.from); for (const b of s.branches) opts.push([s.id + '|' + b.id, `new pins: ${b.label} (split at ${f ? f.label : '?'})`]); }
    if (!opts.some(o => o[0] === ui.addTo)) ui.addTo = 'main';
    sel.innerHTML = opts.map(o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('');
    sel.value = ui.addTo;
    sel.style.display = plan.splits.length ? '' : 'none';
  }
  function refreshHeadcount() {
    const hc = $('#hcMain'), rl = $('#hcRoles');
    if (document.activeElement !== hc) hc.value = plan.headcount === undefined ? '' : plan.headcount;
    if (document.activeElement !== rl) rl.value = plan.roles || '';
  }

  function splitPlan(lg) {
    if (!editable() || lg.branch) return;
    if (plan.splits.length >= MAX_SPLITS) { toast('That is as many splits as a plan can hold.'); return; }
    const ia = plan.pins.findIndex(p => p.id === lg.a.id), ib = plan.pins.findIndex(p => p.id === lg.b.id);
    if (ia < 0 || ib !== ia + 1) { toast('A split goes on a leg between two neighbouring pins of the main route. Turn "skip optional pins" off, or pick another leg.'); return; }
    if (plan.splits.some(s => s.from === lg.a.id)) { toast('There is already a split starting at ' + lg.a.label + '.'); return; }
    plan.splits.push({ id: uid(), from: lg.a.id, to: lg.b.id, branches: [0, 1].map(i => ({ id: uid(), label: 'Team ' + String.fromCharCode(65 + i), color: BRANCH_COLORS[i], pins: [] })) });
    changed(); toast('Split added. Pick a branch in the map toolbar (or press Add pin here) and click the map to drop its pins.');
    setTab('plan');
  }

  /* ---------- legs tab ---------- */
  function legCard(lg, compact) {
    const can = editable();
    const poly = legPoly(lg), straight = dist(lg.a, lg.b), plen = legLength(lg), st = legStats(lg.a, lg.b), fw = fewestFor(lg.b.npc);
    const teleports = Z.links.filter(t => t.kind === 'teleport' && t.to);
    const w = lg.walk;
    const drawnRow = `<b>Drawn path</b><span>${fmtU(plen)}${lg.pts.length ? ' (' + lg.pts.length + ' bend' + (lg.pts.length > 1 ? 's' : '') + ')' : ''}${lg.jump ? ' <span class="muted">jump not counted</span>' : ''}</span>`;
    const walkRow = !w ? drawnRow
      : w.state === 'ok' ? `<b>Walk route</b><span>${fmtU(plen)}${w.via.length ? ' <span class="walk">via ' + w.via.map(esc).join(', then ') + '</span> <span class="muted">jump not counted</span>' : ''}${w.steps ? ` · ${w.steps} step bridge${w.steps > 1 ? 's' : ''} <span class="muted">(found by a gap search in the map, not walked)</span>` : ''}${w.ignoredBends ? ' <span class="muted">· your bend points could not be walked, so they are left out</span>' : ''}</span>`
      : drawnRow + (w.state === 'none' ? '<b>Walk route</b><span class="walk none">no walkable route found</span>' : `<b>Walk route</b><span class="muted">${legOn() && lg.idx !== legIdx ? 'step to this leg to find it' : 'finding it…'}</span>`);
    // the Recorded source: the recorded route's row, or which of walk / straight a leg no night covers falls back to
    const rc = lg.rec, recOk = !!rc && rc.state === 'ok';
    const routeRows = recOk
      ? `<b>Recorded route</b><span>${fmtU(plen)} <span class="walk rec">${esc(recText(lg))}</span></span>`
      : walkRow + (rc ? `<b>Recorded route</b><span class="walk none">${esc(recText(lg))}</span>` : '');
    const recCan = host.recorded ? follow.recorded(lg.a, lg.b) : null;   // a night passed both pins (whatever the source in force)
    const d = document.createElement('div'); d.className = 'leg' + (lg.off ? ' off' : '') + (compact ? ' compact' : '') + (lg.optLeg ? ' optleg' : '');
    d.dataset.leg = lg.idx;
    d.addEventListener('click', ev => { if (legOn() && !ev.target.closest('input,select,button,a,label')) setLeg(lg.idx); });   // One leg mode: a card picks the leg
    d.innerHTML = `<div class="t">${compact ? '' : (lg.idx + 1) + '. '}${esc(lg.a.label)} &rarr; ${esc(lg.b.label)} ${lg.optLeg ? '<span class="badge b-note">optional leg</span>' : lg.dashed ? '<span class="badge b-note">optional pin</span>' : ''}${lg.off ? ' <span class="badge b-note">hidden</span>' : ''}${lg.jump ? ` <span class="badge" style="color:${LINK_COLOR}">via ${esc(lg.jump.label)}</span>` : ''}${lg.ln && lg.ln.follow ? ` <span class="badge b-objective">follows ${lg.ln.follow} night${lg.ln.follow > 1 ? 's' : ''}</span>` : ''}</div>
      <div class="kv">${compact ? '' : `<b>Straight line</b><span>${fmtU(straight)}</span>`}${routeRows}
      <b>Recorded time</b><span>${st.median != null ? fmtT(st.median) + (compact ? '' : ' median over ' + st.nights + ' night' + (st.nights > 1 ? 's' : '') + (st.median > 3 ? ' (' + Math.round(plen / st.median) + ' u/s on the drawn path)' : '')) : '<span class="muted">' + (NSER.length ? 'no recorded night passes both pins' : 'no nights recorded for this zone') + '</span>'}</span></div>
      ${fw ? `<div class="fewest small">${esc(fw)}</div>` : ''}
      ${can ? `<div class="row" style="margin:3px 0"><label class="small row" style="gap:4px"><input type="checkbox" data-a="optleg" ${lg.optLeg ? 'checked' : ''}> optional leg</label>
        ${teleports.length ? `<label class="small row" style="gap:4px">via <select data-a="via"><option value="">no teleport</option>${teleports.map(t => `<option value="${esc(t.label)}" ${lg.ln && lg.ln.via === t.label ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>` : ''}</div>` : ''}
      <div class="row">${can ? `${host.recorded
        ? `<button class="sm" data-a="bakerec" ${recCan && !lg.jump ? '' : 'disabled'} title="${lg.jump ? 'A leg through a teleport keeps its walk route' : !recCan ? 'No recorded night passes both pins' : 'Keep the average of the recorded nights as the leg&#39;s own bend points: it saves with the plan and goes to the in-game map'}">Use recorded route</button>`
        : `<button class="sm" data-a="follow" ${st.nights ? '' : 'disabled title="No recorded night passes both pins"'}>Follow recorded path</button>`}<button class="sm" data-a="straight" ${lg.pts.length ? '' : 'disabled'}>Straighten</button>${host.draw ? '<button class="sm" data-a="redraw" title="Draw this leg again on the map: by points or with a pen">Redraw</button>' : ''}${w && w.state === 'ok' ? '<button class="sm" data-a="bake" title="Keep this walking route as the leg\'s own bend points: it saves with the plan and goes to the in-game map">Use this route</button>' : ''}<button class="sm danger" data-a="off">${lg.off ? 'Restore leg' : 'Hide leg'}</button>${lg.branch ? '' : '<button class="sm" data-a="split" title="Send the raid up two or more branches at once, regroup at the end of this leg">Split this leg</button>'}` : ''}<button class="sm" data-a="zoom">Show</button></div>`;
    if (can) {
      const fl = $('[data-a=follow]', d); if (fl) fl.onclick = () => followLeg(lg);
      const br = $('[data-a=bakerec]', d); if (br) br.onclick = () => bakeRecorded([lg]);
      $('[data-a=straight]', d).onclick = () => { const ln = lineFor(lg.k, false); if (ln) { ln.pts = []; ln.follow = undefined; } changed(); };
      $('[data-a=off]', d).onclick = () => { const ln = lineFor(lg.k, true); ln.off = !ln.off; changed(); };
      $('[data-a=optleg]', d).onchange = e => { const ln = lineFor(lg.k, true); if (e.target.checked) ln.opt = true; else delete ln.opt; changed(); };
      const via = $('[data-a=via]', d); if (via) via.onchange = e => { const ln = lineFor(lg.k, true); if (e.target.value) ln.via = e.target.value; else delete ln.via; changed(); };
      const rd = $('[data-a=redraw]', d); if (rd) rd.onclick = () => startDrawOn(lg);
      const sp = $('[data-a=split]', d); if (sp) sp.onclick = () => splitPlan(lg);
      const bk = $('[data-a=bake]', d); if (bk) bk.onclick = () => bakeLeg(lg);
    }
    $('[data-a=zoom]', d).onclick = () => { const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]); fitBounds(Math.min(...xs) - 120, Math.max(...xs) + 120, Math.min(...ys) - 120, Math.max(...ys) + 120); };
    return d;
  }
  function renderLegs() {
    const box = $('#legList'); const L = legs(); const can = editable();
    if (!L.length) { box.innerHTML = '<div class="card muted">Legs appear once the plan has two or more pins.</div>'; return; }
    box.innerHTML = `${can ? `<div class="row" style="margin-bottom:6px"><button id="followAll" ${NSER.length ? '' : 'disabled title="No nights are recorded for this zone yet"'}${host.recorded ? ' title="Keep the average of the recorded nights as the bend points of every leg a night covered: one save, and it goes to the in-game map"' : ''}>${host.recorded ? 'Use recorded routes' : 'Follow recorded paths on every leg'}</button><button id="straightAll" class="sm">Straighten all</button></div>` : ''}${NSER.length ? '' : '<div class="small muted" style="margin-bottom:6px">No nights are recorded for this zone yet, so legs have no recorded time and cannot follow a path.</div>'}<div id="legTotals" class="small muted"></div>`;
    // consecutive legs of one split are drawn together, branch by branch, side by side
    for (let i = 0; i < L.length;) {
      const lg = L[i];
      if (!lg.branch) { box.appendChild(legCard(lg, false)); i++; continue; }
      const split = lg.branch.split;
      const run = []; while (i < L.length && L[i].branch && L[i].branch.split.id === split.id) run.push(L[i++]);
      const from = pinById(split.from), to = pinById(split.to);
      const wrap = document.createElement('div'); wrap.className = 'splitblock';
      wrap.innerHTML = `<div class="split-h"><b>Split</b> at ${esc(from ? from.label : '?')}, regroup at ${esc(to ? to.label : '?')}</div><div class="cols"></div>`;
      const cols = $('.cols', wrap);
      split.branches.forEach((b, bi) => {
        const col = document.createElement('div'); col.className = 'col'; col.style.borderTopColor = b.color;
        const mine = run.filter(l => l.branch.branchIndex === bi);
        col.innerHTML = `<div class="col-h" style="color:${b.color}"><b>${esc(b.label)}</b>${b.headcount !== undefined ? ` <span class="muted">&middot; ${b.headcount} raider${b.headcount === 1 ? '' : 's'}</span>` : ''}</div>${b.roles ? `<div class="small muted">${esc(b.roles)}</div>` : ''}`;
        if (!mine.length) { const e = document.createElement('div'); e.className = 'small muted'; e.textContent = 'No pins in this branch yet.'; col.appendChild(e); }
        for (const l of mine) col.appendChild(legCard(l, true));
        cols.appendChild(col);
      });
      box.appendChild(wrap);
    }
    const T = planTotals(L, l => legStats(l.a, l.b).median);
    const lines = [`Total drawn path ${fmtU(T.pathU)}${T.splits.length ? ' (longest branch of each split)' : ''}${L.some(l => l.optLeg) ? '; optional legs not counted' : ''}${T.timedLegs ? ' · recorded legs sum to ' + fmtT(T.timeS) + ' (' + T.timedLegs + ' of ' + T.countedLegs + ' legs have recorded times)' : ''}`];
    for (const s of T.splits) {
      const f = pinById(s.split.from);
      lines.push(`Split at ${f ? f.label : '?'}: ` + s.branches.map(b => `${b.label} ${fmtU(b.pathU)}${b.timeS != null && b.legs ? ' / ' + fmtT(b.timeS) : ''}`).join(' · ') + (s.slowest != null ? ` · the split takes ${fmtT(s.slowest)} (slowest branch)` : ''));
    }
    $('#legTotals').innerHTML = lines.map(esc).join('<br>');
    markCurLeg();
    if (can && $('#followAll')) {
      $('#followAll').onclick = host.recorded
        ? () => bakeRecorded(legs())
        : () => { let ok = 0, no = 0; for (const lg of legs()) followLeg(lg, true) ? ok++ : no++; changed(); toast(ok + ' leg' + (ok === 1 ? '' : 's') + ' now follow recorded paths' + (no ? '; ' + no + ' had no recorded night through both pins' : '')); };
      $('#straightAll').onclick = () => { plan.lines = plan.lines.filter(l => l.opt || l.via || l.off).map(l => ({ ...l, pts: [], follow: undefined })); changed(); };
    }
  }

  function renderLayers() {
    const nl = $('#nightList'); nl.innerHTML = '';
    if (!NSER.length) nl.innerHTML = '<div class="small muted">No nights are recorded for this zone yet. The plan, the legs and the pathers work without them; following recorded paths and the recorded legs\' times need them.</div>';
    for (const n of NSER) {
      const d = document.createElement('label'); d.className = 'chk';
      d.innerHTML = `<input type="checkbox" ${ui.nights[n.key] ? 'checked' : ''}><span class="swatch" style="background:${n.color}"></span><span><b>${esc(n.key.slice(0, 5))}</b> <span class="muted small">kill order ${esc(n.kill)}</span></span>`;
      $('input', d).onchange = e => { ui.nights[n.key] = e.target.checked; saveUi(); renderMap(); tellNights(); };
      nl.appendChild(d);
    }
    if (host.nightsNote) { const t = document.createElement('div'); t.className = 'small muted'; t.style.marginTop = '4px'; t.textContent = host.nightsNote; nl.appendChild(t); }
    $('#hiddenCount').textContent = plan.hiddenTracks.length ? plan.hiddenTracks.length + ' hidden' : '';
    $('#btnShowAll').disabled = !plan.hiddenTracks.length || !editable();
    $('#btnShowAll').style.display = NSER.length ? '' : 'none';
    const ll = $('#layerList'); ll.innerHTML = '';
    const LB = Z.layerLabels;
    const defs = [['bosses', LB.bosses], ['scripted', LB.scripted]];
    if (Z.marks) defs.push(['leash', LB.leash]);
    if (Z.avg.legs.length) defs.push(['avg', LB.avg]);
    if (Z.pathers.length) defs.push(['pathers', LB.pathers + ' (' + Z.pathers.length + ')']);
    if (REAL_LINKS) defs.push(['links', LB.links + ' (' + REAL_LINKS + ')']);
    if (Z.trash.length) defs.push(['trash', LB.trash + ' (' + Z.trash.length + ')']);
    if (Z.minor.length) defs.push(['minor', LB.minor + ' (' + Z.minor.length + ')']);
    if (actual) defs.push(['actual', 'Recorded night laid over the plan (white)']);
    for (const [k, t] of defs) {
      const d = document.createElement('label'); d.className = 'chk'; d.innerHTML = `<input type="checkbox" ${ui.layers[k] ? 'checked' : ''}><span>${esc(t)}</span>`;
      $('input', d).onchange = e => { ui.layers[k] = e.target.checked; saveUi(); renderMap(); }; ll.appendChild(d);
    }
    $('#legend').innerHTML = Object.entries(KINDS).map(([k, v]) => `<div class="row"><span class="dot" style="background:${v[1]}"></span>${v[0]}${k === 'scripted' ? ' (triangle; spawned by a script, no spawn point)' : k === 'boss' ? ' (ringed)' : k === 'named' ? ' (diamond)' : k === 'door' ? ' (square)' : ''}</div>`).join('') +
      '<div class="row"><span class="dot" style="border:2px dashed var(--muted);background:none"></span>Optional pin or leg (hollow / dashed)</div><div class="row"><span class="dot" style="border:2px solid var(--gold);background:none"></span>On the plan (a fight card on the raid planner)</div><div class="row"><span class="swatch" style="background:var(--gold)"></span>Route leg &nbsp; <span class="swatch" style="background:var(--green)"></span>Leg following recorded paths</div>' +
      '<div class="row"><span class="swatch" style="background:linear-gradient(90deg,#2dd4bf 50%,#d946ef 50%)"></span>Split branches (ringed pins, A1 B1 ...)</div>' +
      (Z.pathers.length ? `<div class="row"><span class="swatch" style="background:${PATHER_COLOR}"></span>Pather (arrows show the way it walks)</div>` : '') +
      (REAL_LINKS ? `<div class="row"><span class="swatch" style="background:${LINK_COLOR}"></span>Teleport &nbsp; padlock: locked (red) or flag (orange) door</div>` : '') +
      (host.navRoute ? `<div class="row"><span class="swatch" style="background:${LINK_COLOR}"></span>Walk route: a dashed jump is a teleporter or flagged door (not counted); a dotted leg has no walkable route</div>` : '') +
      (host.recorded ? '<div class="row"><span class="swatch" style="background:var(--green)"></span>Recorded: the leg along the average of the nights that ran it</div>' : '') +
      (Z.floors.length > 1 ? '<div class="row"><span class="dot" style="background:var(--muted);opacity:.3"></span>Faded: on another floor than the one picked</div>' : '');
  }
  function renderMobs() {
    const q = ($('#mobSearch').value || '').toLowerCase(), box = $('#mobList'); box.innerHTML = '';
    const can = editable();
    if (!MOBS.length) { box.innerHTML = '<div class="small muted">No mobs are loaded for this zone yet.</div>'; return; }
    const groups = [['Checklist, bosses and named', MOBS.filter(m => m.kind !== 'scripted' && m.id !== Z.start.mob)], ['Scripted (no spawn point)', MOBS.filter(m => m.kind === 'scripted')], ['Entrance', MOBS.filter(m => m.id === Z.start.mob)]];
    for (const [title, list] of groups) {
      const rows = list.filter(m => !q || (m.name + ' ' + (m.trigger || '') + ' ' + (m.checklist || '')).toLowerCase().includes(q)); if (!rows.length) continue;
      const h = document.createElement('div'); h.className = 'small muted'; h.style.margin = '10px 0 2px'; h.textContent = title; box.appendChild(h);
      for (const m of rows) {
        const d = document.createElement('div'); d.className = 'listrow';
        const fl = floorLabel(m.z);
        d.innerHTML = `<span class="dot" style="background:${KINDS[m.kind][1]}"></span><span class="nm">${esc(m.name)}${m.kind === 'scripted' ? ' <span class="badge b-scripted">scripted</span>' : ''}${mobOnCard(m) ? ' <span class="badge b-plan">on the plan</span>' : ''}<div class="small muted">${m.level ? 'L' + m.level + ' · ' : ''}${esc(loc(m.x, m.y))}${fl ? ' · ' + esc(fl) : ''}${m.checklist ? ' · ' + esc(m.checklist) : ''}</div></span><button class="sm" data-a="go">Show</button>${can ? `<button class="sm" data-a="add" ${inPlan(m.id) ? 'disabled' : ''}>${inPlan(m.id) ? 'In plan' : 'Add'}</button>` : ''}`;
        $('[data-a=go]', d).onclick = () => { const p = m.pts ? { x: m.pts[0][0], y: m.pts[0][1] } : m; if (m.z != null && ui.floor !== 'all' && floorOfZ(m.z) && floorOfZ(m.z).key !== ui.floor) { ui.floor = floorOfZ(m.z).key; saveUi(); renderMap(); } centerOn(p.x, p.y, 0.5); showMobPop(m.id, 0); };
        if (can) $('[data-a=add]', d).onclick = () => addMobPin(m.id, 0);
        box.appendChild(d);
      }
    }
  }

  /* ---------- export ---------- */
  function planText() {
    const L = legs(), out = [], nums = numbers();
    const hc = plan.headcount !== undefined ? `, ${plan.headcount} raiders` : '';
    out.push(`${Z.name} route plan - ${pins().length} pins (${pins().filter(p => p.optional).length} optional)${hc}`);
    if (plan.roles) out.push('Roles: ' + plan.roles);
    out.push('Coordinates are /loc y, x as the game prints them. [opt] = optional.'); out.push('');
    const line = (p, indent) => {
      const m = p.mob ? MOB[p.mob] : null, pad = indent ? '      ' : '   ', fw = fewestFor(p.npc);
      out.push(`${indent ? '   ' : ''}${nums.get(p.id)}. ${p.label}${p.optional ? ' [opt]' : ''}${p.onPlan ? ' [on the plan]' : ''} (${KINDS[p.kind][0].toLowerCase()}${m && m.kind === 'scripted' ? ', scripted' : ''})  ${loc(p.x, p.y)}${p.z != null ? ' z ' + p.z : ''}`);
      if (p.note) out.push(pad + p.note);
      if (fw) out.push(pad + fw);
      if (m && m.trigger) out.push(pad + 'Spawns when: ' + m.trigger);
      if (m && m.links) for (const l of m.links) out.push(pad + 'Script: ' + l.url);
      const lg = L.find(x => x.a.id === p.id && (!x.branch || indent));
      if (lg) {
        const bend = lg.ln && lg.ln.follow ? ' (follows the average of ' + lg.ln.follow + ' recorded night' + (lg.ln.follow > 1 ? 's' : '') + ')' : lg.pts.length ? ' via ' + lg.pts.map(b => loc(b[0], b[1]).replace('/loc ', '')).join(' > ') : '';
        const st = legStats(lg.a, lg.b);
        out.push(`${pad}next leg: ${fmtU(legLength(lg))}${lg.jump ? ' (teleport ' + lg.jump.label + ', jump not counted)' : ' straight ' + fmtU(dist(lg.a, lg.b))}${st.median != null ? ', recorded median ' + fmtT(st.median) + ' (' + st.nights + ' night' + (st.nights > 1 ? 's' : '') + ')' : ''}${lg.optLeg ? ' [optional leg]' : ''}${lg.off ? ' [hidden leg]' : ''}${bend}`);
      }
    };
    plan.pins.forEach(p => {
      line(p, false);
      for (const s of plan.splits.filter(x => x.from === p.id)) {
        const to = pinById(s.to);
        out.push(`   SPLIT (regroup at ${to ? to.label : '?'}):`);
        for (const b of s.branches) {
          out.push(`   - ${b.label}${b.headcount !== undefined ? ': ' + b.headcount + ' raiders' : ''}${b.roles ? ' (' + b.roles + ')' : ''}`);
          b.pins.forEach(q => line(q, true));
        }
      }
    });
    return out.join('\n');
  }
  async function copyPlan() {
    const txt = planText();
    try { await navigator.clipboard.writeText(txt); toast('Plan copied as text'); }
    catch (e) { $('#modalText').value = txt; $('#modalBg').classList.add('on'); $('#modalText').focus(); $('#modalText').select(); }
  }

  /* ---------- the host's handles ---------- */
  function setStatus(cls, txt) { const s = $('#status'); s.className = cls; $('#statusText').textContent = txt; }
  function setEdited(txt) { $('#editedBy').textContent = txt || ''; }
  /** An editor's controls are only live when the plan is editable (an officer, and not looking at a saved version). */
  function refreshEditable() {
    const can = editable();
    for (const id of ['#btnBuild', '#buildOrder', '#btnClear', '#addKind', '#addTo', '#hcMain', '#hcRoles']) { const n = $(id); if (n) n.disabled = !can; }
    $$('#modeGrp button').forEach(b => { if (b.dataset.mode !== 'select') b.disabled = !can; });
    if (!can) setMode('select');
    $('#previewBar').classList.toggle('on', !!preview);
  }
  function renderAll() { renderMap(); renderPanel(); refreshEditable(); }
  function setPlan(p) {
    if (preview) { preview.saved = sanitize(p); return; }
    plan = sanitize(p);
    if (selPin && !pinById(selPin)) selPin = null;
    renderMap();
    if (!document.activeElement || !root.contains(document.activeElement) || !/INPUT|SELECT/.test(document.activeElement.tagName)) renderPanel();
  }
  function previewPlan(p, text) {
    if (!preview) preview = { saved: plan };
    plan = sanitize(p); selPin = null; followFrom = null; closePop();
    $('#previewText').textContent = text || 'Viewing a saved version. Read only.';
    renderAll(); fit(true);
    host.onPreview && host.onPreview(true);
  }
  function exitPreview() {
    if (!preview) return;
    plan = preview.saved; preview = null; selPin = null;
    renderAll(); fit(pins().length > 1);
    host.onPreview && host.onPreview(false);
  }
  /** Lay a recorded night over the plan: { path:[[x,y]...], stops:[{n,name,x,y}] } or null to take it off. */
  function setActual(a) { actual = a; renderLayersOnly(); renderMap(); }
  const renderLayersOnly = () => renderLayers();

  /* ---------- wire up ---------- */
  listen($('#tabs'), 'click', e => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
  listen($('#modeGrp'), 'click', e => { const b = e.target.closest('button[data-mode]'); if (b) setMode(ui.mode === b.dataset.mode ? 'select' : b.dataset.mode); });
  $('#addKind').value = ui.addKind; $('#addKind').onchange = e => { ui.addKind = e.target.value; saveUi(); };
  $('#addTo').onchange = e => { ui.addTo = e.target.value; if (ui.mode === 'addpin') setMode('addpin'); };
  $('#buildOrder').value = ui.buildOrder; $('#buildOrder').onchange = e => { ui.buildOrder = e.target.value; saveUi(); };
  $('#optMode').value = ui.optMode; $('#optMode').onchange = e => { ui.optMode = e.target.value; saveUi(); renderMap(); renderLegs(); host.onOptMode && host.onOptMode(ui.optMode); };
  $('#hcMain').addEventListener('input', e => { if (!editable()) return; const v = e.target.value; if (v === '') delete plan.headcount; else plan.headcount = Math.max(0, Math.min(200, Math.floor(+v) || 0)); plan.updatedAt = Date.now(); host.onChange(plan); });
  $('#hcRoles').addEventListener('input', e => { if (!editable()) return; const v = e.target.value.trim(); if (v) plan.roles = v.slice(0, 200); else delete plan.roles; plan.updatedAt = Date.now(); host.onChange(plan); });
  $('#btnBuild').onclick = () => { if (!editable()) return; if (plan.pins.length) { $('#bcCount').textContent = pins().length; $('#buildConfirm').style.display = ''; } else doBuild(); };
  $('#bcYes').onclick = () => { $('#buildConfirm').style.display = 'none'; doBuild(); };
  $('#bcNo').onclick = () => { $('#buildConfirm').style.display = 'none'; };
  $('#btnClear').onclick = () => {
    if (!editable() || !pins().length) return;
    const b = $('#btnClear');
    if (b.dataset.arm) { plan.pins = []; plan.lines = []; plan.splits = []; selPin = null; b.textContent = 'Clear plan'; delete b.dataset.arm; changed(); }
    else { b.dataset.arm = 1; b.textContent = 'Click again to clear'; setTimeout(() => { delete b.dataset.arm; b.textContent = 'Clear plan'; }, 3000); }
  };
  $('#btnCopy').onclick = copyPlan;
  $('#modalClose').onclick = () => $('#modalBg').classList.remove('on');
  $('#btnShowAll').onclick = () => { if (!editable()) return; plan.hiddenTracks = []; changed(); };
  listen($('#floorBtns'), 'click', e => { const b = e.target.closest('button[data-floor]'); if (b) { ui.floor = b.dataset.floor; saveUi(); renderMap(); } });
  $('#mobSearch').oninput = renderMobs;
  $('#zIn').onclick = () => zoomAt(1.4, W() / 2, H() / 2); $('#zOut').onclick = () => zoomAt(1 / 1.4, W() / 2, H() / 2);
  $('#zFit').onclick = () => fit(false); $('#zWar').onclick = focusView;
  $('#previewBack').onclick = exitPreview;
  $('#helpcard').open = ui.help; listen($('#helpcard'), 'toggle', () => { ui.help = $('#helpcard').open; saveUi(); });
  listen(document, 'keydown', e => {
    if (!root.isConnected || root.classList.contains('rp-3d')) return;   // the 3D view is up: its keys are not the map's
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { if (e.key === 'Escape' && root.contains(document.activeElement)) document.activeElement.blur(); return; }
    if (drawing() && drawKey(e)) return;
    if (e.key === 'Escape') { setMode('select'); closePop(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selPin && editable() && lastW && root.matches(':hover')) deletePin(selPin);
  });
  if (host.legFocus) {
    $('#legOnly').onclick = () => { ui.legOnly = !ui.legOnly; legSel = undefined; legFramed = null; saveUi(); renderMap(); renderLegs(); };
    listen($('#srcGrp'), 'click', e => { const b = e.target.closest('button[data-src]'); if (b && b.dataset.src !== ui.src) setSrc(b.dataset.src); });
    $('#legPrev').onclick = () => setLeg(stepLeg(legIdx, -1, legs().length));
    $('#legNext').onclick = () => setLeg(stepLeg(legIdx, 1, legs().length));
    $('#legFollow').checked = ui.legFollow !== false;
    $('#legFollow').onchange = e => { ui.legFollow = e.target.checked; legFramed = null; saveUi(); renderMap(); };
    listen(document, 'keydown', e => {   // left / right step the leg while the pointer is over the map and no field has the keyboard
      if (!legOn() || !root.isConnected || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || !$('#mapwrap').matches(':hover')) return;
      e.preventDefault(); setLeg(stepLeg(legIdx, e.key === 'ArrowLeft' ? -1 : 1, legs().length));
    });
  }
  let rsT; listen(window, 'resize', () => { applyView(); clearTimeout(rsT); rsT = setTimeout(() => { if (W() < 820) fit(pins().length > 1); }, 200); });

  /* ---------- boot ---------- */
  buildStatic();
  if (host.draw) {   // the Draw tool's two layers: the lines (in the map's frame, over the legs) and the dots (screen-sized, over the pins)
    el('g', { id: 'gDraw', 'pointer-events': 'none' }, $('#world'));
    el('g', { id: 'gDrawDots', 'pointer-events': 'none' }, $('#markers'));
    listen($('#drawGrp'), 'click', e => { const b = e.target.closest('button[data-draw]'); if (b) setDrawKind(b.dataset.draw); });
  }
  setTab(ui.tab);
  $$('#modeGrp button').forEach(b => b.classList.toggle('active', b.dataset.mode === 'select'));
  fit(false);
  if (ui.src === 'walk' && walkOn()) loadWalk();
  tellNights();
  renderMap(); renderPanel(); refreshEditable();
  if (pins().length) fit(true);
  // the first real size arrives after the stylesheet: fit once more when the map gets its box
  let sized = false;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (!sized && svg.clientWidth > 0) { sized = true; if (legOn()) { legFramed = null; renderMap(); } else fit(pins().length > 1); } else applyView(); }) : null;
  if (ro) { ro.observe(svg); cleanups.push(() => ro.disconnect()); }

  return {
    nodes: { hostBar: $('#hostBar'), versionsPane: $('#pane-versions'), comparePane: $('#pane-compare'), toolbar: $('.toolbar'), mapwrap: $('#mapwrap') },
    getPlan: () => plan,
    getSkipOptional: skip,
    setPlan, setStatus, setEdited, previewPlan, exitPreview, setTab, toast, setActual,
    isPreviewing: () => !!preview,
    /** Select a pin as a click on it does (the 3D previews call this): the pin list scrolls to it, the map marks it. */
    selectPin: id => { if (pinById(id)) { selPin = id; renderMap(); renderPanel(); scrollPinIntoView(id); } },
    /**
     * Let go of a pin dragged in the 3D view: what finishing a 2D pin drag does (x, y; the pin keeps its mob and the legs keep
     * their bends, as in 2D), plus the height when the 3D view knows it. False, and nothing changed, when the plan is not editable.
     */
    movePin: (id, x, y, z) => {
      const p = pinById(id);
      if (!p || !editable() || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      p.x = r1(x); p.y = r1(y);
      if (Number.isFinite(z)) p.z = r1(z);
      changed();
      return true;
    },
    destroy() { destroyed = true; clearTimeout(routeTimer); cleanups.forEach(f => f()); cancelAnimationFrame(locRaf); clearTimeout(toastT); clearTimeout(rsT); root.innerHTML = ''; },
  };
}
