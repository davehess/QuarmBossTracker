// Officer tool: link characters.discord_id to wolfpack_members.discord_id.
//
// The bot's PvP "deaths" view (and any future owner-only view) needs to know
// which Discord user owns each character. Zero characters were linked at the
// time this page was built — auto-population via the OpenDKP sync only gets
// us as far as the OpenDKP `discord` field, which most members leave blank.
//
// We infer ownership from wolfpack_members.nickname / global_name, which
// many members already use to list their roster (e.g. "Abrahms/Canniball/
// Fischer", "Ang/Ness/Hass/Catt/Shuttle", "Antero | Person | HotG"). Two
// passes:
//   1) Direct token match — character name appears as a /, |, comma, hyphen,
//      or space-separated token of nickname or global_name.
//   2) Main-name fallback — character is an alt whose main_name matches.
//
// In our roster this resolves 98 of 113 unlinked active characters
// unambiguously. The remaining 15 (alts of mains not in Discord, etc.) get
// a manual dropdown so officers can pick.

import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { supabaseServer } from '@/lib/supabase-server';
import OpenDkpRegisterRow from './OpenDkpRegisterRow';
import UnregisteredTable from './UnregisteredTable';

export const dynamic = 'force-dynamic';

type Character = {
  guild_id: string;
  name: string;
  main_name: string | null;
  main_name_override: string | null;
  class: string | null;
  rank: string | null;
  active: boolean;
  discord_id: string | null;
  link_ignored: boolean;
  opendkp_id: number | null;
};

type Member = {
  discord_id: string;
  nickname: string | null;
  global_name: string | null;
};

// Split a string on /, |, comma, dash, or whitespace. Strip <guild> tags and
// parenthetical asides first so "<TSS>Grizzox/Drmagic" and "Ally Rose (rosali143)"
// don't pollute the token set.
function tokenize(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const cleaned = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ');
  return cleaned
    .split(/[\/|,\-\s]+/)
    .map(s => s.trim().toLowerCase())
    .filter(t => t.length >= 3);
}

type TokenIndex = Map<string, string[]>; // token → discord_ids that contain it

function buildTokenIndex(members: Member[]): TokenIndex {
  const ix: TokenIndex = new Map();
  for (const m of members) {
    const tokens = new Set([...tokenize(m.nickname), ...tokenize(m.global_name)]);
    for (const t of tokens) {
      const list = ix.get(t) ?? [];
      if (!list.includes(m.discord_id)) list.push(m.discord_id);
      ix.set(t, list);
    }
  }
  return ix;
}

type Suggestion = {
  source: 'self' | 'main' | 'none' | 'ambiguous';
  discord_id: string | null;
  candidates: string[];
};

function suggestFor(c: Character, ix: TokenIndex): Suggestion {
  const direct = ix.get(c.name.toLowerCase());
  if (direct && direct.length === 1) return { source: 'self', discord_id: direct[0], candidates: direct };
  if (direct && direct.length > 1)   return { source: 'ambiguous', discord_id: null, candidates: direct };
  if (c.main_name) {
    const viaMain = ix.get(c.main_name.toLowerCase());
    if (viaMain && viaMain.length === 1) return { source: 'main', discord_id: viaMain[0], candidates: viaMain };
    if (viaMain && viaMain.length > 1)   return { source: 'ambiguous', discord_id: null, candidates: viaMain };
  }
  return { source: 'none', discord_id: null, candidates: [] };
}

function memberLabel(m: Member): string {
  const a = m.nickname?.trim();
  const b = m.global_name?.trim();
  if (a && b && a !== b) return `${a} (${b})`;
  return a || b || m.discord_id;
}

// Guild-rank ordering for picking a cluster's real main. Higher = more likely
// to be the person's actual main character.
const RANK_WEIGHT: Record<string, number> = {
  'officer': 5, 'raid pack': 4, 'raid alt': 3, 'non-raid alt': 2, 'trader': 1,
};
function rankWeight(r: string | null | undefined): number {
  return RANK_WEIGHT[(r || '').toLowerCase().trim()] ?? 0;
}
function isSelfPinChar(c: Character): boolean {
  const ovr = c.main_name_override?.toLowerCase();
  if (!ovr) return false;
  return ovr === c.name.toLowerCase() || ovr === (c.main_name || c.name).toLowerCase();
}

// Pick the member's REAL main from a same-uploader cluster. The old default
// (alphabetically-first "home" family) picked "Bonebro" for Hitya's cluster
// purely because B < C < H — it carries the discord_id but isn't the main.
// Prefer, in order: the home family whose name IS the member's Discord
// identity (nickname / global_name), then the highest guild rank, then a
// self-pinned main (an officer already declared it a main), then alpha.
// Falls back to '' when the cluster has no home family at all.
function defaultMainFor(
  fams: { main: Character; isHome: boolean }[],
  member: Member | undefined,
): string {
  const home = fams.filter(f => f.isHome);
  const pool = home.length ? home : fams;
  if (!pool.length) return '';
  const idTokens = new Set([...tokenize(member?.nickname), ...tokenize(member?.global_name)]);
  const byIdentity = pool.find(f => idTokens.has(f.main.name.toLowerCase()));
  if (byIdentity) return byIdentity.main.name;
  const ranked = [...pool].sort((a, b) =>
    (rankWeight(b.main.rank) - rankWeight(a.main.rank))
    || (Number(isSelfPinChar(b.main)) - Number(isSelfPinChar(a.main)))
    || a.main.name.localeCompare(b.main.name));
  return ranked[0].main.name;
}

async function actionAssertOfficer() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return false;
  return await isOfficer(user.id);
}

// ── Server actions ────────────────────────────────────────────────────────

async function setLink(formData: FormData) {
  'use server';
  const ok = await actionAssertOfficer();
  if (!ok) redirect('/?error=admin_required');
  const name = String(formData.get('name') || '').trim();
  const discordId = String(formData.get('discord_id') || '').trim();
  if (!name) return;
  const admin = supabaseAdmin();
  if (!discordId) {
    await admin.from('characters').update({ discord_id: null }).eq('guild_id', 'wolfpack').eq('name', name);
  } else {
    await admin.from('characters').update({ discord_id: discordId }).eq('guild_id', 'wolfpack').eq('name', name);
  }
  revalidatePath('/admin/links');
}

// Dismiss an erroneous character from the matching workflow (or restore it).
// `ignored=1` parks it in the Ignored view and removes it from review +
// auto-matching; `ignored=0` brings it back. Leaves discord_id untouched.
async function setLinkIgnored(formData: FormData) {
  'use server';
  const ok = await actionAssertOfficer();
  if (!ok) redirect('/?error=admin_required');
  const name = String(formData.get('name') || '').trim();
  const ignored = String(formData.get('ignored') || '') === '1';
  if (!name) return;
  await supabaseAdmin()
    .from('characters')
    .update({ link_ignored: ignored })
    .eq('guild_id', 'wolfpack')
    .eq('name', name);
  revalidatePath('/admin/links');
}

async function applyAllAutoMatches() {
  'use server';
  const ok = await actionAssertOfficer();
  if (!ok) redirect('/?error=admin_required');
  const admin = supabaseAdmin();
  const [{ data: chars }, { data: members }] = await Promise.all([
    admin.from('characters').select('guild_id, name, main_name, main_name_override, class, rank, active, discord_id, link_ignored, opendkp_id').eq('guild_id', 'wolfpack'),
    admin.from('wolfpack_members').select('discord_id, nickname, global_name').eq('is_member', true),
  ]);
  const ix = buildTokenIndex((members ?? []) as Member[]);
  const updates: { name: string; discord_id: string }[] = [];
  for (const c of (chars ?? []) as Character[]) {
    if (c.discord_id || c.link_ignored) continue;
    const s = suggestFor(c, ix);
    if (s.discord_id && (s.source === 'self' || s.source === 'main')) {
      updates.push({ name: c.name, discord_id: s.discord_id });
    }
  }
  // No batch upsert helper — issue parallel updates (small set, 100ish).
  await Promise.all(updates.map(u =>
    admin.from('characters').update({ discord_id: u.discord_id }).eq('guild_id', 'wolfpack').eq('name', u.name)
  ));
  revalidatePath('/admin/links');
}

// ── Family links (main/alt overrides) ───────────────────────────────────────

// Set (or clear) an officer family-link override. Writes BOTH columns:
// main_name_override is the durable intent the OpenDKP sync respects;
// main_name makes the fix take effect immediately everywhere that folds
// families today. Re-points the character's existing alts too, so a whole
// mis-rooted family moves in one action. Clearing the override leaves
// main_name as-is — the next OpenDKP sync restores OpenDKP's view.
async function setFamilyLink(formData: FormData) {
  'use server';
  const ok = await actionAssertOfficer();
  if (!ok) redirect('/?error=admin_required');
  const name = String(formData.get('name') || '').trim();
  const main = String(formData.get('main') || '').trim();
  if (!name || !/^[A-Za-z]{2,}$/.test(name)) return;
  const admin = supabaseAdmin();

  if (!main) {
    await admin.from('characters')
      .update({ main_name_override: null })
      .eq('guild_id', 'wolfpack')
      .ilike('name', name);
    revalidatePath('/admin/links');
    return;
  }
  if (!/^[A-Za-z]{2,}$/.test(main) || main.toLowerCase() === name.toLowerCase()) return;

  // Resolve canonical casing + guard against linking under a non-existent or
  // cyclic target (target must not itself resolve back to `name`).
  const { data: targetRows } = await admin
    .from('characters')
    .select('name, main_name')
    .eq('guild_id', 'wolfpack')
    .ilike('name', main)
    .limit(1);
  const target = (targetRows ?? [])[0] as { name: string; main_name: string | null } | undefined;
  if (!target) return;
  if ((target.main_name || target.name).toLowerCase() === name.toLowerCase()) return;

  // The character itself + anything currently rooted at it (its alts).
  await admin.from('characters')
    .update({ main_name_override: target.name, main_name: target.name })
    .eq('guild_id', 'wolfpack')
    .neq('name', target.name)
    .or(`name.ilike.${name},main_name.ilike.${name}`);
  revalidatePath('/admin/links');
  revalidatePath('/admin/agents');
}

// Shared link primitive used by the bulk action — re-points `name` (and its
// existing alts) under `mainName`, writing both columns like setFamilyLink.
// Guards against a non-existent target and a cycle (target resolving back to
// name). No-op on a bad/self name so a bulk run can't corrupt on one row.
async function _linkOneUnder(
  admin: ReturnType<typeof supabaseAdmin>,
  name: string,
  mainName: string,
): Promise<void> {
  if (!/^[A-Za-z]{2,}$/.test(name) || !/^[A-Za-z]{2,}$/.test(mainName)) return;
  if (name.toLowerCase() === mainName.toLowerCase()) return;
  const { data: targetRows } = await admin
    .from('characters')
    .select('name, main_name')
    .eq('guild_id', 'wolfpack')
    .ilike('name', mainName)
    .limit(1);
  const target = (targetRows ?? [])[0] as { name: string; main_name: string | null } | undefined;
  if (!target) return;
  if ((target.main_name || target.name).toLowerCase() === name.toLowerCase()) return;   // cycle guard
  await admin.from('characters')
    .update({ main_name_override: target.name, main_name: target.name })
    .eq('guild_id', 'wolfpack')
    .neq('name', target.name)
    .or(`name.ilike.${name},main_name.ilike.${name}`);
}

// Bulk "confirm these are all one family" — folds every family root the
// officer selected under a single main in one action (Uilnayar 2026-07-05:
// "needs a way to confirm these are all part of the same family/main").
// `names` is a comma-joined list of the cluster's HOME family roots (the ones
// that carry this Discord account); the chosen main is skipped. Deliberately
// scoped to home families so a cluster member who's actually someone else's
// toon (a different discord_id) is NEVER swept in — those stay per-row.
async function setFamilyLinkBulk(formData: FormData) {
  'use server';
  const ok = await actionAssertOfficer();
  if (!ok) redirect('/?error=admin_required');
  const main = String(formData.get('main') || '').trim();
  if (!main || !/^[A-Za-z]{2,}$/.test(main)) return;
  const names = String(formData.get('names') || '')
    .split(',')
    .map(s => s.trim())
    .filter(n => /^[A-Za-z]{2,}$/.test(n) && n.toLowerCase() !== main.toLowerCase());
  if (names.length === 0) return;
  const admin = supabaseAdmin();
  for (const n of names) { await _linkOneUnder(admin, n, main); }
  revalidatePath('/admin/links');
  revalidatePath('/admin/agents');
}

// "Remove linkage" — declare a character a standalone main, NOT an alt of
// anyone (Uilnayar 2026-06-22: "Luter is his own person"). Sets main_name =
// name and main_name_override = name (self-pin) so the character (a) stops
// rendering as someone else's alt immediately and (b) survives the next
// OpenDKP sync re-parenting them. The self-pin is deliberate here — unlike
// the auto-linker's no-op pins, this one encodes an officer decision, so the
// "clean up self-pinned overrides" button intentionally won't be run blindly
// against it (it's a manual action). Also clears any alts currently rooted at
// this character? No — removing linkage only affects THIS character's own
// parentage; its own alts (if any) stay put.
async function makeOwnMain(formData: FormData) {
  'use server';
  const ok = await actionAssertOfficer();
  if (!ok) redirect('/?error=admin_required');
  const name = String(formData.get('name') || '').trim();
  if (!name || !/^[A-Za-z]{2,}$/.test(name)) return;
  await supabaseAdmin()
    .from('characters')
    .update({ main_name: name, main_name_override: name })
    .eq('guild_id', 'wolfpack')
    .ilike('name', name);
  revalidatePath('/admin/links');
  revalidatePath('/admin/agents');
}

// One-click cleanup: clear every main_name_override row where the override
// just pins the character to themselves (override == name) or to its
// existing main_name (no actual re-parent). These are "self-pinned" no-ops
// that the auto-linker stamps to keep the OpenDKP sync from re-parenting a
// row — they're harmless but clutter the page with "override" badges that
// look like contradictions next to HOME-marked characters. Wholesale clear
// is safe: the sync's natural state would land in the same place, and any
// MEANINGFUL override (one that points to a name other than the current
// main) is preserved.
async function clearSelfPinnedOverrides() {
  'use server';
  const ok = await actionAssertOfficer();
  if (!ok) redirect('/?error=admin_required');
  const admin = supabaseAdmin();
  // PostgREST can't express a per-row column-vs-column predicate cleanly via
  // .or(); do it in one RPC-ish round trip by selecting candidates then
  // patching them by name. The set is bounded (≤ characters table size,
  // typically a few hundred) so this is cheap.
  const { data: rows } = await admin
    .from('characters')
    .select('name, main_name, main_name_override')
    .eq('guild_id', 'wolfpack')
    .not('main_name_override', 'is', null);
  const selfPinned = ((rows ?? []) as { name: string; main_name: string | null; main_name_override: string }[])
    .filter(r => {
      const ovr = r.main_name_override.toLowerCase();
      return ovr === r.name.toLowerCase()
          || (r.main_name && ovr === r.main_name.toLowerCase());
    })
    .map(r => r.name);
  if (selfPinned.length > 0) {
    await admin.from('characters')
      .update({ main_name_override: null })
      .eq('guild_id', 'wolfpack')
      .in('name', selfPinned);
  }
  revalidatePath('/admin/links');
  revalidatePath('/admin/agents');
}

// ── Family-link requests (from Mimic UI-Studio uploads of unlinked toons) ───

type LinkRequest = {
  id: string;
  character_name: string;
  requester_discord_id: string;
  requester_name: string | null;
  source: string;
  created_at: string;
};

// Resolve the Discord user's main: a character they own (discord_id = them)
// that is its own main (main_name null or == name). Null if they have no
// linked characters yet — the toon then becomes its own main.
async function resolveMainName(admin: ReturnType<typeof supabaseAdmin>, discordId: string): Promise<string | null> {
  const { data } = await admin
    .from('characters')
    .select('name, main_name')
    .eq('guild_id', 'wolfpack')
    .eq('discord_id', discordId);
  const rows = (data ?? []) as { name: string; main_name: string | null }[];
  const main = rows.find(c => !c.main_name || c.main_name.toLowerCase() === c.name.toLowerCase());
  return main ? main.name : null;
}

// Approve: link the toon into the requester's family (discord_id + main_name),
// merge in the held UI backups (clear pending_link), and resolve the request.
async function approveLinkRequest(formData: FormData) {
  'use server';
  const ok = await actionAssertOfficer();
  if (!ok) redirect('/?error=admin_required');
  const id = String(formData.get('id') || '').trim();
  if (!id) return;
  const admin = supabaseAdmin();

  const { data: reqRows } = await admin
    .from('character_link_requests')
    .select('id, character_name, requester_discord_id, status')
    .eq('id', id).limit(1);
  const req = (reqRows ?? [])[0] as { character_name: string; requester_discord_id: string; status: string } | undefined;
  if (!req || req.status !== 'pending') { revalidatePath('/admin/links'); return; }

  const mainName = await resolveMainName(admin, req.requester_discord_id);

  // Link the toon. Update if a characters row exists; insert otherwise — so we
  // never clobber an existing row's class/rank by upserting a partial object.
  const { data: existing } = await admin
    .from('characters')
    .select('name')
    .eq('guild_id', 'wolfpack')
    .ilike('name', req.character_name)
    .limit(1);
  if (Array.isArray(existing) && existing.length > 0) {
    await admin.from('characters')
      .update({ discord_id: req.requester_discord_id, main_name: mainName, active: true })
      .eq('guild_id', 'wolfpack')
      .ilike('name', req.character_name);
  } else {
    await admin.from('characters').insert({
      guild_id: 'wolfpack',
      name: req.character_name,
      discord_id: req.requester_discord_id,
      main_name: mainName,
      active: true,
    });
  }

  // Stamp the override too — without it the next OpenDKP sync resets
  // main_name to ParentId resolution (self for un-parented toons) and the
  // approved family link silently unwinds.
  if (mainName) {
    await admin.from('characters')
      .update({ main_name_override: mainName })
      .eq('guild_id', 'wolfpack')
      .ilike('name', req.character_name);
  }

  // Merge in the held backups — clear the pending flag so they're restorable.
  await admin.from('ui_snapshots')
    .update({ pending_link: false })
    .eq('owner_discord_id', req.requester_discord_id)
    .ilike('character_name', req.character_name);

  const { data: { user } } = await supabaseServer().auth.getUser();
  await admin.from('character_link_requests')
    .update({ status: 'approved', resolved_by_discord_id: user?.id ?? null, resolved_at: new Date().toISOString() })
    .eq('id', id);
  revalidatePath('/admin/links');
}

async function dismissLinkRequest(formData: FormData) {
  'use server';
  const ok = await actionAssertOfficer();
  if (!ok) redirect('/?error=admin_required');
  const id = String(formData.get('id') || '').trim();
  if (!id) return;
  const { data: { user } } = await supabaseServer().auth.getUser();
  await supabaseAdmin()
    .from('character_link_requests')
    .update({ status: 'dismissed', resolved_by_discord_id: user?.id ?? null, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending');
  revalidatePath('/admin/links');
}

// ── Page ──────────────────────────────────────────────────────────────────

export default async function AdminLinksPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { show } = await searchParams;
  const showInactive = show === 'inactive' || show === 'all';
  const showLinked   = show === 'linked'   || show === 'all';
  const showIgnored  = show === 'ignored'  || show === 'all';

  const admin = supabaseAdmin();
  const [{ data: chars }, { data: members }, { data: reqs }, { data: uploads }, { data: whoRows }, { data: registerReqs }] = await Promise.all([
    admin
      .from('characters')
      .select('guild_id, name, main_name, main_name_override, class, rank, active, discord_id, link_ignored, opendkp_id')
      .eq('guild_id', 'wolfpack')
      .order('active', { ascending: false })
      .order('name'),
    admin
      .from('wolfpack_members')
      .select('discord_id, nickname, global_name')
      .eq('is_member', true)
      .order('nickname'),
    admin
      .from('character_link_requests')
      .select('id, character_name, requester_discord_id, requester_name, source, created_at')
      .eq('guild_id', 'wolfpack')
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
    admin
      .from('agent_upload_stats')
      .select('character, uploaded_by_discord_id, last_uploaded_at')
      .not('uploaded_by_discord_id', 'is', null)
      .not('character', 'is', null)
      .limit(3000),
    admin
      .from('who_observations')
      .select('character, level, class, observed_at')
      .eq('guild_id', 'wolfpack')
      .order('observed_at', { ascending: false })
      .limit(3000),
    admin
      .from('opendkp_register_requests')
      .select('id, name, status, error, requested_by_discord_id, opendkp_id, created_at, processed_at')
      .eq('guild_id', 'wolfpack')
      .order('created_at', { ascending: false })
      .limit(100),
  ]);
  const pendingRequests = (reqs ?? []) as LinkRequest[];

  const allChars = (chars ?? []) as Character[];
  const memberList = (members ?? []) as Member[];
  const ix = buildTokenIndex(memberList);
  const memberById = new Map(memberList.map(m => [m.discord_id, m] as const));

  // ── Same-uploader family candidates ──────────────────────────────────────
  // One Mimic install = one per-user Discord token across every watched log.
  // When that token's uploads span MULTIPLE rostered families, it's almost
  // always one human whose alts were never parented in OpenDKP (rank "Raid
  // Alt", ParentId 0). Surface those groups for one-click linking. The
  // exception — someone regularly running a friend's toon — is exactly why
  // this is an officer review list and not an auto-merge.
  const charByLower = new Map(allChars.map(c => [c.name.toLowerCase(), c] as const));
  const effectiveMain = (n: string): Character | null => {
    const c = charByLower.get(n.toLowerCase());
    if (!c) return null;
    const main = (c.main_name && c.main_name.trim()) || c.name;
    return charByLower.get(main.toLowerCase()) ?? c;
  };
  type FamGroup = { did: string; families: { main: Character; uploaders: string[]; isHome: boolean }[] };
  const byToken = new Map<string, Map<string, Set<string>>>(); // did → mainLower → uploading chars
  for (const u of (uploads ?? []) as { character: string | null; uploaded_by_discord_id: string | null }[]) {
    if (!u.character || !u.uploaded_by_discord_id) continue;
    const main = effectiveMain(u.character);
    if (!main) continue;          // un-rostered — /admin/agents already folds these by token
    let fams = byToken.get(u.uploaded_by_discord_id);
    if (!fams) { fams = new Map(); byToken.set(u.uploaded_by_discord_id, fams); }
    let set = fams.get(main.name.toLowerCase());
    if (!set) { set = new Set(); fams.set(main.name.toLowerCase(), set); }
    set.add(u.character);
  }
  const familyGroups: FamGroup[] = [];
  for (const [did, fams] of byToken) {
    if (fams.size < 2) continue;
    const families = [...fams.entries()].map(([mainLower, ups]) => {
      const main = charByLower.get(mainLower)!;
      // "Home" = the family that actually owns this Discord account (any
      // member of the family carries the link). The other families are the
      // candidates to fold under it.
      const isHome = allChars.some(c =>
        c.discord_id === did
        && (((c.main_name && c.main_name.trim()) || c.name).toLowerCase() === mainLower));
      return { main, uploaders: [...ups].sort(), isHome };
    }).sort((a, b) => Number(b.isHome) - Number(a.isHome) || a.main.name.localeCompare(b.main.name));
    // Drop families that don't need an officer decision:
    //   • Non-home families an officer marked "Not an alt" (override === self)
    //     — they've been reviewed, the row in the cluster was spurious.
    //   • Raid Packs — anyone Raid Pack is a main and doesn't need linking
    //     anywhere (Uilnayar 2026-06-23). Hiding them keeps the cluster
    //     focused on the actual decisions: Raid Alts that should be folded
    //     under a Raid Pack root.
    // Home stays so the cluster still anchors visually. If fewer than 2
    // families remain, the cluster drops entirely (nothing left to link).
    const visible = families.filter(f => {
      if (f.isHome) return true;
      if ((f.main.rank || '').toLowerCase().trim() === 'raid pack') return false;
      if (f.main.main_name_override
          && f.main.main_name_override.toLowerCase() === f.main.name.toLowerCase()) return false;
      return true;
    });
    if (visible.length < 2) continue;
    familyGroups.push({ did, families: visible });
  }
  familyGroups.sort((a, b) => b.families.length - a.families.length);

  // Count self-pinned overrides across the whole roster — drives the
  // "Clean up N self-pinned overrides" button in the section header. These
  // are rows where main_name_override is set but only confirms the
  // existing main_name (no actual re-parent). They're harmless but make
  // the page noisy by painting an "override" badge on every HOME row.
  const selfPinnedCount = (allChars as Character[]).reduce((acc, c) => {
    if (!c.main_name_override) return acc;
    const ovr = c.main_name_override.toLowerCase();
    const cur = (c.main_name || c.name).toLowerCase();
    const isSelfPin = ovr === c.name.toLowerCase() || ovr === cur;
    return acc + (isSelfPin ? 1 : 0);
  }, 0);

  // Roster-wide list of mains for the "link as alt of" autocomplete on
  // every same-uploader row. A "main" = a character whose name equals
  // (main_name || name) — i.e. the family root. Pre-fix the row's
  // dropdown only listed OTHER families IN THE SAME CLUSTER, which
  // wasn't enough when a character (Luter, Borowhay, Bardtholemu)
  // showed up in three different officers' clusters because their own
  // Mimic isn't authenticated and several multi-boxers tail their log.
  // Officers need to be able to link that row to a main OUTSIDE the
  // current cluster — Bardtholemu to themselves (he IS a main),
  // Luter to whichever real owner he is. Uilnayar 2026-06-21.
  const allMains = [...new Set(
    allChars
      .map(c => ((c.main_name && c.main_name.trim()) || c.name).trim())
      .filter(n => n.length > 0)
  )].sort((a, b) => a.localeCompare(b));

  // ── Unregistered characters ────────────────────────────────────────────────
  // Characters streaming from a member's Mimic (their log files are registered
  // on that machine, so the per-user token names the owner) that have NO row
  // in the OpenDKP mirror at all. Surface them with the owner + observed
  // level/class and a ready-to-paste /register command. Rank rule: Raid Alts
  // require level 46+; anything below is a Non-raid Alt or Trader.
  type UnregRow = {
    name: string;
    did: string;
    level: number | null;
    cls: string | null;
    lastUpload: string | null;
    // Resolved family root for the uploader — pre-fills ParentId on the
    // OpenDKP create so the new character lands as one of their alts
    // instead of becoming an un-parented self-rooted main. Falls back to
    // null when we can't resolve a family root for this discord_id
    // (Mimic uploading on behalf of an officer's box for a non-member).
    parentName: string | null;
    parentOpenDkpId: number | null;
  };
  const whoByName = new Map<string, { level: number | null; cls: string | null }>();
  for (const w of (whoRows ?? []) as { character: string; level: number | null; class: string | null }[]) {
    const k = (w.character || '').toLowerCase();
    if (k && !whoByName.has(k)) whoByName.set(k, { level: w.level ?? null, cls: w.class ?? null });
  }

  // Per-uploader family-root resolution: for each Discord ID that uploads
  // unregistered characters, find which OpenDKP family (= main_name cluster)
  // their existing characters live under, and pick the most-populous one
  // as the parent. Hitya's box uploads Hitya/Bonebro/Canopy + a handful of
  // alts — OpenDKP has the whole family rooted at Canopy, so Canopy wins
  // and new alts land under it. Multi-main accounts pick the largest
  // cluster; officer can re-parent via the family-link section after the
  // fact if it's wrong.
  const parentByDid = new Map<string, { name: string; opendkpId: number | null }>();
  {
    type MainCounts = Map<string, number>;          // lower(main) → char count
    const countsByDid = new Map<string, MainCounts>();
    for (const c of allChars) {
      if (!c.discord_id) continue;
      const main = ((c.main_name && c.main_name.trim()) || c.name).toLowerCase();
      let mc = countsByDid.get(c.discord_id);
      if (!mc) { mc = new Map(); countsByDid.set(c.discord_id, mc); }
      mc.set(main, (mc.get(main) || 0) + 1);
    }
    for (const [did, mc] of countsByDid) {
      let best: { lower: string; n: number } | null = null;
      for (const [lower, n] of mc) {
        if (!best || n > best.n) best = { lower, n };
      }
      if (!best) continue;
      const mainChar = charByLower.get(best.lower);
      if (!mainChar) continue;
      parentByDid.set(did, {
        name:      mainChar.name,
        opendkpId: mainChar.opendkp_id ?? null,
      });
    }
  }

  const unregistered: UnregRow[] = [];
  {
    const seenU = new Set<string>();
    for (const u of (uploads ?? []) as { character: string | null; uploaded_by_discord_id: string | null; last_uploaded_at: string | null }[]) {
      const name = (u.character || '').trim();
      if (!name || !u.uploaded_by_discord_id) continue;
      if (!/^[A-Za-z]{3,20}$/.test(name)) continue;          // operator streams / junk
      const k = name.toLowerCase();
      if (seenU.has(k) || charByLower.has(k)) continue;       // already in the mirror
      seenU.add(k);
      const who    = whoByName.get(k);
      const parent = parentByDid.get(u.uploaded_by_discord_id);
      unregistered.push({
        name,
        did: u.uploaded_by_discord_id,
        level: who?.level ?? null,
        cls: who?.cls ?? null,
        lastUpload: u.last_uploaded_at ?? null,
        parentName:      parent?.name      ?? null,
        parentOpenDkpId: parent?.opendkpId ?? null,
      });
    }
    unregistered.sort((a, b) => String(b.lastUpload || '').localeCompare(String(a.lastUpload || '')));
  }

  // Targeted /who level fill — the recency-windowed whoRows above misses
  // characters last /who'd outside the most-recent 3000 observations, which
  // is exactly the long-tail alt case (Uilmuley/Sanamar showed "?"). For
  // every unregistered name still missing a level, look it up directly by
  // name across ALL of who_observations (bounded to the candidate set) and
  // keep the highest level + most recent class seen — including the owner's
  // own /who when their Mimic captured it (Uilnayar 2026-06-22).
  {
    const needLevel = unregistered.filter(u => u.level == null).map(u => u.name);
    if (needLevel.length > 0) {
      const { data: targetedWho } = await admin
        .from('who_observations')
        .select('character, level, class, observed_at')
        .eq('guild_id', 'wolfpack')
        .in('character', needLevel)
        .order('observed_at', { ascending: false })
        .limit(5000);
      const best = new Map<string, { level: number | null; cls: string | null }>();
      for (const w of (targetedWho ?? []) as { character: string; level: number | null; class: string | null }[]) {
        const k = (w.character || '').toLowerCase();
        const cur = best.get(k);
        const lvl = (w.level != null && (cur?.level == null || w.level > cur.level)) ? w.level : (cur?.level ?? null);
        const cls = cur?.cls ?? (w.class ?? null);   // first (most recent) non-null class
        best.set(k, { level: lvl, cls });
      }
      for (const u of unregistered) {
        if (u.level != null) continue;
        const b = best.get(u.name.toLowerCase());
        if (b) { u.level = b.level; if (!u.cls) u.cls = b.cls; }
      }
    }
  }

  // Build the view rows for the sortable client table — resolve the owner's
  // display label + the suggested rank server-side so the client component
  // is purely presentational.
  const unregisteredView = unregistered.map(u => {
    const m = memberById.get(u.did);
    return {
      name:            u.name,
      ownerLabel:      m ? memberLabel(m) : u.did,
      did:             u.did,
      level:           u.level,
      cls:             u.cls,
      rank:            u.level == null ? '?' : (u.level >= 46 ? 'Raid Alt' : 'Non-raid Alt / Trader'),
      parentName:      u.parentName,
      parentOpenDkpId: u.parentOpenDkpId,
    };
  });

  // Recent OpenDKP register-queue rows — surface who requested each one and
  // whether the bot succeeded, so a failed/stuck registration is visible
  // (Uilnayar 2026-06-22 "whoever made the updates... should be shown").
  type RegisterReq = {
    id: string; name: string; status: string; error: string | null;
    requested_by_discord_id: string | null; opendkp_id: number | null;
    created_at: string; processed_at: string | null;
  };
  const registerQueue = ((registerReqs ?? []) as RegisterReq[]).map(r => ({
    ...r,
    requesterLabel: r.requested_by_discord_id
      ? (memberById.get(r.requested_by_discord_id) ? memberLabel(memberById.get(r.requested_by_discord_id)!) : r.requested_by_discord_id)
      : '—',
  }));
  const queuePendingOrFailed = registerQueue.filter(r => r.status !== 'done');

  // Dismissed (link_ignored) characters are parked in their own view and
  // excluded from every other list + the auto-match logic.
  const ignoredChars     = allChars.filter(c =>  c.link_ignored);
  const unlinkedActive   = allChars.filter(c =>  c.active && !c.discord_id && !c.link_ignored);
  const unlinkedInactive = allChars.filter(c => !c.active && !c.discord_id && !c.link_ignored);
  const linked           = allChars.filter(c =>  c.discord_id && !c.link_ignored);

  const rowsFor = (list: Character[]) =>
    list.map(c => ({ char: c, suggestion: suggestFor(c, ix) }));
  const activeRows   = rowsFor(unlinkedActive);
  const inactiveRows = rowsFor(unlinkedInactive);
  const ignoredRows  = rowsFor(ignoredChars);

  const counts = {
    total: allChars.length,
    unlinkedActive: unlinkedActive.length,
    unlinkedInactive: unlinkedInactive.length,
    linked: linked.length,
    ignored: ignoredChars.length,
    autoActive: activeRows.filter(r => r.suggestion.discord_id).length,
    autoInactive: inactiveRows.filter(r => r.suggestion.discord_id).length,
    manualActive: activeRows.filter(r => !r.suggestion.discord_id).length,
  };

  return (
    <div className="space-y-6">
      <div className="text-sm flex items-center gap-2">
        <Link href="/admin" className="text-blue hover:underline">← back to admin</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">🔗 Character → Discord links</h2>
        <p className="text-sm text-dim leading-6">
          Owner-only views (private death history on{' '}
          <Link href="/pvp" className="text-blue hover:underline">/pvp</Link>, future
          loot history, etc.) gate on <code>characters.discord_id</code>. We infer
          most matches by reading the character names members already list in
          their Discord nickname / display name; the rest need a manual pick.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
          <Stat label="Total characters" value={counts.total} />
          <Stat label="Linked"   value={counts.linked}   color="text-green" />
          <Stat label="Unlinked (active)"   value={counts.unlinkedActive}   color="text-orange" />
          <Stat label="Auto-matchable" value={counts.autoActive} color="text-blue" />
        </div>
      </section>

      {/* Family-link requests from Mimic UI-Studio uploads of unlinked toons */}
      <section className="bg-panel border border-border rounded-lg">
        <h3 className="text-sm text-orange px-4 py-3 border-b border-border">
          🧩 Family-link requests {pendingRequests.length > 0 && <span className="text-gold">({pendingRequests.length})</span>}
        </h3>
        {pendingRequests.length === 0 ? (
          <div className="p-4 text-xs text-dim leading-6">
            None pending. When a member backs up a toon in Mimic (UI Studio) that
            isn&apos;t linked to anyone, the backup is held and a request lands here.
            Approving adds the toon to that member&apos;s family and releases the
            held backup.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-dim hidden sm:table-header-group">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 font-normal">Toon</th>
                <th className="text-left px-3 py-2 font-normal">Requested by</th>
                <th className="text-left px-3 py-2 font-normal hidden md:table-cell">When</th>
                <th className="text-left px-3 py-2 font-normal">Action</th>
              </tr>
            </thead>
            <tbody>
              {pendingRequests.map(r => {
                const m = memberById.get(r.requester_discord_id);
                return (
                  <tr key={r.id} className="border-b border-border/40 hover:bg-[#1a212c]">
                    <td className="px-3 py-2 text-text font-medium">{r.character_name}</td>
                    <td className="px-3 py-2 text-dim">
                      {m ? memberLabel(m) : (r.requester_name || r.requester_discord_id)}
                      <span className="text-[10px] text-dim ml-2">· {r.source}</span>
                    </td>
                    <td className="px-3 py-2 text-dim hidden md:table-cell">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <form action={approveLinkRequest}>
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit" title="Add this toon to the member's family and release the held backup" className="px-2.5 py-1 rounded border border-green bg-[#1a7f3733] text-green text-xs hover:bg-[#1a7f3766]">
                            ✓ Approve
                          </button>
                        </form>
                        <form action={dismissLinkRequest}>
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit" title="Reject — the held backup stays unlinked" className="px-2.5 py-1 rounded border border-border text-dim text-xs hover:border-red hover:text-red">
                            Dismiss
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Same-uploader family candidates (main/alt overrides) */}
      <section className="bg-panel border border-border rounded-lg">
        <h3 className="text-sm text-orange px-4 py-3 border-b border-border flex flex-wrap items-center gap-3">
          <span>👥 Same uploader, separate families {familyGroups.length > 0 && <span className="text-gold">({familyGroups.length})</span>}</span>
          {selfPinnedCount > 0 && (
            <form action={clearSelfPinnedOverrides} className="ml-auto">
              <button
                type="submit"
                className="px-2 py-1 rounded border border-border bg-bg/40 text-text text-xs hover:border-orange hover:text-orange"
                title={`Clear ${selfPinnedCount} self-pinned override row${selfPinnedCount === 1 ? '' : 's'} — main_name_override is just pinning the character to themselves, so removing it changes nothing functionally. Cleans up the visual noise on this page.`}
              >
                🧹 Clean up {selfPinnedCount} self-pinned override{selfPinnedCount === 1 ? '' : 's'}
              </button>
            </form>
          )}
        </h3>
        <div className="p-4 text-xs text-dim leading-6 border-b border-border/40">
          Each row group is one Mimic install (one member&apos;s Discord token) whose uploads span
          multiple roster families — usually alts never parented in OpenDKP. Linking sets an
          officer override that <b>survives the OpenDKP sync</b> and re-points the whole family
          at once. Leave it alone if the member genuinely runs someone else&apos;s toon.
          {' '}
          <span className="text-dim">A <span className="px-1.5 py-0.5 rounded bg-red/20 border border-red/60 text-red text-[10px] uppercase">⚠ bad override</span> badge means an override is incorrectly re-parenting a character that&apos;s their own HOME — clear it from that row.</span>
        </div>
        {familyGroups.length === 0 ? (
          <div className="p-4 text-xs text-dim">No candidates — every uploader&apos;s characters fold into one family. 🎉</div>
        ) : (
          <div className="divide-y divide-border/40">
            {familyGroups.map(g => {
              const m = memberById.get(g.did);
              // Flat list of every character this Mimic install uploads,
              // across all the families below. This is what the user
              // expects to see at a glance — "what is this install
              // touching" — without scanning 3+ family sub-blocks. Sort
              // alphabetically; dedup by lower-case in case the same
              // character appears in two families (shouldn't, but cheap
              // safety).
              const allUploaders = [...new Set(
                g.families.flatMap(f => f.uploaders)
                  .filter(Boolean)
                  .map(n => n.trim())
              )].sort((a, b) => a.localeCompare(b));
              // The member's real main (identity → rank → self-pin → alpha),
              // and the home families a bulk "same family" confirm can fold.
              const homeFamilies = g.families.filter(f => f.isHome);
              const defMain = defaultMainFor(g.families, m);
              return (
                <div key={g.did} className="p-4">
                  <div className="text-sm text-text mb-2">
                    {m ? memberLabel(m) : <span className="text-dim">Discord {g.did}</span>}
                    <span className="text-dim text-xs ml-2">uploads {g.families.length} families · {allUploaders.length} character{allUploaders.length === 1 ? '' : 's'}</span>
                  </div>
                  {allUploaders.length > 0 && (
                    <div className="text-xs text-dim mb-3 flex flex-wrap gap-1">
                      <span className="text-text/80 mr-1">All uploaded:</span>
                      {allUploaders.map(name => (
                        <span key={name} className="px-1.5 py-0.5 rounded bg-bg/40 border border-border/60 text-text font-mono text-[10px]">
                          {name}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Bulk "these are all one person" confirm — folds every
                      home family (proven to carry THIS Discord account) under
                      one main in a single click, instead of clicking Link on
                      each of Bonebro / Canopy / … one at a time. Scoped to
                      home families only: a cluster member who's actually
                      someone else's toon (different discord_id) is never swept
                      in and stays a per-row decision below. */}
                  {homeFamilies.length >= 2 && (
                    <form action={setFamilyLinkBulk} className="mb-3 flex flex-wrap items-center gap-2 text-xs bg-bg/30 border border-green/40 rounded px-3 py-2">
                      <input type="hidden" name="names" value={homeFamilies.map(f => f.main.name).join(',')} />
                      <span className="text-text">✓ Confirm all {homeFamilies.length} as one family — main:</span>
                      <input
                        type="text"
                        name="main"
                        list={`mains-bulk-${g.did}`}
                        defaultValue={defMain}
                        placeholder="main..."
                        autoComplete="off"
                        spellCheck={false}
                        size={14}
                        className="bg-bg border border-border rounded px-2 py-1 text-xs"
                      />
                      <datalist id={`mains-bulk-${g.did}`}>
                        {allMains.map(n => <option key={n} value={n} />)}
                      </datalist>
                      <button type="submit" className="px-2 py-1 rounded border border-green bg-green/20 text-green text-xs hover:bg-green/30">Link all {homeFamilies.length} →</button>
                      <span className="text-dim">only the {homeFamilies.length} families uploaded by this account; others below stay per-row.</span>
                    </form>
                  )}
                  <div className="space-y-1.5">
                    {g.families.map(f => {
                      // "Self-pinned" no-op = main_name_override is set, but
                      // it just confirms the character is their own main —
                      // either the override equals the character's name OR
                      // it equals the existing main_name (the OpenDKP sync's
                      // natural choice). These overrides are NOT a problem;
                      // they were auto-stamped by the linker as a no-op
                      // "pin to default" so OpenDKP wouldn't re-parent the
                      // row. Showing them as "override" misled officers
                      // (Uilnayar 2026-06-21 — every HOME row was rendering
                      // with a gold "override" tag that looked like a
                      // contradiction). Now only flag the GENUINE case:
                      // override points to a name DIFFERENT from the
                      // current main, AND in the worst case the row is
                      // HOME but the override still re-parents it — a
                      // real conflict to draw eyes to.
                      const ovr   = f.main.main_name_override;
                      const cur   = f.main.main_name || f.main.name;
                      const isSelfPin = !!ovr && (
                        ovr.toLowerCase() === f.main.name.toLowerCase() ||
                        ovr.toLowerCase() === cur.toLowerCase()
                      );
                      const ovrConflict = !!ovr && !isSelfPin && f.isHome;
                      const ovrMoves    = !!ovr && !isSelfPin && !f.isHome;
                      // OpenDKP's view of who this character is parented
                      // under — surfaces "(Shavimo in OpenDKP)" next to
                      // Gnomistakes when OpenDKP has Gnomistakes rooted
                      // under Shavimo (Uilnayar 2026-06-23). main_name is
                      // set by the OpenDKP sync from ParentId, so if it
                      // differs from the row's own name AND we have the
                      // parent's OpenDKP id, link out to that character
                      // page. Skipped when the override is just self
                      // (effectively un-parented after officer cleanup).
                      const opendkpParentName = (f.main.main_name && f.main.main_name.toLowerCase() !== f.main.name.toLowerCase())
                        ? f.main.main_name : null;
                      const opendkpParentChar = opendkpParentName ? charByLower.get(opendkpParentName.toLowerCase()) : null;
                      const opendkpParentId   = opendkpParentChar?.opendkp_id ?? null;
                      return (
                      <div key={f.main.name} className="flex flex-col sm:flex-row sm:items-center gap-1.5 text-xs">
                        <div className="sm:w-64">
                          <span className="text-text font-medium">{f.main.name}</span>
                          {opendkpParentName && (
                            opendkpParentId ? (
                              <a
                                href={`https://wolfpack.opendkp.com/#/characters/${opendkpParentId}`}
                                target="_blank"
                                rel="noreferrer"
                                title={`OpenDKP has ${f.main.name} parented under ${opendkpParentName}. Click to open that character on OpenDKP.`}
                                className="ml-1.5 text-dim text-[10px] hover:text-blue hover:underline no-underline"
                              >
                                ({opendkpParentName} in OpenDKP ↗)
                              </a>
                            ) : (
                              <span className="ml-1.5 text-dim text-[10px]" title={`OpenDKP has ${f.main.name} parented under ${opendkpParentName} (no OpenDKP id captured for the parent yet).`}>
                                ({opendkpParentName} in OpenDKP)
                              </span>
                            )
                          )}
                          {/* HOME label removed 2026-06-21 (Uilnayar) — it
                              fired on every family whose root carried the
                              uploader's discord_id, which meant clusters
                              like Hitya's painted three identical green
                              HOME chips and the label conveyed no usable
                              signal. The cluster header already names the
                              uploader, so "this family is the uploader's"
                              is the implicit default. */}
                          {ovrConflict && <span className="ml-2 text-[10px] tracking-wide px-1.5 py-0.5 rounded bg-red/20 border border-red/60 text-red uppercase" title={`Officer override re-points this character to "${ovr}" — clear it from the row.`}>⚠ bad override → {ovr}</span>}
                          {ovrMoves    && <span className="ml-2 text-[10px] text-gold" title={`Officer override → ${ovr}`}>override → {ovr}</span>}
                          <div className="text-dim text-[10px]">
                            uploads: {f.uploaders.join(', ')}{f.main.rank ? ` · ${f.main.rank}` : ''}
                          </div>
                        </div>
                        {/* Link form now appears on every row, including the
                            former HOME ones — officers may want to re-parent
                            a family root to a different main (the Bonebro/
                            Canopy/Hitya case, where one Discord owns three
                            mains in the roster and you want to consolidate
                            them). The autocomplete spans every main on the
                            roster, not just the cluster's siblings. */}
                        {(
                          <form action={setFamilyLink} className="flex items-center gap-1.5">
                            <input type="hidden" name="name" value={f.main.name} />
                            <span className="text-dim">link as alt of</span>
                            <input
                              type="text"
                              name="main"
                              list={`mains-${f.main.name}`}
                              defaultValue={defMain}
                              placeholder="type any main..."
                              autoComplete="off"
                              spellCheck={false}
                              size={16}
                              className="bg-bg border border-border rounded px-2 py-1 text-xs"
                            />
                            <datalist id={`mains-${f.main.name}`}>
                              {allMains.filter(n => n.toLowerCase() !== f.main.name.toLowerCase()).map(n => (
                                <option key={n} value={n} />
                              ))}
                            </datalist>
                            <button type="submit" className="px-2 py-1 rounded border border-blue bg-[#1f6feb] text-white text-xs">Link</button>
                          </form>
                        )}
                        {f.main.main_name_override && (
                          <form action={setFamilyLink}>
                            <input type="hidden" name="name" value={f.main.name} />
                            <input type="hidden" name="main" value="" />
                            <button type="submit" title="Clear the officer override — the next OpenDKP sync restores OpenDKP's parentage" className="px-2 py-1 rounded border border-border text-dim text-xs hover:border-orange hover:text-orange">
                              Clear override
                            </button>
                          </form>
                        )}
                        {/* "Not an alt" — declare this character their own
                            standalone main so they stop showing as an alt
                            candidate under this uploader (Uilnayar 2026-06-22:
                            "Luter is his own person"). Pins main_name to self
                            so it sticks through the OpenDKP sync. */}
                        <form action={makeOwnMain}>
                          <input type="hidden" name="name" value={f.main.name} />
                          <button type="submit" title={`Mark ${f.main.name} as their own main — removes any alt linkage and stops them being suggested as an alt here.`} className="px-2 py-1 rounded border border-border text-dim text-xs hover:border-green hover:text-green">
                            Not an alt
                          </button>
                        </form>
                      </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {/* Manual one-off: link any character under any main */}
        <form action={setFamilyLink} className="p-4 border-t border-border/40 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-dim">Manual:</span>
          <input name="name" placeholder="Character" className="bg-bg border border-border rounded px-2 py-1 text-xs w-32" />
          <span className="text-dim">is an alt of</span>
          <input name="main" placeholder="Main" className="bg-bg border border-border rounded px-2 py-1 text-xs w-32" />
          <button type="submit" className="px-2 py-1 rounded border border-blue bg-[#1f6feb] text-white text-xs">Link</button>
          <span className="text-dim">(leave Main empty to clear an override)</span>
        </form>
      </section>

      {/* OpenDKP register queue — pending / failed rows so a stuck or errored
          registration is visible with who requested it. Done rows are hidden
          (the character drops off the "Not in OpenDKP" list once registered). */}
      {queuePendingOrFailed.length > 0 && (
        <section className="bg-panel border border-border rounded-lg">
          <h3 className="text-sm text-orange px-4 py-3 border-b border-border">
            ⏳ Registration queue <span className="text-gold">({queuePendingOrFailed.length})</span>
          </h3>
          <div className="p-4 text-xs text-dim leading-6 border-b border-border/40">
            OpenDKP registrations the bot is working through (drains every ~20s). A <span className="text-red">failed</span> row
            shows the error so you can fix the data and re-register. Successful ones drop off once OpenDKP confirms.
          </div>
          <table className="w-full text-xs">
            <thead className="text-dim hidden sm:table-header-group">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 font-normal">Character</th>
                <th className="text-left px-3 py-2 font-normal">Requested by</th>
                <th className="text-left px-3 py-2 font-normal">Status</th>
                <th className="text-left px-3 py-2 font-normal">When</th>
              </tr>
            </thead>
            <tbody>
              {queuePendingOrFailed.map(r => (
                <tr key={r.id} className="border-b border-border/40 hover:bg-[#1a212c]">
                  <td className="px-3 py-2 text-text font-medium">{r.name}</td>
                  <td className="px-3 py-2 text-dim">{r.requesterLabel}</td>
                  <td className="px-3 py-2">
                    {r.status === 'pending'
                      ? <span className="text-blue">⏳ pending</span>
                      : <span className="text-red" title={r.error || ''}>⚠ failed{r.error ? ` — ${r.error.slice(0, 80)}` : ''}</span>}
                  </td>
                  <td className="px-3 py-2 text-dim">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Unregistered characters — uploading via a member's Mimic but absent
          from OpenDKP entirely. Sortable; Register queues the bot job. */}
      <section className="bg-panel border border-border rounded-lg">
        <h3 className="text-sm text-orange px-4 py-3 border-b border-border">
          🆕 Not in OpenDKP {unregisteredView.length > 0 && <span className="text-gold">({unregisteredView.length})</span>}
        </h3>
        <div className="p-4 text-xs text-dim leading-6 border-b border-border/40">
          Characters streaming from a member&apos;s Mimic with no OpenDKP entry. The owner comes
          from the upload token; level/class from <code>/who</code> sightings (incl. the owner&apos;s own
          /who). Click a column header to sort. <b>Raid Alt requires level 46+</b>; below that they&apos;re a
          Non-raid Alt (or Trader). Register queues a bot job (processed in ~20s).
        </div>
        {unregisteredView.length === 0 ? (
          <div className="p-4 text-xs text-dim">Every uploading character is in OpenDKP. 🎉</div>
        ) : (
          <UnregisteredTable rows={unregisteredView} />
        )}
      </section>

      {/* View toggles */}
      <nav className="text-xs flex items-center gap-2 flex-wrap">
        <Toggle href="/admin/links" active={!showInactive && !showLinked && !showIgnored} label="Active unlinked only" />
        <Toggle href="/admin/links?show=inactive" active={showInactive && !showLinked && !showIgnored} label={`+ inactive (${counts.unlinkedInactive})`} />
        <Toggle href="/admin/links?show=linked"   active={!showInactive && showLinked && !showIgnored}  label={`+ already linked (${counts.linked})`} />
        <Toggle href="/admin/links?show=ignored"  active={!showInactive && !showLinked && showIgnored}  label={`dismissed (${counts.ignored})`} />
        <Toggle href="/admin/links?show=all"      active={showInactive && showLinked && showIgnored}   label="Show all" />
      </nav>

      {/* Bulk apply */}
      {counts.autoActive > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4 flex items-center gap-4">
          <div className="text-sm flex-1">
            <div className="text-blue">{counts.autoActive} active character{counts.autoActive === 1 ? '' : 's'} have an unambiguous auto-match.</div>
            <div className="text-dim text-xs mt-1">
              Self-matches first (character name appears as a token in someone's
              Discord nickname), then alt-via-main fallbacks. Includes inactive
              characters too if "+ inactive" is on.
            </div>
          </div>
          <form action={applyAllAutoMatches}>
            <button type="submit" className="px-4 py-2 rounded border border-blue bg-[#1f6feb] text-white text-sm">
              Apply all auto-matches
            </button>
          </form>
        </section>
      )}

      {activeRows.length === 0 ? (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          No active characters left to link. 🎉
        </section>
      ) : (
        <LinkTable
          title="Active characters — needs review"
          rows={activeRows}
          memberById={memberById}
          memberList={memberList}
        />
      )}

      {showInactive && inactiveRows.length > 0 && (
        <LinkTable
          title={`Inactive characters (${inactiveRows.length})`}
          rows={inactiveRows}
          memberById={memberById}
          memberList={memberList}
        />
      )}

      {showLinked && linked.length > 0 && (
        <LinkTable
          title={`Already linked (${linked.length}) — pick a different member or clear to undo`}
          rows={linked.map(c => ({ char: c, suggestion: suggestFor(c, ix) }))}
          memberById={memberById}
          memberList={memberList}
          alreadyLinked
        />
      )}

      {showIgnored && (
        ignoredRows.length > 0 ? (
          <LinkTable
            title={`Dismissed (${ignoredRows.length}) — erroneous matches, hidden from review + auto-matching`}
            rows={ignoredRows}
            memberById={memberById}
            memberList={memberList}
            ignored
          />
        ) : (
          <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
            Nothing dismissed. Use “Dismiss” on a row to park an erroneous character here.
          </section>
        )
      )}
    </div>
  );
}

function Stat({ label, value, color = 'text-text' }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-bg border border-border rounded p-3">
      <div className={`text-2xl ${color}`}>{value.toLocaleString()}</div>
      <div className="text-dim text-xs">{label}</div>
    </div>
  );
}

function Toggle({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={[
        'px-3 py-1 rounded border text-xs transition-colors no-underline',
        active ? 'border-blue bg-[#1f6feb33] text-blue' : 'border-border bg-bg text-text hover:border-blue',
      ].join(' ')}
    >
      {label}
    </Link>
  );
}

function LinkTable({
  title, rows, memberById, memberList, alreadyLinked = false, ignored = false,
}: {
  title: string;
  rows: { char: Character; suggestion: Suggestion }[];
  memberById: Map<string, Member>;
  memberList: Member[];
  alreadyLinked?: boolean;
  ignored?: boolean;
}) {
  return (
    <section className="bg-panel border border-border rounded-lg">
      <h3 className="text-sm text-orange px-4 py-3 border-b border-border">{title}</h3>
      <table className="w-full text-xs">
        <thead className="text-dim hidden sm:table-header-group">
          <tr className="border-b border-border">
            <th className="text-left px-2 sm:px-3 py-2 font-normal">Character</th>
            <th className="text-left px-2 sm:px-3 py-2 font-normal hidden md:table-cell">Main</th>
            <th className="text-left px-2 sm:px-3 py-2 font-normal hidden lg:table-cell">Class</th>
            <th className="text-left px-2 sm:px-3 py-2 font-normal">{ignored ? 'Was' : alreadyLinked ? 'Linked to' : 'Suggested'}</th>
            <th className="text-left px-2 sm:px-3 py-2 font-normal">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ char, suggestion }) => {
            const linkedMember = char.discord_id ? memberById.get(char.discord_id) : null;
            const suggestedMember = suggestion.discord_id ? memberById.get(suggestion.discord_id) : null;
            return (
              <tr key={char.name} className="border-b border-border/40 hover:bg-[#1a212c]">
                <td className="px-2 sm:px-3 py-2 text-text">
                  <div>{char.name}</div>
                  <div className="text-dim text-[10px] md:hidden">
                    {char.main_name && char.main_name !== char.name && <>alt of {char.main_name} · </>}
                    {char.class || '—'}
                  </div>
                </td>
                <td className="px-2 sm:px-3 py-2 text-dim hidden md:table-cell">
                  {char.main_name && char.main_name !== char.name ? char.main_name : '—'}
                </td>
                <td className="px-2 sm:px-3 py-2 text-dim hidden lg:table-cell">{char.class || '—'}</td>
                <td className="px-2 sm:px-3 py-2">
                  {linkedMember ? (
                    <span className="text-green">{memberLabel(linkedMember)}</span>
                  ) : suggestedMember ? (
                    <span className="text-blue">
                      {memberLabel(suggestedMember)}
                      <span className="text-dim text-[10px] ml-2">
                        {suggestion.source === 'self' ? 'self' : suggestion.source === 'main' ? `via main "${char.main_name}"` : ''}
                      </span>
                    </span>
                  ) : suggestion.source === 'ambiguous' ? (
                    <span className="text-orange">{suggestion.candidates.length} candidates — pick one →</span>
                  ) : (
                    <span className="text-dim italic">no suggestion</span>
                  )}
                </td>
                <td className="px-2 sm:px-3 py-2">
                  {ignored ? (
                    <form action={setLinkIgnored} className="flex items-center gap-1.5">
                      <input type="hidden" name="name" value={char.name} />
                      <input type="hidden" name="ignored" value="0" />
                      <button type="submit" className="px-2 py-1 rounded border border-blue text-blue text-xs hover:bg-[#1f6feb22]">
                        Restore
                      </button>
                    </form>
                  ) : (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5">
                      <form action={setLink} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5">
                        <input type="hidden" name="name" value={char.name} />
                        <select
                          name="discord_id"
                          defaultValue={char.discord_id ?? suggestion.discord_id ?? ''}
                          className="bg-bg border border-border rounded px-2 py-1 text-xs sm:min-w-[200px]"
                        >
                          <option value="">— unlinked —</option>
                          {memberList.map(m => (
                            <option key={m.discord_id} value={m.discord_id}>{memberLabel(m)}</option>
                          ))}
                        </select>
                        <button type="submit" className="px-2 py-1 rounded border border-blue bg-[#1f6feb] text-white text-xs">
                          Save
                        </button>
                      </form>
                      <form action={setLinkIgnored}>
                        <input type="hidden" name="name" value={char.name} />
                        <input type="hidden" name="ignored" value="1" />
                        <button
                          type="submit"
                          title="Erroneous — hide from review + auto-matching"
                          className="px-2 py-1 rounded border border-border text-dim text-xs hover:border-orange hover:text-orange"
                        >
                          Dismiss
                        </button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
