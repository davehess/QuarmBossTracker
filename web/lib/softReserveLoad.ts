// The reads behind /raid/sr and /admin/soft-reserve (lib/softReserve.ts holds the rules). SERVER ONLY: it uses the
// service client.
//
// One night, one signed-in member:
//   - the next Raid-Helper event (lib/raidMeLoad.ts loadNextEvent, the same rule /pop/raid/me uses);
//   - the character that member BRINGS to it (raidMe.ts bringingFrom, off their sign-up); SR belongs to that
//     character, so a main's pick never carries to an alt;
//   - the rules (sr_rules, else the defaults) and the targets: the bosses an officer picked for the event, else the
//     night's plan when the event is the plan night (lib/raidPlan.ts), else none. Raid-Helper's own text carries no
//     target list in our mirror (rh_events.description holds the muster point and the duty roster), so targets are
//     never parsed from it here;
//   - each target's drops (eqemu_npc_drops) with the item icon, and everyone's picks, shown only as far as the
//     rules allow (shownOn). Names never leave the server unless the viewer may see them.
import { supabaseAdmin } from '@/lib/supabase';
import { selectAll } from '@/lib/selectAll';
import { ownedCharacters } from '@/lib/ownedCharacters';
import { PLAN, isPlanNight } from '@/lib/raidPlan';
import { bringingFrom } from '@/lib/raidMe';
import { loadMySignup, loadNextEvent, type MySignup, type NextEvent } from '@/lib/raidMeLoad';
import {
  chooseTargets, isLocked, normalizeRules, shownOn, type Pick, type PickContext, type SrRules,
} from '@/lib/softReserve';

export type SrItem = {
  item_id: number; name: string; icon: number | null; chance: number | null;
  /** How many reserved it; null when the viewer may not see counts. */
  count: number | null;
  /** Who reserved it; null when the viewer may not see names. */
  names: string[] | null;
  mine: boolean;
};
export type SrBoss = { npc: number; name: string; items: SrItem[] };
export type TargetSource = 'officer' | 'plan' | 'none';

export type SrBase = {
  event: NextEvent;
  rules: SrRules;
  targets: number[];
  targetSource: TargetSource;
  drops: Map<number, Set<number>>;
};

const cleanName = (n: string) => n.replace(/^#/, '').replace(/_/g, ' ').trim();
const planNpcs = (): number[] => PLAN.flatMap(s => s.bosses.map(b => b.npc));

export async function loadRules(eventId: string): Promise<SrRules> {
  const { data, error } = await supabaseAdmin().from('sr_rules')
    .select('enabled, per_person, per_boss, visibility, npc_ids, lock_mode, lock_at, locked, no_reserve')
    .eq('event_id', eventId).maybeSingle();
  if (error) throw new Error(`rules: ${error.message}`);
  return normalizeRules(data as Partial<SrRules> | null);
}

export type DropRow ={ npc_id: number; item_id: number; item_name: string; effective_chance: number | null };

/** Every target's drop table, paged (a boss with a long table must not be cut at 1000 rows). */
export async function loadDropRows(npcs: number[]): Promise<DropRow[]> {
  if (!npcs.length) return [];
  // eqemu_npc_drops is a view with no unique key: ordering on the whole selected key tuple makes tied rows identical.
  return selectAll<DropRow>((from, to) =>
    supabaseAdmin().from('eqemu_npc_drops')
      .select('npc_id, item_id, item_name, effective_chance')
      .in('npc_id', npcs)
      .order('effective_chance', { ascending: true }).order('npc_id', { ascending: true }).order('item_id', { ascending: true })
      .range(from, to));
}

/** The event, its rules, its targets and what they drop: what both the page and the pick action judge against. */
export async function loadSrBase(now: Date = new Date()): Promise<SrBase | null> {
  const event = await loadNextEvent(now);
  if (!event) return null;
  const rules = await loadRules(event.id);
  const fallback = isPlanNight(event.start_time) ? planNpcs() : [];
  const targets = chooseTargets(rules, fallback);
  const targetSource: TargetSource = rules.npc_ids.length ? 'officer' : fallback.length ? 'plan' : 'none';
  const drops = new Map<number, Set<number>>();
  for (const d of await loadDropRows(targets)) {
    if (!drops.has(d.npc_id)) drops.set(d.npc_id, new Set());
    drops.get(d.npc_id)!.add(d.item_id);
  }
  return { event, rules, targets, targetSource, drops };
}

export type Bringing = { name: string; cls: string | null };

/** The character this member brings to the event, or null (no sign-up, or one that is not a yes). */
export async function loadBringing(userId: string, eventId: string): Promise<{ bringing: Bringing | null; signup: MySignup | null }> {
  const [owned, signup] = await Promise.all([ownedCharacters(userId), loadMySignup(eventId, userId)]);
  const c = bringingFrom(owned, signup);
  return { bringing: c ? { name: c.name, cls: c.class } : null, signup };
}

export async function loadPicksOf(eventId: string, character: string): Promise<Pick[]> {
  const { data, error } = await supabaseAdmin().from('sr_picks')
    .select('npc_id, item_id').eq('event_id', eventId).eq('character_name', character).limit(100);
  if (error) throw new Error(`picks: ${error.message}`);
  return (data ?? []) as Pick[];
}

/** The context checkAdd / checkRemove judge against. */
export const pickContext = (base: SrBase, now: Date = new Date()): PickContext => ({
  rules: base.rules, eventStartMs: Date.parse(base.event.start_time), nowMs: now.getTime(),
  drops: base.drops, targets: base.targets,
});

export type SrView = {
  base: SrBase | null;
  bringing: Bringing | null;
  signup: MySignup | null;
  bosses: SrBoss[];
  mine: Pick[];
  locked: boolean;
  /** Reserves per item across the whole raid, for the officer page's header line. */
  total: number;
  error: string | null;
};

/** Everything /raid/sr shows for this member. `officer` lifts the name limit (rule 5). */
export async function loadSrView(userId: string, officer: boolean, now: Date = new Date()): Promise<SrView> {
  const empty: SrView = { base: null, bringing: null, signup: null, bosses: [], mine: [], locked: false, total: 0, error: null };
  try {
    const base = await loadSrBase(now);
    if (!base) return empty;
    const { bringing, signup } = await loadBringing(userId, base.event.id);
    const mine = bringing ? await loadPicksOf(base.event.id, bringing.name) : [];
    const locked = isLocked(base.rules, Date.parse(base.event.start_time), now.getTime());

    const picks = await selectAll<{ character_name: string; npc_id: number; item_id: number }>((from, to) =>
      supabaseAdmin().from('sr_picks').select('character_name, npc_id, item_id').eq('event_id', base.event.id)
        .order('event_id', { ascending: true }).order('npc_id', { ascending: true }).order('item_id', { ascending: true })
        .order('character_name', { ascending: true })
        .range(from, to));
    const shown = shownOn(base.rules.visibility, officer ? 'officer' : 'page');
    const who = new Map<string, string[]>();
    for (const p of picks) {
      const k = `${p.npc_id}:${p.item_id}`;
      if (!who.has(k)) who.set(k, []);
      who.get(k)!.push(p.character_name);
    }

    const dropRows = await loadDropRows(base.targets);
    const ids = [...new Set(dropRows.map(d => d.item_id))];
    const icons = new Map<number, number | null>();
    if (ids.length) {
      const rows = await selectAll<{ id: number; icon: number | null }>((from, to) =>
        supabaseAdmin().from('eqemu_items').select('id, icon').in('id', ids).order('id', { ascending: true }).range(from, to));
      for (const r of rows) icons.set(r.id, r.icon);
    }
    const planNames = new Map(PLAN.flatMap(s => s.bosses.map(b => [b.npc, b.name] as const)));
    const missing = base.targets.filter(n => !planNames.has(n));
    const npcNames = new Map<number, string>();
    if (missing.length) {
      const { data } = await supabaseAdmin().from('eqemu_npc_types').select('id, name').in('id', missing).limit(100);
      for (const r of (data ?? []) as { id: number; name: string }[]) npcNames.set(r.id, cleanName(r.name));
    }

    const mineKeys = new Set(mine.map(p => `${p.npc_id}:${p.item_id}`));
    const bosses: SrBoss[] = base.targets.map(npc => ({
      npc,
      name: planNames.get(npc) ?? npcNames.get(npc) ?? `NPC ${npc}`,
      items: dropRows.filter(d => d.npc_id === npc)
        .sort((a, b) => (b.effective_chance ?? 0) - (a.effective_chance ?? 0) || a.item_name.localeCompare(b.item_name))
        .map(d => {
          const list = who.get(`${npc}:${d.item_id}`) ?? [];
          return {
            item_id: d.item_id, name: d.item_name, icon: icons.get(d.item_id) ?? null, chance: d.effective_chance,
            count: shown === 'none' ? null : list.length,
            names: shown === 'names' ? list : null,
            mine: mineKeys.has(`${npc}:${d.item_id}`),
          };
        }),
    }));
    return { base, bringing, signup, bosses, mine, locked, total: picks.length, error: null };
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) };
  }
}
