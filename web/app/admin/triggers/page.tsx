// Officer tool: guild-tuned raid triggers.
//
// Centralized version of what every raider used to maintain in their own
// GINA / EQLogParser pack. Officers add triggers here; agents poll
// /api/agent/guild-triggers every ~10 min and evaluate them locally
// against the log tail. Personal triggers (player's own private alerts)
// stay on each agent's disk and merge with the guild set — those don't
// touch this page.
//
// v1 actions supported in the agent: text_overlay (popup on the dashboard
// for N seconds). Other action types (tts / sound / discord / emit_event)
// are schema-ready and will light up as the agent action handlers ship.

import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

type TriggerRow = {
  id: string;
  name: string;
  category: string;
  enabled: boolean;
  source: string;
  pattern: string;
  pattern_flags: string;
  condition_expr: string | null;
  actions: any[];
  cooldown_seconds: number;
  applies_to_classes: string[] | null;
  notes: string | null;
  updated_at: string;
  created_by_name: string | null;
};

const CATEGORIES = ['callout', 'rampage', 'spawn', 'phase', 'mechanic', 'heal', 'ae', 'misc'];

async function actionAssertOfficer() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return null;
  if (!(await isOfficer(user.id))) return null;
  return user;
}

async function createOrUpdate(formData: FormData) {
  'use server';
  const u = await actionAssertOfficer();
  if (!u) redirect('/?error=admin_required');
  const id      = String(formData.get('id') || '').trim();
  const name    = String(formData.get('name') || '').trim().slice(0, 100);
  const category= String(formData.get('category') || 'callout').slice(0, 40);
  const pattern = String(formData.get('pattern') || '');
  const overlayText = String(formData.get('overlay_text') || '').slice(0, 200);
  const overlayColor = String(formData.get('overlay_color') || 'red');
  const overlayMs    = Math.max(500, Math.min(60000, parseInt(String(formData.get('overlay_ms') || '5000'), 10) || 5000));
  const cooldown     = Math.max(0, Math.min(3600, parseInt(String(formData.get('cooldown') || '0'), 10) || 0));
  const notes        = String(formData.get('notes') || '').slice(0, 1000) || null;
  const classesRaw   = String(formData.get('classes') || '').trim();
  const classes      = classesRaw ? classesRaw.split(',').map(s => s.trim()).filter(Boolean) : null;
  if (!name || !pattern || !overlayText) return;

  const admin = supabaseAdmin();
  const row = {
    name, category, pattern,
    pattern_flags: 'i',
    actions: [{ type: 'text_overlay', text: overlayText, color: overlayColor, duration_ms: overlayMs }],
    cooldown_seconds: cooldown,
    applies_to_classes: classes,
    notes,
    created_by_name: u!.email || null,
  };
  if (id) {
    await admin.from('guild_triggers').update(row).eq('id', id);
  } else {
    await admin.from('guild_triggers').insert([{ ...row, created_by_discord_id: u!.id }]);
  }
  revalidatePath('/admin/triggers');
}

async function toggleEnabled(formData: FormData) {
  'use server';
  if (!(await actionAssertOfficer())) redirect('/?error=admin_required');
  const id = String(formData.get('id') || '');
  const want = String(formData.get('want') || 'true') === 'true';
  if (!id) return;
  await supabaseAdmin().from('guild_triggers').update({ enabled: want }).eq('id', id);
  revalidatePath('/admin/triggers');
}

async function deleteTrigger(formData: FormData) {
  'use server';
  if (!(await actionAssertOfficer())) redirect('/?error=admin_required');
  const id = String(formData.get('id') || '');
  if (!id) return;
  await supabaseAdmin().from('guild_triggers').delete().eq('id', id);
  revalidatePath('/admin/triggers');
}

export default async function AdminTriggersPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; category?: string }>;
}) {
  const p = await searchParams;
  const admin = supabaseAdmin();
  let q: any = admin
    .from('guild_triggers')
    .select('id, name, category, enabled, source, pattern, pattern_flags, condition_expr, actions, cooldown_seconds, applies_to_classes, notes, updated_at, created_by_name')
    .order('category')
    .order('name');
  if (p.category) q = q.eq('category', p.category);
  const { data: rows } = await q;
  const triggers = (rows ?? []) as TriggerRow[];

  const editTarget = p.edit ? triggers.find(t => t.id === p.edit) : null;
  const overlayDefault = editTarget?.actions?.find?.((a: any) => a?.type === 'text_overlay') || {};

  const counts = {
    total: triggers.length,
    enabled: triggers.filter(t => t.enabled).length,
    byCat: new Map<string, number>(),
  };
  for (const t of triggers) {
    counts.byCat.set(t.category, (counts.byCat.get(t.category) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/admin" className="text-blue hover:underline">← back to admin</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">⚡ Raid triggers</h2>
        <p className="text-sm text-dim leading-6">
          Officer-tuned callouts that fire on the agent during raids. Agents
          poll <code>/api/agent/guild-triggers</code> every 10 min, merge
          with each player&apos;s local <code>personal_triggers.json</code>,
          and evaluate against the live log tail. v1 supports text-overlay
          actions; TTS / sound / Discord come next.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
          <Stat label="Total" value={counts.total} />
          <Stat label="Enabled" value={counts.enabled} color="text-green" />
          <Stat label="Categories" value={counts.byCat.size} color="text-blue" />
          <Stat label="Disabled" value={counts.total - counts.enabled} color="text-dim" />
        </div>
      </section>

      {/* Category filter */}
      <nav className="text-xs flex items-center gap-2 flex-wrap">
        <Toggle href="/admin/triggers" active={!p.category} label={`All (${counts.total})`} />
        {CATEGORIES.map(c => (
          <Toggle key={c} href={`/admin/triggers?category=${c}`} active={p.category === c} label={`${c} (${counts.byCat.get(c) ?? 0})`} />
        ))}
      </nav>

      {/* Create / edit form */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-sm text-orange mb-3">{editTarget ? `✏️ Edit: ${editTarget.name}` : '➕ New trigger'}</h3>
        <form action={createOrUpdate} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {editTarget && <input type="hidden" name="id" value={editTarget.id} />}
          <label className="space-y-1">
            <span className="text-dim block">Name</span>
            <input name="name" required defaultValue={editTarget?.name ?? ''}
              placeholder="e.g. Naggy full heal"
              className="w-full bg-bg border border-border rounded px-2 py-1.5" />
          </label>
          <label className="space-y-1">
            <span className="text-dim block">Category</span>
            <select name="category" defaultValue={editTarget?.category ?? 'callout'}
              className="w-full bg-bg border border-border rounded px-2 py-1.5">
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-dim block">Pattern (regex, case-insensitive). Use <code>{'(?<name>...)'}</code> for captures.</span>
            <input name="pattern" required defaultValue={editTarget?.pattern ?? ''}
              placeholder="^(?<npc>.+) goes on a RAMPAGE against (?<target>.+)!$"
              className="w-full bg-bg border border-border rounded px-2 py-1.5 font-mono" />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-dim block">Overlay text (templates: <code>{'{target}'}</code>, <code>{'{npc}'}</code>, any other named capture)</span>
            <input name="overlay_text" required defaultValue={overlayDefault.text ?? ''}
              placeholder="RAMPAGE on {target}"
              className="w-full bg-bg border border-border rounded px-2 py-1.5" />
          </label>
          <label className="space-y-1">
            <span className="text-dim block">Overlay color</span>
            <select name="overlay_color" defaultValue={overlayDefault.color ?? 'red'}
              className="w-full bg-bg border border-border rounded px-2 py-1.5">
              {['red','orange','yellow','green','blue','purple','white'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-dim block">Overlay duration (ms)</span>
            <input name="overlay_ms" type="number" min={500} max={60000} step={500}
              defaultValue={overlayDefault.duration_ms ?? 5000}
              className="w-full bg-bg border border-border rounded px-2 py-1.5" />
          </label>
          <label className="space-y-1">
            <span className="text-dim block">Cooldown (s) — refire suppression</span>
            <input name="cooldown" type="number" min={0} max={3600}
              defaultValue={editTarget?.cooldown_seconds ?? 0}
              className="w-full bg-bg border border-border rounded px-2 py-1.5" />
          </label>
          <label className="space-y-1">
            <span className="text-dim block">Classes (comma-sep, blank = everyone)</span>
            <input name="classes" defaultValue={(editTarget?.applies_to_classes ?? []).join(', ')}
              placeholder="Warrior, Paladin, Shadow Knight"
              className="w-full bg-bg border border-border rounded px-2 py-1.5" />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-dim block">Notes (officer-only context, optional)</span>
            <textarea name="notes" rows={2} defaultValue={editTarget?.notes ?? ''}
              className="w-full bg-bg border border-border rounded px-2 py-1.5" />
          </label>
          <div className="sm:col-span-2 flex items-center gap-2">
            <button type="submit" className="px-4 py-1.5 rounded border border-blue bg-[#1f6feb] text-white text-sm">
              {editTarget ? 'Save changes' : 'Create trigger'}
            </button>
            {editTarget && (
              <Link href="/admin/triggers" className="px-4 py-1.5 rounded border border-border bg-panel text-text text-sm">Cancel</Link>
            )}
          </div>
        </form>
      </section>

      {/* List */}
      <section className="bg-panel border border-border rounded-lg">
        <h3 className="text-sm text-orange px-4 py-3 border-b border-border">
          Triggers {p.category ? `· ${p.category}` : ''}
        </h3>
        {triggers.length === 0 ? (
          <div className="p-6 text-sm text-dim">No triggers in this category yet.</div>
        ) : (
          <ul className="divide-y divide-border/50">
            {triggers.map(t => {
              const ov = t.actions?.find?.((a: any) => a?.type === 'text_overlay');
              return (
                <li key={t.id} className="p-3 hover:bg-[#1a212c]">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={t.enabled ? 'text-text' : 'text-dim line-through'}>{t.name}</span>
                        <span className="text-dim text-[10px] px-1.5 py-0.5 rounded border border-border">{t.category}</span>
                        {t.cooldown_seconds > 0 && <span className="text-dim text-[10px]">cd {t.cooldown_seconds}s</span>}
                        {t.applies_to_classes && t.applies_to_classes.length > 0 && (
                          <span className="text-dim text-[10px]">[{t.applies_to_classes.join(', ')}]</span>
                        )}
                      </div>
                      <div className="text-dim text-[11px] font-mono break-all mt-1">{t.pattern}</div>
                      {ov && (
                        <div className="text-[11px] mt-1">
                          → <span style={{ color: ov.color || 'red' }}>{ov.text}</span>
                          <span className="text-dim ml-2">({ov.duration_ms || 5000}ms)</span>
                        </div>
                      )}
                      {t.notes && <div className="text-dim text-[10px] mt-1 italic">{t.notes}</div>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <form action={toggleEnabled}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="want" value={String(!t.enabled)} />
                        <button type="submit"
                          className={`px-2 py-1 rounded border text-[10px] ${t.enabled ? 'border-green text-green' : 'border-dim text-dim'}`}>
                          {t.enabled ? 'on' : 'off'}
                        </button>
                      </form>
                      <Link href={`/admin/triggers?edit=${t.id}${p.category ? `&category=${p.category}` : ''}`}
                        className="px-2 py-1 rounded border border-border text-[10px] text-blue hover:underline">
                        edit
                      </Link>
                      <form action={deleteTrigger}>
                        <input type="hidden" name="id" value={t.id} />
                        <button type="submit" className="px-2 py-1 rounded border border-red text-[10px] text-red-400"
                          formAction={deleteTrigger}>
                          delete
                        </button>
                      </form>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
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
