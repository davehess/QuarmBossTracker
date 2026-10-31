'use client';

// Try-on: for each slot a list of the pieces the owner already has that fit it, and the change in every stat for
// whatever is picked, against what is worn. The picks live in the URL (?try=Head:12345,Waist:6789) so a set can be
// shared; the maths runs here from the small payload the server passes (web/lib/gearSets.ts), nothing is fetched.
// The gear page decides WHO sees this (the character's owner only); the payload holds only items the owner owns.
import { useMemo, useState } from 'react';
import {
  capNote, deltaText, parseTry, placedWith, serializeTry, setDeltas, tryWarnings, type TryData,
} from '@/lib/gearSets';
import { STAT_KEYS, STAT_UNIT } from '@/lib/gearWeights';

const slotName = (s: string) => s.replace(/(\d)$/, ' $1');
const WHERE: Record<string, string> = { worn: 'worn', bag: 'bag', bank: 'bank' };

export default function TryOn({ data, initial }: { data: TryData; initial: string }) {
  const [sel, setSel] = useState<Record<string, number>>(() => parseTry(initial, data));
  const [copied, setCopied] = useState(false);

  const { deltas, warnings } = useMemo(() => {
    const { before, after } = placedWith(data, sel);
    const w = data.weights;
    const all = setDeltas(before, after, STAT_KEYS, data.caps);
    // the stats this class weighs lead; the rest follow, dimmer
    const rank = (k: (typeof all)[number]) => Math.abs(k.raw) * STAT_UNIT[k.key] * (w[k.key] ?? 0);
    all.sort((a, b) => rank(b) - rank(a));
    return { deltas: all, warnings: tryWarnings(data, sel) };
  }, [data, sel]);

  const write = (next: Record<string, number>) => {
    setSel(next);
    setCopied(false);
    try {
      const url = new URL(window.location.href);
      const q = serializeTry(next, data);
      if (q) url.searchParams.set('try', q); else url.searchParams.delete('try');
      window.history.replaceState(null, '', url);
    } catch { /* the address bar is a convenience: the page works without it */ }
  };
  const pick = (slot: string, value: string) => {
    const next = { ...sel };
    if (value === '') delete next[slot]; else next[slot] = Number(value);
    write(next);
  };
  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch { /* clipboard blocked: the link is already in the address bar */ }
  };

  if (data.slots.length === 0) {
    return <p className="text-xs text-dim">Try-on: you have no spare pieces that fit any slot.</p>;
  }
  const picked = Object.keys(sel).length;

  return (
    <div className="border-t border-border pt-3 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 className="text-sm text-text font-bold">Try on</h4>
        <p className="text-[11px] text-dim">Swap a slot for something you own and see what changes. The link keeps your picks.</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.slots.map(s => {
          const id = `try-${s.slot}`;
          const worn = s.wornId != null ? data.items[s.wornId] : null;
          return (
            <div key={s.slot} className="min-w-0">
              <label htmlFor={id} className="block text-[11px] text-dim mb-0.5 break-words">
                {slotName(s.slot)}{worn ? <> · wearing <span className="text-text">{worn.name}</span></> : ' · empty'}
              </label>
              <select
                id={id}
                value={sel[s.slot] != null ? String(sel[s.slot]) : ''}
                onChange={e => pick(s.slot, e.target.value)}
                className="w-full min-w-0 bg-bg border border-border rounded px-2 py-1.5 text-base text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue"
              >
                <option value="">{worn ? 'Keep worn' : 'Leave empty'}</option>
                {s.options.map(oid => {
                  const it = data.items[oid];
                  return <option key={oid} value={oid}>{it.name} ({WHERE[it.where]})</option>;
                })}
              </select>
            </div>
          );
        })}
      </div>

      <div aria-live="polite" className="space-y-2">
        {picked === 0 ? (
          <p className="text-xs text-dim">Pick a piece above to see the change against what you wear.</p>
        ) : deltas.length === 0 ? (
          <p className="text-xs text-dim">No change in any stat.</p>
        ) : (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {deltas.map(d => {
              const weighed = (data.weights[d.key] ?? 0) > 0;
              const tone = d.raw > 0 ? 'text-green' : 'text-red';
              return (
                <li key={d.key} className={`${tone} ${weighed ? '' : 'opacity-70'}`}>{deltaText(d)}</li>
              );
            })}
          </ul>
        )}
        {deltas.map(capNote).filter((x): x is string => !!x).map(t => (
          <p key={t} className="text-xs text-orange break-words">{t}</p>
        ))}
        {warnings.map(t => <p key={t} className="text-xs text-red break-words">{t}</p>)}
      </div>

      {picked > 0 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={share}
            className="text-xs border border-border rounded px-3 py-2 text-blue hover:border-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue">
            {copied ? 'Link copied' : 'Copy link to this set'}
          </button>
          <button type="button" onClick={() => write({})}
            className="text-xs border border-border rounded px-3 py-2 text-dim hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue">
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
