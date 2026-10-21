'use client';

// "How to say this name": the saved respelling with a Listen button for everyone, and, for the character's
// owner only, an editor (text box with live preview, coaching tips, one-click alternates). The voice is the
// browser's speechSynthesis; Mimic speaks the saved respelling the same way in callouts.
// (the guild lead, 2026-10-14: "get player pronunciation right ... this can also exist for each character on
// their page.")

import { useEffect, useState, useTransition } from 'react';
import { coachingTips, speakText, suggestPronunciations, validSay } from '@/lib/pronounce';
import { savePronunciation } from './actions';

function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    synth.speak(new SpeechSynthesisUtterance(text));
  } catch { /* no voice available: the button just does nothing */ }
}

// Decided after mount, so the server render and the first client render agree.
function Listen({ text, label }: { text: string; label: string }) {
  const [voice, setVoice] = useState(false);
  useEffect(() => { setVoice('speechSynthesis' in window); }, []);
  if (!voice) return null;
  return (
    <button
      type="button"
      onClick={() => speak(speakText(text))}
      aria-label={label}
      title={label}
      className="min-h-[32px] min-w-[32px] px-2 rounded border border-border bg-bg text-blue hover:text-text hover:border-blue text-xs"
    >
      ▶
    </button>
  );
}

export default function PronounceSection({
  name, saved, canEdit,
}: { name: string; saved: string | null; canEdit: boolean }) {
  const [draft, setDraft] = useState(saved ?? '');
  const [current, setCurrent] = useState(saved);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const suggestions = canEdit ? suggestPronunciations(name) : [];
  const tips = canEdit ? coachingTips(name) : [];
  const trimmed = draft.trim();
  const changed = trimmed !== (current ?? '');
  const bad = trimmed !== '' && !validSay(trimmed);

  function save() {
    setMsg(null);
    start(async () => {
      const res = await savePronunciation(name, trimmed);
      if (res.ok) {
        setCurrent(trimmed || null);
        setMsg({ ok: true, text: trimmed ? 'Saved. Callouts will say it this way.' : 'Cleared. The name is read as spelled.' });
      } else {
        setMsg({ ok: false, text: res.error || 'Could not save.' });
      }
    });
  }

  return (
    <section className="bg-panel border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm text-blue flex items-center gap-2">
          <span aria-hidden>🗣️</span>
          <span>How to say this name</span>
        </h3>
        <span className="text-[9px] tracking-widest font-bold px-1.5 py-0.5 rounded bg-orange/20 border border-orange/60 text-orange uppercase">Beta</span>
      </div>

      <div className="mt-2 flex items-center gap-2 flex-wrap text-sm">
        {current ? (
          <>
            <span className="text-text font-mono">{current}</span>
            <Listen text={current} label={`Listen to ${name}`} />
          </>
        ) : (
          <>
            <span className="text-dim italic">Not set. Read as spelled.</span>
            <Listen text={name} label={`Listen to ${name} as spelled`} />
          </>
        )}
      </div>

      {canEdit && (
        <div className="mt-3 space-y-3 border-t border-border/50 pt-3">
          <div className="text-xs text-dim">This is your character. Spell how it sounds so callouts get it right.</div>

          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={e => { setDraft(e.target.value); setMsg(null); }}
              maxLength={60}
              spellCheck={false}
              autoCapitalize="off"
              aria-label={`How ${name} sounds`}
              placeholder={suggestions[0] ?? ''}
              className="flex-1 min-w-0 min-h-[36px] px-2 rounded border border-border bg-bg text-text text-sm font-mono"
            />
            {trimmed !== '' && !bad && <Listen text={trimmed} label="Preview what you typed" />}
          </div>
          {bad && <div className="text-xs text-red">Use letters, spaces, hyphens and apostrophes only.</div>}

          {suggestions.length > 0 && (
            <div>
              <div className="text-[10px] text-dim uppercase tracking-wide mb-1">Or pick one</div>
              <div className="flex flex-wrap gap-2">
                {suggestions.map(s => (
                  <span key={s} className="inline-flex items-stretch">
                    <button
                      type="button"
                      onClick={() => { setDraft(s); setMsg(null); }}
                      className={`min-h-[32px] px-2 rounded-l border text-xs font-mono ${
                        trimmed === s ? 'border-blue bg-blue/10 text-text' : 'border-border bg-bg text-text hover:border-blue'
                      }`}
                    >
                      {s}
                    </button>
                    <button
                      type="button"
                      onClick={() => speak(speakText(s))}
                      aria-label={`Listen to ${s}`}
                      title={`Listen to ${s}`}
                      className="min-h-[32px] min-w-[32px] px-2 rounded-r border border-l-0 border-border bg-bg text-blue hover:text-text text-xs"
                    >
                      ▶
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <ul className="text-xs text-dim list-disc pl-4 space-y-0.5">
            {tips.map(t => <li key={t}>{t}</li>)}
          </ul>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              disabled={pending || bad || !changed}
              onClick={save}
              className="min-h-[36px] px-3 rounded border border-blue bg-blue/10 text-blue hover:bg-blue/20 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {pending ? 'Saving…' : trimmed === '' && current ? 'Clear' : 'Save'}
            </button>
            {msg && <span className={`text-xs ${msg.ok ? 'text-green' : 'text-red'}`}>{msg.text}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
