'use client';
// The scene player: two audience tabs ("For raiders", "For raid leaders and guild leaders"), a tab per overlay inside
// the audience when it has more than one, one stage and the beat's caption under it. Only the open clip is mounted,
// so the others are not downloaded until asked for. The stage is sized by the clip's own aspect ratio (w / h from the
// content module) and capped by the window height, so a tall clip never pushes the page off the screen. An audience
// with no clip would show no tab (none exists today), so a scene is added by adding a row to CLIPS.
import { useState, type KeyboardEvent } from 'react';
import { AUDIENCES, CLIPS, CLIPS_HEAD } from '@/lib/raidmimicLanding';
import SceneClip from './SceneClip';

const TAB = 'min-h-11 rounded-md border px-4 text-sm';
const ON = 'border-accent bg-accent text-[#f2ede1]';
const OFF = 'border-border bg-panel text-text hover:border-blue';

// Left / right (and Home / End) move between the tabs of one tablist, as a tablist is expected to.
function arrows(e: KeyboardEvent<HTMLDivElement>) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  const tabs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  e.preventDefault();
  const to = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[to].focus();
  tabs[to].click();
}

export default function ClipTabs() {
  const [i, setI] = useState(0);
  const clip = CLIPS[i];
  const audiences = AUDIENCES.filter(a => CLIPS.some(c => c.audience === a.id));
  const aud = audiences.find(a => a.id === clip.audience) ?? audiences[0];
  const scenes = CLIPS.map((c, n) => ({ c, n })).filter(x => x.c.audience === aud.id);
  return (
    <div>
      <div role="tablist" aria-label={CLIPS_HEAD.audienceLabel} onKeyDown={arrows} className="flex flex-wrap gap-2">
        {audiences.map(a => (
          <button key={a.id} type="button" role="tab" id={`aud-${a.id}`} aria-selected={a.id === aud.id}
            aria-controls="clip-stage" tabIndex={a.id === aud.id ? 0 : -1}
            onClick={() => setI(CLIPS.findIndex(c => c.audience === a.id))}
            className={`${TAB} ${a.id === aud.id ? ON : OFF}`}>
            {a.label}
          </button>
        ))}
      </div>
      <div id="clip-stage" role="tabpanel" aria-labelledby={`aud-${aud.id}`}>
        <p className="mt-3 text-sm leading-6 text-text">{aud.lead}</p>
        {scenes.length > 1 && (
          <div role="tablist" aria-label={CLIPS_HEAD.scenesLabel} onKeyDown={arrows} className="mt-3 flex flex-wrap gap-2">
            {scenes.map(({ c, n }) => (
              <button key={c.id} type="button" role="tab" id={`tab-${c.id}`} aria-selected={n === i}
                tabIndex={n === i ? 0 : -1} onClick={() => setI(n)}
                className={`${TAB} ${n === i ? ON : OFF}`}>
                {c.title}
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 rounded-md border border-border bg-bg p-2 sm:p-4">
          <div className="mx-auto" style={{ width: `min(100%, calc(75vh * ${clip.w} / ${clip.h}))` }}>
            <SceneClip key={clip.id} id={clip.id} />
          </div>
        </div>
        <div className="mt-3 max-w-[70ch]">
          <p className="text-xs uppercase tracking-widest text-gold">{clip.title} · {clip.step}</p>
          <h3 className="mt-1 text-lg text-[#f2ede1]">{clip.head}</h3>
          <p className="mt-1 text-sm leading-6 text-text">{clip.line}</p>
        </div>
      </div>
    </div>
  );
}
