// Screenshots on web feedback and roadmap suggestions (the guild lead, 2026-09-26: "feedback and
// suggestion needs to be able to take screenshots..top priority").
//
// Server-side only (imported by server actions and the officer page). Same rules as the bot's
// utils/feedbackShots.js: the bytes are sniffed and only a real JPEG, PNG or WebP of at most 5 MB
// is stored, three per report, in the PRIVATE `feedback-screenshots` bucket
// (migration 20260927003234). Paths carry a month, a source and a random id — never a name.

import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const SHOT_BUCKET = 'feedback-screenshots';
export const SHOT_MAX_BYTES = 5 * 1024 * 1024;
export const SHOT_MAX = 3;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
type Mime = keyof typeof EXT;

export function sniffImage(buf: Buffer | null | undefined): Mime | null {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function decodeShot(s: unknown): { buf: Buffer; mime: Mime } | null {
  if (typeof s !== 'string' || !s) return null;
  const m = /^data:[^;,]{1,64};base64,/.exec(s);
  const b64 = m ? s.slice(m[0].length) : s;
  if (b64.length > Math.ceil((SHOT_MAX_BYTES * 4) / 3) + 8) return null;
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length || buf.length > SHOT_MAX_BYTES) return null;
  const mime = sniffImage(buf);
  return mime ? { buf, mime } : null;
}

export function decodeShots(list: unknown): { buf: Buffer; mime: Mime }[] {
  return (Array.isArray(list) ? list : []).slice(0, SHOT_MAX)
    .map(decodeShot).filter((x): x is { buf: Buffer; mime: Mime } => !!x);
}

// Upload what decodes; returns the stored paths (possibly fewer than were sent).
export async function storeShots(admin: SupabaseClient, list: unknown, source: 'web' | 'roadmap'): Promise<string[]> {
  const out: string[] = [];
  for (const s of decodeShots(list)) {
    const now = new Date();
    const path = `${now.toISOString().slice(0, 7)}/${source}/${now.getTime()}-${randomBytes(6).toString('hex')}.${EXT[s.mime]}`;
    const { error } = await admin.storage.from(SHOT_BUCKET).upload(path, s.buf, { contentType: s.mime, upsert: false });
    if (!error) out.push(path);
  }
  return out;
}
