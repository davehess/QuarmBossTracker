'use client';
// The "Edit slides" drawer on /screen (officers only; the API refuses anyone else, this is only the form).
// Plain on purpose: a list of the deck with move / show / delete, and one form that adds a slide or edits
// the one picked. Every call answers with the fresh deck, which replaces the list. The limits shown here
// (title 120, body 2,000, https image) are the API's own, from lib/raidScreen.ts.
import { useCallback, useEffect, useState } from 'react';
import { BODY_MAX, SLIDES_MAX, TITLE_MAX, type ScreenSlide } from '@/lib/raidScreen';

const field = 'w-full rounded border border-border bg-bg px-2 py-1.5 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue';
const btn = 'rounded border px-2.5 py-1.5 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue disabled:opacity-40';
const btnIdle = `${btn} border-border bg-panel text-text hover:bg-[#21262d]`;
const btnPrimary = `${btn} border-accent bg-accent text-white hover:bg-accent/90`;

type Draft = { id?: string; title: string; body: string; imageUrl: string };
const EMPTY: Draft = { title: '', body: '', imageUrl: '' };

export default function SlideEditor({ onChanged, onShow }: {
  /** Called after any change to the deck, so the screen's own state is re-read at once. */
  onChanged: () => void;
  /** Put slide number `index` (0-based) on the screen. */
  onShow: (index: number) => void;
}) {
  const [slides, setSlides] = useState<ScreenSlide[] | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const call = useCallback(async (init?: RequestInit, query = '') => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/screen/slides' + query, { cache: 'no-store', ...init });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setErr(j?.error ?? `That did not work (${res.status}).`); return false; }
      if (Array.isArray(j?.slides)) setSlides(j.slides as ScreenSlide[]);
      return true;
    } catch {
      setErr('The slides did not answer. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void call(); }, [call]);

  const post = (payload: unknown) => call({
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await post({ id: draft.id, title: draft.title, body: draft.body, imageUrl: draft.imageUrl });
    if (ok) { setDraft(EMPTY); onChanged(); }
  };
  const move = async (id: string, dir: 'up' | 'down') => { if (await post({ action: 'move', id, dir })) onChanged(); };
  const remove = async (s: ScreenSlide) => {
    if (!window.confirm(`Delete "${s.title}"?`)) return;
    if (await call({ method: 'DELETE' }, `?id=${encodeURIComponent(s.id)}`)) {
      if (draft.id === s.id) setDraft(EMPTY);
      onChanged();
    }
  };

  const full = (slides?.length ?? 0) >= SLIDES_MAX && !draft.id;

  return (
    <section aria-label="Edit slides" className="rounded-md border border-border bg-panel p-3">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0">
          <h3 className="mb-2 text-[11px] uppercase tracking-wider text-dim">
            Deck{slides ? ` · ${slides.length} of ${SLIDES_MAX}` : ''}
          </h3>
          {!slides && <p className="text-xs text-dim">Loading the deck…</p>}
          {slides && slides.length === 0 && <p className="text-xs text-dim">No slides yet. Add the first one.</p>}
          <ol className="space-y-1">
            {(slides ?? []).map((s, i) => (
              <li key={s.id} className="flex items-center gap-1.5 rounded border border-border bg-bg px-2 py-1">
                <span className="w-5 shrink-0 text-right text-xs tabular-nums text-dim">{i + 1}</span>
                <button type="button" className="min-w-0 flex-1 truncate text-left text-sm text-text hover:underline"
                  title="Put this slide on the screen" onClick={() => onShow(i)}>
                  {s.title}
                </button>
                <button type="button" className={btnIdle} disabled={busy || i === 0} aria-label={`Move ${s.title} up`} onClick={() => move(s.id, 'up')}>▲</button>
                <button type="button" className={btnIdle} disabled={busy || i === slides!.length - 1} aria-label={`Move ${s.title} down`} onClick={() => move(s.id, 'down')}>▼</button>
                <button type="button" className={btnIdle} disabled={busy} aria-label={`Edit ${s.title}`}
                  onClick={() => setDraft({ id: s.id, title: s.title, body: s.body, imageUrl: s.imageUrl ?? '' })}>Edit</button>
                <button type="button" className={`${btnIdle} text-red`} disabled={busy} aria-label={`Delete ${s.title}`} onClick={() => remove(s)}>✕</button>
              </li>
            ))}
          </ol>
        </div>

        <form className="min-w-0 space-y-2" onSubmit={save}>
          <h3 className="text-[11px] uppercase tracking-wider text-dim">{draft.id ? 'Edit slide' : 'New slide'}</h3>
          <label className="block text-xs text-dim">
            Title
            <input className={field} value={draft.title} maxLength={TITLE_MAX} required
              onChange={e => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <label className="block text-xs text-dim">
            Text <span className="text-dim">(blank line = new paragraph, a line starting with &quot;- &quot; = bullet)</span>
            <textarea className={`${field} min-h-[8rem]`} value={draft.body} maxLength={BODY_MAX}
              onChange={e => setDraft({ ...draft, body: e.target.value })} />
            <span className="block text-right tabular-nums">{draft.body.length} / {BODY_MAX}</span>
          </label>
          <label className="block text-xs text-dim">
            Picture address (optional, https)
            <input className={field} type="url" inputMode="url" value={draft.imageUrl} maxLength={500}
              placeholder="https://…" onChange={e => setDraft({ ...draft, imageUrl: e.target.value })} />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={btnPrimary} disabled={busy || full}>{draft.id ? 'Save slide' : 'Add slide'}</button>
            {draft.id && <button type="button" className={btnIdle} onClick={() => setDraft(EMPTY)}>Cancel edit</button>}
            {full && <span className="text-xs text-orange">The deck is full ({SLIDES_MAX}).</span>}
          </div>
          {err && <p role="alert" className="text-xs text-red">{err}</p>}
        </form>
      </div>
    </section>
  );
}
