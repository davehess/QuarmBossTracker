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
// ?view=matrix = roster × zone table · ?view=mine = the signed-in member's
// own characters (mains AND alts — see the scope note below).
//
// ?scope=mains (default) | all — governs the guild-wide surfaces (chart,
// matrix, planner, and the "PoP spells ... still need" table below). Default
// is mains: that's the number an officer planning a raid night cares about.
// It does NOT apply to ?view=mine — PoP flagging is commonly done on alts
// (a chance at Justice trial loot, a Storms-quest medallion run, whatever's
// up), so a member tracking their OWN roster needs every character they own,
// not just the one flagged as their main (Hitya, 2026-08-26: "due to the
// nature of pop flagging they may do it for many of their toons and we
// shouldn't only track mains").

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import {
  POP_ZONES, POP_ZONE_BY_KEY, POP_FLAGS, POP_FLAG_DEFS, TIER_LABELS,
  zoneAccess, missingFor, type PopNode,
} from '@/lib/popFlags';
import { POP_TURN_INS, POP_TURN_IN_ORDER, type TurnInKey } from '@/lib/popSpells';
import { ownedCharacters } from '@/lib/ownedCharacters';
import SpellbookSubmit from './SpellbookSubmit';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'PoP Flags (Preview) — Wolf Pack' };

type FlagRow = { character: string; flag_key: string; earned_at: string; boss: string | null; zone: string | null };
type CharFlags = { name: string; flags: Set<string>; unmapped: number };

// One row per (character, PoP spell they haven't scribed) — main OR alt, as
// of pop_spell_needs v4 (2026-08-26). Ordered by character level descending
// in the RPC — first to the level gets first dibs.
type SpellNeed = {
  spell_name: string; spell_id: number | null; scroll_item_id: number | null;
  spell_level: number | null;
  // Which parchment buys this spell FOR THIS CHARACTER'S CLASS, straight from
  // the quest-script pools (pop_parchment_pools). null = their class's
  // turn-ins can't award it (research, or another class's tradeable scroll).
  tier: TurnInKey | null;
  character_name: string; char_class: string | null;
  char_level: number | null; held_by: string[];
  is_main: boolean;
};

type NeedByChar = {
  name: string; cls: string | null; level: number | null; isMain: boolean;
  tiers: Record<TurnInKey, SpellNeed[]>;
  // Needed, but NOT awarded by this class's turn-ins — kept visible instead
  // of miscounted into a tier (the v1 bug Lacunanight caught: "necros have 9
  // spells but shows 12").
  other: SpellNeed[];
  total: number;
};

// Group the flat RPC rows per character, then per turn-in tier — because a
// parchment hands out a RANDOM spell from its tier, so "how many does this
// person still need at this tier" is the number that decides who gets it.
function groupNeeds(rows: SpellNeed[]): NeedByChar[] {
  const by = new Map<string, NeedByChar>();
  for (const r of rows) {
    let e = by.get(r.character_name);
    if (!e) {
      e = { name: r.character_name, cls: r.char_class, level: r.char_level, isMain: r.is_main,
            tiers: { ethereal: [], spectral: [], glyphed: [] }, other: [], total: 0 };
      by.set(r.character_name, e);
    }
    // r.tier comes from the actual quest-script pools, per class. No level
    // guessing — a spell outside the class's pools lands in `other`.
    if (r.tier) e.tiers[r.tier].push(r); else e.other.push(r);
    e.total++;
  }
  // RPC already sorts by level desc; keep that order and break ties by name.
  return [...by.values()].sort((a, b) =>
    (b.level ?? -1) - (a.level ?? -1) || a.name.localeCompare(b.name));
}

const TIER_COLORS: Record<number, string> = {
  1: '#8b949e', 2: '#58a6ff', 3: '#d29922', 4: '#f0883e', 5: '#a371f7',
};
const KIND_ICONS: Record<string, string> = {
  kill: '⚔', trial: '🏛', quest: '📜', event: '✨', loot: '🎁',
};

export default async function PopFlagsPage(
  { searchParams }: { searchParams: Promise<{ zone?: string; view?: string; scope?: string }> },
) {
  const { zone: zoneKey, view, scope: scopeParam } = await searchParams;
  const scope: 'mains' | 'all' = scopeParam === 'all' ? 'all' : 'mains';
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/pop');

  // PoP spell needs + the viewer's own characters (for the submit widget and
  // the My Characters view — that one deliberately ignores `scope`, see the
  // header note).
  const sbAdmin = supabaseAdmin();
  const [{ data: needRows }, myChars] = await Promise.all([
    sbAdmin.rpc('pop_spell_needs', { p_guild_id: 'wolfpack' }),
    ownedCharacters(user.id),
  ]);
  const spellNeeds = groupNeeds((needRows ?? []) as SpellNeed[]);
  const scopedSpellNeeds = scope === 'all' ? spellNeeds : spellNeeds.filter(n => n.isMain);

  // My Characters' own spell-needs slice (main + alt, scope-independent) and
  // which of those characters have a spellbook on file at all — lets the
  // empty state say "caught up" instead of the guild table's unavoidable
  // "nothing missing, or nothing submitted" hedge (we can actually check,
  // here, because the character list is short and known).
  const myNameSet = new Set(myChars.map(c => c.name.toLowerCase()));
  const myNeeds = spellNeeds.filter(n => myNameSet.has(n.name.toLowerCase()));
  let mySpellbookNames = new Set<string>();
  if (myChars.length > 0) {
    const orClause = myChars.map(c => `character_name.ilike.${c.name}`).join(',');
    const { data: sbRows } = await sbAdmin.from('character_spellbook')
      .select('character_name').eq('guild_id', 'wolfpack').or(orClause).limit(1000);
    mySpellbookNames = new Set(
      ((sbRows ?? []) as { character_name: string }[]).map(r => r.character_name.toLowerCase()));
  }
  const myCharsSorted = [...myChars].sort((a, b) =>
    (a.main_name ? 1 : 0) - (b.main_name ? 1 : 0) || a.name.localeCompare(b.name));

  const sb = supabaseAdmin();
  const [{ data: flagRowsRaw }, { data: charMetaRaw }, { count: rosterCount }] = await Promise.all([
    sb.from('pop_flags')
      .select('character, flag_key, earned_at, boss, zone')
      .order('earned_at', { ascending: true })
      .limit(20000),
    sb.from('characters')
      .select('name, main_name')
      .eq('guild_id', 'wolfpack'),
    sb.from('characters')
      .select('name', { count: 'exact', head: true })
      .eq('guild_id', 'wolfpack'),
  ]);
  const flagRows = (flagRowsRaw ?? []) as FlagRow[];

  // `pop_flags.character` is free text, not FK'd to `characters` — so knowing
  // whether a name is a main takes its own lookup, same "main_name IS NULL or
  // main_name = name" convention as everywhere else (e.g. pop_spell_needs).
  // A name `characters` doesn't know about defaults to "main" — the safe
  // direction under the mains-default rule is to keep it visible, not hide it.
  const mainOfLc = new Map<string, string | null>();
  for (const r of (charMetaRaw ?? []) as { name: string; main_name: string | null }[]) {
    const key = r.name.toLowerCase();
    const main = r.main_name?.toLowerCase() || null;
    mainOfLc.set(key, main && main !== key ? main : null);
  }
  const isMainName = (name: string) => (mainOfLc.get(name.toLowerCase()) ?? null) === null;

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

  // Everything below this line — counts, the chart, the matrix, the planner —
  // reads `scopedChars`, not `chars`. Default is mains; `?scope=all` widens
  // it to every character with a recorded flag. `chars`/`byChar` (unscoped)
  // stay around only for the My Characters view, which always wants the
  // viewer's full roster regardless of scope.
  const scopedChars = scope === 'all' ? chars : chars.filter(c => isMainName(c.name));

  // Counts.
  const flagCount = new Map<string, number>();
  for (const c of scopedChars) for (const f of c.flags) flagCount.set(f, (flagCount.get(f) ?? 0) + 1);
  const eligibleCount = new Map<string, number>();
  const eligibleChars = new Map<string, CharFlags[]>();
  for (const z of POP_ZONES) {
    const list = scopedChars.filter(c => zoneAccess(z, c.flags));
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
          const oneAway = scopedChars.filter(c => {
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

  // Nav + scope-toggle links. Every link preserves the OTHER dimension it
  // doesn't explicitly change — flipping scope while looking at a zone stays
  // on that zone; switching Chart/Matrix keeps whichever scope is set.
  function hrefFor(overrides: { view?: string | null; zone?: string | null; scope?: string | null }) {
    const next = {
      view: view ?? null, zone: zoneKey ?? null, scope: scope === 'all' ? 'all' : null,
      ...overrides,
    };
    const params = new URLSearchParams();
    if (next.zone) params.set('zone', next.zone);
    if (next.view) params.set('view', next.view);
    if (next.scope) params.set('scope', next.scope);
    const qs = params.toString();
    return '/pop' + (qs ? `?${qs}` : '');
  }
  const navCls = (active: boolean) =>
    `px-2 py-0.5 rounded border ${active ? 'border-gold text-gold' : 'border-border hover:text-text'}`;

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
        <div className="flex flex-wrap gap-4 mt-3 text-xs text-dim items-center">
          <span>
            👥 <b className="text-text">{scopedChars.length}</b> {scope === 'mains' ? 'mains' : 'characters'} with flags
            {scope === 'mains' && chars.length > scopedChars.length && (
              <span className="text-dim"> ({chars.length} incl. alts)</span>
            )}
            {' '}· roster {rosterCount ?? '—'}
          </span>
          <span>🚩 <b className="text-text">{flagRows.length - totalUnmapped}</b> flags recorded</span>
          {totalUnmapped > 0 && <span className="text-orange">⚠ {totalUnmapped} unmapped grants (catalog TODO)</span>}
          <span className="ml-auto flex flex-wrap gap-2 items-center">
            <span className="flex gap-1 mr-1" title="Applies to the chart, matrix, planner, and the spell-needs table below — not to My Characters, which always shows everything you own.">
              <Link href={hrefFor({ scope: null })} className={navCls(scope === 'mains')}>Mains</Link>
              <Link href={hrefFor({ scope: 'all' })} className={navCls(scope === 'all')}>All characters</Link>
            </span>
            <Link href={hrefFor({ view: null, zone: null })} className={navCls(!selected && view !== 'matrix' && view !== 'mine')}>Chart</Link>
            <Link href={hrefFor({ view: 'matrix', zone: null })} className={navCls(view === 'matrix')}>Matrix</Link>
            <Link href={hrefFor({ view: 'mine', zone: null })} className={navCls(view === 'mine')}>🧍 My Characters</Link>
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
              <div className="text-xs text-red mb-1">✗ Missing ({scopedChars.filter(c => !zoneAccess(selected, c.flags)).length})</div>
              <ul className="space-y-0.5">
                {scopedChars.filter(c => !zoneAccess(selected, c.flags)).map(c => (
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
          {scopedChars.length === 0 ? (
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
                {scopedChars.map(c => (
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
      ) : view === 'mine' ? (
        // ── My Characters — every character on the viewer's account, main
        // AND alt. Deliberately ignores the Mains/All scope toggle above:
        // PoP flagging isn't a mains-only activity, so tracking your own
        // roster means tracking every toon you own (Hitya, 2026-08-26).
        <section className="bg-panel border border-border rounded-lg p-4 space-y-4">
          <div>
            <h3 className="text-base text-orange mb-1">🧍 My Characters</h3>
            <p className="text-xs text-dim">
              Every character linked to your account — alts included. Zone columns mirror the
              Matrix view; hover a ✗ for exactly what&apos;s missing.
            </p>
          </div>

          {myChars.length === 0 ? (
            <div className="bg-bg border border-orange/40 rounded p-4 text-sm">
              <div className="text-orange mb-1">No characters linked to your account yet.</div>
              <div className="text-dim text-xs">
                Characters show up here once Mimic sees them in your EQ logs, or once an officer
                links them on <Link href="/admin/links" className="underline">/admin/links</Link>.
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-sm min-w-full">
                <thead>
                  <tr className="text-dim text-xs text-left">
                    <th className="py-1 pr-3">Character</th>
                    <th className="py-1 pr-3">Class</th>
                    {gatedZones.map(z => <th key={z.key} className="py-1 px-2 text-center" title={z.name}>{z.short}</th>)}
                    <th className="py-1 pl-2 text-right">Flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {myCharsSorted.map(c => {
                    const f = byChar.get(c.name.toLowerCase())
                      ?? { name: c.name, flags: new Set<string>(), unmapped: 0 };
                    return (
                      <tr key={c.name}>
                        <td className="py-1.5 pr-3">
                          <Link href={`/character/${encodeURIComponent(c.name)}`} className="text-text hover:underline">{c.name}</Link>
                          {!c.main_name && <span className="ml-1 text-[10px] text-gold" title="main">★</span>}
                        </td>
                        <td className="py-1.5 pr-3 text-dim">{c.class ?? '—'}</td>
                        {gatedZones.map(z => (
                          <td key={z.key} className="py-1.5 px-2 text-center"
                              title={zoneAccess(z, f.flags) ? undefined
                                : `missing ${missingFor(z, f.flags).map(fk => POP_FLAGS[fk]?.label ?? fk).join(', ')}`}>
                            {zoneAccess(z, f.flags) ? <span className="text-green">✓</span> : <span className="text-dim">—</span>}
                          </td>
                        ))}
                        <td className="py-1.5 pl-2 text-right text-dim text-xs">{f.flags.size}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {myChars.length > 0 && (
            <div>
              <h4 className="text-sm text-gold mb-1">📜 Your PoP spells still needed</h4>
              {myNeeds.length === 0 ? (
                <p className="text-sm text-dim">
                  {myChars.every(c => mySpellbookNames.has(c.name.toLowerCase()))
                    ? 'Every character with a submitted spellbook is caught up. 🐺'
                    : 'Submit a spellbook below to see what any of your characters still need.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-dim text-xs text-left">
                        <th className="py-1 pr-3">Character</th>
                        <th className="py-1 pr-3">Class</th>
                        {POP_TURN_IN_ORDER.map(k => (
                          <th key={k} className="py-1 pr-3 text-right" title={POP_TURN_INS[k].blurb}>
                            {POP_TURN_INS[k].item.replace(' Parchment', '').replace('Glyphed Rune Word', 'Rune Word')}
                          </th>
                        ))}
                        <th className="py-1 pr-3 text-right">Other</th>
                        <th className="py-1 pr-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {myNeeds.map(n => (
                        <tr key={n.name} className="align-top">
                          <td className="py-1.5 pr-3">
                            <Link href={`/character/${encodeURIComponent(n.name)}/spells`} className="text-blue hover:underline">{n.name}</Link>
                            {!n.isMain && <span className="ml-1 text-[10px] text-dim">alt</span>}
                          </td>
                          <td className="py-1.5 pr-3 text-dim">{n.cls ?? '—'}</td>
                          {POP_TURN_IN_ORDER.map(k => {
                            const list = n.tiers[k];
                            return (
                              <td key={k} className="py-1.5 pr-3 text-right"
                                  title={list.length ? list.map(x => x.spell_name).join(', ') : 'nothing needed at this tier'}>
                                <span className={list.length ? 'text-orange' : 'text-dim/50'}>{list.length || '—'}</span>
                              </td>
                            );
                          })}
                          <td className="py-1.5 pr-3 text-right"
                              title={n.other.length ? n.other.map(x => x.spell_name).join(', ') : 'nothing outside the turn-in lists'}>
                            <span className={n.other.length ? 'text-purple' : 'text-dim/50'}>{n.other.length || '—'}</span>
                          </td>
                          <td className="py-1.5 pr-3 text-right text-text">{n.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {myChars.some(c => !mySpellbookNames.has(c.name.toLowerCase())) && (
                <p className="text-[11px] text-dim mt-2">
                  No spellbook on file yet for:{' '}
                  <b className="text-text">
                    {myChars.filter(c => !mySpellbookNames.has(c.name.toLowerCase())).map(c => c.name).join(', ')}
                  </b>. Use the submit button below.
                </p>
              )}
            </div>
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

      {/* ── PoP spells [scope] still need ─────────────────────────────────── */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg text-gold mb-1">
              📜 PoP spells {scope === 'mains' ? 'mains' : 'characters'} still need
            </h2>
            <p className="text-sm text-dim leading-6 max-w-3xl">
              PoP spells come from turning a parchment in to your class&apos;s spell NPC, and each turn-in
              gives a <b className="text-text">random</b> spell from that trainer&apos;s hand-picked list for that
              parchment (read from the actual quest scripts — not guessed from spell levels) — so what matters is
              how many a person still needs from each list. Highest level first: whoever reaches the level first gets first dibs.
              Only {scope === 'mains' ? 'mains' : 'characters'} who have{' '}
              <b className="text-text">submitted a spellbook</b> appear — without one we
              can&apos;t tell &ldquo;doesn&apos;t have it&rdquo; from &ldquo;we don&apos;t know&rdquo;.{' '}
              {scope === 'mains' && (
                <>Alts need PoP spells too — see <Link href={hrefFor({ scope: 'all' })} className="underline">all characters</Link>{' '}
                or your own full roster under <Link href={hrefFor({ view: 'mine', zone: null })} className="underline">My Characters</Link>.</>
              )}
            </p>
          </div>
          <div className="shrink-0"><SpellbookSubmit characters={myChars.map(c => c.name)} /></div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {POP_TURN_IN_ORDER.map(k => (
            <span key={k} className="px-2 py-0.5 rounded border border-border text-dim" title={POP_TURN_INS[k].blurb}>
              <b className="text-text">{POP_TURN_INS[k].item}</b> → random from your class trainer&apos;s list
            </span>
          ))}
        </div>

        {scopedSpellNeeds.length === 0 ? (
          <p className="text-sm text-dim mt-3">
            Nobody with a submitted spellbook is missing a PoP spell yet — or no spellbooks have been submitted.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-dim text-xs text-left">
                  <th className="py-1 pr-3">Character</th>
                  <th className="py-1 pr-3">Class</th>
                  <th className="py-1 pr-3 text-right">Level</th>
                  {POP_TURN_IN_ORDER.map(k => (
                    <th key={k} className="py-1 pr-3 text-right" title={POP_TURN_INS[k].blurb}>
                      {POP_TURN_INS[k].item.replace(' Parchment', '').replace('Glyphed Rune Word', 'Rune Word')}
                    </th>
                  ))}
                  <th className="py-1 pr-3 text-right"
                      title="Needed, but not awarded by this class's parchment turn-ins — research spells, or another class's tradeable scroll (e.g. necro Destroy Undead rides a cleric 64 scroll).">
                    Other
                  </th>
                  <th className="py-1 pr-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {scopedSpellNeeds.map(n => (
                  <tr key={n.name} className="hover:bg-[#1a212c] align-top">
                    <td className="py-1.5 pr-3">
                      <Link href={`/character/${encodeURIComponent(n.name)}/spells`} className="text-blue hover:underline">{n.name}</Link>
                      {!n.isMain && <span className="ml-1 text-[10px] text-dim">alt</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-dim">{n.cls ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-right text-text">{n.level ?? '—'}</td>
                    {POP_TURN_IN_ORDER.map(k => {
                      const list = n.tiers[k];
                      return (
                        <td key={k} className="py-1.5 pr-3 text-right"
                            title={list.length ? list.map(x => x.spell_name).join(', ') : 'nothing needed at this tier'}>
                          <span className={list.length ? 'text-orange' : 'text-dim/50'}>{list.length || '—'}</span>
                        </td>
                      );
                    })}
                    <td className="py-1.5 pr-3 text-right"
                        title={n.other.length ? n.other.map(x => x.spell_name).join(', ') : 'nothing outside the turn-in lists'}>
                      <span className={n.other.length ? 'text-purple' : 'text-dim/50'}>{n.other.length || '—'}</span>
                    </td>
                    <td className="py-1.5 pr-3 text-right text-text">{n.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-dim mt-2">
              Hover a count to see the exact spells. <b>Other</b> = needed but not in this class&apos;s turn-in
              lists (research, or another class&apos;s tradeable scroll). Click a name for their full missing-spell list.
            </p>
          </div>
        )}
      </section>

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
