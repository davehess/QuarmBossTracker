// When did a character's gear / inventory / spellbook last arrive? Pure helpers behind <UploadFreshness>.
//
// The bot stamps characters.<x>_checked_at on every accepted upload (the unchanged ones too) and <x>_synced_at when
// the content really changed (migration 20261031120000). A character that has not uploaded since before that column
// existed has a null checked_at, so the line falls back to what the row already knew: the synced_at, then the newest
// row timestamp of the snapshot table.

import { fmtAbs, relTime, tzShortLabel } from './timezone-shared';

export type UploadStamps = {
  checkedAt?: string | null;   // characters.<x>_checked_at
  syncedAt?: string | null;    // characters.<x>_synced_at (gear: quarmy_synced_at)
  rowAt?: string | null;       // newest observed_at / updated_at in the snapshot table
};

const ms = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : NaN;
};

/** The newest ISO string of those given, or null when none parses. */
export function latestIso(...isos: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const iso of isos) {
    const t = ms(iso);
    if (Number.isFinite(t) && t > bestMs) { best = iso as string; bestMs = t; }
  }
  return best;
}

/** When the upload last arrived, and when its content last changed (either may be null). */
export function uploadTimes(s: UploadStamps | null | undefined): { arrivedAt: string | null; changedAt: string | null } {
  if (!s) return { arrivedAt: null, changedAt: null };
  return {
    arrivedAt: latestIso(s.checkedAt, s.syncedAt, s.rowAt),
    changedAt: latestIso(s.syncedAt, s.rowAt),
  };
}

/** The label ("2h ago" / "never") and hover text for one upload kind. */
export function describeUpload(s: UploadStamps | null | undefined, tz: string): { label: string; title: string } {
  const { arrivedAt, changedAt } = uploadTimes(s);
  if (!arrivedAt) return { label: 'never', title: 'No upload has arrived yet' };
  const zone = tzShortLabel(tz);
  let title = `Last arrived ${fmtAbs(arrivedAt, tz)} ${zone}`;
  // Only worth saying when the file is arriving but not changing — a minute of slack covers the two stamps being
  // written a moment apart.
  if (changedAt && ms(arrivedAt) - ms(changedAt) >= 60_000) {
    title += `; content last changed ${fmtAbs(changedAt, tz)} ${zone}`;
  }
  return { label: relTime(arrivedAt), title };
}
