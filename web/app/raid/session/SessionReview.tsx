'use client';
// The raid session review: the replay of ONE time window, and beside it what happened in that window.
// Shared by the members' page (/raid/session) and the public share page (/share/raid/[token]); `mode` says where
// the data comes from and nothing else differs. Everything shown arrived in `bundle` (lib/raidSession.ts), already
// renamed for opted-out characters (their class and a number, "Cleric 2"), so this file only lays it out.
//
// Every line that has a time is a button that moves the replay's playhead there (the board's `seek` request), so
// "who was at the kill at 10:42" is one tap from the picture of where they stood.
//
// A bid winner's name (anywhere on the page) is a button that opens their Bids tab entry: what they won that night
// and the closed auctions they bid on and lost. The link is the bundle's opaque handle, never a name.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { classColor } from '@/lib/spectator';
import { MINUTE_MS, REPLAY_WINDOW_MS, type NightSummary } from '@/lib/raidReplay';
import { nameKey, type AttendeeRow, type BidderView, type KillRow, type LootEntry, type RollEntry, type SessionBundle, type TickRow } from '@/lib/raidSession';
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
function boardUrls(mode: ReviewMode, baseMs: number, toMs: number): BoundedReplay['urls'] {
  if (mode.kind === 'share') {
    const root = `/api/share/raid/${mode.token}`;
    return {
      window: (_night, fromIso) => `${root}/replay?w=${Math.max(0, Math.round((Date.parse(fromIso) - baseMs) / REPLAY_WINDOW_MS))}`,
      bosses: () => `${root}/bosses`,
      map: zone => `${root}/map?zone=${encodeURIComponent(zone)}`,
      mesh: (zone, floors) => `${root}/mesh?zone=${encodeURIComponent(zone)}${floors ? `&floors=${floors}` : ''}`,
    };
  }
  // The members' slice comes from the session route, not the replay page's, so opted-out names are renamed here too.
  const session = `from=${encodeURIComponent(new Date(baseMs).toISOString())}&to=${encodeURIComponent(new Date(toMs).toISOString())}`;
  return {
    window: (_night, fromIso) => `/api/raid/session/replay?${session}&w=${Math.max(0, Math.round((Date.parse(fromIso) - baseMs) / REPLAY_WINDOW_MS))}`,
    bosses: night => `/api/spectator/replay/bosses?night=${encodeURIComponent(night)}`,
    map: zone => `/api/spectator/map?zone=${encodeURIComponent(zone)}`,
    mesh: (zone, floors) => `/api/spectator/mesh?zone=${encodeURIComponent(zone)}${floors ? `&floors=${floors}` : ''}`,
  };
}

type TabKey = 'attendance' | 'kills' | 'loot' | 'bids' | 'parses';

/** What every name on the page needs: the session's window (for the members' parse call) and the winners to link. */
type ReviewCtx = { fromMs: number; toMs: number; handles: ReadonlyMap<string, string>; openBids: (handle: string) => void };
const ReviewContext = createContext<ReviewCtx>({ fromMs: 0, toMs: 0, handles: new Map(), openBids: () => {} });

/** A name, as a link to the winner's bids when it is a bid winner's (nameKey match) and plain text when it is not. */
function Who({ name }: { name: string }) {
  const { handles, openBids } = useContext(ReviewContext);
  const handle = handles.get(nameKey(name));
  if (!handle) return <>{name}</>;
  return (
    <button type="button" onClick={() => openBids(handle)} title="What they won and bid on"
      className="underline decoration-dotted underline-offset-2 hover:text-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue">
      {name}
    </button>
  );
}

export default function SessionReview({ bundle, night, mode, extras }: {
  bundle: SessionBundle;
  night: NightSummary | null;
  mode: ReviewMode;
  /** Members' page only: the officer's Share panel. */
  extras?: React.ReactNode;
}) {
  const [tab, setTab] = useState<TabKey>('attendance');
  const [seek, setSeek] = useState<{ t: number; n: number } | null>(null);
  const [bidder, setBidder] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const token = mode.kind === 'share' ? mode.token : '';
  const urls = useMemo(() => boardUrls(mode.kind === 'share' ? { kind: 'share', token } : { kind: 'member' }, bundle.fromMs, bundle.toMs),
    [mode.kind, token, bundle.fromMs, bundle.toMs]);
  const bounded = useMemo<BoundedReplay | null>(() => (night ? { night, urls, seek } : null), [night, urls, seek]);

  const handles = useMemo(() => new Map(bundle.bidders.map(b => [nameKey(b.name), b.handle] as const)), [bundle.bidders]);
  const openBids = useCallback((handle: string) => {
    setBidder(handle);
    setTab('bids');
    try { history.replaceState(null, '', `#bids-${handle}`); } catch { /* the link is a courtesy */ }
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  // A link with #bids-<handle> opens that winner's entry (set after mount: the server render has no hash).
  useEffect(() => {
    try {
      const m = /^#bids-(\w+)$/.exec(window.location.hash);
      if (m && bundle.bidders.some(b => b.handle === m[1])) { setBidder(m[1]); setTab('bids'); }
    } catch { /* no hash to read */ }
  }, [bundle.bidders]);
  const ctx = useMemo<ReviewCtx>(() => ({ fromMs: bundle.fromMs, toMs: bundle.toMs, handles, openBids }),
    [bundle.fromMs, bundle.toMs, handles, openBids]);

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
    { key: 'bids', label: 'Bids', n: bundle.bidders.length },
    { key: 'parses', label: 'Parses', n: bundle.kills.filter(k => k.top.length).length },
  ];

  return (
    <ReviewContext.Provider value={ctx}>
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

      <div ref={panelRef} className="mt-3 scroll-mt-16" role="tabpanel">
        {tab === 'attendance' && <Attendance rows={bundle.attendance} ticks={bundle.ticks} minutes={bundle.minutesRecorded} go={go} />}
        {tab === 'kills' && <Kills kills={bundle.kills} go={go} mode={mode} />}
        {tab === 'loot' && <LootAndRolls loot={bundle.loot} rolls={bundle.rolls} go={go} />}
        {tab === 'bids' && <Bids bidders={bundle.bidders} open={bidder} setOpen={setBidder} go={go} />}
        {tab === 'parses' && <Parses kills={bundle.kills} go={go} mode={mode} />}
      </div>
    </div>
    </ReviewContext.Provider>
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
                    <Who name={r.name} />{r.cls ? <span className="ml-1.5 text-xs text-dim">{r.cls}</span> : null}
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
                  <p className="mt-2 text-xs text-dim">
                    {t.names.length ? t.names.map((n, j) => <span key={n}>{j > 0 ? ', ' : ''}<Who name={n} /></span>) : 'No names.'}
                  </p>
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

function Kills({ kills, go, mode }: { kills: KillRow[]; go: (ms: number | null) => void; mode: ReviewMode }) {
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
      <p className="mb-1.5 text-xs text-dim">Tap a fight to open its full parse.</p>
      <ul className="space-y-1.5">
        {shown.map(k => (
          <li key={k.id} className="rounded-md border border-border bg-panel">
            <FightDetails id={k.id} mode={mode} summary={
              <>
                <Seek ms={k.startMs} go={go}>{etClock.format(k.startMs)}</Seek>
                <span className={`min-w-0 flex-1 ${k.boss ? 'text-gold' : ''}`}>{k.name}</span>
                <span className="text-xs text-dim">{k.zone ?? '—'}</span>
                <span className="text-xs tabular-nums">{fmtDur(k.durationSec)}</span>
                <span className="text-xs tabular-nums">{fmtDmg(k.totalDamage)}</span>
                {mode.kind === 'member' && (
                  <a href={`/parses/${k.id}`} className="whitespace-nowrap text-xs text-blue hover:underline">Parse page ↗</a>
                )}
              </>
            } />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── One fight's full parse, loaded when its row is opened ────────────────────

type ParseRow = { name: string; cls: string | null; damage: number; dps: number | null; pct: number; durationSec: number | null };
type FightParse = { totalDamage: number; durationSec: number | null; players: ParseRow[] };
type SortKey = 'name' | 'damage' | 'dps' | 'pct' | 'durationSec';

/**
 * The share variant sends a token and an encounter id, never a time; the server holds the window. The members'
 * call sends the review's window, which names whose bid wins are shown by name; it bounds nothing.
 */
const parseUrl = (mode: ReviewMode, id: string, fromMs: number, toMs: number) => (mode.kind === 'share'
  ? `/api/share/raid/${mode.token}/parse?encounter=${encodeURIComponent(id)}`
  : `/api/raid/session/parse?encounter=${encodeURIComponent(id)}&from=${encodeURIComponent(new Date(fromMs).toISOString())}&to=${encodeURIComponent(new Date(toMs).toISOString())}`);

/** A native <details> whose body is fetched the first time it opens. */
function FightDetails({ id, mode, summary }: { id: string; mode: ReviewMode; summary: React.ReactNode }) {
  const [opened, setOpened] = useState(false);
  return (
    <details className="group" onToggle={e => { if (e.currentTarget.open) setOpened(true); }}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="text-dim transition-transform group-open:rotate-90">▸</span>
        {summary}
      </summary>
      {opened && <ParseTable id={id} mode={mode} />}
    </details>
  );
}

function ParseTable({ id, mode }: { id: string; mode: ReviewMode }) {
  const [data, setData] = useState<FightParse | 'error' | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'damage', dir: -1 });
  const token = mode.kind === 'share' ? mode.token : '';
  const { fromMs, toMs } = useContext(ReviewContext);
  useEffect(() => {
    let live = true;
    fetch(parseUrl(token ? { kind: 'share', token } : { kind: 'member' }, id, fromMs, toMs))
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => { if (live) setData(j.parse as FightParse); })
      .catch(() => { if (live) setData('error'); });
    return () => { live = false; };
  }, [id, token, fromMs, toMs]);

  const rows = useMemo(() => {
    if (!data || data === 'error') return [];
    const { key, dir } = sort;
    return data.players.slice().sort((a, b) => {
      if (key === 'name') return dir * a.name.localeCompare(b.name);
      return dir * ((a[key] ?? -1) - (b[key] ?? -1)) || a.name.localeCompare(b.name);
    });
  }, [data, sort]);

  if (data === null) return <p className="border-t border-border/50 px-3 py-3 text-xs text-dim">Loading the parse…</p>;
  if (data === 'error') return <p className="border-t border-border/50 px-3 py-3 text-xs text-dim">That parse could not be loaded.</p>;
  if (!rows.length) return <p className="border-t border-border/50 px-3 py-3 text-xs text-dim">No damage was recorded for this fight.</p>;

  const head = (key: SortKey, label: string, right = true) => (
    <th className={`${th} ${right ? 'text-right' : ''}`} aria-sort={sort.key === key ? (sort.dir === -1 ? 'descending' : 'ascending') : 'none'}>
      <button type="button" onClick={() => setSort(s => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'name' ? 1 : -1 }))}
        className="uppercase tracking-wider hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue">
        {label}{sort.key === key ? (sort.dir === -1 ? ' ▼' : ' ▲') : ''}
      </button>
    </th>
  );
  const raidDps = data.durationSec ? Math.round(data.totalDamage / data.durationSec) : null;
  return (
    <div className="overflow-x-auto border-t border-border/50">
      <table className="w-full text-sm">
        <thead><tr>{head('name', 'Player', false)}{head('damage', 'Damage')}{head('dps', 'DPS')}{head('pct', '%')}{head('durationSec', 'Time')}</tr></thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.name} className="border-t border-border/50">
              <td className="px-2 py-1 whitespace-nowrap">
                <span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: classColor(p.cls) }} />
                <Who name={p.name} />{p.cls ? <span className="ml-1.5 text-xs text-dim">{p.cls}</span> : null}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtDmg(p.damage)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{p.dps != null ? fmtDmg(p.dps) : '—'}</td>
              <td className="px-2 py-1 text-right tabular-nums">{p.pct.toFixed(1)}%</td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtDur(p.durationSec)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border text-text">
            <td className="px-2 py-1">Total · {rows.length} {rows.length === 1 ? 'player' : 'players'}</td>
            <td className="px-2 py-1 text-right tabular-nums">{fmtDmg(data.totalDamage)}</td>
            <td className="px-2 py-1 text-right tabular-nums">{raidDps != null ? fmtDmg(raidDps) : '—'}</td>
            <td className="px-2 py-1 text-right tabular-nums">100%</td>
            <td className="px-2 py-1 text-right tabular-nums">{fmtDur(data.durationSec)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="px-2 pb-2 text-xs text-dim">Shares are of everyone&apos;s damage. Anyone who asked not to be shown appears as their class and a number.</p>
    </div>
  );
}

// ── Parses ───────────────────────────────────────────────────────────────────

function Parses({ kills, go, mode }: { kills: KillRow[]; go: (ms: number | null) => void; mode: ReviewMode }) {
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
                <span><span className="text-dim">{i + 1}.</span> <Who name={p.name} /></span>
                <span className="tabular-nums text-dim">{fmtDmg(p.damage)}{p.dps != null ? ` · ${fmtDmg(p.dps)}/s` : ''}</span>
              </li>
            ))}
          </ol>
          <div className="-mx-3 -mb-3 mt-2 border-t border-border/50">
            <FightDetails id={k.id} mode={mode} summary={<span className="text-xs text-dim">Full parse</span>} />
          </div>
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
                    {r.winners.length > 0 && (
                      <span className="text-xs">→ <span className="text-gold">{r.winners.map((w, j) => <span key={w.name}>{j > 0 ? ', ' : ''}<Who name={w.name} /> ({w.value})</span>)}</span></span>
                    )}
                    {r.lootedBy.length > 0 && (
                      <span className="text-xs text-dim"> · looted by {r.lootedBy.map((n, j) => <span key={n}>{j > 0 ? ', ' : ''}<Who name={n} /></span>)}</span>
                    )}
                  </summary>
                  <ol className="mt-2 grid gap-x-4 text-xs sm:grid-cols-2">
                    {r.lines.map((l, j) => (
                      <li key={j} className={`flex justify-between gap-2 border-t border-border/40 py-0.5 ${l.reroll ? 'text-dim line-through' : ''}`}>
                        <span><Who name={l.name} />{l.isWinner ? ' ★' : ''}{l.reroll ? ' (re-roll)' : ''}</span>
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
                    <td className="px-2 py-1">{l.who ? <Who name={l.who} /> : <span className="text-dim">—</span>}</td>
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

// ── Bids ─────────────────────────────────────────────────────────────────────

/**
 * The bid winners of the window, one entry each: what they won and paid, and the closed auctions they bid on and
 * lost (their highest bid, and who took it). Bids on an auction still open are sealed and never in the bundle.
 * A winner's name anywhere on the page opens its entry here.
 */
function Bids({ bidders, open, setOpen, go }: {
  bidders: BidderView[]; open: string | null; setOpen: (h: string | null) => void; go: (ms: number | null) => void;
}) {
  if (!bidders.length) return <Empty>No auction winners were recorded in this window.</Empty>;
  return (
    <div>
      <p className="mb-2 text-xs text-dim">
        {bidders.length} {bidders.length === 1 ? 'winner' : 'winners'}. Closed auctions only: bids on an auction that is still open stay sealed until it ends.
      </p>
      <ul className="space-y-1.5">
        {bidders.map(b => {
          const isOpen = open === b.handle;
          return (
            <li key={b.handle} id={`bids-${b.handle}`} className={`scroll-mt-16 rounded-md border bg-panel ${isOpen ? 'border-accent' : 'border-border'}`}>
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : b.handle)}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue">
                <span aria-hidden="true" className="text-dim">{isOpen ? '▾' : '▸'}</span>
                <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: classColor(b.cls) }} />
                <span className="text-text">{b.name}</span>
                <span className="text-xs text-dim">
                  won {b.wins.length}{b.losses.length ? ` · lost ${b.losses.length} closed ${b.losses.length === 1 ? 'bid' : 'bids'}` : ''}
                </span>
              </button>
              {isOpen && (
                <div className="space-y-3 border-t border-border/50 px-3 py-2">
                  <section>
                    <h3 className="mb-1 text-xs uppercase tracking-wider text-dim">Won · {b.wins.length}</h3>
                    <table className="w-full text-sm">
                      <thead><tr><th className={th}>When</th><th className={th}>Item</th><th className={`${th} text-right`}>DKP paid</th></tr></thead>
                      <tbody>
                        {b.wins.map((w, i) => (
                          <tr key={i} className="border-t border-border/50">
                            <td className="px-2 py-1"><Seek ms={w.atMs} go={go} /></td>
                            <td className="px-2 py-1">{w.item}</td>
                            <td className="px-2 py-1 text-right tabular-nums text-gold">{w.dkp != null ? w.dkp : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                  <section>
                    <h3 className="mb-1 text-xs uppercase tracking-wider text-dim">Bid on and lost · {b.losses.length}</h3>
                    {b.losses.length === 0 ? <p className="text-xs text-dim">No closed auction this window was bid on and lost.</p> : (
                      <table className="w-full text-sm">
                        <thead><tr><th className={th}>When</th><th className={th}>Item</th><th className={`${th} text-right`}>Their bid</th><th className={th}>Won by</th></tr></thead>
                        <tbody>
                          {b.losses.map((l, i) => (
                            <tr key={i} className="border-t border-border/50">
                              <td className="px-2 py-1"><Seek ms={l.atMs} go={go} /></td>
                              <td className="px-2 py-1">{l.item}</td>
                              <td className="px-2 py-1 text-right tabular-nums">{l.bid != null ? l.bid : '—'}</td>
                              <td className="px-2 py-1">{l.winner ? <Who name={l.winner} /> : <span className="text-dim">—</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </section>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
