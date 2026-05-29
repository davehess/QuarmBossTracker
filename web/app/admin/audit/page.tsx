// Officer tool: audit log search.
//
// Reads audit_log table (bot v2.5.35+ mirrors every postAuditEntry to it,
// in addition to the Discord thread). Faster than scrubbing the thread.
//
// Filters: actor name, action prefix (kill/unkill/updatetimer/...), boss
// name (in payload JSONB), date range. URL params drive everything so
// links are shareable.

import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type AuditRow = {
  id: string;
  ts: string;
  action: string;
  actor_discord_id: string | null;
  actor_name: string | null;
  payload: { bossId?: string; bossName?: string; source?: string; prevState?: any; newNextSpawn?: any } | null;
  msg_link: string | null;
};

type Params = {
  actor?: string;
  action?: string;
  boss?: string;
  days?: string;
};

function actionChip(a: string): { label: string; cls: string } {
  if (a.startsWith('kill'))         return { label: '☠️ kill',   cls: 'text-red-400' };
  if (a.startsWith('unkill'))       return { label: '↩️ unkill', cls: 'text-orange' };
  if (a.startsWith('updatetimer'))  return { label: '⏱️ timer',  cls: 'text-blue' };
  return { label: a, cls: 'text-dim' };
}

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

async function loadAudit(p: Params): Promise<AuditRow[]> {
  const admin = supabaseAdmin();
  const days = Math.max(1, Math.min(365, parseInt(p.days || '30', 10) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let q: any = admin
    .from('audit_log')
    .select('id, ts, action, actor_discord_id, actor_name, payload, msg_link')
    .gte('ts', since)
    .order('ts', { ascending: false })
    .limit(500);

  if (p.actor)  q = q.ilike('actor_name', `%${p.actor.replace(/[%_]/g, '\\$&')}%`);
  if (p.action) q = q.ilike('action',     `${p.action.replace(/[%_]/g, '\\$&')}%`);
  // boss filter is on payload JSONB — PostgREST's ?payload->>bossName=ilike.* works
  if (p.boss) {
    q = q.ilike('payload->>bossName', `%${p.boss.replace(/[%_]/g, '\\$&')}%`);
  }

  const { data } = await q;
  return (data ?? []) as AuditRow[];
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const p = await searchParams;
  const days = Math.max(1, Math.min(365, parseInt(p.days || '30', 10) || 30));
  const rows = await loadAudit(p);

  // Stats over the filtered set
  const counts = {
    total:   rows.length,
    kills:   rows.filter(r => r.action.startsWith('kill')).length,
    unkills: rows.filter(r => r.action.startsWith('unkill')).length,
    timers:  rows.filter(r => r.action.startsWith('updatetimer')).length,
  };

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/admin" className="text-blue hover:underline">← back to admin</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">📜 Audit log</h2>
        <p className="text-sm text-dim leading-6">
          Searchable mirror of the audit trail Discord thread. Bot v2.5.35
          starts writing on every kill / unkill / updatetimer action; older
          actions only live in the thread.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
          <Stat label="Total"   value={counts.total} />
          <Stat label="Kills"   value={counts.kills}   color="text-red-400" />
          <Stat label="Unkills" value={counts.unkills} color="text-orange" />
          <Stat label="Timers"  value={counts.timers}  color="text-blue" />
        </div>

        <form method="GET" className="grid grid-cols-1 sm:grid-cols-4 gap-2 mt-4 text-xs">
          <label>
            <span className="text-dim block mb-1">Actor</span>
            <input name="actor" defaultValue={p.actor ?? ''} placeholder="(any)"
              className="w-full bg-bg border border-border rounded px-2 py-1 text-sm" />
          </label>
          <label>
            <span className="text-dim block mb-1">Action (prefix)</span>
            <select name="action" defaultValue={p.action ?? ''}
              className="w-full bg-bg border border-border rounded px-2 py-1 text-sm">
              <option value="">(any)</option>
              <option value="kill">kill*</option>
              <option value="unkill">unkill*</option>
              <option value="updatetimer">updatetimer</option>
            </select>
          </label>
          <label>
            <span className="text-dim block mb-1">Boss name</span>
            <input name="boss" defaultValue={p.boss ?? ''} placeholder="(any)"
              className="w-full bg-bg border border-border rounded px-2 py-1 text-sm" />
          </label>
          <label>
            <span className="text-dim block mb-1">Window</span>
            <select name="days" defaultValue={String(days)}
              className="w-full bg-bg border border-border rounded px-2 py-1 text-sm">
              <option value="1">1 day</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
            </select>
          </label>
          <div className="col-span-full flex gap-2">
            <button type="submit" className="px-4 py-1.5 rounded border border-blue bg-[#1f6feb] text-white text-sm">Apply</button>
            <Link href="/admin/audit" className="px-4 py-1.5 rounded border border-border bg-panel text-text text-sm">Reset</Link>
          </div>
        </form>
      </section>

      <section className="bg-panel border border-border rounded-lg">
        {rows.length === 0 ? (
          <div className="p-6 text-sm text-dim leading-6">
            No audit entries match these filters. If you expect data here and
            see none, the bot may not have been updated to write rows yet
            (look for bot v2.5.35+ in the version banner). The Discord audit
            thread is still the authoritative source.
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[680px]">
            <thead className="text-dim">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 font-normal">When</th>
                <th className="text-left px-3 py-2 font-normal">Action</th>
                <th className="text-left px-3 py-2 font-normal">Boss</th>
                <th className="text-left px-3 py-2 font-normal">Actor</th>
                <th className="text-left px-3 py-2 font-normal">Source</th>
                <th className="text-left px-3 py-2 font-normal">Link</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const chip = actionChip(r.action);
                return (
                  <tr key={r.id} className="border-b border-border/40 hover:bg-[#1a212c]">
                    <td className="px-3 py-2 text-dim whitespace-nowrap">{fmtTs(r.ts)}</td>
                    <td className={`px-3 py-2 ${chip.cls}`}>{chip.label}<span className="text-dim text-[10px] ml-1">{r.action}</span></td>
                    <td className="px-3 py-2 text-text">{r.payload?.bossName || '—'}</td>
                    <td className="px-3 py-2 text-text">
                      {r.actor_name || (r.actor_discord_id ? `<@${r.actor_discord_id}>` : '—')}
                    </td>
                    <td className="px-3 py-2 text-dim text-[10px]">{r.payload?.source || '—'}</td>
                    <td className="px-3 py-2">
                      {r.msg_link ? (
                        <a href={r.msg_link} target="_blank" rel="noreferrer" className="text-blue hover:underline text-[10px]">↗ jump</a>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, color = 'text-text' }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-bg border border-border rounded p-3">
      <div className={`text-2xl ${color}`}>{value.toLocaleString()}</div>
      <div className="text-dim text-xs">{label}</div>
    </div>
  );
}
