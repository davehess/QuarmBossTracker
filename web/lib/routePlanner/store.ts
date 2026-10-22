// Route planner: what bot_kv holds, and how it changes. Pure (the server actions read and write the row; this decides
// what the new row says), so "versions are capped" and "newest wins" are tested without a database.
//
// bot_kv key `route_plan:<zone>` (guild_id, key is the primary key), version 2:
//   { v:2, zone, updated_at: <ISO>,
//     plans: { <planId>: { name, night_type:'main'|'off', target_headcount?, updated_at: <ISO>,
//                          current: <Plan>, versions: [ { saved_at: <ISO>, plan: <Plan>, label? } ... newest first, at most 30 ] } } }
// `main` is the main-night plan: it always exists and cannot be deleted. Off-night plans ("Off-night: Tallon only") are
// the others; they carry a target headcount ("how few raiders can do this"). Version 1 was a single plan
// ({ v:1, zone, updated_at, current, versions }); it reads as `plans.main` and is written back as version 2 by the next save.
// No names: a plan carries the labels the officers typed and nothing about who typed them.
//
// CURRENT is what everybody sees; the officers' browsers save it a second after an edit and poll it every ~10 s.
//   NEWEST WINS: a save replaces `current` outright. Two officers editing at once is last-write-wins, as the artifact was.
// VERSIONS are what "see previous" lists. Two ways in:
//   • the officer presses "Save version": the plan as it is NOW is pushed;
//   • automatically, at most every 10 minutes of edits: the state the edit REPLACED is pushed, so the first edit after a
//     pause keeps what was there before it, and a long session leaves a checkpoint every ten minutes.
// A restore pushes the state it replaced first, so a restore is never a loss.
import { allPins, plannedHeadcount, planEmpty, planSame, sanitize } from './plan';
import { emptyPlan, type Plan } from './types';

export const STORE_V = 2;
export const MAIN_PLAN = 'main';
export const MAX_VERSIONS = 30;
export const MAX_PLANS = 12;
export const AUTO_VERSION_MS = 10 * 60 * 1000;
export const MAX_TARGET = 200;

export type NightType = 'main' | 'off';
export type Version = { saved_at: string; plan: Plan; label?: string };   // label: only an import carries one
export type PlanDoc = { name: string; night_type: NightType; target_headcount?: number; updated_at: string; current: Plan; versions: Version[] };
export type PlanStore = { v: 2; zone: string; updated_at: string; plans: Record<string, PlanDoc> };

export const storeKey = (zone: string) => `route_plan:${zone}`;
export const PLAN_ID = /^[a-z0-9_-]{1,24}$/;
export const isPlanId = (s: unknown): s is string => typeof s === 'string' && PLAN_ID.test(s);

const isoOk = (s: unknown): s is string => typeof s === 'string' && s.length <= 40 && Number.isFinite(Date.parse(s));
const nameOf = (s: unknown, fallback: string) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, 60) : fallback);
const targetOf = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_TARGET ? v : undefined);

function parseVersions(raw: unknown): Version[] {
  const versions: Version[] = [];
  for (const v of (Array.isArray(raw) ? raw : []).slice(0, MAX_VERSIONS) as Record<string, unknown>[]) {
    if (v && isoOk(v.saved_at)) {
      const ver: Version = { saved_at: v.saved_at, plan: sanitize(v.plan) };
      if (typeof v.label === 'string' && v.label) ver.label = v.label.slice(0, 80);
      versions.push(ver);
    }
  }
  return versions;
}

/** A row read back from bot_kv, or null when it is not one of ours. Everything inside is re-sanitized. */
export function parseStore(raw: unknown, zone: string): PlanStore | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.zone !== zone || !isoOk(r.updated_at)) return null;

  if (r.v === 1) {   // the single-plan shape: it is the main-night plan
    return {
      v: STORE_V, zone, updated_at: r.updated_at,
      plans: { [MAIN_PLAN]: { name: 'Main night', night_type: 'main', updated_at: r.updated_at, current: sanitize(r.current), versions: parseVersions(r.versions) } },
    };
  }
  if (r.v !== STORE_V || !r.plans || typeof r.plans !== 'object') return null;
  const plans: Record<string, PlanDoc> = {};
  for (const [id, d] of Object.entries(r.plans as Record<string, unknown>).slice(0, MAX_PLANS)) {
    if (!isPlanId(id) || !d || typeof d !== 'object') continue;
    const o = d as Record<string, unknown>;
    const main = id === MAIN_PLAN;
    const doc: PlanDoc = {
      name: nameOf(o.name, main ? 'Main night' : 'Off-night plan'),
      night_type: main ? 'main' : 'off',
      updated_at: isoOk(o.updated_at) ? o.updated_at : r.updated_at,
      current: sanitize(o.current),
      versions: parseVersions(o.versions),
    };
    const t = targetOf(o.target_headcount);
    if (t !== undefined) doc.target_headcount = t;
    plans[id] = doc;
  }
  return { v: STORE_V, zone, updated_at: r.updated_at, plans };
}

const cap = (v: Version[]) => v.slice(0, MAX_VERSIONS);
const blankDoc = (name: string, type: NightType, nowIso: string): PlanDoc => ({ name, night_type: type, updated_at: nowIso, current: emptyPlan(), versions: [] });

/** The store with a plan replaced (and the row's stamp moved). */
function withDoc(prev: PlanStore | null, zone: string, id: string, doc: PlanDoc, nowIso: string): PlanStore {
  return { v: STORE_V, zone, updated_at: nowIso, plans: { ...(prev ? prev.plans : {}), [id]: doc } };
}

/** The plan to edit: the stored one, or a blank main-night plan when nothing is saved yet (only `main` may start from nothing). */
function docFor(prev: PlanStore | null, id: string, nowIso: string): PlanDoc | null {
  if (prev && prev.plans[id]) return prev.plans[id];
  return id === MAIN_PLAN ? blankDoc('Main night', 'main', nowIso) : null;
}

export type SaveOptions = { version?: boolean };
export type SaveOutcome = {
  store: PlanStore;
  /** 'manual' = the officer asked, 'auto' = the ten-minute checkpoint, 'same' = asked but nothing differs from the newest version */
  versioned: 'manual' | 'auto' | 'same' | null;
};

/** Null when the plan does not exist. */
export function applySave(prev: PlanStore | null, planId: string, incoming: Plan, zone: string, nowIso: string, opts: SaveOptions = {}): SaveOutcome | null {
  const now = Date.parse(nowIso);
  const old = docFor(prev, planId, nowIso);
  if (!old) return null;
  const plan = sanitize(incoming);
  plan.updatedAt = plan.updatedAt > 0 && plan.updatedAt <= now ? plan.updatedAt : now;   // a clock in the future is not newer than the server
  let versions = old.versions;
  let versioned: SaveOutcome['versioned'] = null;

  if (opts.version) {
    if (versions[0] && planSame(versions[0].plan, plan)) versioned = 'same';
    else { versions = cap([{ saved_at: nowIso, plan }, ...versions]); versioned = 'manual'; }
  } else if (prev && prev.plans[planId] && !planEmpty(old.current) && !planSame(old.current, plan)) {
    const newest = versions[0];
    const due = !newest || now - Date.parse(newest.saved_at) >= AUTO_VERSION_MS;
    if (due && !(newest && planSame(newest.plan, old.current))) {
      versions = cap([{ saved_at: old.updated_at, plan: old.current }, ...versions]);
      versioned = 'auto';
    }
  }
  return { store: withDoc(prev, zone, planId, { ...old, updated_at: nowIso, current: plan, versions }, nowIso), versioned };
}

/** Make a saved version the current plan. Null when there is no version saved at that time. */
export function applyRestore(prev: PlanStore, planId: string, savedAt: string, nowIso: string): PlanStore | null {
  const doc = prev.plans[planId];
  const target = doc?.versions.find(v => v.saved_at === savedAt);
  if (!doc || !target) return null;
  let versions = doc.versions;
  if (!planEmpty(doc.current) && !planSame(doc.current, target.plan) && !(versions[0] && planSame(versions[0].plan, doc.current))) {
    versions = cap([{ saved_at: doc.updated_at, plan: doc.current }, ...versions]);
  }
  const plan = sanitize(target.plan);
  plan.updatedAt = Date.parse(nowIso);
  return withDoc(prev, prev.zone, planId, { ...doc, updated_at: nowIso, current: plan, versions }, nowIso);
}

/**
 * Import a plan from outside (tonight's planner, 2026-10-21) as the current plan AND as a labelled version, so it is in
 * "see previous" however it is edited afterwards. What it replaces is kept first, as any restore does.
 */
export function applyImport(prev: PlanStore | null, planId: string, incoming: Plan, label: string, zone: string, nowIso: string): PlanStore | null {
  const old = docFor(prev, planId, nowIso);
  if (!old) return null;
  const plan = sanitize(incoming);
  plan.updatedAt = Date.parse(nowIso);
  let versions = old.versions;
  if (prev && prev.plans[planId] && !planEmpty(old.current) && !planSame(old.current, plan) && !(versions[0] && planSame(versions[0].plan, old.current))) {
    versions = cap([{ saved_at: old.updated_at, plan: old.current }, ...versions]);
  }
  versions = cap([{ saved_at: nowIso, plan, label: label.slice(0, 80) }, ...versions]);
  return withDoc(prev, zone, planId, { ...old, updated_at: nowIso, current: plan, versions }, nowIso);
}

// ── several plans per zone ───────────────────────────────────────────────────

export function newPlanId(existing: Record<string, unknown>, rand: () => string = () => Math.random().toString(36).slice(2, 8)): string {
  for (let i = 0; i < 20; i++) { const id = 'o' + rand(); if (isPlanId(id) && !existing[id]) return id; }
  return 'o' + Date.now().toString(36);
}

/** Add an off-night plan, empty or copied from another plan of the zone. Null at the cap or when the source is missing. */
export function applyCreatePlan(prev: PlanStore | null, zone: string, name: string, copyFrom: string | null, nowIso: string, id?: string): { store: PlanStore; id: string } | null {
  const plans = prev ? prev.plans : {};
  if (Object.keys(plans).length >= MAX_PLANS) return null;
  const src = copyFrom ? plans[copyFrom] : null;
  if (copyFrom && !src) return null;
  const pid = id ?? newPlanId(plans);
  if (plans[pid]) return null;
  const doc = blankDoc(nameOf(name, 'Off-night plan'), 'off', nowIso);
  if (src) { doc.current = sanitize(src.current); doc.current.updatedAt = Date.parse(nowIso); }
  return { store: withDoc(prev, zone, pid, doc, nowIso), id: pid };
}

/** Rename an off-night plan and/or set its target headcount (null clears it). `main` keeps its name but may have a target. */
export function applyRenamePlan(prev: PlanStore, planId: string, patch: { name?: string; target_headcount?: number | null }, nowIso: string): PlanStore | null {
  const doc = prev.plans[planId];
  if (!doc) return null;
  const next: PlanDoc = { ...doc, updated_at: nowIso };
  if (patch.name !== undefined && doc.night_type === 'off') next.name = nameOf(patch.name, doc.name);
  if (patch.target_headcount !== undefined) {
    const t = patch.target_headcount === null ? undefined : targetOf(patch.target_headcount);
    if (patch.target_headcount !== null && t === undefined) return null;
    if (t === undefined) delete next.target_headcount; else next.target_headcount = t;
  }
  return withDoc(prev, prev.zone, planId, next, nowIso);
}

/** Delete an off-night plan. The main-night plan cannot be deleted. */
export function applyDeletePlan(prev: PlanStore, planId: string, nowIso: string): PlanStore | null {
  if (planId === MAIN_PLAN || !prev.plans[planId]) return null;
  const plans = { ...prev.plans };
  delete plans[planId];
  return { v: STORE_V, zone: prev.zone, updated_at: nowIso, plans };
}

// ── what the pages list ──────────────────────────────────────────────────────

/** The plan picker: no plans inside, so it is light. */
export type PlanSummary = { id: string; name: string; night_type: NightType; target_headcount?: number; updated_at: string; pins: number; planned: number | null };
export function planSummaries(s: PlanStore | null): PlanSummary[] {
  const docs = s ? Object.entries(s.plans) : [];
  if (!docs.some(([id]) => id === MAIN_PLAN)) docs.unshift([MAIN_PLAN, blankDoc('Main night', 'main', s ? s.updated_at : new Date(0).toISOString())]);
  const rows = docs.map(([id, d]) => {
    const row: PlanSummary = { id, name: d.name, night_type: d.night_type, updated_at: d.updated_at, pins: allPins(d.current).length, planned: plannedHeadcount(d.current).peak };
    if (d.target_headcount !== undefined) row.target_headcount = d.target_headcount;
    return row;
  });
  return rows.sort((a, b) => (a.id === MAIN_PLAN ? -1 : b.id === MAIN_PLAN ? 1 : a.updated_at < b.updated_at ? 1 : -1));
}

/** What the Versions panel lists: no plans, so the list is light. */
export type VersionRow = { saved_at: string; pins: number; optional: number; splits: number; label?: string };
export function versionRows(s: PlanStore | null, planId: string): VersionRow[] {
  return (s?.plans[planId]?.versions ?? []).map(v => {
    const pins = allPins(v.plan);
    const row: VersionRow = { saved_at: v.saved_at, pins: pins.length, optional: pins.filter(p => p.optional).length, splits: v.plan.splits.length };
    if (v.label) row.label = v.label;
    return row;
  });
}
