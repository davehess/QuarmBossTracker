'use client';

// "Add to wishlist" for one item, wherever the item shows: the item page, the raid plan's loot lists, the gear
// upgrades, and /me/wishlist (its list and its search). The member picks which of THEIR characters it is for (a
// picker appears only when they have several), then Add (priority + optional sealed pre-bid), then "on the list"
// with Set / Change pre-bid and Remove. Optimistic: the row changes the moment you press Save and rolls back with
// the reason if the bot refuses. Nothing here sees any bid but the signed-in member's own, which the bot decrypts
// for them (the same view /mywishlist gives in Discord).
//
// ONE write path: the three server actions in app/me/upgrades/actions.ts, which prove the member owns the
// character and hand the request to the bot (lib/wishlistBot.ts). This file never fetches anything itself.
// Pages render it only for a signed-in member who owns at least one character (lib/wishlistLoad.ts).
import { useId, useState, useTransition } from 'react';
import { addToWishlist, removeFromWishlist, setPreBid } from '@/app/me/upgrades/actions';
import { BID_MAX, BID_MIN, PRIORITY_DEFAULT, PRIORITY_MAX, PRIORITY_MIN, bidFromField, parseBid } from '@/lib/wishlistRules';
import { pickDefaultCharacter, pickerLabel, type WishState } from '@/lib/wishlistPick';

type Props = {
  itemId: number;
  /** For the aria labels only; the name on screen is the page's own. */
  itemName: string;
  /** The member's own characters, in the order to offer them (main first). One name means no picker. */
  characters: string[];
  /** The character the control starts on; one that is not in `characters` falls back to the first. */
  defaultCharacter: string | null;
  /** The characters that already have this item listed. A character with no entry does not. */
  states: Record<string, WishState>;
  /** False while the site cannot reach the bot: the controls stay out of the way and only say what is listed. */
  enabled: boolean;
  /** One small button that opens the control, for lists with many items (the raid plan's loot). */
  compact?: boolean;
};

const BTN = 'px-3 py-2 sm:py-1 text-xs rounded border border-border bg-bg text-blue hover:underline disabled:opacity-50';
const FIELD = 'bg-bg border border-border rounded px-2 py-1.5 sm:py-1 text-text text-xs';

export default function WishlistControls(p: Props) {
  const id = useId();
  const [char, setChar] = useState(() => pickDefaultCharacter(p.characters, p.defaultCharacter));
  const [states, setStates] = useState(p.states);
  const [open, setOpen] = useState(!p.compact);
  if (!char || p.characters.length === 0) return null;

  const many = p.characters.length > 1;
  /** Set (or with null clear) one character's entry; the row calls this for the optimistic change and for the rollback. */
  const put = (c: string, s: WishState | null) => setStates(prev => {
    const next = { ...prev };
    if (s) next[c] = s; else delete next[c];
    return next;
  });

  const listedOn = p.characters.filter(c => states[c]);
  const badgeText = (c: string) => `on ${many ? `${c}'s` : 'your'} wishlist${states[c]?.priority != null ? ` · priority ${states[c].priority}` : ''}`;
  const badgeClass = 'text-[10px] tracking-wide uppercase px-1.5 py-0.5 rounded bg-gold/15 border border-gold/50 text-gold';

  if (!p.enabled) {
    return listedOn.length > 0
      ? <div className="mt-2 flex flex-wrap gap-1.5">{listedOn.map(c => <span key={c} className={badgeClass}>{badgeText(c)}</span>)}</div>
      : null;
  }

  if (!open) {
    return (
      <button type="button" className={`${BTN} mt-1`} onClick={() => setOpen(true)} aria-label={`Wishlist: ${p.itemName}`}>
        {listedOn.length > 0 ? `On wishlist (${listedOn.length > 1 ? listedOn.length : listedOn[0]})` : 'Add to wishlist'}
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {many && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label htmlFor={`${id}-who`} className="text-dim">For</label>
          <select id={`${id}-who`} className={FIELD} value={char} onChange={e => setChar(e.target.value)}>
            {p.characters.map(c => <option key={c} value={c}>{pickerLabel(c, states)}</option>)}
          </select>
        </div>
      )}
      <Row
        key={char} character={char} itemId={p.itemId} itemName={p.itemName}
        state={states[char] ?? null} onState={s => put(char, s)} badge={badgeText(char)} badgeClass={badgeClass}
      />
    </div>
  );
}

/** One character's controls for the item: Add, or the list entry with its pre-bid and Remove. */
function Row(p: {
  character: string; itemId: number; itemName: string;
  state: WishState | null; onState: (s: WishState | null) => void;
  badge: string; badgeClass: string;
}) {
  const id = useId();
  const listed = !!p.state;
  const bid = p.state?.bid ?? null;
  const bidKnown = p.state?.bidKnown ?? true;
  const [mode, setMode] = useState<'idle' | 'add' | 'bid' | 'remove'>('idle');
  const [prioField, setPrioField] = useState(String(PRIORITY_DEFAULT));
  const [bidField, setBidField] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
    const before = p.state;
    if (mode === 'add') {
      const pr = Number(prioField);
      run(
        () => { p.onState({ priority: pr, bid: newBid, bidKnown: true }); setMode('idle'); },
        () => p.onState(before),
        () => addToWishlist(p.character, p.itemId, pr, newBid),
      );
    } else {
      run(
        () => { p.onState({ priority: before?.priority ?? null, bid: newBid, bidKnown: true }); setMode('idle'); },
        () => p.onState(before),
        () => setPreBid(p.character, p.itemId, newBid),
      );
    }
  };

  const remove = () => {
    const before = p.state;
    run(
      () => { p.onState(null); setMode('idle'); },
      () => p.onState(before),
      () => removeFromWishlist(p.character, p.itemId),
    );
  };

  const openBid = () => { setError(null); setBidField(bid != null ? String(bid) : ''); setMode('bid'); };
  const openAdd = () => { setError(null); setPrioField(String(PRIORITY_DEFAULT)); setBidField(''); setMode('add'); };

  return (
    <div className="space-y-2" aria-busy={pending}>
      {listed ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <span className={p.badgeClass}>{p.badge}</span>
          {bidKnown && (
            <span className="text-[11px] text-dim">
              {bid != null ? <>pre-bid <b className="text-gold">{bid.toLocaleString('en-US')}</b> DKP</> : 'no pre-bid, the bot bids 1 DKP'}
            </span>
          )}
          {mode === 'idle' && (
            <>
              <button type="button" className={BTN} onClick={openBid} disabled={pending}>
                {bid != null ? 'Change pre-bid' : bidKnown ? 'Set pre-bid' : 'Set or change pre-bid'}
              </button>
              <button type="button" className={BTN} onClick={() => setMode('remove')} disabled={pending}>Remove</button>
            </>
          )}
          {mode === 'remove' && (
            <span className="flex items-center gap-2 text-xs">
              <span className="text-dim">Take it off the wishlist?</span>
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
