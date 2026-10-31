'use client';

// The /admin/theme form and its live preview. Nothing here round-trips until Save: the preview is the same
// markup every time, styled only by CSS variables (--wp-*) that the form values set on its wrapper. It names no
// Tailwind colour for the themable slots, because on production those are still hard-coded hex; reading the
// variables directly is what makes the preview honest on either side of the token layer.
//
// The checks in here are a courtesy. saveGuildTheme() validates again on the server.

import { useMemo, useState, useTransition } from 'react';
import {
  DEFAULT_THEME, FIXED_SLOTS, FONTS, FONT_KEYS, SLOT_LABELS, THEME_SLOTS,
  normalizeHex, normalizeStoredTheme, themeToCssVarMap, validateThemeInput,
  type GuildTheme, type ThemeErrors, type ThemeSlot,
} from '@/lib/guildThemeCore';
import { saveGuildTheme, resetGuildTheme } from './actions';

type Form = { slots: Record<ThemeSlot, string>; logoUrl: string; font: string; embedColor: string };

const toForm = (t: GuildTheme): Form => ({ slots: { ...t.slots }, logoUrl: t.logoUrl ?? '', font: t.font, embedColor: t.embedColor });

const rgb = (slot: ThemeSlot) => `rgb(var(--wp-${slot}))`;
const inputCls = 'w-full rounded border border-border bg-bg px-2 py-1 text-sm text-text placeholder:text-dim';

export default function ThemeEditor({ initial }: { initial: GuildTheme }) {
  const [saved, setSaved] = useState<GuildTheme>(initial);
  const [form, setForm] = useState<Form>(toForm(initial));
  const [serverErrors, setServerErrors] = useState<ThemeErrors>({});
  const [note, setNote] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [pending, start] = useTransition();

  const check = useMemo(() => validateThemeInput(form), [form]);
  const errors: ThemeErrors = { ...(check.ok ? {} : check.errors), ...serverErrors };
  // The preview never shows a half-typed value: each bad field falls back to today's for that field only.
  const live = useMemo(
    () => normalizeStoredTheme({ slots: form.slots, logo_url: form.logoUrl, font: form.font, embed_color: form.embedColor }),
    [form],
  );
  const vars = useMemo(() => themeToCssVarMap(live), [live]);
  const dirty = useMemo(() => JSON.stringify(live) !== JSON.stringify(saved), [live, saved]);

  const edit = (patch: Partial<Form>) => { setForm(f => ({ ...f, ...patch })); setServerErrors({}); setNote(null); };
  const setSlot = (s: ThemeSlot, v: string) => edit({ slots: { ...form.slots, [s]: v } });

  const onSave = () => start(async () => {
    const r = await saveGuildTheme(form);
    if (r.ok) {
      setSaved(r.theme); setForm(toForm(r.theme)); setServerErrors({});
      setNote({ kind: 'ok', text: r.changed.length ? `Saved. Changed: ${r.changed.join(', ')}.` : 'Saved. Nothing differed from before.' });
    } else {
      setServerErrors(r.errors ?? {});
      setNote({ kind: 'bad', text: r.error ?? 'Fix the highlighted fields and save again.' });
    }
  });

  const onReset = () => {
    if (!window.confirm('Reset every colour, the font, the logo and the embed colour to the defaults?')) return;
    start(async () => {
      const r = await resetGuildTheme();
      if (r.ok) {
        setSaved(r.theme); setForm(toForm(r.theme)); setServerErrors({});
        setNote({ kind: 'ok', text: 'Reset to the defaults.' });
      } else setNote({ kind: 'bad', text: r.error ?? 'Could not reset. Try again in a moment.' });
    });
  };

  const logoSrc = live.logoUrl ?? '/wolf.png';

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ── Form ─────────────────────────────────────────────── */}
      <form className="space-y-4 lg:order-1" onSubmit={e => { e.preventDefault(); if (check.ok && !pending) onSave(); }}>
        <section className="rounded-lg border border-border bg-panel p-4">
          <h2 className="mb-3 text-sm text-gold">Colours</h2>
          <div className="space-y-3">
            {THEME_SLOTS.map(s => {
              const err = errors[s];
              return (
                <div key={s}>
                  <label htmlFor={`slot-${s}`} className="block text-sm text-text">{SLOT_LABELS[s].label}</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="color" aria-label={`${SLOT_LABELS[s].label} picker`}
                      value={normalizeHex(form.slots[s]) ?? DEFAULT_THEME.slots[s]}
                      onChange={e => setSlot(s, e.target.value)}
                      className="h-9 w-12 shrink-0 cursor-pointer rounded border border-border bg-bg p-0.5"
                    />
                    <input
                      id={`slot-${s}`} type="text" inputMode="text" spellCheck={false} maxLength={7}
                      value={form.slots[s]} onChange={e => setSlot(s, e.target.value)}
                      aria-invalid={!!err} aria-describedby={err ? `slot-${s}-err` : undefined}
                      className={`${inputCls} max-w-[9rem] font-mono ${err ? 'border-red' : ''}`}
                    />
                    <button
                      type="button" onClick={() => setSlot(s, DEFAULT_THEME.slots[s])}
                      disabled={form.slots[s].toLowerCase() === DEFAULT_THEME.slots[s]}
                      className="px-2 py-1 text-xs text-blue hover:underline disabled:text-dim disabled:no-underline"
                    >today&apos;s</button>
                  </div>
                  <p className="mt-0.5 text-xs text-dim">{SLOT_LABELS[s].hint}</p>
                  {err && <p id={`slot-${s}-err`} className="mt-0.5 text-xs text-red">{err}</p>}
                </div>
              );
            })}
          </div>
          <div className="mt-4 border-t border-border pt-3">
            <h3 className="text-xs text-dim">Fixed everywhere (they carry meaning)</h3>
            <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-dim">
              {FIXED_SLOTS.map(f => (
                <li key={f.name} className="flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: f.hex }} />
                  {f.name}: {f.means}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-panel p-4">
          <h2 className="mb-3 text-sm text-gold">Font, logo and Discord</h2>
          <div className="space-y-3">
            <div>
              <label htmlFor="theme-font" className="block text-sm text-text">Font</label>
              <select
                id="theme-font" value={form.font} onChange={e => edit({ font: e.target.value })}
                aria-invalid={!!errors.font} className={`${inputCls} mt-1 max-w-xs`}
              >
                {FONT_KEYS.map(k => <option key={k} value={k}>{FONTS[k].label}</option>)}
              </select>
              {errors.font && <p className="mt-0.5 text-xs text-red">{errors.font}</p>}
            </div>
            <div>
              <label htmlFor="theme-logo" className="block text-sm text-text">Logo address</label>
              <input
                id="theme-logo" type="url" inputMode="url" spellCheck={false} placeholder="https://… (blank keeps the wolf)"
                value={form.logoUrl} onChange={e => edit({ logoUrl: e.target.value })}
                aria-invalid={!!errors.logoUrl} aria-describedby={errors.logoUrl ? 'theme-logo-err' : undefined}
                className={`${inputCls} mt-1 ${errors.logoUrl ? 'border-red' : ''}`}
              />
              {errors.logoUrl && <p id="theme-logo-err" className="mt-0.5 text-xs text-red">{errors.logoUrl}</p>}
            </div>
            <div>
              <label htmlFor="theme-embed" className="block text-sm text-text">Discord card colour</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="color" aria-label="Discord card colour picker"
                  value={normalizeHex(form.embedColor) ?? DEFAULT_THEME.embedColor}
                  onChange={e => edit({ embedColor: e.target.value })}
                  className="h-9 w-12 shrink-0 cursor-pointer rounded border border-border bg-bg p-0.5"
                />
                <input
                  id="theme-embed" type="text" spellCheck={false} maxLength={7}
                  value={form.embedColor} onChange={e => edit({ embedColor: e.target.value })}
                  aria-invalid={!!errors.embedColor}
                  className={`${inputCls} max-w-[9rem] font-mono ${errors.embedColor ? 'border-red' : ''}`}
                />
              </div>
              <p className="mt-0.5 text-xs text-dim">The stripe on Discord cards that carry no meaning of their own. Kill, death and warning cards keep their colours.</p>
              {errors.embedColor && <p className="mt-0.5 text-xs text-red">{errors.embedColor}</p>}
            </div>
          </div>
        </section>

        {errors.slots && <p role="alert" className="text-xs text-red">{errors.slots}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit" disabled={!check.ok || pending || !dirty}
            className="rounded border border-accent bg-accent px-4 py-2 text-sm text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >{pending ? 'Saving…' : 'Save theme'}</button>
          <button
            type="button" onClick={onReset} disabled={pending}
            className="rounded border border-border px-4 py-2 text-sm text-text hover:border-dim disabled:opacity-40"
          >Reset to defaults</button>
          <span role="status" aria-live="polite" className={`text-sm ${note?.kind === 'bad' ? 'text-red' : 'text-green'}`}>
            {note?.text ?? (dirty && check.ok ? <span className="text-dim">Unsaved changes.</span> : null)}
          </span>
        </div>
      </form>

      {/* ── Live preview ─────────────────────────────────────── */}
      <div className="lg:sticky lg:top-24 lg:self-start lg:order-2">
        <h2 className="mb-2 text-sm text-gold">Preview <span className="text-dim">(updates as you type)</span></h2>
        <div
          data-testid="theme-preview"
          style={{
            ...(vars as React.CSSProperties),
            background: rgb('bg'), color: rgb('text'), fontFamily: 'var(--wp-font-mono)',
            border: `1px solid ${rgb('border')}`, borderRadius: 8,
          }}
          className="space-y-4 p-4"
        >
          {/* Site header strip */}
          <div className="flex items-center gap-2" style={{ color: rgb('text') }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoSrc} alt="" width={28} height={28} style={{ width: 28, height: 28, objectFit: 'contain' }} />
            <b>Wolf Pack</b>
            <span style={{ color: rgb('blue') }}>Parses</span>
            <span style={{ color: rgb('blue') }}>Raid</span>
            <span style={{ marginLeft: 'auto', background: rgb('accent'), color: '#fff', borderRadius: 4, padding: '2px 10px', fontSize: 12 }}>Sign in</span>
          </div>

          {/* A fight card */}
          <div style={{ background: rgb('panel'), border: `1px solid ${rgb('border')}`, borderRadius: 6, padding: 12 }}>
            <div className="flex flex-wrap items-baseline gap-2">
              <b style={{ color: rgb('text') }}>Lord Nagafen</b>
              <span style={{ color: '#56d364', fontSize: 12 }}>KILL</span>
              <span style={{ color: rgb('dim'), fontSize: 12 }}>4:12 · 41 raiders</span>
              <span style={{ marginLeft: 'auto', color: '#d29922', fontSize: 12 }}>+3 DKP</span>
            </div>
            <div style={{ marginTop: 8 }}>
              {[['Aldenmar', 88, 'accent'], ['Brackwyn', 71, 'blue'], ['Corvale', 54, 'purple']].map(([n, pct, slot]) => (
                <div key={n as string} className="flex items-center gap-2" style={{ fontSize: 12, marginTop: 4 }}>
                  <span style={{ width: 72, color: rgb('text') }}>{n}</span>
                  <span style={{ flex: 1, height: 8, background: rgb('border'), borderRadius: 2 }}>
                    <span style={{ display: 'block', width: `${pct}%`, height: 8, background: rgb(slot as ThemeSlot), borderRadius: 2 }} />
                  </span>
                  <span style={{ width: 40, textAlign: 'right', color: rgb('dim') }}>{(Number(pct) * 14.2).toFixed(0)}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: rgb('dim') }}>
              Boss HP <span style={{ display: 'inline-block', verticalAlign: 'middle', width: 90, height: 6, background: '#f85149', borderRadius: 2 }} /> fixed red
            </div>
          </div>

          {/* An overlay row */}
          <div style={{ background: rgb('panel'), border: `1px solid ${rgb('border')}`, borderRadius: 4, padding: '6px 10px', fontSize: 13 }} className="flex items-center gap-2">
            <span style={{ color: rgb('dim') }}>Mez</span>
            <b style={{ color: rgb('text') }}>an orc oracle</b>
            <span style={{ marginLeft: 'auto', color: '#d29922' }}>0:09</span>
          </div>

          {/* A Discord card */}
          <div style={{ background: '#2b2d31', borderRadius: 4, padding: '8px 10px 10px', fontFamily: 'system-ui, sans-serif' }}>
            <div style={{ borderLeft: `4px solid ${live.embedColor}`, borderRadius: 3, paddingLeft: 10 }}>
              <div style={{ color: '#f2f3f5', fontWeight: 600, fontSize: 14 }}>Raid Boss Spawn Timers</div>
              <div style={{ color: '#dbdee1', fontSize: 13, marginTop: 2 }}>Next up: Lord Nagafen in 2h 14m</div>
              <div style={{ color: '#949ba4', fontSize: 11, marginTop: 6 }}>Wolf Pack · today at 8:02 PM</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
