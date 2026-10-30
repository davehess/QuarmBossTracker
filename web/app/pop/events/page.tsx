// /pop/events: every scripted Planes of Power event, its loot with the drop chances, a score for each item and a
// ranking of the events (the guild lead, 2026-10-30: "comb through the PoP LUA scripts and get us a repository of
// those events and include the loot that can drop and the percentages. Give item scores to each item and then add a
// ranking that could be there for each event.").
//
// New page, so it goes live with the [beta] tag. Members only (it shows what the guild paid for items).
// The events are committed (web/lib/popEvents.ts, each claim cited to a script line); the drops and the item stats are
// read live and kept six hours (./load.ts); the scoring and the ranking are pure (web/lib/popEventsScore.ts).
// No client script: the sort, the zone and the class are plain links.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase-server';
import NewPageTag from '@/components/NewPageTag';
import {
  EVENTS, QUESTS_SHA, citeUrl, eventZones, type EventKind, type PopEvent,
} from '@/lib/popEvents';
import {
  BIG_INDEX, EVENT_SCORE_TUNING, HELPS_INDEX, SCORE_CLASSES, classFromToken, classToken, rankEvents, scoreItems,
  sortFromParam, type DropLine, type DropRow, type EventResult, type ItemScore, type SortKey,
} from '@/lib/popEventsScore';
import { loadEventsData, type EventsData } from './load';

export const metadata: Metadata = {
  title: '[beta] PoP events',
  description: 'Every scripted Planes of Power event with its loot, the drop chances, a score for each item and a ranking of the events.',
};

export const dynamic = 'force-dynamic';

type Params = { sort?: string; zone?: string; class?: string };

const SORT_LABEL: Record<SortKey, string> = {
  value: 'Value per run', best: 'Best item', breadth: 'Classes helped', big: 'Big-drop odds',
};
const KIND_LABEL: Record<EventKind, string> = { flag: 'flag path', 'raid-boss': 'raid boss', optional: 'optional' };
const KIND_CLS: Record<EventKind, string> = {
  flag: 'border-blue/60 text-blue', 'raid-boss': 'border-purple/60 text-purple', optional: 'border-border text-dim',
};

const pctText = (n: number) => (n >= 99.95 ? 'always' : n >= 10 ? `${Math.round(n)}%` : `${Number(n.toFixed(1))}%`);
const oddsText = (p: number) => (p <= 0 ? '–' : p < 0.01 ? '<1%' : `${Math.round(p * 100)}%`);
const idxCls = (i: number) => (i >= BIG_INDEX ? 'text-green' : i >= HELPS_INDEX ? 'text-text' : 'text-dim');
const npcLabel = (id: number) => `https://www.pqdi.cc/npc/${id}`;
const itemLink = (id: number) => `https://www.pqdi.cc/item/${id}`;

function hrefWith(cur: Params, change: Partial<Params>): string {
  const next = { ...cur, ...change };
  const q = new URLSearchParams();
  if (next.sort && next.sort !== 'value') q.set('sort', next.sort);
  if (next.zone) q.set('zone', next.zone);
  if (next.class) q.set('class', next.class);
  const s = q.toString();
  return `/pop/events${s ? `?${s}` : ''}`;
}

const chip = (on: boolean) =>
  `inline-block rounded border px-2 py-1 text-xs ${on ? 'border-gold text-gold' : 'border-border text-dim hover:text-text'}`;

function Bar({ index }: { index: number }) {
  return (
    <span aria-hidden className="inline-block h-1.5 w-12 overflow-hidden rounded-sm bg-border align-middle">
      <span className={`block h-full ${index >= BIG_INDEX ? 'bg-green' : index >= HELPS_INDEX ? 'bg-blue' : 'bg-dim'}`} style={{ width: `${Math.min(100, Math.max(2, index))}%` }} />
    </span>
  );
}

export default async function PopEventsPage({ searchParams }: { searchParams: Params }) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/pop/events');

  const cls = classFromToken(searchParams.class);
  const cur: Params = {
    sort: sortFromParam(searchParams.sort),
    zone: EVENTS.some(e => e.zone === searchParams.zone) ? searchParams.zone : undefined,
    class: cls ? classToken(cls) : undefined,
  };

  let data: EventsData;
  try {
    data = await loadEventsData();
  } catch (e) {
    return (
      <div className="mx-auto max-w-4xl py-2">
        <NewPageTag note="New page: every scripted Planes of Power event with its loot, item scores and a ranking." />
        <h1 className="text-2xl text-gold">PoP events</h1>
        <p className="mt-3 rounded border border-red/50 bg-red/10 p-3 text-sm text-red">
          The loot tables did not load ({e instanceof Error ? e.message : 'unknown error'}). Reload in a minute.
        </p>
      </div>
    );
  }

  // One scoring pass over every item on the page: the index is relative to the best item of each class here.
  const scores = scoreItems(data.items);
  const itemName = new Map(data.items.map(i => [i.id, i.name ?? `item ${i.id}`]));
  const dkp = new Map(data.dkp.map(([k, avg, n]) => [k, { avg, n }]));
  const drops = new Map<number, DropRow[]>();
  for (const d of data.drops) {
    if (!drops.has(d.npc_id)) drops.set(d.npc_id, []);
    drops.get(d.npc_id)!.push(d);
  }

  const inScope = EVENTS.filter(e => !cur.zone || e.zone === cur.zone);
  const ranked = rankEvents(inScope, drops, scores, { cls, sort: sortFromParam(cur.sort) });
  const bySlug = new Map(EVENTS.map(e => [e.slug, e]));
  const zones = eventZones();
  const T = EVENT_SCORE_TUNING;

  return (
    <div className="mx-auto max-w-6xl py-2">
      <NewPageTag note="New page: every scripted Planes of Power event with its loot, item scores and a ranking." />
      <h1 className="text-2xl text-gold">PoP events</h1>
      <p className="mt-1 max-w-3xl text-sm text-dim">
        {EVENTS.length} scripted events from the quest scripts, with the loot each can drop, the chance, and a 0 to 100 score for
        every wearable item. The ranking is the expected score per run. The drop chances come from the server&apos;s loot tables;
        every rule below links to the script lines it was read from.
      </p>
      <p className="mt-1 text-xs text-dim">
        <Link href="/pop/guide" className="text-blue hover:underline">PoP checklist</Link>
        {' · '}
        <Link href="/pop" className="text-blue hover:underline">PoP flags</Link>
      </p>

      <section aria-label="Sort and filter" className="mt-4 space-y-2 rounded-lg border border-border bg-panel p-3 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-20 text-[10px] uppercase tracking-wider text-dim">Rank by</span>
          {(Object.keys(SORT_LABEL) as SortKey[]).map(k => (
            <Link key={k} href={hrefWith(cur, { sort: k })} className={chip(cur.sort === k)} aria-current={cur.sort === k ? 'true' : undefined}>{SORT_LABEL[k]}</Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-20 text-[10px] uppercase tracking-wider text-dim">Zone</span>
          <Link href={hrefWith(cur, { zone: undefined })} className={chip(!cur.zone)}>All</Link>
          {zones.map(z => (
            <Link key={z.zone} href={hrefWith(cur, { zone: z.zone })} className={chip(cur.zone === z.zone)} aria-current={cur.zone === z.zone ? 'true' : undefined}>
              {z.zoneName} <span className="text-dim">{z.count}</span>
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-20 text-[10px] uppercase tracking-wider text-dim">For class</span>
          <Link href={hrefWith(cur, { class: undefined })} className={chip(!cls)}>Any</Link>
          {SCORE_CLASSES.map(c => (
            <Link key={c} href={hrefWith(cur, { class: classToken(c) })} className={chip(cls === c)} aria-current={cls === c ? 'true' : undefined}>{c}</Link>
          ))}
        </div>
      </section>

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wider text-dim">
        Ranking{cls ? ` for ${cls}` : ''}{cur.zone ? ` in ${zones.find(z => z.zone === cur.zone)?.zoneName}` : ''}
      </h2>
      <div className="mt-2 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[56rem] text-left text-xs">
          <thead className="bg-panel text-[10px] uppercase tracking-wider text-dim">
            <tr>
              <th className="px-2 py-1.5">#</th>
              <th className="px-2 py-1.5">Event</th>
              <th className="px-2 py-1.5">Kind</th>
              <th className="px-2 py-1.5 text-right" title="Expected score points per run: chance × rolls × kills × item score, summed over the loot">Value / run</th>
              <th className="px-2 py-1.5">Best item</th>
              <th className="px-2 py-1.5 text-right" title={`Classes with some drop scoring ${HELPS_INDEX} or more`}>Classes</th>
              <th className="px-2 py-1.5 text-right" title={`Chance that at least one item scoring ${BIG_INDEX} or more drops in a run`}>Big drop</th>
              <th className="px-2 py-1.5">Group</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => {
              const e = bySlug.get(r.slug)!;
              return (
                <tr key={r.slug} className="border-t border-border align-top">
                  <td className="px-2 py-1.5 text-dim">{i + 1}</td>
                  <td className="px-2 py-1.5">
                    <a href={`#${e.slug}`} className="text-blue hover:underline">{e.name}</a>
                    <div className="text-[11px] text-dim">{e.zoneName}</div>
                  </td>
                  <td className="px-2 py-1.5"><span className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] ${KIND_CLS[e.kind]}`}>{KIND_LABEL[e.kind]}</span></td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gold">{r.value > 0 ? Math.round(r.value) : '–'}</td>
                  <td className="px-2 py-1.5">
                    {r.best ? (
                      <>
                        <a href={itemLink(r.best.itemId)} target="_blank" rel="noreferrer" className="text-text hover:underline">{r.best.name}</a>
                        <span className={`ml-1 tabular-nums ${idxCls(r.best.index)}`}>{Math.round(r.best.index)}</span>
                        <span className="ml-1 text-dim">{pctText(r.best.chance)}</span>
                      </>
                    ) : <span className="text-dim">no gear listed</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.helps > 0 ? `${r.helps}/${SCORE_CLASSES.length}` : '–'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{oddsText(r.bigOdds)}</td>
                  <td className="px-2 py-1.5 text-dim">{e.size ?? '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section aria-label="How the score works" className="mt-4 rounded-lg border border-border bg-panel p-3 text-xs text-text">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-dim">How the score and the ranking work</h2>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          <li>
            <b className="text-gold">Item score, 0 to 100.</b> For each class that can use the item, its points under the gear finder&apos;s
            weights (the same ones as <Link href="/me/upgrades" className="text-blue hover:underline">Gear upgrades</Link>, level 65, no worn gear),
            divided by the best item of that class anywhere on this page. The score is the best class&apos;s number, and
            &ldquo;best for&rdquo; names the top three. Hover a score for the raw points. {BIG_INDEX}+ is a big drop.
          </li>
          <li>
            <b className="text-gold">Tuned for this page:</b> procs and focus count for more, and attack counts for more for melee. Any focus
            adds {T.focus.caster} points to a caster, {T.focus.hybrid} to a hybrid and {T.focus.other} to a pure melee class. A proc adds {T.proc.melee} to
            a melee class ({T.proc.meleeWeapon} on a weapon) and {T.proc.other} to anyone else. A melee class&apos;s attack counts ×{T.attackMultiplier}.
            The finder gives a flat 2 and 1 for these. The size of the focus or the proc is not read, so a tiny proc scores like a great one.
          </li>
          <li>
            <b className="text-gold">Not seen:</b> worn effects and clickies count for 1 and 0.5 points only, and haste, attack, regen, mana regen and damage
            shield were filled in for about 558 items, so an item that fill missed scores low. Items you cannot wear (tokens, patterns, gems)
            have no score and add nothing to an event&apos;s value; they are listed as other loot.
          </li>
          <li>
            <b className="text-gold">Value per run</b> = for each loot mob, kills × (chance ÷ 100 × rolls) × item score, added up. Mobs a script spawns
            in unstated numbers (waves of trash) count once, so trash-heavy events are under-counted; mobs with a stated number show it (×15).
            The loot table&apos;s drop limits are not in our copy of the tables. <b className="text-gold">Classes</b> counts the classes with a drop scoring {HELPS_INDEX}+.
            <b className="text-gold"> Big drop</b> is the chance of at least one {BIG_INDEX}+ item in a run.
          </li>
          <li>
            <b className="text-gold">Paid</b> is what the guild has paid in DKP for the item (average, and how many awards), from any boss.
            {!data.dkpOk && <span className="text-orange"> The DKP read failed, so none is shown right now.</span>}
            {' '}Drops and stats are read from the server&apos;s tables and refreshed every six hours.
          </li>
        </ul>
      </section>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-dim">The events</h2>
      <div className="mt-2 space-y-4">
        {ranked.map((r, i) => (
          <EventCard key={r.slug} e={bySlug.get(r.slug)!} r={r} rank={i + 1} scores={scores} itemName={itemName} dkp={dkp} cls={cls} />
        ))}
      </div>
      <p className="mt-6 text-[11px] text-dim">
        Scripts: SecretsOTheP/quests at {QUESTS_SHA.slice(0, 7)}. Quarm&apos;s own scripts may differ from the ones read.
      </p>
    </div>
  );
}

function EventCard({ e, r, rank, scores, itemName, dkp, cls }: {
  e: PopEvent; r: EventResult; rank: number;
  scores: Map<number, ItemScore>; itemName: Map<number, string>; dkp: Map<string, { avg: number; n: number }>; cls: string | null;
}) {
  const linesByNpc = new Map<number, DropLine[]>();
  for (const l of r.lines) {
    if (!linesByNpc.has(l.npcId)) linesByNpc.set(l.npcId, []);
    linesByNpc.get(l.npcId)!.push(l);
  }
  return (
    <section id={e.slug} className="scroll-mt-16 rounded-lg border border-border bg-panel p-3">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base text-gold">{e.name}</h3>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${KIND_CLS[e.kind]}`}>{KIND_LABEL[e.kind]}</span>
        <span className="text-xs text-dim">{e.zoneName}</span>
        <span className="ml-auto text-xs text-dim">
          #{rank} · value <b className="tabular-nums text-gold">{r.value > 0 ? Math.round(r.value) : '–'}</b> per run
        </span>
      </header>
      <p className="mt-1 text-[11px] text-dim">{e.kindWhy}</p>

      <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[7rem_1fr]">
        <dt className="text-dim">How it starts</dt><dd>{e.start}</dd>
        <dt className="text-dim">Timers</dt><dd>{e.timers}</dd>
        {e.groupLimit && (<><dt className="text-dim">Who can take part</dt><dd>{e.groupLimit}</dd></>)}
      </dl>
      <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-text">
        {e.mechanics.map((m, i) => <li key={i}>{m}</li>)}
      </ul>

      {e.npcs.length > 0 && (
        <div className="mt-3 space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-dim">Loot{cls ? ` (scored for ${cls})` : ''}</h4>
          {e.npcs.map(n => {
            const lines = (linesByNpc.get(n.npcId) ?? []).slice().sort((a, b) => b.index - a.index || b.chance - a.chance || a.name.localeCompare(b.name));
            const gear = lines.filter(l => l.wearable);
            const other = lines.filter(l => !l.wearable).sort((a, b) => b.chance - a.chance || a.name.localeCompare(b.name));
            return (
              <div key={n.npcId}>
                <div className="text-xs">
                  <a href={npcLabel(n.npcId)} target="_blank" rel="noreferrer" className="text-blue hover:underline">{n.name} ↗</a>
                  <span className="text-dim"> · level {n.level} · {n.hp.toLocaleString('en-US')} HP</span>
                  {n.kills != null && n.kills !== 1 && <span className="text-dim"> · ×{n.kills} per run{n.killsNote ? ` (${n.killsNote})` : ''}</span>}
                </div>
                {lines.length === 0 ? (
                  <p className="mt-0.5 text-[11px] text-dim">No loot in the database for this mob.</p>
                ) : (
                  <>
                    {gear.length > 0 && (
                      <div className="mt-1 overflow-x-auto">
                        <table className="w-full min-w-[34rem] text-left text-xs">
                          <thead className="text-[10px] uppercase tracking-wider text-dim">
                            <tr>
                              <th className="py-1 pr-2 font-normal">Item</th>
                              <th className="px-2 py-1 text-right font-normal">Drops</th>
                              <th className="px-2 py-1 font-normal">Score</th>
                              <th className="px-2 py-1 font-normal">Best for</th>
                              <th className="px-2 py-1 text-right font-normal">Paid</th>
                            </tr>
                          </thead>
                          <tbody>
                            {gear.map((l, j) => {
                              const sc = scores.get(l.itemId);
                              const paid = dkp.get(l.name.toLowerCase());
                              const tip = sc
                                ? `${Math.round(sc.bestRaw)} raw points as ${sc.top[0]?.cls ?? 'no class'}${sc.notes.length ? `; ${sc.notes.join(', ')}${sc.notes.some(x => x.startsWith('ATK')) ? ' for melee' : ''}` : ''}`
                                : undefined;
                              return (
                                <tr key={`${l.itemId}-${j}`} className="border-t border-border/60">
                                  <td className="py-1 pr-2">
                                    <a href={itemLink(l.itemId)} target="_blank" rel="noreferrer" className="text-text hover:underline">{itemName.get(l.itemId) ?? l.name}</a>
                                  </td>
                                  <td className="px-2 py-1 text-right tabular-nums">
                                    {pctText(l.chance)}{l.rolls > 1 && <span className="text-dim"> ×{l.rolls}</span>}
                                  </td>
                                  <td className="px-2 py-1" title={tip}>
                                    <span className={`mr-1.5 inline-block w-7 text-right tabular-nums ${idxCls(l.index)}`}>{Math.round(l.index)}</span>
                                    <Bar index={l.index} />
                                  </td>
                                  <td className="px-2 py-1 text-dim">
                                    {cls ? (l.index > 0 ? cls : 'cannot use') : sc?.top.map(t => `${t.cls} ${Math.round(t.idx)}`).join(', ')}
                                  </td>
                                  <td className="px-2 py-1 text-right tabular-nums text-dim">{paid ? <>{paid.avg} <span className="text-[10px]">({paid.n})</span></> : ''}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {other.length > 0 && (
                      <p className="mt-1 text-[11px] text-dim">
                        <span className="uppercase tracking-wider">Other loot </span>
                        {other.map(l => `${l.name} ${pctText(l.chance)}${l.rolls > 1 ? ` ×${l.rolls}` : ''}`).join(' · ')}
                      </p>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {e.rewards.length > 0 && (
        <div className="mt-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-dim">Handed out by a quest (not a drop, not in the value)</h4>
          <ul className="mt-1 space-y-0.5 text-xs">
            {e.rewards.map(w => {
              const sc = scores.get(w.itemId);
              return (
                <li key={w.itemId}>
                  <a href={itemLink(w.itemId)} target="_blank" rel="noreferrer" className="text-text hover:underline">{itemName.get(w.itemId) ?? w.name}</a>
                  {sc?.wearable && <span className={`ml-1 tabular-nums ${idxCls(sc.best)}`} title={`${Math.round(sc.bestRaw)} raw points`}>{Math.round(sc.best)}</span>}
                  <span className="text-dim"> · {w.trigger}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="mt-3 text-[11px] text-dim">
        <span className="uppercase tracking-wider">Script lines </span>
        {e.cites.length === 0 && 'none: no script touches these mobs, so only the loot tables speak for them.'}
        {e.cites.map((c, i) => {
          const url = citeUrl(c);
          return (
            <span key={c}>
              {i > 0 && ' · '}
              {url ? <a href={url} target="_blank" rel="noreferrer" className="hover:text-text hover:underline">{c}</a> : c}
            </span>
          );
        })}
      </p>
    </section>
  );
}
