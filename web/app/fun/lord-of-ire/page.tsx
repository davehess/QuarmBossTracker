// /fun/lord-of-ire — full breakdown behind the "Lord of Ire vanquished" counter
// on /fun. Counts every lord_of_ire_killed fun_event, rolled up per MAIN (alts
// fold into their main via characters.main_name — e.g. Hopeya + Melting → Hitya,
// Adiwen → Wabumkin), with the per-alt split shown under each main.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

type MainGroup = {
  main: string;
  total: number;
  alts: { name: string; n: number }[];   // sorted desc; includes the main itself
};

async function load() {
  const sb = supabaseAdmin();

  const { data: rows } = await sb
    .from('fun_events')
    .select('caster')
    .eq('event_type', 'lord_of_ire_killed');
  const kills = (rows ?? []) as { caster: string | null }[];

  // caster (lowercased) → canonical main name. Unknown casters main to themselves.
  const { data: chars } = await sb.from('characters').select('name, main_name');
  const mainByLower = new Map<string, string>();
  for (const c of (chars ?? []) as { name: string; main_name: string | null }[]) {
    if (c.name) mainByLower.set(c.name.toLowerCase(), c.main_name || c.name);
  }

  const groups = new Map<string, MainGroup>();
  let total = 0;
  for (const k of kills) {
    const caster = k.caster || 'unknown';
    total++;
    const main = mainByLower.get(caster.toLowerCase()) || caster;
    let g = groups.get(main);
    if (!g) { g = { main, total: 0, alts: [] }; groups.set(main, g); }
    g.total++;
    const alt = g.alts.find(a => a.name === caster);
    if (alt) alt.n++; else g.alts.push({ name: caster, n: 1 });
  }
  for (const g of groups.values()) g.alts.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const ranked = [...groups.values()].sort((a, b) => b.total - a.total || a.main.localeCompare(b.main));
  return { total, ranked };
}

export default async function LordOfIrePage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/fun/lord-of-ire');

  const { total, ranked } = await load();

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/fun" className="text-blue hover:underline">← back to fun</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold flex items-center gap-3">
          <span aria-hidden>😈</span>
          <span>Lord of Ire vanquished</span>
        </h2>
        <div className="text-4xl text-gold font-bold mt-3">{total.toLocaleString()}</div>
        <p className="text-sm text-dim mt-2">
          Every Plane of Hate (Instanced) clear, credited per main — alts fold into
          their main (a charm-pet killing blow counts for the charmer).
        </p>
      </section>

      <section className="bg-panel border border-border rounded-lg">
        <h3 className="text-sm text-blue px-4 py-3 border-b border-border">By main</h3>
        {ranked.length === 0 ? (
          <div className="p-4 text-sm text-dim italic">no kills tracked yet</div>
        ) : (
          <ol className="divide-y divide-border">
            {ranked.map((g, i) => (
              <li key={g.main} className="px-4 py-3 flex items-baseline gap-3">
                <span className="text-dim text-sm w-6 shrink-0">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link href={`/character/${encodeURIComponent(g.main)}`} className="text-gold hover:underline truncate">
                      {g.main}
                    </Link>
                    <span className="text-gold font-bold whitespace-nowrap">{g.total.toLocaleString()}</span>
                  </div>
                  {/* Per-alt split — only show when the credit is spread across more
                      than just the main (otherwise it's redundant with the total). */}
                  {(g.alts.length > 1 || g.alts[0]?.name !== g.main) && (
                    <div className="text-xs text-dim mt-1">
                      {g.alts.map(a => `${a.name} ×${a.n}`).join(' · ')}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
