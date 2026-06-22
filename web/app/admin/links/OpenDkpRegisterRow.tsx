'use client';

// Interactive form row for the "Not in OpenDKP" table on /admin/links.
// Replaces the static `/register name:X class:Y` command snippet with
// editable dropdowns (level / class / race / rank) + a single Register
// button that POSTs to the bot's /api/admin/opendkp-register endpoint
// via the registerInOpenDKP server action. The bot path wraps
// utils/opendkp.createCharacter — same call the /register Discord
// command already makes; this just removes the Discord-paste step
// (Uilnayar 2026-06-21).

import { useState, useTransition } from 'react';
import { registerInOpenDKP } from './opendkp-actions';

// "UNKNOWN" sentinel — when we have no /who-observed class or race for the
// character, default to this instead of guessing Warrior/Iksar. Officer has
// to pick a real value before the Register button enables, so a one-click
// register doesn't silently misregister someone (Uilnayar 2026-06-22).
const UNKNOWN = 'UNKNOWN';

const CLASSES = [
  'Bard', 'Beastlord', 'Cleric', 'Druid', 'Enchanter', 'Magician',
  'Monk', 'Necromancer', 'Paladin', 'Ranger', 'Rogue', 'Shadow Knight',
  'Shaman', 'Warrior', 'Wizard',
];
const RACES = [
  'Barbarian', 'Dark Elf', 'Dwarf', 'Erudite', 'Gnome', 'Half Elf',
  'Halfling', 'High Elf', 'Human', 'Iksar', 'Ogre', 'Troll',
  'Vah Shir', 'Wood Elf',
];
// Order mirrors OpenDKP's rank list. Raid Alt has a level floor of 46 —
// auto-defaulted from the row's observed level but always overridable.
const RANKS = ['Raid Pack', 'Raid Recruit', 'Raid Alt', 'Non-raid Alt', 'Trader'];

function defaultRank(level: number | null): string {
  if (level == null) return 'Non-raid Alt';
  return level >= 46 ? 'Raid Alt' : 'Non-raid Alt';
}

export default function OpenDkpRegisterRow({
  name,
  observedClass,
  observedLevel,
  observedRace,
  parentName,
  parentOpenDkpId,
  uploaderDiscordId,
}: {
  name:              string;
  observedClass:     string | null;
  observedLevel:     number | null;
  observedRace:      string | null;
  parentName:        string | null;
  parentOpenDkpId:   number | null;
  uploaderDiscordId: string | null;
}) {
  const [cls,   setCls]   = useState<string>(observedClass || UNKNOWN);
  const [race,  setRace]  = useState<string>(observedRace  || UNKNOWN);
  const [level, setLevel] = useState<number>(observedLevel || 60);
  const [rank,  setRank]  = useState<string>(defaultRank(observedLevel));
  // DM the owner a claim link once the bot registers it — on by default, but
  // only meaningful when we know who the owner is (uploaderDiscordId set).
  const [dmOwner, setDmOwner] = useState<boolean>(true);
  const [busy,  startTransition] = useTransition();
  const [status, setStatus] = useState<'idle' | 'done' | 'err'>('idle');
  const [err, setErr] = useState<string | null>(null);

  const canDm = !!uploaderDiscordId;

  function submit() {
    setErr(null);
    setStatus('idle');
    startTransition(async () => {
      const res = await registerInOpenDKP({
        name, cls, race, level, rank,
        parentOpenDkpId:   parentOpenDkpId ?? null,
        parentName:        parentName ?? null,
        uploaderDiscordId: uploaderDiscordId ?? null,
        dmOwner:           canDm && dmOwner,
      });
      if (res.ok) setStatus('done');
      else { setStatus('err'); setErr(res.error || 'register failed'); }
    });
  }

  // Non-raid Alt / Trader rows stay OFF the OpenDKP roster — they only get a
  // local family link in our characters table (Uilnayar 2026-06-23: those
  // ranks clutter the OpenDKP top-nav with bank/mule characters).
  const isLocalOnly = rank === 'Non-raid Alt' || rank === 'Trader';

  if (status === 'done') {
    return (
      <span className="text-green text-xs">
        ✓ Queued as {cls} L{level} ({rank})
        {parentName ? <> · alt of {parentName}</> : null}.
        {isLocalOnly
          ? <> The bot will link this on our side only — Non-raid Alts and Traders stay off OpenDKP to keep the top-nav clean.</>
          : <> The bot registers it in OpenDKP within ~20s{canDm && dmOwner ? <> and DMs the owner a claim link</> : null}.</>}
        {' '}Row drops off on next refresh.
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px]">
      <select
        value={level}
        onChange={e => {
          const v = parseInt(e.target.value, 10);
          setLevel(v);
          // Auto-update rank if the officer hasn't deviated from the
          // level-derived default (a 46+ Raid Alt becomes Non-raid Alt
          // if they bump the level down below 46).
          if (rank === defaultRank(level)) setRank(defaultRank(v));
        }}
        disabled={busy}
        className="bg-bg border border-border rounded px-1 py-0.5"
      >
        {Array.from({ length: 65 }, (_, i) => i + 1).map(n =>
          <option key={n} value={n}>L{n}</option>
        )}
      </select>
      <select value={cls} onChange={e => setCls(e.target.value)} disabled={busy}
              className={`bg-bg border rounded px-1 py-0.5 ${cls === UNKNOWN ? 'border-red text-red' : 'border-border'}`}
              title="OpenDKP requires a class. Defaulted to /who observation if available; otherwise UNKNOWN — pick one before registering.">
        <option value={UNKNOWN}>— class? —</option>
        {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={race} onChange={e => setRace(e.target.value)} disabled={busy}
              className={`bg-bg border rounded px-1 py-0.5 ${race === UNKNOWN ? 'border-red text-red' : 'border-border'}`}
              title="OpenDKP requires a race. Defaulted to /who observation if available; otherwise UNKNOWN — pick one before registering.">
        <option value={UNKNOWN}>— race? —</option>
        {RACES.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      <select value={rank} onChange={e => setRank(e.target.value)} disabled={busy}
              className="bg-bg border border-border rounded px-1 py-0.5">
        {RANKS.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      <span className={parentName ? 'text-dim' : 'text-orange'}
        title={parentName
          ? `OpenDKP family root for this Mimic's uploads — new character will land as one of ${parentName}'s alts.`
          : "Couldn't resolve a family root for this uploader's Discord ID. The character will land as its own self-rooted main in OpenDKP — you can re-parent it via the family-link section after."}>
        {parentName ? <>→ alt of <span className="text-text">{parentName}</span></> : 'no parent found'}
      </span>
      <label
        className={`flex items-center gap-1 ${canDm ? 'text-dim cursor-pointer' : 'text-dim/40 cursor-not-allowed'}`}
        title={canDm
          ? "DM the character's owner a claim link in Discord once the bot registers it (batched if you register several at once)."
          : "We don't have a Discord ID for this uploader, so there's nobody to DM. Link their Discord first if you want the claim nudge."}>
        <input
          type="checkbox"
          checked={canDm && dmOwner}
          disabled={!canDm || busy}
          onChange={e => setDmOwner(e.target.checked)}
        />
        DM
      </label>
      <button
        type="button"
        onClick={submit}
        disabled={busy || cls === UNKNOWN || race === UNKNOWN}
        title={cls === UNKNOWN || race === UNKNOWN
          ? 'Pick a class and race before registering — OpenDKP rejects UNKNOWN.'
          : 'Queue this character for OpenDKP registration (the bot processes it within ~20s)'}
        className="px-2 py-0.5 rounded border border-blue bg-[#1f6feb] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? '...' : 'Register'}
      </button>
      {status === 'err' && err && <span className="text-red text-[10px] ml-1">⚠ {err}</span>}
    </div>
  );
}
