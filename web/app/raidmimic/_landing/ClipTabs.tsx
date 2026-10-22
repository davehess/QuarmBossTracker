'use client';
// The tabbed player for `?v=d`: one stage, a tab per clip, the caption under it. Only the open clip is mounted, so
// the other two are not downloaded until asked for. The stage is sized by the clip's own aspect ratio (w / h from the
// content module) and capped by the window height, so a tall clip never pushes the page off the screen.
import { useState } from 'react';
import { CLIPS, CLIPS_HEAD } from '@/lib/raidmimicLanding';
import SceneClip from './SceneClip';

export default function ClipTabs() {
  const [i, setI] = useState(0);
  const clip = CLIPS[i];
  return (
    <div>
      <div role="tablist" aria-label={CLIPS_HEAD.tabsLabel} className="flex flex-wrap gap-2">
        {CLIPS.map((c, n) => (
          <button key={c.id} type="button" role="tab" id={`tab-${c.id}`} aria-selected={n === i} aria-controls="clip-stage"
            onClick={() => setI(n)}
            className={`min-h-11 rounded-md border px-4 text-sm ${n === i ? 'border-accent bg-accent text-[#f2ede1]' : 'border-border bg-panel text-text hover:border-blue'}`}>
            {c.title}
          </button>
        ))}
      </div>
      <div id="clip-stage" role="tabpanel" aria-labelledby={`tab-${clip.id}`}
        className="mt-3 rounded-md border border-border bg-bg p-2 sm:p-4">
        <div className="mx-auto" style={{ width: `min(100%, calc(75vh * ${clip.w} / ${clip.h}))` }}>
          <SceneClip key={clip.id} id={clip.id} />
        </div>
      </div>
      <p className="mx-auto mt-3 max-w-[70ch] text-sm leading-6 text-text">
        <b className="font-semibold text-[#f2ede1]">{clip.title}.</b> {clip.caption}
      </p>
    </div>
  );
}
