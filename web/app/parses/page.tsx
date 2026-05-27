// Server-rendered parse history. Reads the existing `bosses_local` and
// future `parses` (or whatever the bot's persistence layer is called) tables.
//
// The bot's existing utils/supabase.recordParse() writes per-encounter rows;
// this page is the read-only browser for them. Filters come later — start
// with a "last 20 parses" board to validate the column shapes.
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';

async function loadRecentParses() {
  // Probe a couple of candidate table names — the bot has migrated through
  // a few schemas. Whichever returns rows wins.
  const tables = ['encounters', 'parses'];
  for (const t of tables) {
    const { data, error } = await supabase
      .from(t)
      .select('*')
      .order('started_at', { ascending: false })
      .limit(20);
    if (!error && data) return { table: t, rows: data, error: null };
  }
  return { table: null, rows: [], error: 'No parse table found (tried: encounters, parses)' };
}

export const dynamic = 'force-dynamic';

export default async function ParsesPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/parses');

  const { table, rows, error } = await loadRecentParses();
  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-3">📊 Recent Parses</h2>
        <p className="text-sm text-dim">
          Last 20 uploads from the parse pipeline. Filters by boss / raider / night
          coming in the next iteration.
        </p>
      </section>

      <section className="bg-panel border border-border rounded-lg p-6">
        {error && <div className="text-red text-sm">{error}</div>}
        {!error && rows.length === 0 && (
          <div className="text-dim text-sm">
            No parses found in <code>{table}</code> yet.
          </div>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-dim uppercase">
                <tr>
                  {Object.keys(rows[0]).slice(0, 8).map((k) => (
                    <th key={k} className="text-left py-1 pr-3">{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => (
                  <tr key={i} className="border-t border-border hover:bg-[#1f242c]">
                    {Object.keys(r).slice(0, 8).map((k) => (
                      <td key={k} className="py-1 pr-3 align-top">
                        {String(r[k]).slice(0, 80)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
