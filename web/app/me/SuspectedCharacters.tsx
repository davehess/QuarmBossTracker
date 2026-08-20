'use client';

// "Characters we think are yours" — the member-facing claim list on /me.
// Rows come from characters that uploaded FROM YOUR MACHINE but aren't linked
// to anyone. You know what they are; an officer doesn't. See claim-actions.ts.

import { useState, useTransition } from 'react';
import { claimAsTrader, claimAsRaidAlt, dismissSuspected } from './claim-actions';
import { raidAltVerdict, RAID_ALT_MIN_LEVEL } from '@/lib/characterRoles';

const UNKNOWN = 'UNKNOWN';
const CLASSES = [
  'Bard', 'Beastlord', 'Cleric', 'Druid', 'Enchanter', 'Magician',
  'Monk', 'Necromancer', 'Paladin', 'Ranger', 'Rogue', 'Shadow Knight',
  'Shaman', 'Warrior', 'Wizard',
];

export type Suspect = {
  name: string;
  observedClass: string | null;
  observedLevel: number | null;
  lastUpload: string | null;
  invRows: number;
};

function Row({ s }: { s: Suspect }) {
  const [cls, setCls]     = useState<string>(s.observedClass || UNKNOWN);
  const [level, setLevel] = useState<number>(s.observedLevel || 60);
  const [busy, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr]   = useState<string | null>(null);
  const [showAlt, setShowAlt] = useState(false);

  const verdict = raidAltVerdict(level);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, label: string) {
    setErr(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) setDone(label);
      else setErr(res.error || 'failed');
    });
  }

  if (done) {
    return (
      <div className="py-2 text-xs text-green">
        ✓ <b className="text-text">{s.name}</b> — {done}. It moves into your characters on the next refresh.
      </div>
    );
  }

  return (
    <div className="py-2 border-t border-border/40 first:border-0">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-text font-semibold min-w-[7rem]">{s.name}</span>
        <span className="text-dim">
          {s.invRows > 0 ? `${s.invRows} inventory rows` : 'uploading from your machine'}
          {s.observedClass ? ` · ${s.observedClass}` : ''}
          {s.observedLevel ? ` · L${s.observedLevel}` : ''}
        </span>
        <span className="flex-1" />
        <button
          type="button" disabled={busy}
          onClick={() => run(() => claimAsTrader(s.name), 'filed as a Trader')}
          title="A bank mule, bazaar trader, or any character that never raids. No class or level needed — it links to you, shows up in your account inventory, and never goes to OpenDKP."
          className="px-2 py-0.5 rounded border border-blue/60 bg-blue/10 text-blue hover:bg-blue/20 disabled:opacity-40"
        >
          🏦 Trader
        </button>
        <button
          type="button" disabled={busy}
          onClick={() => setShowAlt(v => !v)}
          title="A character that actually raids with us — needs a class and level so it can go into OpenDKP."
          className="px-2 py-0.5 rounded border border-green/60 bg-green/10 text-green hover:bg-green/20 disabled:opacity-40"
        >
          ⚔️ Raid alt
        </button>
        <button
          type="button" disabled={busy}
          onClick={() => run(() => dismissSuspected(s.name), 'dismissed')}
          title="Not yours — someone else's character your box happened to tail. Stops being suggested."
          className="px-2 py-0.5 rounded border border-border text-dim hover:border-red hover:text-red disabled:opacity-40"
        >
          Not mine
        </button>
      </div>

      {showAlt && (
        <div className="flex flex-wrap items-center gap-2 mt-2 pl-2 text-[11px]">
          <select value={level} onChange={e => setLevel(parseInt(e.target.value, 10))} disabled={busy}
                  className="bg-bg border border-border rounded px-1 py-0.5">
            {Array.from({ length: 65 }, (_, i) => i + 1).map(n => <option key={n} value={n}>L{n}</option>)}
          </select>
          <select value={cls} onChange={e => setCls(e.target.value)} disabled={busy}
                  className={`bg-bg border rounded px-1 py-0.5 ${cls === UNKNOWN ? 'border-red text-red' : 'border-border'}`}>
            <option value={UNKNOWN}>— class? —</option>
            {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <span className={verdict.ok ? 'text-dim' : 'text-orange'}>{verdict.message}</span>
          <button
            type="button" disabled={busy || cls === UNKNOWN || !verdict.ok}
            onClick={() => run(() => claimAsRaidAlt(s.name, cls, level), 'queued as a Raid Alt for OpenDKP')}
            className="px-2 py-0.5 rounded border border-green bg-green/15 text-green hover:bg-green/25 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? '…' : 'Add as raid alt'}
          </button>
        </div>
      )}

      {err && <div className="text-red text-[10px] mt-1">⚠ {err}</div>}
    </div>
  );
}

export default function SuspectedCharacters({ suspects }: { suspects: Suspect[] }) {
  if (suspects.length === 0) return null;
  return (
    <section className="bg-panel border border-gold/40 rounded-lg p-6">
      <h2 className="text-xl text-gold mb-1">🔎 Characters we think are yours ({suspects.length})</h2>
      <p className="text-sm text-dim leading-6">
        These uploaded from <b className="text-text">your machine</b> but aren&apos;t linked to anyone yet, so their
        inventories don&apos;t show up in your account. You know what they are — tell us and they join your list.
        {' '}<b className="text-text">Traders</b> (bank mules, bazaar toons) need nothing else: no class, no level, and
        they never touch OpenDKP. <b className="text-text">Raid alts</b> need a class and{' '}
        {RAID_ALT_MIN_LEVEL.classic}+ to raid Classic ({RAID_ALT_MIN_LEVEL.kunark}+ Kunark,{' '}
        {RAID_ALT_MIN_LEVEL.velious}+ Velious, {RAID_ALT_MIN_LEVEL.luclin} Luclin) — below that, file them as traders
        or leave them be; nobody needs them in OpenDKP.
      </p>
      <div className="mt-3">
        {suspects.map(s => <Row key={s.name} s={s} />)}
      </div>
    </section>
  );
}
