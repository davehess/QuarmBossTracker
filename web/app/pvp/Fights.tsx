// /pvp fight history and fight film (DECISIONS-2026-09-21.md §46). Two layouts on beta until the
// guild lead picks one (CLAUDE.md, UI options); with no ?v= the page is what production shows.
//   B (?v=b): each fight is a card, and a night's videos and clips hang on its biggest fight.
//   C (?v=c): the fights as a compact table, and the film in a gallery of its own.
import { fmtShort } from '@/lib/timezone';
import {
  PVP_CHANNEL, PVP_NIGHTS, medalEmbed, medalPage, nightForFight, youtubeEmbed, youtubeWatch,
  type PvpFightRow, type PvpMediaItem, type PvpNight,
} from '@/lib/pvpMedia';

const mins = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 60000));
const length = (a: string, b: string) => {
  const m = mins(a, b);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};
const guildsByDeaths = (f: PvpFightRow) =>
  Object.entries(f.deaths_by_guild ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

function Explainer() {
  return (
    <p className="text-xs text-dim mt-1 max-w-prose">
      A fight is deaths in one zone that come in waves: each death within 3 minutes of the last, at
      least one of them a player kill, and waves less than 20 minutes apart. The last 30 days, from
      every PvP death broadcast, whoever was fighting.
    </p>
  );
}

function SplitBar({ f }: { f: PvpFightRow }) {
  const zek = f.deaths ? Math.round((f.zek_deaths / f.deaths) * 100) : 0;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded bg-border" aria-hidden>
      <div className="bg-red" style={{ width: `${zek}%` }} />
    </div>
  );
}

function Killers({ f }: { f: PvpFightRow }) {
  const k = f.top_killers ?? [];
  if (k.length === 0) return <span className="text-dim">—</span>;
  return (
    <>
      {k.map((x, i) => (
        <span key={x.killer}>
          {i > 0 && <span className="text-dim"> · </span>}
          <span className="text-text">{x.killer}</span>
          {x.guild && <span className="text-dim"> &lt;{x.guild}&gt;</span>}
          <span className="text-gold tabular-nums"> {x.kills}</span>
        </span>
      ))}
    </>
  );
}

function Frame({ src, title }: { src: string; title: string }) {
  return (
    <div className="relative w-full aspect-video overflow-hidden rounded border border-border bg-bg">
      <iframe
        src={src}
        title={title}
        loading="lazy"
        allow="accelerometer; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        className="absolute inset-0 h-full w-full"
      />
    </div>
  );
}

function MediaItem({ m }: { m: PvpMediaItem }) {
  if (m.kind === 'image') {
    return (
      <figure className="m-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.src} width={m.width} height={m.height} alt={m.caption} loading="lazy"
             className="w-full h-auto rounded border border-border" />
        <figcaption className="text-xs text-dim mt-1">{m.caption} · {m.credit}</figcaption>
      </figure>
    );
  }
  const yt = m.kind === 'youtube';
  return (
    <figure className="m-0">
      <Frame src={yt ? youtubeEmbed(m.id) : medalEmbed(m.id)} title={m.caption} />
      <figcaption className="text-xs text-dim mt-1">
        <a href={yt ? youtubeWatch(m.id) : medalPage(m.id)} target="_blank" rel="noopener noreferrer"
           className="text-text hover:text-blue">{m.caption}</a>
        {' · '}{m.credit}{' · '}{yt ? 'YouTube' : 'Medal'}
      </figcaption>
    </figure>
  );
}

function Film({ night }: { night: PvpNight }) {
  const vids = night.media.filter(m => m.kind === 'youtube').length;
  const clips = night.media.filter(m => m.kind === 'medal').length;
  const pics = night.media.filter(m => m.kind === 'image').length;
  const counts = [vids && `${vids} video${vids === 1 ? '' : 's'}`, clips && `${clips} clip${clips === 1 ? '' : 's'}`,
    pics && `${pics} screenshot${pics === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  return (
    <div className="mt-3">
      <p className="text-sm text-text">🎬 {night.title} <span className="text-xs text-dim">({counts})</span></p>
      <p className="text-xs text-dim mt-1 max-w-prose">{night.blurb}</p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {night.media.map(m => <MediaItem key={m.kind + (m.kind === 'image' ? m.src : m.id)} m={m} />)}
      </div>
    </div>
  );
}

function ChannelLink() {
  return (
    <p className="text-xs text-dim mt-3">
      More kills on <a href={PVP_CHANNEL.url} target="_blank" rel="noopener noreferrer" className="text-blue hover:underline">{PVP_CHANNEL.label}</a>.
    </p>
  );
}

// B: every fight a card; the night's film opens on its biggest fight.
export function FightCards({ fights, tz }: { fights: PvpFightRow[]; tz: string }) {
  return (
    <section className="bg-panel border border-border rounded-lg p-4 sm:p-6">
      <h2 className="text-xl text-gold flex items-center gap-2"><span aria-hidden>⚔️</span><span>Fights</span></h2>
      <Explainer />
      {fights.length === 0 ? (
        <p className="text-sm text-dim italic mt-3">No fights in the last 30 days.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {fights.map(f => {
            const night = nightForFight(f, fights);
            return (
              <li key={f.zone + f.started_at} className={`rounded border p-3 ${night ? 'border-gold/50 bg-bg/60' : 'border-border bg-bg/40'}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-text font-semibold">{f.zone}</span>
                  <span className="text-xs text-dim tabular-nums">
                    {fmtShort(f.started_at, tz)} · {length(f.started_at, f.ended_at)} · {f.waves} wave{f.waves === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="mt-2 flex items-baseline gap-3 tabular-nums">
                  <span className="text-2xl text-text leading-none">{f.deaths}</span>
                  <span className="text-xs text-dim">deaths · <span className="text-red">Zek {f.zek_deaths}</span> · everyone else {f.rest_deaths}</span>
                </div>
                <div className="mt-1.5"><SplitBar f={f} /></div>
                <p className="text-xs mt-2 leading-relaxed">
                  <span className="text-dim">Deaths by guild: </span>
                  {guildsByDeaths(f).map(([g, n], i) => (
                    <span key={g}>{i > 0 && <span className="text-dim"> · </span>}<span className="text-text">{g}</span> <span className="tabular-nums text-dim">{n}</span></span>
                  ))}
                </p>
                <p className="text-xs mt-1 leading-relaxed"><span className="text-dim">Top killers: </span><Killers f={f} /></p>
                {night && (
                  <details className="mt-2" open>
                    <summary className="cursor-pointer text-xs text-gold">🎬 Film from this fight</summary>
                    <Film night={night} />
                    <ChannelLink />
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// C: a compact table of fights, and the film in its own gallery.
export function FightTable({ fights, tz }: { fights: PvpFightRow[]; tz: string }) {
  return (
    <>
      <section className="bg-panel border border-border rounded-lg p-4 sm:p-6">
        <h2 className="text-xl text-gold flex items-center gap-2"><span aria-hidden>⚔️</span><span>Fights</span></h2>
        <Explainer />
        {fights.length === 0 ? (
          <p className="text-sm text-dim italic mt-3">No fights in the last 30 days.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-dim text-left">
                <tr className="border-b border-border">
                  <th className="py-1 pr-3">Zone</th>
                  <th className="py-1 pr-3">Started</th>
                  <th className="py-1 pr-3 text-right">Length</th>
                  <th className="py-1 pr-3 text-right">Deaths</th>
                  <th className="py-1 pr-3 text-right">Zek</th>
                  <th className="py-1 pr-3">Top killer</th>
                </tr>
              </thead>
              <tbody>
                {fights.map(f => {
                  const top = (f.top_killers ?? [])[0];
                  return (
                    <tr key={f.zone + f.started_at} className="border-b border-border/30">
                      <td className="py-1 pr-3 text-text">{f.zone}{nightForFight(f, fights) && <span title="Film below"> 🎬</span>}</td>
                      <td className="py-1 pr-3 text-dim tabular-nums whitespace-nowrap">{fmtShort(f.started_at, tz)}</td>
                      <td className="py-1 pr-3 text-right text-dim tabular-nums">{length(f.started_at, f.ended_at)}</td>
                      <td className="py-1 pr-3 text-right text-text tabular-nums">{f.deaths}</td>
                      <td className="py-1 pr-3 text-right text-red tabular-nums">{f.zek_deaths}</td>
                      <td className="py-1 pr-3 text-dim">{top ? <><span className="text-text">{top.killer}</span> {top.kills}</> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="bg-panel border border-border rounded-lg p-4 sm:p-6">
        <h2 className="text-xl text-gold flex items-center gap-2"><span aria-hidden>🎬</span><span>Fight film</span></h2>
        {PVP_NIGHTS.map(n => <Film key={n.key} night={n} />)}
        <ChannelLink />
      </section>
    </>
  );
}
