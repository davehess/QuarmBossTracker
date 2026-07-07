// /admin/notices — compose "Mimic Mail" broadcasts (Uilnayar 2026-07-07:
// "a communications channel to notify users of critical elements, regardless
// of mimic version moving forward").
//
// Writes mimic_notices. Delivery (no redeploy, no Mimic release):
//   • every agent 3.2.0+ receives active notices on its ~90s tuning poll →
//     the Mimic dashboard header shows a pulsing ✉ with an unread dot;
//   • severity=critical additionally posts to Discord within ~60s
//     (MIMIC_NOTICE_CHANNEL_ID, falling back to TRIGGER_BROADCAST_CHANNEL_ID).
// Deactivating removes it from every dashboard on the next poll.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

type NoticeRow = {
  id: number;
  title: string;
  body: string;
  severity: string;
  active: boolean;
  created_by_name: string | null;
  created_at: string;
  expires_at: string | null;
  discord_posted_at: string | null;
};

async function _requireOfficer() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user || !(await isOfficer(user.id))) redirect('/?error=admin_required');
  return user;
}

async function createNotice(formData: FormData) {
  'use server';
  const user = await _requireOfficer();
  const title = String(formData.get('title') || '').trim().slice(0, 120);
  const body = String(formData.get('body') || '').trim().slice(0, 2000);
  const severity = formData.get('severity') === 'critical' ? 'critical' : 'info';
  const expiresDays = parseInt(String(formData.get('expires_days') || '0'), 10);
  if (!title || !body) return;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  await supabaseAdmin().from('mimic_notices').insert({
    guild_id: 'wolfpack',
    title,
    body,
    severity,
    created_by_discord_id: (user.app_metadata?.provider_id || meta.provider_id || null) as string | null,
    created_by_name: String(meta.full_name || meta.name || meta.preferred_username || 'officer'),
    expires_at: expiresDays > 0 ? new Date(Date.now() + expiresDays * 86400000).toISOString() : null,
  });
  revalidatePath('/admin/notices');
}

async function deactivateNotice(formData: FormData) {
  'use server';
  await _requireOfficer();
  const id = parseInt(String(formData.get('id') || ''), 10);
  if (!Number.isFinite(id)) return;
  await supabaseAdmin().from('mimic_notices').update({ active: false }).eq('id', id);
  revalidatePath('/admin/notices');
}

export default async function NoticesAdminPage() {
  const { data } = await supabaseAdmin()
    .from('mimic_notices')
    .select('*')
    .eq('guild_id', 'wolfpack')
    .order('id', { ascending: false })
    .limit(30);
  const rows = (data ?? []) as NoticeRow[];

  return (
    <div className="space-y-6 max-w-2xl">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-2">✉ Mimic Mail — member notices</h2>
        <p className="text-sm text-dim leading-6">
          Broadcasts to every Mimic user. Active notices reach every running Mimic (1.6+)
          within <b>~90 seconds</b> — the dashboard header shows a pulsing ✉ until read.{' '}
          <b>Critical</b> notices are also posted to Discord by the bot within ~60s.
          Works on every future Mimic version — no release needed to reach users.
        </p>
      </section>

      <form action={createNotice} className="bg-panel border border-border rounded-lg p-5 space-y-3">
        <div className="text-sm font-semibold text-text">New notice</div>
        <input name="title" required maxLength={120} placeholder="Title (e.g. Update Mimic before Sunday's raid)"
          className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text" />
        <textarea name="body" required maxLength={2000} rows={4}
          placeholder="Body — what happened, what to do, by when."
          className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text" />
        <div className="flex items-center gap-4 flex-wrap text-sm text-text">
          <label className="flex items-center gap-2">
            <input type="radio" name="severity" value="info" defaultChecked className="accent-blue" /> Info (✉ only)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="severity" value="critical" className="accent-orange" /> 🚨 Critical (✉ + Discord post)
          </label>
          <label className="flex items-center gap-2 ml-auto text-xs text-dim">
            auto-expire after
            <input type="number" name="expires_days" min={0} max={90} defaultValue={14}
              className="w-16 bg-bg border border-border rounded px-2 py-1 text-sm text-text" />
            days (0 = never)
          </label>
        </div>
        <button type="submit" className="px-4 py-2 bg-orange/80 hover:bg-orange text-bg rounded text-sm font-semibold">
          Publish notice
        </button>
      </form>

      <section className="bg-panel border border-border rounded-lg p-5">
        <div className="text-sm font-semibold text-text mb-3">History</div>
        {rows.length === 0 && <p className="text-xs text-dim">No notices yet.</p>}
        <div className="space-y-2">
          {rows.map(n => (
            <div key={n.id} className={`bg-bg border rounded px-3 py-2 ${n.active ? 'border-border' : 'border-border/40 opacity-60'}`}>
              <div className="flex items-center gap-2 text-sm">
                {n.severity === 'critical' && <span className="text-red font-bold text-xs">CRITICAL</span>}
                <span className="text-text font-semibold">{n.title}</span>
                <span className="text-dim text-xs ml-auto">{new Date(n.created_at).toLocaleString()}</span>
              </div>
              <div className="text-xs text-dim mt-1 whitespace-pre-wrap">{n.body}</div>
              <div className="flex items-center gap-3 mt-2 text-[11px] text-dim">
                <span>{n.created_by_name || '—'}</span>
                {n.expires_at && <span>expires {new Date(n.expires_at).toLocaleDateString()}</span>}
                {n.severity === 'critical' && (
                  <span>{n.discord_posted_at ? '✓ posted to Discord' : '⏳ Discord post pending (~60s)'}</span>
                )}
                {n.active ? (
                  <form action={deactivateNotice} className="ml-auto">
                    <input type="hidden" name="id" value={n.id} />
                    <button type="submit" className="text-red hover:underline">deactivate</button>
                  </form>
                ) : (
                  <span className="ml-auto">inactive</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
