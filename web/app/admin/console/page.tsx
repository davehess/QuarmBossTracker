// /admin/console — #87, the officer console.
//
// One page that answers "is something wrong?" before a raider reports it, and
// "what do I do about it?" without the answer living in somebody's head.
// Design + the full runbook prose: docs/DESIGN-87-officer-console.md.
//
// Three parts, in the order an officer needs them:
//   1. Health board   — signal tiles, worst first, raid-window aware.
//   2. Drift panel    — every control-plane override that is currently set,
//                       with its age and a one-click Clear. This is the piece
//                       that would have caught dedup_chat sitting at 0 for 14 days.
//   3. Runbooks       — the written procedures, deep-linkable (#rb-01).
//
// It MIRRORS the control plane; it does not own it. Writes go through the same
// overlay_tuning read-modify-write /admin/overlays and the bot's flag-override
// endpoint use, so all three surfaces agree. Officer gating is inherited from
// web/app/admin/layout.tsx — no new gate.
//
// Reads are deliberately cheap: nine max()/count() probes plus one same-origin
// health fetch. Nothing here is cached, because a cached health board is a lie.

import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import {
  buildSignals, sortSignals, overallState, driftFromTuning, driftAges,
  inRaidWindow, verNum, type Signal, type SignalState,
} from '@/lib/consoleHealth';
import { RUNBOOKS, type Runbook, type LeverRef } from '@/lib/runbooks';
import { DriftList, EmergencyPanel } from './ConsoleControls';

export const dynamic = 'force-dynamic';

// ── Data ────────────────────────────────────────────────────────────────────

async function loadFacts() {
  const sb = supabaseAdmin();
  const dayAgo  = new Date(Date.now() - 24 * 3600_000).toISOString();
  const weekAgo = new Date(Date.now() -  7 * 86_400_000).toISOString();
  const q15     = new Date(Date.now() - 15 * 60_000).toISOString();
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);

  const [
    tuningRow, lastUpload, active15, lastChat, lastEnc, encToday,
    lastLive, errors, versions, backfill, triggers,
  ] = await Promise.all([
    sb.from('overlay_tuning').select('tuning, updated_at, updated_by_name').eq('guild_id', 'wolfpack').maybeSingle(),
    sb.from('agent_upload_stats').select('last_uploaded_at')
      .order('last_uploaded_at', { ascending: false }).limit(1),
    sb.from('agent_upload_stats').select('character, last_agent_state').gte('last_uploaded_at', q15).limit(1000),
    sb.from('chat_messages').select('ts').order('ts', { ascending: false }).limit(1),
    sb.from('encounters').select('started_at').order('started_at', { ascending: false }).limit(1),
    sb.from('encounters').select('id', { count: 'exact', head: true }).gte('started_at', midnight.toISOString()),
    sb.from('character_live_state').select('updated_at').order('updated_at', { ascending: false }).limit(1),
    sb.from('agent_upload_stats').select('character, last_status_code, last_error, last_uploaded_at')
      .eq('last_ok', false).gte('last_uploaded_at', dayAgo)
      .order('last_uploaded_at', { ascending: false }).limit(50),
    sb.from('agent_upload_stats').select('character, agent_version').gte('last_uploaded_at', weekAgo).limit(2000),
    sb.from('agent_backfill_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('guild_triggers').select('pattern').eq('enabled', true).limit(1000),
  ]);

  // Distinct characters, not rows — agent_upload_stats is one row per
  // (character, endpoint), so a raw count over-reports by ~10x.
  const activeRows = (active15.data ?? []) as { character: string; last_agent_state: unknown }[];
  const active = new Set(activeRows.map(r => r.character));
  const queueDepths = activeRows
    .map(r => {
      const st = r.last_agent_state as { queuePending?: number } | null;
      return typeof st?.queuePending === 'number' ? st.queuePending : null;
    })
    .filter((n): n is number => n != null);

  const byVersion = new Map<string, Set<string>>();
  for (const r of (versions.data ?? []) as { character: string; agent_version: string | null }[]) {
    const key = r.agent_version ?? '(unknown)';
    if (!byVersion.has(key)) byVersion.set(key, new Set());
    byVersion.get(key)!.add(r.character);
  }
  const agentVersions = [...byVersion.entries()]
    .map(([version, chars]) => ({ version, chars: chars.size }))
    .sort((a, b) => (verNum(b.version) ?? -1) - (verNum(a.version) ?? -1));

  const errRows = (errors.data ?? []) as { character: string; last_status_code: number | null; last_error: string | null; last_uploaded_at: string }[];
  const patterns = ((triggers.data ?? []) as { pattern: string | null }[]).map(t => t.pattern ?? '');

  return {
    tuning: (tuningRow.data?.tuning as Record<string, unknown>) ?? {},
    tuningUpdatedAt: tuningRow.data?.updated_at as string | undefined,
    tuningUpdatedBy: tuningRow.data?.updated_by_name as string | undefined,
    lastUploadIso: (lastUpload.data?.[0] as { last_uploaded_at?: string } | undefined)?.last_uploaded_at ?? null,
    activeChars15m: active.size,
    lastChatIso: (lastChat.data?.[0] as { ts?: string } | undefined)?.ts ?? null,
    lastEncounterIso: (lastEnc.data?.[0] as { started_at?: string } | undefined)?.started_at ?? null,
    encountersToday: encToday.count ?? 0,
    lastLiveStateIso: (lastLive.data?.[0] as { updated_at?: string } | undefined)?.updated_at ?? null,
    errRows,
    agentVersions,
    backfillPending: backfill.count ?? 0,
    enabledTriggers: patterns.length,
    deadAnchoredTriggers: patterns.filter(p => p.trim().startsWith('^')).length,
    maxQueuePending: queueDepths.length ? Math.max(...queueDepths) : null,
  };
}

async function loadSiteHealth() {
  // Same-origin, unauthenticated, hard-timeboxed inside the route itself.
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://wolfpack.quest';
  try {
    const res = await fetch(`${base}/api/health`, { cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json() as { ok: boolean; degraded: boolean; checks?: { auth?: { state?: string }; db?: { state?: string } } };
    return {
      ok: !!j.ok, degraded: !!j.degraded,
      auth: j.checks?.auth?.state ?? '?', db: j.checks?.db?.state ?? '?',
    };
  } catch { return null; }
}

// ── Presentation ────────────────────────────────────────────────────────────

const TONE: Record<SignalState, { dot: string; border: string; text: string; word: string }> = {
  bad:     { dot: '🛑', border: 'border-red/60',    text: 'text-red',    word: 'needs an officer' },
  warn:    { dot: '⚠',  border: 'border-orange/50', text: 'text-orange', word: 'keep an eye on it' },
  quiet:   { dot: '🌙', border: 'border-border',    text: 'text-dim',    word: 'quiet' },
  unknown: { dot: '❔', border: 'border-border',    text: 'text-dim',    word: 'unknown' },
  ok:      { dot: '✅', border: 'border-border',    text: 'text-green',  word: 'ok' },
};

function SignalTile({ s }: { s: Signal }) {
  const t = TONE[s.state];
  return (
    <div className={`bg-panel border rounded-lg p-3 ${t.border}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-dim">{s.label}</span>
        <span className="text-sm">{t.dot}</span>
      </div>
      <div className={`text-base font-semibold ${t.text} mt-0.5`}>{s.value}</div>
      <p className="text-[11px] text-dim leading-4 mt-1">{s.detail}</p>
      {s.runbook && (s.state === 'bad' || s.state === 'warn') && (
        <a href={`#${s.runbook}`} className="text-[11px] text-blue no-underline hover:underline">
          {s.runbook.toUpperCase()} →
        </a>
      )}
    </div>
  );
}

function Lever({ l }: { l: LeverRef }) {
  const cls = 'text-[11px] px-1.5 py-0.5 rounded border border-border bg-bg/60 no-underline';
  if (l.kind === 'route') {
    return <Link href={l.href} className={`${cls} text-blue hover:border-blue`}>{l.label ?? l.href}</Link>;
  }
  if (l.kind === 'flag')    return <code className={`${cls} text-orange`}>{l.key}</code>;
  if (l.kind === 'command') return <code className={`${cls} text-purple`}>/{l.name}</code>;
  if (l.kind === 'doc')     return <code className={`${cls} text-dim`}>{l.label ?? l.path}</code>;
  return <span className={`${cls} text-dim`}>{l.name}</span>;
}

function Steps({ title, steps }: { title: string; steps: Runbook['howYouTell'] }) {
  if (!steps.length) return null;
  return (
    <div className="mt-3">
      <div className="text-xs font-semibold text-gold mb-1">{title}</div>
      <ol className="list-decimal list-outside ml-4 space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="text-xs text-text leading-5">
            {s.text}
            {s.levers?.length ? (
              <span className="flex flex-wrap gap-1 mt-1">{s.levers.map((l, j) => <Lever key={j} l={l} />)}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function RunbookCard({ rb, hot }: { rb: Runbook; hot: boolean }) {
  return (
    <details
      id={rb.id}
      open={hot}
      className={`bg-panel border rounded-lg p-4 scroll-mt-4 ${hot ? 'border-red/60' : 'border-border'}`}
    >
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-dim/20 text-dim border border-border font-mono">
            {rb.id.toUpperCase()}
          </span>
          <span className="text-base text-orange">{rb.title}</span>
          {hot && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red/20 text-red border border-red/40">
              a signal is red right now
            </span>
          )}
          {rb.depth === 'outline' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-dim/20 text-dim border border-border">outline</span>
          )}
          {rb.speculative && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple/20 text-purple border border-purple/40">
              speculative — no incident behind this
            </span>
          )}
        </div>
        <p className="text-xs text-dim leading-5 mt-1">{rb.symptom}</p>
      </summary>

      <div className="mt-3 border-t border-border pt-3">
        <div className="text-xs font-semibold text-gold mb-1">Grounded in</div>
        <ul className="list-disc list-outside ml-4 space-y-1">
          {rb.groundedIn.map((g, i) => (
            <li key={i} className="text-[11px] text-dim leading-5">
              <span className="text-text font-mono">{g.date}</span> — {g.what}
            </li>
          ))}
        </ul>

        <Steps title="How you tell" steps={rb.howYouTell} />
        <Steps title="Do this" steps={rb.doThis} />

        {rb.ifStuck && (
          <p className="text-xs text-text leading-5 mt-3">
            <span className="text-gold font-semibold">If that didn&apos;t work — </span>{rb.ifStuck}
          </p>
        )}
        {rb.after && (
          <p className="text-xs text-text leading-5 mt-2">
            <span className="text-gold font-semibold">After — </span>{rb.after}
          </p>
        )}

        <div className="mt-3 border border-red/40 bg-red/5 rounded p-2">
          <div className="text-xs font-semibold text-red mb-1">Don&apos;t</div>
          <ul className="list-disc list-outside ml-4 space-y-1">
            {rb.donts.map((d, i) => <li key={i} className="text-[11px] text-text leading-5">{d}</li>)}
          </ul>
        </div>

        <p className="text-[10px] text-dim mt-2">Last reviewed {rb.lastReviewed}</p>
      </div>
    </details>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default async function OfficerConsolePage() {
  const [f, site] = await Promise.all([loadFacts(), loadSiteHealth()]);

  const drift = driftFromTuning(f.tuning);
  const ages  = driftAges(f.tuning, drift);
  const oldestDriftDays = drift.reduce<number | null>((m, e) => {
    const d = ages[e.key];
    return d == null ? m : (m == null ? d : Math.max(m, d));
  }, null);

  const floorRaw = f.tuning.min_agent_ver_num;
  const signals = sortSignals(buildSignals({
    lastUploadIso: f.lastUploadIso,
    activeChars15m: f.activeChars15m,
    lastChatIso: f.lastChatIso,
    lastEncounterIso: f.lastEncounterIso,
    encountersToday: f.encountersToday,
    lastLiveStateIso: f.lastLiveStateIso,
    errorUploaders: f.errRows.length,
    topErrorCode: f.errRows[0]?.last_status_code ?? null,
    agentVersions: f.agentVersions,
    versionFloor: typeof floorRaw === 'number' && floorRaw > 0 ? floorRaw : null,
    backfillPending: f.backfillPending,
    maxQueuePending: f.maxQueuePending,
    enabledTriggers: f.enabledTriggers,
    deadAnchoredTriggers: f.deadAnchoredTriggers,
    driftCount: drift.length,
    oldestDriftDays,
    site,
  }));

  const overall = overallState(signals);
  const inWindow = inRaidWindow();
  const hotRunbooks = new Set(
    signals.filter(s => s.state === 'bad' && s.runbook).map(s => s.runbook!),
  );
  const activeFlags: Record<string, boolean> = {};
  for (const e of drift) activeFlags[e.key] = true;

  const ordered = [...RUNBOOKS].sort((a, b) =>
    (Number(hotRunbooks.has(b.id)) - Number(hotRunbooks.has(a.id))) || (a.rank - b.rank));

  return (
    <div className="space-y-6 max-w-5xl">
      <section className={`bg-panel border rounded-lg p-6 ${TONE[overall].border}`}>
        <h2 className="text-xl text-gold mb-2">🎛 Officer console</h2>
        <p className="text-sm text-dim leading-6">
          Everything that tells you the platform is unwell, plus the written procedure for
          each way it goes wrong. {' '}
          <b className={TONE[overall].text}>{TONE[overall].dot} {TONE[overall].word}</b>{' '}
          right now — {inWindow
            ? <b className="text-orange">inside the raid window</b>
            : <>outside the raid window, so stale-data warnings are downgraded to <b>quiet</b></>}.
        </p>
        <p className="text-xs text-dim leading-5 mt-2">
          Mid-fight, the faster surface is Mimic&apos;s <b>🛡 Admin</b> tab — same levers, no alt-tab.
          This page is for setup, for the officer who isn&apos;t raid-leading, and for after.
          Raw tuning lives on <Link href="/admin/overlays" className="text-blue no-underline hover:underline">/admin/overlays</Link>;
          the per-character fleet table on <Link href="/admin/agents" className="text-blue no-underline hover:underline">/admin/agents</Link>.
        </p>
      </section>

      {/* 1 — health board */}
      <section>
        <h3 className="text-base text-gold mb-2">Health</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {signals.map(s => <SignalTile key={s.id} s={s} />)}
        </div>
      </section>

      {/* 2 — drift */}
      <section className="bg-panel border border-border rounded-lg p-5">
        <h3 className="text-base text-gold mb-1">Control-plane overrides</h3>
        <p className="text-xs text-dim leading-5 mb-3">
          Every one of these defaults to <b>off</b>. Anything listed is a mitigation somebody
          applied — and the failure mode is forgetting to take it off, not putting it on.
          {f.tuningUpdatedAt && (
            <> Tuning row last written {new Date(f.tuningUpdatedAt).toLocaleString()}
              {f.tuningUpdatedBy ? <> by <span className="text-text">{f.tuningUpdatedBy}</span></> : null}.</>
          )}
        </p>
        <DriftList entries={drift} ages={ages} />
      </section>

      {/* 3 — emergency levers */}
      <section className="bg-panel border border-red/40 rounded-lg p-5">
        <h3 className="text-base text-red mb-1">Emergency levers</h3>
        <p className="text-xs text-dim leading-5 mb-3">
          Read the runbook first. Clearing is always one click; setting a fleet-scale lever
          is deliberately not.
        </p>
        <EmergencyPanel active={activeFlags} />
      </section>

      {/* 4 — runbooks */}
      <section className="space-y-3">
        <h3 className="text-base text-gold">Runbooks</h3>
        <p className="text-xs text-dim leading-5">
          Ranked by likelihood × pain, from what has actually happened — every one carries the
          dated incident behind it. Anything with a red signal jumps to the top and opens
          itself. Deep-link a runbook in Discord with <code className="text-orange">#rb-01</code>.
        </p>
        {ordered.map(rb => <RunbookCard key={rb.id} rb={rb} hot={hotRunbooks.has(rb.id)} />)}
      </section>
    </div>
  );
}
