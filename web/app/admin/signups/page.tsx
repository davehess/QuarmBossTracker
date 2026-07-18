// Officer tool: Raid-Helper sign-ups + reality reconciliation.
//
// Reality data is layered:
//   1) opendkp_ticks attendance — the canonical truth. If a character was
//      ticked into raid slot 1/2/3/4, they showed up. Resolved to a
//      discord_id via characters.discord_id. (Slot 1 attendance also lets
//      us flag late arrivals — ticked into slot 2+ but not slot 1.)
//   2) encounter_players within the raid window — proxy when ticks are
//      missing or the character isn't linked in characters yet.
//   3) who_observations within the raid window — broadest signal.
//
// Discord-mention-only signups (from the embed-scrape pathway) have no
// user name attached — we resolve through wolfpack_members.discord_id.
//
// Cohorts:
//   - 🟢 Signed Going + showed = reliable
//   - 🔴 Signed Going + no tick = no-show
//   - 🕐 Signed Going + ticked late (slot 2+) = late arrival
//   - 🟡 Signed Tentative + showed = exceeded
//   - 🟠 Signed Tentative + no-show = expected absent
//   - 🆕 Didn't sign up + showed = showed unsignaled
//   - 🚫 Signed Absence = expected absent (informational)

import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import {
  computeCompGaps, ARCHETYPE_LABEL, type CompTemplate, type CompGaps,
} from '@/lib/comp';

export const dynamic = 'force-dynamic';

type RhEvent = {
  id: string;
  title: string | null;
  start_time: string | null;
  channel_id: string | null;
  template: string | null;
};

type RhSignup = {
  event_id: string;
  signup_id: string;
  discord_id: string | null;
  user_name: string | null;
  status: string | null;
  role: string | null;
  class_name: string | null;
  spec_name: string | null;
};

type Member = {
  discord_id: string;
  nickname: string | null;
  global_name: string | null;
};

type CharRow = {
  name: string;
  discord_id: string | null;
};

// Group RH statuses into the "promised attendance" buckets we care about.
// RH free-form templates use a wide variety of labels — we collapse them.
function bucketStatus(status: string | null): 'going' | 'tentative' | 'absence' | 'bench' | 'other' {
  const s = (status || '').toLowerCase();
  if (!s) return 'other';
  if (s === 'tentative' || s.includes('tent')) return 'tentative';
  if (s === 'absence' || s === 'absent' || s.includes('decline') || s.includes('no')) return 'absence';
  if (s === 'bench' || s === 'late' || s.includes('back')) return 'bench';
  // Classes / roles (tank, healer, dps, melee, ranged, caster, ...) → all
  // count as "going" since RH treats role-as-status as a yes commitment.
  return 'going';
}

function fmtTs(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function relDay(iso: string | null): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days}d`;
}

export default async function AdminSignupsPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; days?: string; template?: string }>;
}) {
  const params = await searchParams;
  const lookbackDays = Math.max(1, Math.min(60, parseInt(params.days || '14', 10) || 14));
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const admin = supabaseAdmin();

  // Pull recent events
  const { data: eventRows } = await admin
    .from('rh_events')
    .select('id, title, start_time, channel_id, template')
    .gte('start_time', since)
    .order('start_time', { ascending: false })
    .limit(60);

  const events = (eventRows ?? []) as RhEvent[];

  // #93 comp templates — the officer-authored target compositions (/admin/comp).
  const { data: tplRow } = await admin
    .from('comp_templates').select('templates').eq('guild_id', 'wolfpack').maybeSingle();
  const templates: CompTemplate[] = Array.isArray(tplRow?.templates) ? (tplRow!.templates as CompTemplate[]) : [];

  // Stats header
  let totalSignups = 0, totalGoing = 0, totalTentative = 0;
  if (events.length > 0) {
    const { data: allSigs } = await admin
      .from('rh_signups')
      .select('event_id, status')
      .in('event_id', events.map(e => e.id));
    for (const s of (allSigs ?? []) as { status: string | null }[]) {
      totalSignups++;
      const b = bucketStatus(s.status);
      if (b === 'going') totalGoing++;
      else if (b === 'tentative') totalTentative++;
    }
  }

  // Detail view for one event (?event=ID)
  let detail: {
    event: RhEvent;
    signups: RhSignup[];
    showed: Set<string>;        // discord_ids who appeared (any signal)
    tickedSlot1: Set<string>;   // discord_ids ticked into slot 1 (on time)
    showedNoSignup: { discord_id: string; charName: string }[];
  } | null = null;

  if (params.event) {
    const event = events.find(e => e.id === params.event) ||
      (await admin.from('rh_events').select('id, title, start_time, channel_id, template')
        .eq('id', params.event).maybeSingle()).data as RhEvent | null;
    if (event) {
      const { data: signups } = await admin
        .from('rh_signups')
        .select('event_id, signup_id, discord_id, user_name, status, role, class_name, spec_name')
        .eq('event_id', event.id)
        .order('signup_index');
      const sList = (signups ?? []) as RhSignup[];

      // Reality data: prefer opendkp_ticks (canonical) then parses + who as
      // fallbacks. window: ±2h around start_time covers late arrivals.
      const start = event.start_time ? new Date(event.start_time) : null;
      const showed = new Set<string>();
      const tickedSlot1 = new Set<string>();           // present at start
      const showedDiscordToChar = new Map<string, string>();

      if (start) {
        const lo = new Date(start.getTime() - 1 * 60 * 60 * 1000).toISOString();
        const hi = new Date(start.getTime() + 5 * 60 * 60 * 1000).toISOString();

        // Pull every character → discord_id mapping
        const { data: chars } = await admin
          .from('characters')
          .select('name, discord_id')
          .eq('guild_id', 'wolfpack');
        const charToDiscord = new Map<string, string>();
        for (const c of (chars ?? []) as CharRow[]) {
          if (c.discord_id) charToDiscord.set(c.name.toLowerCase(), c.discord_id);
        }

        // PRIMARY SIGNAL — OpenDKP ticks. Find the raid whose ts matches the
        // event date (within the same calendar day, server tz-naïve), pull
        // every tick's attendees array, resolve to discord_id.
        const eventDate = start.toISOString().slice(0, 10);
        const { data: raids } = await admin
          .from('opendkp_raids')
          .select('raid_id, ts')
          .gte('ts', eventDate + 'T00:00:00Z')
          .lt('ts', eventDate + 'T23:59:59Z');
        const raidIds = ((raids ?? []) as { raid_id: number }[]).map(r => r.raid_id);
        if (raidIds.length > 0) {
          const { data: ticks } = await admin
            .from('opendkp_ticks')
            .select('raid_id, tick_id, attendees')
            .in('raid_id', raidIds)
            .order('tick_id');
          // tick_id ordering ≈ slot ordering for a given raid (slot 1 first).
          const seenSlot1 = new Map<number, Set<string>>();
          for (const t of (ticks ?? []) as { raid_id: number; tick_id: number; attendees: string[] }[]) {
            const isSlot1 = !seenSlot1.has(t.raid_id);
            if (isSlot1) seenSlot1.set(t.raid_id, new Set());
            for (const charName of (t.attendees || [])) {
              const d = charToDiscord.get(charName.toLowerCase());
              if (d) {
                showed.add(d);
                if (!showedDiscordToChar.has(d)) showedDiscordToChar.set(d, charName);
                if (isSlot1) tickedSlot1.add(d);
              }
            }
          }
        }

        // FALLBACK — encounter_players within window (catches anyone whose
        // tick attribution didn't flow through OpenDKP).
        const { data: encs } = await admin
          .from('encounters')
          .select('id')
          .gte('started_at', lo).lt('started_at', hi);
        const encIds = ((encs ?? []) as { id: string }[]).map(e => e.id);
        if (encIds.length > 0) {
          const { data: eps } = await admin
            .from('encounter_players')
            .select('character_name')
            .in('encounter_id', encIds);
          for (const ep of (eps ?? []) as { character_name: string }[]) {
            const d = charToDiscord.get(ep.character_name.toLowerCase());
            if (d) { showed.add(d); if (!showedDiscordToChar.has(d)) showedDiscordToChar.set(d, ep.character_name); }
          }
        }

        // BROADEST FALLBACK — who_observations
        const { data: whos } = await admin
          .from('who_observations')
          .select('character')
          .gte('observed_at', lo).lt('observed_at', hi)
          .limit(50000);
        for (const w of (whos ?? []) as { character: string }[]) {
          const d = charToDiscord.get((w.character || '').toLowerCase());
          if (d) { showed.add(d); if (!showedDiscordToChar.has(d)) showedDiscordToChar.set(d, w.character); }
        }
      }

      const signedDiscord = new Set(sList.map(s => s.discord_id).filter(Boolean) as string[]);
      const showedNoSignup: { discord_id: string; charName: string }[] = [];
      for (const d of showed) {
        if (!signedDiscord.has(d)) showedNoSignup.push({ discord_id: d, charName: showedDiscordToChar.get(d) || d });
      }

      detail = { event, signups: sList, showed, tickedSlot1, showedNoSignup };
    }
  }

  // #93 comp matcher — diff a chosen template against this event's Going signups
  // (planned), plus an ACTUAL overlay from the best raid_roster snapshot that
  // landed in the event window (cheap, reuses existing capture — no new stream).
  let compMatch: {
    templates: string[];
    selectedName: string | null;
    planned: CompGaps | null;
    actual: CompGaps | null;
    actualAsOf: string | null;
  } | null = null;
  if (detail && templates.length > 0) {
    const selectedName = (params.template && templates.some(t => t.name === params.template))
      ? params.template : templates[0].name;
    const selected = templates.find(t => t.name === selectedName) ?? null;
    let planned: CompGaps | null = null;
    let actual: CompGaps | null = null;
    let actualAsOf: string | null = null;
    if (selected) {
      const going = detail.signups
        .filter(s => bucketStatus(s.status) === 'going')
        .map(s => ({ className: s.class_name }));
      planned = computeCompGaps(selected, going);

      const start = detail.event.start_time ? new Date(detail.event.start_time) : null;
      if (start) {
        const lo = new Date(start.getTime() - 1 * 60 * 60 * 1000).toISOString();
        const hi = new Date(start.getTime() + 5 * 60 * 60 * 1000).toISOString();
        const { data: rr } = await admin
          .from('raid_roster')
          .select('name, class, captured_at')
          .eq('guild_id', 'wolfpack')
          .gte('captured_at', lo).lt('captured_at', hi);
        const rows = (rr ?? []) as { name: string; class: string | null; captured_at: string }[];
        if (rows.length > 0) {
          // A raid_roster snapshot is the full raid composition from one uploader's
          // view; pick the snapshot with the BEST coverage (most rows; ties → latest)
          // so a partial/one-group upload can't understate the actual comp.
          const byCap = new Map<string, { name: string; class: string | null }[]>();
          for (const r of rows) (byCap.get(r.captured_at) ?? byCap.set(r.captured_at, []).get(r.captured_at)!).push(r);
          let bestCap = '';
          let bestLen = -1;
          for (const [cap, list] of byCap) {
            if (list.length > bestLen || (list.length === bestLen && cap > bestCap)) { bestCap = cap; bestLen = list.length; }
          }
          const snap = byCap.get(bestCap) ?? [];
          actualAsOf = bestCap;
          actual = computeCompGaps(selected, snap.map(r => ({ className: r.class })));
        }
      }
    }
    compMatch = { templates: templates.map(t => t.name), selectedName, planned, actual, actualAsOf };
  }

  // Member lookup for displaying nicknames in detail
  let memberByDiscord: Map<string, Member> = new Map();
  if (detail) {
    const ids = new Set<string>();
    for (const s of detail.signups) if (s.discord_id) ids.add(s.discord_id);
    for (const s of detail.showed) ids.add(s);
    if (ids.size > 0) {
      const { data: members } = await admin
        .from('wolfpack_members')
        .select('discord_id, nickname, global_name')
        .in('discord_id', [...ids]);
      memberByDiscord = new Map(((members ?? []) as Member[]).map(m => [m.discord_id, m]));
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/admin" className="text-blue hover:underline">← back to admin</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">📋 Raid-Helper sign-ups</h2>
        <p className="text-sm text-dim leading-6">
          Cross-references RaidHelper sign-ups with reality (OpenDKP ticks
          first; parses + <code>/who</code> as fallback) to surface no-shows,
          late arrivals, exceeded tentatives, and people who showed up
          without signing up. Sign-up data comes from two sources:
        </p>
        <ul className="text-xs text-dim leading-6 list-disc ml-5 mt-2 space-y-1">
          <li><b>Now (preview):</b> Discord-embed scrape via <code>/scanraidhelper</code> — pulls Discord-mention sign-ups from the embed fields of the RH bot&apos;s posts in the sign-up channel.</li>
          <li><b>Once enabled:</b> Raid-Helper REST API every 30 min — full sign-up records including class, spec, signup time, decline reasons, plus signups RH stores but doesn&apos;t render in the embed.</li>
        </ul>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
          <Stat label="Events" value={events.length} />
          <Stat label="Sign-ups" value={totalSignups} />
          <Stat label="Going" value={totalGoing} color="text-green" />
          <Stat label="Tentative" value={totalTentative} color="text-orange" />
        </div>
        <form method="GET" className="mt-4 text-xs flex items-center gap-2">
          <span className="text-dim">Last</span>
          <select name="days" defaultValue={String(lookbackDays)}
            className="bg-bg border border-border rounded px-2 py-1 text-sm">
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
          </select>
          <button className="px-3 py-1 rounded border border-blue bg-[#1f6feb] text-white text-xs">Apply</button>
        </form>
      </section>

      {/* Pitch banner — visible at all times so a guild leader who clicks
          through gets the context without needing to be briefed first. */}
      <section className="bg-panel border border-blue rounded-lg p-5">
        <h3 className="text-base text-blue mb-2">Why the Raid-Helper API integration is worth setting up</h3>
        <div className="text-xs text-dim leading-6 space-y-2">
          <p>
            Today this page already works without the API — the embed scrape covers
            roughly 80% of the signal because RH renders most signups in the visible
            embed fields. But the API gets us things the embed never shows:
          </p>
          <ul className="list-disc ml-5 space-y-1">
            <li><b>Signup timing.</b> Did they sign up days in advance or 5 minutes before raid start? Distinguishes planners from last-minute hopefuls.</li>
            <li><b>Spec / role tracked separately from class.</b> The embed shows &quot;Cleric&quot; in a list; the API tells us &quot;Cleric — main heal&quot; vs &quot;Cleric — chain&quot;. Lets us audit comp coverage by spec.</li>
            <li><b>Sign-out tracking.</b> Members who signed up Going then withdrew an hour before raid are flagged in the API but invisible in the embed — they look identical to a clean no-show.</li>
            <li><b>Custom field state.</b> RH supports add-on questions (&quot;bringing alt?&quot;, &quot;buff specs?&quot;). The embed compresses these; the API returns the structured answer.</li>
            <li><b>Pagination.</b> The embed lists ~30 names per role before truncating; the API returns everyone. Matters for large raids.</li>
            <li><b>Server-wide attendance stats endpoint.</b> RH ships its own &quot;X attended N of last M raids&quot; — we cross-check our number against theirs to catch sync gaps.</li>
            <li><b>Realtime.</b> No more 100-message channel scrape; just incremental polling on the events that changed.</li>
          </ul>
          <p className="mt-2">
            <b>What it costs:</b> generate the key once in Discord (<code>/apikey refresh</code> then <code>/apikey show</code>), drop it into Railway as <code>RH_API_KEY</code>, redeploy. That&apos;s it — sync turns on automatically every 30 min and this page picks up the richer data without any other change.
          </p>
        </div>
      </section>

      {events.length === 0 ? (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim space-y-2">
          <p>No Raid-Helper events ingested yet. Two ways to fix:</p>
          <ul className="list-disc ml-5 space-y-1">
            <li>
              <b>Quick preview (no setup):</b> run <code>/scanraidhelper</code> in
              Discord and the bot will scrape the last 100 messages from the raid
              sign-up channel for RH embeds. Officer-only.
            </li>
            <li>
              <b>Permanent (better data):</b> set <code>RH_API_KEY</code> +{' '}
              <code>RH_SERVER_ID</code> env vars on Railway and the bot syncs every
              30 min.
            </li>
          </ul>
        </section>
      ) : !detail ? (
        <section className="bg-panel border border-border rounded-lg">
          <h3 className="text-sm text-orange px-4 py-3 border-b border-border">
            Events — last {lookbackDays} days
          </h3>
          <table className="w-full text-xs">
            <thead className="text-dim hidden sm:table-header-group">
              <tr className="border-b border-border">
                <th className="text-left px-2 sm:px-3 py-2 font-normal">When</th>
                <th className="text-left px-2 sm:px-3 py-2 font-normal">Event</th>
                <th className="text-left px-2 sm:px-3 py-2 font-normal hidden md:table-cell">Template</th>
                <th className="text-left px-2 sm:px-3 py-2 font-normal">Drill</th>
              </tr>
            </thead>
            <tbody>
              {events.map(e => (
                <tr key={e.id} className="border-b border-border/40 hover:bg-[#1a212c]">
                  <td className="px-2 sm:px-3 py-2 text-dim whitespace-nowrap">
                    <div>{fmtTs(e.start_time)}</div>
                    <div className="text-[10px]">{relDay(e.start_time)}</div>
                  </td>
                  <td className="px-2 sm:px-3 py-2 text-text">
                    <div>{e.title || '—'}</div>
                    <div className="text-dim text-[10px] md:hidden">{e.template || ''}</div>
                  </td>
                  <td className="px-2 sm:px-3 py-2 text-dim hidden md:table-cell">{e.template || '—'}</td>
                  <td className="px-2 sm:px-3 py-2">
                    <Link href={`/admin/signups?event=${encodeURIComponent(e.id)}&days=${lookbackDays}`}
                          className="text-blue hover:underline text-[11px]">
                      reconcile →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <DetailView detail={detail} memberByDiscord={memberByDiscord} backHref={`/admin/signups?days=${lookbackDays}`} compMatch={compMatch} lookbackDays={lookbackDays} />
      )}
    </div>
  );
}

function DetailView({
  detail, memberByDiscord, backHref, compMatch, lookbackDays,
}: {
  detail: {
    event: RhEvent;
    signups: RhSignup[];
    showed: Set<string>;
    tickedSlot1: Set<string>;
    showedNoSignup: { discord_id: string; charName: string }[];
  };
  memberByDiscord: Map<string, Member>;
  backHref: string;
  compMatch: {
    templates: string[];
    selectedName: string | null;
    planned: CompGaps | null;
    actual: CompGaps | null;
    actualAsOf: string | null;
  } | null;
  lookbackDays: number;
}) {
  const { event, signups, showed, tickedSlot1, showedNoSignup } = detail;

  // Showed-going split by punctuality. tickedSlot1 = on time; in showed but
  // not slot1 = late arrival (ticked into slot 2/3/4 or just appeared via
  // parse/who later in the night).
  type Cohort = 'goingOnTime' | 'goingLate' | 'goingNoshow' | 'tentShowed' | 'tentNoshow' | 'absence' | 'bench' | 'other';
  const buckets: Record<Cohort, RhSignup[]> = {
    goingOnTime: [], goingLate: [], goingNoshow: [], tentShowed: [], tentNoshow: [], absence: [], bench: [], other: [],
  };
  for (const s of signups) {
    const b = bucketStatus(s.status);
    const d = s.discord_id;
    const did    = d ? showed.has(d) : false;
    const onTime = d ? tickedSlot1.has(d) : false;
    if (b === 'going') {
      if (did && onTime)   buckets.goingOnTime.push(s);
      else if (did)        buckets.goingLate.push(s);
      else                 buckets.goingNoshow.push(s);
    }
    else if (b === 'tentative') (did ? buckets.tentShowed  : buckets.tentNoshow).push(s);
    else if (b === 'absence')   buckets.absence.push(s);
    else if (b === 'bench')     buckets.bench.push(s);
    else                        buckets.other.push(s);
  }

  function label(s: RhSignup) {
    const m = s.discord_id ? memberByDiscord.get(s.discord_id) : null;
    return m?.nickname || m?.global_name || s.user_name || s.discord_id || '?';
  }
  function labelByDiscord(d: string) {
    const m = memberByDiscord.get(d);
    return m?.nickname || m?.global_name || d;
  }

  return (
    <>
      <section className="bg-panel border border-border rounded-lg p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-base text-text">{event.title || '(no title)'}</h3>
            <div className="text-xs text-dim">{fmtTs(event.start_time)} · {event.template || '—'}</div>
          </div>
          <Link href={backHref} className="text-blue hover:underline text-xs">← all events</Link>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-4 text-xs">
          <Stat label="On time"   value={buckets.goingOnTime.length} color="text-green" />
          <Stat label="Late"      value={buckets.goingLate.length}   color="text-orange" />
          <Stat label="No-show"   value={buckets.goingNoshow.length} color="text-red-400" />
          <Stat label="Exceeded"  value={buckets.tentShowed.length}  color="text-blue" />
          <Stat label="Unsignaled" value={showedNoSignup.length}     color="text-purple" />
          <Stat label="Declined"  value={buckets.absence.length}     color="text-dim" />
        </div>
      </section>

      {compMatch && (
        <CompMatchPanel compMatch={compMatch} eventId={event.id} lookbackDays={lookbackDays} goingCount={buckets.goingOnTime.length + buckets.goingLate.length + buckets.goingNoshow.length} />
      )}

      {/* The interesting cohorts first */}
      <Cohort title="🔴 Signed Going · did NOT show" rows={buckets.goingNoshow} label={label} cls="text-red-400" />
      <Cohort title="🕐 Signed Going · ticked LATE (slot 2+)" rows={buckets.goingLate} label={label} cls="text-orange" />
      <Cohort title="🆕 Showed up · did NOT sign up" rows={showedNoSignup.map(x => ({ ...x }))} cls="text-purple" customRender={(x) =>
        <div className="text-text">
          {labelByDiscord((x as any).discord_id)}
          <span className="text-dim text-[10px] ml-2">via {(x as any).charName}</span>
        </div>
      } />
      <Cohort title="🟡 Signed Tentative · showed up" rows={buckets.tentShowed} label={label} cls="text-blue" />
      <Cohort title="🟠 Signed Tentative · no-show" rows={buckets.tentNoshow} label={label} cls="text-orange" />
      <Cohort title="🟢 Signed Going · on time (slot 1)" rows={buckets.goingOnTime} label={label} cls="text-green" collapsed />
      {buckets.absence.length > 0 && (
        <Cohort title="🚫 Declined" rows={buckets.absence} label={label} cls="text-dim" collapsed />
      )}
      {buckets.other.length > 0 && (
        <Cohort title="❓ Other / unparsed status" rows={buckets.other} label={label} cls="text-dim" collapsed />
      )}
    </>
  );
}

function Cohort({
  title, rows, label, cls, collapsed = false, customRender,
}: {
  title: string;
  rows: any[];
  label?: (r: any) => string;
  cls: string;
  collapsed?: boolean;
  customRender?: (r: any) => React.ReactNode;
}) {
  if (rows.length === 0) return null;
  const summary = `${title} (${rows.length})`;
  return (
    <section className="bg-panel border border-border rounded-lg">
      <details open={!collapsed}>
        <summary className={`cursor-pointer px-4 py-3 text-sm ${cls}`}>{summary}</summary>
        <ul className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1 text-xs">
          {rows.map((r, i) => (
            <li key={i} className="bg-bg border border-border rounded px-2 py-1">
              {customRender ? customRender(r) : (
                <div className="text-text">
                  {label!(r)}
                  {r.class_name && <span className="text-dim text-[10px] ml-2">{r.class_name}{r.spec_name ? ` · ${r.spec_name}` : ''}</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

// #93 — planned-vs-actual comp match for one event. Planned = the Going
// signups' classes vs the selected template; actual = the best raid_roster
// snapshot in the event window (when one exists). Pure math from web/lib/comp.
function CompMatchPanel({
  compMatch, eventId, lookbackDays, goingCount,
}: {
  compMatch: {
    templates: string[];
    selectedName: string | null;
    planned: CompGaps | null;
    actual: CompGaps | null;
    actualAsOf: string | null;
  };
  eventId: string;
  lookbackDays: number;
  goingCount: number;
}) {
  const { templates, selectedName, planned, actual, actualAsOf } = compMatch;
  const hasActual = !!actual;

  return (
    <section className="bg-panel border border-blue/50 rounded-lg p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h3 className="text-base text-blue">🧩 Comp vs template</h3>
        {templates.length > 0 && (
          <form method="GET" className="flex items-center gap-2 text-xs">
            <input type="hidden" name="event" value={eventId} />
            <input type="hidden" name="days" value={lookbackDays} />
            <span className="text-dim">Template</span>
            <select name="template" defaultValue={selectedName ?? templates[0]}
              className="bg-bg border border-border rounded px-2 py-1 text-sm">
              {templates.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="px-3 py-1 rounded border border-blue bg-[#1f6feb] text-white text-xs">Apply</button>
          </form>
        )}
      </div>

      {templates.length === 0 ? (
        <p className="text-xs text-dim">
          No comp templates yet — create one in <Link href="/admin/comp" className="text-blue hover:underline">🧩 Raid comp templates</Link>,
          then the gap check appears here.
        </p>
      ) : !planned ? (
        <p className="text-xs text-dim">Select a template.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-3 text-xs">
            {planned.summary.map((s, i) => {
              const cls = s.startsWith('Need') ? 'bg-red/15 border-red/50 text-red'
                : s.startsWith('Composition meets') ? 'bg-green/15 border-green/50 text-green'
                : 'bg-orange/15 border-orange/50 text-orange';
              return <span key={i} className={`px-2 py-0.5 rounded border ${cls}`}>{s}</span>;
            })}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-dim uppercase">
                <tr className="border-b border-border">
                  <th className="text-left px-2 py-1.5 font-normal">Archetype</th>
                  <th className="text-right px-2 py-1.5 font-normal">Need</th>
                  <th className="text-right px-2 py-1.5 font-normal">Signed</th>
                  <th className="text-right px-2 py-1.5 font-normal">Δ</th>
                  {hasActual && <th className="text-right px-2 py-1.5 font-normal">Live</th>}
                  {hasActual && <th className="text-right px-2 py-1.5 font-normal">Δ</th>}
                </tr>
              </thead>
              <tbody>
                {planned.archetypes.filter(a => a.required > 0 || a.have > 0).map(a => {
                  const act = actual?.archetypes.find(x => x.archetype === a.archetype);
                  return (
                    <tr key={a.archetype} className="border-b border-border/40">
                      <td className="px-2 py-1.5 text-text">{ARCHETYPE_LABEL[a.archetype]}</td>
                      <td className="px-2 py-1.5 text-right text-dim">{a.required}</td>
                      <td className="px-2 py-1.5 text-right text-text">{a.have}</td>
                      <td className={`px-2 py-1.5 text-right font-mono ${a.delta < 0 ? 'text-red' : a.delta > 0 ? 'text-orange' : 'text-green'}`}>
                        {a.delta > 0 ? `+${a.delta}` : a.delta}
                      </td>
                      {hasActual && <td className="px-2 py-1.5 text-right text-text">{act?.have ?? 0}</td>}
                      {hasActual && (
                        <td className={`px-2 py-1.5 text-right font-mono ${(act?.delta ?? 0) < 0 ? 'text-red' : (act?.delta ?? 0) > 0 ? 'text-orange' : 'text-green'}`}>
                          {(act?.delta ?? 0) > 0 ? `+${act?.delta}` : (act?.delta ?? 0)}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {planned.classes.some(c => c.required > 0) && (
            <div className="text-[11px] text-dim mt-2">
              Named-class needs: {planned.classes.filter(c => c.required > 0).map(c => `${c.class} ${c.have}/${c.required}`).join(' · ')}
            </div>
          )}

          <p className="text-[11px] text-dim mt-2 leading-5">
            <b>Signed</b> = {goingCount} &quot;Going&quot; signup{goingCount === 1 ? '' : 's'} ({planned.unmapped} unmapped/blank class).
            {hasActual
              ? <> <b>Live</b> = the raid_roster snapshot at {actualAsOf ? new Date(actualAsOf).toLocaleString() : '—'} ({actual!.totalHave} in raid). </>
              : <> No raid_roster snapshot landed in this event&apos;s window, so there is no live-actual column (no new capture is added for it — it appears automatically once a raid runs during the window). </>}
          </p>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, color = 'text-text' }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-bg border border-border rounded p-2 sm:p-3">
      <div className={`text-lg sm:text-2xl ${color}`}>{value.toLocaleString()}</div>
      <div className="text-dim text-[10px] sm:text-xs">{label}</div>
    </div>
  );
}
