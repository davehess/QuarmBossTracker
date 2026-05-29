// Officer tool: bulk-set characters.quarmy_url.
//
// /quarmy slash command writes one URL at a time; this page is the
// after-the-fact "fill it in for everyone" view. Today 0 of 113 active
// characters have a URL set, so the bulk-paste mode is the primary flow.
//
// Bulk-paste accepts one entry per line:
//
//   CharName  https://quarmy.com/profile/...
//   CharName | https://quarmy.com/...
//   CharName  https://...   # comments after URL are dropped
//
// Lines that don't match a known character are reported back without
// touching the DB.

import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

type CharRow = {
  name: string;
  main_name: string | null;
  class: string | null;
  rank: string | null;
  active: boolean;
  quarmy_url: string | null;
};

async function loadCharacters(): Promise<CharRow[]> {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from('characters')
    .select('name, main_name, class, rank, active, quarmy_url')
    .eq('guild_id', 'wolfpack')
    .order('active', { ascending: false })
    .order('name');
  return (data ?? []) as CharRow[];
}

async function actionAssertOfficer() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return false;
  return await isOfficer(user.id);
}

async function setQuarmy(formData: FormData) {
  'use server';
  if (!(await actionAssertOfficer())) redirect('/?error=admin_required');
  const name = String(formData.get('name') || '').trim();
  const url  = String(formData.get('url')  || '').trim();
  if (!name) return;
  const admin = supabaseAdmin();
  await admin.from('characters')
    .update({ quarmy_url: url || null })
    .eq('guild_id', 'wolfpack').eq('name', name);
  revalidatePath('/admin/quarmy');
}

// Bulk-paste parser. One entry per line; first token is character name,
// rest of the line is the URL (anything before a `#` comment). Empty lines
// and pure comments are skipped.
function parseBulk(text: string): { name: string; url: string }[] {
  const out: { name: string; url: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const hash = line.indexOf('#');
    if (hash >= 0) line = line.slice(0, hash).trim();
    // Split on whitespace or | — take first token as name, rest as URL
    const m = line.match(/^(\S+)\s*[|\s]\s*(\S.*)$/);
    if (!m) continue;
    const name = m[1].trim();
    const url  = m[2].trim();
    if (!name || !url) continue;
    out.push({ name, url });
  }
  return out;
}

async function bulkApply(formData: FormData) {
  'use server';
  if (!(await actionAssertOfficer())) redirect('/?error=admin_required');
  const text = String(formData.get('bulk') || '');
  const entries = parseBulk(text);
  if (entries.length === 0) {
    redirect('/admin/quarmy?msg=' + encodeURIComponent('No parseable lines.'));
  }
  const admin = supabaseAdmin();
  // Look up which names match a real character
  const namesLower = entries.map(e => e.name.toLowerCase());
  const { data: known } = await admin
    .from('characters')
    .select('name')
    .eq('guild_id', 'wolfpack');
  const knownLower = new Map<string, string>(
    ((known ?? []) as { name: string }[]).map(c => [c.name.toLowerCase(), c.name]),
  );

  let applied = 0;
  const missing: string[] = [];
  for (const e of entries) {
    const realName = knownLower.get(e.name.toLowerCase());
    if (!realName) { missing.push(e.name); continue; }
    await admin.from('characters')
      .update({ quarmy_url: e.url })
      .eq('guild_id', 'wolfpack').eq('name', realName);
    applied++;
  }
  const msg = `Applied ${applied}` + (missing.length ? ` · Unknown chars: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}` : '');
  redirect('/admin/quarmy?msg=' + encodeURIComponent(msg));
}

export default async function AdminQuarmyPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; show?: string }>;
}) {
  const { msg, show } = await searchParams;
  const showInactive = show === 'all';
  const chars = await loadCharacters();
  const visible = showInactive ? chars : chars.filter(c => c.active);

  const counts = {
    total: visible.length,
    set: visible.filter(c => !!c.quarmy_url).length,
    missing: visible.filter(c => !c.quarmy_url).length,
  };

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/admin" className="text-blue hover:underline">← back to admin</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">🎒 Quarmy URLs</h2>
        <p className="text-sm text-dim leading-6">
          Bulk-set <code>characters.quarmy_url</code>. Members can also set
          their own via <code>/quarmy set</code>; this page is the officer
          fast-path for filling them in across the roster.
        </p>
        <div className="grid grid-cols-3 gap-3 mt-4 text-xs">
          <Stat label={showInactive ? 'Characters' : 'Active'} value={counts.total} />
          <Stat label="With URL"    value={counts.set}     color="text-green" />
          <Stat label="Missing URL" value={counts.missing} color="text-orange" />
        </div>
      </section>

      {msg && (
        <section className="bg-[#1f6feb22] border border-blue rounded p-3 text-xs text-blue">{msg}</section>
      )}

      <nav className="text-xs flex items-center gap-2 flex-wrap">
        <Toggle href="/admin/quarmy" active={!showInactive} label="Active only" />
        <Toggle href="/admin/quarmy?show=all" active={showInactive} label="Include inactive" />
      </nav>

      {/* Bulk paste */}
      <section className="bg-panel border border-border rounded-lg p-4 space-y-2">
        <h3 className="text-sm text-orange">Bulk paste</h3>
        <p className="text-xs text-dim">
          One per line: <code>CharName  https://quarmy.com/profile/...</code> &nbsp;
          (separator can be whitespace or <code>|</code>; lines starting with <code>#</code> are ignored).
        </p>
        <form action={bulkApply} className="space-y-2">
          <textarea
            name="bulk"
            rows={8}
            placeholder={"Aimey  https://quarmy.com/profile/abc123\nAnty   https://quarmy.com/profile/def456"}
            className="w-full bg-bg border border-border rounded px-2 py-2 text-xs font-mono"
          />
          <button type="submit" className="px-4 py-1.5 rounded border border-blue bg-[#1f6feb] text-white text-sm">
            Apply
          </button>
        </form>
      </section>

      {/* Per-row edit */}
      <section className="bg-panel border border-border rounded-lg">
        <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[720px]">
          <thead className="text-dim">
            <tr className="border-b border-border">
              <th className="text-left px-3 py-2 font-normal">Character</th>
              <th className="text-left px-3 py-2 font-normal">Main</th>
              <th className="text-left px-3 py-2 font-normal">Class</th>
              <th className="text-left px-3 py-2 font-normal">Quarmy URL</th>
              <th className="text-left px-3 py-2 font-normal w-24">Save</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(c => (
              <tr key={c.name} className="border-b border-border/40 hover:bg-[#1a212c]">
                <td className="px-3 py-2 text-text">
                  {c.name}
                  {!c.active && <span className="text-dim text-[10px] ml-1">(inactive)</span>}
                </td>
                <td className="px-3 py-2 text-dim">{c.main_name && c.main_name !== c.name ? c.main_name : '—'}</td>
                <td className="px-3 py-2 text-dim">{c.class || '—'}</td>
                <td className="px-3 py-2">
                  <form action={setQuarmy} className="flex items-center gap-2" id={`f_${c.name}`}>
                    <input type="hidden" name="name" value={c.name} />
                    <input
                      name="url"
                      defaultValue={c.quarmy_url ?? ''}
                      placeholder="https://quarmy.com/..."
                      className="bg-bg border border-border rounded px-2 py-1 text-xs flex-1 min-w-[320px]"
                    />
                    {c.quarmy_url && (
                      <a href={c.quarmy_url} target="_blank" rel="noreferrer" className="text-blue text-[10px] hover:underline">↗</a>
                    )}
                  </form>
                </td>
                <td className="px-3 py-2">
                  <button form={`f_${c.name}`} type="submit" className="px-2 py-1 rounded border border-blue bg-[#1f6feb] text-white text-xs">
                    Save
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
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
