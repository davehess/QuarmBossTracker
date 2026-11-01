// The "Prepare my data" routes' handlers, shared by the two doors that reach them: /me/data/export/* (wolfpack.quest)
// and /guilds/data/export/* (raidmimic.com, where /guilds is the only signed-in path the middleware lets through).
//
//   manifest  GET .../export/manifest   the section list + the file's header. Claims the person's one-per-10-minutes slot.
//   part      GET .../export/part?s=<section>   ONE section, with a Content-Length.
//
// Nothing about the person comes from the request. The Discord id and login id come off the session cookie
// (resolveSelf), and every read is keyed on those (lib/selfData.ts). The part route reads exactly one thing from the
// request, `s`, and only to pick a table from the fixed allow-list; it is never part of a filter.

import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveSelf, claimExport, prepareIsOpen, exportHeader, exportSection, sectionBody, findSection, SELF_TABLES, type Ids } from '@/lib/selfData';

const NO_STORE = { 'Cache-Control': 'no-store' };

function json(status: number, body: Record<string, unknown>, extra: Record<string, string> = {}): Response {
  return bytes(status, JSON.stringify(body), extra);
}

/** A JSON response with its Content-Length, so the browser knows the size before it has read a byte. */
function bytes(status: number, text: string, extra: Record<string, string> = {}): Response {
  const body = new TextEncoder().encode(text);
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(body.length), ...NO_STORE, ...extra },
  });
}

type Who = { db: ReturnType<typeof supabaseAdmin>; ids: Ids };

async function whoIsAsking(): Promise<Who | Response> {
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
  return { db, ids: me.ids };
}

export async function handleManifest(): Promise<Response> {
  const who = await whoIsAsking();
  if (who instanceof Response) return who;

  let slot;
  try { slot = await claimExport(who.db, who.ids.userId); }
  catch { return json(500, { error: 'Could not start preparing your data just now. Try again in a minute.' }); }
  if (!slot.ok) {
    return json(429, { error: `You can prepare your data once every 10 minutes. Try again in about ${Math.ceil(slot.retryAfterSec / 60)} minute(s).` }, { 'Retry-After': String(slot.retryAfterSec) });
  }
  return json(200, { ...exportHeader(), sections: SELF_TABLES.map(t => ({ name: t.table, group: t.group })) });
}

export async function handlePart(request: Request): Promise<Response> {
  const who = await whoIsAsking();
  if (who instanceof Response) return who;

  // `s` selects a table from the fixed list and is used for nothing else.
  const spec = findSection(new URL(request.url).searchParams.get('s'));
  if (!spec) return json(400, { error: 'Unknown section.' });
  // Only right after this person's own Prepare: the 10-minute limit lives on the manifest, and this keeps it real.
  if (!(await prepareIsOpen(who.db, who.ids.userId))) return json(409, { error: 'Press Prepare first.' });

  return bytes(200, sectionBody(await exportSection(who.db, spec, who.ids)));
}
