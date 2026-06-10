// Officer tool: agent uploader status board.
//
// Reads agent_uploads (one row per /api/agent/* happy-path) and
// agent_backfill_requests. Surfaces:
//
//   - Who's actively uploading right now (last 1h)
//   - Who's gone stale (was active in last 30d, nothing in last 24h)
//   - Per-character: agent version, last upload, endpoint mix, queue depth
//   - Recent errors (ok=false rows)
//   - Backfill request board (pending / acked / completed / dismissed)
//
// Empty until the bot writes rows. The bot was updated in v2.5.35 to track
// every successful upload — first agent ping after deploy populates this.

import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// One row per (character, endpoint) — a running counter, not a per-upload log.
// agent_uploads (a row per upload) was retired: at ~30k rows/day it was the
// fastest path to the Supabase free-tier cap. We keep the SAME signals (total
// uploads, last-seen, version, errors, agent_state) in a few hundred rows that
// never grow. Trade-off: no per-window (24h/7d) activity — just all-time totals
// + recency.
type StatRow = {
  character: string | null;
  endpoint: string;
  upload_count: number;
  error_count: number;
  first_uploaded_at: string;
  last_uploaded_at: string;
  agent_version: string | null;
  last_ok: boolean | null;
  last_status_code: number | null;
  last_error: string | null;
  last_agent_state: any;
  uploaded_by_discord_id: string | null;
};

type BackfillRow = {
  id: string;
  character: string;
  requested_at: string;
  requested_by_name: string | null;
  reason: string | null;
  scope: any;
  status: string;
  acked_at: string | null;
  dismissed_at: string | null;
  dismissed_reason: string | null;
  completed_at: string | null;
  error_message: string | null;
};

// Roster slice used to fold each uploading character into its main's family.
// main_name is the character's main (null/self when it IS the main);
// discord_id links the family to a Discord account when the member opted in.
type RosterRow = { name: string; main_name: string | null; discord_id: string | null };
type MemberRow = { discord_id: string; nickname: string | null; global_name: string | null };

async function loadData() {
  const admin = supabaseAdmin();
  const [{ data: stats }, { data: backfills }, { data: roster }, { data: members }] = await Promise.all([
    admin
      .from('agent_upload_stats')
      .select('character, endpoint, upload_count, error_count, first_uploaded_at, last_uploaded_at, agent_version, last_ok, last_status_code, last_error, last_agent_state, uploaded_by_discord_id')
      .order('last_uploaded_at', { ascending: false })
      .limit(2000),
    admin
      .from('agent_backfill_requests')
      .select('id, character, requested_at, requested_by_name, reason, scope, status, acked_at, dismissed_at, dismissed_reason, completed_at, error_message')
      .order('requested_at', { ascending: false })
      .limit(200),
    admin
      .from('characters')
      .select('name, main_name, discord_id')
      .eq('guild_id', 'wolfpack')
      .limit(5000),
    admin
      .from('wolfpack_members')
      .select('discord_id, nickname, global_name')
      .limit(5000),
  ]);
  return {
    stats:     (stats ?? []) as StatRow[],
    backfills: (backfills ?? []) as BackfillRow[],
    roster:    (roster ?? []) as RosterRow[],
    members:   (members ?? []) as MemberRow[],
  };
}

type MimicRelease = {
  tag_name:     string;
  name:         string;
  html_url:     string;
  published_at: string | null;
  prerelease:   boolean;
  assets:       { name: string; browser_download_url: string; size: number; download_count: number }[];
};

// Fetch Mimic releases from GitHub. Cached for 5 min — at 60 anonymous
// req/h this is well under the limit even with many officers looking.
async function loadMimicReleases(): Promise<MimicRelease[]> {
  try {
    const res = await fetch(
      'https://api.github.com/repos/davehess/QuarmBossTracker/releases?per_page=20',
      { headers: { Accept: 'application/vnd.github+json' }, next: { revalidate: 300 } },
    );
    if (!res.ok) return [];
    const all = (await res.json()) as MimicRelease[];
    // Detect Mimic releases channel-agnostically by their installer asset
    // name (Wolf-Pack-Mimic-Setup-*.exe). The pre-1.0.0 betas used a custom
    // mimic-beta.yml channel manifest, but 1.0.0 graduated to the stable
    // latest.yml channel. The Setup .exe asset is the stable signal across
    // both eras — every Mimic release ever cut has one, no other release
    // type in this repo does.
    return all
      .filter(r => r.assets.some(a => /^wolf-pack-mimic-setup-.*\.exe$/i.test(a.name)))
      .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
  } catch {
    return [];
  }
}

type CharSummary = {
  character: string;
  lastUpload: string;
  lastUploadMs: number;
  agentVersion: string | null;
  totalUploads: number;
  byEndpoint: Map<string, number>;
  totalErrors: number;
  lastError: { ts: string; endpoint: string; message: string | null; statusCode: number | null } | null;
  queuePending: number | null;
  fightActive: boolean | null;
  // Most-recent client identification from agent_state.client. 'mimic' when
  // the uploader is the Electron desktop client; 'parser' for Parser.bat
  // installs running agent v2.5.2+; null/'?' for older agents that didn't
  // stamp the field. appVersion is Mimic's own semver (only set when
  // client='mimic').
  client: string | null;
  appVersion: string | null;
  // Discord ID of whoever most-recently uploaded this character's stream (from
  // their per-user session token). Compared to the character's owner to flag
  // cross-account uploads (someone running a spouse's / friend's toon).
  uploadedBy: string | null;
  // True if ANY upload for this character ever carried a per-user Discord token.
  // false = only ever uploaded under the legacy shared token (a pre-discord-auth
  // "old one"). Drives the linked/legacy split.
  everAuthed: boolean;
  // Set when uploadedBy is NOT the character's owner — the display name of the
  // person actually driving the uploads, so the row can show an asterisk.
  foreignUploaderName: string | null;
  // True when this character isn't in the OpenDKP roster but we folded it into a
  // family via its uploader's Discord token (e.g. an un-rostered extra box).
  unrostered: boolean;
};

// Real EQ player names are letters only. The "(unknown)" sentinel (and the
// agent's "unknown" fallback) aren't characters, so they shouldn't link to a
// /character page.
function isRealCharacter(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.trim();
  return /^[A-Za-z]{2,}$/.test(n) && !['unknown', 'unattributed'].includes(n.toLowerCase());
}

// Roll the per-(character, endpoint) counter rows up to one summary per
// character: sum the counts, take the most-recent endpoint's last-seen /
// version / agent_state, and the most-recent error.
function summarize(stats: StatRow[]): CharSummary[] {
  const byChar = new Map<string, CharSummary>();
  for (const r of stats) {
    const name = r.character || '(unknown)';
    let s = byChar.get(name);
    if (!s) {
      s = {
        character: name,
        lastUpload: r.last_uploaded_at,
        lastUploadMs: new Date(r.last_uploaded_at).getTime(),
        agentVersion: r.agent_version,
        totalUploads: 0,
        byEndpoint: new Map(),
        totalErrors: 0,
        lastError: null,
        client: null,
        appVersion: null,
        queuePending: null,
        fightActive: null,
        uploadedBy: null,
        everAuthed: false,
        foreignUploaderName: null,
        unrostered: false,
      };
      byChar.set(name, s);
    }
    if (r.uploaded_by_discord_id) s.everAuthed = true;
    const ts = new Date(r.last_uploaded_at).getTime();
    if (ts >= s.lastUploadMs) {
      s.lastUploadMs = ts; s.lastUpload = r.last_uploaded_at; s.agentVersion = r.agent_version;
      if (r.uploaded_by_discord_id) s.uploadedBy = r.uploaded_by_discord_id;
      // Latest agent_state for live "queue depth" view (from the most-recent endpoint).
      if (r.last_agent_state && typeof r.last_agent_state === 'object') {
        s.queuePending = (r.last_agent_state.queue_pending ?? null) as number | null;
        s.fightActive  = (r.last_agent_state.fight_active ?? null) as boolean | null;
        s.client       = (r.last_agent_state.client ?? null) as string | null;
        s.appVersion   = (r.last_agent_state.app_version ?? null) as string | null;
      }
    }
    s.totalUploads += Number(r.upload_count) || 0;
    s.totalErrors  += Number(r.error_count) || 0;
    s.byEndpoint.set(r.endpoint, (s.byEndpoint.get(r.endpoint) ?? 0) + (Number(r.upload_count) || 0));
    if (r.last_ok === false && r.last_error && (!s.lastError || ts > new Date(s.lastError.ts).getTime())) {
      s.lastError = { ts: r.last_uploaded_at, endpoint: r.endpoint, message: r.last_error, statusCode: r.last_status_code };
    }
  }
  return [...byChar.values()].sort((a, b) => b.lastUploadMs - a.lastUploadMs);
}

// A family = one main + every character that uploads under it. Built by
// resolving each uploading character to its main via the roster (characters
// not in the roster group under their own name). Aggregates the per-character
// summaries up to the family for the collapsed top-line view; the expanded
// dropdown shows each character's own detail.
type Family = {
  mainName: string;
  discordId: string | null;
  ownerNick: string | null;   // Discord nickname of the family owner, if known
  members: CharSummary[];
  latestMs: number;
  latestUpload: string;
  totalUploads: number;
  totalErrors: number;
  versions: string[];
  queueMax: number;
  anyFight: boolean;
  anyForeign: boolean;
  linked: boolean;            // any member uploads with a per-user Discord token
  // Other family mains whose streams ride the SAME per-user token as this
  // family's — almost always one human whose alts were never parented in
  // OpenDKP (Adiwen/Wabumkin). Fixable from /admin/links → Family links.
  sameUploaderAs: string[];
};

// Group uploading characters into one family per owner. Discord-auth aware:
//   1. A character in the OpenDKP roster folds into its main (as before).
//   2. A character NOT in the roster but uploaded under a per-user Discord token
//      folds into whatever family that Discord account owns — so an un-rostered
//      extra box (e.g. "Dant3", run by Dant's owner) lands under Dant instead of
//      floating as its own orphan main.
//   3. Anything else (no roster row, no recognizable uploader) stays on its own.
// The most-recent uploader is still compared to the owner to flag cross-account
// runs with an asterisk — that toon stays under its OWNER, not the runner.
function groupByMain(summaries: CharSummary[], roster: RosterRow[], memberName: Map<string, string>): Family[] {
  const charMap = new Map<string, { main: string; discordId: string | null }>();
  for (const r of roster) {
    const main = (r.main_name && r.main_name.trim()) || r.name;
    charMap.set(r.name.toLowerCase(), { main, discordId: r.discord_id ?? null });
  }
  // main(lower) → display name, and main(lower) → the family's Discord ID (any
  // family member that has one — mains often have discord_id null while an alt
  // carries the link).
  const mainDisplay = new Map<string, string>();
  const mainDiscord = new Map<string, string>();
  for (const r of roster) {
    const main = (r.main_name && r.main_name.trim()) || r.name;
    const mk = main.toLowerCase();
    if (!mainDisplay.has(mk)) mainDisplay.set(mk, main);
    if (r.discord_id && !mainDiscord.has(mk)) mainDiscord.set(mk, r.discord_id);
  }
  // Discord ID → the main(lower) it owns, to attribute un-rostered toons.
  const discordToMain = new Map<string, string>();
  for (const [mk, did] of mainDiscord) if (!discordToMain.has(did)) discordToMain.set(did, mk);

  // The Discord ID that OWNS a character: its own discord_id, else its main's.
  const ownerOf = (charLower: string): string | null => {
    const e = charMap.get(charLower);
    if (!e) return null;
    return e.discordId ?? mainDiscord.get(e.main.toLowerCase()) ?? null;
  };

  const fams = new Map<string, Family>();
  for (const s of summaries) {
    const lower  = (s.character || '').toLowerCase();
    const lookup = charMap.get(lower);
    let mainName: string, key: string, owner: string | null;
    if (lookup) {
      mainName = lookup.main; key = mainName.toLowerCase();
      owner = ownerOf(lower);
    } else if (s.uploadedBy && discordToMain.has(s.uploadedBy)) {
      // Un-rostered toon, attributed to its uploader's family via the token.
      key = discordToMain.get(s.uploadedBy)!;
      mainName = mainDisplay.get(key) || s.character;
      owner = s.uploadedBy;            // the uploader IS the owner here
      s.unrostered = true;
    } else {
      mainName = s.character; key = lower; owner = s.uploadedBy ?? null;
    }

    // Cross-account flag: the most-recent uploader isn't this character's owner
    // (e.g. running a spouse's / friend's toon to fill a class). Valid upload —
    // just annotate it so the toon stays under its owner with an asterisk.
    if (s.uploadedBy && owner && s.uploadedBy !== owner) {
      s.foreignUploaderName = memberName.get(s.uploadedBy) || 'another member';
    }

    let f = fams.get(key);
    if (!f) {
      f = { mainName, discordId: mainDiscord.get(key) ?? null, ownerNick: null, members: [], latestMs: 0, latestUpload: '', totalUploads: 0, totalErrors: 0, versions: [], queueMax: 0, anyFight: false, anyForeign: false, linked: false, sameUploaderAs: [] };
      fams.set(key, f);
    }
    f.members.push(s);
    f.totalUploads += s.totalUploads;
    f.totalErrors  += s.totalErrors;
    if (s.lastUploadMs > f.latestMs) { f.latestMs = s.lastUploadMs; f.latestUpload = s.lastUpload; }
    if (s.agentVersion && !f.versions.includes(s.agentVersion)) f.versions.push(s.agentVersion);
    if ((s.queuePending ?? 0) > f.queueMax) f.queueMax = s.queuePending ?? 0;
    if (s.fightActive) f.anyFight = true;
    if (s.foreignUploaderName) f.anyForeign = true;
    if (s.everAuthed) f.linked = true;
    if (!f.discordId && (lookup?.discordId || s.uploadedBy)) f.discordId = lookup?.discordId ?? s.uploadedBy ?? null;
  }
  for (const f of fams.values()) {
    f.members.sort((a, b) => b.lastUploadMs - a.lastUploadMs);
    f.versions.sort().reverse();
    if (f.discordId) {
      const nick = memberName.get(f.discordId);
      // Only show the nickname when it adds info beyond the main's name.
      if (nick && nick.toLowerCase() !== f.mainName.toLowerCase()) f.ownerNick = nick;
    }
  }

  // Same-token detection: when one per-user Discord token uploads for
  // MULTIPLE families, flag each so officers spot the un-parented-alt split
  // (the Adiwen/Wabumkin case) instead of believing two separate people are
  // running agents. The fix lives at /admin/links → Family links.
  const famsByToken = new Map<string, Family[]>();
  for (const f of fams.values()) {
    const tokens = new Set<string>();
    for (const s of f.members) if (s.uploadedBy) tokens.add(s.uploadedBy);
    for (const t of tokens) {
      const list = famsByToken.get(t) ?? [];
      list.push(f);
      famsByToken.set(t, list);
    }
  }
  for (const list of famsByToken.values()) {
    if (list.length < 2) continue;
    for (const f of list) {
      for (const other of list) {
        if (other !== f && !f.sameUploaderAs.includes(other.mainName)) f.sameUploaderAs.push(other.mainName);
      }
    }
  }

  return [...fams.values()].sort((a, b) => b.latestMs - a.latestMs);
}

function rel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000)    return 'just now';
  if (ms < 3600_000)  return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`;
  return `${Math.floor(ms / 86400_000)}d ago`;
}

// Compare two semver-ish strings ("3.0.66" or "3.0.66-beta.3") so a sort
// returns oldest first. Two-digit minor/patch sorts correctly (3.0.10 > 3.0.9),
// which a lexical compare gets wrong. Pre-release tags ("-beta.N") count as
// older than the same base, matching how the agent treats them downstream.
function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/, '').split('-');
    const parts = core.split('.').map(n => parseInt(n, 10) || 0);
    while (parts.length < 3) parts.push(0);
    return { parts, pre: pre || null };
  };
  const pa = parse(a), pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa.parts[i] !== pb.parts[i]) return pa.parts[i] - pb.parts[i];
  }
  // Same core. A prerelease sorts BEFORE a non-prerelease of the same core.
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return  1;
  if (pa.pre && pb.pre)  return pa.pre.localeCompare(pb.pre);
  return 0;
}

function fmtTs(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export default async function AdminAgentsPage() {
  const [{ stats, backfills, roster, members }, mimicReleases] = await Promise.all([
    loadData(),
    loadMimicReleases(),
  ]);
  // discord_id → display name, for naming a cross-account uploader.
  const memberName = new Map<string, string>(
    members.map(m => [m.discord_id, (m.nickname || m.global_name || m.discord_id)] as const),
  );
  const summaries = summarize(stats);
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  // "Dormant" = not seen in a full raid-week (Sun/Wed/Thu means a 4-day gap
  // between raid nights is normal, so 7 days is the first point we can call a
  // stream genuinely gone quiet without hiding a regular mid-week raider).
  // Dormant families are HIDDEN from the board but kept in the database — they
  // pop back the moment that character uploads again.
  const dormantDays = 7;
  const dormantMs   = dormantDays * day;

  const active = summaries.filter(s => now - s.lastUploadMs <= day);
  const stale  = summaries.filter(s => now - s.lastUploadMs > day && now - s.lastUploadMs <= dormantMs);

  // Family view: fold characters into their main, split active/quiet/dormant by
  // the family's most-recent upload across all its characters.
  const families       = groupByMain(summaries, roster, memberName);
  const activeFamilies  = families.filter(f => now - f.latestMs <= day);
  const staleFamilies   = families.filter(f => now - f.latestMs > day && now - f.latestMs <= dormantMs);
  const dormantFamilies = families.filter(f => now - f.latestMs > dormantMs);
  const dormantChars    = dormantFamilies.reduce((a, f) => a + f.members.length, 0);
  const totalUploads = stats.reduce((a, r) => a + (Number(r.upload_count) || 0), 0);
  const totalErrors  = stats.reduce((a, r) => a + (Number(r.error_count)  || 0), 0);
  // "Recent errors" is now the current last-error per character (one row each),
  // newest first — we no longer keep a per-upload error log.
  const recentErrors = summaries
    .filter(s => s.lastError)
    .map(s => ({ character: s.character, ...s.lastError! }))
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, 40);

  // Version histogram
  const byVersion = new Map<string, number>();
  for (const s of active) {
    const v = s.agentVersion || '(unknown)';
    byVersion.set(v, (byVersion.get(v) ?? 0) + 1);
  }
  const versions = [...byVersion.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));

  // Backfill request status breakdown
  const bfByStatus = new Map<string, BackfillRow[]>();
  for (const b of backfills) {
    const list = bfByStatus.get(b.status) ?? [];
    list.push(b);
    bfByStatus.set(b.status, list);
  }
  const bfCounts = {
    pending:   (bfByStatus.get('pending')   ?? []).length,
    acked:     (bfByStatus.get('acked')     ?? []).length,
    running:   (bfByStatus.get('running')   ?? []).length,
    completed: (bfByStatus.get('completed') ?? []).length,
    dismissed: (bfByStatus.get('dismissed') ?? []).length,
    errored:   (bfByStatus.get('errored')   ?? []).length,
  };

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/admin" className="text-blue hover:underline">← back to admin</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">🛰️ Agent fleet</h2>
        <p className="text-sm text-dim leading-6">
          Every upload to <code>/api/agent/*</code> bumps a per-character counter
          in <code>agent_upload_stats</code> (a few hundred rows total — the old
          row-per-upload <code>agent_uploads</code> log was retired to stay on the
          Supabase free tier). Totals are all-time; activity is shown by last-seen.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4 text-xs">
          <Stat label="Active 24h"    value={active.length} color="text-green" />
          <Stat label="Quiet (this week)" value={stale.length} color="text-orange" />
          <Stat label="Dormant (hidden)" value={dormantChars} color="text-dim" />
          <Stat label="Total uploads" value={totalUploads} />
          <Stat label="Total errors"  value={totalErrors} color="text-red-400" />
          <Stat label="Backfill open" value={bfCounts.pending + bfCounts.acked + bfCounts.running} color="text-blue" />
        </div>
        {versions.length > 0 && (
          <div className="text-xs text-dim mt-4">
            <span className="text-dim">Active fleet versions:</span>
            {' '}
            {versions.map(([v, n], i) => (
              <span key={v}>
                {i > 0 && ' · '}
                <span className="text-text">{v}</span>
                <span className="text-dim"> ×{n}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Mimic — Electron desktop client. Mostly informational until the
          agent identifies itself as Mimic in agent_state; for now we pull
          beta-channel state from GitHub releases. */}
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">🐺 Mimic</h2>
        <p className="text-sm text-dim leading-6">
          The Electron desktop client. Wraps the same <code>wolfpack-logsync</code> agent in a
          native shell with a DPS overlay + trigger TTS, bundles its own Node runtime, and
          auto-updates via the standard <code className="text-blue">latest</code> channel. Downloads at{' '}
          <a href="/mimic" target="_blank" rel="noreferrer" className="text-blue hover:underline">wolfpack.quest/mimic</a>{' '}
          (stable redirect to the latest release).
        </p>

        {mimicReleases.length === 0 ? (
          <EmptyHint>
            Couldn&apos;t reach the GitHub API to list Mimic releases (rate limit or transient).
            The download link still works.
          </EmptyHint>
        ) : (() => {
          // Split by GitHub's prerelease flag — release-mimic.yml marks every
          // x.y.z-beta.N build prerelease and every stable cut as not. The two
          // heads (stable + beta) are what officers need to see at a glance.
          const stable = mimicReleases.filter(r => !r.prerelease);
          const betas  = mimicReleases.filter(r =>  r.prerelease);
          const latestStable = stable[0] ?? null;
          const latestBeta   = betas[0]  ?? null;
          // "Installer (MB)" stays anchored to whatever's at the very top of
          // the list (newest publish date across both channels) since that
          // matches how Downloads (latest) is read below.
          const newest = mimicReleases[0];
          const newestExe = newest?.assets?.find(a => /\.exe$/i.test(a.name));
          return (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
              <Stat
                label="Latest stable"
                value={latestStable ? latestStable.tag_name.replace(/^v/, '') : '—'}
                color="text-green"
              />
              <Stat
                label="Latest beta"
                value={latestBeta ? latestBeta.tag_name.replace(/^v/, '') : '—'}
                color="text-blue"
              />
              <Stat label="Releases (stable / beta)" value={`${stable.length} / ${betas.length}`} />
              <Stat
                label="Downloads (latest)"
                value={newestExe?.download_count ?? 0}
                color="text-green"
              />
            </div>
            {newestExe && (
              <div className="mt-1 text-[10px] text-dim">
                Installer: {Math.round((newestExe.size ?? 0) / (1024 * 1024))}MB ({newestExe.name})
              </div>
            )}

            <div className="mt-5">
              <div className="text-xs text-dim uppercase tracking-widest mb-2">Recent releases</div>
              <div className="space-y-2">
                {mimicReleases.slice(0, 8).map(r => {
                  const exe = r.assets.find(a => /\.exe$/i.test(a.name));
                  const isLatestStable = r === latestStable;
                  const isLatestBeta   = r === latestBeta;
                  const isPrerelease   = r.prerelease;
                  return (
                    <div key={r.tag_name} className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs border-l-2 pl-3 py-1 ${isLatestStable ? 'border-green/60' : isPrerelease ? 'border-blue/40' : 'border-border'} hover:border-blue/60`}>
                      <span className={(isLatestStable || isLatestBeta) ? 'text-text font-semibold' : 'text-text'}>{r.tag_name}</span>
                      {isLatestStable && (
                        <span className="text-[9px] uppercase tracking-widest text-green border border-green/50 rounded px-1.5 py-0.5">latest</span>
                      )}
                      {isLatestBeta && (
                        <span className="text-[9px] uppercase tracking-widest text-blue border border-blue/50 rounded px-1.5 py-0.5">latest beta</span>
                      )}
                      {isPrerelease && !isLatestBeta && (
                        <span className="text-[9px] uppercase tracking-widest text-dim border border-border rounded px-1.5 py-0.5">beta</span>
                      )}
                      {!isPrerelease && !isLatestStable && (
                        <span className="text-[9px] uppercase tracking-widest text-dim border border-border rounded px-1.5 py-0.5">stable</span>
                      )}
                      <span className="text-dim">{fmtTs(r.published_at)}</span>
                      {exe ? (
                        <>
                          <a href={r.html_url} target="_blank" rel="noreferrer" className="text-blue hover:underline ml-auto">release notes ↗</a>
                          <a href={exe.browser_download_url} className="text-blue hover:underline" title={`${exe.name} (${Math.round(exe.size / 1024 / 1024)}MB · ${exe.download_count} dl)`}>installer ↗</a>
                        </>
                      ) : (
                        <span className="text-orange ml-auto text-[10px]">no .exe attached (build failed?)</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
          );
        })()}

        <div className="mt-5 text-xs text-dim leading-6 border-t border-border/60 pt-4">
          <div className="text-text mb-1">Officer ops cheat-sheet</div>
          <ul className="list-disc list-inside space-y-1">
            <li>Tester reports the engine won&apos;t start? The loading screen shows the agent log inline with a copy button — ask them to paste it.</li>
            <li>Tester stuck on a pre-1.0.0 beta? The old <code className="text-blue">mimic-beta</code> update channel was retired at 1.0.0, so beta installs won&apos;t auto-update across the switch. Have them grab a fresh installer from <a href="/mimic" target="_blank" rel="noreferrer" className="text-blue hover:underline">/mimic</a>; settings + state preserved across install. Once on 1.0.0+ everything auto-updates again.</li>
            <li>Per-tester fleet visibility (Mimic vs Parser.bat) requires the agent to identify itself in <code>agent_state</code>; planned for a follow-up. Until then this section is informational and the Active table below mixes both clients.</li>
          </ul>
        </div>
      </section>

      {/* Active uploaders — grouped by main, expand to see each character */}
      <section className="bg-panel border border-border rounded-lg">
        <h3 className="text-sm text-orange px-4 py-3 border-b border-border">
          Active mains (uploaded in last 24h) — {activeFamilies.length}
          <span className="text-dim font-normal"> · {active.length} character{active.length === 1 ? '' : 's'}</span>
        </h3>
        {activeFamilies.length === 0 ? (
          <EmptyHint>
            No agent uploads in the last 24 hours. Either the bot hasn&apos;t
            redeployed yet, or no agents are currently running. Once an upload
            lands it shows here, grouped under the uploader&apos;s main —
            expand a row to see each character, version, and endpoint mix.
          </EmptyHint>
        ) : (
          <div>{activeFamilies.map(f => <FamilyRow key={f.mainName} fam={f} />)}</div>
        )}
      </section>

      {/* Quiet uploaders — went silent in the last 24h but seen within the
          raid-week, so likely just between raid nights. Collapsed by default.
          Anything dormant past {dormantDays}d is hidden entirely (below). */}
      {staleFamilies.length > 0 && (
        <details className="group bg-panel border border-border rounded-lg [&_summary::-webkit-details-marker]:hidden">
          <summary className="text-sm text-orange px-4 py-3 border-b border-border cursor-pointer select-none flex items-center gap-2 hover:bg-[#1a212c]">
            <span className="text-dim text-[10px] transition-transform group-[[open]]:rotate-90">▶</span>
            Quiet mains (no upload in 24h, seen this week) — {staleFamilies.length}
            <span className="text-dim font-normal"> · {stale.length} character{stale.length === 1 ? '' : 's'}</span>
            <span className="text-dim font-normal text-[11px] ml-auto">click to expand</span>
          </summary>
          <div>{staleFamilies.map(f => <FamilyRow key={f.mainName} fam={f} stale />)}</div>
        </details>
      )}

      {/* Dormant streams are hidden, not deleted — surfaced only as a count so
          the board stays clean while the history stays in the database. */}
      {dormantFamilies.length > 0 && (
        <div className="text-xs text-dim px-1">
          💤 {dormantFamilies.length} dormant {dormantFamilies.length === 1 ? 'stream' : 'streams'}
          {' '}({dormantChars} character{dormantChars === 1 ? '' : 's'}) not seen in {dormantDays}+ days are hidden —
          their upload history is kept in the database and they reappear automatically on the next upload.
        </div>
      )}

      {/* Last error per character (we no longer keep a per-upload error log) */}
      {recentErrors.length > 0 && (
        <section className="bg-panel border border-border rounded-lg">
          <h3 className="text-sm text-orange px-4 py-3 border-b border-border">
            Last error per character — {recentErrors.length} character{recentErrors.length === 1 ? '' : 's'} with a recent failure
          </h3>
          <table className="w-full text-xs">
            <thead className="text-dim">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 font-normal">When</th>
                <th className="text-left px-3 py-2 font-normal">Character</th>
                <th className="text-left px-3 py-2 font-normal">Endpoint</th>
                <th className="text-right px-3 py-2 font-normal">Status</th>
                <th className="text-left px-3 py-2 font-normal">Error</th>
              </tr>
            </thead>
            <tbody>
              {recentErrors.map(e => (
                <tr key={e.character + e.endpoint} className="border-b border-border/40 hover:bg-[#1a212c]">
                  <td className="px-3 py-2 text-dim">{fmtTs(e.ts)}</td>
                  <td className="px-3 py-2 text-text">{e.character || '—'}</td>
                  <td className="px-3 py-2 text-text">{e.endpoint}</td>
                  <td className="px-3 py-2 text-right text-red-400">{e.statusCode ?? '—'}</td>
                  <td className="px-3 py-2 text-dim text-[11px]">{e.message || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Backfill request board */}
      <section className="bg-panel border border-border rounded-lg">
        <h3 className="text-sm text-orange px-4 py-3 border-b border-border">
          Backfill requests
        </h3>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 p-4 text-xs">
          <Stat label="Pending"   value={bfCounts.pending}   color="text-orange" />
          <Stat label="Acked"     value={bfCounts.acked}     color="text-blue" />
          <Stat label="Running"   value={bfCounts.running}   color="text-blue" />
          <Stat label="Completed" value={bfCounts.completed} color="text-green" />
          <Stat label="Dismissed" value={bfCounts.dismissed} color="text-dim" />
          <Stat label="Errored"   value={bfCounts.errored}   color="text-red-400" />
        </div>
        {backfills.length === 0 ? (
          <EmptyHint>
            No backfill requests filed yet. Officers can file them from
            <Link href="/admin/encounters" className="text-blue hover:underline mx-1">/admin/encounters</Link>
            via the "Request backfill" form on any encounter row. Agents will
            poll <code>/api/agent/backfill-requests</code> for their character
            and report back as they process each one.
          </EmptyHint>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-dim">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 font-normal">Filed</th>
                <th className="text-left px-3 py-2 font-normal">Character</th>
                <th className="text-left px-3 py-2 font-normal">Scope</th>
                <th className="text-left px-3 py-2 font-normal">Status</th>
                <th className="text-left px-3 py-2 font-normal">Reason / outcome</th>
              </tr>
            </thead>
            <tbody>
              {backfills.slice(0, 50).map(b => {
                const start = b.scope?.start_iso ? fmtTs(b.scope.start_iso) : '—';
                const end   = b.scope?.end_iso   ? fmtTs(b.scope.end_iso)   : '—';
                const statusCls =
                  b.status === 'completed' ? 'text-green' :
                  b.status === 'errored'   ? 'text-red-400' :
                  b.status === 'dismissed' ? 'text-dim' :
                  b.status === 'running'   ? 'text-blue' :
                  b.status === 'acked'     ? 'text-blue' :
                  'text-orange';
                const outcome =
                  b.status === 'errored'   ? `error: ${b.error_message || '—'}` :
                  b.status === 'dismissed' ? `dismissed: ${b.dismissed_reason || '—'}` :
                  b.status === 'completed' ? 'completed' :
                  (b.reason || '—');
                return (
                  <tr key={b.id} className="border-b border-border/40 hover:bg-[#1a212c]">
                    <td className="px-3 py-2 text-dim whitespace-nowrap">{fmtTs(b.requested_at)}</td>
                    <td className="px-3 py-2 text-text">{b.character}</td>
                    <td className="px-3 py-2 text-dim text-[10px]">{start} → {end}</td>
                    <td className={`px-3 py-2 text-[11px] ${statusCls}`}>{b.status}</td>
                    <td className="px-3 py-2 text-dim text-[11px]">{outcome}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// One collapsible family: a <summary> top-line (the main, aggregated) plus an
// expandable per-character detail table. Native <details>/<summary> so it
// works in a server component with zero client JS.
function FamilyRow({ fam, stale = false }: { fam: Family; stale?: boolean }) {
  const familyStatus =
    fam.totalErrors > 0 ? <span className="text-red-400">{fam.totalErrors} err</span> :
    fam.queueMax > 0     ? <span className="text-orange">Q={fam.queueMax}</span> :
    fam.anyFight         ? <span className="text-blue">in-fight</span> :
                           <span className="text-green">healthy</span>;
  // A family that's just one character IS its own main — no point expanding to
  // a single identical row, but we still render the dropdown for consistency.
  const multi = fam.members.length > 1;
  return (
    <details className="group border-b border-border/40 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#1a212c] select-none">
        <span className="text-dim text-[10px] w-3 shrink-0 transition-transform group-[[open]]:rotate-90">▶</span>
        <span className="text-text font-medium min-w-0 truncate">
          {isRealCharacter(fam.mainName) ? (
            <Link href={`/character/${encodeURIComponent(fam.mainName)}`} className="text-blue hover:underline">{fam.mainName}</Link>
          ) : (
            <span className="text-dim" title="Operator-level streams (chat / pvp / fun events) with no single character">{fam.mainName}</span>
          )}
          {fam.ownerNick && <span className="text-dim text-[10px] font-normal ml-1.5">({fam.ownerNick})</span>}
        </span>
        <span className="text-[10px] text-dim border border-border rounded px-1.5 py-0.5 shrink-0">
          {fam.members.length} char{fam.members.length === 1 ? '' : 's'}
        </span>
        {/* Discord-auth state: linked = at least one box runs a per-user token
            (the going-forward world); legacy = only the old shared token. The
            linked chip is just the Discord brand mark inside a green border —
            the title="..." tooltip carries the meaning so the icon stays
            self-explanatory without taking a column of text. */}
        {fam.linked ? (
          <span className="text-green border border-green/40 rounded px-1.5 py-0.5 shrink-0 inline-flex items-center" title="Uploading under a per-user Discord login">
            <svg viewBox="0 0 71 55" className="w-3 h-3" fill="currentColor" aria-hidden="true">
              <path d="M60.1 4.9A58.5 58.5 0 0045.6.4l-.7 1.3a52.7 52.7 0 00-15.4 0L28.8.4a58 58 0 00-14.5 4.5C5.4 18 3 31 4.2 43.6a59 59 0 0017.9 9.1c1.4-2 2.7-4 3.8-6.3a38 38 0 01-6-2.9c.5-.4 1-.7 1.5-1.1A41.7 41.7 0 0035.5 47a41.6 41.6 0 0014-3.6c.5.4 1 .7 1.5 1.1-1.9 1.1-3.9 2.1-6 2.9 1 2.2 2.4 4.3 3.8 6.3a59 59 0 0017.9-9.1c1.3-14.6-2.5-27.5-6.6-38.7zM23.7 36c-3.4 0-6.2-3.1-6.2-7s2.8-7 6.2-7c3.4 0 6.3 3.2 6.2 7 0 3.9-2.8 7-6.2 7zm23 0c-3.4 0-6.2-3.1-6.2-7s2.8-7 6.2-7c3.4 0 6.3 3.2 6.2 7 0 3.9-2.8 7-6.2 7z"/>
            </svg>
          </span>
        ) : (
          <span className="text-[9px] uppercase tracking-widest text-dim border border-border rounded px-1.5 py-0.5 shrink-0" title="Still on the legacy shared token — ask them to sign in with Discord in Mimic">legacy</span>
        )}
        {fam.anyForeign && (
          <span className="text-gold text-sm shrink-0" title="Includes a toon being run by someone other than its owner — expand for details">*</span>
        )}
        {fam.sameUploaderAs.length > 0 && (
          <Link
            href="/admin/links"
            className="text-orange text-[10px] border border-orange/50 rounded px-1.5 py-0.5 shrink-0 no-underline hover:bg-orange/10"
            title={`Same Mimic install also uploads ${fam.sameUploaderAs.join(', ')} — probably one person whose alts aren't parented in OpenDKP. Fix under /admin/links → Family links.`}
          >
            ⚠ same uploader as {fam.sameUploaderAs.join(', ')}
          </Link>
        )}
        <span className="text-dim text-xs ml-auto whitespace-nowrap">{rel(fam.latestUpload)}</span>
        {/* Version chip — visible on every breakpoint (was hidden on mobile).
            Picks the highest semver across the family so a 6-char family with
            one stale box shows the up-to-date version; appends * when versions
            disagree. Full list still surfaces via the title= tooltip. */}
        {(() => {
          const vs = (fam.versions || []).filter(Boolean);
          if (vs.length === 0) {
            return <span className="text-dim text-[10px] tabular-nums shrink-0">—</span>;
          }
          const sorted = [...vs].sort(compareSemver).reverse();
          const top    = sorted[0];
          const mixed  = vs.some(v => v !== top);
          return (
            <span
              className={`text-[10px] tabular-nums shrink-0 font-mono ${mixed ? 'text-orange' : 'text-dim'}`}
              title={mixed ? `Versions in family: ${vs.join(', ')}` : `Agent v${top}`}
            >
              v{top}{mixed && '*'}
            </span>
          );
        })()}
        <span className="text-text text-xs hidden sm:inline tabular-nums w-16 text-right">{fam.totalUploads.toLocaleString()}</span>
        <span className="text-[10px] w-16 text-right shrink-0">{familyStatus}</span>
      </summary>

      <div className="bg-[#0e131a] border-t border-border/40">
        <table className="w-full text-xs">
          <thead className="text-dim">
            <tr className="border-b border-border/40">
              <th className="text-left pl-8 pr-3 py-1.5 font-normal">Character</th>
              <th className="text-left px-3 py-1.5 font-normal">Last upload</th>
              <th className="text-left px-3 py-1.5 font-normal hidden md:table-cell">Agent</th>
              <th className="text-right px-3 py-1.5 font-normal hidden sm:table-cell">Total</th>
              <th className="text-left px-3 py-1.5 font-normal hidden lg:table-cell">Endpoint mix</th>
              <th className="text-left px-3 py-1.5 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {fam.members.map(s => {
              const isMain = s.character.toLowerCase() === fam.mainName.toLowerCase();
              return (
                <tr key={s.character} className="border-b border-border/20 last:border-0 hover:bg-[#141b24]">
                  <td className="pl-8 pr-3 py-1.5 text-text">
                    {isRealCharacter(s.character) ? (
                      <Link href={`/character/${encodeURIComponent(s.character)}`} className="text-blue hover:underline">{s.character}</Link>
                    ) : (
                      <span className="text-dim">{s.character}</span>
                    )}
                    {multi && isMain && <span className="ml-1.5 text-[9px] uppercase tracking-widest text-gold border border-gold/40 rounded px-1 py-0.5 align-middle">main</span>}
                    {s.unrostered && (
                      <span className="ml-1.5 text-[9px] uppercase tracking-widest text-dim border border-border rounded px-1 py-0.5 align-middle" title="Not in the OpenDKP roster — folded into this family by its Discord uploader token. Add it as an alt to label it properly.">unrostered</span>
                    )}
                    {s.foreignUploaderName && (
                      <span className="ml-1.5 text-gold" title={`Uploaded by ${s.foreignUploaderName} (not the owner)`}>
                        *<span className="text-[10px] text-dim ml-0.5">by {s.foreignUploaderName}</span>
                      </span>
                    )}
                    <ClientChip client={s.client} appVersion={s.appVersion} agentVersion={s.agentVersion} />
                    <div className="text-dim text-[10px] sm:hidden">{s.agentVersion || '—'} · {s.totalUploads.toLocaleString()} uploads</div>
                  </td>
                  <td className="px-3 py-1.5 text-dim whitespace-nowrap">{rel(s.lastUpload)}{stale && <span className="text-[10px]"> · {fmtTs(s.lastUpload)}</span>}</td>
                  <td className="px-3 py-1.5 text-text hidden md:table-cell">{s.agentVersion || '—'}</td>
                  <td className="px-3 py-1.5 text-right text-text hidden sm:table-cell tabular-nums">{s.totalUploads.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-dim text-[10px] hidden lg:table-cell">
                    {[...s.byEndpoint.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(' · ')}
                  </td>
                  <td className="px-3 py-1.5 text-[10px]">
                    {s.totalErrors > 0 && <span className="text-red-400">{s.totalErrors} err</span>}
                    {s.queuePending != null && s.queuePending > 0 && <span className="text-orange ml-1">Q={s.queuePending}</span>}
                    {s.fightActive && <span className="text-blue ml-1">in-fight</span>}
                    {s.totalErrors === 0 && (s.queuePending ?? 0) === 0 && !s.fightActive && <span className="text-green">healthy</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Stat({ label, value, color = 'text-text' }: { label: string; value: number | string; color?: string }) {
  const display = typeof value === 'number' ? value.toLocaleString() : value;
  // String values (version strings, "x / y" splits) need to size down so a
  // long beta tag like "1.0.58-beta.10" doesn't break the card; numbers keep
  // the big-2xl headline treatment.
  const sizeClass = typeof value === 'number' ? 'text-2xl' : 'text-lg';
  return (
    <div className="bg-bg border border-border rounded p-3">
      <div className={`${sizeClass} ${color}`}>{display}</div>
      <div className="text-dim text-xs">{label}</div>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="p-6 text-sm text-dim leading-6">{children}</div>;
}

// Client identification chip — colored per client so Mimic installs are
// visually distinct from Parser.bat installs on the agent fleet table.
// 'mimic' is blue (matches the Mimic button branding), 'parser' is dim,
// null/unknown gets a tentative chip ONLY if the agent version matches
// the Mimic-bundled bundle (2.5.2+) — Parser.bat installs haven't auto-
// updated to 2.5.2 yet so it's a reliable temporary heuristic. Once
// every active install reports agent_state.client explicitly, the
// heuristic stops matching anything and naturally retires.
function ClientChip({ client, appVersion, agentVersion }: { client: string | null; appVersion: string | null; agentVersion?: string | null }) {
  // Heuristic fallback for missing client tag.
  let resolved = client;
  let inferred = false;
  if (!resolved && agentVersion && /^2\.5\.[2-9]|^2\.[6-9]|^[3-9]\./.test(agentVersion)) {
    resolved = 'mimic';
    inferred = true;
  }
  if (!resolved) return null;
  const isMimic = resolved === 'mimic';
  const cls = isMimic
    ? 'bg-[#1f6feb22] text-blue border-blue/40'
    : 'bg-[#1a212c] text-dim border-border';
  const label = isMimic ? '🐺 Mimic' : 'Parser.bat';
  const suffix = appVersion ? `v${appVersion}` : (inferred ? '?' : null);
  const tooltip = inferred
    ? `Likely Mimic — agent v${agentVersion} matches the Mimic bundle but the client tag wasn't stamped. Update to the latest beta for an explicit tag.`
    : (appVersion ? `${resolved} v${appVersion}` : resolved);
  return (
    <span className={`inline-block ml-1.5 align-middle text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border ${cls}`} title={tooltip}>
      {label}{suffix ? <span className="ml-1 opacity-70 normal-case tracking-normal">{suffix}</span> : null}
    </span>
  );
}
