// Officer tool: agent uploader status board.
//
// Reads agent_uploads (one row per /api/agent/* happy-path) and
// agent_backfill_requests. Surfaces:
//
//   - Who's actively uploading right now (last 1h)
//   - Who's gone stale (was active in last 30d, nothing in last 24h)
//   - Per-character: agent version, last upload, endpoint mix, queue depth
//   - Recent errors (ok=false rows)
//   - Backfill request board (pending / acked / completed / dismissed)
//
// Empty until the bot writes rows. The bot was updated in v2.5.35 to track
// every successful upload — first agent ping after deploy populates this.

import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type UploadRow = {
  id: string;
  character: string | null;
  agent_version: string | null;
  endpoint: string;
  uploaded_at: string;
  payload_bytes: number | null;
  ok: boolean;
  status_code: number | null;
  error_message: string | null;
  agent_state: any;
};

type BackfillRow = {
  id: string;
  character: string;
  requested_at: string;
  requested_by_name: string | null;
  reason: string | null;
  scope: any;
  status: string;
  acked_at: string | null;
  dismissed_at: string | null;
  dismissed_reason: string | null;
  completed_at: string | null;
  error_message: string | null;
};

async function loadData() {
  const admin = supabaseAdmin();
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: uploads }, { data: backfills }] = await Promise.all([
    admin
      .from('agent_uploads')
      .select('id, character, agent_version, endpoint, uploaded_at, payload_bytes, ok, status_code, error_message, agent_state')
      .gte('uploaded_at', since30d)
      .order('uploaded_at', { ascending: false })
      .limit(5000),
    admin
      .from('agent_backfill_requests')
      .select('id, character, requested_at, requested_by_name, reason, scope, status, acked_at, dismissed_at, dismissed_reason, completed_at, error_message')
      .order('requested_at', { ascending: false })
      .limit(200),
  ]);
  return {
    uploads:   (uploads ?? []) as UploadRow[],
    backfills: (backfills ?? []) as BackfillRow[],
  };
}

type CharSummary = {
  character: string;
  lastUpload: string;
  lastUploadMs: number;
  agentVersion: string | null;
  uploads24h: number;
  uploads7d: number;
  uploads30d: number;
  byEndpoint: Map<string, number>;
  errors30d: number;
  lastError: { ts: string; endpoint: string; message: string | null } | null;
  queuePending: number | null;
  fightActive: boolean | null;
};

function summarize(uploads: UploadRow[]): CharSummary[] {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const byChar = new Map<string, CharSummary>();
  for (const u of uploads) {
    const name = u.character || '(unknown)';
    let s = byChar.get(name);
    if (!s) {
      s = {
        character: name,
        lastUpload: u.uploaded_at,
        lastUploadMs: new Date(u.uploaded_at).getTime(),
        agentVersion: u.agent_version,
        uploads24h: 0, uploads7d: 0, uploads30d: 0,
        byEndpoint: new Map(),
        errors30d: 0,
        lastError: null,
        queuePending: null,
        fightActive: null,
      };
      byChar.set(name, s);
    }
    const ts = new Date(u.uploaded_at).getTime();
    if (ts > s.lastUploadMs) {
      s.lastUploadMs = ts; s.lastUpload = u.uploaded_at; s.agentVersion = u.agent_version;
      // Latest agent_state for live "queue depth" view
      if (u.agent_state && typeof u.agent_state === 'object') {
        s.queuePending = (u.agent_state.queue_pending ?? null) as number | null;
        s.fightActive  = (u.agent_state.fight_active ?? null) as boolean | null;
      }
    }
    s.uploads30d++;
    if (now - ts <= 7 * day) s.uploads7d++;
    if (now - ts <= day)     s.uploads24h++;
    s.byEndpoint.set(u.endpoint, (s.byEndpoint.get(u.endpoint) ?? 0) + 1);
    if (!u.ok) {
      s.errors30d++;
      if (!s.lastError || ts > new Date(s.lastError.ts).getTime()) {
        s.lastError = { ts: u.uploaded_at, endpoint: u.endpoint, message: u.error_message };
      }
    }
  }
  return [...byChar.values()].sort((a, b) => b.lastUploadMs - a.lastUploadMs);
}

function rel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000)    return 'just now';
  if (ms < 3600_000)  return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`;
  return `${Math.floor(ms / 86400_000)}d ago`;
}

function fmtTs(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export default async function AdminAgentsPage() {
  const { uploads, backfills } = await loadData();
  const summaries = summarize(uploads);
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const active = summaries.filter(s => now - s.lastUploadMs <= day);
  const stale  = summaries.filter(s => now - s.lastUploadMs > day);
  const recentErrors = uploads.filter(u => !u.ok).slice(0, 40);

  // Version histogram
  const byVersion = new Map<string, number>();
  for (const s of active) {
    const v = s.agentVersion || '(unknown)';
    byVersion.set(v, (byVersion.get(v) ?? 0) + 1);
  }
  const versions = [...byVersion.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));

  // Backfill request status breakdown
  const bfByStatus = new Map<string, BackfillRow[]>();
  for (const b of backfills) {
    const list = bfByStatus.get(b.status) ?? [];
    list.push(b);
    bfByStatus.set(b.status, list);
  }
  const bfCounts = {
    pending:   (bfByStatus.get('pending')   ?? []).length,
    acked:     (bfByStatus.get('acked')     ?? []).length,
    running:   (bfByStatus.get('running')   ?? []).length,
    completed: (bfByStatus.get('completed') ?? []).length,
    dismissed: (bfByStatus.get('dismissed') ?? []).length,
    errored:   (bfByStatus.get('errored')   ?? []).length,
  };

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/admin" className="text-blue hover:underline">← back to admin</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">🛰️ Agent fleet</h2>
        <p className="text-sm text-dim leading-6">
          Every successful upload to <code>/api/agent/*</code> writes one row
          to <code>agent_uploads</code> with character + agent version. This
          page summarizes the last 30 days. The table is empty for runs
          uploaded before bot v2.5.35 went out.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 text-xs">
          <Stat label="Active 24h"    value={active.length} color="text-green" />
          <Stat label="Stale (24h+)"  value={stale.length}  color="text-orange" />
          <Stat label="Uploads 30d"   value={uploads.length} />
          <Stat label="Errors 30d"    value={uploads.filter(u => !u.ok).length} color="text-red-400" />
          <Stat label="Backfill open" value={bfCounts.pending + bfCounts.acked + bfCounts.running} color="text-blue" />
        </div>
        {versions.length > 0 && (
          <div className="text-xs text-dim mt-4">
            <span className="text-dim">Active fleet versions:</span>
            {' '}
            {versions.map(([v, n], i) => (
              <span key={v}>
                {i > 0 && ' · '}
                <span className="text-text">{v}</span>
                <span className="text-dim"> ×{n}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Active uploaders */}
      <section className="bg-panel border border-border rounded-lg">
        <h3 className="text-sm text-orange px-4 py-3 border-b border-border">
          Active (uploaded in last 24h) — {active.length}
        </h3>
        {active.length === 0 ? (
          <EmptyHint>
            No agent uploads in the last 24 hours. Either the bot hasn't
            picked up v2.5.35 yet (Railway redeploy in progress), or no
            agents are currently running. Once an upload lands, it shows here
            with the uploader's character, version, and endpoint mix.
          </EmptyHint>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-dim hidden sm:table-header-group">
              <tr className="border-b border-border">
                <th className="text-left px-2 sm:px-3 py-2 font-normal">Character</th>
                <th className="text-left px-2 sm:px-3 py-2 font-normal">Last upload</th>
                <th className="text-left px-2 sm:px-3 py-2 font-normal hidden md:table-cell">Agent</th>
                <th className="text-right px-2 sm:px-3 py-2 font-normal hidden md:table-cell">24h</th>
                <th className="text-right px-2 sm:px-3 py-2 font-normal hidden lg:table-cell">7d</th>
                <th className="text-left px-2 sm:px-3 py-2 font-normal hidden lg:table-cell">Endpoint mix</th>
                <th className="text-left px-2 sm:px-3 py-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {active.map(s => (
                <tr key={s.character} className="border-b border-border/40 hover:bg-[#1a212c]">
                  <td className="px-2 sm:px-3 py-2 text-text">
                    <Link href={`/character/${encodeURIComponent(s.character)}`} className="text-blue hover:underline">{s.character}</Link>
                    <div className="text-dim text-[10px] md:hidden">{s.agentVersion || '—'} · {s.uploads24h}/24h</div>
                  </td>
                  <td className="px-2 sm:px-3 py-2 text-dim whitespace-nowrap">{rel(s.lastUpload)}</td>
                  <td className="px-2 sm:px-3 py-2 text-text hidden md:table-cell">{s.agentVersion || '—'}</td>
                  <td className="px-2 sm:px-3 py-2 text-right text-text hidden md:table-cell">{s.uploads24h}</td>
                  <td className="px-2 sm:px-3 py-2 text-right text-dim hidden lg:table-cell">{s.uploads7d}</td>
                  <td className="px-2 sm:px-3 py-2 text-dim text-[10px] hidden lg:table-cell">
                    {[...s.byEndpoint.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(' · ')}
                  </td>
                  <td className="px-2 sm:px-3 py-2 text-[10px]">
                    {s.errors30d > 0 && <span className="text-red-400">{s.errors30d} err</span>}
                    {s.queuePending != null && s.queuePending > 0 && <span className="text-orange ml-1">Q={s.queuePending}</span>}
                    {s.fightActive && <span className="text-blue ml-1">in-fight</span>}
                    {s.errors30d === 0 && (s.queuePending ?? 0) === 0 && !s.fightActive && <span className="text-green">healthy</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Stale uploaders */}
      {stale.length > 0 && (
        <section className="bg-panel border border-border rounded-lg">
          <h3 className="text-sm text-orange px-4 py-3 border-b border-border">
            Stale (active in last 30d, nothing in last 24h) — {stale.length}
          </h3>
          <table className="w-full text-xs">
            <thead className="text-dim">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 font-normal">Character</th>
                <th className="text-left px-3 py-2 font-normal">Last upload</th>
                <th className="text-left px-3 py-2 font-normal">Agent</th>
                <th className="text-right px-3 py-2 font-normal">30d total</th>
              </tr>
            </thead>
            <tbody>
              {stale.map(s => (
                <tr key={s.character} className="border-b border-border/40 hover:bg-[#1a212c]">
                  <td className="px-3 py-2 text-text">{s.character}</td>
                  <td className="px-3 py-2 text-dim">{rel(s.lastUpload)} <span className="text-[10px]">· {fmtTs(s.lastUpload)}</span></td>
                  <td className="px-3 py-2 text-dim">{s.agentVersion || '—'}</td>
                  <td className="px-3 py-2 text-right text-dim">{s.uploads30d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Recent errors */}
      {recentErrors.length > 0 && (
        <section className="bg-panel border border-border rounded-lg">
          <h3 className="text-sm text-orange px-4 py-3 border-b border-border">
            Recent errors — {uploads.filter(u => !u.ok).length} total in last 30d
          </h3>
          <table className="w-full text-xs">
            <thead className="text-dim">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 font-normal">When</th>
                <th className="text-left px-3 py-2 font-normal">Character</th>
                <th className="text-left px-3 py-2 font-normal">Endpoint</th>
                <th className="text-right px-3 py-2 font-normal">Status</th>
                <th className="text-left px-3 py-2 font-normal">Error</th>
              </tr>
            </thead>
            <tbody>
              {recentErrors.map(u => (
                <tr key={u.id} className="border-b border-border/40 hover:bg-[#1a212c]">
                  <td className="px-3 py-2 text-dim">{fmtTs(u.uploaded_at)}</td>
                  <td className="px-3 py-2 text-text">{u.character || '—'}</td>
                  <td className="px-3 py-2 text-text">{u.endpoint}</td>
                  <td className="px-3 py-2 text-right text-red-400">{u.status_code ?? '—'}</td>
                  <td className="px-3 py-2 text-dim text-[11px]">{u.error_message || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Backfill request board */}
      <section className="bg-panel border border-border rounded-lg">
        <h3 className="text-sm text-orange px-4 py-3 border-b border-border">
          Backfill requests
        </h3>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 p-4 text-xs">
          <Stat label="Pending"   value={bfCounts.pending}   color="text-orange" />
          <Stat label="Acked"     value={bfCounts.acked}     color="text-blue" />
          <Stat label="Running"   value={bfCounts.running}   color="text-blue" />
          <Stat label="Completed" value={bfCounts.completed} color="text-green" />
          <Stat label="Dismissed" value={bfCounts.dismissed} color="text-dim" />
          <Stat label="Errored"   value={bfCounts.errored}   color="text-red-400" />
        </div>
        {backfills.length === 0 ? (
          <EmptyHint>
            No backfill requests filed yet. Officers can file them from
            <Link href="/admin/encounters" className="text-blue hover:underline mx-1">/admin/encounters</Link>
            via the "Request backfill" form on any encounter row. Agents will
            poll <code>/api/agent/backfill-requests</code> for their character
            and report back as they process each one.
          </EmptyHint>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-dim">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 font-normal">Filed</th>
                <th className="text-left px-3 py-2 font-normal">Character</th>
                <th className="text-left px-3 py-2 font-normal">Scope</th>
                <th className="text-left px-3 py-2 font-normal">Status</th>
                <th className="text-left px-3 py-2 font-normal">Reason / outcome</th>
              </tr>
            </thead>
            <tbody>
              {backfills.slice(0, 50).map(b => {
                const start = b.scope?.start_iso ? fmtTs(b.scope.start_iso) : '—';
                const end   = b.scope?.end_iso   ? fmtTs(b.scope.end_iso)   : '—';
                const statusCls =
                  b.status === 'completed' ? 'text-green' :
                  b.status === 'errored'   ? 'text-red-400' :
                  b.status === 'dismissed' ? 'text-dim' :
                  b.status === 'running'   ? 'text-blue' :
                  b.status === 'acked'     ? 'text-blue' :
                  'text-orange';
                const outcome =
                  b.status === 'errored'   ? `error: ${b.error_message || '—'}` :
                  b.status === 'dismissed' ? `dismissed: ${b.dismissed_reason || '—'}` :
                  b.status === 'completed' ? 'completed' :
                  (b.reason || '—');
                return (
                  <tr key={b.id} className="border-b border-border/40 hover:bg-[#1a212c]">
                    <td className="px-3 py-2 text-dim whitespace-nowrap">{fmtTs(b.requested_at)}</td>
                    <td className="px-3 py-2 text-text">{b.character}</td>
                    <td className="px-3 py-2 text-dim text-[10px]">{start} → {end}</td>
                    <td className={`px-3 py-2 text-[11px] ${statusCls}`}>{b.status}</td>
                    <td className="px-3 py-2 text-dim text-[11px]">{outcome}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="p-6 text-sm text-dim leading-6">{children}</div>;
}
