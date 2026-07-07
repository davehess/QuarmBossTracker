'use client';

// Client half of /me/ui. Optimistic-ish editing per the admin-page pattern:
// server actions do the writes; useTransition drives the pending states; no
// router.refresh() — revalidatePath in the action keeps things fresh.

import { useMemo, useState, useTransition } from 'react';
import { stageMacroEdit, cancelPendingEdit } from './actions';
import type { MacroSuggestion } from '@/lib/macroSuggestions';

export type CharUiData = {
  name: string;
  snapshot: { id: string; label: string | null; created_at: string; file_count: number | null } | null;
  socials: { page: number; button: number; name: string | null; color: number | null; lines: string[] }[];
};
export type PendingRow = {
  id: number; character: string; note: string | null; status: string;
  error: string | null; created_at: string; applied_at: string | null;
};
export type CommonMacroRow = { name: string | null; lines: string[]; char_count: number };

type EditorState = {
  character: string;
  page: number;
  button: number;
  name: string;
  lines: string[];   // always length 5 in the editor
  isNew: boolean;
};

export default function UiStudioClient({ chars, pending, common, suggestions, hasDiscordLink }: {
  chars: CharUiData[];
  pending: PendingRow[];
  common: CommonMacroRow[];
  suggestions: MacroSuggestion[];
  hasDiscordLink: boolean;
}) {
  const [sel, setSel] = useState(chars.length ? chars[0].name : '');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const cur = useMemo(() => chars.find(c => c.name === sel) ?? null, [chars, sel]);
  const usedSlots = useMemo(() => {
    const s = new Set<string>();
    for (const cell of cur?.socials ?? []) s.add(cell.page + '|' + cell.button);
    return s;
  }, [cur]);

  function firstEmptySlot(): { page: number; button: number } | null {
    for (let p = 1; p <= 10; p++) for (let b = 1; b <= 12; b++) {
      if (!usedSlots.has(p + '|' + b)) return { page: p, button: b };
    }
    return null;
  }

  function openEdit(cell: CharUiData['socials'][number]) {
    if (!cur) return;
    const lines = [...cell.lines];
    while (lines.length < 5) lines.push('');
    setEditor({ character: cur.name, page: cell.page, button: cell.button, name: cell.name ?? '', lines, isNew: false });
    setMsg(null);
  }
  function openNew(prefill?: { name: string; lines: string[] }) {
    if (!cur) { setMsg('No character selected.'); return; }
    const slot = firstEmptySlot();
    if (!slot) { setMsg('No empty social slots left on ' + cur.name + '.'); return; }
    const lines = [...(prefill?.lines ?? [])].slice(0, 5);
    while (lines.length < 5) lines.push('');
    setEditor({ character: cur.name, page: slot.page, button: slot.button, name: (prefill?.name ?? '').slice(0, 16), lines, isNew: true });
    setMsg(null);
  }

  function submit() {
    if (!editor) return;
    startTransition(async () => {
      const res = await stageMacroEdit({
        character: editor.character, page: editor.page, button: editor.button,
        name: editor.name, lines: editor.lines,
      });
      if (!res.ok) { setMsg('❌ ' + (res.error || 'failed')); return; }
      setMsg('✓ staged — Mimic applies it once ' + editor.character + ' is logged out (~5 min).');
      setEditor(null);
    });
  }

  const statusChip = (s: string) =>
    s === 'applied' ? 'text-green' : s === 'failed' ? 'text-red' : s === 'cancelled' ? 'text-dim' : 'text-orange';

  if (!hasDiscordLink) {
    return (
      <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
        Your Discord account isn&apos;t linked to any characters yet — ask an officer to link you on
        /admin/links, then this page fills in.
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {/* Character picker */}
      <div className="flex flex-wrap gap-1.5">
        {chars.map(c => (
          <button key={c.name} onClick={() => { setSel(c.name); setEditor(null); }}
            className={[
              'px-2.5 py-1 rounded border text-xs transition-colors',
              c.name === sel ? 'bg-accent border-accent text-white' : 'bg-panel border-border text-text hover:bg-[#21262d]',
            ].join(' ')}>
            {c.name}
            {c.socials.length > 0 && <span className="text-dim ml-1">({c.socials.length})</span>}
          </button>
        ))}
      </div>

      {msg && <div className="text-sm text-text bg-panel border border-border rounded px-3 py-2">{msg}</div>}

      {/* Selected character — snapshot + macros */}
      {cur && (
        <section className="bg-panel border border-border rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-base text-orange">{cur.name}</h2>
            {cur.snapshot ? (
              <span className="text-xs text-dim">
                latest backup: {new Date(cur.snapshot.created_at).toLocaleString()}
                {cur.snapshot.label ? <> · “{cur.snapshot.label}”</> : null}
                {cur.snapshot.file_count != null ? <> · {cur.snapshot.file_count} files</> : null}
              </span>
            ) : (
              <span className="text-xs text-dim">no UI backup yet — open Mimic → UI Studio → ☁ Backup once</span>
            )}
            <button onClick={() => openNew()} disabled={busy}
              className="ml-auto px-2.5 py-1 rounded border border-blue text-blue text-xs hover:bg-[#1f6feb33]">
              + New macro
            </button>
          </div>

          {cur.socials.length === 0 ? (
            <p className="text-xs text-dim">
              No macros indexed for this character yet. They appear after the next UI Studio backup
              (Mimic → UI Studio → ☁ Backup) — or stage a new one with “+ New macro”.
            </p>
          ) : (
            <div className="space-y-2">
              {Array.from(new Set(cur.socials.map(s => s.page))).map(p => (
                <div key={p}>
                  <div className="text-[10px] uppercase tracking-wide text-dim mb-1">Page {p}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                    {cur.socials.filter(s => s.page === p).map(cell => (
                      <button key={cell.page + '-' + cell.button} onClick={() => openEdit(cell)}
                        className="text-left bg-bg border border-border rounded px-2.5 py-1.5 hover:border-blue transition-colors">
                        <div className="text-xs text-green font-semibold flex items-center gap-2">
                          {cell.name || <span className="text-dim italic">(unnamed)</span>}
                          <span className="text-[9px] text-dim font-normal ml-auto">B{cell.button}</span>
                        </div>
                        <div className="text-[10px] text-dim font-mono whitespace-pre-wrap leading-4 mt-0.5">
                          {cell.lines.join('\n') || '—'}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Editor */}
      {editor && (
        <section className="bg-panel border border-blue rounded-lg p-5 space-y-3">
          <div className="text-sm text-text font-semibold">
            {editor.isNew ? 'New macro' : 'Edit macro'} — {editor.character} · Page {editor.page} · Button {editor.button}
          </div>
          <label className="block text-xs text-dim">
            Button label
            <input value={editor.name} maxLength={16}
              onChange={e => setEditor({ ...editor, name: e.target.value })}
              className="mt-1 w-56 bg-bg border border-border rounded px-2 py-1 text-sm text-text font-mono" />
          </label>
          {editor.lines.map((l, i) => (
            <label key={i} className="block text-xs text-dim">
              Line {i + 1}
              <input value={l} maxLength={255}
                onChange={e => {
                  const lines = [...editor.lines]; lines[i] = e.target.value;
                  setEditor({ ...editor, lines });
                }}
                className="mt-1 w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text font-mono" />
            </label>
          ))}
          <p className="text-[10px] text-dim leading-4">
            %T (target) and %mana (Zeal) expand in-game — leave them literal. Replace any {'{PLACEHOLDER}'} before
            saving. Blanking a line deletes it from the ini.
          </p>
          <div className="flex gap-2">
            <button onClick={submit} disabled={busy}
              className="px-3 py-1.5 bg-orange/80 hover:bg-orange text-bg rounded text-sm font-semibold disabled:opacity-50">
              {busy ? 'Staging…' : 'Stage edit'}
            </button>
            <button onClick={() => setEditor(null)} disabled={busy}
              className="px-3 py-1.5 border border-border rounded text-sm text-dim hover:text-text">
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* Pending edits */}
      {pending.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-5">
          <h2 className="text-sm text-text font-semibold mb-2">Staged edits</h2>
          <div className="space-y-1">
            {pending.map(p => (
              <div key={p.id} className="flex items-center gap-2 text-xs">
                <span className={statusChip(p.status) + ' font-semibold uppercase text-[10px] w-16'}>{p.status}</span>
                <span className="text-text">{p.character}</span>
                <span className="text-dim">{p.note}</span>
                {p.error && <span className="text-red">({p.error})</span>}
                <span className="text-dim ml-auto">{new Date(p.created_at).toLocaleString()}</span>
                {p.status === 'pending' && (
                  <button disabled={busy}
                    onClick={() => startTransition(async () => { await cancelPendingEdit(p.id); })}
                    className="text-red hover:underline">cancel</button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Guild common macros */}
      <section className="bg-panel border border-border rounded-lg p-5">
        <h2 className="text-sm text-text font-semibold mb-1">🐺 Common macros in the guild</h2>
        <p className="text-xs text-dim mb-3">
          Macros carried by <b>3 or more</b> characters (below that they never show here — your personal
          macros stay private). “Use” copies one into the editor for the selected character.
        </p>
        {common.length === 0 ? (
          <p className="text-xs text-dim">Nothing aggregated yet — fills in as members run UI Studio backups.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {common.map((m, i) => (
              <div key={i} className="bg-bg border border-border rounded px-2.5 py-1.5">
                <div className="text-xs text-green font-semibold flex items-center gap-2">
                  {m.name || <span className="text-dim italic">(unnamed)</span>}
                  <span className="text-[9px] text-dim font-normal">×{m.char_count} characters</span>
                  <button onClick={() => openNew({ name: m.name ?? '', lines: m.lines })}
                    className="ml-auto text-blue text-[10px] hover:underline">Use →</button>
                </div>
                <div className="text-[10px] text-dim font-mono whitespace-pre-wrap leading-4 mt-0.5">{m.lines.join('\n')}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Suggestions */}
      <section className="bg-panel border border-border rounded-lg p-5">
        <h2 className="text-sm text-text font-semibold mb-1">📚 Suggested macros</h2>
        <p className="text-xs text-dim mb-3">
          Seeded from the raid&apos;s real callouts — the same shapes the CH-chain / DA / healer-mana overlays
          parse — plus clicky templates (including the bard stopsong → click → melody resume). Same catalog
          ships inside Mimic&apos;s UI Studio.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {suggestions.map(s => (
            <div key={s.id} className="bg-bg border border-border rounded px-2.5 py-1.5">
              <div className="text-xs text-green font-semibold flex items-center gap-2">
                {s.name}
                <span className="text-[9px] text-purple-300 font-normal">{s.who}</span>
                <button onClick={() => openNew({ name: s.btnName, lines: s.lines })}
                  className="ml-auto text-blue text-[10px] hover:underline">Use →</button>
              </div>
              <div className="text-[10px] text-dim font-mono whitespace-pre-wrap leading-4 mt-0.5">{s.lines.join('\n')}</div>
              <div className="text-[9px] text-dim leading-4 mt-1">{s.note}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
