// /pop — Planes of Power flag tracker (BETA, pre-built for the 2026-10-01
// unlock). Roster × zone access matrix from pop_flags (agent-detected "You
// have received a character flag!" grants, attributed by zone + recent boss
// kill). ?zone=<key> filters to one zone: who can enter, who can't and what
// they're missing. The catalog is a DRAFT (web/lib/popFlags.ts) — verify
// before launch; 'unmapped' counts surface grants the catalog couldn't name.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { POP_ZONES, POP_FLAGS, zoneAccess } from '@/lib/popFlags';

export const dynamic = 'force-dynamic';

type FlagRow = { character: string; flag_key: string; earned_at: string; boss: string | null; zone: string | null };

export default async function PopFlagsPage({ searchParams }: { searchParams: Promise<{ zone?: string }> }) {
  const { zone: zoneKey } = await searchParams;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/pop');

  const sb = supabaseAdmin();
  const { data: flagRowsRaw } = await sb
    .from('pop_flags')
    .select('character, flag_key, earned_at, boss, zone')
    .order('earned_at', { ascending: true })
    .limit(20000);
  const flagRows = (flagRowsRaw ?? []) as FlagRow[];

  // flags per character (canonical display name = first-seen casing)
  const byChar = new Map<string, { name: string; flags: Set<string>; unmapped: number }>();
  for (const r of flagRows) {
    const k = r.character.toLowerCase();
    let c = byChar.get(k);
    if (!c) { c = { name: r.character, flags: new Set(), unmapped: 0 }; byChar.set(k, c); }
    if (r.flag_key === 'unmapped') c.unmapped++;
    else c.flags.add(r.flag_key);
  }
  const chars = Array.from(byChar.values()).sort((a, b) => b.flags.size - a.flags.size || a.name.localeCompare(b.name));
  const gatedZones = POP_ZONES.filter(z => z.requires.length > 0);
  const selected = zoneKey ? POP_ZONES.find(z => z.key === zoneKey) ?? null : null;

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold flex items-center gap-3 mb-1">
          <span>🌀 Planes of Power — Flags</span>
          <span className="text-[10px] tracking-widest font-bold px-2 py-0.5 rounded bg-orange/20 border border-orange/60 text-orange uppercase">Beta</span>
        </h2>
        <p className="text-sm text-dim leading-6">
          Who can enter what, from agent-detected flag grants (&quot;You have received a character flag!&quot;
          attributed by zone + the boss just killed). The flag catalog is a <b>draft</b> until PoP launches and
          we verify against the TAKP progression chart — <i>unmapped</i> badges are grants we saw but
          couldn&apos;t name yet. Seer Mal Nae dialogue parsing (the authoritative recital) lands at launch.
        </p>
      </section>

      <nav className="text-xs flex items-center gap-2 flex-wrap">
        <Link href="/pop" className={`px-2 py-1 rounded border ${!selected ? 'border-gold text-gold' : 'border-border text-dim hover:text-text'}`}>All zones</Link>
        {gatedZones.map(z => (
          <Link key={z.key} href={`/pop?zone=${z.key}`}
            className={`px-2 py-1 rounded border ${selected?.key === z.key ? 'border-gold text-gold' : 'border-border text-dim hover:text-text'}`}>
            {z.name}{!z.verified && ' *'}
          </Link>
        ))}
      </nav>

      {chars.length === 0 ? (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          No flags recorded yet — PoP unlocks 2026-10-01; grants flow automatically once members raid the
          planes with Mimic running. This page is pre-built so day-one flags land somewhere visible.
        </section>
      ) : selected ? (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h3 className="text-sm text-orange mb-1">{selected.name} — tier {selected.tier}{!selected.verified && <span className="text-dim"> · catalog unverified</span>}</h3>
          <p className="text-xs text-dim mb-3">Requires: {selected.requires.map(f => POP_FLAGS[f] ?? f).join(' + ') || 'open'}</p>
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs text-green mb-1">✓ Flagged ({chars.filter(c => zoneAccess(selected, c.flags)).length})</div>
              <ul className="space-y-0.5">
                {chars.filter(c => zoneAccess(selected, c.flags)).map(c => (
                  <li key={c.name}><Link href={`/character/${encodeURIComponent(c.name)}`} className="text-text hover:underline">{c.name}</Link></li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-xs text-red mb-1">✗ Missing</div>
              <ul className="space-y-0.5">
                {chars.filter(c => !zoneAccess(selected, c.flags)).map(c => (
                  <li key={c.name} className="text-dim">
                    <Link href={`/character/${encodeURIComponent(c.name)}`} className="hover:underline">{c.name}</Link>
                    <span className="text-xs"> — needs {selected.requires.filter(f => !c.flags.has(f)).map(f => POP_FLAGS[f] ?? f).join(', ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : (
        <section className="bg-panel border border-border rounded-lg p-4 overflow-x-auto">
          <table className="text-sm min-w-full">
            <thead>
              <tr className="text-dim text-xs text-left">
                <th className="py-1 pr-3">Character</th>
                {gatedZones.map(z => (
                  <th key={z.key} className="py-1 px-2 text-center" title={z.name}>{z.name.replace(/^(Plane|Tower|Reef|Halls|Lair|Crypt|Bastion) of /i, '')}</th>
                ))}
                <th className="py-1 pl-2 text-right">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {chars.map(c => (
                <tr key={c.name}>
                  <td className="py-1.5 pr-3">
                    <Link href={`/character/${encodeURIComponent(c.name)}`} className="text-text hover:underline">{c.name}</Link>
                    {c.unmapped > 0 && <span className="ml-1 text-[10px] text-orange" title="flag grants we couldn't attribute — catalog TODO">+{c.unmapped} unmapped</span>}
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
        </section>
      )}

      <section className="bg-panel border border-border rounded-lg p-4 text-xs text-dim leading-5">
        <b className="text-text">Before launch:</b> verify the catalog (zones marked *) against the TAKP
        progression wiki + flag-check tool, wire Seer Mal Nae dialogue parsing for authoritative backfill,
        and add the elemental/Time sub-requirements that aren&apos;t simple single-kill flags.
      </section>
    </div>
  );
}
