// The download route's handler, shared by the two doors that reach it: /me/data/export (wolfpack.quest) and
// /guilds/data/export (raidmimic.com, where /guilds is the only signed-in path the middleware lets through).
//
// Nothing about the person comes from the request: no query string, no header, no body is read. The Discord id and
// login id come off the session cookie (resolveSelf), and every read is keyed on those (lib/selfData.ts).

import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveSelf, claimExport, exportChunks } from '@/lib/selfData';

const NO_STORE = { 'Cache-Control': 'no-store' };

function json(status: number, body: Record<string, unknown>, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE, ...extra } });
}

export async function handleExport(): Promise<Response> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return json(401, { error: 'Sign in first.' });

  const db = supabaseAdmin();
  const me = await resolveSelf(db, user);
  if (!me.ok) {
    return json(me.reason === 'mismatch' ? 403 : 400, {
      error: me.reason === 'mismatch'
        ? 'This login and its Discord account do not match, so nothing was exported. Ask an officer.'
        : 'This login has no Discord account on it, so there is nothing to export.',
    });
  }

  let slot;
  try { slot = await claimExport(db, me.ids.userId); }
  catch { return json(500, { error: 'Could not start the download just now. Try again in a minute.' }); }
  if (!slot.ok) {
    return json(429, { error: `You can download once every 10 minutes. Try again in about ${Math.ceil(slot.retryAfterSec / 60)} minute(s).` }, { 'Retry-After': String(slot.retryAfterSec) });
  }

  const now = new Date();
  const it = exportChunks(db, me.ids, now)[Symbol.asyncIterator]();
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const r = await it.next();
        if (r.done) controller.close(); else controller.enqueue(enc.encode(r.value));
      } catch (e) { controller.error(e); }
    },
    async cancel() { await it.return?.(undefined); },
  });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="raidmimic-data-${now.toISOString().slice(0, 10)}.json"`,
      ...NO_STORE,
    },
  });
}
