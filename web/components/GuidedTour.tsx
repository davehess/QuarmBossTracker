// GuidedTour — the ✨ new-member walkthrough engine (no deps, ~one screen of
// state logic). A clickthrough across the member pages that spotlights one
// element per step over the member's OWN live data. Re-runnable any time from
// the header's ✨ Tour button; offered once automatically on /me.
//
// Mechanics:
//   • Active state lives in localStorage (`wp.tour.v1` = {i, pvp}) so the tour
//     survives the cross-page navigations it performs itself. `wp.tour.done.v1`
//     marks completed/dismissed and gates the one-time auto-offer.
//   • Steps (lib/tourSteps.ts) each carry a route + CSS selector. On the right
//     route the target gets a spotlight (huge box-shadow cutout) + a tooltip
//     card; when the target is missing (empty page) the card centers instead,
//     so a member with no data yet never gets stranded.
//   • Off-route (member wandered mid-tour) a small "▶ Resume tour" pill floats
//     bottom-right instead of hijacking the page they chose to visit.
//   • PvP is a branch: the last core step offers it, never pushes it.
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { TOUR_STEPS, type TourStep } from '@/lib/tourSteps';

const STATE_KEY = 'wp.tour.v1';
const DONE_KEY  = 'wp.tour.done.v1';

type TourState = { i: number; pvp: boolean };

function readState(): TourState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (typeof s?.i !== 'number') return null;
    return { i: s.i, pvp: !!s.pvp };
  } catch { return null; }
}
function writeState(s: TourState | null) {
  try {
    if (s) localStorage.setItem(STATE_KEY, JSON.stringify(s));
    else   localStorage.removeItem(STATE_KEY);
  } catch { /* private mode — tour just won't persist */ }
}

function stepsFor(pvp: boolean): TourStep[] {
  return TOUR_STEPS.filter(s => !s.pvp || pvp);
}

type Rect = { top: number; left: number; width: number; height: number };

export default function GuidedTour({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const router   = useRouter();
  const [state, setState]   = useState<TourState | null>(null);
  const [rect, setRect]     = useState<Rect | null>(null);
  const [offer, setOffer]   = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setState(readState());
  }, []);

  // One-time auto-offer, only on /me (where a fresh member lands from the
  // Discord card) and only until they've started or dismissed a tour once.
  useEffect(() => {
    if (!mounted || !signedIn || state) return;
    try {
      if (pathname === '/me' && !localStorage.getItem(DONE_KEY)) setOffer(true);
      else setOffer(false);
    } catch { /* ignore */ }
  }, [mounted, signedIn, state, pathname]);

  const steps = useMemo(() => stepsFor(state?.pvp ?? false), [state?.pvp]);
  const step  = state ? steps[Math.min(state.i, steps.length - 1)] : null;
  const onRoute = !!step && pathname === step.route;

  // Spotlight geometry — measured from the live DOM, re-measured on resize
  // and scroll so the cutout tracks its target.
  const measure = useCallback(() => {
    if (!step || pathname !== step.route) { setRect(null); return; }
    const el = document.querySelector(step.selector);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) { setRect(null); return; }
    // Whole-page targets (most pages wrap everything in one container): clamp
    // the spotlight to the top slice of the element so the shade stays
    // visible and the highlight reads as "this page", not "everything".
    const vh = window.innerHeight;
    const height = r.height > vh * 0.6 ? Math.min(r.height, vh * 0.45) : r.height;
    setRect({ top: r.top, left: r.left, width: r.width, height });
  }, [step, pathname]);

  useEffect(() => {
    if (!onRoute) { setRect(null); return; }
    // Let the page paint, scroll the target into view, then measure. Big
    // targets align to their start (their top slice is the spotlight).
    const el = step ? document.querySelector(step.selector) : null;
    if (el) {
      const big = el.getBoundingClientRect().height > window.innerHeight * 0.6;
      el.scrollIntoView({ block: big ? 'start' : 'center', behavior: 'instant' as ScrollBehavior });
    }
    const t = setTimeout(measure, 60);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [onRoute, step, measure]);

  const start = useCallback(() => {
    setOffer(false);
    const s = { i: 0, pvp: false };
    writeState(s); setState(s);
    if (pathname !== TOUR_STEPS[0].route) router.push(TOUR_STEPS[0].route);
  }, [pathname, router]);

  // The header ✨ Tour button lives in a server layout, so it reaches us via a
  // plain DOM event instead of React context.
  useEffect(() => {
    const h = () => start();
    window.addEventListener('wp-tour-start', h);
    return () => window.removeEventListener('wp-tour-start', h);
  }, [start]);

  const finish = useCallback((completed: boolean) => {
    writeState(null); setState(null); setRect(null);
    try { localStorage.setItem(DONE_KEY, completed ? 'done' : 'dismissed'); } catch { /* ignore */ }
  }, []);

  const go = useCallback((next: number, pvp?: boolean) => {
    const wantPvp = pvp ?? state?.pvp ?? false;
    const list = stepsFor(wantPvp);
    if (next < 0) return;
    if (next >= list.length) { finish(true); return; }
    const s = { i: next, pvp: wantPvp };
    writeState(s); setState(s);
    const target = list[next];
    if (pathname !== target.route) router.push(target.route);
  }, [state?.pvp, pathname, router, finish]);

  if (!mounted) return null;

  // ── Auto-offer toast ──────────────────────────────────────────────────────
  if (!state) {
    if (!offer) return null;
    return (
      <div className="fixed bottom-4 right-4 z-[95] max-w-xs bg-panel border border-blue/60 rounded-lg p-4 shadow-xl text-sm" data-tour-ui="offer">
        <div className="text-text mb-1">✨ New here?</div>
        <div className="text-dim text-xs mb-3">
          Take the two-minute tour — every stop is your own data: your characters, your parses, your standing.
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={start} className="px-3 py-1 rounded bg-accent text-white text-xs">Start the tour</button>
          <button
            type="button"
            onClick={() => { setOffer(false); try { localStorage.setItem(DONE_KEY, 'dismissed'); } catch { /* ignore */ } }}
            className="px-3 py-1 rounded border border-border text-dim text-xs hover:text-text"
          >
            Not now
          </button>
        </div>
      </div>
    );
  }

  // ── Off-route: quiet resume pill, never hijack the page they chose ────────
  if (!onRoute) {
    return (
      <button
        type="button"
        onClick={() => step && router.push(step.route)}
        className="fixed bottom-4 right-4 z-[95] px-3 py-1.5 rounded-full bg-panel border border-blue/60 text-blue text-xs shadow-xl hover:bg-[#21262d]"
        data-tour-ui="resume"
      >
        ▶ Resume tour ({state.i + 1}/{steps.length})
      </button>
    );
  }

  const idx   = Math.min(state.i, steps.length - 1);
  const last  = idx === steps.length - 1;
  const pad   = 6;

  // Tooltip placement: under the spotlight when there's room, else above,
  // else centered (also the no-target fallback for empty pages).
  let cardStyle: React.CSSProperties = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  if (rect) {
    const below = rect.top + rect.height + 12;
    const cardH = 190;
    const top = below + cardH < window.innerHeight ? below : Math.max(12, rect.top - cardH - 12);
    const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - 380));
    cardStyle = { top, left };
  }

  return (
    <div className="fixed inset-0 z-[90]" data-tour-ui="tour">
      {/* Spotlight — the cutout is the target's rect; the shadow is the shade. */}
      {rect ? (
        <div
          className="absolute rounded-lg border-2 border-blue/80 pointer-events-none"
          style={{
            top: rect.top - pad, left: rect.left - pad,
            width: rect.width + pad * 2, height: rect.height + pad * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.68)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/68" style={{ backgroundColor: 'rgba(0,0,0,0.68)' }} />
      )}

      <div className="absolute max-w-sm w-[92vw] sm:w-96 bg-panel border border-border rounded-lg p-4 shadow-2xl" style={cardStyle} data-tour-ui="card">
        <div className="text-xs text-dim mb-1">{idx + 1} / {steps.length}</div>
        <div className="text-sm text-gold mb-1.5">{step!.title}</div>
        <div className="text-xs text-text leading-relaxed mb-3">{step!.body}</div>
        <div className="flex items-center gap-2 flex-wrap">
          {idx > 0 && (
            <button type="button" onClick={() => go(idx - 1)} className="px-2.5 py-1 rounded border border-border text-dim text-xs hover:text-text">← Back</button>
          )}
          {step!.offersPvp && !state.pvp ? (
            <>
              <button type="button" onClick={() => go(idx + 1, true)} className="px-2.5 py-1 rounded border border-border text-text text-xs hover:text-blue">⚔️ Show me the PvP side</button>
              <button type="button" onClick={() => finish(true)} className="px-3 py-1 rounded bg-accent text-white text-xs">Finish</button>
            </>
          ) : (
            <button type="button" onClick={() => go(idx + 1)} className="px-3 py-1 rounded bg-accent text-white text-xs">
              {last ? 'Finish' : 'Next →'}
            </button>
          )}
          <button type="button" onClick={() => finish(false)} className="ml-auto text-dim text-xs hover:text-text underline">Skip tour</button>
        </div>
      </div>
    </div>
  );
}

// Header entry point — a plain button that fires the DOM event the engine
// listens for. Rendered from the server layout for signed-in members only.
export function TourLauncher() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event('wp-tour-start'))}
      className="px-2.5 py-1 rounded border border-border bg-panel text-xs sm:text-sm text-text hover:bg-[#21262d] transition-colors whitespace-nowrap"
      title="Take the guided walkthrough — every stop is your own data. Re-run it any time."
    >
      ✨ Tour
    </button>
  );
}
