// /raid/sr: Soft Reserve for the next raid (the guild lead, 2026-10-26: loot picks are a Soft Reserve per raid;
// DECISIONS §448). You pick, for the character your sign-up brings, the drops you want first claim on. When one
// drops, reservers go first; a reserver may pass; an item nobody reserved is open to the whole raid as usual.
//
// New page, so it goes live with the [beta] tag. Members only. The rules are web/lib/softReserve.ts, the reads
// web/lib/softReserveLoad.ts, the pick action ./actions.ts and the officer settings /admin/soft-reserve.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';
import NewPageTag from '@/components/NewPageTag';
import { eventWhen } from '@/lib/raidPlan';
import { loadSrView } from '@/lib/softReserveLoad';
import { VISIBILITY_LABEL, lockLine } from '@/lib/softReserve';
import SrPicker from './SrPicker';

export const metadata: Metadata = {
  title: '[beta] Soft Reserve',
  description: 'Pick the drops you want first claim on for the next raid, for the character you are bringing.',
};

export const dynamic = 'force-dynamic';

export default async function SoftReservePage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/raid/sr');
  const officer = await isOfficer(user.id);
  const v = await loadSrView(user.id, officer);
  const { base, bringing } = v;
  const rules = base?.rules;
  const lockAt = rules?.lock_at ? eventWhen(rules.lock_at) : null;

  const canPick = !!(base && rules?.enabled && bringing && !v.locked);
  const closedNote = !base ? null
    : !rules?.enabled ? 'Soft Reserve is off for this raid.'
    : v.locked ? 'Picks are locked.'
    : !bringing ? 'You have no sign-up for this raid, so there is no character to pick for.'
    : null;

  return (
    <div className="mx-auto max-w-3xl py-2">
      <NewPageTag note="New page: pick the drops you want first claim on for the next raid." />
      <h1 className="text-2xl text-gold">Soft Reserve</h1>
      <p className="mt-1 text-sm text-dim">
        {base ? <>{eventWhen(base.event.start_time)} · {base.event.title}</> : 'No raid sign-up event found yet.'}
      </p>
      {v.error && <p className="mt-2 text-xs text-red">Could not read the raid: {v.error}</p>}

      <section className="mt-3 rounded-lg border border-border bg-panel p-3 text-xs text-dim" aria-label="How it works">
        <p>
          Reserve the drops you want. When one drops, the people who reserved it get it first. If you do not want it any
          more, pass and it goes to the next person who reserved it, then to everyone. Anything nobody reserved is open to the
          whole raid as usual: DKP on raid nights, rolls on event nights.
        </p>
        {rules && base && (
          <p className="mt-1">
            {rules.per_person} picks each{rules.per_boss != null && <>, up to {rules.per_boss} per boss</>}.{' '}
            {lockLine(rules, eventWhen(base.event.start_time), lockAt)}{' '}
            {rules.visibility === 'names' ? 'Names are open.'
              : rules.visibility === 'counts' ? 'You see how many reserved each item; names show when it drops.'
              : 'Who reserved what stays with the officers.'}
          </p>
        )}
      </section>

      {bringing && (
        <p className="mt-3 text-sm text-text">
          Picking for <b className="text-gold">{bringing.name}</b>
          {bringing.cls && <span className="text-dim"> · {bringing.cls}</span>}
          <span className="text-xs text-dim"> · the character your sign-up brings. Picks do not carry to your other characters.</span>
        </p>
      )}

      {base && base.targets.length === 0 && (
        <p className="mt-4 rounded-lg border border-border bg-panel p-3 text-sm text-dim">
          The officers have not picked this raid&apos;s bosses yet, so there is nothing to reserve. Check back soon.
        </p>
      )}

      {base && base.targets.length > 0 && rules && (
        <div className="mt-4">
          <SrPicker
            bosses={v.bosses}
            initialMine={v.mine}
            perPerson={rules.per_person}
            perBoss={rules.per_boss}
            canPick={canPick}
            closedNote={closedNote}
          />
          {base.targetSource === 'plan' && (
            <p className="mt-3 text-[11px] text-dim">These are the bosses on the <Link href="/pop/raid" className="underline hover:text-text">raid night plan</Link>.</p>
          )}
        </div>
      )}

      {officer && base && rules && (
        <p className="mt-4 text-xs text-dim">
          Officer: {VISIBILITY_LABEL[rules.visibility]} · {v.total} picks so far ·{' '}
          <Link href="/admin/soft-reserve" className="text-blue hover:underline">Soft Reserve settings</Link>
        </p>
      )}

      <p className="mt-8 text-xs text-dim">
        <Link href="/pop/raid/me" className="underline hover:text-text">Your flags for tonight</Link>
        {' · '}
        <Link href="/pop/raid" className="underline hover:text-text">Raid night plan</Link>
      </p>
    </div>
  );
}
