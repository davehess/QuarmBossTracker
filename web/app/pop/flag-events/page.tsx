// /pop/flag-events: the flag-event board (the guild lead, 2026-11-02, option A: "Post an event, see who needs it").
// An officer posts "we are killing X on this night"; every member sees the coming events (the next 14 days, then the last
// 3 days as "recent") and, inside each, the characters that still need it. Calendar first; the other option in the demo
// (raidmimic.com/demo/events/needs) was demand first.
//
// New page, so it goes live with the [beta] tag. Members only: signed in AND a Wolf Pack member. Guild-wide, so it names
// other members' characters; that is the point of the page and the same people already see each other on /pop.
//
// Per event, three lists:
//   STILL NEED IT  a full read of the character's flags lacks a piece of the target (a real "no", ❌)
//   NOT RECORDED   no full read, so an absent flag only means nobody saw it (❓, never guessed into "need")
//   SIGNED         when the event links a Raid-Helper event: who signed up, and how many of them still need it
// The rule is web/lib/flagEventNeeds.ts through the real gate rules (popGateStatus.ts); the targets are
// web/lib/flagTargets.ts (shared with the raidmimic.com demo); the reads are ./load.ts; the writes ./actions.ts.
// No client script: the form posts, the details elements open on their own.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';
import NewPageTag from '@/components/NewPageTag';
import { eventWhen } from '@/lib/raidPlan';
import { FLAG_TARGETS, flagTargetByKey, type FlagTarget } from '@/lib/flagTargets';
import { splitNeeds, type Needs } from '@/lib/flagEventNeeds';
import { resolveSigned } from '@/lib/flagEventSigned';
import { ERROR_TEXT, NOTE_MAX, RECENT_DAYS, UPCOMING_DAYS, splitEventWindow } from '@/lib/flagEvents';
import { LIST_MIN_LEVEL } from '@/lib/listableChars';
import { loadBoard, loadCharsData, type BoardChar, type BoardData, type FlagEventRow, type RhOption } from './load';
import { deleteFlagEvent, postFlagEvent } from './actions';

export const metadata: Metadata = {
  title: '[beta] Flag events',
  description: 'Planes of Power flag events the officers have posted, and for each one which raiders still need it and who signed up.',
};

export const dynamic = 'force-dynamic';

type Params = { posted?: string; removed?: string; error?: string };

const PANEL = 'rounded-lg border border-border bg-panel p-3';
const FIELD = 'min-h-9 rounded border border-border bg-bg px-2 text-text';
const BTN = 'min-h-9 rounded border border-gold px-3 text-sm text-gold hover:bg-white/5';

function Names({ chars, tone }: { chars: { name: string; cls?: string | null }[]; tone: string }) {
  if (chars.length === 0) return <p className="m-0 text-xs text-dim">Nobody.</p>;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0 text-xs">
      {chars.map(c => (
        <li key={c.name} className={`rounded border px-1.5 py-0.5 ${tone}`}>
          {c.name}{c.cls && <span className="text-[10px] text-dim"> {c.cls}</span>}
        </li>
      ))}
    </ul>
  );
}

const H3 = 'm-0 text-[11px] uppercase tracking-wide text-dim';

function EventCard({ ev, target, needs, data, chars, officer, open, past }: {
  ev: FlagEventRow; target: FlagTarget | undefined; needs: Needs<BoardChar> | null; data: BoardData; chars: BoardChar[];
  officer: boolean; open: boolean; past: boolean;
}) {
  const rh = ev.rh_event_id ? data.rhById[ev.rh_event_id] : undefined;
  const signed = ev.rh_event_id ? resolveSigned(data.signups[ev.rh_event_id] ?? [], chars) : null;
  const needNames = new Set((needs?.need ?? []).map(c => c.name.toLowerCase()));
  const signedNeeding = signed ? signed.filter(s => s.char && needNames.has(s.char.name.toLowerCase())) : [];
  const stillUnsigned = signed && needs ? needs.need.filter(c => !signed.some(s => s.char?.name === c.name)) : [];
  const poster = data.posters[ev.posted_by_discord_id];
  return (
    <details open={open} className={PANEL}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="shrink-0 whitespace-nowrap rounded border border-border bg-bg px-2 py-1 text-xs text-text">{eventWhen(ev.starts_at)}</span>
        <span className="min-w-0 flex-1 text-text">
          {target ? target.label : `Unknown target (${ev.target_key})`}
          {target && <span className="block text-[11px] text-dim">{target.blurb}</span>}
        </span>
        {needs && <span className="text-xs text-orange">{needs.need.length} need it</span>}
        {signed && <span className="text-xs text-dim">{signed.length} signed</span>}
      </summary>

      {needs ? (
        <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <h3 className={H3}>Still need it · {needs.need.length}</h3>
            <Names chars={needs.need.map(c => ({ name: c.name, cls: c.class }))} tone="border-orange/50 text-text" />
            {needs.unsure.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[11px] uppercase tracking-wide text-dim">Not recorded · {needs.unsure.length}</summary>
                <div className="mt-1.5 flex flex-col gap-1.5">
                  <Names chars={needs.unsure.map(c => ({ name: c.name, cls: c.class }))} tone="border-border text-dim" />
                  <p className="m-0 text-[11px] text-dim">
                    No full read yet, so we do not guess. Ask them to paste the Seer&apos;s recital on the{' '}
                    <Link href="/pop/guide" className="text-blue hover:underline">PoP checklist</Link>.
                  </p>
                </div>
              </details>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className={H3}>Signed{signed ? ` · ${signed.length}` : ''}</h3>
            {signed ? (
              <>
                <Names chars={signed.map(s => ({ name: s.label, cls: s.char?.class }))} tone="border-green/40 text-text" />
                <p className="m-0 text-[11px] text-dim">
                  {signedNeeding.length} of them need it; {signed.length - signedNeeding.length} are coming to help.
                  {stillUnsigned.length > 0 && <> {stillUnsigned.length} who need it have not signed.</>}
                  {rh?.title && <> From the Raid-Helper event &ldquo;{rh.title}&rdquo;.</>}
                </p>
              </>
            ) : (
              <p className="m-0 text-xs text-dim">No Raid-Helper event linked, so there are no sign-ups to show.</p>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-3 border-t border-border pt-3 text-xs text-dim">This target is no longer in the list, so who needs it cannot be worked out.</p>
      )}

      {ev.note && <p className="mt-3 border-l-2 border-orange/60 pl-3 text-xs leading-5 text-dim">{ev.note}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-dim">
        <span>Posted by {poster ?? 'an officer'} (officer)</span>
        {!past && needs && (
          <button type="button" disabled aria-disabled="true" title={`Would ping the ${needs.need.length} who need it`}
                  className="min-h-8 cursor-not-allowed rounded border border-border px-2 text-xs text-dim opacity-60">
            Ping (coming soon)
          </button>
        )}
        {officer && (
          <form action={deleteFlagEvent} className="ml-auto">
            <input type="hidden" name="id" value={ev.id} />
            <button type="submit" className="min-h-8 rounded border border-red/50 px-2 text-xs text-red hover:bg-white/5">Remove event</button>
          </form>
        )}
      </div>
    </details>
  );
}

function PostForm({ options }: { options: RhOption[] }) {
  return (
    <section aria-labelledby="post-title" className={`${PANEL} flex flex-col gap-2`}>
      <h2 id="post-title" className="text-sm font-semibold text-gold">Post an event</h2>
      <form action={postFlagEvent} className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1 text-dim">Target
          <select name="target_key" required defaultValue="" className={FIELD}>
            <option value="" disabled>Pick a target</option>
            {FLAG_TARGETS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-dim">Date and time (Eastern)
          <input type="datetime-local" name="starts_at" required className={FIELD} />
        </label>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-dim">Note (optional)
          <input type="text" name="note" maxLength={NOTE_MAX} placeholder="Where to gather, what to bring" className={FIELD} />
        </label>
        <label className="flex flex-col gap-1 text-dim">Raid-Helper event (optional)
          <select name="rh_event_id" defaultValue="" className={FIELD}>
            <option value="">None</option>
            {options.map(o => (
              <option key={o.id} value={o.id}>{o.title ?? 'Untitled'}{o.start_time ? ` · ${eventWhen(o.start_time)}` : ''}</option>
            ))}
          </select>
        </label>
        <button type="submit" className={BTN}>Post event</button>
      </form>
      <p className="m-0 text-[11px] text-dim">
        The target comes from a list, so everyone says &quot;Tallon &amp; Vallon&quot; the same way and the page can tell who needs it.
        Linking a Raid-Helper event shows who signed up. Anyone with the officer role can remove an event.
      </p>
    </section>
  );
}

export default async function FlagEventsPage({ searchParams }: { searchParams: Params }) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/pop/flag-events');

  // Signed in is not enough: the page lists guild members' characters, so it needs a Wolf Pack member.
  const { data: member } = await supabaseAdmin().from('wolfpack_members').select('is_member').eq('user_id', user.id).maybeSingle();
  if (!member || (member as { is_member: boolean | null }).is_member === false) {
    return (
      <div className="mx-auto max-w-4xl py-2">
        <NewPageTag note="New page: the flag events officers have posted, and who still needs each one." />
        <h1 className="text-2xl text-gold">Flag events</h1>
        <p className="mt-3 rounded border border-border bg-panel p-3 text-sm text-dim">This page is for Wolf Pack members.</p>
      </div>
    );
  }

  const officer = await isOfficer(user.id);
  const now = new Date();

  let board: BoardData;
  let charsData: Awaited<ReturnType<typeof loadCharsData>>;
  try {
    [board, charsData] = await Promise.all([loadBoard(now, officer), loadCharsData()]);
  } catch (e) {
    return (
      <div className="mx-auto max-w-4xl py-2">
        <NewPageTag note="New page: the flag events officers have posted, and who still needs each one." />
        <h1 className="text-2xl text-gold">Flag events</h1>
        <p className="mt-3 rounded border border-red/50 bg-red/10 p-3 text-sm text-red">
          The events did not load ({e instanceof Error ? e.message : 'unknown error'}). Reload in a minute.
        </p>
      </div>
    );
  }

  const { upcoming, recent } = splitEventWindow(board.events, now);
  const chars = charsData.chars;
  // One split per target, however many events share it.
  const byTarget = new Map<string, Needs<BoardChar>>();
  const needsOf = (key: string): Needs<BoardChar> | null => {
    const t = flagTargetByKey(key);
    if (!t) return null;
    if (!byTarget.has(key)) byTarget.set(key, splitNeeds(t, chars, c => ({ flags: c.flags, fullRead: c.fullRead })));
    return byTarget.get(key) as Needs<BoardChar>;
  };
  const card = (ev: FlagEventRow, i: number, past: boolean) => (
    <EventCard key={ev.id} ev={ev} target={flagTargetByKey(ev.target_key)} needs={needsOf(ev.target_key)} data={board}
               chars={chars} officer={officer} open={!past && i === 0} past={past} />
  );

  const sp = searchParams ?? {};
  const err = sp.error ? ERROR_TEXT[sp.error] : undefined;

  return (
    <div className="mx-auto max-w-4xl py-2">
      <NewPageTag note="New page: the flag events officers have posted, and who still needs each one." />
      <h1 className="text-2xl text-gold">Flag events</h1>
      <p className="mt-1 max-w-3xl text-sm text-dim">
        The flag runs the officers have planned, and for each one the raiders who still need it. A raider counts as needing it only
        when their flags have been read in full (the Seer&apos;s recital or a #popflags read); otherwise they are listed as not recorded.
        Characters are the guild&apos;s at level {LIST_MIN_LEVEL} and up, without traders or hidden characters.
      </p>
      <p className="mt-1 text-xs text-dim">
        <Link href="/pop/guide" className="text-blue hover:underline">PoP checklist</Link>
        {' · '}
        <Link href="/pop" className="text-blue hover:underline">PoP flags</Link>
      </p>

      {err && <p role="alert" className="mt-3 rounded border border-red/50 bg-red/10 p-2 text-sm text-red">{err}</p>}
      {sp.posted && <p role="status" className="mt-3 rounded border border-green/40 bg-green/10 p-2 text-sm text-green">Event posted.</p>}
      {sp.removed && <p role="status" className="mt-3 rounded border border-border bg-panel p-2 text-sm text-dim">Event removed.</p>}

      <div className="mt-4 flex flex-col gap-4">
        {officer && <PostForm options={board.options} />}

        <section aria-labelledby="upcoming-title" className="flex flex-col gap-2">
          <h2 id="upcoming-title" className="text-sm font-semibold uppercase tracking-wider text-dim">Coming up · next {UPCOMING_DAYS} days</h2>
          {upcoming.length === 0
            ? <p className="m-0 rounded border border-border bg-panel p-3 text-sm text-dim">No flag events are posted for the next {UPCOMING_DAYS} days.</p>
            : upcoming.map((ev, i) => card(ev, i, false))}
        </section>

        {recent.length > 0 && (
          <section aria-labelledby="recent-title" className="flex flex-col gap-2">
            <h2 id="recent-title" className="text-sm font-semibold uppercase tracking-wider text-dim">Recent · last {RECENT_DAYS} days</h2>
            {recent.map((ev, i) => card(ev, i, true))}
          </section>
        )}

        <p className="text-[11px] text-dim">
          Flags are read from Mimic, the Seer&apos;s recital and each owner&apos;s own ticks, and refresh every few minutes
          (last read {new Date(charsData.fetchedAt).toISOString().slice(11, 16)} UTC). {chars.length} characters counted.
        </p>
      </div>
    </div>
  );
}
