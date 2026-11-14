import Link from 'next/link';
import { classShare, fmtBig, fmtClock, headlines, type ResultView } from '@/lib/parseResultFirstView';

// Parts shared by the three versions of the parse breakdown. Presentational only: all data arrives as one ResultView.
// No hooks here, so a server page and the tabbed client component can both use it.

export const CARD = 'rounded-lg border border-border bg-panel';
export const LABEL = 'text-xs uppercase tracking-wider text-dim';

const own = (v: ResultView) => new Set(v.mine.map((m) => m.toLowerCase()));

export function ResultStrip({ v }: { v: ResultView }) {
  const stateWord = v.state === 'killed' ? 'Killed' : v.state === 'wipe' ? 'Wipe' : 'Not counted';
  const stateColour = v.state === 'killed' ? 'text-green' : v.state === 'wipe' ? 'text-red' : 'text-orange';
  return (
    <section className={`${CARD} p-4`} aria-label="Fight result">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-bold text-text">{v.boss}</h1>
        <span className="text-xs text-dim">{[v.zone, v.whenLabel].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-3">
        <div className="w-full sm:w-auto">
          <div className={`text-4xl font-bold leading-none ${stateColour}`}>{stateWord}</div>
          {v.state === 'wipe' && v.bossHpLeftPct != null ? (
            <div className="mt-1 text-sm text-text">boss at {v.bossHpLeftPct}%</div>
          ) : null}
        </div>
        <div className="grid w-full grid-cols-3 gap-4 sm:flex sm:w-auto sm:gap-8">
          <Stat label="Time" value={fmtClock(v.durationSec)} />
          <Stat label="Total damage" value={fmtBig(v.totalDamage)} />
          <Stat label="Raid DPS" value={fmtBig(v.raidDps)} />
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-3xl font-bold leading-none text-text">{value}</div>
      <div className={`mt-1 ${LABEL}`}>{label}</div>
    </div>
  );
}

/** A slim line under the result: the viewer's own rows, so they never have to hunt the table. Nothing when unknown. */
export function YouLine({ v }: { v: ResultView }) {
  const o = own(v);
  const rows = v.players.filter((p) => o.has(p.name.toLowerCase()));
  if (!rows.length) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-md border-l-4 border-gold bg-panel px-3 py-2 text-sm" aria-label="Your rows">
      <span className="text-xs font-bold uppercase tracking-wider text-gold">You</span>
      {rows.map((p) => (
        <span key={p.name} className="text-text">
          <b className="text-gold">{p.name}</b> #{p.rank} of {v.players.length} · {fmtBig(p.dps)} DPS · {p.pct.toFixed(1)}%
        </span>
      ))}
    </div>
  );
}

const SHADES = ['bg-blue', 'bg-blue/75', 'bg-blue/55', 'bg-blue/40', 'bg-blue/30', 'bg-blue/20'];

/** One thin stacked bar of damage share by class, with the biggest classes named underneath. */
export function ClassBar({ v }: { v: ResultView }) {
  const rows = classShare(v.players);
  if (!rows.length) return null;
  return (
    <div>
      <div className="flex h-2 w-full gap-px overflow-hidden rounded bg-bg" role="img"
        aria-label={`Damage share by class: ${rows.slice(0, 4).map((r) => `${r.cls} ${r.pct.toFixed(0)}%`).join(', ')}`}>
        {rows.map((r, i) => (
          <div key={r.cls} className={SHADES[Math.min(i, SHADES.length - 1)]} style={{ width: `${r.pct}%` }} title={`${r.cls} ${r.pct.toFixed(1)}%`} />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-text">
        {rows.slice(0, 5).map((r) => <span key={r.cls}>{r.cls} {r.pct.toFixed(0)}%</span>)}
        {rows.length > 5 ? <span className="text-dim">+{rows.length - 5} more</span> : null}
      </div>
    </div>
  );
}

/** The full ranked list. Never truncated: it is the one panel that is meant to be a complete roll call. */
export function DamageTable({ v, linkNames }: { v: ResultView; linkNames?: boolean }) {
  const o = own(v);
  const top = v.players[0]?.damage || 1;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className={`border-b border-border text-left ${LABEL}`}>
            <th className="w-9 py-1 pl-3 pr-2 font-normal">#</th>
            <th className="py-1 pr-2 font-normal">Character</th>
            <th className="hidden py-1 pr-2 font-normal sm:table-cell">Class</th>
            <th className="py-1 pr-2 text-right font-normal">DPS</th>
            <th className="py-1 pr-2 text-right font-normal">Damage</th>
            <th className="py-1 pr-3 text-right font-normal">Share</th>
          </tr>
        </thead>
        <tbody>
          {v.players.map((p) => {
            const mine = o.has(p.name.toLowerCase());
            return (
              <tr key={p.name} className={`border-b border-border/50 ${mine ? 'bg-gold/10' : ''}`} aria-current={mine ? 'true' : undefined}>
                <td className={`border-l-4 py-1.5 pl-2 pr-2 ${mine ? 'border-gold font-bold text-gold' : 'border-transparent text-text'}`}>{p.rank}</td>
                <td className="py-1.5 pr-2">
                  <div className={`truncate ${mine ? 'font-bold text-gold' : 'text-text'}`}>
                    {linkNames ? <Link href={`/character/${encodeURIComponent(p.name)}`} className="hover:underline">{p.name}</Link> : p.name}
                  </div>
                  <div className="mt-0.5 h-0.5 rounded bg-bg"><div className={`h-full rounded ${mine ? 'bg-gold' : 'bg-blue/60'}`} style={{ width: `${(p.damage / top) * 100}%` }} /></div>
                </td>
                <td className="hidden py-1.5 pr-2 text-text sm:table-cell">{p.cls ?? ''}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-text">{fmtBig(p.dps)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-text">{fmtBig(p.damage)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-text">{p.pct.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DamagePanel({ v, linkNames }: { v: ResultView; linkNames?: boolean }) {
  return (
    <div className="space-y-3">
      <div className="px-3"><ClassBar v={v} /></div>
      <DamageTable v={v} linkNames={linkNames} />
    </div>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-3 py-2 text-sm text-text">{children}</p>;
const Row = ({ children }: { children: React.ReactNode }) => <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border/50 px-3 py-2 text-sm last:border-b-0">{children}</li>;

export function DeathsPanel({ v }: { v: ResultView }) {
  if (!v.deaths.length) return <Empty>Nobody died.</Empty>;
  const o = own(v);
  return (
    <ul>
      {v.deaths.map((d, i) => (
        <Row key={`${d.name}${i}`}>
          <span className={o.has(d.name.toLowerCase()) ? 'font-bold text-gold' : 'text-text'}>{d.name}</span>
          <span className="font-bold tabular-nums text-red">{fmtClock(d.atSec)}</span>
        </Row>
      ))}
    </ul>
  );
}

export function TankPanel({ v }: { v: ResultView }) {
  if (!v.tanks.length) return <Empty>No tank log was uploaded for this fight.</Empty>;
  return (
    <ul>
      {v.tanks.map((t) => (
        <Row key={t.name}>
          <span className="text-text">{t.name}</span>
          <span className="text-text">took <b>{fmtBig(t.taken)}</b> in {t.hits} hits · avoided <b>{t.avoided}</b></span>
        </Row>
      ))}
    </ul>
  );
}

export function HealPanel({ v }: { v: ResultView }) {
  if (!v.healers.length) return <Empty>No heal log was uploaded for this fight.</Empty>;
  const o = own(v);
  return (
    <ul>
      {v.healers.map((h) => (
        <Row key={h.name}>
          <span className={o.has(h.name.toLowerCase()) ? 'font-bold text-gold' : 'text-text'}>{h.name}</span>
          <span className="text-text"><b>{fmtBig(h.healed)}</b> healed · {h.ticks} heals</span>
        </Row>
      ))}
    </ul>
  );
}

export function TimelinePanel({ v }: { v: ResultView }) {
  if (!v.events.length) return <Empty>No events were recorded.</Empty>;
  return (
    <ul>
      {v.events.map((e, i) => (
        <Row key={i}>
          <span className="text-text">{e.label}</span>
          <span className="tabular-nums text-dim">{fmtClock(e.atSec)}</span>
        </Row>
      ))}
    </ul>
  );
}

export function LootPanel({ v }: { v: ResultView }) {
  if (!v.loot.length) return <Empty>No loot was recorded for this night.</Empty>;
  const o = own(v);
  return (
    <ul>
      {v.loot.map((l, i) => (
        <Row key={i}>
          <span className="text-text">{l.item}</span>
          <span className="text-text"><span className={o.has(l.who.toLowerCase()) ? 'font-bold text-gold' : ''}>{l.who}</span>{l.dkp != null ? <b className="ml-3 text-gold">{l.dkp} DKP</b> : null}</span>
        </Row>
      ))}
    </ul>
  );
}

export function ContributorsPanel({ v }: { v: ResultView }) {
  return (
    <ul>
      {v.contributors.map((c, i) => (
        <Row key={i}><span className="text-text">{c.name}</span><span className="text-text">{fmtBig(c.damage)}</span></Row>
      ))}
    </ul>
  );
}

export type PanelKey = 'damage' | 'deaths' | 'tank' | 'heal' | 'timeline' | 'loot' | 'contributors';

export const damageHeadline = (v: ResultView): string => {
  const o = own(v);
  const me = v.players.find((p) => o.has(p.name.toLowerCase()));
  const top = v.players[0];
  if (!top) return 'No damage rows';
  return `${top.name} first at ${fmtBig(top.dps)} DPS${me ? `, you #${me.rank}` : ''}`;
};

export const PANELS: { key: PanelKey; label: string; headline: (v: ResultView) => string; body: (v: ResultView, linkNames?: boolean) => React.ReactNode }[] = [
  { key: 'damage', label: 'Damage', headline: damageHeadline, body: (v, l) => <DamagePanel v={v} linkNames={l} /> },
  { key: 'deaths', label: 'Deaths', headline: headlines.deaths, body: (v) => <DeathsPanel v={v} /> },
  { key: 'tank', label: 'Tank', headline: headlines.tank, body: (v) => <TankPanel v={v} /> },
  { key: 'heal', label: 'Heal', headline: headlines.heal, body: (v) => <HealPanel v={v} /> },
  { key: 'timeline', label: 'Timeline', headline: headlines.timeline, body: (v) => <TimelinePanel v={v} /> },
  { key: 'loot', label: 'Loot', headline: headlines.loot, body: (v) => <LootPanel v={v} /> },
  { key: 'contributors', label: 'Contributors', headline: headlines.contributors, body: (v) => <ContributorsPanel v={v} /> },
];

/** A shut-by-default section: the label and a one-line headline stay visible, the detail opens on tap. */
export function Fold({ label, headline, open, children }: { label: string; headline: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group border-b border-border last:border-b-0">
      <summary className="flex min-h-[44px] cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <span className={`w-24 shrink-0 ${LABEL}`}>{label}</span>
        <span className="min-w-0 flex-1 text-sm text-text">{headline}</span>
        <span className="text-sm text-blue group-open:hidden" aria-hidden>Open</span>
        <span className="hidden text-sm text-blue group-open:inline" aria-hidden>Close</span>
      </summary>
      <div className="pb-2">{children}</div>
    </details>
  );
}
