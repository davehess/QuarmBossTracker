// /pop/raid: the raid-night plan (the guild lead, 2026-10-13: "this is our target list for tomorrow. make us a
// raid page that has preflag checking, travel guide, expectations, and maps with paths preferably").
//
// New page, so it goes live with the [beta] tag. Members only. Three parts: who still lacks which preflag
// (Raid-Helper sign-ups for the night, else the whole raid roster), then one section per target with what to
// do before, how to get there, what to expect and the loot, beside a map of the zone with the route.
// The content is data in web/lib/raidPlan.ts; the step catalog is web/lib/popSteps.ts.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { selectAll } from '@/lib/selectAll';
import NewPageTag from '@/components/NewPageTag';
import { stepsHeld } from '@/lib/popSteps';
import { popRoster, RAIDER_RANKS, RAID_ALT_RANKS } from '@/lib/popRoster';
import { SELF_TICK_KEYS, selfFlagsFromTicks } from '@/lib/popSelfFlags';
import { WHO_ZONE_NAMES, flagsFromSightings, type Sighting } from '@/lib/popWho';
import { PLAN, PREFLAGS, RAID_DATE, RAID_DATE_LINE, TRAVEL_BASICS, bossAnchor, loc, pickRaidEvent } from '@/lib/raidPlan';
import ItemHover, { type ItemCard } from '@/app/character/[name]/inventory/ItemHover';
import ZoneSvg from './ZoneSvg';
import { loadWalls } from './walls';

export const metadata: Metadata = {
  title: '[beta] Raid night plan',
  description: 'Tonight\'s targets in order: who still needs a preflag, how to get there, what to expect and a map with the route.',
};

export const dynamic = 'force-dynamic';

// Raid-Helper sign-up statuses that do not count as coming (commands/preraid.js uses the same test).
const NOT_GOING = /absen|declin|bench|tentat/i;
const GUILD = 'wolfpack';

type Raider = { name: string; cls: string | null };
type Loaded = { raiders: Raider[]; held: Map<string, Set<string>>; note: string; unlinked: string[]; error: string | null };

const chunks = <T,>(xs: T[], n = 100): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

async function loadRaiders(): Promise<{ raiders: Raider[]; note: string; unlinked: string[] }> {
  const sb = supabaseAdmin();
  const { data: evRows, error: evErr } = await sb.from('rh_events')
    .select('id, title, start_time')
    .gte('start_time', '2026-10-14T00:00:00Z').lt('start_time', '2026-10-16T00:00:00Z')
    .order('start_time', { ascending: true }).limit(50);
  if (evErr) throw new Error(`events: ${evErr.message}`);
  const event = pickRaidEvent((evRows ?? []) as { id: string; title: string; start_time: string }[], RAID_DATE);

  if (event) {
    const signups = await selectAll<{ discord_id: string | null; user_name: string | null; status: string | null; class_name: string | null }>((from, to) =>
      sb.from('rh_signups').select('discord_id, user_name, status, class_name')
        .eq('event_id', event.id)
        .order('signup_id', { ascending: true }).range(from, to));
    const going = signups.filter(s => !NOT_GOING.test(String(s.status || '')));
    const ids = [...new Set(going.map(s => s.discord_id).filter((d): d is string => !!d))];
    // A main's main_name is its own name (null on a few old rows), so read every character the player has and
    // keep the mains here. characters has no level column (it lives in who_directory).
    type Row = { name: string; discord_id: string; class: string | null; rank: string | null; active: boolean | null; main_name: string | null };
    const rows: Row[] = [];
    for (const part of chunks(ids)) {
      const { data, error } = await sb.from('characters')
        .select('name, discord_id, class, rank, active, main_name')
        .eq('guild_id', GUILD).in('discord_id', part).limit(1000);
      if (error) throw new Error(`characters: ${error.message}`);
      rows.push(...(data ?? []) as Row[]);
    }
    const mains = rows.filter(c => !c.main_name || c.main_name.toLowerCase() === c.name.toLowerCase());
    // One main per player: the one on the class they signed up as, then active, then on a raider rank.
    const signedClass = new Map(going.map(s => [s.discord_id, String(s.class_name || '').toLowerCase()]));
    const score = (x: Row) => {
      const want = signedClass.get(x.discord_id) || '';
      const cls = String(x.class || '').toLowerCase();
      return (want && cls && (want.startsWith(cls) || cls.startsWith(want)) ? 4 : 0)
        + (x.active ? 2 : 0) + (RAIDER_RANKS.includes(x.rank ?? '') ? 1 : 0);
    };
    const best = new Map<string, Row>();
    for (const c of mains) {
      const cur = best.get(c.discord_id);
      if (!cur || score(c) > score(cur)) best.set(c.discord_id, c);
    }
    const linked = new Set(best.keys());
    const unlinked = going.filter(s => !s.discord_id || !linked.has(s.discord_id)).map(s => s.user_name || 'unknown');
    const raiders = [...best.values()].map(c => ({ name: c.name, cls: c.class })).sort((a, b) => a.name.localeCompare(b.name));
    if (raiders.length) {
      return { raiders, note: `Sign-ups: ${event.title}, ${going.length} going.`, unlinked };
    }
  }

  // No event, or nobody on it linked to a character: the whole raid roster, mains only.
  const { data: rosterRaw, error } = await sb.from('characters')
    .select('name, rank, active, class')
    .eq('guild_id', GUILD).in('rank', [...RAIDER_RANKS, ...RAID_ALT_RANKS]).limit(1000);
  if (error) throw new Error(`roster: ${error.message}`);
  const rows = (rosterRaw ?? []) as { name: string; rank: string | null; active: boolean | null; class: string | null }[];
  const levelOf = new Map<string, number>();
  for (const part of chunks(rows)) {
    const seen = await selectAll<{ character_key: string; level: number | null }>((from, to) =>
      sb.from('who_directory').select('character_key, level')
        .in('character_key', part.map(r => r.name.toLowerCase()))
        .order('character_key', { ascending: true }).range(from, to));
    for (const w of seen) {
      if (w.level != null && w.level > (levelOf.get(w.character_key) ?? 0)) levelOf.set(w.character_key, w.level);
    }
  }
  const members = popRoster(rows.map(r => ({ ...r, level: levelOf.get(r.name.toLowerCase()) ?? null }))).filter(m => m.main);
  const clsOf = new Map(rows.map(r => [r.name.toLowerCase(), r.class]));
  const raiders = members.map(m => ({ name: m.name, cls: clsOf.get(m.name.toLowerCase()) ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { raiders, note: 'No sign-up event found: showing all raiders.', unlinked: [] };
}

// Mimic's recorded flags, the owners' ticks and /who proof, merged, then expanded by what each step implies.
async function loadHeld(names: string[]): Promise<Map<string, Set<string>>> {
  const sb = supabaseAdmin();
  const flags = new Map<string, Set<string>>(names.map(n => [n.toLowerCase(), new Set<string>()]));
  const add = (key: string, flag: string) => flags.get(key)?.add(flag);

  const [flagRows, tickRows, sightRows] = await Promise.all([
    Promise.all(chunks(names).map(part => selectAll<{ character: string; flag_key: string }>((from, to) =>
      sb.from('pop_flags').select('character, flag_key')
        .in('character', part).not('flag_key', 'in', '(unmapped,hail)')
        .order('id', { ascending: true }).range(from, to)))),
    Promise.all(chunks(names).map(part => selectAll<{ character_name: string; item_key: string }>((from, to) =>
      sb.from('pop_guide_ticks').select('character_name, item_key')
        .eq('guild_id', GUILD).in('item_key', SELF_TICK_KEYS).in('character_name', part)
        .order('character_name', { ascending: true }).order('item_key', { ascending: true }).range(from, to)))),
    selectAll<Sighting & { character_key: string }>((from, to) =>
      sb.rpc('pop_who_sightings', { p_guild_id: GUILD, p_names: names.map(n => n.toLowerCase()), p_zones: WHO_ZONE_NAMES }).range(from, to)),
  ]);

  for (const r of flagRows.flat()) add(r.character.toLowerCase(), r.flag_key);
  for (const [k, fs] of selfFlagsFromTicks(tickRows.flat())) for (const f of fs) add(k, f);
  const sightBy = new Map<string, Sighting[]>();
  for (const r of sightRows) {
    if (!sightBy.has(r.character_key)) sightBy.set(r.character_key, []);
    sightBy.get(r.character_key)!.push(r);
  }
  for (const [k, rows] of sightBy) for (const f of flagsFromSightings(rows).keys()) add(k, f);

  return new Map([...flags].map(([k, set]) => [k, stepsHeld(set)]));
}

async function load(): Promise<Loaded> {
  try {
    const { raiders, note, unlinked } = await loadRaiders();
    const held = raiders.length ? await loadHeld(raiders.map(r => r.name)) : new Map<string, Set<string>>();
    return { raiders, held, note, unlinked, error: null };
  } catch (e) {
    return { raiders: [], held: new Map(), note: '', unlinked: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// Loot straight from the server's drop tables (eqemu_npc_drops), not typed by hand, plus the hover cards.
type Drop = { npc_id: number; item_id: number; item_name: string; effective_chance: number | null };
async function loadLoot(): Promise<{ drops: Map<number, Drop[]>; cards: Record<number, ItemCard> }> {
  const sb = supabaseAdmin();
  const npcs = PLAN.flatMap(s => s.bosses.map(b => b.npc));
  const { data } = await sb.from('eqemu_npc_drops')
    // 63 rows for tonight's nine bosses (2026-10-13); 100 leaves room without paging.
    .select('npc_id, item_id, item_name, effective_chance').in('npc_id', npcs).limit(100);
  const drops = new Map<number, Drop[]>();
  for (const d of (data ?? []) as Drop[]) {
    if (!drops.has(d.npc_id)) drops.set(d.npc_id, []);
    drops.get(d.npc_id)!.push(d);
  }
  for (const list of drops.values()) {
    list.sort((a, b) => (b.effective_chance ?? 0) - (a.effective_chance ?? 0) || a.item_name.localeCompare(b.item_name));
  }
  const ids = [...new Set((data ?? []).map(d => (d as Drop).item_id))];
  const cards: Record<number, ItemCard> = {};
  if (ids.length) {
    const { data: rows } = await sb.rpc('item_card_info', { p_item_ids: ids });
    for (const r of (rows ?? []) as ItemCard[]) cards[r.item_id] = r;
  }
  return { drops, cards };
}

const pct = (n: number | null) => n == null ? '' : n >= 99.95 ? 'always' : `${Number(n.toFixed(1))}%`;

const List = ({ items }: { items: string[] }) => (
  <ul className="list-disc space-y-0.5 pl-4 text-xs text-text">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
);
const H = ({ children }: { children: React.ReactNode }) => (
  <h4 className="mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-dim">{children}</h4>
);

export default async function RaidPlanPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/pop/raid');

  const [data, walls, loot] = await Promise.all([
    load(), Promise.all(PLAN.map(s => loadWalls(s.zone))),
    loadLoot().catch(() => ({ drops: new Map<number, Drop[]>(), cards: {} as Record<number, ItemCard> })),
  ]);
  const { raiders, held, note, unlinked, error } = data;
  const has = (name: string, key: string) => held.get(name.toLowerCase())?.has(key) ?? false;
  const missing = (key: string) => raiders.filter(r => !has(r.name, key)).map(r => r.name);

  return (
    <div className="mx-auto max-w-6xl py-2">
      <NewPageTag note="New page: raid-night plan with a preflag check, travel, expectations and maps." />
      <h1 className="text-2xl text-gold">Raid night plan</h1>
      <p className="mt-1 text-sm text-dim">{RAID_DATE_LINE}</p>

      <nav className="mt-3 rounded-lg border border-border bg-panel p-3 text-xs" aria-label="Targets">
        <ol className="space-y-1">
          <li><a href="#preflags" className="text-gold hover:underline">Preflag check</a></li>
          {PLAN.map((s, i) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-gold hover:underline">{i + 1}. {s.zoneName}</a>
              <span className="text-dim"> · </span>
              {s.bosses.map((b, j) => (
                <span key={b.npc}>
                  {j > 0 && <span className="text-dim">, </span>}
                  <a href={`#${bossAnchor(s.id, b.npc)}`} className="text-text hover:text-gold hover:underline">{b.name}</a>
                </span>
              ))}
            </li>
          ))}
        </ol>
      </nav>

      <section className="mt-4 rounded-lg border border-border bg-panel p-3">
        <h2 className="text-sm font-semibold text-text">{TRAVEL_BASICS.title}</h2>
        <p className="mt-1 text-xs text-dim">
          Everything starts in Tranquility. First time into a zone? Zone into the live one through its standard portal before the guild door works.
        </p>
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-gold">Click here for more info</summary>
          <List items={TRAVEL_BASICS.points} />
        </details>
      </section>

      <section id="preflags" className="mt-4 rounded-lg border border-border bg-panel p-3">
        <h2 className="text-sm font-semibold text-text">Preflag check</h2>
        <p className="mt-1 text-xs text-dim">{error ? '' : note}</p>
        {error ? (
          <p className="mt-2 text-xs text-red">Could not read the raiders: {error}</p>
        ) : raiders.length === 0 ? (
          <p className="mt-2 text-xs text-dim">No raiders found.</p>
        ) : (
          <>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[420px] text-xs">
                <thead>
                  <tr className="text-left text-dim">
                    <th className="py-1 pr-2 font-normal">Raider</th>
                    {PREFLAGS.map(p => <th key={p.key} className="px-1 py-1 text-center font-normal" title={p.label}>{p.short}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {raiders.map(r => (
                    <tr key={r.name} className="border-t border-border/60">
                      <td className="py-0.5 pr-2 text-text">{r.name}{r.cls && <span className="text-dim"> {r.cls}</span>}</td>
                      {PREFLAGS.map(p => (
                        <td key={p.key} className={`px-1 py-0.5 text-center ${has(r.name, p.key) ? 'text-green' : 'text-red'}`}>
                          <span aria-label={has(r.name, p.key) ? 'has it' : 'missing'}>{has(r.name, p.key) ? '✓' : '✗'}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="mt-3 space-y-2 text-xs">
              {PREFLAGS.map(p => {
                const m = missing(p.key);
                return (
                  <li key={p.key}>
                    <b className="text-text">{p.label}</b>{' '}
                    <span className="text-dim">(
                      {PLAN.filter(s => s.needs.includes(p.key)).map((s, j) => (
                        <span key={s.id}>{j > 0 && ', '}<a href={`#${s.id}`} className="hover:text-gold hover:underline">{s.zoneName}</a></span>
                      ))}
                    )</span>
                    <div className={m.length ? 'text-red' : 'text-green'}>
                      {m.length ? `missing (${m.length}): ${m.join(', ')}` : 'everyone has it'}
                    </div>
                    <div className="text-dim">{p.why}</div>
                  </li>
                );
              })}
            </ul>
            {unlinked.length > 0 && (
              <p className="mt-3 text-xs text-dim">Signed up with no linked character, so not checked: {unlinked.join(', ')}.</p>
            )}
            <p className="mt-3 text-[11px] text-dim">
              A ✓ comes from Mimic, a /who sighting inside the plane, or the owner&apos;s own tick on the{' '}
              <Link href="/pop/guide" className="underline hover:text-text">checklist</Link>. A later step in a series counts for the earlier ones.
            </p>
          </>
        )}
      </section>

      {PLAN.map((s, i) => (
        <section key={s.id} id={s.id} className="mt-6 scroll-mt-4">
          <h2 className="text-lg text-gold">{i + 1}. {s.title}</h2>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
            {s.needs.map(k => {
              const p = PREFLAGS.find(x => x.key === k);
              const m = missing(k).length;
              return (
                <span key={k} className={`rounded border px-1.5 py-0.5 ${raiders.length && m === 0 ? 'border-green/60 text-green' : 'border-border text-dim'}`}>
                  needs: {p?.short ?? k}{raiders.length > 0 && !error && <> · {m === 0 ? 'all set' : `${m} missing`}</>}
                </span>
              );
            })}
          </div>
          <div className="mt-2 grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-panel p-3">
              <H>Before</H>
              <List items={s.before} />
              <H>Travel</H>
              <List items={s.travel} />
              {s.bosses.map(b => (
                <div key={b.npc} id={bossAnchor(s.id, b.npc)} className="mt-4 scroll-mt-4 border-t border-border/60 pt-2">
                  <div className="text-sm font-semibold text-text">
                    <a href={`https://www.pqdi.cc/npc/${b.npc}`} target="_blank" rel="noreferrer" className="text-blue hover:underline">{b.name} ↗</a>
                    <span className="font-normal text-dim"> · PQDI npc {b.npc}</span>
                  </div>
                  <div className="text-xs text-gold">{b.stats}</div>
                  <div className="mt-0.5 text-xs text-dim">{b.abilities}</div>
                  {b.before && <><H>Before this one</H><List items={b.before} /></>}
                  <H>Expect</H>
                  <List items={b.mechanics} />
                  {b.after && <><H>After</H><List items={b.after} /></>}
                  <H>Loot</H>
                  {(loot.drops.get(b.npc) ?? []).length === 0 ? (
                    <p className="text-xs text-dim">Drop table not loaded; see PQDI.</p>
                  ) : (
                    <ul className="space-y-0.5 text-xs">
                      {loot.drops.get(b.npc)!.map(d => (
                        <li key={d.item_id}>
                          <ItemHover card={loot.cards[d.item_id]} fallbackName={d.item_name}>
                            <a href={`https://www.pqdi.cc/item/${d.item_id}`} target="_blank" rel="noreferrer" className="text-blue hover:underline">{d.item_name}</a>
                          </ItemHover>
                          <span className="text-dim"> {pct(d.effective_chance)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {b.history && <p className="mt-2 text-[11px] text-dim">{b.history}</p>}
                </div>
              ))}
            </div>
            <div>
              <ZoneSvg
                walls={walls[i]}
                markers={s.markers}
                route={s.route}
                altRoutes={s.altRoutes}
                patrol={s.patrol}
                label={`Map of ${s.zoneName} with the route`}
              />
              <p className="mt-1 text-[11px] text-dim">
                <span className="text-red">●</span> boss · <span className="text-green">◆</span> zone-in or door · <span className="text-gold">▲</span> NPC ·{' '}
                <span className="text-orange">- - -</span> numbered route: straight legs in order, not a walking path
                {s.patrol && <> · <span className="text-purple">——</span> patrol</>}
                {walls[i] ? '' : ' · walls unavailable for this zone right now'}
              </p>
              <ol className="mt-1 list-decimal pl-5 text-[11px] text-dim">
                {s.route.map((p, j) => <li key={j}>{p.label}</li>)}
              </ol>
              {s.altRoutes?.map((rt, j) => (
                <ol key={j} className="mt-1 list-decimal pl-5 text-[11px] text-blue">
                  {rt.map((p, k) => <li key={k}>{p.label}</li>)}
                </ol>
              ))}
              <details className="mt-2 text-[11px] text-dim">
                <summary className="cursor-pointer hover:text-text">Where things stand (/loc)</summary>
                <ul className="mt-1 space-y-0.5">
                  {s.markers.map(m => <li key={m.label}>{m.label}: <span className="font-mono text-text">{loc(m.x, m.y)}</span></li>)}
                </ul>
              </details>
            </div>
          </div>
        </section>
      ))}

      <p className="mt-8 text-xs text-dim">
        Read from Quarm&apos;s own quest scripts and spawn tables; distances are straight-line. Anything marked (inferred) is our reading, not a script line.
        Walls: EQEmu maps (GPLv2+, © EQEmulator.NET, AX-Classic and ProjectEQ).{' '}
        <Link href="/pop" className="underline hover:text-text">Back to PoP flags</Link>.
      </p>
    </div>
  );
}
