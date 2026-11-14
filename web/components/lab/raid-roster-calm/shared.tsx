'use client';
import { useState } from 'react';
import { hpTone, type CalmAlert, type CalmRaider, type CalmView, type HpTone } from '@/lib/raidRosterCalmView';

// Pieces the three Raid HQ versions share: the one-line header, the red alert strip, a raider's detail.
export type RenderDetail = (r: CalmRaider) => React.ReactNode;

const ABBR: Record<string, string> = {
  warrior: 'WAR', cleric: 'CLR', paladin: 'PAL', ranger: 'RNG', 'shadow knight': 'SHD', druid: 'DRU', monk: 'MNK',
  bard: 'BRD', rogue: 'ROG', shaman: 'SHM', necromancer: 'NEC', wizard: 'WIZ', magician: 'MAG', enchanter: 'ENC',
  beastlord: 'BST',
};
export const classAbbr = (c: string | null) => (c ? ABBR[c.toLowerCase()] ?? c.slice(0, 3).toUpperCase() : '?');

export const HP_TEXT: Record<HpTone, string> = {
  dead: 'text-red', crit: 'text-red', hurt: 'text-orange', ok: 'text-text', none: 'text-dim',
};
export const hpLabel = (r: CalmRaider) => (r.dead ? 'dead' : r.hp == null ? '--' : r.hp + '%');

const INVITE_TEXT = { green: 'text-green', blue: 'text-blue', orange: 'text-orange' } as const;

/** Leader, Mimic count (opens to who is NOT on Mimic), invite status. One thin line. */
export function HeaderLine({ view, fullViewHref }: { view: CalmView; fullViewHref?: string }) {
  const [open, setOpen] = useState(false);
  const off = view.mimic.total - view.mimic.on;
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border border-border bg-panel px-3 py-2 text-sm">
        <span>
          <span className="text-dim">Leader </span>
          <b className="text-gold">{view.leader ?? 'none yet'}</b>
        </span>
        <button
          type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
          className="text-blue hover:underline"
        >
          Mimic {view.mimic.on} of {view.mimic.total}{off > 0 ? (open ? ' (hide)' : ' (who is not)') : ''}
        </button>
        <span className={INVITE_TEXT[view.invite.tone]}>{view.invite.text}</span>
        {fullViewHref ? <a href={fullViewHref} className="ml-auto text-blue hover:underline">Full view</a> : null}
      </div>
      {open && off > 0 ? (
        <div className="mt-1 rounded-lg border border-border bg-panel px-3 py-2 text-sm">
          <span className="text-dim">Not on Mimic ({off}): </span>
          <span className="text-text">{view.notOnMimic.join(', ')}</span>
        </div>
      ) : null}
    </div>
  );
}

const ALERT_LABEL = { curse: 'Cursed', dead: 'Dead', mana: 'Out of mana' } as const;

/** Appears ONLY when something needs a person now. Healthy raid: renders nothing. */
export function AlertStrip({ alerts, onPick }: { alerts: CalmAlert[]; onPick?: (who: string) => void }) {
  if (alerts.length === 0) return null;
  return (
    <div role="alert" className="rounded-lg border-2 border-red bg-red/15 px-3 py-2">
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-base font-bold text-red">
        {alerts.map((a) => (
          <li key={a.kind + a.who}>
            {ALERT_LABEL[a.kind]}{' '}
            <button type="button" onClick={() => onPick?.(a.who)} className="underline decoration-red/60 underline-offset-2">{a.who}</button>
            {a.kind === 'dead' ? '' : <span className="font-normal"> {a.what}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Detail for the lab, where there is no live page behind it. The real page passes its own. */
export function DefaultDetail({ r }: { r: CalmRaider }) {
  const tone = hpTone(r.hp);
  return (
    <div className="space-y-1 border-t border-border bg-bg/60 px-3 py-2 text-sm">
      <div>
        <b className="text-text">{r.name}</b> <span className="text-text">{r.cls ?? 'Unknown'}</span>{' '}
        <b className={HP_TEXT[tone]}>{hpLabel(r)}</b>
        {r.mana != null ? <span className="text-text"> · mana {r.mana}%</span> : null}
      </div>
      {!r.live ? <div className="text-text">Not on Mimic: no buff or HP data.</div> : null}
      {r.curse ? <div className="text-red">Cursed: {r.curse}</div> : null}
      {r.gaps.length > 0 ? <div className="text-orange">Missing: {r.gaps.join(', ')}</div> : null}
      {r.live && !r.curse && r.gaps.length === 0 ? <div className="text-green">Fully buffed</div> : null}
      <div className="text-text">/target {r.name}</div>
    </div>
  );
}

export const detailFor = (render: RenderDetail | undefined, r: CalmRaider) => (render ? render(r) : <DefaultDetail r={r} />);
