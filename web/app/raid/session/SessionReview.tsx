'use client';
// The raid session review: the replay of ONE time window, and beside it what happened in that window.
// Shared by the members' page (/raid/session) and the public share page (/share/raid/[token]); `mode` says where
// the data comes from and nothing else differs. Everything shown arrived in `bundle` (lib/raidSession.ts), already
// filtered for opted-out characters, so this file only lays it out.
//
// Every line that has a time is a button that moves the replay's playhead there (the board's `seek` request), so
// "who was at the kill at 10:42" is one tap from the picture of where they stood.
import { useMemo, useRef, useState } from 'react';
import { classColor } from '@/lib/spectator';
import { MINUTE_MS, REPLAY_WINDOW_MS, type NightSummary } from '@/lib/raidReplay';
import type { AttendeeRow, KillRow, LootEntry, RollEntry, SessionBundle, TickRow } from '@/lib/raidSession';
import ReplayBoard, { type BoundedReplay } from '@/app/spectator/replay/ReplayBoard';
import DataSources from './DataSources';

export type ReviewMode = { kind: 'member' } | { kind: 'share'; token: string };

const etClock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const etMin = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const fmtDmg = (n: number | null | undefined) => {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};
const fmtDur = (sec: number | null) => (sec == null ? '—' : sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60 ? ` ${sec % 60}s` : ''}`);
const fmtDkp = (n: number | null) => (n == null ? '' : `${n} DKP`);

const chip = 'rounded border px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors '
  + 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue';
const chipIdle = 'border-border bg-panel text-text hover:bg-[#21262d]';
const chipOn = 'border-accent bg-accent text-white';
const th = 'px-2 py-1.5 text-left text-[11px] font-normal uppercase tracking-wider text-dim';

/** The routes the board reads, by who is looking. The share variant sends a token and a window INDEX, never a time. */
function boardUrls(mode: ReviewMode, baseMs: number): BoundedReplay['urls'] {
  if (mode.kind === 'share') {
    const root = `/api/share/raid/${mode.token}`;
    return {
      window: (_night, fromIso) => `${root}/replay?w=${Math.max(0, Math.round((Date.parse(fromIso) - baseMs) / REPLAY_WINDOW_MS))}`,
      bosses: () => `${root}/bosses`,
      map: zone => `${root}/map?zone=${encodeURIComponent(zone)}`,
      mesh: (zone, floors) => `${root}/mesh?zone=${encodeURIComponent(zone)}${floors ? `&floors=${floors}` : ''}`,
    };
  }
  return {
    window: (night, fromIso, toIso) => `/api/spectator/replay?night=${encodeURIComponent(night)}&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
    bosses: night => `/api/spectator/replay/bosses?night=${encodeURIComponent(night)}`,
    map: zone => `/api/spectator/map?zone=${encodeURIComponent(zone)}`,
    mesh: (zone, floors) => `/api/spectator/mesh?zone=${encodeURIComponent(zone)}${floors ? `&floors=${floors}` : ''}`,
  };
}

type TabKey = 'attendance' | 'kills' | 'loot' | 'parses';

export default function SessionReview({ bundle, night, mode, extras }: {
  bundle: SessionBundle;
  night: NightSummary | null;
  mode: ReviewMode;
  /** Members' page only: the officer's Share panel. */
  extras?: React.ReactNode;
}) {
  const [tab, setTab] = useState<TabKey>('attendance');
  const [seek, setSeek] = useState<{ t: number; n: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const token = mode.kind === 'share' ? mode.token : '';
  const urls = useMemo(() => boardUrls(mode.kind === 'share' ? { kind: 'share', token } : { kind: 'member' }, bundle.fromMs),
    [mode.kind, token, bundle.fromMs]);
  const bounded = useMemo<BoundedReplay | null>(() => (night ? { night, urls, seek } : null), [night, urls, seek]);

  const go = (ms: number | null) => {
    if (ms == null) return;
    setSeek(s => ({ t: ms, n: (s?.n ?? 0) + 1 }));
    boardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const bossKills = bundle.kills.filter(k => k.boss);
  const tabs: { key: TabKey; label: string; n: number }[] = [
    { key: 'attendance', label: 'Attendance', n: bundle.attendance.length },
    { key: 'kills', label: 'Kills', n: bossKills.length || bundle.kills.length },
    { key: 'loot', label: 'Loot & rolls', n: bundle.loot.length + bundle.rolls.length },
    { key: 'parses', label: 'Parses', n: bundle.kills.filter(k => k.top.length).length },
  ];

  return (
    <div className="min-w-0">
      {/* Above the replay, so a reader from another guild meets "where did this come from?" first (the guild lead). */}
      <DataSources />

      <div ref={boardRef} className="mt-4 scroll-mt-16">
        {bounded
          ? <ReplayBoard bounded={bounded} />
          : <p className="rounded-md border border-border bg-panel p-4 text-sm text-dim">No replay was recorded in this window. The lists below are whatever else was logged in it.</p>}
      </div>

      {extras && <div className="mt-3">{extras}</div>}

      <div className="mt-5 flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Session details">
        {tabs.map(t => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`${chip} ${tab === t.key ? chipOn : chipIdle}`}>
            {t.label} <span className="opacity-70">{t.n}</span>
          </button>
        ))}
      </div>

      <div className="mt-3" role="tabpanel">
        {tab === 'attendance' && <Attendance rows={bundle.attendance} ticks={bundle.ticks} minutes={bundle.minutesRecorded} go={go} />}
        {tab === 'kills' && <Kills kills={bundle.kills} go={go} />}
        {tab === 'loot' && <LootAndRolls loot={bundle.loot} rolls={bundle.rolls} go={go} />}
        {tab === 'parses' && <Parses kills={bundle.kills} go={go} />}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-border bg-panel p-4 text-sm text-dim">{children}</p>;
}

function Seek({ ms, go, children }: { ms: number | null; go: (ms: number | null) => void; children?: React.ReactNode }) {
  if (ms == null) return <span className="text-dim">—</span>;
  return (
    <button type="button" onClick={() => go(ms)} title="Show this moment on the replay"
      className="whitespace-nowrap rounded border border-border bg-panel px-1.5 py-0.5 font-mono text-xs text-blue hover:bg-[#21262d]">
      ▶ {children ?? etMin.format(ms)}
    </button>
  );
}

// ── Attendance ───────────────────────────────────────────────────────────────

function Attendance({ rows, ticks, minutes, go }: { rows: AttendeeRow[]; ticks: TickRow[]; minutes: number; go: (ms: number | null) => void }) {
  if (!rows.length && !ticks.length) return <Empty>Nobody was recorded in this window.</Empty>;
  return (
    <div className="space-y-4">
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border bg-panel">
          <p className="px-3 pt-2 text-xs text-dim">
            {rows.length} {rows.length === 1 ? 'character' : 'characters'} seen on the recording, out of {minutes} recorded {minutes === 1 ? 'minute' : 'minutes'}.
            Minutes are minutes seen, not minutes logged in.
          </p>
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Character</th><th className={th}>Seen</th><th className={th}>First seen</th><th className={th}>Last seen</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.name} className="border-t border-border/50">
                  <td className="px-2 py-1">
                    <span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: classColor(r.cls) }} />
                    {r.name}{r.cls ? <span className="ml-1.5 text-xs text-dim">{r.cls}</span> : null}
                  </td>
                  <td className="px-2 py-1 tabular-nums">
                    {r.minutes} min <span className="text-xs text-dim">({Math.round((r.minutes / Math.max(1, minutes)) * 100)}%)</span>
                  </td>
                  <td className="px-2 py-1"><Seek ms={r.firstMs} go={go} /></td>
                  <td className="px-2 py-1"><Seek ms={Math.max(r.firstMs, r.lastMs - MINUTE_MS)} go={go}>{etMin.format(r.lastMs - MINUTE_MS)}</Seek></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <h2 className="mb-1.5 text-xs uppercase tracking-wider text-dim">Raid ticks in this window</h2>
        {ticks.length === 0 ? (
          <p className="text-sm text-dim">None. No tick was captured in this window and no OpenDKP raid was dated inside it.</p>
        ) : (
          <ul className="space-y-1.5">
            {ticks.map((t, i) => (
              <li key={i} className="rounded-md border border-border bg-panel px-3 py-2 text-sm">
                <details>
                  <summary className="cursor-pointer">
                    {t.label} <span className="text-xs text-dim">· {t.names.length} {t.names.length === 1 ? 'name' : 'names'} · {t.source === 'captured' ? 'captured from the raid window' : 'OpenDKP'}</span>
                    {t.atMs != null && <span className="ml-2 inline-block"><Seek ms={t.atMs} go={go} /></span>}
                  </summary>
                  <p className="mt-2 text-xs text-dim">{t.names.join(', ') || 'No names.'}</p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Kills ────────────────────────────────────────────────────────────────────

function Kills({ kills, go }: { kills: KillRow[]; go: (ms: number | null) => void }) {
  const hasBoss = kills.some(k => k.boss);
  const [all, setAll] = useState(false);
  const shown = hasBoss && !all ? kills.filter(k => k.boss) : kills;
  if (!kills.length) return <Empty>No fights ended in this window.</Empty>;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-dim">
        <span>{shown.length} {shown.length === 1 ? 'fight' : 'fights'}{hasBoss && !all ? ' (guild-curated bosses)' : ''}</span>
        {hasBoss && (
          <button type="button" aria-pressed={all} onClick={() => setAll(a => !a)} className={`${chip} ${all ? chipOn : chipIdle}`}>
            {all ? 'All fights' : `Show all ${kills.length}`}
          </button>
        )}
      </div>
      <div className="overflow-x-auto rounded-md border border-border bg-panel">
        <table className="w-full text-sm">
          <thead><tr><th className={th}>Started</th><th className={th}>Mob</th><th className={th}>Zone</th><th className={th}>Length</th><th className={th}>Damage</th></tr></thead>
          <tbody>
            {shown.map(k => (
              <tr key={k.id} className="border-t border-border/50">
                <td className="px-2 py-1"><Seek ms={k.startMs} go={go}>{etClock.format(k.startMs)}</Seek></td>
                <td className={`px-2 py-1 ${k.boss ? 'text-gold' : ''}`}>{k.name}</td>
                <td className="px-2 py-1 text-dim">{k.zone ?? '—'}</td>
                <td className="px-2 py-1 tabular-nums">{fmtDur(k.durationSec)}</td>
                <td className="px-2 py-1 tabular-nums">{fmtDmg(k.totalDamage)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Parses ───────────────────────────────────────────────────────────────────

function Parses({ kills, go }: { kills: KillRow[]; go: (ms: number | null) => void }) {
  const withTop = kills.filter(k => k.top.length);
  const hasBoss = withTop.some(k => k.boss);
  const shown = hasBoss ? withTop.filter(k => k.boss) : withTop;
  if (!shown.length) return <Empty>No damage parses were recorded for the fights in this window.</Empty>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {shown.map(k => (
        <div key={k.id} className="rounded-md border border-border bg-panel p-3">
          <div className="mb-1 flex items-center justify-between gap-2 text-sm">
            <span className={k.boss ? 'text-gold' : ''}>{k.name}</span>
            <Seek ms={k.startMs} go={go} />
          </div>
          <ol className="text-xs">
            {k.top.map((p, i) => (
              <li key={p.name} className="flex justify-between gap-2 border-t border-border/40 py-0.5">
                <span><span className="text-dim">{i + 1}.</span> {p.name}</span>
                <span className="tabular-nums text-dim">{fmtDmg(p.damage)}{p.dps != null ? ` · ${fmtDmg(p.dps)}/s` : ''}</span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

// ── Loot and rolls ───────────────────────────────────────────────────────────

const KIND: Record<LootEntry['kind'], string> = { looted: 'Looted', awarded: 'Awarded', opendkp: 'OpenDKP' };

function LootAndRolls({ loot, rolls, go }: { loot: LootEntry[]; rolls: RollEntry[]; go: (ms: number | null) => void }) {
  if (!loot.length && !rolls.length) return <Empty>No loot or rolls were logged in this window.</Empty>;
  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-1.5 text-xs uppercase tracking-wider text-dim">Roll sessions · {rolls.length}</h2>
        {rolls.length === 0 ? <p className="text-sm text-dim">No rolls were captured.</p> : (
          <ul className="space-y-1.5">
            {rolls.map((r, i) => (
              <li key={i} className="rounded-md border border-border bg-panel px-3 py-2 text-sm">
                <details>
                  <summary className="cursor-pointer">
                    <span className="mr-2 inline-block"><Seek ms={r.startMs} go={go} /></span>
                    <span className="text-text">{r.item ?? 'Unlabelled roll'}</span>
                    <span className="text-xs text-dim"> · {r.from}–{r.to} · {r.rollers} {r.rollers === 1 ? 'roller' : 'rollers'}</span>
                    {' '}
                    {r.winnerHidden && r.winners.length === 0
                      ? <span className="text-xs text-dim">· winner not shown</span>
                      : r.winners.length > 0 && (
                        <span className="text-xs">→ <span className="text-gold">{r.winners.map(w => `${w.name} (${w.value})`).join(', ')}</span>{r.winnerHidden ? <span className="text-dim"> + not shown</span> : null}</span>
                      )}
                    {r.lootedBy.length > 0 && <span className="text-xs text-dim"> · looted by {r.lootedBy.join(', ')}</span>}
                  </summary>
                  <ol className="mt-2 grid gap-x-4 text-xs sm:grid-cols-2">
                    {r.lines.map((l, j) => (
                      <li key={j} className={`flex justify-between gap-2 border-t border-border/40 py-0.5 ${l.reroll ? 'text-dim line-through' : ''}`}>
                        <span>{l.name}{l.isWinner ? ' ★' : ''}{l.reroll ? ' (re-roll)' : ''}</span>
                        <span className="tabular-nums">{l.value}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-1.5 text-xs uppercase tracking-wider text-dim">Loot · {loot.length}</h2>
        {loot.length === 0 ? <p className="text-sm text-dim">No loot was logged.</p> : (
          <div className="overflow-x-auto rounded-md border border-border bg-panel">
            <table className="w-full text-sm">
              <thead><tr><th className={th}>When</th><th className={th}>Item</th><th className={th}>Who</th><th className={th}>DKP</th><th className={th}>Source</th></tr></thead>
              <tbody>
                {loot.map((l, i) => (
                  <tr key={i} className="border-t border-border/50">
                    <td className="px-2 py-1"><Seek ms={l.atMs} go={go} /></td>
                    <td className="px-2 py-1">{l.item}</td>
                    <td className="px-2 py-1">{l.whoHidden ? <span className="text-dim">not shown</span> : (l.who ?? <span className="text-dim">—</span>)}</td>
                    <td className="px-2 py-1 tabular-nums text-gold">{fmtDkp(l.dkp)}</td>
                    <td className="px-2 py-1 text-xs text-dim">{KIND[l.kind]}</td>
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
