'use client';

// Client editor for raid comp templates (#93). A JSON textarea with LIVE
// client-side validation + a rendered demand preview (same pure lib the server
// action re-checks with), following the /admin/overlays editor precedent. The
// matcher on /admin/signups reads a saved template by name.

import { useMemo, useState, useTransition } from 'react';
import {
  validateTemplate, templateDemand, ARCHETYPES, ARCHETYPE_LABEL, type CompTemplate,
} from '@/lib/comp';
import { saveCompTemplates, type SaveResult } from './actions';

type Preview = { name: string; total: number; arch: [string, number][]; classes: [string, number][] };

function analyze(text: string): { errors: string[]; previews: Preview[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { errors: [`JSON parse error: ${(e as Error).message}`], previews: [] };
  }
  if (!Array.isArray(parsed)) return { errors: ['Top level must be a JSON array of templates (use [] for none).'], previews: [] };

  const errors: string[] = [];
  const previews: Preview[] = [];
  const names = new Set<string>();
  parsed.forEach((t, i) => {
    const r = validateTemplate(t);
    if (!r.ok) { for (const e of r.errors) errors.push(`template[${i}]: ${e}`); return; }
    const key = r.template.name.trim().toLowerCase();
    if (names.has(key)) errors.push(`template[${i}]: duplicate name "${r.template.name}"`);
    names.add(key);
    const d = templateDemand(r.template as CompTemplate);
    previews.push({
      name: r.template.name,
      total: d.totalRequired,
      arch: ARCHETYPES.map(a => [ARCHETYPE_LABEL[a], d.requiredArch[a]] as [string, number]).filter(([, n]) => n > 0),
      classes: Object.entries(d.requiredClass).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]),
    });
  });
  return { errors, previews };
}

export default function CompEditor({ initialJson }: { initialJson: string }) {
  const [text, setText] = useState(initialJson);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [pending, startTransition] = useTransition();

  const { errors, previews } = useMemo(() => analyze(text), [text]);
  const dirty = text !== initialJson;

  function onSave() {
    setResult(null);
    startTransition(async () => setResult(await saveCompTemplates(text)));
  }

  return (
    <div className="space-y-4">
      <div>
        <textarea
          value={text}
          onChange={e => { setText(e.target.value); setResult(null); }}
          spellCheck={false}
          rows={18}
          className="w-full bg-bg border border-border rounded px-3 py-2 text-xs font-mono text-text leading-5"
        />
        <div className="flex items-center justify-between gap-3 mt-2">
          <div className="text-xs">
            {errors.length === 0
              ? <span className="text-green">✓ valid — {previews.length} template{previews.length === 1 ? '' : 's'}</span>
              : <span className="text-red">{errors.length} error{errors.length === 1 ? '' : 's'} — fix before saving</span>}
          </div>
          <button
            onClick={onSave}
            disabled={pending || errors.length > 0 || !dirty}
            className="px-4 py-2 rounded text-sm font-semibold bg-orange/80 hover:bg-orange text-bg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending ? 'Saving…' : 'Save templates'}
          </button>
        </div>
      </div>

      {result?.ok && <div className="text-xs text-green">Saved. The matcher on /admin/signups now offers these templates.</div>}
      {result && !result.ok && (
        <div className="text-xs text-red space-y-0.5">
          {result.errors.map((e, i) => <div key={i}>• {e}</div>)}
        </div>
      )}

      {errors.length > 0 && (
        <div className="bg-panel border border-red/40 rounded p-3 text-xs text-red space-y-0.5">
          {errors.slice(0, 20).map((e, i) => <div key={i}>• {e}</div>)}
          {errors.length > 20 && <div className="text-dim">…and {errors.length - 20} more</div>}
        </div>
      )}

      {previews.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm text-orange">Preview</div>
          {previews.map(p => (
            <div key={p.name} className="bg-panel border border-border rounded p-3">
              <div className="text-sm text-text mb-1">{p.name} <span className="text-dim text-xs">· {p.total} seats from groups</span></div>
              <div className="flex flex-wrap gap-2 text-xs">
                {p.arch.map(([label, n]) => (
                  <span key={label} className="px-2 py-0.5 rounded bg-bg border border-border text-text">{label}: {n}</span>
                ))}
              </div>
              {p.classes.length > 0 && (
                <div className="text-[11px] text-dim mt-2">
                  named classes: {p.classes.map(([c, n]) => `${c}×${n}`).join(', ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
