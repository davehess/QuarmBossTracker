'use client';

// Interactive form row for the "Not in OpenDKP" table on /admin/links.
//
// Streamlined 2026-07-05 (Uilnayar): the old row forced the officer to pick a
// RACE before Register would enable — but /who never reports race, so that
// field was ALWAYS the red blocker. Now race defaults to Human (a correctable
// placeholder — "click add without making something up; fix it in OpenDKP or
// on /me later"), rank is two one-click buttons (the common Raid Alt / Trader
// split) instead of a dropdown, and there's an Ignore button for names that
// shouldn't be registered at all (a foreign guild's player the member's box
// tailed). Level + class stay editable, seeded from /who.

import { useState, useTransition } from 'react';
import { registerInOpenDKP, ignoreUnregistered } from './opendkp-actions';

// "UNKNOWN" sentinel for CLASS only — /who almost always gives us the class,
// so leaving it required in the rare no-/who case is a reasonable guard (a
// wrong class is more misleading than a wrong race, and OpenDKP rejects the
// sentinel anyway). Race no longer uses this — it defaults to Human.
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
  // Race defaults to Human when /who didn't give us one (it never does). We
  // flag it "assumed" until the officer touches it, so it's clearly a
  // placeholder rather than a claim.
  const [race,  setRace]  = useState<string>(observedRace || 'Human');
  const [raceAssumed, setRaceAssumed] = useState<boolean>(!observedRace);
  const [level, setLevel] = useState<number>(observedLevel || 60);
  const [dmOwner, setDmOwner] = useState<boolean>(true);
  const [busy,  startTransition] = useTransition();
  const [status, setStatus] = useState<'idle' | 'done' | 'ignored' | 'err'>('idle');
  const [doneRank, setDoneRank] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  const canDm = !!uploaderDiscordId;
  const classMissing = cls === UNKNOWN;

  function register(rankChoice: string) {
    setErr(null);
    setStatus('idle');
    startTransition(async () => {
      const res = await registerInOpenDKP({
        name, cls, race, level, rank: rankChoice,
        parentOpenDkpId:   parentOpenDkpId ?? null,
        parentName:        parentName ?? null,
        uploaderDiscordId: uploaderDiscordId ?? null,
        dmOwner:           canDm && dmOwner,
      });
      if (res.ok) { setDoneRank(rankChoice); setStatus('done'); }
      else { setStatus('err'); setErr(res.error || 'register failed'); }
    });
  }

  function ignore() {
    setErr(null);
    startTransition(async () => {
      const res = await ignoreUnregistered(name);
      if (res.ok) setStatus('ignored');
      else { setStatus('err'); setErr(res.error || 'ignore failed'); }
    });
  }

  if (status === 'ignored') {
    return (
      <span className="text-dim text-xs">
        ✓ Dismissed — {name} won&apos;t be suggested again. Restore it from the <b className="text-text">dismissed</b> view if that was a mistake. Row drops off on next refresh.
      </span>
    );
  }

  if (status === 'done') {
    const isLocalOnly = doneRank === 'Non-raid Alt' || doneRank === 'Trader';
    return (
      <span className="text-green text-xs">
        ✓ Queued as {cls} L{level} ({doneRank})
        {parentName ? <> · alt of {parentName}</> : null}.
        {isLocalOnly
          ? <> Linked on our side only — Traders stay off OpenDKP to keep the top-nav clean.</>
          : <> The bot registers it in OpenDKP within ~20s{canDm && dmOwner ? <> and DMs the owner a claim link</> : null}.</>}
        {' '}Row drops off on next refresh.
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px]">
      <select
        value={level}
        onChange={e => setLevel(parseInt(e.target.value, 10))}
        disabled={busy}
        className="bg-bg border border-border rounded px-1 py-0.5"
        title="Level — seeded from /who; adjust if it's stale."
      >
        {Array.from({ length: 65 }, (_, i) => i + 1).map(n =>
          <option key={n} value={n}>L{n}</option>
        )}
      </select>
      <select value={cls} onChange={e => setCls(e.target.value)} disabled={busy}
              className={`bg-bg border rounded px-1 py-0.5 ${classMissing ? 'border-red text-red' : 'border-border'}`}
              title={classMissing
                ? "OpenDKP needs a class and /who never saw this character — pick one before registering."
                : "Class — from /who; correct it if wrong."}>
        <option value={UNKNOWN}>— class? —</option>
        {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={race} onChange={e => { setRace(e.target.value); setRaceAssumed(false); }} disabled={busy}
              className={`bg-bg border rounded px-1 py-0.5 ${raceAssumed ? 'border-gold text-gold' : 'border-border'}`}
              title={raceAssumed
                ? "Race isn't in /who data, so we assumed Human — a harmless placeholder. Set it if you know it, or the owner can fix it on /me / in OpenDKP later."
                : "Race for the OpenDKP entry."}>
        {RACES.map(r => <option key={r} value={r}>{r}</option>)}
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
        <input type="checkbox" checked={canDm && dmOwner} disabled={!canDm || busy} onChange={e => setDmOwner(e.target.checked)} />
        DM
      </label>
      {/* Two common ranks as one-click register buttons (Uilnayar: "simple
          trader / raid alt button"). Raid Alt goes to OpenDKP; Trader stays
          local-only. Both blocked only when the class is genuinely unknown. */}
      <button type="button" onClick={() => register('Raid Alt')} disabled={busy || classMissing}
        title={classMissing ? 'Pick a class first.' : 'Register as a Raid Alt in OpenDKP (parented under the family root).'}
        className="px-2 py-0.5 rounded border border-green bg-green/15 text-green hover:bg-green/25 disabled:opacity-40 disabled:cursor-not-allowed">
        {busy ? '…' : '+ Raid Alt'}
      </button>
      <button type="button" onClick={() => register('Trader')} disabled={busy || classMissing}
        title={classMissing ? 'Pick a class first.' : "Register as a Trader — kept off OpenDKP's top-nav, just linked on our side."}
        className="px-2 py-0.5 rounded border border-border bg-bg text-text hover:border-blue disabled:opacity-40 disabled:cursor-not-allowed">
        + Trader
      </button>
      <button type="button" onClick={ignore} disabled={busy}
        title="Not ours — dismiss this name so it stops being suggested (a foreign guild's player, an operator/junk stream). Restorable from the dismissed view."
        className="px-2 py-0.5 rounded border border-border text-dim hover:border-red hover:text-red disabled:opacity-40 disabled:cursor-not-allowed">
        Ignore
      </button>
      {status === 'err' && err && <span className="text-red text-[10px] ml-1">⚠ {err}</span>}
    </div>
  );
}
