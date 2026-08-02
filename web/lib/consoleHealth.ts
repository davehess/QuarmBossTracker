// #87 — the officer console's health-signal model.
//
// PURE. No I/O, no Supabase, no fetch — the page does the reads and hands the
// raw facts in here. That keeps the thresholds unit-testable and keeps "is this
// red?" from being scattered across JSX.
//
// Design rules encoded here (docs/DESIGN-87-officer-console.md §5.2):
//   1. Every red is actionable and points at exactly ONE runbook. A signal
//      nobody can act on is noise, and noise is how a board gets ignored.
//   2. OUTSIDE the raid window, every freshness amber/red downgrades to grey
//      "quiet". A stale chat relay at 4am is not an incident, and a board that
//      cries wolf overnight is a board nobody reads on Thursday.
//   3. Control-plane keys default to ABSENT. Anything set is DRIFT (someone
//      mitigated something and never reverted); config keys are not drift.

export type SignalState = 'ok' | 'warn' | 'bad' | 'quiet' | 'unknown';

export type Signal = {
  id: string;
  label: string;
  state: SignalState;
  /** Short value shown on the tile, e.g. "3m ago" or "29 of 101". */
  value: string;
  /** One line explaining what the state means right now. */
  detail: string;
  /** Runbook id this signal escalates to when it is not ok. */
  runbook?: string;
};

// ── Raid window ─────────────────────────────────────────────────────────────
// The schedule the rest of the platform already uses: Sun/Wed/Thu 19:30 ET
// through 00:30 ET the next morning (same bounds as raid-freeze.yml and the
// bot's raid-hold). Computed from the ET wall clock, DST-correct via Intl.

const RAID_DAYS = new Set(['Sun', 'Wed', 'Thu']);
const SPILL_DAYS = new Set(['Mon', 'Thu', 'Fri']);   // post-midnight tail of the night before

export function etParts(now: Date = new Date()): { day: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const day = get('weekday');
  // Intl can emit "24" for midnight in hour12:false — normalise it.
  const h = Number(get('hour')) % 24;
  const m = Number(get('minute'));
  return { day, minutes: h * 60 + m };
}

/** True inside Sun/Wed/Thu 19:30 ET → 00:30 ET. */
export function inRaidWindow(now: Date = new Date()): boolean {
  const { day, minutes } = etParts(now);
  if (RAID_DAYS.has(day) && minutes >= 19 * 60 + 30) return true;
  if (SPILL_DAYS.has(day) && minutes < 30) return true;
  return false;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function minutesSince(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((now.getTime() - t) / 60000));
}

export function fmtAgo(mins: number | null): string {
  if (mins == null) return 'never';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Freshness signal with raid-window awareness. Outside the window a stale value
 * is 'quiet', never 'bad' — rule 2 above.
 */
export function freshness(opts: {
  id: string;
  label: string;
  lastIso: string | null;
  warnMins: number;
  badMins: number;
  runbook: string;
  inWindow: boolean;
  now?: Date;
  /** Extra words appended to the detail line. */
  note?: string;
}): Signal {
  const mins = minutesSince(opts.lastIso, opts.now);
  const value = fmtAgo(mins);
  const base = { id: opts.id, label: opts.label, value, runbook: opts.runbook };
  if (mins == null) {
    return { ...base, state: 'unknown', detail: `No data recorded yet.${opts.note ? ' ' + opts.note : ''}` };
  }
  if (!opts.inWindow) {
    const quiet = mins >= opts.warnMins;
    return {
      ...base,
      state: quiet ? 'quiet' : 'ok',
      detail: quiet
        ? `Last seen ${value}. Outside the raid window — not an incident.`
        : `Last seen ${value}.`,
    };
  }
  if (mins >= opts.badMins) {
    return { ...base, state: 'bad', detail: `Last seen ${value}, in a raid window.${opts.note ? ' ' + opts.note : ''}` };
  }
  if (mins >= opts.warnMins) {
    return { ...base, state: 'warn', detail: `Last seen ${value}, in a raid window.` };
  }
  return { ...base, state: 'ok', detail: `Last seen ${value}.` };
}

// ── Control-plane drift ─────────────────────────────────────────────────────
// Default for every CONTROL key is "absent". Anything present is a mitigation
// somebody applied. CONFIG keys are intentional and permanent — never drift.

export type DriftEntry = {
  key: string;
  value: number | string;
  /** What it does, in officer language. */
  meaning: string;
  /** Runbook to read before clearing it. */
  runbook?: string;
  /** true when the console offers a one-click Clear (Class A). */
  clearable: boolean;
  danger: boolean;
};

const CONFIG_PREFIXES = ['ext_', 'offheal_', 'ch_'];
const CONFIG_KEYS = new Set(['hide_main_names', 'agent_release_ref', 'agent_release_ref_beta']);

// Console bookkeeping: when the console SETS a control key it also stamps
// `flag_set_at_<key>` with an ISO string, so the drift panel can show an age
// and nag past 7 days. Zero-migration — string values already ride this jsonb
// (hide_main_names, reporter_pin_*, agent_release_ref_beta) and /admin/overlays'
// save passes unknown keys straight through. These stamps are NOT drift.
export const SET_AT_PREFIX = 'flag_set_at_';
export function setAtKey(key: string): string { return SET_AT_PREFIX + key; }

export function isControlKey(key: string): boolean {
  if (key.startsWith(SET_AT_PREFIX)) return false;
  if (CONFIG_KEYS.has(key)) return false;
  if (CONFIG_PREFIXES.some(p => key.startsWith(p))) return false;
  return (
    key.startsWith('flag_') ||
    key.startsWith('dedup_') ||
    key.startsWith('budget_') ||
    key.startsWith('reporter_pin_') ||
    key.startsWith('reporter_extra_') ||
    key === 'min_agent_ver_num'
  );
}

const MEANINGS: Record<string, { meaning: string; runbook?: string; danger?: boolean }> = {
  flag_agent_kill: {
    meaning: 'THE WHOLE FLEET IS PAUSED. Every agent has stopped uploading; queues are holding, nothing is being lost, but the raid is blind to everything cross-client.',
    runbook: 'rb-03', danger: true,
  },
  min_agent_ver_num: {
    meaning: 'Version floor. Every agent below this numeric version is stood down and shows an update nudge.',
    runbook: 'rb-04', danger: true,
  },
  flag_disable_budgets: {
    meaning: 'Admission control is OFF — per-uploader rate limits are not being applied at all.',
    runbook: 'rb-02', danger: true,
  },
  flag_disable_reporter_election: {
    meaning: 'Reporter de-duplication is OFF — every agent uploads chat, buffs and roster again.',
    runbook: 'rb-05',
  },
  dedup_chat: {
    meaning: 'Chat reporter dedup is OFF: every agent uploads chat. This is the 2026-07-19 blackout mitigation — #112 shipped liveness + zone-spread so it could be re-enabled.',
    runbook: 'rb-05',
  },
  dedup_buffs:  { meaning: 'Buff-landing reporter dedup toggle.', runbook: 'rb-04' },
  dedup_roster: { meaning: 'Raid-roster reporter dedup toggle.',  runbook: 'rb-04' },
  flag_raid_hold: {
    meaning: 'Raid hold forced. Agents are deferring background file work (gear/spellbook/crash scans) and holding hot-swaps.',
  },
};

export function driftFromTuning(tuning: Record<string, unknown>): DriftEntry[] {
  const out: DriftEntry[] = [];
  for (const [key, raw] of Object.entries(tuning ?? {})) {
    if (!isControlKey(key)) continue;
    const value = (typeof raw === 'number' || typeof raw === 'string') ? raw : String(raw);
    const known = MEANINGS[key];
    let meaning = known?.meaning;
    if (!meaning) {
      if (key.startsWith('flag_shed_')) {
        meaning = `The ${key.slice('flag_shed_'.length).replace(/_/g, '-')} stream is being DROPPED at the bot. Anything that reads it is going stale.`;
      } else if (key.startsWith('reporter_pin_')) {
        meaning = `Reporter for ${key.slice('reporter_pin_'.length)} is pinned to a specific character instead of elected. A dead pin is ignored (fail-open).`;
      } else if (key.startsWith('reporter_extra_')) {
        meaning = `Extra always-on reporters added for ${key.slice('reporter_extra_'.length)}.`;
      } else if (key.startsWith('budget_')) {
        meaning = 'Admission-control budget override.';
      } else {
        meaning = 'Control-plane override.';
      }
    }
    out.push({
      key,
      value,
      meaning,
      runbook: known?.runbook ?? (key.startsWith('flag_shed_') ? 'rb-03' : undefined),
      // Everything here is clearable in one click by design: clearing a
      // mitigation must always be easier than setting one.
      clearable: true,
      danger: known?.danger ?? key.startsWith('flag_shed_'),
    });
  }
  // Danger first, then alphabetical — so a fleet pause can never be below the fold.
  return out.sort((a, b) => (Number(b.danger) - Number(a.danger)) || a.key.localeCompare(b.key));
}

/**
 * Age in whole days of each drift entry, from its `flag_set_at_<key>` stamp.
 * null = the key was set somewhere that doesn't stamp (SQL, the Mimic Admin
 * tab, /admin/overlays) — the console says "age unknown" rather than guessing.
 */
export function driftAges(
  tuning: Record<string, unknown>,
  entries: DriftEntry[],
  now: Date = new Date(),
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const e of entries) {
    const raw = tuning?.[setAtKey(e.key)];
    const t = typeof raw === 'string' ? new Date(raw).getTime() : NaN;
    out[e.key] = Number.isFinite(t)
      ? Math.max(0, Math.floor((now.getTime() - t) / 86_400_000))
      : null;
  }
  return out;
}

// ── The board ───────────────────────────────────────────────────────────────

export type HealthInput = {
  now?: Date;
  lastUploadIso: string | null;
  activeChars15m: number;
  lastChatIso: string | null;
  lastEncounterIso: string | null;
  encountersToday: number;
  lastLiveStateIso: string | null;
  errorUploaders: number;
  topErrorCode: number | null;
  agentVersions: { version: string | null; chars: number }[];
  versionFloor: number | null;
  backfillPending: number;
  maxQueuePending: number | null;
  enabledTriggers: number;
  deadAnchoredTriggers: number;
  driftCount: number;
  oldestDriftDays: number | null;
  site: { ok: boolean; degraded: boolean; auth: string; db: string } | null;
};

/** Numeric form of an agent version: major*10000 + minor*100 + patch. */
export function verNum(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
}

export function buildSignals(input: HealthInput): Signal[] {
  const now = input.now ?? new Date();
  const win = inRaidWindow(now);
  const out: Signal[] = [];

  out.push(freshness({
    id: 'ingestHeartbeat', label: 'Ingest heartbeat', lastIso: input.lastUploadIso,
    warnMins: 10, badMins: 30, runbook: 'rb-03', inWindow: win, now,
    note: 'If ANY agent uploaded recently the bot is up — the bot is what writes these rows.',
  }));

  out.push({
    id: 'fleetNow', label: 'Agents uploading now',
    state: win
      ? (input.activeChars15m === 0 ? 'bad' : input.activeChars15m < 5 ? 'warn' : 'ok')
      : (input.activeChars15m === 0 ? 'quiet' : 'ok'),
    value: String(input.activeChars15m),
    detail: `${input.activeChars15m} character${input.activeChars15m === 1 ? '' : 's'} uploaded in the last 15 minutes.`,
    runbook: 'rb-03',
  });

  // Chat stale WHILE ingest is fresh is the 2026-07-19 signature — call it out.
  const chatSig = freshness({
    id: 'chatRelay', label: 'Chat relay', lastIso: input.lastChatIso,
    warnMins: 30, badMins: 60, runbook: 'rb-05', inWindow: win, now,
  });
  const ingestMins = minutesSince(input.lastUploadIso, now);
  if (chatSig.state === 'bad' && ingestMins != null && ingestMins <= 10) {
    chatSig.detail += ' Ingest is fresh — one stream is dead while the fleet is fine. That is the 2026-07-19 shape.';
  }
  out.push(chatSig);

  const encSig = freshness({
    id: 'parsesLanding', label: 'Parses landing', lastIso: input.lastEncounterIso,
    warnMins: 30, badMins: 60, runbook: 'rb-02', inWindow: win, now,
  });
  encSig.value = `${input.encountersToday} today · ${encSig.value}`;
  out.push(encSig);

  out.push(freshness({
    id: 'liveState', label: 'Live state', lastIso: input.lastLiveStateIso,
    warnMins: 5, badMins: 15, runbook: 'rb-03', inWindow: win, now,
  }));

  out.push({
    id: 'uploadErrors', label: 'Upload errors (24h)',
    state: input.errorUploaders === 0 ? 'ok'
      : (input.errorUploaders >= 3 ? 'bad' : 'warn'),
    value: String(input.errorUploaders),
    detail: input.errorUploaders === 0
      ? 'No uploader is currently in an error state.'
      : `${input.errorUploaders} uploader${input.errorUploaders === 1 ? '' : 's'} last failed`
        + (input.topErrorCode ? ` (most recent code ${input.topErrorCode}${(input.topErrorCode === 401 || input.topErrorCode === 403) ? ' — 401/403 across many uploaders is the auth-blip signature and is an EMERGENCY' : ''}).` : '.'),
    runbook: 'rb-02',
  });

  const floor = input.versionFloor;
  const below = floor
    ? input.agentVersions.filter(v => { const n = verNum(v.version); return n != null && n < floor; })
    : [];
  const belowChars = below.reduce((a, v) => a + v.chars, 0);
  const distinct = input.agentVersions.length;
  out.push({
    id: 'fleetVersions', label: 'Fleet versions (7d)',
    state: belowChars > 0 ? 'bad' : distinct > 4 ? 'warn' : 'ok',
    value: `${distinct} version${distinct === 1 ? '' : 's'}`,
    detail: belowChars > 0
      ? `${belowChars} character(s) are BELOW the version floor and are standing down.`
      : `${distinct} distinct agent versions active in the last 7 days` +
        (input.agentVersions.length
          ? `; oldest ${input.agentVersions[input.agentVersions.length - 1].version ?? '?'}.`
          : '.'),
    runbook: 'rb-04',
  });

  out.push({
    id: 'drift', label: 'Control-plane overrides',
    state: input.driftCount === 0 ? 'ok'
      : ((input.oldestDriftDays ?? 0) >= 7 ? 'bad' : 'warn'),
    value: String(input.driftCount),
    detail: input.driftCount === 0
      ? 'Everything is at its default.'
      : `${input.driftCount} override${input.driftCount === 1 ? '' : 's'} active`
        + ((input.oldestDriftDays ?? 0) >= 7
          ? `, oldest set ${input.oldestDriftDays} days ago. A mitigation nobody reverted is a feature quietly disabled.`
          : '.'),
    runbook: 'rb-05',
  });

  out.push({
    id: 'triggerHealth', label: 'Trigger set health',
    state: input.deadAnchoredTriggers > 0 ? 'bad' : 'ok',
    value: input.deadAnchoredTriggers > 0
      ? `${input.deadAnchoredTriggers} of ${input.enabledTriggers} dead`
      : `${input.enabledTriggers} enabled`,
    detail: input.deadAnchoredTriggers > 0
      ? `${input.deadAnchoredTriggers} enabled trigger(s) start with ^ and can NEVER match — the agent tests against the raw log line, timestamp prefix included. Rehearse passes on all of them.`
      : 'No structurally-dead patterns.',
    runbook: 'rb-01',
  });

  out.push({
    id: 'backlog', label: 'Backfill / queue backlog',
    state: (input.maxQueuePending ?? 0) > 500 || input.backfillPending > 25 ? 'bad'
      : (input.backfillPending > 0 || (input.maxQueuePending ?? 0) > 0) ? 'warn' : 'ok',
    value: `${input.backfillPending} pending`,
    detail: `${input.backfillPending} backfill request(s) pending`
      + (input.maxQueuePending != null ? `; deepest agent upload queue ${input.maxQueuePending}.` : '.'),
    runbook: 'rb-02',
  });

  if (input.site) {
    const bad = input.site.auth === 'down' || input.site.db === 'down';
    out.push({
      id: 'site', label: 'wolfpack.quest',
      state: bad ? 'bad' : input.site.degraded ? 'warn' : 'ok',
      value: bad ? 'down' : input.site.degraded ? 'slow' : 'ok',
      detail: `Sign-in ${input.site.auth} · database ${input.site.db}.`
        + (input.site.auth === 'down' && input.site.db !== 'down'
          ? ' Sign-in only — the RAID does not care: agents authenticate through the bot with their own tokens.'
          : ''),
      runbook: 'rb-03',
    });
  } else {
    out.push({
      id: 'site', label: 'wolfpack.quest', state: 'unknown', value: '—',
      detail: 'Health probe unavailable.', runbook: 'rb-03',
    });
  }

  return out;
}

const RANK: Record<SignalState, number> = { bad: 0, warn: 1, unknown: 2, quiet: 3, ok: 4 };

/** Worst-first, so the thing that needs an officer is always at the top. */
export function sortSignals(signals: Signal[]): Signal[] {
  return [...signals].sort((a, b) => RANK[a.state] - RANK[b.state]);
}

export function overallState(signals: Signal[]): SignalState {
  if (signals.some(s => s.state === 'bad')) return 'bad';
  if (signals.some(s => s.state === 'warn')) return 'warn';
  return 'ok';
}
