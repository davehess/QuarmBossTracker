'use client';

// The "Delete my account" control: closed until asked for, then a plain-words list of what goes and what stays, and a
// typed confirm. The button stays off until the box says DELETE; the server action checks it again and checks who is
// signed in (the page proves nothing to a POST).

import { useState, useTransition } from 'react';
import { deleteMyAccount } from './actions';

const WORD = 'DELETE';   // the same word as DELETE_WORD in lib/selfData.ts; the server holds the real check

export default function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ unfinished: number } | null>(null);

  if (done) {
    return (
      <div role="status" className="rounded border border-green/40 bg-bg p-3 text-sm text-text">
        <p>Your account is deleted and you are signed out.</p>
        {done.unfinished > 0 && (
          <p className="mt-2 text-xs text-dim">
            Part of the guild&rsquo;s raid records could not be unlinked from your Discord account just now. An officer
            has been left a note to finish it.
          </p>
        )}
        <p className="mt-2"><a href="/" className="inline-flex min-h-11 items-center text-blue hover:underline">Back to the start</a></p>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="min-h-11 rounded border border-red/50 px-4 text-sm text-red hover:bg-red/10">
        Delete my account&hellip;
      </button>
    );
  }

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await deleteMyAccount(typed);
          if (r.ok) setDone({ unfinished: r.unfinished }); else setError(r.message);
        });
      }}
      className="space-y-3 rounded border border-red/40 bg-bg p-3 text-sm"
    >
      <div>
        <h4 className="text-xs text-red">This cannot be undone</h4>
        <p className="mt-1 text-xs text-dim">Download your data first if you want a copy.</p>
      </div>
      <div>
        <h4 className="text-xs text-orange">Removed</h4>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-text marker:text-dim">
          <li>Your tells, your characters&rsquo; live state, and your Mimic sign-ins (running installs stop working).</li>
          <li>Your UI backups, personal triggers and shared UI sets.</li>
          <li>Your feedback and replies, votes, page views, and your onboarding and settings.</li>
          <li>Your characters&rsquo; inventory, spellbook, keys, quest settings and game-account labels.</li>
          <li>The link between your Discord account and your characters. The characters stay on the roster.</li>
          <li>Your website sign-in.</li>
        </ul>
      </div>
      <div>
        <h4 className="text-xs text-orange">Stays</h4>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-text marker:text-dim">
          <li>The guild&rsquo;s raid records: parses, attendance, loot and DKP, raid sign-ups and the chat the guild relayed. They
            belong to the guild. They are unlinked from your Discord account, but your character names stay on them. An
            officer can remove them if you ask.</li>
          <li>What officers did. If you are an officer, your entries in the audit log stay.</li>
          <li>Your nickname and roles from the Discord server, which the bot mirrors for as long as you are in the server.</li>
        </ul>
        <p className="mt-2 text-xs text-dim">If you own a guild on Raid Mimic, hand it to someone else or close it first.</p>
      </div>
      <label className="block text-xs text-dim">
        Type <span className="text-text">{WORD}</span> to confirm
        <input
          value={typed}
          onChange={e => setTyped(e.target.value)}
          autoComplete="off" autoCapitalize="characters" spellCheck={false}
          className="mt-1 block min-h-11 w-full max-w-xs rounded border border-border bg-panel px-3 text-sm text-text"
        />
      </label>
      {error && <p role="alert" className="text-xs text-red">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending || typed.trim() !== WORD}
          className="min-h-11 rounded border border-red/60 bg-red/10 px-4 text-sm text-red disabled:opacity-40">
          {pending ? 'Deleting…' : 'Delete my account for good'}
        </button>
        <button type="button" onClick={() => { setOpen(false); setTyped(''); setError(null); }} disabled={pending}
          className="min-h-11 rounded border border-border px-4 text-sm text-dim hover:text-text">
          Keep my account
        </button>
      </div>
    </form>
  );
}
