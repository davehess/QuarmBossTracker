// /roster — the guild's typical raiders, by role and class, from raid ticks.
// (Uilnayar 2026-07-08: "implement our own roster page with our typical
// raiders, broken out by class... off of raid ticks... list their 60 day raid
// attendance, using that as the sorting descending by class. Put the tanks
// together, healers, DPS, etc. Call out notable alts by raid ticks over that
// same timeframe, but put them in italics.")
//
// Attendance math matches /admin/attendance (and OpenDKP): per-TICK rate over
// the window, counting only ticks that actually captured attendees (empty
// ticks are sync gaps and don't penalize anyone). Window is fixed at 60 days
// — that IS the definition of the page, not a view option.
//
// "Typical raider" = main character at ≥25% RA over 60d (tune with ?min=NN).
// Notable alts = alt-linked characters (characters.main_name) or Raid Alt-
// ranked ones with ≥3 ticks in the window — rendered in italics inside their
// class group.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Roster — Wolf Pack' };

type CharRow = { name: string; class: string | null; main_name: string | null; active: boolean; rank: string | null };
type Raid = { raid_id: number; ts: string };
type Tick = { raid_id: number; attendees: string[] };

const ROLE_GROUPS: { role: string; icon: string; classes: string[] }[] = [
  { role: 'Tanks',        icon: '🛡',  classes: ['Warrior', 'Shadow Knight', 'Paladin'] },
  { role: 'Healers',      icon: '⚕',  classes: ['Cleric', 'Druid', 'Shaman'] },
  { role: 'Melee DPS',    icon: '⚔',  classes: ['Monk', 'Rogue', 'Ranger', 'Beastlord'] },
  { role: 'Caster DPS',   icon: '🔥', classes: ['Wizard', 'Magician', 'Necromancer'] },
  { role: 'Support & CC', icon: '🎵', classes: ['Enchanter', 'Bard'] },
];

const ROSTER_RANKS = new Set(['Raid Pack', 'Officer', 'Pack Leader', 'Recruit']);
const DEFAULT_MIN_RA = 25;   // percent
const ALT_MIN_TICKS = 3;

type Entry = {
  name: string;
  className: string;
  ra: number;         // 0..100
  ticks: number;
  isAlt: boolean;
  mainName: string | null;
};

export default async function RosterPage(
  { searchParams }: { searchParams: Promise<{ min?: string }> },
) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/roster');
  const { min } = await searchParams;
  const minRa = Math.max(0, Math.min(100, parseInt(min ?? '', 10) || DEFAULT_MIN_RA));

  const admin = supabaseAdmin();
  const since60 = new Date(Date.now() - 60 * 86400_000).toISOString();
  const [{ data: charsRaw }, { data: raidsRaw }] = await Promise.all([
    admin.from('characters')
      .select('name, class, main_name, active, rank')
      .eq('guild_id', 'wolfpack'),
    admin.from('opendkp_raids')
      .select('raid_id, ts')
      .gte('ts', since60),
  ]);
  const chars = (charsRaw ?? []) as CharRow[];
  const raids = (raidsRaw ?? []) as Raid[];

  let ticks: Tick[] = [];
  if (raids.length > 0) {
    const { data } = await admin.from('opendkp_ticks')
      .select('raid_id, attendees')
      .in('raid_id', raids.map(r => r.raid_id))
      .range(0, 99999);
    ticks = ((data ?? []) as Tick[]).filter(t => Array.isArray(t.attendees) && t.attendees.length > 0);
  }
  const totalTicks = ticks.length;

  // Attendance per character name (ticks store DKP character names).
  const attended = new Map<string, number>();
  for (const t of ticks) {
    for (const a of t.attendees) {
      const k = String(a).toLowerCase();
      attended.set(k, (attended.get(k) ?? 0) + 1);
    }
  }

  const charByLower = new Map(chars.map(c => [c.name.toLowerCase(), c]));
  const entries: Entry[] = [];
  for (const c of chars) {
    const n = attended.get(c.name.toLowerCase()) ?? 0;
    if (n === 0 || totalTicks === 0) continue;
    const isAltLinked = !!c.main_name && c.main_name.toLowerCase() !== c.name.toLowerCase();
    const isAltRank = (c.rank ?? '').toLowerCase().includes('alt');
    entries.push({
      name: c.name,
      className: c.class ?? 'Unknown',
      ra: Math.round((n / totalTicks) * 100),
      ticks: n,
      isAlt: isAltLinked || isAltRank,
      mainName: isAltLinked ? (charByLower.get(c.main_name!.toLowerCase())?.name ?? c.main_name) : null,
    });
  }

  // Mains on the roster at/above the RA bar; alts with enough ticks to note.
  const mains = entries.filter(e => !e.isAlt
    && ROSTER_RANKS.has(charByLower.get(e.name.toLowerCase())?.rank ?? '')
    && e.ra >= minRa);
  const alts = entries.filter(e => e.isAlt && e.ticks >= ALT_MIN_TICKS);

  const byClass = (cls: string) => ({
    mains: mains.filter(e => e.className === cls).sort((a, b) => b.ra - a.ra || a.name.localeCompare(b.name)),
    alts:  alts.filter(e => e.className === cls).sort((a, b) => b.ra - a.ra || a.name.localeCompare(b.name)),
  });
  const groupedClasses = new Set(ROLE_GROUPS.flatMap(g => g.classes));
  const otherClasses = [...new Set([...mains, ...alts].map(e => e.className))]
    .filter(c => !groupedClasses.has(c)).sort();

  const raBar = (ra: number) =>
    ra >= 75 ? 'text-green' : ra >= 50 ? 'text-text' : ra >= 25 ? 'text-orange' : 'text-dim';

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold mb-1">🐺 Raid Roster</h2>
        <p className="text-sm text-dim leading-6">
          Typical raiders over the <b className="text-text">last 60 days</b>, straight from DKP attendance ticks —
          sorted by raid attendance within each class. Mains at ≥{minRa}% RA make the list
          (<Link href="/roster?min=0" className="text-blue hover:underline">show everyone</Link>
          {minRa !== DEFAULT_MIN_RA && <> · <Link href="/roster" className="text-blue hover:underline">default {DEFAULT_MIN_RA}%</Link></>});
          <i> notable alts</i> ({ALT_MIN_TICKS}+ ticks) appear in italics under their class.
        </p>
        <div className="text-xs text-dim mt-2 flex gap-4 flex-wrap">
          <span>📅 {raids.length} raids · {totalTicks} ticks in window</span>
          <span>👥 {mains.length} rostered raiders · {alts.length} notable alts</span>
          <span>RA color: <span className="text-green">≥75%</span> · <span className="text-text">≥50%</span> · <span className="text-orange">≥25%</span></span>
        </div>
      </section>

      {totalTicks === 0 ? (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          No attendance ticks captured in the last 60 days — check the OpenDKP sync (<code>/syncopendkp</code>).
        </section>
      ) : (
        <>
          {ROLE_GROUPS.map(g => {
            const classBlocks = g.classes
              .map(cls => ({ cls, ...byClass(cls) }))
              .filter(b => b.mains.length > 0 || b.alts.length > 0);
            if (classBlocks.length === 0) return null;
            const roleCount = classBlocks.reduce((n, b) => n + b.mains.length, 0);
            return (
              <section key={g.role} className="bg-panel border border-border rounded-lg p-4">
                <h3 className="text-base text-orange mb-3">{g.icon} {g.role} <span className="text-dim text-xs">· {roleCount}</span></h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {classBlocks.map(b => (
                    <div key={b.cls}>
                      <div className="text-xs text-gold border-b border-border/60 pb-1 mb-1.5">
                        {b.cls} <span className="text-dim">({b.mains.length})</span>
                      </div>
                      <ul className="space-y-0.5 text-sm">
                        {b.mains.map(e => (
                          <li key={e.name} className="flex items-baseline justify-between gap-2">
                            <Link href={`/character/${encodeURIComponent(e.name)}`} className="text-text hover:underline">{e.name}</Link>
                            <span className={`text-xs tabular-nums ${raBar(e.ra)}`} title={`${e.ticks}/${totalTicks} ticks`}>{e.ra}%</span>
                          </li>
                        ))}
                        {b.alts.map(e => (
                          <li key={e.name} className="flex items-baseline justify-between gap-2 italic text-dim">
                            <span>
                              <Link href={`/character/${encodeURIComponent(e.name)}`} className="hover:underline">{e.name}</Link>
                              {e.mainName && <span className="text-[10px] not-italic"> ({e.mainName})</span>}
                            </span>
                            <span className="text-xs tabular-nums" title={`${e.ticks}/${totalTicks} ticks`}>{e.ra}%</span>
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
                        {[...b.mains, ...b.alts].map(e => (
                          <li key={e.name} className={`flex items-baseline justify-between gap-2 ${e.isAlt ? 'italic text-dim' : ''}`}>
                            <Link href={`/character/${encodeURIComponent(e.name)}`} className="hover:underline">{e.name}</Link>
                            <span className="text-xs tabular-nums">{e.ra}%</span>
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
            <b className="text-text">Math:</b> RA = attended ticks ÷ {totalTicks} valid ticks in the last 60 days
            (ticks with no captured attendees are sync gaps and count for nobody — same rule as OpenDKP and
            /admin/attendance). Alts fold under mains via character links set on /admin/links; an alt missing its
            link shows as its own row. Officers: the 30/60/90 recruiting view lives at /admin/attendance.
          </section>
        </>
      )}
    </div>
  );
}
