// Officer tool: feedback inbox.
//
// Bot v2.5.35+ mirrors every /feedback submission to the feedback table in
// addition to posting in the Discord thread. This page is the searchable /
// status-tracking surface; the Discord thread stays primary (with its
// Acknowledge / Not Implementing buttons).
//
// Actions: change status (new → acked → addressed | wont_fix | duplicate),
// add officer notes. Status updates timestamp + actor automatically.

import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer, requireOfficer } from '@/lib/officer';
import { supabaseServer } from '@/lib/supabase-server';
import { SHOT_BUCKET } from '@/lib/feedbackShots';

export const dynamic = 'force-dynamic';

type FeedbackRow = {
  id: string;
  submitted_at: string;
  submitter_discord_id: string | null;
  submitter_name: string | null;
  category: string | null;
  message: string;
  discord_msg_id: string | null;
  discord_msg_link: string | null;
  status: string;
  ref: number | null;
  acked_by: string | null;
  acked_at: string | null;
  addressed_by: string | null;
  addressed_at: string | null;
  notes: string | null;
  screenshot_paths: string[] | null;
};

async function actionAssertOfficer() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return null;
  if (!(await isOfficer(user.id))) return null;
  return user;
}

async function updateStatus(formData: FormData) {
  'use server';
  const u = await actionAssertOfficer();
  if (!u) redirect('/?error=admin_required');
  const id     = String(formData.get('id') || '');
  const status = String(formData.get('status') || '');
  const notes  = String(formData.get('notes')  || '').slice(0, 1000);
  if (!id || !status) return;

  const admin = supabaseAdmin();
  // The officer's Discord name, never their sign-in email (the guild lead, 2026-10-08: "Don't use email
  // in here for 'Addressed by'"). wolfpack_members keeps it, keyed by the signed-in user.
  const { data: member } = await admin
    .from('wolfpack_members')
    .select('nickname, global_name')
    .eq('user_id', u!.id)
    .maybeSingle();
  const actorName = member?.nickname || member?.global_name || 'an officer';
  const nowIso = new Date().toISOString();

  const patch: Record<string, any> = { status };
  if (status === 'acked') {
    patch.acked_by = actorName;
    patch.acked_at = nowIso;
  } else if (['addressed', 'wont_fix', 'duplicate'].includes(status)) {
    patch.addressed_by = actorName;
    patch.addressed_at = nowIso;
  }
  if (notes) patch.notes = notes;

  await admin.from('feedback').update(patch).eq('id', id);
  revalidatePath('/admin/feedback');
}

function statusChip(s: string): { label: string; cls: string } {
  if (s === 'new')       return { label: '🆕 new',          cls: 'text-blue' };
  if (s === 'acked')     return { label: '👀 acknowledged', cls: 'text-orange' };
  if (s === 'on_beta')   return { label: '🧪 on beta',      cls: 'text-purple' };
  if (s === 'addressed') return { label: '✅ addressed',    cls: 'text-green' };
  if (s === 'wont_fix')  return { label: '🚫 won’t fix',    cls: 'text-dim' };
  if (s === 'duplicate') return { label: '👯 duplicate',    cls: 'text-dim' };
  return { label: s, cls: 'text-dim' };
}

function fmtTs(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

type Params = { status?: string; category?: string };

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  await requireOfficer();
  const p = await searchParams;
  const admin = supabaseAdmin();
  let q: any = admin
    .from('feedback')
    .select('id, ref, submitted_at, submitter_discord_id, submitter_name, category, message, discord_msg_id, discord_msg_link, status, acked_by, acked_at, addressed_by, addressed_at, notes, screenshot_paths')
    .order('submitted_at', { ascending: false })
    .limit(300);
  if (p.status && p.status !== 'all') q = q.eq('status', p.status);
  if (p.category)                     q = q.eq('category', p.category);
  const { data } = await q;
  const rows = (data ?? []) as FeedbackRow[];

  // Screenshots (2026-09-26) live in a private bucket; this officer-only page
  // hands out one-hour signed links for the ones on screen.
  const shotPaths = rows.flatMap(r => r.screenshot_paths ?? []);
  const shotUrl = new Map<string, string>();
  if (shotPaths.length) {
    const { data: signed } = await admin.storage.from(SHOT_BUCKET).createSignedUrls(shotPaths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) shotUrl.set(s.path, s.signedUrl);
  }

  // Replies members wrote on /feedback/FB-<n> (feedback_replies), newest first. A separate read that fails
  // soft, so the inbox still loads before the table exists; the bot also posts each one under the report's
  // Discord card.
  type Reply = { feedback_id: string; author_discord_id: string; body: string; created_at: string };
  const repliesBy = new Map<string, Reply[]>();
  const { data: replyRows } = await admin.from('feedback_replies')
    .select('feedback_id, author_discord_id, body, created_at')
    .order('created_at', { ascending: false }).limit(1000);
  for (const x of (replyRows ?? []) as Reply[]) repliesBy.set(x.feedback_id, [...(repliesBy.get(x.feedback_id) ?? []), x]);

  // Category list — derived from the rows themselves for the filter dropdown
  const cats = Array.from(new Set(rows.map(r => r.category).filter(Boolean) as string[])).sort();

  // Counts (over current filter for the stat row, but always show new=open)
  const { data: countRows } = await admin.from('feedback').select('status');
  const allByStatus = new Map<string, number>();
  for (const r of (countRows ?? []) as { status: string }[]) {
    allByStatus.set(r.status, (allByStatus.get(r.status) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <div className="text-sm flex gap-4 flex-wrap">
        <Link href="/admin" className="text-blue hover:underline">← back to admin</Link>
        <Link href="/admin/feedback/anonymous" className="text-blue hover:underline">Anonymous feedback (AFB) →</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">📬 Feedback inbox</h2>
        <p className="text-sm text-dim leading-6">
          Searchable mirror of <code>/feedback</code> submissions. Bot
          v2.5.35+ mirrors every submission here in addition to posting in
          the Discord thread. Acknowledge / mark addressed / add notes from
          this page; the Discord thread buttons keep working independently.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 text-xs">
          <Stat label="New"        value={allByStatus.get('new')        ?? 0} color="text-blue" />
          <Stat label="Acked"      value={allByStatus.get('acked')      ?? 0} color="text-orange" />
          <Stat label="Addressed"  value={allByStatus.get('addressed')  ?? 0} color="text-green" />
          <Stat label="Won't fix"  value={allByStatus.get('wont_fix')   ?? 0} color="text-dim" />
          <Stat label="Duplicate"  value={allByStatus.get('duplicate')  ?? 0} color="text-dim" />
        </div>
      </section>

      <nav className="text-xs flex items-center gap-2 flex-wrap">
        <Toggle href="/admin/feedback?status=new" active={p.status === 'new' || !p.status} label="Open (new)" />
        <Toggle href="/admin/feedback?status=acked" active={p.status === 'acked'} label="Acked" />
        <Toggle href="/admin/feedback?status=addressed" active={p.status === 'addressed'} label="Addressed" />
        <Toggle href="/admin/feedback?status=all" active={p.status === 'all'} label="All" />
        {cats.length > 1 && (
          <form method="GET" className="ml-2 flex gap-1 items-center">
            <input type="hidden" name="status" value={p.status ?? 'new'} />
            <select name="category" defaultValue={p.category ?? ''}
              className="bg-bg border border-border rounded px-2 py-1 text-xs">
              <option value="">All categories</option>
              {cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className="px-2 py-1 rounded border border-blue bg-[#1f6feb] text-white text-xs">Filter</button>
          </form>
        )}
      </nav>

      {rows.length === 0 ? (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim leading-6">
          No feedback rows for this filter. If you expect data and see none,
          the bot may not have been updated to mirror submissions yet (look
          for bot v2.5.35+ in the version banner). The Discord feedback
          thread is still the canonical source.
        </section>
      ) : (
        <div className="space-y-3">
          {rows.map(r => {
            const chip = statusChip(r.status);
            const replies = repliesBy.get(r.id) ?? [];
            return (
              <section key={r.id} className="bg-panel border border-border rounded-lg p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    {/* FB-<ref>: the handle a commit closes it by ("Fixes FB-12"; utils/feedbackRefs.js). */}
                    {r.ref != null && <span className="font-bold text-text">FB-{r.ref}</span>}
                    <span className={`${chip.cls}`}>{chip.label}</span>
                    {r.category && <span className="text-dim">· {r.category}</span>}
                    <span className="text-dim">· {fmtTs(r.submitted_at)}</span>
                    <span className="text-dim">· by <span className="text-text">{r.submitter_name || '—'}</span></span>
                    {r.discord_msg_link && (
                      <a href={r.discord_msg_link} target="_blank" rel="noreferrer" className="text-blue hover:underline">↗ jump</a>
                    )}
                  </div>
                </div>
                <div className="text-sm text-text whitespace-pre-wrap break-words">{r.message}</div>
                {(r.screenshot_paths ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {(r.screenshot_paths ?? []).map((pth, i) => {
                      const url = shotUrl.get(pth);
                      return url ? (
                        <a key={pth} href={url} target="_blank" rel="noreferrer" title="Open full size">
                          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not an optimisable asset */}
                          <img src={url} alt={`Screenshot ${i + 1}`} className="h-24 w-auto max-w-[220px] object-cover rounded border border-border hover:border-blue" />
                        </a>
                      ) : (
                        <span key={pth} className="text-[11px] text-dim">screenshot {i + 1} unavailable</span>
                      );
                    })}
                  </div>
                )}
                {r.notes && (
                  <div className="text-xs text-dim mt-2 border-l-2 border-border pl-2">
                    <span className="text-orange">notes: </span>{r.notes}
                  </div>
                )}
                {replies.length > 0 && (
                  <div className="mt-2 text-xs">
                    <div className="text-blue">{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</div>
                    {replies.map((x, i) => (
                      <div key={i} className="border-l-2 border-border pl-2 mt-1">
                        <span className="text-dim">{x.author_discord_id === r.submitter_discord_id ? 'submitter' : 'officer'} · {fmtTs(x.created_at)}: </span>
                        <span className="text-text whitespace-pre-wrap break-words">{x.body}</span>
                      </div>
                    ))}
                  </div>
                )}
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer text-dim hover:text-blue">change status / add notes</summary>
                  <form action={updateStatus} className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={r.id} />
                    <select name="status" defaultValue={r.status}
                      className="bg-bg border border-border rounded px-2 py-1 text-xs">
                      <option value="new">new</option>
                      <option value="acked">acked</option>
                      <option value="on_beta">on beta</option>
                      <option value="addressed">addressed</option>
                      <option value="wont_fix">won't fix</option>
                      <option value="duplicate">duplicate</option>
                    </select>
                    <input name="notes" placeholder="officer notes (optional)" defaultValue={r.notes ?? ''}
                      className="bg-bg border border-border rounded px-2 py-1 text-xs flex-1 min-w-[200px]" />
                    <button type="submit" className="px-3 py-1 rounded border border-blue bg-[#1f6feb] text-white text-xs">Save</button>
                  </form>
                  {(r.acked_at || r.addressed_at) && (
                    <div className="text-[10px] text-dim mt-1">
                      {r.acked_at     && <>Acked by {r.acked_by} · {fmtTs(r.acked_at)} </>}
                      {r.addressed_at && <>· Addressed by {r.addressed_by} · {fmtTs(r.addressed_at)}</>}
                    </div>
                  )}
                </details>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color = 'text-text' }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-bg border border-border rounded p-3">
      <div className={`text-2xl ${color}`}>{value.toLocaleString()}</div>
      <div className="text-dim text-xs">{label}</div>
    </div>
  );
}

function Toggle({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={[
        'px-3 py-1 rounded border text-xs transition-colors no-underline',
        active ? 'border-blue bg-[#1f6feb33] text-blue' : 'border-border bg-bg text-text hover:border-blue',
      ].join(' ')}
    >
      {label}
    </Link>
  );
}
