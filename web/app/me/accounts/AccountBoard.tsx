'use client';

// The drag-and-drop board for /me/accounts: an "Unplaced" column and ten account cards. A character chip can be
// dragged onto a card (HTML5 drag and drop), and every chip also has a "Move to..." select so a phone or a
// keyboard can do the same job. The server enforces the rules (8 per account, ownership); the board only
// checks "is it full" first so a drop on a full card answers at once without a round trip.

import { useRef, useState, useTransition } from 'react';
import { moveCharacter, renameAccount } from './actions';
import { MAX_PER_ACCOUNT, accountName, type GameAccountsState, type PlacedChar } from '@/lib/gameAccounts';
import { classAbbr, classColor } from '@/lib/spectator';

// UTC so the server render and the browser agree on the day.
const fmtDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';

export default function AccountBoard({ initial }: { initial: GameAccountsState }) {
  const [state, setState] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [over, setOver] = useState<number | 'unplaced' | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  const apply = (r: { ok: boolean; error?: string; state?: GameAccountsState }) => {
    if (r.ok && r.state) { setState(r.state); setMsg(null); } else setMsg(r.error ?? 'could not save');
  };

  const move = (name: string, slot: number | null) => {
    const target = slot == null ? null : state.accounts.find(a => a.slot === slot);
    if (target && !target.members.some(m => m.name === name) && target.members.length >= MAX_PER_ACCOUNT) {
      setMsg(`${accountName(target.slot, target.label)} is full (${MAX_PER_ACCOUNT} characters)`);
      return;
    }
    startTransition(async () => apply(await moveCharacter(name, slot)));
  };

  // Enter blurs the box and the blur saves; Escape marks the edit cancelled first so its blur saves nothing.
  const cancelled = useRef(false);
  const saveName = (slot: number) => {
    setEditing(null);
    if (cancelled.current) { cancelled.current = false; return; }
    const label = draft;
    startTransition(async () => apply(await renameAccount(slot, label)));
  };

  const drop = (e: React.DragEvent, slot: number | null) => {
    e.preventDefault();
    setOver(null);
    const name = e.dataTransfer.getData('text/plain');
    if (name) move(name, slot);
  };
  const dropProps = (key: number | 'unplaced', slot: number | null) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(key); },
    onDragLeave: () => setOver(o => (o === key ? null : o)),
    onDrop: (e: React.DragEvent) => drop(e, slot),
  });

  // A function, not a component: a component declared in here is a new type every render, which would
  // remount the chip (and drop the select's focus) on each state change.
  const chip = (c: PlacedChar, at: number | null) => (
    <li
      key={c.name}
      draggable
      onDragStart={e => { e.dataTransfer.setData('text/plain', c.name); e.dataTransfer.effectAllowed = 'move'; }}
      className="cursor-grab rounded border border-border bg-bg px-2 py-1.5 text-xs active:cursor-grabbing"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: classColor(c.cls) }}
        />
        <span className="min-w-0 flex-1 truncate text-text">{c.name}</span>
        <span className="shrink-0 text-dim">{c.cls ? classAbbr(c.cls) : ''}</span>
        <select
          aria-label={`Move ${c.name} to`}
          value=""
          disabled={pending}
          onChange={e => {
            const v = e.target.value;
            if (v) move(c.name, v === 'unplaced' ? null : Number(v));
          }}
          className="max-w-[7.5rem] rounded border border-border bg-panel px-1 py-0.5 text-xs text-dim"
        >
          <option value="">Move to…</option>
          {at != null && <option value="unplaced">Unplaced</option>}
          {state.accounts.map(a => {
            const full = a.members.length >= MAX_PER_ACCOUNT && a.slot !== at;
            return a.slot === at ? null : (
              <option key={a.slot} value={a.slot} disabled={full}>
                {accountName(a.slot, a.label)} ({a.members.length}/{MAX_PER_ACCOUNT}{full ? ', full' : ''})
              </option>
            );
          })}
        </select>
      </div>
      {c.movedFrom && (
        <div className="mt-1 pl-4 text-dim">
          {at == null ? 'left' : 'moved from'} {c.movedFrom} on {fmtDay(c.movedAt)}
        </div>
      )}
    </li>
  );

  const ring = (key: number | 'unplaced') => (over === key ? 'border-blue bg-blue/10' : 'border-border');

  return (
    <div className="space-y-4">
      <div role="status" aria-live="polite" className="min-h-[1.25rem] text-xs text-orange">{msg}</div>
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <section
          aria-label="Unplaced characters"
          {...dropProps('unplaced', null)}
          className={`h-fit rounded-lg border bg-panel p-3 ${ring('unplaced')}`}
        >
          <h2 className="mb-2 flex items-baseline justify-between text-sm text-gold">
            <span>Unplaced</span><span className="text-xs text-dim">{state.unplaced.length}</span>
          </h2>
          {state.unplaced.length === 0
            ? <p className="text-xs text-dim">Every character is on an account.</p>
            : <ul className="space-y-1.5">{state.unplaced.map(c => chip(c, null))}</ul>}
        </section>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {state.accounts.map(a => {
            const full = a.members.length >= MAX_PER_ACCOUNT;
            return (
              <section
                key={a.slot}
                aria-label={accountName(a.slot, a.label)}
                {...dropProps(a.slot, a.slot)}
                className={`rounded-lg border bg-panel p-3 ${ring(a.slot)}`}
              >
                <h2 className="mb-2 flex items-center justify-between gap-2 text-sm">
                  {editing === a.slot ? (
                    <input
                      autoFocus value={draft} maxLength={40} aria-label={`Name for account ${a.slot}`}
                      onChange={e => setDraft(e.target.value)}
                      onBlur={() => saveName(a.slot)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur(); }
                      }}
                      placeholder={`Account ${a.slot}`}
                      className="min-w-0 flex-1 rounded border border-border bg-bg px-1.5 py-0.5 text-sm text-text"
                    />
                  ) : (
                    <button
                      type="button" title="Rename this account"
                      onClick={() => { setDraft(a.label ?? ''); setEditing(a.slot); }}
                      className="min-w-0 truncate text-left text-gold hover:underline"
                    >
                      {accountName(a.slot, a.label)}
                    </button>
                  )}
                  <span className={`shrink-0 text-xs ${full ? 'text-orange' : 'text-dim'}`}>
                    {a.members.length}/{MAX_PER_ACCOUNT}
                  </span>
                </h2>
                {a.members.length === 0
                  ? <p className="rounded border border-dashed border-border px-2 py-3 text-center text-xs text-dim">Drop a character here</p>
                  : <ul className="space-y-1.5">{a.members.map(c => chip(c, a.slot))}</ul>}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
