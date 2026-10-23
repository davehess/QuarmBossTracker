// When a shared raid that FOLLOWS the raid redraws itself, and when it holds still (the guild lead, 2026-10-23: "shared
// raids that follow the raid: self-refresh every 60 seconds, but never yank someone who is scrubbing").
//
// An open share (lib/raidShare.ts isOpenShare) is a window whose end is the clock, so a page opened an hour ago shows an
// hour-old raid. While the share is still following, the page asks the server for itself again every FOLLOW_EVERY_MS
// (router.refresh(): the server component runs again and hands the review its grown window; the review's state, the
// playhead included, is kept). It does NOT do that while the viewer is busy:
//   * they touched the page (a click, a key, the wheel) in the last QUIET_MS; or
//   * they moved the playhead off where the page opened it and left it short of the live end, i.e. they parked inside
//     the recording to look at something. They are held until they bring it back to the end (or reload).
// A viewer who has only read the lists, or left the picture where it opened, is not held.
//
// Pure: no React, no clock of its own, so the decision is tested directly (test/share-follow.test.js).

export const FOLLOW_EVERY_MS = 60_000;
/** How long after the last touch the page stays still. */
export const QUIET_MS = 30_000;
/** A playhead this close to the window's end counts as being at the live end (the last row can trail by a couple of minutes). */
export const LIVE_EDGE_MS = 3 * 60_000;

export type FollowState = {
  nowMs: number;
  /** When the viewer last touched the page (epoch ms); 0 or null: never. */
  lastTouchMs: number | null;
  /** The playhead now, and where the page first opened it (epoch ms); null until the board has reported. */
  playheadMs: number | null;
  openedMs: number | null;
  /** The window's current end. */
  endMs: number;
};

/** True when a refresh due now should wait. */
export function followHeld(s: FollowState): boolean {
  if (s.lastTouchMs && s.nowMs - s.lastTouchMs < QUIET_MS) return true;
  if (s.playheadMs == null || s.openedMs == null) return false;
  const parked = Math.abs(s.playheadMs - s.openedMs) >= 1000;
  return parked && s.playheadMs < s.endMs - LIVE_EDGE_MS;
}

/** True when a refresh is due: a full interval since the last one, and the tab is on screen. */
export function followDue(nowMs: number, lastRefreshMs: number, hidden: boolean): boolean {
  return !hidden && nowMs - lastRefreshMs >= FOLLOW_EVERY_MS;
}
