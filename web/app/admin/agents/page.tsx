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

type MimicRelease = {
  tag_name:     string;
  name:         string;
  html_url:     string;
  published_at: string | null;
  prerelease:   boolean;
  assets:       { name: string; browser_download_url: string; size: number; download_count: number }[];
};

// Fetch Mimic releases from GitHub. Cached for 5 min — at 60 anonymous
// req/h this is well under the limit even with many officers looking.
async function loadMimicReleases(): Promise<MimicRelease[]> {
  try {
    const res = await fetch(
      'https://api.github.com/repos/davehess/QuarmBossTracker/releases?per_page=20',
      { headers: { Accept: 'application/vnd.github+json' }, next: { revalidate: 300 } },
    );
    if (!res.ok) return [];
    const all = (await res.json()) as MimicRelease[];
    // Detect Mimic releases channel-agnostically by their installer asset
    // name (Wolf-Pack-Mimic-Setup-*.exe). The pre-1.0.0 betas used a custom
    // mimic-beta.yml channel manifest, but 1.0.0 graduated to the stable
    // latest.yml channel. The Setup .exe asset is the stable signal across
    // both eras — every Mimic release ever cut has one, no other release
    // type in this repo does.
    return all
      .filter(r => r.assets.some(a => /^wolf-pack-mimic-setup-.*\.exe$/i.test(a.name)))
      .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
  } catch {
    return [];
  }
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
  // Most-recent client identification from agent_state.client. 'mimic' when
  // the uploader is the Electron desktop client; 'parser' for Parser.bat
  // installs running agent v2.5.2+; null/'?' for older agents that didn't
  // stamp the field. appVersion is Mimic's own semver (only set when
  // client='mimic').
  client: string | null;
  appVersion: string | null;
};

// Real EQ player names are letters only. The "(unknown)" sentinel (and the
// agent's "unknown" fallback) aren't characters, so they shouldn't link to a
// /character page.
function isRealCharacter(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.trim();
  return /^[A-Za-z]{2,}$/.test(n) && !['unknown', 'unattributed'].includes(n.toLowerCase());
}

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
        client: null,
        appVersion: null,
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
        s.client       = (u.agent_state.client ?? null) as string | null;
        s.appVersion   = (u.agent_state.app_version ?? null) as string | null;
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
  const [{ uploads, backfills }, mimicReleases] = await Promise.all([
    loadData(),
    loadMimicReleases(),
  ]);
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

      {/* Mimic — Electron desktop client. Mostly informational until the
          agent identifies itself as Mimic in agent_state; for now we pull
          beta-channel state from GitHub releases. */}
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">🐺 Mimic</h2>
        <p className="text-sm text-dim leading-6">
          The Electron desktop client. Wraps the same <code>wolfpack-logsync</code> agent in a
          native shell with a DPS overlay + trigger TTS, bundles its own Node runtime, and
          auto-updates via the standard <code className="text-blue">latest</code> channel. Downloads at{' '}
          <a href="/mimic" target="_blank" rel="noreferrer" className="text-blue hover:underline">wolfpack.quest/mimic</a>{' '}
          (stable redirect to the latest release).
        </p>

        {mimicReleases.length === 0 ? (
          <EmptyHint>
            Couldn&apos;t reach the GitHub API to list Mimic releases (rate limit or transient).
            The download link still works.
          </EmptyHint>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
              <Stat label="Latest beta" value={1} color="text-blue" />
              <Stat label="Total betas cut" value={mimicReleases.length} />
              <Stat
                label="Installer size (MB)"
                value={Math.round((mimicReleases[0]?.assets?.find(a => /\.exe$/i.test(a.name))?.size ?? 0) / (1024 * 1024))}
              />
              <Stat
                label="Downloads (latest)"
                value={mimicReleases[0]?.assets?.find(a => /\.exe$/i.test(a.name))?.download_count ?? 0}
                color="text-green"
              />
            </div>

            <div className="mt-5">
              <div className="text-xs text-dim uppercase tracking-widest mb-2">Recent releases</div>
              <div className="space-y-2">
                {mimicReleases.slice(0, 6).map((r, i) => {
                  const exe   = r.assets.find(a => /\.exe$/i.test(a.name));
                  const isLatest = i === 0;
                  return (
                    <div key={r.tag_name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs border-l-2 border-border pl-3 py-1 hover:border-blue/60">
                      <span className={isLatest ? 'text-text font-semibold' : 'text-text'}>{r.tag_name}</span>
                      {isLatest && <span className="text-[9px] uppercase tracking-widest text-green border border-green/50 rounded px-1.5 py-0.5">latest</span>}
                      <span className="text-dim">{fmtTs(r.published_at)}</span>
                      {exe ? (
                        <>
                          <a href={r.html_url} target="_blank" rel="noreferrer" className="text-blue hover:underline ml-auto">release notes ↗</a>
                          <a href={exe.browser_download_url} className="text-blue hover:underline" title={`${exe.name} (${Math.round(exe.size / 1024 / 1024)}MB · ${exe.download_count} dl)`}>installer ↗</a>
                        </>
                      ) : (
                        <span className="text-orange ml-auto text-[10px]">no .exe attached (build failed?)</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <div className="mt-5 text-xs text-dim leading-6 border-t border-border/60 pt-4">
          <div className="text-text mb-1">Officer ops cheat-sheet</div>
          <ul className="list-disc list-inside space-y-1">
            <li>Tester reports the engine won&apos;t start? The loading screen shows the agent log inline with a copy button — ask them to paste it.</li>
            <li>Tester stuck on a pre-1.0.0 beta? The old <code className="text-blue">mimic-beta</code> update channel was retired at 1.0.0, so beta installs won&apos;t auto-update across the switch. Have them grab a fresh installer from <a href="/mimic" target="_blank" rel="noreferrer" className="text-blue hover:underline">/mimic</a>; settings + state preserved across install. Once on 1.0.0+ everything auto-updates again.</li>
            <li>Per-tester fleet visibility (Mimic vs Parser.bat) requires the agent to identify itself in <code>agent_state</code>; planned for a follow-up. Until then this section is informational and the Active table below mixes both clients.</li>
          </ul>
        </div>
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
                    {isRealCharacter(s.character) ? (
                      <Link href={`/character/${encodeURIComponent(s.character)}`} className="text-blue hover:underline">{s.character}</Link>
                    ) : (
                      <span className="text-dim" title="Operator-level streams (chat / pvp / fun events) with no single character">{s.character}</span>
                    )}
                    <ClientChip client={s.client} appVersion={s.appVersion} agentVersion={s.agentVersion} />
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

// Client identification chip — colored per client so Mimic installs are
// visually distinct from Parser.bat installs on the agent fleet table.
// 'mimic' is blue (matches the Mimic button branding), 'parser' is dim,
// null/unknown gets a tentative chip ONLY if the agent version matches
// the Mimic-bundled bundle (2.5.2+) — Parser.bat installs haven't auto-
// updated to 2.5.2 yet so it's a reliable temporary heuristic. Once
// every active install reports agent_state.client explicitly, the
// heuristic stops matching anything and naturally retires.
function ClientChip({ client, appVersion, agentVersion }: { client: string | null; appVersion: string | null; agentVersion?: string | null }) {
  // Heuristic fallback for missing client tag.
  let resolved = client;
  let inferred = false;
  if (!resolved && agentVersion && /^2\.5\.[2-9]|^2\.[6-9]|^[3-9]\./.test(agentVersion)) {
    resolved = 'mimic';
    inferred = true;
  }
  if (!resolved) return null;
  const isMimic = resolved === 'mimic';
  const cls = isMimic
    ? 'bg-[#1f6feb22] text-blue border-blue/40'
    : 'bg-[#1a212c] text-dim border-border';
  const label = isMimic ? '🐺 Mimic' : 'Parser.bat';
  const suffix = appVersion ? `v${appVersion}` : (inferred ? '?' : null);
  const tooltip = inferred
    ? `Likely Mimic — agent v${agentVersion} matches the Mimic bundle but the client tag wasn't stamped. Update to the latest beta for an explicit tag.`
    : (appVersion ? `${resolved} v${appVersion}` : resolved);
  return (
    <span className={`inline-block ml-1.5 align-middle text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border ${cls}`} title={tooltip}>
      {label}{suffix ? <span className="ml-1 opacity-70 normal-case tracking-normal">{suffix}</span> : null}
    </span>
  );
}
