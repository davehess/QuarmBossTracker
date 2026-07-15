'use client';

// Client half of /me/ui. Optimistic-ish editing per the admin-page pattern:
// server actions do the writes; useTransition drives the pending states; no
// router.refresh() — revalidatePath in the action keeps things fresh.
//
// 2026-07-15 (Uilnayar: "reorder/drag/drop would help a ton since reworking
// these in game is tedious"): the macro list is now a full 12-slot grid per
// page with HTML5 drag & drop — drop on an empty cell to MOVE, on another
// macro to SWAP. Moves stage through the same ui_pending_edits pipeline as
// edits (the agent's apply already handles key deletion), so the grid shows
// the NEW arrangement after Mimic applies it, not instantly. The common-macro
// library also gained a class filter (per-class carrier counts from the bot's
// recompute) defaulting to the selected character's class.

import { useMemo, useState, useTransition } from 'react';
import { stageMacroEdit, stageMacroMove, cancelPendingEdit } from './actions';
import type { MacroSuggestion } from '@/lib/macroSuggestions';

export type CharUiData = {
  name: string;
  clazz: string | null;
  snapshot: { id: string; label: string | null; created_at: string; file_count: number | null } | null;
  socials: { page: number; button: number; name: string | null; color: number | null; lines: string[] }[];
};
export type PendingRow = {
  id: number; character: string; note: string | null; status: string;
  error: string | null; created_at: string; applied_at: string | null;
};
export type CommonMacroRow = {
  name: string | null; lines: string[]; char_count: number;
  classes: Record<string, number> | null;
};

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
  // Drag state: source slot while a card is in flight; hover target for the
  // drop-cue outline. Cleared on drop/end.
  const [drag, setDrag] = useState<{ page: number; button: number } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);   // 'p|b'
  const [classFilter, setClassFilter] = useState<string | null>(null);
  const [classFilterTouched, setClassFilterTouched] = useState(false);

  const cur = useMemo(() => chars.find(c => c.name === sel) ?? null, [chars, sel]);
  const cellByKey = useMemo(() => {
    const m = new Map<string, CharUiData['socials'][number]>();
    for (const cell of cur?.socials ?? []) m.set(cell.page + '|' + cell.button, cell);
    return m;
  }, [cur]);

  // Pages to render: every page with content, plus one empty page of runway
  // (capped at EQ's 10) so there's always somewhere to drag into.
  const pages = useMemo(() => {
    const used = (cur?.socials ?? []).map(s => s.page);
    const maxUsed = used.length ? Math.max(...used) : 0;
    const n = Math.min(10, Math.max(1, maxUsed + 1));
    return Array.from({ length: n }, (_, i) => i + 1);
  }, [cur]);

  // Class filter defaults to the selected character's class once, until the
  // user picks a chip themselves.
  const classList = useMemo(() => {
    const s = new Set<string>();
    for (const m of common) for (const k of Object.keys(m.classes ?? {})) s.add(k);
    return [...s].sort();
  }, [common]);
  const effectiveClass = classFilterTouched
    ? classFilter
    : (cur?.clazz && classList.includes(cur.clazz) ? cur.clazz : null);
  const commonShown = useMemo(
    () => effectiveClass ? common.filter(m => (m.classes?.[effectiveClass] ?? 0) > 0) : common,
    [common, effectiveClass],
  );

  function firstEmptySlot(): { page: number; button: number } | null {
    for (let p = 1; p <= 10; p++) for (let b = 1; b <= 12; b++) {
      if (!cellByKey.has(p + '|' + b)) return { page: p, button: b };
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
  function openNew(prefill?: { name: string; lines: string[] }, slot?: { page: number; button: number }) {
    if (!cur) { setMsg('No character selected.'); return; }
    const target = slot ?? firstEmptySlot();
    if (!target) { setMsg('No empty social slots left on ' + cur.name + '.'); return; }
    const lines = [...(prefill?.lines ?? [])].slice(0, 5);
    while (lines.length < 5) lines.push('');
    setEditor({ character: cur.name, page: target.page, button: target.button, name: (prefill?.name ?? '').slice(0, 16), lines, isNew: true });
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

  function dropMove(to: { page: number; button: number }) {
    if (!cur || !drag) return;
    const from = drag;
    setDrag(null); setDragOver(null);
    if (from.page === to.page && from.button === to.button) return;
    const occupied = cellByKey.has(to.page + '|' + to.button);
    startTransition(async () => {
      const res = await stageMacroMove({ character: cur.name, from, to });
      if (!res.ok) { setMsg('❌ ' + (res.error || 'failed')); return; }
      setMsg('✓ ' + (occupied ? 'swap' : 'move') + ' staged — the grid re-arranges after Mimic applies it '
        + '(character logged out, ~5 min). If the macro is on a hot bar, re-drag that hot button in game — '
        + 'hot buttons point at slots, not macros.');
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
          <button key={c.name} onClick={() => { setSel(c.name); setEditor(null); setClassFilterTouched(false); setClassFilter(null); }}
            className={[
              'px-2.5 py-1 rounded border text-xs transition-colors',
              c.name === sel ? 'bg-accent border-accent text-white' : 'bg-panel border-border text-text hover:bg-[#21262d]',
            ].join(' ')}>
            {c.name}
            {c.clazz && <span className="text-dim ml-1">{c.clazz}</span>}
            {c.socials.length > 0 && <span className="text-dim ml-1">({c.socials.length})</span>}
          </button>
        ))}
      </div>

      {msg && <div className="text-sm text-text bg-panel border border-border rounded px-3 py-2">{msg}</div>}

      {/* Selected character — snapshot + macro grid */}
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
            <>
              <p className="text-[10px] text-dim leading-4">
                ✥ Drag a macro onto an empty cell to <b>move</b> it, onto another macro to <b>swap</b> —
                staged like any edit and applied while the character is logged out. Hot-bar buttons
                reference socials <b>by slot</b>: after a move, re-drag that hot button in game (same as
                rearranging the socials window by hand). Click an empty cell to create a macro in that
                exact slot.
              </p>
              <div className="space-y-2">
                {pages.map(p => (
                  <div key={p}>
                    <div className="text-[10px] uppercase tracking-wide text-dim mb-1">Page {p}</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(b => {
                        const key = p + '|' + b;
                        const cell = cellByKey.get(key);
                        const isDragSrc = drag && drag.page === p && drag.button === b;
                        const isOver = dragOver === key && !isDragSrc;
                        if (!cell) {
                          return (
                            <button key={key}
                              onClick={() => openNew(undefined, { page: p, button: b })}
                              onDragOver={e => { if (drag) { e.preventDefault(); setDragOver(key); } }}
                              onDragLeave={() => setDragOver(v => (v === key ? null : v))}
                              onDrop={e => { e.preventDefault(); dropMove({ page: p, button: b }); }}
                              className={[
                                'text-left border border-dashed rounded px-2.5 py-1.5 min-h-[44px] transition-colors',
                                isOver ? 'border-blue bg-[#1f6feb22]' : 'border-border/50 hover:border-border',
                              ].join(' ')}
                              title={'B' + b + ' — empty. Click to create here; drop a macro to move it here.'}>
                              <span className="text-[9px] text-dim">B{b}</span>
                            </button>
                          );
                        }
                        return (
                          <div key={key}
                            draggable
                            onDragStart={e => { setDrag({ page: p, button: b }); e.dataTransfer.effectAllowed = 'move'; }}
                            onDragEnd={() => { setDrag(null); setDragOver(null); }}
                            onDragOver={e => { if (drag && !isDragSrc) { e.preventDefault(); setDragOver(key); } }}
                            onDragLeave={() => setDragOver(v => (v === key ? null : v))}
                            onDrop={e => { e.preventDefault(); dropMove({ page: p, button: b }); }}
                            onClick={() => openEdit(cell)}
                            className={[
                              'text-left bg-bg border rounded px-2.5 py-1.5 transition-colors cursor-grab active:cursor-grabbing',
                              isDragSrc ? 'opacity-40 border-blue' : isOver ? 'border-blue bg-[#1f6feb22]' : 'border-border hover:border-blue',
                            ].join(' ')}
                            title={'Drag to move/swap · click to edit'}>
                            <div className="text-xs text-green font-semibold flex items-center gap-2">
                              {cell.name || <span className="text-dim italic">(unnamed)</span>}
                              <span className="text-[9px] text-dim font-normal ml-auto">B{cell.button}</span>
                            </div>
                            <div className="text-[10px] text-dim font-mono whitespace-pre-wrap leading-4 mt-0.5">
                              {cell.lines.join('\n') || '—'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
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
        {classList.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            <button onClick={() => { setClassFilter(null); setClassFilterTouched(true); }}
              className={[
                'px-2 py-0.5 rounded border text-[11px] transition-colors',
                effectiveClass === null ? 'bg-accent border-accent text-white' : 'bg-bg border-border text-dim hover:text-text',
              ].join(' ')}>
              All
            </button>
            {classList.map(cl => (
              <button key={cl} onClick={() => { setClassFilter(cl); setClassFilterTouched(true); }}
                className={[
                  'px-2 py-0.5 rounded border text-[11px] transition-colors',
                  effectiveClass === cl ? 'bg-accent border-accent text-white' : 'bg-bg border-border text-dim hover:text-text',
                ].join(' ')}>
                {cl}
              </button>
            ))}
          </div>
        )}
        {commonShown.length === 0 ? (
          <p className="text-xs text-dim">
            {common.length === 0
              ? 'Nothing aggregated yet — fills in as members run UI Studio backups.'
              : 'No common macros carried by that class yet — try All.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {commonShown.map((m, i) => (
              <div key={i} className="bg-bg border border-border rounded px-2.5 py-1.5">
                <div className="text-xs text-green font-semibold flex items-center gap-2">
                  {m.name || <span className="text-dim italic">(unnamed)</span>}
                  <span className="text-[9px] text-dim font-normal">
                    ×{m.char_count} characters
                    {effectiveClass && m.classes?.[effectiveClass]
                      ? <> · ×{m.classes[effectiveClass]} {effectiveClass}</>
                      : null}
                  </span>
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
