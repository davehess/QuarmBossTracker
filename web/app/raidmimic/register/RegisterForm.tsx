'use client';
// The "Register your guild" card. One card, no sign-in. Every rule (required name, ranges, cleaning, the hourly limit)
// is on the server (actions.ts + lib/guildInterest.ts); this holds the fields, sends them and shows the answer. After
// a save the card is replaced by a thank-you that offers the download and the set-up guide.
import { useState, useTransition } from 'react';
import { submitGuildInterest } from './actions';
import {
  BID_MODES, DKP_TOOLS, GAMES, GUILD_NAME_MAX, HEARD_MAX, NIGHTS, RAIDERS_MAX, RAIDERS_MIN,
  RAID_TIMES, SERVER_MAX, TIMEZONES,
} from '@/lib/guildInterestFields';

const GAME_LABEL: Record<(typeof GAMES)[number], string> = { quarm: 'Project Quarm', 'eq-live': 'EverQuest live', other: 'Other' };
const DKP_LABEL: Record<(typeof DKP_TOOLS)[number], string> = { opendkp: 'OpenDKP', eqdkp: 'EQDKP', other: 'Other', none: 'None' };
const NIGHT_LABEL: Record<(typeof NIGHTS)[number], string> = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };
const TZ_LABEL: Record<(typeof TIMEZONES)[number], string> = {
  et: 'Eastern', ct: 'Central', mt: 'Mountain', pt: 'Pacific',
  'gmt-uk': 'UK / GMT', 'eu-central': 'Central Europe', oceania: 'Oceania', other: 'Other',
};
// The loot-award styles guilds actually run (one line each, so a lead can pick without a glossary).
const BID_MODE_LABEL: Record<(typeof BID_MODES)[number], { name: string; desc: string }> = {
  'dkp-open':   { name: 'Open bid DKP',     desc: 'bids called out in chat, highest wins' },
  'dkp-sealed': { name: 'Sealed bid DKP',   desc: 'bids stay hidden until the item is won' },
  'dkp-timer':  { name: 'Timed auction DKP', desc: 'highest bid when the countdown ends' },
  epgp:         { name: 'EPGP',             desc: 'priority from effort earned over gear taken' },
  rolls:        { name: 'Rolls / tiers',    desc: '/random, upgrades before greed' },
  council:      { name: 'Loot council',     desc: 'officers award by need' },
  picks:        { name: 'Ranked picks',     desc: 'everyone ranks their wants, awards go by rank' },
  other:        { name: 'Other',            desc: 'house rules of your own' },
  none:         { name: 'None yet',         desc: 'still deciding' },
};

const INPUT = 'min-h-11 w-full rounded border border-border bg-bg px-3 text-sm text-text';
const LEGEND = 'mb-2 block text-xs uppercase tracking-widest text-dim';
const PRIMARY = 'inline-flex min-h-11 items-center justify-center rounded border border-gold bg-gold px-5 text-sm font-semibold text-bg hover:opacity-90 hover:no-underline disabled:opacity-60';

// A chip or a day: a real radio/checkbox under a styled label, so keyboard and screen readers work unchanged.
function Chip({ type, name, value, checked, onChange, children, small }: {
  type: 'radio' | 'checkbox'; name: string; value: string; checked: boolean; onChange: () => void; children: React.ReactNode; small?: boolean;
}) {
  return (
    <label className={`relative inline-flex min-h-11 cursor-pointer items-center justify-center rounded border text-sm ${small ? 'min-w-[3rem] px-2' : 'px-4'} ${
      checked ? 'border-gold bg-gold/15 text-text' : 'border-border bg-bg text-text hover:border-dim'
    } focus-within:outline focus-within:outline-2 focus-within:outline-blue`}>
      <input type={type} name={name} value={value} checked={checked} onChange={onChange} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      <span aria-hidden={false}>{children}</span>
    </label>
  );
}

export default function RegisterForm({ downloadHref, setupHref }: { downloadHref: string; setupHref: string }) {
  const [guildName, setGuildName] = useState('');
  const [game, setGame] = useState<(typeof GAMES)[number]>('quarm');
  const [server, setServer] = useState('');
  const [raiders, setRaiders] = useState(24);
  const [nights, setNights] = useState<string[]>([]);
  const [tz, setTz] = useState<(typeof TIMEZONES)[number] | ''>('');
  const [raidStart, setRaidStart] = useState('');
  const [raidEnd, setRaidEnd] = useState('');
  const [bidMode, setBidMode] = useState<(typeof BID_MODES)[number]>('none');
  const [dkp, setDkp] = useState<(typeof DKP_TOOLS)[number]>('none');
  const [heard, setHeard] = useState('');
  const [discord, setDiscord] = useState('');
  const [website, setWebsite] = useState('');   // honeypot
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const toggleNight = (n: string) => setNights(cur => (cur.includes(n) ? cur.filter(x => x !== n) : [...cur, n]));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!guildName.trim()) { setError('Please tell us your guild name.'); return; }
    setError('');
    start(async () => {
      try {
        const r = await submitGuildInterest({
          guildName, game, server, raiders, nights, tz, raidStart, raidEnd, bidMode, dkp, heard, discord, website,
        });
        if (r.ok) setDone(true); else setError(r.error || 'Something went wrong.');
      } catch {
        setError('Could not send. Please try again in a bit.');
      }
    });
  }

  if (done) {
    return (
      <section role="status" className="rounded-md border border-green/50 bg-panel p-5 sm:p-6">
        <h2 className="text-xl text-text">You are on the list.</h2>
        <p className="mt-2 max-w-[60ch] text-sm leading-6 text-text">
          Thanks. Nothing is charged and nothing is sent to your guild. While you wait, you can try Mimic on your own PC today.
        </p>
        <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <a href={downloadHref} target="_blank" rel="noreferrer" className={PRIMARY}>Download Mimic</a>
          <a href={setupHref} className="inline-flex min-h-11 items-center text-sm">Read the setup guide →</a>
        </p>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-md border border-border bg-panel p-5 sm:p-6" noValidate>
      <div>
        <label htmlFor="ri-guild" className={LEGEND}>Guild name</label>
        <input id="ri-guild" value={guildName} onChange={e => setGuildName(e.target.value)} maxLength={GUILD_NAME_MAX}
          autoComplete="off" required className={INPUT} placeholder="Your guild" />
      </div>

      <fieldset className="mt-5 min-w-0 border-0 p-0">
        <legend className={LEGEND}>Game</legend>
        <div className="flex flex-wrap gap-2">
          {GAMES.map(g => (
            <Chip key={g} type="radio" name="game" value={g} checked={game === g} onChange={() => setGame(g)}>{GAME_LABEL[g]}</Chip>
          ))}
        </div>
        {game === 'other' && (
          <input aria-label="Which game or server" value={server} onChange={e => setServer(e.target.value)} maxLength={SERVER_MAX}
            autoComplete="off" className={`${INPUT} mt-2`} placeholder="Which game or server?" />
        )}
      </fieldset>

      <div className="mt-5">
        <label htmlFor="ri-raiders" className={LEGEND}>
          Raiders <output htmlFor="ri-raiders" className="ml-2 text-base normal-case tracking-normal text-gold">{raiders}</output>
        </label>
        <input id="ri-raiders" type="range" min={RAIDERS_MIN} max={RAIDERS_MAX} step={1} value={raiders}
          onChange={e => setRaiders(Number(e.target.value))} className="h-11 w-full accent-gold" />
        <div className="flex justify-between text-xs text-dim"><span>{RAIDERS_MIN}</span><span>{RAIDERS_MAX}</span></div>
      </div>

      <fieldset className="mt-5 min-w-0 border-0 p-0">
        <legend className={LEGEND}>Raid nights</legend>
        <div className="flex flex-wrap gap-2">
          {NIGHTS.map(n => (
            <Chip key={n} small type="checkbox" name="nights" value={n} checked={nights.includes(n)} onChange={() => toggleNight(n)}>{NIGHT_LABEL[n]}</Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-5 min-w-0 border-0 p-0">
        <legend className={LEGEND}>Timezone (optional)</legend>
        <div className="flex flex-wrap gap-2">
          {TIMEZONES.map(z => (
            <Chip key={z} type="radio" name="tz" value={z} checked={tz === z} onChange={() => setTz(cur => (cur === z ? '' : z))}>{TZ_LABEL[z]}</Chip>
          ))}
        </div>
      </fieldset>

      <div className="mt-5">
        <span className={LEGEND} id="ri-window-label">Raid time, in your timezone (optional)</span>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby="ri-window-label">
          <select aria-label="Raids usually start at" value={raidStart} onChange={e => setRaidStart(e.target.value)}
            className={`${INPUT} w-auto min-w-[7rem]`}>
            <option value="">Start…</option>
            {RAID_TIMES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <span className="text-sm text-dim">to</span>
          <select aria-label="Raids usually end at" value={raidEnd} onChange={e => setRaidEnd(e.target.value)}
            className={`${INPUT} w-auto min-w-[7rem]`}>
            <option value="">End…</option>
            {RAID_TIMES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <p className="mt-1 text-xs text-dim">An end earlier than the start just means the raid runs past midnight.</p>
      </div>

      <fieldset className="mt-5 min-w-0 border-0 p-0">
        <legend className={LEGEND}>How you award loot</legend>
        <div className="flex flex-col gap-1">
          {BID_MODES.map(m => (
            <label key={m} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded border px-3 py-1.5 text-sm ${
              bidMode === m ? 'border-gold bg-gold/15' : 'border-border bg-bg hover:border-dim'
            } focus-within:outline focus-within:outline-2 focus-within:outline-blue`}>
              <input type="radio" name="bidMode" value={m} checked={bidMode === m} onChange={() => setBidMode(m)}
                className="h-4 w-4 shrink-0 accent-gold" />
              <span className="text-text">{BID_MODE_LABEL[m].name}</span>
              <span className="min-w-0 text-xs text-dim">— {BID_MODE_LABEL[m].desc}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-5 min-w-0 border-0 p-0">
        <legend className={LEGEND}>DKP tool</legend>
        <div className="flex flex-wrap gap-2">
          {DKP_TOOLS.map(d => (
            <Chip key={d} type="radio" name="dkp" value={d} checked={dkp === d} onChange={() => setDkp(d)}>{DKP_LABEL[d]}</Chip>
          ))}
        </div>
      </fieldset>

      <div className="mt-5">
        <label htmlFor="ri-heard" className={LEGEND}>How did you hear about us? (optional)</label>
        <input id="ri-heard" value={heard} onChange={e => setHeard(e.target.value)} maxLength={HEARD_MAX} autoComplete="off" className={INPUT} />
      </div>

      <div className="mt-5">
        <label htmlFor="ri-discord" className={LEGEND}>Discord name, if you want a reply (optional)</label>
        <input id="ri-discord" value={discord} onChange={e => setDiscord(e.target.value)} maxLength={60} autoComplete="off" spellCheck={false} className={INPUT} />
      </div>

      {/* Honeypot: off-screen and out of the tab order. A person never fills it. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>Leave this empty<input tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} /></label>
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-red">{error}</p>}

      <p className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="submit" disabled={pending} className={PRIMARY}>{pending ? 'Sending…' : 'Count us in'}</button>
        <span className="text-xs text-dim">No sign-in, no account, nothing charged.</span>
      </p>
    </form>
  );
}
