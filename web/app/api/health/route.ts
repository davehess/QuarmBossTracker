// Lightweight, unauthenticated health probe for wolfpack.quest. Powers uptime
// monitoring and the agent dashboard's connection-health banner. It separates
// the two dependencies that can fail INDEPENDENTLY — Supabase Auth (GoTrue) and
// Postgres/PostgREST — because that's exactly what the 2026-07-13 raid-night
// incident looked like: GoTrue returned 504s (site-wide MIDDLEWARE_INVOCATION
// _TIMEOUTs) while Postgres stayed healthy. A single "is the site up?" ping
// couldn't tell those apart; this can.
//
// Each dependency check is time-boxed with AbortController and never throws, so
// the probe itself can't hang or 500. No auth, no DB writes, no caching. `ok`
// reflects app liveness (this handler ran → the app is serving); `degraded`
// flags a dependency that's slow or down for finer-grained alerting.
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const ANON     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const PROBE_TIMEOUT_MS = 2500;   // hard cap per dependency — never hang the probe
const SLOW_MS          = 1200;   // over this (but responding) → "slow", not "down"

type CheckState = 'ok' | 'slow' | 'down' | 'unconfigured';
interface Check { state: CheckState; ms: number | null; status?: number }

// Reachability probe: any HTTP answer (even 4xx) proves the service is up and
// responding; only a 5xx or a network/timeout failure counts as "down".
async function probe(path: string): Promise<Check> {
  if (!URL_BASE || !ANON) return { state: 'unconfigured', ms: null };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(URL_BASE + path, {
      method: 'GET',
      headers: { apikey: ANON, authorization: `Bearer ${ANON}` },
      cache: 'no-store',
      signal: ctrl.signal,
    });
    const ms = Date.now() - started;
    if (res.status >= 500) return { state: 'down', ms, status: res.status };
    return { state: ms > SLOW_MS ? 'slow' : 'ok', ms, status: res.status };
  } catch {
    // Abort (timeout) or transport error — treat as down.
    return { state: 'down', ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const [auth, db] = await Promise.all([
    probe('/auth/v1/health'),                     // GoTrue's own health endpoint
    probe('/rest/v1/eqemu_zone?limit=1'),         // PostgREST + Postgres (Tier-1 anon-readable)
  ]);
  const degraded = [auth, db].some(c => c.state === 'down' || c.state === 'slow');
  return NextResponse.json(
    { ok: true, degraded, checks: { auth, db }, ts: new Date().toISOString() },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
