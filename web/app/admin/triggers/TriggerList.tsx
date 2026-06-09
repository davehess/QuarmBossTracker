'use client';

// Officer triggers list with optimistic toggle + delete.
//
// Why client-side: the previous server-rendered version revalidated the entire
// /admin/triggers page on every toggle/delete (Next.js `revalidatePath`),
// which made the whole list flash and lose scroll. Toggling 'on' on a single
// trigger shouldn't reload 90+ rows. We patch local state first, then call
// the server action — which still revalidates so other officers' sessions
// catch up, but the active user never sees the twitch.

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toggleTriggerEnabled, deleteTriggerRow } from './actions';

export type TriggerListRow = {
  id: string;
  name: string;
  category: string;
  enabled: boolean;
  pattern: string;
  cooldown_seconds: number;
  applies_to_classes: string[] | null;
  notes: string | null;
  actions: unknown[];
};

export default function TriggerList({
  triggers: initial,
  categorySuffix,
}: {
  triggers: TriggerListRow[];
  categorySuffix: string;   // '' or '&category=X' for the edit link
}) {
  const [rows, setRows] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  function patchRow(id: string, patch: Partial<TriggerListRow>) {
    setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }

  function onToggle(r: TriggerListRow) {
    const want = !r.enabled;
    setErr(null);
    patchRow(r.id, { enabled: want });
    startTransition(async () => {
      const res = await toggleTriggerEnabled(r.id, want);
      if (!res.ok) { patchRow(r.id, { enabled: r.enabled }); setErr(res.error ?? 'toggle failed'); }
      // Skip router.refresh() — revalidatePath on the server action already
      // updates the cache; the next nav to /admin/triggers gets fresh data.
      // Forcing a refresh here would re-introduce the very twitch we're
      // killing for everyone-but-the-toggling-user.
    });
  }

  function onDelete(r: TriggerListRow) {
    if (!window.confirm(`Delete trigger "${r.name}"?\nThis can't be undone from the UI.`)) return;
    setErr(null);
    const prev = rows;
    setRows(rs => rs.filter(x => x.id !== r.id));
    startTransition(async () => {
      const res = await deleteTriggerRow(r.id);
      if (!res.ok) { setRows(prev); setErr(res.error ?? 'delete failed'); }
      else router.refresh();
    });
  }

  if (rows.length === 0) {
    return <div className="p-6 text-sm text-dim">No triggers in this category yet.</div>;
  }

  return (
    <>
      {err && <div className="text-red text-xs px-4 pt-3">{err}</div>}
      <ul className="divide-y divide-border/50">
        {rows.map(t => {
          const ov = (Array.isArray(t.actions) ? t.actions : []).find(
            (a): a is { type: string; text?: string; color?: string; duration_ms?: number } =>
              !!a && typeof a === 'object' && (a as { type?: string }).type === 'text_overlay'
          );
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
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => onToggle(t)}
                    className={`px-2 py-1 rounded border text-[10px] disabled:opacity-50 ${t.enabled ? 'border-green text-green' : 'border-dim text-dim'}`}
                  >
                    {t.enabled ? 'on' : 'off'}
                  </button>
                  <Link href={`/admin/triggers?edit=${t.id}${categorySuffix}`}
                    className="px-2 py-1 rounded border border-border text-[10px] text-blue hover:underline">
                    edit
                  </Link>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => onDelete(t)}
                    className="px-2 py-1 rounded border border-red text-[10px] text-red-400 disabled:opacity-50"
                  >
                    delete
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
