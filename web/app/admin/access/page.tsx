// /admin/access: lock a member out of the guild's tools whatever Discord roles they hold (the guild lead,
// 2026-10-13: "I need an admin page to lock out members despite discord roles and invalidate mimic sessions").
// One row in member_lockouts is the whole switch; the website (middleware), Mimic's bot API and the bot's
// commands each read it. Discord itself is untouched. History is in the audit log ('member_lockout' /
// 'member_unlock'). See web/lib/lockout.ts and app/admin/access/actions.ts.
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { requireOfficer } from '@/lib/officer';
import { isActiveRow } from '@/lib/lockout';
import { selectAll } from '@/lib/selectAll';
import NewPageTag from '@/components/NewPageTag';
import { lockMember, unlockMember } from './actions';

export const metadata = {
  title: '[beta] Member access — Wolf Pack admin',
  description: 'Lock a member out of the guild tools whatever Discord roles they hold, and unlock them again.',
};

export const dynamic = 'force-dynamic';

type Member = { discord_id: string; nickname: string | null; global_name: string | null };
type Lock = { discord_id: string; reason: string | null; locked_by_discord_id: string; locked_at: string; until: string | null };

function label(m: Member | undefined, fallback: string): string {
  const a = m?.nickname?.trim();
  const b = m?.global_name?.trim();
  if (a && b && a !== b) return `${a} (${b})`;
  return a || b || fallback;
}

const fmtET = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtDayET = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });

const ERRORS: Record<string, string> = {
  pick_member:     'Pick the member to lock out.',
  reason_required: 'A reason is required, so the next officer knows why.',
  reason_long:     'Keep the reason to 200 characters.',
  self:            'You cannot lock yourself out.',
  bad_date:        'The end date must be a day in the future.',
  not_member:      'That person is not on the current member list.',
  lock_failed:     'Could not save the lockout (database error). Try again in a moment.',
  unlock_failed:   'Could not remove the lockout (database error). Try again in a moment.',
  no_actor:        'Your own officer record was not found, so the change was not made.',
};

export default async function AccessPage({
  searchParams,
}: {
  searchParams: { ok?: string; who?: string; n?: string; warn?: string; err?: string };
}) {
  await requireOfficer();
  const { ok, who, n, warn, err } = searchParams;
  const admin = supabaseAdmin();

  const [{ data: lockRows }, members] = await Promise.all([
    admin.from('member_lockouts').select('discord_id, reason, locked_by_discord_id, locked_at, until').order('locked_at', { ascending: false }).limit(500),
    selectAll<Member>((from, to) => admin
      .from('wolfpack_members')
      .select('discord_id, nickname, global_name')
      .eq('is_member', true)
      .order('discord_id')
      .range(from, to)),
  ]);

  const locks = ((lockRows || []) as Lock[]).filter(r => isActiveRow(r));
  const lockedIds = new Set(locks.map(l => l.discord_id));
  const byId = new Map(members.map(m => [m.discord_id, m]));

  // A locker or a locked member who has since left the member list still needs a name.
  const missing = Array.from(new Set(locks.flatMap(l => [l.discord_id, l.locked_by_discord_id]).filter(id => !byId.has(id))));
  if (missing.length) {
    const { data: extra } = await admin.from('wolfpack_members').select('discord_id, nickname, global_name').in('discord_id', missing);
    for (const m of (extra || []) as Member[]) byId.set(m.discord_id, m);
  }

  const pickable = members
    .filter(m => !lockedIds.has(m.discord_id))
    .sort((a, b) => label(a, a.discord_id).toLowerCase().localeCompare(label(b, b.discord_id).toLowerCase()));

  return (
    <div className="space-y-6">
      <NewPageTag />
      <div className="text-sm"><Link href="/admin" className="text-blue hover:underline">← back to admin</Link></div>

      <section className="bg-panel border border-border rounded-lg p-4 sm:p-6">
        <h1 className="text-xl text-gold mb-1">🚫 Member access</h1>
        <p className="text-sm text-dim leading-6">
          Lock a member out of our tools whatever Discord roles they hold: the website signs them out and shows
          a paused page, their Mimic stops being served and their sessions are revoked, and the bot declines
          their commands. Discord itself is untouched. A lock lifts when you unlock it, or at its end date.
          Changes reach Mimic and the bot within about 20 seconds.
        </p>
        {ok && (
          <p className="mt-3 text-sm text-green">
            ✓ {ok === 'locked'
              ? <><b>{who}</b> is locked out{warn ? '. Their Mimic sessions could not be revoked (database error); the lock still stops them.' : `. ${n ?? 0} Mimic session${n === '1' ? '' : 's'} revoked.`}</>
              : <><b>{who}</b> is unlocked.</>}
          </p>
        )}
        {err && <p className="mt-3 text-sm text-red">{ERRORS[err] || `Error: ${err}`}</p>}
      </section>

      <section className="bg-panel border border-border rounded-lg p-4 sm:p-6">
        <h2 className="text-lg text-orange mb-3">Lock a member out</h2>
        <form action={lockMember} className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-dim text-xs mb-1">Member</span>
            <select name="discord_id" required defaultValue="" className="bg-bg border border-border rounded px-3 py-2 min-w-[14rem]">
              <option value="" disabled>Pick a member…</option>
              {pickable.map(m => (
                <option key={m.discord_id} value={m.discord_id}>{label(m, m.discord_id)}</option>
              ))}
            </select>
          </label>
          <label className="text-sm flex-1 min-w-[14rem]">
            <span className="block text-dim text-xs mb-1">Reason (required, 200 characters at most)</span>
            <input name="reason" required maxLength={200} className="w-full bg-bg border border-border rounded px-3 py-2" />
          </label>
          <label className="text-sm">
            <span className="block text-dim text-xs mb-1">Until (optional, end of that day ET)</span>
            <input name="until" type="date" className="bg-bg border border-border rounded px-3 py-2" />
          </label>
          <button type="submit" className="bg-red/80 hover:bg-red text-white text-sm rounded px-4 py-2">Lock out</button>
        </form>
      </section>

      <section className="bg-panel border border-border rounded-lg">
        <h2 className="text-lg text-orange px-4 sm:px-6 pt-4 sm:pt-6 pb-2">Locked out now ({locks.length})</h2>
        <table className="w-full text-xs">
          <thead className="text-dim hidden sm:table-header-group">
            <tr className="border-b border-border">
              <th className="text-left px-3 py-2 font-normal">Member</th>
              <th className="text-left px-3 py-2 font-normal">Reason</th>
              <th className="text-left px-3 py-2 font-normal">Locked by</th>
              <th className="text-left px-3 py-2 font-normal">Locked</th>
              <th className="text-left px-3 py-2 font-normal">Until</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {locks.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-dim italic">Nobody is locked out.</td></tr>
            )}
            {locks.map(l => (
              <tr key={l.discord_id} className="border-b border-border/40 align-top">
                <td className="px-3 py-2 text-text">{label(byId.get(l.discord_id), l.discord_id)}</td>
                <td className="px-3 py-2 text-text">{l.reason || <span className="text-dim italic">none given</span>}</td>
                <td className="px-3 py-2 text-dim">{label(byId.get(l.locked_by_discord_id), l.locked_by_discord_id)}</td>
                <td className="px-3 py-2 text-dim whitespace-nowrap">{fmtET(l.locked_at)}</td>
                <td className="px-3 py-2 text-dim whitespace-nowrap">{l.until ? fmtDayET(l.until) : 'until unlocked'}</td>
                <td className="px-3 py-2 text-right">
                  <form action={unlockMember}>
                    <input type="hidden" name="discord_id" value={l.discord_id} />
                    <button type="submit" className="px-2 py-1 rounded border border-border text-dim hover:text-green hover:border-green/60">Unlock</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
