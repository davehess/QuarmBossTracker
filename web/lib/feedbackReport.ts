// Pure helpers for /feedback/<ref>, the page a member opens from the bot's status DM to see their own
// report and answer it (the guild lead, 2026-10-08: the DM used to link to the Discord card, which only
// officers can open). Kept out of the page so test/feedback-report-page.test.js can run them.

export const REPLY_MIN = 2;
export const REPLY_MAX = 2000;

// "FB-12", "fb-12", "12" -> 12. Anything else (empty, 0, "12abc", "FB-", a decimal) -> null.
export function parseRefParam(raw: string | null | undefined): number | null {
  let s = '';
  try { s = decodeURIComponent(String(raw ?? '')); } catch { return null; }
  const m = /^\s*(?:fb-)?(\d{1,6})\s*$/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

// Where a report stands, in words a submitter reads. The statuses are the ones /admin/feedback and the bot
// write (utils/feedbackRefs.js STAGE): new, acked (scoped counts as acked), on_beta, addressed, wont_fix,
// duplicate. An unknown value reads as new rather than leaking the raw word.
export function statusWords(status: string | null | undefined): { icon: string; label: string; detail: string } {
  switch (status) {
    case 'acked':
    case 'scoped':
      return { icon: '👀', label: 'Seen', detail: 'An officer has read it and it is on the list.' };
    case 'on_beta':
      return { icon: '🧪', label: 'On the beta', detail: 'Fixed on the beta. It reaches everyone with the next stable release.' };
    case 'addressed':
      return { icon: '✅', label: 'Fixed and live', detail: 'This is done and out for everyone.' };
    case 'wont_fix':
      return { icon: '🚫', label: 'Closed', detail: 'We decided not to do this one.' };
    case 'duplicate':
      return { icon: '👯', label: 'Closed as a duplicate', detail: 'Another report already covers it.' };
    default:
      return { icon: '🆕', label: 'New', detail: 'We have it. An officer has not looked at it yet.' };
  }
}

export type HistoryLine = { date: string; label: string; changed: string };

// The status history the bot keeps in the row's `notes` ("2026-10-08 🧪 On beta (abc1234) — what changed").
// Only those lines: `notes` is also where an officer types free text, and that is not the submitter's to
// read. The commit sha is dropped; the text after the dash is the commit's own plain-language description.
export function historyOf(notes: string | null | undefined): HistoryLine[] {
  const out: HistoryLine[] = [];
  for (const line of String(notes ?? '').split('\n')) {
    const m = /^(\d{4}-\d{2}-\d{2}) (🧪 On beta|✅ Implemented)(?: \([0-9a-f]{4,40}\))?(?: — (.*))?$/u.exec(line.trim());
    if (!m) continue;
    out.push({
      date: m[1],
      label: m[2].startsWith('🧪') ? '🧪 On the beta' : '✅ Fixed and live',
      changed: (m[3] ?? '').trim(),
    });
  }
  return out;
}

// Why a reply was not saved. The URL carries only the code (?err=short); the words live here, so a crafted
// link cannot put its own text on the page.
export const REPLY_ERRORS: Record<string, string> = {
  short: 'Write a little more first.',
  long: `Keep it under ${REPLY_MAX} characters.`,
  full: 'This thread is full. Ask an officer in Discord.',
  fail: 'Could not save that. Try again in a minute.',
};

export function replyErrorText(code: string | null | undefined): string | null {
  return code && Object.prototype.hasOwnProperty.call(REPLY_ERRORS, code) ? REPLY_ERRORS[code] : null;
}

// A reply as the form sends it: trimmed, CRs folded, and the length rule the table's check enforces.
export function cleanReply(raw: unknown): { ok: true; body: string } | { ok: false; error: keyof typeof REPLY_ERRORS } {
  const body = String(raw ?? '').replace(/\r\n/g, '\n').trim();
  if (body.length < REPLY_MIN) return { ok: false, error: 'short' };
  if (body.length > REPLY_MAX) return { ok: false, error: 'long' };
  return { ok: true, body };
}

// Who may open a report: its submitter (their Discord id equals the row's) or an officer. A report with no
// submitter id (an anonymous web post) has no owner, so only an officer opens it.
export function canOpenReport(
  viewerDiscordId: string | null | undefined,
  submitterDiscordId: string | null | undefined,
  viewerIsOfficer: boolean,
): boolean {
  if (viewerIsOfficer) return true;
  return !!viewerDiscordId && !!submitterDiscordId && viewerDiscordId === submitterDiscordId;
}
