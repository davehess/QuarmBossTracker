// /roster — the guild's typical raiders, by role and class, from raid ticks.
// (Uilnayar 2026-07-08: "implement our own roster page with our typical
// raiders, broken out by class... off of raid ticks... list their 60 day raid
// attendance, using that as the sorting descending by class.")
//
// Reworked 2026-07-10 (Uilnayar): rows are FAMILIES (main + linked alts), and
// the headline number is the PERSON's attendance — distinct ticks attended by
// ANY of their characters ÷ possible ticks — shown as % and tick count. Alts
// under 50% of the family's usage fold into an expandable "alts" section
// under the main (name + ticks + usage share); an alt at ≥50% usage (the
// person mostly plays it) stays visible in italics. The [Alt nights] toggle
// recomputes the whole page over just the alt-night raids ("Alt Extravaganza",
// "Alt Bonanza", "VT + Alt Fun" — any raid named with the word "alt").
//
// Attendance math matches /admin/attendance (and OpenDKP): per-TICK rate over
// the window, counting only ticks that actually captured attendees (empty
// ticks are sync gaps and don't penalize anyone). Window is fixed at 60 days.
//
// "Typical raider" = family at ≥25% attendance over the window (?min=NN).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Roster — Wolf Pack' };

type CharRow = { name: string; class: string | null; main_name: string | null; active: boolean; rank: string | null };
type Raid = { raid_id: number; ts: string; name: string | null };
type Tick = { raid_id: number; attendees: string[] };

const ROLE_GROUPS: { role: string; icon: string; classes: string[] }[] = [
  { role: 'Tanks',        icon: '🛡',  classes: ['Warrior', 'Shadow Knight', 'Paladin'] },
  { role: 'Healers',      icon: '⚕',  classes: ['Cleric', 'Druid', 'Shaman'] },
  { role: 'Melee DPS',    icon: '⚔',  classes: ['Monk', 'Rogue', 'Ranger', 'Beastlord'] },
  { role: 'Caster DPS',   icon: '🔥', classes: ['Wizard', 'Magician', 'Necromancer'] },
  { role: 'Support & CC', icon: '🎵', classes: ['Enchanter', 'Bard'] },
];

const ROSTER_RANKS = new Set(['Raid Pack', 'Officer', 'Pack Leader', 'Recruit']);
const DEFAULT_MIN_RA = 25;      // percent — family attendance bar for the roster
const ALT_FOLD_SHARE = 0.5;     // alts under this share of the family's usage collapse
const ALT_NIGHT_RX = /\balt\b/i;   // "Alt Extravaganza", "Alt Bonanza", "VT + Alt Fun"

type Member = { name: string; ticks: number; share: number };   // share of the family's usage
type Family = {
  main: string;               // display/link name of the family root
  className: string;
  ra: number;                 // person's attendance %: distinct ticks ÷ totalTicks
  attendedTicks: number;      // distinct ticks any family member attended
  members: Member[];          // every member with ticks, sorted by usage desc
  soloMain: boolean;          // no alt ever ticked — render as a plain row
  isUnlinkedAlt: boolean;     // its own "family" only because no main link exists
};

export default async function RosterPage(
  { searchParams }: { searchParams: Promise<{ min?: string; raids?: string }> },
) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/roster');
  const { min, raids: raidsParam } = await searchParams;
  const minRa = Math.max(0, Math.min(100, parseInt(min ?? '', 10) || DEFAULT_MIN_RA));
  const altView = raidsParam === 'alt';

  const admin = supabaseAdmin();
  const since60 = new Date(Date.now() - 60 * 86400_000).toISOString();
  const [{ data: charsRaw }, { data: raidsRaw }] = await Promise.all([
    admin.from('characters')
      .select('name, class, main_name, active, rank')
      .eq('guild_id', 'wolfpack'),
    admin.from('opendkp_raids')
      .select('raid_id, ts, name')
      .gte('ts', since60),
  ]);
  const chars = (charsRaw ?? []) as CharRow[];
  const allRaids = (raidsRaw ?? []) as Raid[];
  const altRaids = allRaids.filter(r => ALT_NIGHT_RX.test(r.name ?? ''));
  const raids = altView ? altRaids : allRaids;

  let ticks: Tick[] = [];
  if (raids.length > 0) {
    const { data } = await admin.from('opendkp_ticks')
      .select('raid_id, attendees')
      .in('raid_id', raids.map(r => r.raid_id))
      .range(0, 99999);
    ticks = ((data ?? []) as Tick[]).filter(t => Array.isArray(t.attendees) && t.attendees.length > 0);
  }
  const totalTicks = ticks.length;

  // Per-character: WHICH ticks they attended (index-keyed) — the family union
  // needs tick identity, not just counts, so a person two-boxing one tick
  // doesn't count it twice.
  const attendedIdx = new Map<string, Set<number>>();
  ticks.forEach((t, i) => {
    for (const a of t.attendees) {
      const k = String(a).toLowerCase();
      let s = attendedIdx.get(k);
      if (!s) { s = new Set(); attendedIdx.set(k, s); }
      s.add(i);
    }
  });

  const charByLower = new Map(chars.map(c => [c.name.toLowerCase(), c]));
  // Family root: follow the main_name link one hop (mains carry no link).
  const rootOf = (c: CharRow): CharRow => {
    if (!c.main_name || c.main_name.toLowerCase() === c.name.toLowerCase()) return c;
    return charByLower.get(c.main_name.toLowerCase()) ?? c;
  };

  // Build families from every character that ticked in the window.
  const famByRoot = new Map<string, { root: CharRow; tickSet: Set<number>; members: Map<string, number> }>();
  for (const [charLower, tickSet] of attendedIdx) {
    const c = charByLower.get(charLower);
    if (!c) continue;   // tick name we don't know (not a guild character row)
    const root = rootOf(c);
    const key = root.name.toLowerCase();
    let fam = famByRoot.get(key);
    if (!fam) { fam = { root, tickSet: new Set(), members: new Map() }; famByRoot.set(key, fam); }
    for (const i of tickSet) fam.tickSet.add(i);
    fam.members.set(c.name, (fam.members.get(c.name) ?? 0) + tickSet.size);
  }

  const families: Family[] = [];
  for (const fam of famByRoot.values()) {
    if (totalTicks === 0 || fam.tickSet.size === 0) continue;
    const usageTotal = [...fam.members.values()].reduce((a, b) => a + b, 0);
    const members: Member[] = [...fam.members.entries()]
      .map(([name, n]) => ({ name, ticks: n, share: usageTotal > 0 ? n / usageTotal : 0 }))
      .sort((a, b) => b.ticks - a.ticks || a.name.localeCompare(b.name));
    const isUnlinkedAlt = (fam.root.rank ?? '').toLowerCase().includes('alt');
    families.push({
      main: fam.root.name,
      className: fam.root.class ?? 'Unknown',
      ra: Math.round((fam.tickSet.size / totalTicks) * 100),
      attendedTicks: fam.tickSet.size,
      members,
      soloMain: members.length === 1 && members[0].name.toLowerCase() === fam.root.name.toLowerCase(),
      isUnlinkedAlt,
    });
  }

  // Roster bar: family attendance ≥ min, root on a rostered rank. Unlinked
  // alt-ranked characters render in italics inside their class (they're a
  // person's alt we just can't fold — link it on /admin/links).
  const rostered = families.filter(f => !f.isUnlinkedAlt
    && ROSTER_RANKS.has(charByLower.get(f.main.toLowerCase())?.rank ?? '')
    && f.ra >= minRa);
  const unlinkedAlts = families.filter(f => f.isUnlinkedAlt && f.attendedTicks >= 3);

  const byClass = (cls: string) => ({
    fams: rostered.filter(f => f.className === cls).sort((a, b) => b.ra - a.ra || a.main.localeCompare(b.main)),
    alts: unlinkedAlts.filter(f => f.className === cls).sort((a, b) => b.ra - a.ra || a.main.localeCompare(b.main)),
  });
  const groupedClasses = new Set(ROLE_GROUPS.flatMap(g => g.classes));
  const otherClasses = [...new Set([...rostered, ...unlinkedAlts].map(f => f.className))]
    .filter(c => !groupedClasses.has(c)).sort();

  const raBar = (ra: number) =>
    ra >= 75 ? 'text-green' : ra >= 50 ? 'text-text' : ra >= 25 ? 'text-orange' : 'text-dim';
  const qs = (over: { min?: number; raids?: string | null }) => {
    const p = new URLSearchParams();
    const m = over.min ?? minRa;
    if (m !== DEFAULT_MIN_RA) p.set('min', String(m));
    const r = over.raids === undefined ? (altView ? 'alt' : null) : over.raids;
    if (r) p.set('raids', r);
    const s = p.toString();
    return s ? `/roster?${s}` : '/roster';
  };

  // One family's rows: main line (attendance % + ticks), any heavy alt
  // (≥50% of the family's usage) visible in italics, the rest folded in a
  // <details> with per-alt ticks + usage share.
  const FamilyRows = ({ f }: { f: Family }) => {
    const mainMember = f.members.find(m => m.name.toLowerCase() === f.main.toLowerCase()) ?? null;
    const altMembers = f.members.filter(m => m.name.toLowerCase() !== f.main.toLowerCase());
    const heavyAlts = altMembers.filter(m => m.share >= ALT_FOLD_SHARE);
    const foldedAlts = altMembers.filter(m => m.share < ALT_FOLD_SHARE);
    return (
      <li>
        <div className="flex items-baseline justify-between gap-2">
          <Link href={`/character/${encodeURIComponent(f.main)}`} className="text-text hover:underline">{f.main}</Link>
          <span
            className={`text-xs tabular-nums ${raBar(f.ra)}`}
            title={`${f.attendedTicks}/${totalTicks} ticks attended on any character${mainMember ? ` · ${mainMember.ticks} on ${f.main}` : ` · 0 on ${f.main}`}`}
          >
            {f.ra}% · {f.attendedTicks}t
          </span>
        </div>
        {heavyAlts.map(m => (
          <div key={m.name} className="flex items-baseline justify-between gap-2 italic text-dim pl-3">
            <Link href={`/character/${encodeURIComponent(m.name)}`} className="hover:underline">{m.name}</Link>
            <span className="text-xs tabular-nums" title={`${Math.round(m.share * 100)}% of ${f.main}'s usage`}>{m.ticks}t</span>
          </div>
        ))}
        {foldedAlts.length > 0 && (
          <details className="pl-3">
            <summary className="text-[11px] text-dim cursor-pointer select-none hover:text-text">
              +{foldedAlts.length} alt{foldedAlts.length === 1 ? '' : 's'} · {foldedAlts.reduce((s, m) => s + m.ticks, 0)}t
            </summary>
            <div className="pl-2 border-l border-border/50 ml-1 mt-0.5 space-y-0.5">
              {foldedAlts.map(m => (
                <div key={m.name} className="flex items-baseline justify-between gap-2 italic text-dim text-xs">
                  <Link href={`/character/${encodeURIComponent(m.name)}`} className="hover:underline">{m.name}</Link>
                  <span className="tabular-nums">{m.ticks}t · {Math.round(m.share * 100)}%</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold mb-1">🐺 Raid Roster{altView && <span className="text-orange text-lg ml-2">— Alt nights</span>}</h2>
        <p className="text-sm text-dim leading-6">
          Typical raiders over the <b className="text-text">last 60 days</b>, straight from DKP attendance ticks.
          Each row is a <b className="text-text">person</b>: the % is raid attendance on <i>any</i> of their characters
          out of {totalTicks} possible ticks, with the tick count beside it. Alts under {Math.round(ALT_FOLD_SHARE * 100)}%
          of that person&apos;s usage fold under the main — expand to see each alt&apos;s ticks. Families at ≥{minRa}% make
          the list (<Link href={qs({ min: 0 })} className="text-blue hover:underline">show everyone</Link>
          {minRa !== DEFAULT_MIN_RA && <> · <Link href={qs({ min: DEFAULT_MIN_RA })} className="text-blue hover:underline">default {DEFAULT_MIN_RA}%</Link></>}).
        </p>
        <div className="flex gap-2 mt-3">
          <Link
            href={qs({ raids: null })}
            className={`px-2.5 py-1 rounded border text-xs transition-colors no-underline ${!altView ? 'bg-accent border-accent text-white' : 'bg-bg border-border text-dim hover:text-text'}`}
          >All raids ({allRaids.length})</Link>
          <Link
            href={qs({ raids: 'alt' })}
            className={`px-2.5 py-1 rounded border text-xs transition-colors no-underline ${altView ? 'bg-accent border-accent text-white' : 'bg-bg border-border text-dim hover:text-text'}`}
            title={`Raids named with "alt": ${altRaids.map(r => r.name).filter(Boolean).slice(0, 6).join(' · ')}${altRaids.length > 6 ? ' · …' : ''}`}
          >Alt nights ({altRaids.length})</Link>
        </div>
        <div className="text-xs text-dim mt-2 flex gap-4 flex-wrap">
          <span>📅 {raids.length} raids · {totalTicks} ticks in window</span>
          <span>👥 {rostered.length} rostered raiders · {unlinkedAlts.length} unlinked alts</span>
          <span>RA color: <span className="text-green">≥75%</span> · <span className="text-text">≥50%</span> · <span className="text-orange">≥25%</span></span>
        </div>
      </section>

      {totalTicks === 0 ? (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          {altView
            ? <>No attendance ticks captured on alt-night raids in the last 60 days. <Link href={qs({ raids: null })} className="text-blue hover:underline">Back to all raids</Link>.</>
            : <>No attendance ticks captured in the last 60 days — check the OpenDKP sync (<code>/syncopendkp</code>).</>}
        </section>
      ) : (
        <>
          {ROLE_GROUPS.map(g => {
            const classBlocks = g.classes
              .map(cls => ({ cls, ...byClass(cls) }))
              .filter(b => b.fams.length > 0 || b.alts.length > 0);
            if (classBlocks.length === 0) return null;
            const roleCount = classBlocks.reduce((n, b) => n + b.fams.length, 0);
            return (
              <section key={g.role} className="bg-panel border border-border rounded-lg p-4">
                <h3 className="text-base text-orange mb-3">{g.icon} {g.role} <span className="text-dim text-xs">· {roleCount}</span></h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {classBlocks.map(b => (
                    <div key={b.cls}>
                      <div className="text-xs text-gold border-b border-border/60 pb-1 mb-1.5">
                        {b.cls} <span className="text-dim">({b.fams.length})</span>
                      </div>
                      <ul className="space-y-0.5 text-sm">
                        {b.fams.map(f => <FamilyRows key={f.main} f={f} />)}
                        {b.alts.map(f => (
                          <li key={f.main} className="flex items-baseline justify-between gap-2 italic text-dim">
                            <Link href={`/character/${encodeURIComponent(f.main)}`} className="hover:underline">{f.main}</Link>
                            <span className="text-xs tabular-nums" title="alt-ranked with no main link — fold it under its main on /admin/links">{f.ra}% · {f.attendedTicks}t</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}

          {otherClasses.length > 0 && (
            <section className="bg-panel border border-border rounded-lg p-4">
              <h3 className="text-base text-orange mb-3">❓ Unclassified</h3>
              <p className="text-xs text-dim mb-2">Attendees whose character rows carry no class — fix on /admin/members.</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {otherClasses.map(cls => {
                  const b = byClass(cls);
                  return (
                    <div key={cls}>
                      <div className="text-xs text-gold border-b border-border/60 pb-1 mb-1.5">{cls}</div>
                      <ul className="space-y-0.5 text-sm">
                        {b.fams.map(f => <FamilyRows key={f.main} f={f} />)}
                        {b.alts.map(f => (
                          <li key={f.main} className="flex items-baseline justify-between gap-2 italic text-dim">
                            <Link href={`/character/${encodeURIComponent(f.main)}`} className="hover:underline">{f.main}</Link>
                            <span className="text-xs tabular-nums">{f.ra}% · {f.attendedTicks}t</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="bg-panel border border-border rounded-lg p-4 text-xs text-dim leading-5">
            <b className="text-text">Math:</b> a person&apos;s RA = distinct ticks attended on ANY of their linked
            characters ÷ {totalTicks} valid ticks{altView ? ' on alt-night raids' : ''} in the last 60 days (ticks
            with no captured attendees are sync gaps and count for nobody — same rule as OpenDKP and /admin/attendance).
            Two-boxing one tick counts once. Alts fold under mains via character links set on /admin/links; an alt
            missing its link shows as its own italic row. Officers: the 30/60/90 recruiting view lives at /admin/attendance.
          </section>
        </>
      )}
    </div>
  );
}
