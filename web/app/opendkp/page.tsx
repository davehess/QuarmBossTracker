// /opendkp — a PUBLIC live counter of every request Wolf Pack sends OpenDKP.
//
// WHY THIS IS OPEN ACCESS (Hitya, 2026-08-26): "moncs is ready to unblock us,
// so I need a live counter site that's open access." On 2026-08-25 our traffic
// cost OpenDKP's owner real money and got our IP blocked at his WAF. He is
// about to lift that on our word. "Trust us, it's fixed" is not a reasonable
// thing to ask of someone who is paying the bill, and he is not in our Discord,
// so any page behind our sign-in is useless to the one person who needs it.
//
// This page therefore has NO auth check — deliberately, and it is the only
// member-facing surface that doesn't. What it exposes is exactly and only:
// endpoint shapes, call counts, byte totals, and whether we are currently
// halted. No character names, no member names, no DKP, no credentials. The
// underlying table (opendkp_call_stats) is the single anon-readable table in
// the schema for the same reason.
//
// Endpoint names are normalized to the shape OpenDKP's own API Gateway log
// groups by (`/clients/{client}/auctions`), so this can be read straight across
// against his table with no translation step.

import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import AutoRefresh from './AutoRefresh';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata = {
  title: 'OpenDKP traffic — Wolf Pack',
  description: 'Live count of every API request Wolf Pack sends to OpenDKP.',
};

type Row = {
  minute: string; endpoint: string; method: string;
  calls: number; bytes: number; errors: number; blocked: number;
};

const fmt = (n: number) => n.toLocaleString('en-US');
function fmtBytes(n: number) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
}

// Series colors — the validated categorical order from the writeup, so the
// graphs here and the ones Moncs was shown read as the same system.
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#8b949e'];

export default async function OpenDkpPage() {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

  const [{ data: rowsRaw }, { data: tuneRows }] = await Promise.all([
    sb.from('opendkp_call_stats')
      .select('minute, endpoint, method, calls, bytes, errors, blocked')
      .gte('minute', since)
      .order('minute', { ascending: true })
      .limit(1000),
    sb.from('overlay_tuning').select('tuning').eq('guild_id', 'wolfpack').limit(1),
  ]);
  const rows = (rowsRaw ?? []) as Row[];
  const tuning = (tuneRows?.[0]?.tuning ?? {}) as Record<string, unknown>;
  const haltFlag = Number(tuning.flag_opendkp_halt) >= 1;

  const now = Date.now();
  const inWindow = (r: Row, mins: number) => now - Date.parse(r.minute) <= mins * 60 * 1000;
  const sum = (rs: Row[], k: keyof Row) => rs.reduce((n, r) => n + (Number(r[k]) || 0), 0);

  // Split OUR auth provider (AWS Cognito) from OpenDKP's own API. Counting
  // Cognito is useful — a token storm is still a bug of ours — but folding it
  // into "calls to OpenDKP" overstates what we send him, which is the one
  // direction a page built to regain trust must never be wrong in.
  const isAuth = (r: Row) => r.endpoint.startsWith('cognito:');
  const all60 = rows.filter(r => inWindow(r, 60));
  const all24 = rows.filter(r => inWindow(r, 60 * 24));
  const last60 = all60.filter(r => !isAuth(r));
  const last24 = all24.filter(r => !isAuth(r));
  const auth60 = all60.filter(isAuth);

  // By endpoint over 24h — the bar chart from the writeup.
  const byEndpoint = new Map<string, { calls: number; bytes: number; errors: number }>();
  for (const r of last24) {
    const e = byEndpoint.get(r.endpoint) ?? { calls: 0, bytes: 0, errors: 0 };
    e.calls += r.calls; e.bytes += Number(r.bytes) || 0; e.errors += r.errors;
    byEndpoint.set(r.endpoint, e);
  }
  const endpoints = [...byEndpoint.entries()].sort((a, b) => b[1].calls - a[1].calls);
  const maxCalls = Math.max(1, ...endpoints.map(([, v]) => v.calls));

  // Hourly timeline, oldest → newest, 48 buckets.
  const hours: { at: number; calls: number; blocked: number }[] = [];
  for (let i = 47; i >= 0; i--) {
    const start = now - (i + 1) * 3600 * 1000, end = now - i * 3600 * 1000;
    const inHour = rows.filter(r => { const t = Date.parse(r.minute); return t >= start && t < end; });
    hours.push({ at: end, calls: sum(inHour, 'calls'), blocked: sum(inHour, 'blocked') });
  }
  const maxHour = Math.max(1, ...hours.map(h => h.calls));

  const callsNow = sum(last60, 'calls');
  const blockedNow = sum(last60, 'blocked');
  const authCalls = sum(auth60, 'calls');
  const authBlocked = sum(auth60, 'blocked');
  const everSeen = rows.length > 0;

  // Three states, and the distinction matters to a reader deciding whether to
  // re-block us: halted on purpose, live and quiet, or no data at all.
  const state = haltFlag ? 'halted' : (callsNow > 0 ? 'live' : (everSeen ? 'quiet' : 'nodata'));
  const STATE = {
    halted: { label: 'HALTED', color: '#d29922', note: 'Wolf Pack is not sending anything to OpenDKP. Every call is being refused before it leaves our server.' },
    live:   { label: 'LIVE',   color: '#3fae74', note: 'Sending normally, within the limits below.' },
    quiet:  { label: 'IDLE',   color: '#8b949e', note: 'Running, but nothing has needed to be sent in the last hour.' },
    nodata: { label: 'NO DATA', color: '#8b949e', note: 'No calls recorded yet in the last 48 hours.' },
  }[state];

  return (
    <div className="space-y-6 max-w-5xl">
      <section className="bg-panel border border-border rounded-lg p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl text-gold mb-1">OpenDKP traffic — live</h1>
            <p className="text-sm text-dim leading-6 max-w-2xl">
              Every request Wolf Pack&apos;s bot sends to the OpenDKP API, counted as it happens.
              This page is <b className="text-text">open to anyone</b> — no sign-in — because the
              person who most needs to see it is the one paying for the API.
              Endpoint names match the shape OpenDKP&apos;s own API Gateway logs use, so this can be
              read side by side with them.
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs tracking-widest font-bold px-3 py-1 rounded border inline-block"
                 style={{ color: STATE.color, borderColor: STATE.color }}>
              {STATE.label}
            </div>
            <div className="mt-2"><AutoRefresh seconds={30} /></div>
          </div>
        </div>
        <p className="text-sm mt-3" style={{ color: STATE.color }}>{STATE.note}</p>
      </section>

      <section className="grid sm:grid-cols-4 gap-3">
        {[
          { k: 'Calls, last hour', v: fmt(callsNow), n: `${fmtBytes(sum(last60, 'bytes'))} returned` },
          { k: 'Calls, last 24h', v: fmt(sum(last24, 'calls')), n: `${fmtBytes(sum(last24, 'bytes'))} returned` },
          { k: 'Refused by us', v: fmt(blockedNow), n: 'last hour — stopped before reaching OpenDKP' },
          { k: 'Errors, last 24h', v: fmt(sum(last24, 'errors')), n: 'HTTP 4xx/5xx from OpenDKP' },
        ].map(s => (
          <div key={s.k} className="bg-panel border border-border rounded-lg p-4">
            <div className="text-[10px] uppercase tracking-wider text-dim">{s.k}</div>
            <div className="text-2xl text-text font-semibold tabular-nums mt-1">{s.v}</div>
            <div className="text-[11px] text-dim mt-1">{s.n}</div>
          </div>
        ))}
      </section>

      <section className="bg-panel border border-border rounded-lg p-4">
        <h2 className="text-base text-orange mb-1">Calls by endpoint — last 24 hours</h2>
        <p className="text-xs text-dim mb-3">
          The same breakdown as the write-up, live. <code>/clients/&#123;client&#125;/auctions</code> is
          the one that caused the incident; it should now be a small, flat number no matter how many
          people have the app open.
        </p>
        {endpoints.length === 0 ? (
          <p className="text-sm text-dim">Nothing sent in the last 24 hours.</p>
        ) : (
          <div className="space-y-1">
            {endpoints.map(([name, v], i) => (
              <div key={name} className="flex items-center gap-3 text-sm py-1">
                <code className="text-xs text-text w-[280px] shrink-0 truncate" title={name}>{name}</code>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <div className="h-5 rounded-r"
                       style={{ width: `${Math.max(0.5, (v.calls / maxCalls) * 100)}%`, background: SERIES[i % SERIES.length] }} />
                  <span className="text-xs text-text tabular-nums whitespace-nowrap">
                    {fmt(v.calls)}
                    <span className="text-dim ml-2">{fmtBytes(v.bytes)}</span>
                    {v.errors > 0 && <span className="text-red ml-2">{fmt(v.errors)} err</span>}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-panel border border-border rounded-lg p-4">
        <h2 className="text-base text-orange mb-1">Last 48 hours, hour by hour</h2>
        <p className="text-xs text-dim mb-3">
          Each bar is one hour. A raid night should be the tallest thing here and still small;
          a flat line at zero means we are halted.
        </p>
        <div className="flex items-end gap-[2px] h-28">
          {hours.map((h, i) => (
            <div key={i} className="flex-1 min-w-0 rounded-t"
                 title={`${new Date(h.at).toLocaleString()} — ${fmt(h.calls)} calls${h.blocked ? `, ${fmt(h.blocked)} refused` : ''}`}
                 style={{
                   height: `${Math.max(h.calls ? 3 : 1, (h.calls / maxHour) * 100)}%`,
                   background: h.calls ? '#3987e5' : (h.blocked ? '#d29922' : '#2a2f38'),
                 }} />
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-dim mt-1">
          <span>48h ago</span><span>24h ago</span><span>now</span>
        </div>
      </section>

      {(authCalls > 0 || authBlocked > 0) && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-base text-orange mb-1">Sign-in traffic (not OpenDKP)</h2>
          <p className="text-xs text-dim">
            Counted separately and on purpose: these go to <b className="text-text">Amazon Cognito</b>,
            the sign-in service, and never touch OpenDKP&apos;s own API. They are shown because a
            burst of them is still a bug worth seeing on our side — not because they cost OpenDKP
            anything. Last hour: <b className="text-text">{fmt(authCalls)}</b> sign-in
            {authCalls === 1 ? '' : 's'}
            {authBlocked > 0 && <> · <b className="text-text">{fmt(authBlocked)}</b> refused by us before sending</>}.
          </p>
        </section>
      )}

      <section className="bg-panel border border-border rounded-lg p-4 text-xs text-dim leading-6">
        <b className="text-text">What changed after the incident.</b> The live-bidding panel used to
        poll <code>/auctions</code> every 7 seconds per open dashboard, uncached — that is what put
        1,678 calls and 1.1 GB on the API in one afternoon. It now reads OpenDKP&apos;s own
        <code> /auctions/active</code> endpoint through a single shared cache, so the whole guild
        costs one call per interval no matter how many people are playing, and a hard ceiling of
        60 calls/minute sits below every request path we have. Full write-up:{' '}
        <Link href="/ai" className="underline">how we work</Link>.
        <br /><br />
        <b className="text-text">Counts are per minute</b>, aggregated in memory and written once —
        recording a row per call would repeat the exact mistake this page exists to answer for.
        &ldquo;Refused by us&rdquo; are calls stopped before they left our server, so they never
        reached OpenDKP at all.
      </section>
    </div>
  );
}
