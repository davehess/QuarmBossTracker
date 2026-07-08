// /pop — "PoP Flags (Preview)" (pre-built for the 2026-10-01 PoP unlock).
//
// Primarily a GRAPHICAL progression chart (modeled on Samanna's classic planar
// chart): tier bands top-to-bottom, one card per zone with its gate, the flags
// earned inside, and live counts of how many rostered characters hold each
// flag / can enter each zone. Below the chart sits the raid-night planner —
// for each runnable target, how many raiders can attend and how many people a
// kill would push through which gate (unlock leverage), which is the "what do
// we run Sunday" question in one table.
//
// Flag data: pop_flags (agent-detected "You have received a character flag!"
// grants attributed by zone + recent boss kill; Seer Mal Nae recital parsing
// lands at launch for authoritative backfill). Catalog: web/lib/popFlags.ts —
// data-only edits when Quarm's documented QoL deviations land. 'unmapped'
// rows are grants we saw but couldn't name (the catalog's TODO list).
//
// Views: default = chart + planner · ?zone=<key> = who's in/missing ·
// ?view=matrix = roster × zone table.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import {
  POP_ZONES, POP_ZONE_BY_KEY, POP_FLAGS, POP_FLAG_DEFS, TIER_LABELS,
  zoneAccess, missingFor, type PopNode,
} from '@/lib/popFlags';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'PoP Flags (Preview) — Wolf Pack' };

type FlagRow = { character: string; flag_key: string; earned_at: string; boss: string | null; zone: string | null };
type CharFlags = { name: string; flags: Set<string>; unmapped: number };

const TIER_COLORS: Record<number, string> = {
  1: '#8b949e', 2: '#58a6ff', 3: '#d29922', 4: '#f0883e', 5: '#a371f7',
};
const KIND_ICONS: Record<string, string> = {
  kill: '⚔', trial: '🏛', quest: '📜', event: '✨', loot: '🎁',
};

export default async function PopFlagsPage(
  { searchParams }: { searchParams: Promise<{ zone?: string; view?: string }> },
) {
  const { zone: zoneKey, view } = await searchParams;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/pop');

  const sb = supabaseAdmin();
  const [{ data: flagRowsRaw }, { count: rosterCount }] = await Promise.all([
    sb.from('pop_flags')
      .select('character, flag_key, earned_at, boss, zone')
      .order('earned_at', { ascending: true })
      .limit(20000),
    sb.from('characters')
      .select('name', { count: 'exact', head: true })
      .eq('guild_id', 'wolfpack'),
  ]);
  const flagRows = (flagRowsRaw ?? []) as FlagRow[];

  // Per-character flag sets (canonical casing = first seen).
  const byChar = new Map<string, CharFlags>();
  for (const r of flagRows) {
    const k = r.character.toLowerCase();
    let c = byChar.get(k);
    if (!c) { c = { name: r.character, flags: new Set(), unmapped: 0 }; byChar.set(k, c); }
    if (r.flag_key === 'unmapped') c.unmapped++;
    else c.flags.add(r.flag_key);
  }
  const chars = Array.from(byChar.values())
    .sort((a, b) => b.flags.size - a.flags.size || a.name.localeCompare(b.name));
  const totalUnmapped = chars.reduce((n, c) => n + c.unmapped, 0);

  // Counts.
  const flagCount = new Map<string, number>();
  for (const c of chars) for (const f of c.flags) flagCount.set(f, (flagCount.get(f) ?? 0) + 1);
  const eligibleCount = new Map<string, number>();
  const eligibleChars = new Map<string, CharFlags[]>();
  for (const z of POP_ZONES) {
    const list = chars.filter(c => zoneAccess(z, c.flags));
    eligibleCount.set(z.key, list.length);
    eligibleChars.set(z.key, list);
  }

  // ── Raid-night planner ────────────────────────────────────────────────────
  // For each earnable flag F in zone Z: who could ATTEND (eligible for Z),
  // who would GAIN F, and what that unlocks — per downstream gate W where F is
  // required, the characters missing ONLY F for W ("one flag away through F").
  type PlanRow = {
    flag: string; zone: PopNode; attend: number; gains: number;
    unlocks: { zone: PopNode; count: number; names: string[] }[];
    leverage: number;
  };
  const plan: PlanRow[] = [];
  for (const z of POP_ZONES) {
    for (const fk of z.grants) {
      const def = POP_FLAGS[fk];
      if (!def || def.kind === 'loot') continue;
      const attendList = eligibleChars.get(z.key) ?? [];
      const gains = attendList.filter(c => !c.flags.has(fk));
      const unlocks = POP_ZONES
        .filter(w => w.requires.includes(fk))
        .map(w => {
          const oneAway = chars.filter(c => {
            const miss = missingFor(w, c.flags);
            return miss.length === 1 && miss[0] === fk;
          });
          return { zone: w, count: oneAway.length, names: oneAway.map(c => c.name) };
        })
        .filter(u => u.count > 0);
      const leverage = unlocks.reduce((n, u) => n + u.count, 0);
      plan.push({ flag: fk, zone: z, attend: attendList.length, gains: gains.length, unlocks, leverage });
    }
  }
  plan.sort((a, b) => b.leverage - a.leverage || b.gains - a.gains || a.zone.tier - b.zone.tier);
  const planTop = plan.filter(p => p.leverage > 0 || p.gains > 0).slice(0, 12);

  const selected = zoneKey ? POP_ZONE_BY_KEY[zoneKey] ?? null : null;
  const topLevel = POP_ZONES.filter(z => !z.subZoneOf);
  const childrenOf = (key: string) => POP_ZONES.filter(z => z.subZoneOf === key);
  const gatedZones = POP_ZONES.filter(z => z.requires.length > 0);

  // ── Card renderer (server-side JSX helper) ────────────────────────────────
  function ZoneCard({ z }: { z: PopNode }) {
    const color = TIER_COLORS[z.tier];
    const elig = eligibleCount.get(z.key) ?? 0;
    const kids = childrenOf(z.key);
    return (
      <div className="bg-panel border border-border rounded-lg p-3 flex flex-col gap-2"
           style={{ borderTop: `3px solid ${color}` }}>
        <div className="flex items-start justify-between gap-2">
          <Link href={`/pop?zone=${z.key}`} className="text-sm text-text font-semibold hover:underline leading-tight">
            {z.name}{!z.verified && <span className="text-dim" title="gate unverified until launch"> *</span>}
          </Link>
          <span className={`text-[11px] px-1.5 py-0.5 rounded border whitespace-nowrap ${elig > 0 ? 'border-green/60 text-green' : 'border-border text-dim'}`}
                title="characters who can enter">
            {elig} in
          </span>
        </div>
        {z.requires.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {z.requires.map(f => (
              <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-black/30 border border-border text-dim"
                    title={`${POP_FLAGS[f]?.label ?? f} — ${flagCount.get(f) ?? 0} have it`}>
                ⤓ {POP_FLAGS[f]?.label ?? f} <b className="text-text">{flagCount.get(f) ?? 0}</b>
              </span>
            ))}
          </div>
        )}
        <ul className="space-y-0.5">
          {z.grants.map(f => {
            const def = POP_FLAGS[f];
            const n = flagCount.get(f) ?? 0;
            return (
              <li key={f} className="text-xs flex items-center justify-between gap-2">
                <span className="text-dim">{KIND_ICONS[def?.kind ?? 'event']} {def?.label ?? f}{def && !def.verified && ' *'}</span>
                <span className={n > 0 ? 'text-green text-[11px]' : 'text-dim text-[11px]'}>👤 {n}</span>
              </li>
            );
          })}
        </ul>
        {z.levelBypass && (
          <div className="text-[10px] text-dim">classic: enter unflagged at {z.levelBypass}+</div>
        )}
        {z.note && <div className="text-[10px] text-dim italic leading-tight">{z.note}</div>}
        {kids.map(k => (
          <div key={k.key} className="mt-1 rounded border border-dashed border-border p-2">
            <ZoneCard z={k} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold flex items-center gap-3 mb-1">
          <span>🌀 PoP Flags</span>
          <span className="text-[10px] tracking-widest font-bold px-2 py-0.5 rounded bg-orange/20 border border-orange/60 text-orange uppercase">Preview</span>
        </h2>
        <p className="text-sm text-dim leading-6">
          The guild&apos;s road to <b className="text-text">Quarm</b> — every gate, who&apos;s through it, and what to
          raid next to move the most people forward. Counts update automatically from flag grants the agents see
          (&quot;You have received a character flag!&quot;). PoP unlocks <b className="text-text">2026-10-01</b>; until
          then this is the map. Zones marked <b className="text-text">*</b> follow the classic chart and get verified
          (or corrected — Quarm&apos;s QoL changes will be documented) at launch.
        </p>
        <div className="flex flex-wrap gap-4 mt-3 text-xs text-dim">
          <span>👥 <b className="text-text">{chars.length}</b> characters with flags · roster {rosterCount ?? '—'}</span>
          <span>🚩 <b className="text-text">{flagRows.length - totalUnmapped}</b> flags recorded</span>
          {totalUnmapped > 0 && <span className="text-orange">⚠ {totalUnmapped} unmapped grants (catalog TODO)</span>}
          <span className="ml-auto flex gap-2">
            <Link href="/pop" className={`px-2 py-0.5 rounded border ${!selected && view !== 'matrix' ? 'border-gold text-gold' : 'border-border hover:text-text'}`}>Chart</Link>
            <Link href="/pop?view=matrix" className={`px-2 py-0.5 rounded border ${view === 'matrix' ? 'border-gold text-gold' : 'border-border hover:text-text'}`}>Matrix</Link>
          </span>
        </div>
      </section>

      {selected ? (
        // ── Zone detail: who's in, who's missing what ─────────────────────────
        <section className="bg-panel border border-border rounded-lg p-4">
          <div className="flex items-center gap-3 mb-1">
            <h3 className="text-base text-orange">{selected.name}</h3>
            <span className="text-xs text-dim">{TIER_LABELS[selected.tier].name}{!selected.verified && ' · gate unverified'}</span>
            <Link href="/pop" className="ml-auto text-xs text-dim hover:text-text">← back to chart</Link>
          </div>
          <p className="text-xs text-dim mb-3">
            Gate: {selected.requires.map(f => POP_FLAGS[f]?.label ?? f).join(' + ') || 'open'}
            {selected.levelBypass ? ` · classic unflagged entry at ${selected.levelBypass}+` : ''}
          </p>
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs text-green mb-1">✓ Can enter ({(eligibleChars.get(selected.key) ?? []).length})</div>
              <ul className="space-y-0.5">
                {(eligibleChars.get(selected.key) ?? []).map(c => (
                  <li key={c.name}><Link href={`/character/${encodeURIComponent(c.name)}`} className="text-text hover:underline">{c.name}</Link></li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-xs text-red mb-1">✗ Missing ({chars.filter(c => !zoneAccess(selected, c.flags)).length})</div>
              <ul className="space-y-0.5">
                {chars.filter(c => !zoneAccess(selected, c.flags)).map(c => (
                  <li key={c.name} className="text-dim">
                    <Link href={`/character/${encodeURIComponent(c.name)}`} className="hover:underline">{c.name}</Link>
                    <span className="text-xs"> — {missingFor(selected, c.flags).map(f => POP_FLAGS[f]?.label ?? f).join(', ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : view === 'matrix' ? (
        // ── Roster × zone matrix (secondary view) ─────────────────────────────
        <section className="bg-panel border border-border rounded-lg p-4 overflow-x-auto">
          {chars.length === 0 ? (
            <p className="text-sm text-dim">No flags recorded yet — the matrix fills in as grants land.</p>
          ) : (
            <table className="text-sm min-w-full">
              <thead>
                <tr className="text-dim text-xs text-left">
                  <th className="py-1 pr-3">Character</th>
                  {gatedZones.map(z => <th key={z.key} className="py-1 px-2 text-center" title={z.name}>{z.short}</th>)}
                  <th className="py-1 pl-2 text-right">Flags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {chars.map(c => (
                  <tr key={c.name}>
                    <td className="py-1.5 pr-3">
                      <Link href={`/character/${encodeURIComponent(c.name)}`} className="text-text hover:underline">{c.name}</Link>
                      {c.unmapped > 0 && <span className="ml-1 text-[10px] text-orange" title="unattributed grants">+{c.unmapped}?</span>}
                    </td>
                    {gatedZones.map(z => (
                      <td key={z.key} className="py-1.5 px-2 text-center">
                        {zoneAccess(z, c.flags) ? <span className="text-green">✓</span> : <span className="text-dim">—</span>}
                      </td>
                    ))}
                    <td className="py-1.5 pl-2 text-right text-dim text-xs">{c.flags.size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : (
        <>
          {/* ── The chart — tier bands, Samanna-style ── */}
          <section className="max-w-5xl mx-auto space-y-3">
            {[1, 2, 3, 4, 5].map(tier => {
              const zones = topLevel.filter(z => z.tier === tier).sort((a, b) => a.col - b.col);
              if (zones.length === 0) return null;
              const t = TIER_LABELS[tier];
              return (
                <div key={tier} className="relative rounded-lg border border-border/60 p-3 pt-2"
                     style={{ background: 'rgba(110,118,129,0.05)' }}>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-xs font-bold tracking-wide" style={{ color: TIER_COLORS[tier] }}>{t.name}</span>
                    <span className="text-[10px] text-dim">{t.sub}</span>
                  </div>
                  <div className={`grid gap-3 ${tier === 5 ? 'sm:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
                    {tier === 5 && <div className="hidden sm:block" />}
                    {zones.map(z => <ZoneCard key={z.key} z={z} />)}
                  </div>
                  {tier < 5 && (
                    <div className="text-center text-dim text-xs leading-none mt-2 select-none">▼</div>
                  )}
                </div>
              );
            })}
            <p className="text-[10px] text-dim text-center">
              Chart topology after Samanna&apos;s classic planar progression chart · ⤓ gate flag with holder count ·
              👤 characters holding the flag · &quot;N in&quot; = can enter today
            </p>
          </section>

          {/* ── Raid-night planner ── */}
          <section className="bg-panel border border-border rounded-lg p-4">
            <h3 className="text-base text-orange mb-1">⚔ Raid-night planner</h3>
            <p className="text-xs text-dim mb-3">
              What to run to move the most raiders forward. <b className="text-text">Attend</b> = can enter the zone
              today · <b className="text-text">gain</b> = attendees still missing the flag · <b className="text-text">unlocks</b> =
              people this kill pushes through a later gate (they have every OTHER flag for it).
            </p>
            {chars.length === 0 ? (
              <p className="text-sm text-dim">
                No flags recorded yet — PoP unlocks 2026-10-01. Once members raid the planes with Mimic running,
                grants land here automatically and this table ranks itself. This page is pre-built so day-one
                flags have a home.
              </p>
            ) : planTop.length === 0 ? (
              <p className="text-sm text-dim">Everyone with recorded flags is caught up — nothing to chase. 🐺</p>
            ) : (
              <table className="text-sm w-full">
                <thead>
                  <tr className="text-dim text-xs text-left">
                    <th className="py-1 pr-3">Target</th>
                    <th className="py-1 px-2">Zone</th>
                    <th className="py-1 px-2 text-right">Attend</th>
                    <th className="py-1 px-2 text-right">Gain flag</th>
                    <th className="py-1 pl-2">Unlocks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {planTop.map(p => (
                    <tr key={p.flag}>
                      <td className="py-1.5 pr-3 text-text">{KIND_ICONS[POP_FLAGS[p.flag]?.kind ?? 'kill']} {POP_FLAGS[p.flag]?.label ?? p.flag}</td>
                      <td className="py-1.5 px-2 text-dim text-xs">
                        <Link href={`/pop?zone=${p.zone.key}`} className="hover:underline">{p.zone.short}</Link>
                      </td>
                      <td className="py-1.5 px-2 text-right text-dim">{p.attend}</td>
                      <td className="py-1.5 px-2 text-right text-text">{p.gains}</td>
                      <td className="py-1.5 pl-2 text-xs">
                        {p.unlocks.length === 0 ? <span className="text-dim">—</span> : p.unlocks.map(u => (
                          <details key={u.zone.key} className="inline-block mr-3 align-top">
                            <summary className="cursor-pointer text-green">+{u.count} → {u.zone.short}</summary>
                            <span className="text-dim">{u.names.join(', ')}</span>
                          </details>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      <section className="bg-panel border border-border rounded-lg p-4 text-xs text-dim leading-5">
        <b className="text-text">How this fills in:</b> agents detect the universal grant line and the bot attributes
        it from the zone + the boss just killed; unattributable grants stay visible as <i>unmapped</i> until the
        catalog names them. At launch: verify every * gate against Quarm&apos;s documented QoL changes (data-only
        edits), wire Seer Mal Nae recital parsing for authoritative backfill, and split multi-step gates (earth
        rings, Time phases) if Quarm keeps them. Sources: TAKP progression wiki · EQProgression planar guide ·
        Samanna chart v3.0.
      </section>
    </div>
  );
}
