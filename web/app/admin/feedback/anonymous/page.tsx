// Officer tool: anonymous feedback (AFB), the submissions from the form on eqmimic.quest.
//
// A separate list from /admin/feedback on purpose (the guild lead, 2026-10-08): AFB-<n> never mixes
// with FB-<n>. Everything here was cleaned before it was stored (web/lib/anonFeedbackClean.ts); the
// flags show WHAT KIND of thing was removed, never what it was. ip_hash is not selected: it exists
// only for the form's rate limit.

import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer, requireOfficer } from '@/lib/officer';
import { supabaseServer } from '@/lib/supabase-server';
import NewPageTag from '@/components/NewPageTag';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '[beta] Anonymous feedback',
  description: 'Reports and ideas sent from the Mimic feedback form without signing in.',
};

const STATUSES = ['new', 'read', 'done'] as const;

type AfbRow = {
  id: string;
  ref: number;
  submitted_at: string;
  category: string;
  message: string;
  discord_contact: string | null;
  client: string | null;
  app_version: string | null;
  platform: string | null;
  flags: string[] | null;
  status: string;
};

async function setStatus(formData: FormData) {
  'use server';
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user || !(await isOfficer(user.id))) redirect('/?error=admin_required');
  const id = String(formData.get('id') || '');
  const status = String(formData.get('status') || '');
  if (!id || !(STATUSES as readonly string[]).includes(status)) return;
  await supabaseAdmin().from('anon_feedback').update({ status }).eq('id', id);
  revalidatePath('/admin/feedback/anonymous');
}

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

const statusCls = (s: string) => (s === 'new' ? 'text-blue' : s === 'read' ? 'text-orange' : 'text-green');

export default async function AnonymousFeedbackPage() {
  await requireOfficer();
  const { data } = await supabaseAdmin()
    .from('anon_feedback')
    .select('id, ref, submitted_at, category, message, discord_contact, client, app_version, platform, flags, status')
    .order('submitted_at', { ascending: false })
    .limit(300);
  const rows = (data ?? []) as AfbRow[];

  return (
    <div className="space-y-6">
      <div className="text-sm flex gap-4 flex-wrap">
        <Link href="/admin" className="text-blue hover:underline">← back to admin</Link>
        <Link href="/admin/feedback" className="text-blue hover:underline">Member feedback (FB)</Link>
      </div>

      <NewPageTag note="New page, still being shaped." />

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">Anonymous feedback (AFB)</h2>
        <p className="text-sm text-dim leading-6">
          Reports sent from the form on eqmimic.quest, by people who are not signed in. Each was cleaned
          before it was saved: links, emails, IP addresses, keys, user-name paths, HTML and code-like text
          are replaced with <code>[removed]</code>, and the chips show which kinds were taken out. A Discord
          name appears only when the sender chose to leave one and it passed validation.
        </p>
      </section>

      {rows.length === 0 ? (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          Nothing yet.
        </section>
      ) : (
        <div className="space-y-3">
          {rows.map(r => (
            <section key={r.id} className="bg-panel border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 flex-wrap text-xs mb-2">
                <span className="font-bold text-text">AFB-{r.ref}</span>
                <span className={statusCls(r.status)}>{r.status}</span>
                <span className="text-dim">· {r.category}</span>
                <span className="text-dim">· {fmtTs(r.submitted_at)}</span>
                {r.client && <span className="text-dim">· {r.client}</span>}
                {r.app_version && <span className="text-dim">· v{r.app_version}</span>}
                {r.platform && <span className="text-dim">· {r.platform}</span>}
              </div>
              <div className="text-sm text-text whitespace-pre-wrap break-words">{r.message}</div>
              <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
                <span className="text-dim">
                  Discord: {r.discord_contact ? <span className="text-text">{r.discord_contact}</span> : 'none given'}
                </span>
                {(r.flags ?? []).map(f => (
                  <span key={f} className="px-1.5 py-0.5 rounded border border-orange/50 text-orange">{f}</span>
                ))}
              </div>
              <form action={setStatus} className="mt-3 flex items-center gap-2 text-xs">
                <input type="hidden" name="id" value={r.id} />
                <select name="status" defaultValue={r.status}
                  className="bg-bg border border-border rounded px-2 py-1 text-xs">
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button type="submit" className="px-3 py-1 rounded border border-blue bg-[#1f6feb] text-white text-xs">Save</button>
              </form>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
