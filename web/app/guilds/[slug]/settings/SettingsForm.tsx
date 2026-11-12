'use client';
// The guild settings form (the guild lead, 2026-11-12). The rules are web/lib/guildSettings.ts, shared with the server action,
// so the preview line and the saved values come from the same functions. This first version saves the settings and shows the
// next raid; the rest are not read by anything yet (the page says so once).
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveGuildSettings, type SettingsSaveResult } from './actions';
import {
  COMMON_ZONES, DAY_NAMES, JOBS, ROLE_TIERS, nextRaidLine, validateSettings,
  type GuildSettings, type Job, type RoleTier,
} from '@/lib/guildSettings';

const CARD = 'rounded-lg border border-border bg-panel p-4';
const LABEL = 'block text-xs text-dim';
const INPUT = 'mt-1 min-h-11 w-full rounded border border-border bg-bg px-3 text-sm text-text';
const HELP = 'mt-1 text-xs leading-5 text-dim';

const TIER_HELP: Record<RoleTier, { label: string; help: string }> = {
  leader: { label: 'Leader', help: 'Runs the guild and always holds every job below.' },
  officer: { label: 'Officers', help: 'Officers below the leader. Give them jobs in the next section as they ask for them.' },
  raider: { label: 'Raiders', help: 'Full raiders: counted in attendance and on the raid roster.' },
  member: { label: 'Members', help: 'In the guild, not on the raid roster yet.' },
  recruit: { label: 'Recruits', help: 'On trial. Often the same role a raider starts with.' },
  alt: { label: 'Alts', help: 'Second characters of members.' },
};
const JOB_LABEL: Record<Job, { label: string; help: string }> = {
  loot: { label: 'Posting loot', help: 'Who may post drops for bidding.' },
  dkp: { label: 'Entering DKP', help: 'Who may add ticks and adjust DKP.' },
  recruiting: { label: 'Recruiting', help: 'Who may accept recruits and hand out invites.' },
  schedule: { label: 'Raid schedule', help: 'Who may change the days and times above.' },
  triggers: { label: 'Triggers', help: 'Who may edit the guild’s shared triggers.' },
};

type Form = {
  s: GuildSettings;
  roles: Record<RoleTier, string>;
  jobs: Record<Job, string>;
};
const toForm = (s: GuildSettings): Form => ({
  s,
  roles: Object.fromEntries(ROLE_TIERS.map(t => [t, s.roles[t].join(', ')])) as Record<RoleTier, string>,
  jobs: Object.fromEntries(JOBS.map(j => [j, s.jobs[j].join(', ')])) as Record<Job, string>,
});
const toInput = (f: Form) => ({ ...f.s, roles: f.roles, jobs: f.jobs });

function allZones(current: string): string[] {
  let all: string[] = [];
  try { all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []; } catch { /* old browser */ }
  const rest = all.filter(z => !COMMON_ZONES.includes(z));
  if (current && !COMMON_ZONES.includes(current) && !rest.includes(current)) rest.unshift(current);
  return rest;
}

export default function SettingsForm({ slug, initial }: { slug: string; initial: GuildSettings }) {
  const [f, setF] = useState<Form>(() => toForm(initial));
  const [result, setResult] = useState<SettingsSaveResult | null>(null);
  const [pending, start] = useTransition();
  const [now, setNow] = useState<number | null>(null);
  const router = useRouter();
  useEffect(() => { setNow(Date.now()); }, []);
  const zones = useMemo(() => allZones(f.s.schedule.tz), [f.s.schedule.tz]);

  const check = useMemo(() => validateSettings(toInput(f)), [f]);
  const errors = result && !result.ok && result.errors ? result.errors : !check.ok ? check.errors : {};
  const err = (k: string) => errors[k] ? <p className="mt-1 text-xs text-red">{errors[k]}</p> : null;

  const setS = <K extends keyof GuildSettings>(k: K, patch: Partial<GuildSettings[K]>) =>
    setF(p => ({ ...p, s: { ...p.s, [k]: { ...(p.s[k] as object), ...patch } } }));
  const setSched = (patch: Partial<GuildSettings['schedule']>) => setS('schedule', patch);
  const toggleDay = (d: number) => setSched({ days: f.s.schedule.days.includes(d) ? f.s.schedule.days.filter(x => x !== d) : [...f.s.schedule.days, d].sort((a, b) => a - b) });
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

  const line = now !== null && check.ok ? nextRaidLine(check.values.schedule, now) : null;
  const opendkp = f.s.dkp.provider === 'opendkp';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await saveGuildSettings(slug, toInput(f));
      setResult(r);
      if (r.ok) { setF(toForm(r.values)); router.refresh(); }
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
      <section id="schedule" aria-label="Raid schedule" className={CARD}>
        <h2 className="text-base text-text">Raid schedule</h2>
        <div className="mt-3">
          <label htmlFor="gs-tz" className={LABEL}>Time zone</label>
          <select id="gs-tz" value={f.s.schedule.tz} onChange={e => setSched({ tz: e.target.value })} className={INPUT}>
            <optgroup label="Common">{COMMON_ZONES.map(z => <option key={z} value={z}>{z}</option>)}</optgroup>
            {zones.length > 0 && <optgroup label="All zones">{zones.map(z => <option key={z} value={z}>{z}</option>)}</optgroup>}
          </select>
          {err('schedule.tz')}
        </div>
        <fieldset className="mt-3">
          <legend className={LABEL}>Raid days</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {DAY_NAMES.map((n, d) => (
              <label key={n} className="flex min-h-11 items-center gap-2 rounded border border-border px-3 text-sm text-text">
                <input type="checkbox" checked={f.s.schedule.days.includes(d)} onChange={() => toggleDay(d)} className="h-4 w-4" />
                {n.slice(0, 3)}
              </label>
            ))}
          </div>
          {err('schedule.days')}
        </fieldset>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="gs-start" className={LABEL}>Starts</label>
            <input id="gs-start" type="time" value={f.s.schedule.start} onChange={e => setSched({ start: e.target.value })} className={INPUT} />
            {err('schedule.start')}
          </div>
          <div>
            <label htmlFor="gs-end" className={LABEL}>Ends</label>
            <input id="gs-end" type="time" value={f.s.schedule.end} onChange={e => setSched({ end: e.target.value })} className={INPUT} />
            {err('schedule.end')}
          </div>
          <div>
            <label htmlFor="gs-plan" className={LABEL}>Plan to (room for overtime)</label>
            <input id="gs-plan" type="time" value={f.s.schedule.planEnd} onChange={e => setSched({ planEnd: e.target.value })} className={INPUT} />
            {err('schedule.planEnd')}
          </div>
        </div>
        <div className="mt-3">
          <label htmlFor="gs-cutoff" className={LABEL}>A raid night counts until (hour of the next morning, 0 to 12)</label>
          <input id="gs-cutoff" type="number" inputMode="numeric" min={0} max={12} value={Number.isNaN(f.s.schedule.nightCutoffHour) ? '' : f.s.schedule.nightCutoffHour}
            onChange={e => setSched({ nightCutoffHour: num(e.target.value) })} className={`${INPUT} sm:w-32`} />
          {err('schedule.nightCutoffHour')}
        </div>
        <p role="status" className="mt-3 text-sm text-text">
          {line ? <>Next raid: {line}</> : <span className="text-dim">{now === null ? 'Next raid: …' : 'Next raid: pick at least one day.'}</span>}
        </p>
      </section>

      <section id="roles" aria-label="Roles" className={CARD}>
        <h2 className="text-base text-text">Roles</h2>
        <p className={HELP}>For each tier, list the Discord roles that belong to it: a role name or a role id, separated by commas. Ids are safest, because a renamed role keeps its id.</p>
        {ROLE_TIERS.map(t => (
          <div key={t} className="mt-3">
            <label htmlFor={`gs-role-${t}`} className={LABEL}>{TIER_HELP[t].label}</label>
            <input id={`gs-role-${t}`} type="text" value={f.roles[t]} onChange={e => setF(p => ({ ...p, roles: { ...p.roles, [t]: e.target.value } }))}
              autoComplete="off" spellCheck={false} className={INPUT} />
            <p className={HELP}>{TIER_HELP[t].help}</p>
            {err(`roles.${t}`)}
          </div>
        ))}
      </section>

      <section id="jobs" aria-label="Jobs" className={CARD}>
        <h2 className="text-base text-text">Jobs</h2>
        <p className={HELP}>A job is something a role is trusted to do. The leader tier always holds every job, so list only the others.</p>
        {JOBS.map(j => (
          <div key={j} className="mt-3">
            <label htmlFor={`gs-job-${j}`} className={LABEL}>{JOB_LABEL[j].label}</label>
            <input id={`gs-job-${j}`} type="text" value={f.jobs[j]} onChange={e => setF(p => ({ ...p, jobs: { ...p.jobs, [j]: e.target.value } }))}
              autoComplete="off" spellCheck={false} className={INPUT} />
            <p className={HELP}>{JOB_LABEL[j].help}</p>
            {err(`jobs.${j}`)}
          </div>
        ))}
      </section>

      <section id="dkp" aria-label="DKP" className={CARD}>
        <h2 className="text-base text-text">DKP</h2>
        <div className="mt-3">
          <label htmlFor="gs-dkp" className={LABEL}>DKP system</label>
          <select id="gs-dkp" value={f.s.dkp.provider} onChange={e => setS('dkp', { provider: e.target.value === 'opendkp' ? 'opendkp' : 'none' })} className={INPUT}>
            <option value="none">None (no ranks or bidding)</option>
            <option value="opendkp">OpenDKP</option>
          </select>
          {err('dkp.provider')}
        </div>
        {opendkp && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="gs-dkp-client" className={LABEL}>OpenDKP name (before .opendkp.com)</label>
              <input id="gs-dkp-client" type="text" value={f.s.dkp.client} onChange={e => setS('dkp', { client: e.target.value })} autoComplete="off" spellCheck={false} className={INPUT} />
              {err('dkp.client')}
            </div>
            <div>
              <label htmlFor="gs-dkp-pool" className={LABEL}>DKP pool number</label>
              <input id="gs-dkp-pool" type="number" inputMode="numeric" value={f.s.dkp.pool ?? ''} onChange={e => setS('dkp', { pool: e.target.value.trim() === '' ? null : num(e.target.value) })} className={INPUT} />
              {err('dkp.pool')}
            </div>
            <div>
              <label htmlFor="gs-dkp-ticks" className={LABEL}>Ticks per night</label>
              <input id="gs-dkp-ticks" type="number" inputMode="numeric" value={Number.isNaN(f.s.dkp.ticksPerNight) ? '' : f.s.dkp.ticksPerNight} onChange={e => setS('dkp', { ticksPerNight: num(e.target.value) })} className={INPUT} />
              {err('dkp.ticksPerNight')}
            </div>
            <div>
              <label htmlFor="gs-dkp-auction" className={LABEL}>Auction length (minutes)</label>
              <input id="gs-dkp-auction" type="number" inputMode="numeric" value={Number.isNaN(f.s.dkp.auctionMinutes) ? '' : f.s.dkp.auctionMinutes} onChange={e => setS('dkp', { auctionMinutes: num(e.target.value) })} className={INPUT} />
              {err('dkp.auctionMinutes')}
            </div>
            <div>
              <label htmlFor="gs-dkp-bmin" className={LABEL}>Smallest bid</label>
              <input id="gs-dkp-bmin" type="number" inputMode="numeric" value={Number.isNaN(f.s.dkp.bidMin) ? '' : f.s.dkp.bidMin} onChange={e => setS('dkp', { bidMin: num(e.target.value) })} className={INPUT} />
              {err('dkp.bidMin')}
            </div>
            <div>
              <label htmlFor="gs-dkp-bmax" className={LABEL}>Largest bid</label>
              <input id="gs-dkp-bmax" type="number" inputMode="numeric" value={Number.isNaN(f.s.dkp.bidMax) ? '' : f.s.dkp.bidMax} onChange={e => setS('dkp', { bidMax: num(e.target.value) })} className={INPUT} />
              {err('dkp.bidMax')}
            </div>
          </div>
        )}
      </section>

      <section id="guests" aria-label="Guests" className={CARD}>
        <h2 className="text-base text-text">Guests</h2>
        <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={f.s.guests.allow} onChange={e => setS('guests', { allow: e.target.checked })} className="h-4 w-4" />
          Allow guests on our raids
        </label>
        {f.s.guests.allow && (
          <div className="mt-2">
            <label htmlFor="gs-pass" className={LABEL}>A guest pass lasts (hours)</label>
            <input id="gs-pass" type="number" inputMode="numeric" min={1} max={168} value={Number.isNaN(f.s.guests.passHours) ? '' : f.s.guests.passHours} onChange={e => setS('guests', { passHours: num(e.target.value) })} className={`${INPUT} sm:w-32`} />
            {err('guests.passHours')}
          </div>
        )}
        <p className={HELP}>Guests appear on the raids they attend, so you can see who was there. They are not your members: their own /who sightings and their history stay with their own guild.</p>
      </section>

      <section id="links" aria-label="Links" className={CARD}>
        <h2 className="text-base text-text">Links</h2>
        <div className="mt-3">
          <label htmlFor="gs-discord" className={LABEL}>Discord invite</label>
          <input id="gs-discord" type="url" inputMode="url" value={f.s.links.discordInvite} onChange={e => setS('links', { discordInvite: e.target.value })} placeholder="https://discord.gg/…" autoComplete="off" spellCheck={false} className={INPUT} />
          {err('links.discordInvite')}
        </div>
        <div className="mt-3">
          <label htmlFor="gs-web" className={LABEL}>Website</label>
          <input id="gs-web" type="url" inputMode="url" value={f.s.links.website} onChange={e => setS('links', { website: e.target.value })} placeholder="https://your-guild.example" autoComplete="off" spellCheck={false} className={INPUT} />
          {err('links.website')}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || !check.ok} className="min-h-11 rounded border border-gold/70 px-4 text-sm text-gold hover:bg-gold/10 disabled:opacity-50">
          {pending ? 'Saving…' : 'Save settings'}
        </button>
        {result && <p role="status" className={`text-sm ${result.ok ? 'text-green' : 'text-red'}`}>{result.message}</p>}
      </div>
    </form>
  );
}
