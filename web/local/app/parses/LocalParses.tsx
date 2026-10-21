'use client';

// My parses, built on this PC. Two views in one client page (a static export has no dynamic routes, so the fight is
// `?id=`): the list of your own fights as this PC recorded them, and one fight with every player this PC saw.
// Both read the agent on the same origin (GET /api/local/parses, /api/local/parses/<id>). When you are a guild member
// the agent also keeps the guild's merged record of the same fight, and the page shows THE DIFFERENCE: what the raid
// did against what this PC saw, the players only others saw, and your own row against the guild's. Without a guild
// record (local-only, signed out, or the server not offering it yet) the page says so plainly and shows this PC's
// view alone. Nothing is uploaded; the agent makes the one read-only call, not this page.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClassificationChip } from '@/components/KillCard';
import { fmtDmg, fmtDuration, fmtTime } from '@/lib/format';

type Hub = { available: boolean; status: string; message: string; synced_at: string | null; encounters: number };
type Mine = { char: string; dmg: number; dps: number };
type ListFight = {
  id: string; t: string; end: string; name: string; zone: string | null; boss: boolean; dur: number;
  mine: Mine[]; dmg: number; dps: number; detail: boolean; players_n: number | null; seen_total: number | null;
  guild: null | { damage: number; seen_pct: number | null; others: number; classification: string | null; mine_delta_pct: number | null };
};
type ListResponse = { ok: boolean; total: number; truncated: boolean; hub: Hub; fights: ListFight[] };

type Player = { name: string; dmg: number; pet_dmg: number; dps: number; sec: number; took: number; tookMax: number; ds: number; heal: number; pet: boolean; own: boolean };
type GuildPlayer = { name: string; class: string | null; damage: number | null; dps: number | null; rank: number | null; pets: boolean; anon?: boolean };
type Guild = {
  id: string; name: string; started_at: string; duration_sec: number | null; total_damage: number | null; total_dps: number | null;
  classification: string | null; incomplete: boolean; players: GuildPlayer[];
  loot: { id: number | null; looter: string | null; item: string; at: string | null; pet?: boolean; anon?: boolean }[];
};
type Diff = {
  hub: { total_damage: number; players: number };
  start_offset_sec: number;
  raid: { guild_damage: number; seen_damage: number | null; missing_damage: number | null; seen_pct: number | null };
  players_only_others: { count: number; damage: number; hidden: number; names: string[] };
  players_only_here: { count: number; names: string[] };
  mine: { char: string; here: number; guild: number | null; delta: number | null; delta_pct: number | null; guild_place: number | null; guild_n: number }[];
  duration: { here: number; guild: number | null; delta: number | null };
};
type DetailResponse = {
  ok: boolean; hub: Hub; guild: Guild | null; diff: Diff | null;
  fight: {
    id: string; t: string; end: string; name: string; zone: string | null; boss: boolean; dur: number; mine: Mine[];
    detail: boolean; players: Player[] | null; healers: { name: string; heal: number; hps: number }[];
    deaths: { name: string; at_sec: number }[]; deaths_kept: boolean; sources: string[];
  };
};

const API = '/api/local/parses';
const TZ = 'America/New_York';
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
const num = (n: number) => n.toLocaleString('en-US');
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtDmg(Math.abs(n))}`;
const signedPct = (n: number | null) => (n == null ? '' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}%`);
const chip = 'px-2.5 py-1 rounded border text-xs';
const card = 'bg-panel border border-border rounded-lg';

function useFightId(): string {
  const [id, setId] = useState('');
  useEffect(() => { setId(new URLSearchParams(window.location.search).get('id') || ''); }, []);
  return id;
}

/** The guild record's state in one line: green when it is on this PC, a plain "not available" when it is not. */
function HubBanner({ hub }: { hub: Hub }) {
  if (hub.available) {
    return (
      <div className="mt-3 text-xs rounded border border-green/40 bg-[#0f1f17] px-3 py-2 text-text" data-hub="on">
        <span className="text-green">● Guild record on this PC</span>
        <span className="text-dim"> · {hub.encounters.toLocaleString()} merged encounters kept{hub.synced_at ? `, updated ${fmtTime(hub.synced_at)}` : ''}. Fights it matches show the difference.</span>
      </div>
    );
  }
  return (
    <div className="mt-3 text-xs rounded border border-border bg-[#1a1710] px-3 py-2" data-hub="off">
      <b className="text-orange">Guild record not available on this PC.</b>{' '}
      <span className="text-dim">{hub.message} Your own fights below are what this PC recorded.</span>
    </div>
  );
}

export default function LocalParses() {
  const id = useFightId();
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  if (!ready) return <p className="text-sm text-dim">Reading your fights…</p>;
  return id ? <FightView id={id} /> : <FightList />;
}

// ---- the list ----

function FightList() {
  const [scope, setScope] = useState<'bosses' | 'all'>('bosses');
  const [data, setData] = useState<ListResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`${API}?scope=${scope}&limit=400`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`the agent answered ${r.status}`))))
      .then((j: ListResponse) => { setData(j); setErr(null); })
      .catch((e: Error) => setErr(e.message || 'could not reach the agent'));
  }, [scope]);
  useEffect(() => {
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const days = useMemo(() => {
    const out: { day: string; fights: ListFight[] }[] = [];
    for (const f of data?.fights ?? []) {
      const d = dayOf(f.t);
      const last = out[out.length - 1];
      if (last && last.day === d) last.fights.push(f); else out.push({ day: d, fights: [f] });
    }
    return out;
  }, [data]);

  return (
    <div className="space-y-4">
      <section className={`${card} p-6`}>
        <div className="flex items-start gap-3">
          <h2 className="text-2xl text-gold mb-1"><span aria-hidden>📈 </span>My parses</h2>
          <button type="button" onClick={load}
            className="ml-auto text-[11px] px-2 py-0.5 rounded border border-border text-dim hover:text-text">Reload</button>
        </div>
        <div className="text-sm text-dim leading-6">
          Your own fights, as <b className="text-text">this PC</b> recorded them from your logs. Open one for every player
          this PC saw. When the guild&apos;s merged record of the same fight is on this PC, the page shows <b className="text-text">the
          difference</b>: what the raid did against what your log caught.
        </div>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Which fights">
          {([['bosses', 'Bosses'], ['all', 'All fights']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setScope(k)} aria-pressed={scope === k}
              className={`${chip} ${scope === k ? 'border-gold text-gold' : 'border-border text-text hover:border-blue'}`}>{label}</button>
          ))}
        </div>
        {data && <HubBanner hub={data.hub} />}
      </section>

      {err && !data && (
        <p className={`${card} p-4 text-sm text-orange`}>Could not read your fights from Mimic ({err}). Open this page from Mimic&apos;s dashboard, with the agent running.</p>
      )}
      {!err && !data && <p className="text-sm text-dim">Reading your fights…</p>}
      {data && data.fights.length === 0 && (
        <p className={`${card} p-4 text-sm text-dim`}>
          No fights recorded on this PC yet{scope === 'bosses' ? ' (try All fights: a fight counts as a boss only once Mimic knows the mob)' : ''}.
          Fight with Mimic running and they appear here when each one ends.
        </p>
      )}
      {days.map(d => (
        <section key={d.day} className={`${card} overflow-x-auto`}>
          <div className="px-4 py-2 text-xs text-dim border-b border-border">{d.day}</div>
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-[11px] text-dim">
                <th className="py-2 px-4 w-20">Time</th>
                <th className="py-2 px-2">Fight</th>
                <th className="py-2 px-2 text-right">You</th>
                <th className="py-2 px-2 text-right w-20">Length</th>
                <th className="py-2 px-2 text-right">This PC saw</th>
                <th className="py-2 px-4">Guild record</th>
              </tr>
            </thead>
            <tbody>
              {d.fights.map(f => (
                <tr key={f.id} className="border-t border-border/60 hover:bg-[#1c2230]">
                  <td className="py-2 px-4 text-dim whitespace-nowrap">{fmtTime(f.t)}</td>
                  <td className="py-2 px-2">
                    <a href={`/local/parses/?id=${encodeURIComponent(f.id)}`} className="text-blue">{f.name}</a>
                    {f.boss && <span className="ml-2 text-[9px] uppercase tracking-wide px-1 py-px rounded border border-gold/40 text-gold">boss</span>}
                    {f.zone && <div className="text-[11px] text-dim">{f.zone}</div>}
                  </td>
                  <td className="py-2 px-2 text-right whitespace-nowrap">
                    {f.mine.length ? (
                      <>
                        <span className="text-text">{fmtDmg(f.dmg)}</span> <span className="text-dim">· {num(Math.round(f.dps))} dps</span>
                        <div className="text-[11px] text-dim">{f.mine[0].char}{f.mine.length > 1 ? ` +${f.mine.length - 1}` : ''}</div>
                      </>
                    ) : <span className="text-dim">—</span>}
                  </td>
                  <td className="py-2 px-2 text-right text-dim whitespace-nowrap">{fmtDuration(f.dur)}</td>
                  <td className="py-2 px-2 text-right whitespace-nowrap">
                    {f.detail && f.seen_total != null
                      ? <><span className="text-text">{fmtDmg(f.seen_total)}</span><div className="text-[11px] text-dim">{f.players_n} players</div></>
                      : <span className="text-dim" title="Older than the week of detail this PC keeps: only your own row remains">own row only</span>}
                  </td>
                  <td className="py-2 px-4 whitespace-nowrap">
                    {f.guild ? (
                      <>
                        <span className="text-text">{fmtDmg(f.guild.damage)}</span>
                        <ClassificationChip classification={f.guild.classification} />
                        <div className="text-[11px] text-dim">
                          {f.guild.seen_pct != null ? `you saw ${f.guild.seen_pct}%` : 'matched'}
                          {f.guild.others > 0 ? ` · ${f.guild.others} only others saw` : ''}
                        </div>
                      </>
                    ) : <span className="text-dim">{data?.hub.available ? 'no match' : '—'}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {data?.truncated && <p className="text-xs text-dim">Showing the newest {data.fights.length} of {data.total.toLocaleString()} fights.</p>}
      <p className="text-xs text-dim">
        A fight is matched to the guild&apos;s record by the same mob starting within ten minutes. Per-player detail is kept for the last
        week of fights; older fights keep your own row.
      </p>
    </div>
  );
}

// ---- one fight ----

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded border border-border bg-[#11161d] px-3 py-2">
      <div className="text-[11px] text-dim">{label}</div>
      <div className={`text-lg ${tone || 'text-text'}`}>{value}</div>
      {sub && <div className="text-[11px] text-dim">{sub}</div>}
    </div>
  );
}

type Row = { key: string; name: string; here: Player | null; guild: GuildPlayer | null };

function FightView({ id }: { id: string }) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${API}/${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(r => (r.status === 404 ? Promise.reject(new Error('This PC no longer has that fight (it may have aged out).')) : r.ok ? r.json() : Promise.reject(new Error(`the agent answered ${r.status}`))))
      .then((j: DetailResponse) => { if (live) setData(j); })
      .catch((e: Error) => { if (live) setErr(e.message || 'could not reach the agent'); });
    return () => { live = false; };
  }, [id]);

  // This PC's players and the guild's on one list, so the difference reads across a row.
  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const by = new Map<string, Row>();
    for (const p of data.fight.players ?? []) by.set(p.name.toLowerCase(), { key: p.name.toLowerCase(), name: p.name, here: p, guild: null });
    for (const g of data.guild?.players ?? []) {
      const k = g.name.toLowerCase();
      const r = by.get(k);
      if (r) r.guild = g; else by.set(k, { key: k, name: g.name, here: null, guild: g });
    }
    return [...by.values()].sort((a, b) => Math.max(b.here?.dmg ?? 0, b.guild?.damage ?? 0) - Math.max(a.here?.dmg ?? 0, a.guild?.damage ?? 0));
  }, [data]);

  const back = <a href="/local/parses/" className="text-xs text-blue">← All my parses</a>;
  if (err) return <div className="space-y-3">{back}<p className={`${card} p-4 text-sm text-orange`}>{err}</p></div>;
  if (!data) return <div className="space-y-3">{back}<p className="text-sm text-dim">Reading the fight…</p></div>;

  const { fight: f, hub, guild, diff } = data;
  const hasGuild = !!(guild && diff);
  const top = Math.max(1, ...rows.map(r => Math.max(r.here?.dmg ?? 0, r.guild?.damage ?? 0)));
  const total = f.players ? f.players.reduce((a, p) => a + p.dmg, 0) : 0;

  return (
    <div className="space-y-4">
      {back}
      <section className={`${card} p-6`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-2xl text-gold">{f.name}</h2>
          {f.boss && <span className="text-[9px] uppercase tracking-wide px-1 py-px rounded border border-gold/40 text-gold">boss</span>}
          {guild && <ClassificationChip classification={guild.classification} />}
        </div>
        <div className="text-sm text-dim mt-1">
          {dayOf(f.t)}, {fmtTime(f.t)} · {fmtDuration(f.dur)}{f.zone ? ` · ${f.zone}` : ''}
          {f.mine.length > 0 && <> · You: <span className="text-text">{f.mine.map(m => `${m.char} ${fmtDmg(m.dmg)} (${num(Math.round(m.dps))} dps)`).join(', ')}</span></>}
        </div>
        <HubBanner hub={hub} />
        {hub.available && !hasGuild && (
          <p className="mt-2 text-xs text-dim">No guild record matches this fight (the same mob starting within ten minutes). Nobody else uploaded it, or it has not synced yet.</p>
        )}
      </section>

      {hasGuild && diff && guild && (
        <section className={`${card} p-6`} data-diff="on">
          <h3 className="text-lg text-gold mb-1">The difference</h3>
          <p className="text-xs text-dim mb-3">
            The guild&apos;s record merges every raider&apos;s log, taking each player&apos;s highest damage. This PC saw only what its own log caught.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Raid damage, guild record" value={fmtDmg(diff.raid.guild_damage)}
              sub={`${diff.hub.players} players${guild.total_dps ? ` · ${num(Math.round(guild.total_dps))} dps` : ''}`} />
            <Tile label="Raid damage, this PC saw"
              value={diff.raid.seen_damage == null ? 'own row only' : fmtDmg(diff.raid.seen_damage)}
              sub={diff.raid.seen_pct == null ? 'older than the week of detail' : `${diff.raid.seen_pct}% of the guild's, ${signed(-(diff.raid.missing_damage ?? 0))} vs it`}
              tone={diff.raid.seen_pct != null && diff.raid.seen_pct < 90 ? 'text-orange' : 'text-text'} />
            <Tile label="Players only others saw"
              value={diff.raid.seen_damage == null ? '—' : String(diff.players_only_others.count)}
              sub={diff.raid.seen_damage == null ? undefined
                : diff.players_only_others.count === 0 ? 'this PC saw everyone'
                  : `${fmtDmg(diff.players_only_others.damage)} damage${diff.players_only_others.hidden ? `, ${diff.players_only_others.hidden} hidden by choice` : ''}`}
              tone={diff.players_only_others.count > 0 ? 'text-orange' : 'text-green'} />
            <Tile label="Length"
              value={fmtDuration(diff.duration.here)}
              sub={diff.duration.guild == null ? 'guild length unknown' : `guild ${fmtDuration(diff.duration.guild)}${diff.duration.delta ? ` (${diff.duration.delta > 0 ? '+' : '−'}${fmtDuration(Math.abs(diff.duration.delta))} here)` : ''}`} />
          </div>
          {diff.mine.length > 0 && (
            <div className="mt-4 text-sm">
              <div className="text-xs text-dim mb-1">Your row against the guild&apos;s</div>
              <ul className="space-y-1">
                {diff.mine.map(m => (
                  <li key={m.char}>
                    <span className="text-text">{m.char}</span>: this PC <b className="text-text">{fmtDmg(m.here)}</b>
                    {m.guild == null
                      ? <span className="text-dim"> · not in the guild record</span>
                      : <> · guild <b className="text-text">{fmtDmg(m.guild)}</b> · <span className={m.delta === 0 ? 'text-dim' : (m.delta ?? 0) < 0 ? 'text-orange' : 'text-green'}>{m.delta === 0 ? 'the same' : `${signed(m.delta ?? 0)} ${signedPct(m.delta_pct)}`}</span>
                        {m.guild_place != null && <span className="text-dim"> · #{m.guild_place} of {m.guild_n} in the guild record</span>}</>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {diff.players_only_here.count > 0 && (
            <p className="mt-3 text-xs text-dim">Seen only by this PC: {diff.players_only_here.names.join(', ')}{diff.players_only_here.count > 12 ? ' …' : ''}</p>
          )}
        </section>
      )}

      <section className={`${card} overflow-x-auto`}>
        <div className="px-4 py-2 text-xs text-dim border-b border-border flex flex-wrap gap-x-4">
          <span className="text-text">{hasGuild ? 'Players, this PC against the guild record' : 'Players this PC saw'}</span>
          {f.players && <span>{f.players.length} seen here · {fmtDmg(total)} total</span>}
        </div>
        {!f.detail && (
          <p className="p-4 text-sm text-dim">
            Only your own row is kept for this fight: Mimic keeps every player&apos;s numbers for the last week of fights, and this one is older.
          </p>
        )}
        {rows.length > 0 && (
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-[11px] text-dim">
                <th className="py-2 px-4 w-8">#</th>
                <th className="py-2 px-2">Player</th>
                <th className="py-2 px-2 text-right">Damage here</th>
                <th className="py-2 px-2 text-right">DPS</th>
                <th className="py-2 px-2 text-right">Taken</th>
                <th className="py-2 px-2 text-right">Healed</th>
                {hasGuild && <th className="py-2 px-2 text-right">Guild</th>}
                {hasGuild && <th className="py-2 px-4 text-right">Difference</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const here = r.here?.dmg ?? null;
                const g = r.guild?.damage ?? null;
                const delta = here != null && g != null ? here - g : null;
                return (
                  <tr key={r.key} className={`border-t border-border/60 ${r.here?.own ? 'bg-[#16202e]' : ''}`}>
                    <td className="py-1.5 px-4 text-dim">{i + 1}</td>
                    <td className="py-1.5 px-2">
                      <span className={r.here?.own ? 'text-gold' : 'text-text'}>{r.name}</span>
                      {r.guild?.class && <span className="ml-2 text-[11px] text-dim">{r.guild.class}</span>}
                      {r.here && r.here.pet_dmg > 0 && <span className="ml-2 text-[11px] text-dim">+pet {fmtDmg(r.here.pet_dmg)}</span>}
                      {r.here?.pet && <span className="ml-2 text-[11px] text-dim">(pet)</span>}
                      {hasGuild && !r.here && <span className="ml-2 text-[10px] uppercase tracking-wide text-orange">only others saw</span>}
                      {hasGuild && r.here && !r.guild && <span className="ml-2 text-[10px] uppercase tracking-wide text-blue">only this PC</span>}
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      {here != null ? (
                        <div className="inline-flex items-center gap-2 justify-end">
                          <span className="hidden sm:block h-1.5 rounded bg-blue/60" style={{ width: `${Math.max(2, Math.round(here / top * 80))}px` }} aria-hidden />
                          <span className="text-text">{fmtDmg(here)}</span>
                        </div>
                      ) : <span className="text-dim">—</span>}
                    </td>
                    <td className="py-1.5 px-2 text-right text-dim">{r.here ? num(Math.round(r.here.dps)) : '—'}</td>
                    <td className="py-1.5 px-2 text-right text-dim">{r.here && r.here.took > 0 ? fmtDmg(r.here.took) : '—'}</td>
                    <td className="py-1.5 px-2 text-right text-dim">{r.here && r.here.heal > 0 ? fmtDmg(r.here.heal) : '—'}</td>
                    {hasGuild && <td className="py-1.5 px-2 text-right">{g != null ? <span className="text-text">{fmtDmg(g)}</span> : <span className="text-dim">—</span>}</td>}
                    {hasGuild && (
                      <td className="py-1.5 px-4 text-right whitespace-nowrap">
                        {delta == null ? <span className="text-dim">{here == null ? `−${fmtDmg(g ?? 0)}` : '—'}</span>
                          : delta === 0 ? <span className="text-dim">same</span>
                            : <span className={delta < 0 ? 'text-orange' : 'text-green'}>{signed(delta)}</span>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className={`${card} p-4`}>
          <h3 className="text-sm text-gold mb-2">Healers</h3>
          {f.healers.length === 0 ? (
            <p className="text-xs text-dim">{f.detail
              ? 'No healing in this PC\'s record of the fight. A healer who dealt no damage and took none is not in it.'
              : 'Healing is kept for the last week of fights only.'}</p>
          ) : (
            <ul className="text-sm space-y-0.5">
              {f.healers.map(h => (
                <li key={h.name} className="flex justify-between gap-3"><span className="text-text">{h.name}</span><span className="text-dim">{fmtDmg(h.heal)} · {num(Math.round(h.hps))} hps</span></li>
              ))}
            </ul>
          )}
        </section>
        <section className={`${card} p-4`}>
          <h3 className="text-sm text-gold mb-2">Deaths</h3>
          {f.deaths.length === 0 ? (
            <p className="text-xs text-dim">{f.deaths_kept ? 'Nobody died.' : f.detail ? 'No deaths in this PC\'s record of the fight.' : 'Deaths are kept for the last week of fights only.'}</p>
          ) : (
            <ul className="text-sm space-y-0.5">
              {f.deaths.map((d, i) => (
                <li key={`${d.name}-${i}`} className="flex justify-between gap-3"><span className="text-red">{d.name}</span><span className="text-dim">{fmtDuration(d.at_sec)} in</span></li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {guild && guild.loot.length > 0 && (
        <section className={`${card} p-4`}>
          <h3 className="text-sm text-gold mb-2">Loot, guild record</h3>
          <ul className="text-sm space-y-0.5">
            {guild.loot.map((l, i) => (
              <li key={`${l.id ?? i}`} className="flex justify-between gap-3"><span className="text-text">{l.item}</span><span className="text-dim">{l.looter ?? ''}</span></li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-xs text-dim">
        Numbers are raw damage from your own log{hasGuild ? ' and the guild\'s merged record' : ''}. Characters who opted out of stats show as a class and a number in the guild record.
      </p>
    </div>
  );
}
