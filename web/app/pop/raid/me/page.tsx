// /pop/raid/me: "Your flags for tonight" (the guild lead, 2026-10-26: "people sign up for raids as their class, which
// can be an alt and not their main ... we could give them a custom link that shows all of their characters and which
// steps they specifically need to do for theirs if flagging"; picked option A: "a link with a copy/paste box for the
// seer's info or popflags content").
//
// New page, so it goes live with the [beta] tag. Members only; you only ever see your own characters.
// Top: the character your sign-up for the next raid-helper event brings (BRINGING), its steps done and still needed.
// Under it: every other character of yours, collapsed. Last: the paste box (MeTools.tsx), where the Flag Seer's
// words fix your flags. The rules (which character, which are shown, which steps) are in web/lib/raidMe.ts and
// the reads in web/lib/raidMeLoad.ts; what a character holds is raidPreflags.ts loadHeld, the same read /pop/raid uses.
//
// `?steps=next` swaps the step source from the night's preflags to each line's next step (raidMe.ts); no param is
// the night's preflags.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { ownedCharacters } from '@/lib/ownedCharacters';
import { loadLevels } from '@/lib/listableChars';
import NewPageTag from '@/components/NewPageTag';
import { PLAN, eventWhen } from '@/lib/raidPlan';
import { loadHeld } from '@/lib/raidPreflags';
import { loadMySignup, loadNextEvent, type MySignup, type NextEvent } from '@/lib/raidMeLoad';
import { bringingFrom, chooseCharacters, stepSourceFrom, stepsFor, stepsLeft, targetNames, type ShownChar } from '@/lib/raidMe';
import MeSteps from './MeSteps';
import MeTools from './MeTools';

export const metadata: Metadata = {
  title: '[beta] Your flags for tonight',
  description: 'Your characters and the Planes of Power flag steps each one still needs for the next raid night, with where to stand and what to say.',
};

export const dynamic = 'force-dynamic';

type Night = { event: NextEvent | null; signup: MySignup | null; error: string | null };

async function loadNight(userId: string): Promise<Night> {
  try {
    const event = await loadNextEvent();
    const signup = event ? await loadMySignup(event.id, userId) : null;
    return { event, signup, error: null };
  } catch (e) {
    return { event: null, signup: null, error: e instanceof Error ? e.message : String(e) };
  }
}

const who = (c: ShownChar) => (
  <>
    <span className="text-dim">{c.cls ?? 'class unknown'}</span>
    {c.level != null && <span className="text-dim"> · L{c.level}</span>}
    <span className="text-dim"> · {c.isMain ? 'main' : 'alt'}</span>
  </>
);

export default async function RaidMePage({ searchParams }: { searchParams: Promise<{ steps?: string }> }) {
  const { steps: stepsParam } = await searchParams;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/pop/raid/me');

  const owned = await ownedCharacters(user.id);
  const [levels, night] = await Promise.all([
    loadLevels(supabaseAdmin(), owned.map(c => c.name)),
    loadNight(user.id),
  ]);
  const source = stepSourceFrom(stepsParam, night.event?.start_time ?? null);
  const bringing = bringingFrom(owned, night.signup);
  const shown = chooseCharacters(owned, levels, bringing?.name ?? null);

  let held = new Map<string, Set<string>>();
  let heldError: string | null = null;
  if (shown.length) {
    try { held = await loadHeld(shown.map(c => c.name)); }
    catch (e) { heldError = e instanceof Error ? e.message : String(e); }
  }
  const stepsOf = (c: ShownChar) => stepsFor(source, held.get(c.name.toLowerCase()) ?? new Set<string>());

  const lead = shown.find(c => c.bringing) ?? null;
  const rest = shown.filter(c => !c.bringing);
  const targets = targetNames(PLAN);

  return (
    <div className="mx-auto max-w-3xl py-2">
      <NewPageTag note="New page: your characters and the flag steps each one still needs for the raid." />
      <h1 className="text-2xl text-gold">Your flags for tonight</h1>
      <p className="mt-1 text-sm text-dim">
        {night.event ? <>{eventWhen(night.event.start_time)} · {night.event.title}</> : 'No raid sign-up event found yet.'}
      </p>
      <p className="mt-0.5 text-xs text-dim">
        {source === 'night'
          ? <>Targets: {targets.join(', ')}.</>
          : 'No flag plan is set for this night yet, so each character shows its next steps.'}
      </p>
      {night.error && <p className="mt-2 text-xs text-red">Could not read the sign-ups: {night.error}</p>}
      {heldError && <p className="mt-2 text-xs text-red">Could not read your flags: {heldError}</p>}

      {shown.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-panel p-3 text-sm text-dim">
          No characters of yours to show yet. They appear once Mimic sees them in your EQ logs; traders and characters
          under the lowest PoP level are left out.
        </p>
      ) : (
        <>
          {lead ? (
            <section className="mt-4 rounded-lg border border-gold bg-panel p-4" aria-label={`Bringing ${lead.name}`}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="rounded bg-gold/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-gold">BRINGING</span>
                <h2 className="text-lg text-text">{lead.name}</h2>
                <span className="text-sm">{who(lead)}</span>
              </div>
              <p className="mt-1 text-xs text-dim">
                You signed up as {night.signup?.class_name || 'a class we could not read'}. Wrong one? Every character is below.
              </p>
              <MeSteps steps={stepsOf(lead)} />
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <a href="#seer-paste" className="text-blue hover:underline">Paste what the Seer says</a>
                <Link href={`/pop/guide?c=${encodeURIComponent(lead.name)}`} className="text-blue hover:underline">Step-by-step guide</Link>
              </p>
            </section>
          ) : (
            <p className="mt-4 rounded-lg border border-border bg-panel p-3 text-xs text-dim">
              {night.event && !night.error
                ? <>We found no sign-up of yours for this raid, so nothing is marked as the character you are bringing. Every character is below.</>
                : <>Every character of yours is below.</>}
            </p>
          )}

          {rest.length > 0 && (
            <section className="mt-4 space-y-2" aria-label="Your other characters">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-dim">{lead ? 'Your other characters' : 'Your characters'}</h2>
              {rest.map(c => {
                const steps = stepsOf(c);
                const left = stepsLeft(steps);
                return (
                  <details key={c.name} className="rounded-lg border border-border bg-panel">
                    <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-0.5 p-3 text-sm">
                      <span className="text-text">{c.name}</span>
                      <span className="text-xs">{who(c)}</span>
                      <span className={`ml-auto text-xs ${left === 0 ? 'text-green' : 'text-orange'}`}>
                        {left === 0 ? 'all set ✓' : `${left} step${left === 1 ? '' : 's'} left ▸`}
                      </span>
                    </summary>
                    <div className="px-3 pb-3"><MeSteps steps={steps} /></div>
                  </details>
                );
              })}
            </section>
          )}

          <MeTools chars={shown.map(c => ({ name: c.name, cls: c.cls }))} initial={lead?.name ?? shown[0].name} />
        </>
      )}

      <p className="mt-8 text-xs text-dim">
        Traders and characters under the PoP floor are hidden · flags update as Mimic sees them.{' '}
        <Link href="/pop/raid" className="underline hover:text-text">Raid night plan</Link>
        {' · '}
        <Link href="/pop/guide" className="underline hover:text-text">PoP checklist</Link>
      </p>
    </div>
  );
}
