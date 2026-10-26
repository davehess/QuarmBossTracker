'use client';

// The wishlist controls under one upgrade on /me/upgrades: "Add to wishlist" (priority + optional sealed
// pre-bid), then "on your wishlist" with Set / Change pre-bid and Remove. Optimistic: the row changes the moment
// you press Save and rolls back with the reason if the bot refuses. Nothing here sees any bid but the signed-in
// member's own, which the bot decrypts for them (the same view /mywishlist gives in Discord).
import { useId, useState, useTransition } from 'react';
import { addToWishlist, removeFromWishlist, setPreBid } from './actions';
import { BID_MAX, BID_MIN, PRIORITY_DEFAULT, PRIORITY_MAX, PRIORITY_MIN, bidFromField, parseBid } from '@/lib/wishlistRules';

type Props = {
  character: string;
  itemId: number;
  listed: boolean;
  priority: number | null;
  /** The member's own pre-bid in whole DKP, null for none. */
  bid: number | null;
  /** False when the bot could not be asked for the bid: show nothing about it rather than "none". */
  bidKnown: boolean;
  /** False while the site cannot reach the bot: the controls stay out of the way. */
  enabled: boolean;
};

const BTN = 'px-3 py-2 sm:py-1 text-xs rounded border border-border bg-bg text-blue hover:underline disabled:opacity-50';
const FIELD = 'bg-bg border border-border rounded px-2 py-1.5 sm:py-1 text-text text-xs';

export default function WishlistControls(p: Props) {
  const id = useId();
  const [listed, setListed] = useState(p.listed);
  const [priority, setPriority] = useState<number | null>(p.priority);
  const [bid, setBid] = useState<number | null>(p.bid);
  const [bidKnown, setBidKnown] = useState(p.bidKnown);
  const [mode, setMode] = useState<'idle' | 'add' | 'bid' | 'remove'>('idle');
  const [prioField, setPrioField] = useState(String(PRIORITY_DEFAULT));
  const [bidField, setBidField] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const badge = listed && (
    <span className="text-[10px] tracking-wide uppercase px-1.5 py-0.5 rounded bg-gold/15 border border-gold/50 text-gold">
      on your wishlist{priority != null ? ` · priority ${priority}` : ''}
    </span>
  );
  if (!p.enabled) return badge ? <div className="mt-2">{badge}</div> : null;

  /** Run an action with the screen already showing its result; put the old screen back, with the reason, if it fails. */
  const run = (apply: () => void, undo: () => void, act: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    apply();
    start(async () => {
      const r = await act();
      if (!r.ok) { undo(); setError(r.error); }
    });
  };

  /** Save the form: the new pre-bid is what the field holds, or `forced` (null clears it). */
  const save = (forced?: null) => {
    const parsed = parseBid(forced === null ? null : bidFromField(bidField));
    if (!parsed.ok) { setError(parsed.error); return; }
    const newBid = parsed.value;
    if (mode === 'add') {
      const pr = Number(prioField);
      run(
        () => { setListed(true); setPriority(pr); setBid(newBid); setBidKnown(true); setMode('idle'); },
        () => { setListed(false); setPriority(p.priority); setBid(p.bid); setBidKnown(p.bidKnown); },
        () => addToWishlist(p.character, p.itemId, pr, newBid),
      );
    } else {
      const before = { bid, bidKnown };
      run(
        () => { setBid(newBid); setBidKnown(true); setMode('idle'); },
        () => { setBid(before.bid); setBidKnown(before.bidKnown); },
        () => setPreBid(p.character, p.itemId, newBid),
      );
    }
  };

  const remove = () => {
    const before = { priority, bid, bidKnown };
    run(
      () => { setListed(false); setMode('idle'); },
      () => { setListed(true); setPriority(before.priority); setBid(before.bid); setBidKnown(before.bidKnown); },
      () => removeFromWishlist(p.character, p.itemId),
    );
  };

  const openBid = () => { setError(null); setBidField(bid != null ? String(bid) : ''); setMode('bid'); };
  const openAdd = () => { setError(null); setPrioField(String(PRIORITY_DEFAULT)); setBidField(''); setMode('add'); };

  return (
    <div className="mt-2 space-y-2" aria-busy={pending}>
      {listed ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          {badge}
          {bidKnown && (
            <span className="text-[11px] text-dim">
              {bid != null ? <>pre-bid <b className="text-gold">{bid.toLocaleString('en-US')}</b> DKP</> : 'no pre-bid, the bot bids 1 DKP'}
            </span>
          )}
          {mode === 'idle' && (
            <>
              <button type="button" className={BTN} onClick={openBid} disabled={pending}>{bid != null ? 'Change pre-bid' : 'Set pre-bid'}</button>
              <button type="button" className={BTN} onClick={() => setMode('remove')} disabled={pending}>Remove</button>
            </>
          )}
          {mode === 'remove' && (
            <span className="flex items-center gap-2 text-xs">
              <span className="text-dim">Take it off your wishlist?</span>
              <button type="button" className={BTN} onClick={remove} disabled={pending}>Yes, remove</button>
              <button type="button" className={BTN} onClick={() => setMode('idle')}>Keep</button>
            </span>
          )}
        </div>
      ) : mode === 'idle' ? (
        <button type="button" className={BTN} onClick={openAdd} disabled={pending}>Add to wishlist</button>
      ) : null}

      {(mode === 'add' || mode === 'bid') && (
        <form
          className="rounded border border-border bg-panel p-2 space-y-2"
          onSubmit={e => { e.preventDefault(); save(); }}
        >
          <div className="flex flex-wrap items-end gap-3">
            {mode === 'add' && (
              <div>
                <label htmlFor={`${id}-prio`} className="block text-[11px] text-dim mb-0.5">Priority</label>
                <select id={`${id}-prio`} className={FIELD} value={prioField} onChange={e => setPrioField(e.target.value)}>
                  {Array.from({ length: PRIORITY_MAX - PRIORITY_MIN + 1 }, (_, i) => PRIORITY_MIN + i).map(n => (
                    <option key={n} value={n}>
                      {n}{n === PRIORITY_MIN ? ' · top BIS' : n === PRIORITY_MAX ? ' · nice to have' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor={`${id}-bid`} className="block text-[11px] text-dim mb-0.5">Pre-bid (DKP, optional)</label>
              <input
                id={`${id}-bid`} className={`${FIELD} w-32`} type="text" inputMode="numeric" autoComplete="off"
                placeholder={`${BID_MIN}–${BID_MAX}`} value={bidField} onChange={e => setBidField(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" className={BTN} disabled={pending}>Save</button>
              {mode === 'bid' && bid != null && (
                <button type="button" className={BTN} disabled={pending} onClick={() => save(null)}>Clear pre-bid</button>
              )}
              <button type="button" className={BTN} onClick={() => { setMode('idle'); setError(null); }}>Cancel</button>
            </div>
          </div>
          <p className="text-[11px] text-dim leading-4">
            Sealed: only you can see it. If it drops the bot bids exactly this, no escalation. Blank means 1 DKP.
          </p>
        </form>
      )}

      {error && <p role="alert" className="text-xs text-red">{error}</p>}
    </div>
  );
}
