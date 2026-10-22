'use server';

// Route planner server actions (/raid/plan/routes). The plans live in bot_kv `route_plan:<zone>`, which is service-role
// only, so every read and write goes through here with the service client, behind the same two gates as the rest of the
// raid pages: a signed-in session to READ, an officer (re-checked in EVERY write action, never trusted from the page) to
// WRITE. The browser sends a plan; what is stored is what lib/routePlanner/store.ts makes of it (sanitized, capped,
// versioned). Nothing here stores or returns a name.
//
// "Send to in-game map" writes the plan to `raid_route:<zone>`, the key web/app/raid/routes/actions.ts saves a measured
// route to and the bot serves to Mimic's Map overlay; the conversion is lib/routePlanner/toRaidRoute.ts.
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { GUILD_TAG } from '@/lib/guild';
import { zoneData } from '@/lib/routePlanner/zones';
import { createFollow } from '@/lib/routePlanner/follow';
import {
  applyCreatePlan, applyDeletePlan, applyImport, applyRenamePlan, applyRestore, applySave, isPlanId, planSummaries, versionRows,
  MAIN_PLAN, type PlanSummary, type VersionRow,
} from '@/lib/routePlanner/store';
import { planToRaidRoute } from '@/lib/routePlanner/toRaidRoute';
import { readRowStamp, readStore, writeStore } from '@/lib/routePlanner/load';
import { seedFor } from '@/lib/routePlanner/seeds';
import { planEmpty } from '@/lib/routePlanner/plan';
import type { Plan } from '@/lib/routePlanner/types';

const MAX_PLAN_JSON = 400_000;       // a real plan is a few KB to ~100 KB (followed legs carry the most)
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/;

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

async function signedIn() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  return user;
}
async function officerUser() {
  const user = await signedIn();
  return user && (await isOfficer(user.id)) ? user : null;
}
const iso = (s: unknown): s is string => typeof s === 'string' && ISO.test(s);

// ── reads (any signed-in member) ─────────────────────────────────────────────

export type PlanDocOut = { updated_at: string; name: string; night_type: 'main' | 'off'; target_headcount: number | null; current: Plan };
export type PollResult =
  | { ok: true; changed: false }
  | { ok: true; changed: true; row_stamp: string; plans: PlanSummary[]; doc: PlanDocOut | null }
  | Fail;

/** What the 10-second poll asks: has anything in this zone's row moved on from the stamp I hold? Cheap when it has not. */
export async function pollRoutePlan(zone: string, planId: string, since: string | null): Promise<PollResult> {
  if (!(await signedIn())) return fail('Sign in first.');
  if (!zoneData(zone) || !isPlanId(planId)) return fail('Bad request.');
  try {
    const stamp = await readRowStamp(zone);
    if (stamp === null || stamp === since) return { ok: true, changed: false };
    const store = await readStore(zone);
    if (!store) return { ok: true, changed: false };
    const d = store.plans[planId];
    return {
      ok: true, changed: true, row_stamp: store.updated_at, plans: planSummaries(store),
      doc: d ? { updated_at: d.updated_at, name: d.name, night_type: d.night_type, target_headcount: d.target_headcount ?? null, current: d.current } : null,
    };
  } catch {
    return fail('Could not read the plan.');
  }
}

export type VersionsResult = { ok: true; versions: VersionRow[] } | Fail;

export async function listRouteVersions(zone: string, planId: string): Promise<VersionsResult> {
  if (!(await signedIn())) return fail('Sign in first.');
  if (!zoneData(zone) || !isPlanId(planId)) return fail('Bad request.');
  try {
    return { ok: true, versions: versionRows(await readStore(zone), planId) };
  } catch {
    return fail('Could not read the versions.');
  }
}

export type VersionResult = { ok: true; plan: Plan } | Fail;

export async function getRouteVersion(zone: string, planId: string, savedAt: string): Promise<VersionResult> {
  if (!(await signedIn())) return fail('Sign in first.');
  if (!zoneData(zone) || !isPlanId(planId) || !iso(savedAt)) return fail('Bad request.');
  try {
    const v = (await readStore(zone))?.plans[planId]?.versions.find(x => x.saved_at === savedAt);
    return v ? { ok: true, plan: v.plan } : fail('That version is gone.');
  } catch {
    return fail('Could not read the version.');
  }
}

// ── writes (officers) ────────────────────────────────────────────────────────

export type SaveResult = { ok: true; updated_at: string; versioned: 'manual' | 'auto' | 'same' | null; versions: number } | Fail;

/** Save the plan everybody sees (newest wins). `version` also pushes it onto the versions list. */
export async function saveRoutePlan(zone: string, planId: string, plan: Plan, opts?: { version?: boolean }): Promise<SaveResult> {
  if (!(await officerUser())) return fail('Officers only.');
  if (!zoneData(zone) || !isPlanId(planId) || !plan || typeof plan !== 'object') return fail('Bad request.');
  if (JSON.stringify(plan).length > MAX_PLAN_JSON) return fail('That plan is too large to save.');
  try {
    const out = applySave(await readStore(zone), planId, plan, zone, new Date().toISOString(), { version: !!opts?.version });
    if (!out) return fail('That plan no longer exists.');
    await writeStore(out.store);
    return { ok: true, updated_at: out.store.updated_at, versioned: out.versioned, versions: out.store.plans[planId].versions.length };
  } catch {
    return fail('Could not save the plan.');
  }
}

export type RestoreResult = { ok: true; updated_at: string; current: Plan; versions: VersionRow[] } | Fail;

/** Make a saved version the plan everybody sees. What it replaces is kept as a version first. */
export async function restoreRouteVersion(zone: string, planId: string, savedAt: string): Promise<RestoreResult> {
  if (!(await officerUser())) return fail('Officers only.');
  if (!zoneData(zone) || !isPlanId(planId) || !iso(savedAt)) return fail('Bad request.');
  try {
    const prev = await readStore(zone);
    const next = prev ? applyRestore(prev, planId, savedAt, new Date().toISOString()) : null;
    if (!next) return fail('That version is gone.');
    await writeStore(next);
    return { ok: true, updated_at: next.updated_at, current: next.plans[planId].current, versions: versionRows(next, planId) };
  } catch {
    return fail('Could not restore the version.');
  }
}

export type ImportResult = { ok: true; updated_at: string; current: Plan; versions: VersionRow[] } | { ok: false; confirm: true; pins: number } | Fail;

/**
 * "Import tonight's planner": the committed plan the officers drew on 2026-10-21 becomes the main-night plan and its first
 * saved version. A main plan that already has pins is replaced only with `overwrite` (what it holds is kept as a version).
 */
export async function importSeedPlan(zone: string, opts?: { overwrite?: boolean }): Promise<ImportResult> {
  if (!(await officerUser())) return fail('Officers only.');
  const seed = zoneData(zone) ? seedFor(zone) : null;
  if (!seed) return fail('There is nothing to import for this zone.');
  try {
    const prev = await readStore(zone);
    const have = prev?.plans[MAIN_PLAN];
    if (have && !planEmpty(have.current) && !opts?.overwrite) return { ok: false, confirm: true, pins: have.current.pins.length };
    const next = applyImport(prev, MAIN_PLAN, seed.plan, seed.label, zone, new Date().toISOString());
    if (!next) return fail('Could not import.');
    await writeStore(next);
    return { ok: true, updated_at: next.updated_at, current: next.plans[MAIN_PLAN].current, versions: versionRows(next, MAIN_PLAN) };
  } catch {
    return fail('Could not import.');
  }
}

export type PlansResult = { ok: true; id: string; plans: PlanSummary[]; row_stamp: string } | Fail;

/** A new off-night plan, empty or copied from another plan of the zone. */
export async function createRoutePlan(zone: string, name: string, copyFrom: string | null): Promise<PlansResult> {
  if (!(await officerUser())) return fail('Officers only.');
  if (!zoneData(zone) || typeof name !== 'string' || (copyFrom !== null && !isPlanId(copyFrom))) return fail('Bad request.');
  try {
    const out = applyCreatePlan(await readStore(zone), zone, name, copyFrom, new Date().toISOString());
    if (!out) return fail('Could not add another plan (the zone is at its limit, or the plan to copy is gone).');
    await writeStore(out.store);
    return { ok: true, id: out.id, plans: planSummaries(out.store), row_stamp: out.store.updated_at };
  } catch {
    return fail('Could not add the plan.');
  }
}

/** Rename an off-night plan and/or set its target headcount (null clears it). */
export async function updateRoutePlanMeta(zone: string, planId: string, patch: { name?: string; target_headcount?: number | null }): Promise<PlansResult> {
  if (!(await officerUser())) return fail('Officers only.');
  if (!zoneData(zone) || !isPlanId(planId) || !patch || typeof patch !== 'object') return fail('Bad request.');
  try {
    const prev = await readStore(zone);
    const next = prev ? applyRenamePlan(prev, planId, patch, new Date().toISOString()) : null;
    if (!next) return fail('Could not update the plan (is the target a whole number from 1 to 200?).');
    await writeStore(next);
    return { ok: true, id: planId, plans: planSummaries(next), row_stamp: next.updated_at };
  } catch {
    return fail('Could not update the plan.');
  }
}

/** Delete an off-night plan (with its versions). The main-night plan cannot be deleted. */
export async function deleteRoutePlan(zone: string, planId: string): Promise<PlansResult> {
  if (!(await officerUser())) return fail('Officers only.');
  if (!zoneData(zone) || !isPlanId(planId)) return fail('Bad request.');
  try {
    const prev = await readStore(zone);
    const next = prev ? applyDeletePlan(prev, planId, new Date().toISOString()) : null;
    if (!next) return fail('That plan cannot be deleted.');
    await writeStore(next);
    return { ok: true, id: MAIN_PLAN, plans: planSummaries(next), row_stamp: next.updated_at };
  } catch {
    return fail('Could not delete the plan.');
  }
}

export type PublishResult =
  | { ok: true; stops: number; points: number }
  | { ok: false; confirm: { saved_at: string | null; stops: number | null } }
  | Fail;

/**
 * Send the saved plan to the in-game map: write it as `raid_route:<zone>`. An existing route there is replaced only when
 * `overwrite` is true; without it the answer says what is there so the page can ask first.
 */
export async function publishRoutePlan(zone: string, planId: string, opts: { skipOptional?: boolean; overwrite?: boolean }): Promise<PublishResult> {
  if (!(await officerUser())) return fail('Officers only.');
  const z = zoneData(zone);
  if (!z || !isPlanId(planId)) return fail('Bad request.');
  try {
    const store = await readStore(zone);
    const doc = store?.plans[planId];
    if (!doc || planEmpty(doc.current)) return fail('Save a plan with pins first.');
    const value = planToRaidRoute(doc.current, z, createFollow(z.nights), { skipOptional: !!opts?.skipOptional, nowIso: new Date().toISOString() });
    if (!value) return fail('The plan has no leg to draw: it needs two or more pins and at least one visible leg.');

    const admin = supabaseAdmin();
    const key = `raid_route:${zone}`;
    if (!opts?.overwrite) {
      const { data, error } = await admin.from('bot_kv').select('value').eq('guild_id', GUILD_TAG).eq('key', key).limit(1).maybeSingle();
      if (error) return fail('Could not check the saved route.');
      if (data) {
        const old = (data as { value: { saved_at?: unknown; stops?: unknown } | null }).value;
        return {
          ok: false,
          confirm: {
            saved_at: typeof old?.saved_at === 'string' ? old.saved_at : null,
            stops: Array.isArray(old?.stops) ? old.stops.length : null,
          },
        };
      }
    }
    const { error } = await admin.from('bot_kv')
      .upsert({ guild_id: GUILD_TAG, key, value, updated_at: new Date().toISOString() }, { onConflict: 'guild_id,key' });
    if (error) return fail('Could not send the route.');
    return { ok: true, stops: value.stops.length, points: value.points.length };
  } catch {
    return fail('Could not send the route.');
  }
}
