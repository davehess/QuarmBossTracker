// The state of raidmimic.com/setup's one-step-at-a-time view (the guild lead, 2026-10-28: "setup needs the
// step-by-step by default"). Pure functions, no React and no window: the client component
// (web/app/raidmimic/setup/SetupSteps.tsx) calls them and test/raidmimic-setup-steps.test.js runs them.
//
// The URL hash is the one source of truth for WHICH step: #first-run lands on step 2 from a link or a reload.
// The only thing remembered between visits is the "Show all steps" choice, in localStorage, which can throw or come
// back empty (private window, blocked site data), so every access is guarded and the default is step by step.

export const SHOW_ALL_KEY = 'raidmimic.setup.showAll';

/** Keep a step number inside 0..total-1. Anything that is not a finite number is the first step. */
export function clampStep(i: number, total: number): number {
  if (!Number.isFinite(i) || total < 1) return 0;
  return Math.min(Math.max(Math.trunc(i), 0), total - 1);
}

function indexOfHash(hash: string | null | undefined, ids: readonly string[]): number {
  let id = (hash || '').replace(/^#/, '');
  try { id = decodeURIComponent(id); } catch { /* a malformed escape: use it as written */ }
  return ids.indexOf(id);
}

/** `#first-run` (or `first-run`) to its step index. An unknown or empty hash is the first step. */
export function stepFromHash(hash: string | null | undefined, ids: readonly string[]): number {
  return Math.max(indexOfHash(hash, ids), 0);
}

/** True when the hash names one of the steps (as opposed to empty, `#troubleshooting` or junk). */
export function isStepHash(hash: string | null | undefined, ids: readonly string[]): boolean {
  return indexOfHash(hash, ids) >= 0;
}

/** The hash for step i, clamped. */
export function hashForStep(i: number, ids: readonly string[]): string {
  return ids.length ? `#${ids[clampStep(i, ids.length)]}` : '';
}

/** "Step 2 of 6". */
export function stepLabel(i: number, total: number): string {
  return `Step ${clampStep(i, total) + 1} of ${total}`;
}

type Store = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

/** The saved "Show all steps" choice. Storage missing, throwing or holding anything else means step by step. */
export function readShowAll(store: Store): boolean {
  try { return store?.getItem(SHOW_ALL_KEY) === '1'; } catch { return false; }
}

/** Save the choice; a storage that refuses the write is ignored, the page works without it. */
export function writeShowAll(store: Store, on: boolean): void {
  try { store?.setItem(SHOW_ALL_KEY, on ? '1' : '0'); } catch { /* private window: nothing to remember with */ }
}

/** The arrow keys step, unless the person is typing or holding a modifier. Returns -1, 1 or 0. */
export function stepKeyDelta(e: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; target?: unknown }): -1 | 0 | 1 {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return 0;
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null | undefined;
  const tag = (t?.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return 0;
  return e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
}
