'use client';

// /shortabout's build-up animation, v2 (Hitya 2026-08-09).
//
// v1 was a compass rose — nodes flew out ±52% past the stage and clipped off
// both edges of a phone. This version is a STORY told in place, and nothing
// ever translates outside the stage:
//
//   1. The Discord bot appears (centered), with what it originally did.
//   2. Scroll: the agent pops in on the left, a data line runs to the bot —
//      log data flowing right.
//   3. The database GROWS out of that line, between them; the flow becomes
//      agent → DB → bot, with what it is tracking.
//   4. A treasure chest closes around the agent — ears and all, that is the
//      Mimic — listing what the chest itself adds.
//   5. The platform frame pops in above: what the whole thing enables.
//
// Scenes advance on scroll sentinels (IntersectionObserver, highest-reached
// counting, so scrolling back re-plays in reverse). Reduced motion or no IO
// shows the finished diagram immediately.

import { useEffect, useRef, useState } from 'react';

const SCENES = 5;

export default function PlatformSpin() {
  const [count, setCount] = useState(0);
  const [reduced, setReduced] = useState(false);
  const sentinels = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    if (mq.matches || typeof IntersectionObserver === 'undefined') { setCount(SCENES); return; }
    const states = new Array(SCENES).fill(false);
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        const idx = Number((e.target as HTMLElement).dataset.idx);
        states[idx] = e.isIntersecting || e.boundingClientRect.top < 0;
      }
      let n = 0;
      for (let i = 0; i < states.length; i++) if (states[i]) n = i + 1;
      setCount(n);
    }, { rootMargin: '0px 0px -30% 0px' });
    sentinels.current.forEach(el => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const p = reduced ? SCENES : count;   // phase reached

  const pop = (on: boolean, extra = '') =>
    `transition-all duration-700 ease-out ${extra} ${on ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`;

  return (
    <div className="relative" style={{ height: reduced ? 'auto' : '300vh' }}>
      {/* Flow animation for the data line — scoped keyframes. */}
      <style>{`@keyframes wpflow { from { background-position: 0 0; } to { background-position: 16px 0; } }`}</style>

      <div className={reduced ? '' : 'sticky top-16 sm:top-24'}>
        <div className="mx-auto w-full max-w-md px-1">

          {/* Scene 5 — the platform frame. */}
          <div className={pop(p >= 5, 'origin-bottom mb-3')}>
            <div className="rounded-lg border-2 border-gold bg-panel p-3 text-center shadow-[0_0_24px_rgba(210,153,34,0.2)]">
              <div className="text-base font-bold text-text"><span aria-hidden>🐺</span> The Wolf Pack Platform</div>
              <p className="text-[11px] text-dim leading-relaxed mt-1">
                Together: a fight parsed by a few people exists <span className="text-text">once, for
                everyone</span> — live on the overlays mid-raid, on{' '}
                <span className="text-blue">wolfpack.quest</span> and in Discord after.
              </p>
            </div>
            <div className="mx-auto w-px h-3 bg-gold/50" />
          </div>

          {/* The build row: agent · line+DB · bot. Fixed 3-column grid — nothing
              here can leave the stage. pt-2 leaves room for the chest's ears. */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 pt-2">

            {/* Agent — and, later, the chest that eats it. */}
            <div className={pop(p >= 2, 'origin-center relative min-w-0')}>
              {/* Chest ears + lid, INSIDE the padding so they never clip. */}
              <div className={`absolute -top-2 left-3 w-2.5 h-2.5 rotate-45 rounded-[2px] bg-[#7c5a2b] border border-purple/60 transition-all duration-500 ${p >= 4 ? 'opacity-100' : 'opacity-0'}`} aria-hidden />
              <div className={`absolute -top-2 right-3 w-2.5 h-2.5 rotate-45 rounded-[2px] bg-[#7c5a2b] border border-purple/60 transition-all duration-500 ${p >= 4 ? 'opacity-100' : 'opacity-0'}`} aria-hidden />
              <div className={`absolute top-6 -right-1 text-[10px] transition-all duration-500 ${p >= 4 ? 'opacity-100' : 'opacity-0'}`} aria-hidden>〰️</div>
              <div className={`rounded-lg border p-2 transition-all duration-700 ${
                p >= 4 ? 'border-2 border-purple bg-[#241a2e] shadow-[0_0_16px_rgba(163,113,247,0.25)]' : 'border-green bg-bg/90'}`}>
                {p >= 4 ? (
                  <>
                    <div className="text-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/mimic-logo.png" alt="" width={22} height={22} className="inline-block rounded" />
                      <div className="text-[11px] font-bold text-purple mt-0.5">Mimic</div>
                      <div className="text-[8px] text-dim leading-tight">a chest that swallowed the agent</div>
                    </div>
                    <ul className="text-[9px] text-text/90 mt-1 space-y-0.5 leading-tight">
                      <li>· overlays on the game</li>
                      <li>· spoken callouts</li>
                      <li>· loot countdowns</li>
                      <li>· installs &amp; updates itself</li>
                      <li className="text-dim">· the agent, inside <span aria-hidden>📜</span></li>
                    </ul>
                  </>
                ) : (
                  <>
                    <div className="text-center">
                      <div className="text-base leading-none" aria-hidden>📜</div>
                      <div className="text-[11px] font-bold text-green mt-0.5">The Agent</div>
                      <div className="text-[8px] text-dim leading-tight">on your PC</div>
                    </div>
                    <ul className="text-[9px] text-text/90 mt-1 space-y-0.5 leading-tight">
                      <li>· tails your combat log</li>
                      <li>· builds the parse</li>
                      <li>· /who &amp; attendance</li>
                      <li>· privacy filter, locally</li>
                    </ul>
                  </>
                )}
              </div>
            </div>

            {/* The data line, with the database growing OUT of it. */}
            <div className="relative flex flex-col items-center justify-center w-[74px] sm:w-24">
              <div
                className={`h-[3px] w-full rounded transition-opacity duration-500 ${p >= 2 ? 'opacity-100' : 'opacity-0'}`}
                style={{
                  backgroundImage: 'repeating-linear-gradient(90deg, #56d364 0 6px, transparent 6px 16px)',
                  animation: p >= 2 && !reduced ? 'wpflow 0.9s linear infinite' : undefined,
                }}
                aria-hidden
              />
              <div className={pop(p >= 3, 'origin-center absolute')}>
                <div className="rounded-md border border-border bg-panel px-1.5 py-1 text-center shadow-lg">
                  <div className="text-sm leading-none" aria-hidden>🗄️</div>
                  <div className="text-[9px] font-bold text-text">one database</div>
                  <ul className="text-[8px] text-dim leading-tight mt-0.5">
                    <li>fights · damage</li>
                    <li>buffs · attendance</li>
                    <li>/who · loot · DKP</li>
                  </ul>
                </div>
              </div>
              <div className={`text-[8px] text-green mt-0.5 transition-opacity duration-500 ${p >= 2 && p < 3 ? 'opacity-100' : 'opacity-0'}`}>
                log data →
              </div>
            </div>

            {/* The bot — scene 1. Starts centered (shifted one column left),
                slides home when the agent arrives. */}
            <div
              className="min-w-0 transition-transform duration-700 ease-out"
              style={{ transform: p < 2 ? 'translateX(calc(-100% - 0.375rem))' : 'translateX(0)' }}
            >
              <div className={pop(p >= 1, 'origin-center')}>
                <div className="rounded-lg border border-gold bg-bg/90 p-2">
                  <div className="text-center">
                    <div className="text-base leading-none" aria-hidden>🤖</div>
                    <div className="text-[11px] font-bold text-gold mt-0.5">The Bot</div>
                    <div className="text-[8px] text-dim leading-tight">in Discord · on Railway</div>
                  </div>
                  <ul className="text-[9px] text-text/90 mt-1 space-y-0.5 leading-tight">
                    <li>· boss respawn timers</li>
                    <li>· spawn boards</li>
                    <li>· DKP &amp; loot auctions</li>
                    <li>· attendance ticks</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Where this started — visible from scene 1 until the story fills in. */}
          <p className={`text-center text-[10px] text-dim mt-3 transition-opacity duration-500 ${p >= 1 && p < 5 ? 'opacity-100' : 'opacity-0'}`}>
            {p < 2 ? 'It started here — a Discord bot.'
              : p < 3 ? 'Then the agent started reading the combat log and feeding it.'
              : p < 4 ? 'The shared database grew in between — everything lands there once.'
              : 'Then the chest grew ears. Keep going…'}
          </p>

          {!reduced && p < SCENES && (
            <div className="text-center text-[11px] text-dim mt-2 animate-pulse">keep scrolling ↓</div>
          )}
        </div>
      </div>

      {/* Scroll sentinels — each one advances the story a scene. */}
      {!reduced && Array.from({ length: SCENES }, (_, i) => (
        <div key={'s' + i} ref={el => { sentinels.current[i] = el; }} data-idx={i}
             className="absolute w-px h-px" style={{ top: `${12 + i * 17}%` }} />
      ))}
    </div>
  );
}
