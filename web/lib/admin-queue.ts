// Officer admin review queue — server-side loaders for the
// AdminQueueBanner (counts only, every admin page) + the /admin/queue
// detail page (full lists). Each category surfaces a class of data the
// guild is missing OR a rendering gap the bot is hitting in production.
//
// Add a new category by:
//   1. defining a loader fn that returns { count, items }
//   2. exporting it from `categories`
//   3. (optional) adding a section to /admin/queue/page.tsx

import { supabaseAdmin } from '@/lib/supabase';
import { rankIndex } from '@/lib/eras';

const WINDOW = '14 days';

export type QueueItem = {
  key:        string;
  label:      string;
  detail?:    string;
  count?:     number;        // recent message count etc — sortable/display
  last?:      string | null; // ISO timestamp
  href?:      string;        // optional jump-to-fix link
  lines?:     string[];      // optional per-incident breakdown (rendered under the row)
};

export type QueueCategory = {
  id:           'unrostered_chat' | 'unenrichable_chat' | 'unregistered_opendkp' | 'awaiting_opendkp_claim' | 'missing_ticks' | 'chat_misattribution';
  icon:         string;
  title:        string;
  summary:      string;
  count:        number;
  items:        QueueItem[];
  fixHelpHref?: string;
};

// (1) Characters speaking in our guild/raid chat over the last 14 days who
// aren't in the OpenDKP character roster. These would miss DKP credit on
// every raid tick and won't show up on attendance pages. The single most
// impactful officer-action queue — every name here is a member whose
// participation we're under-counting.
async function loadUnrosteredChatSpeakers(): Promise<QueueCategory> {
  const sb = supabaseAdmin();
  // Pull the OpenDKP roster (small — a few hundred names) and the last
  // 14 days of chat aggregated by speaker. Diff in memory — Supabase
  // doesn't expose a NOT IN against a sub-select via PostgREST.
  //
  // ROSTER SOURCE: we used to read from opendkp_character_id_to_name —
  // which is EMPTY on the live database (the OpenDKP sync never populated
  // it), so the diff treated every chatter as missing and the queue
  // showed every active Wolf Pack member. Uilnayar 2026-06-21 ("I know
  // for a fact this is not true — Kazmodon/Statlander/Pyxil et al ARE
  // in OpenDKP"). The real "is this character in OpenDKP" signal lives
  // in opendkp_attendance_recent — every character who's been ticked
  // shows up there — backstopped by characters.opendkp_id (set by the
  // OpenDKP sync when a character gets parented in the roster).
  const [{ data: attendees }, { data: rosterChars }, { data: msgs }] = await Promise.all([
    sb.from('opendkp_attendance_recent').select('character_name'),
    sb.from('characters').select('name, opendkp_id').not('opendkp_id', 'is', null),
    sb.from('chat_messages')
      .select('speaker, ts')
      .in('channel', ['guild', 'raid'])
      .gt('ts', new Date(Date.now() - 14 * 86400000).toISOString())
      .limit(20000),
  ]);
  const rostered = new Set<string>();
  for (const r of (attendees ?? []) as { character_name: string | null }[]) {
    if (r.character_name) rostered.add(r.character_name.toLowerCase());
  }
  for (const r of (rosterChars ?? []) as { name: string | null; opendkp_id: number | null }[]) {
    if (r.name && r.opendkp_id != null) rostered.add(r.name.toLowerCase());
  }
  const bySpeaker = new Map<string, { count: number; last: string }>();
  for (const m of (msgs ?? []) as { speaker: string; ts: string }[]) {
    if (!m.speaker) continue;
    if (rostered.has(m.speaker.toLowerCase())) continue;
    const cur = bySpeaker.get(m.speaker);
    if (!cur) bySpeaker.set(m.speaker, { count: 1, last: m.ts });
    else {
      cur.count += 1;
      if (m.ts > cur.last) cur.last = m.ts;
    }
  }
  const items: QueueItem[] = [...bySpeaker.entries()]
    .map(([speaker, v]) => ({
      key:    speaker.toLowerCase(),
      label:  speaker,
      count:  v.count,
      last:   v.last,
      detail: `${v.count} message${v.count === 1 ? '' : 's'}`,
      href:   `/admin/members`,    // closest existing fix-it page
    }))
    .sort((a, b) => (b.last || '').localeCompare(a.last || ''));
  return {
    id:      'unrostered_chat',
    icon:    '🪪',
    title:   'Chat speakers missing from OpenDKP',
    summary: 'Characters chatting in /gu or /rs over the last 14 days who aren’t in the OpenDKP roster. They’re missing DKP credit and attendance.',
    count:   items.length,
    items,
    fixHelpHref: '/admin/members',
  };
}

// (2) Recent chat speakers we can't enrich with class/level because we have
// neither a `characters` row with a class set, nor a non-anonymous /who
// observation within the last 30 days. These render in chat as plain
// "Name: text" instead of "Name [60 Class]: text". Officers can fill class
// manually via /admin/who which writes who_overrides.
async function loadUnenrichableChatSpeakers(): Promise<QueueCategory> {
  const sb = supabaseAdmin();
  const sinceMs   = Date.now() - 14 * 86400000;
  const sinceWho  = new Date(Date.now() - 30 * 86400000).toISOString();
  const [{ data: msgs }, { data: chars }, { data: whoRows }] = await Promise.all([
    sb.from('chat_messages')
      .select('speaker, ts')
      .in('channel', ['guild', 'raid'])
      .gt('ts', new Date(sinceMs).toISOString())
      .limit(20000),
    sb.from('characters').select('name, class').eq('guild_id', 'wolfpack'),
    sb.from('who_observations')
      .select('character, class, anonymous')
      .gt('observed_at', sinceWho)
      .eq('anonymous', false)
      .not('class', 'is', null)
      .limit(20000),
  ]);

  // Two enrichment sources — both produce a "we know their class" signal.
  const classFromCharacters = new Set<string>();
  for (const c of (chars ?? []) as { name: string; class: string | null }[]) {
    if (c.name && c.class) classFromCharacters.add(c.name.toLowerCase());
  }
  const classFromWho = new Set<string>();
  for (const w of (whoRows ?? []) as { character: string; class: string | null }[]) {
    if (w.character && w.class) classFromWho.add(w.character.toLowerCase());
  }

  const bySpeaker = new Map<string, { count: number; last: string }>();
  for (const m of (msgs ?? []) as { speaker: string; ts: string }[]) {
    if (!m.speaker) continue;
    const lk = m.speaker.toLowerCase();
    if (classFromCharacters.has(lk) || classFromWho.has(lk)) continue;
    const cur = bySpeaker.get(m.speaker);
    if (!cur) bySpeaker.set(m.speaker, { count: 1, last: m.ts });
    else {
      cur.count += 1;
      if (m.ts > cur.last) cur.last = m.ts;
    }
  }

  const items: QueueItem[] = [...bySpeaker.entries()]
    .map(([speaker, v]) => ({
      key:    speaker.toLowerCase(),
      label:  speaker,
      count:  v.count,
      last:   v.last,
      detail: `${v.count} message${v.count === 1 ? '' : 's'} — chat renders as "Name:" only`,
      // /who has the inline class fill-in (writes who_overrides) and is
      // member-readable, so officers can fix the class without leaving the page.
      href:   `/who?q=${encodeURIComponent(speaker)}`,
    }))
    .sort((a, b) => (b.last || '').localeCompare(a.last || ''));
  return {
    id:      'unenrichable_chat',
    icon:    '👻',   // 👻
    title:   'Anonymous-only chat speakers (no class signal)',
    summary: 'Chat from these names renders as plain "Name:" because we have no class signal — they were /anon when we /who’d them, or we haven’t /who’d them at all. Use /admin/who or /who to set class via who_overrides.',
    count:   items.length,
    items,
    fixHelpHref: '/admin/who',
  };
}

// (3) Characters streaming from a member's Mimic with NO entry in the
// OpenDKP-mirrored `characters` table — same source list the
// /admin/links "Not in OpenDKP" section surfaces, lifted into the queue
// so officers see the backlog at a glance instead of having to navigate
// to /admin/links and scroll. The fix-it action lives in /admin/links
// (the Register form), which is what `href` jumps to.
async function loadUnregisteredOpenDKP(): Promise<QueueCategory> {
  const sb = supabaseAdmin();
  const [{ data: uploads }, { data: chars }, { data: whoRows }] = await Promise.all([
    sb.from('agent_upload_stats')
      .select('character, uploaded_by_discord_id, last_uploaded_at')
      .not('uploaded_by_discord_id', 'is', null)
      .not('character', 'is', null)
      .limit(3000),
    sb.from('characters')
      .select('name')
      .eq('guild_id', 'wolfpack'),
    sb.from('who_observations')
      .select('character, level, class, observed_at')
      .eq('guild_id', 'wolfpack')
      .order('observed_at', { ascending: false })
      .limit(3000),
  ]);

  const rostered = new Set<string>();
  for (const c of (chars ?? []) as { name: string }[]) {
    if (c.name) rostered.add(c.name.toLowerCase());
  }
  const whoByName = new Map<string, { level: number | null; cls: string | null }>();
  for (const w of (whoRows ?? []) as { character: string; level: number | null; class: string | null }[]) {
    const k = (w.character || '').toLowerCase();
    if (k && !whoByName.has(k)) whoByName.set(k, { level: w.level ?? null, cls: w.class ?? null });
  }

  const seen = new Set<string>();
  type Row = { name: string; last: string | null; level: number | null; cls: string | null };
  const rows: Row[] = [];
  for (const u of (uploads ?? []) as { character: string | null; uploaded_by_discord_id: string | null; last_uploaded_at: string | null }[]) {
    const name = (u.character || '').trim();
    if (!name || !u.uploaded_by_discord_id) continue;
    if (!/^[A-Za-z]{3,20}$/.test(name)) continue;       // operator streams / junk
    const k = name.toLowerCase();
    if (seen.has(k) || rostered.has(k)) continue;
    seen.add(k);
    const who = whoByName.get(k);
    rows.push({
      name,
      last:  u.last_uploaded_at ?? null,
      level: who?.level ?? null,
      cls:   who?.cls ?? null,
    });
  }

  const items: QueueItem[] = rows
    .map(r => {
      const lvl  = r.level != null ? `L${r.level}` : 'L?';
      const cls  = r.cls || 'class?';
      const rank = r.level == null ? 'rank?'
                 : (r.level >= 46 ? 'Raid Alt' : 'Non-raid Alt');
      return {
        key:    r.name.toLowerCase(),
        label:  r.name,
        last:   r.last,
        detail: `${lvl} ${cls} · ${rank}`,
        href:   `/admin/links`,
      };
    })
    .sort((a, b) => (b.last || '').localeCompare(a.last || ''));

  return {
    id:      'unregistered_opendkp',
    icon:    '🆕',
    title:   'Characters not in OpenDKP',
    summary: 'Characters streaming from a member’s Mimic with no entry in the OpenDKP-mirrored roster. They show on /admin/links → Not in OpenDKP and can be registered inline (officer Register button calls the bot).',
    count:   items.length,
    items,
    fixHelpHref: '/admin/links',
  };
}

// (4) Characters we registered via the /admin/links Register button that
// still have no discord_id mapped on the bot side. The audit marker
// (characters.registered_via_web_at) lets us scope this to *recently*
// registered chars instead of all ~100+ historical unlinked rows; the
// 30-day window matches the realistic "did the player claim yet?"
// follow-up cadence. Action link drops the officer onto /admin/links so
// they can pick a Discord member from the dropdown if the player hasn't
// claimed within OpenDKP's own UI yet.
async function loadAwaitingOpenDKPClaim(): Promise<QueueCategory> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: rows } = await sb
    .from('characters')
    .select('name, registered_via_web_at, registered_via_web_by_discord_id, discord_id, main_name, rank, opendkp_id')
    .eq('guild_id', 'wolfpack')
    .is('discord_id', null)
    .gt('registered_via_web_at', since)
    .order('registered_via_web_at', { ascending: false });
  type Row = {
    name: string;
    registered_via_web_at: string | null;
    registered_via_web_by_discord_id: string | null;
    discord_id: string | null;
    main_name: string | null;
    rank: string | null;
    opendkp_id: number | null;
  };
  const items: QueueItem[] = ((rows ?? []) as Row[]).map(r => ({
    key:    r.name.toLowerCase(),
    label:  r.name,
    last:   r.registered_via_web_at,
    detail: [
      r.main_name && r.main_name !== r.name ? `alt of ${r.main_name}` : null,
      r.rank,
      r.opendkp_id != null ? 'in OpenDKP roster' : 'awaiting OpenDKP sync',
    ].filter(Boolean).join(' · '),
    href:   `/admin/links?show=linked`,    // dropdown to assign Discord ID lives here
  }));
  return {
    id:      'awaiting_opendkp_claim',
    icon:    '⏳',
    title:   'Registered, awaiting OpenDKP claim',
    summary: 'Characters we registered into OpenDKP via the web Register button in the last 30 days that still have no Discord ID linked. Player needs to claim the character in OpenDKP (sets Discord on their account); an officer can also assign the Discord member from /admin/links if the player isn’t going to claim themselves.',
    count:   items.length,
    items,
    fixHelpHref: '/admin/links',
  };
}

// Family index: collapse a person's characters into one unit so a "missed
// tick" is judged against the WHOLE family (you might be ticked on different
// characters across a raid). Union-find over main_name + discord_id, mirroring
// loadFamily in character-family.ts. Returns name→family, family→main display
// name, family→member set, and a lower→display-case map.
type FamilyIndex = {
  familyOf: Map<string, string>;
  mainName: Map<string, string>;
  members:  Map<string, Set<string>>;
  display:  Map<string, string>;
};
async function loadFamilyIndex(sb: ReturnType<typeof supabaseAdmin>): Promise<FamilyIndex> {
  const { data } = await sb.from('characters')
    .select('name, main_name, discord_id, rank').eq('guild_id', 'wolfpack');
  const rows = (data ?? []) as { name: string; main_name: string | null; discord_id: string | null; rank: string | null }[];
  const lc = (s: string) => s.toLowerCase();
  const parent = new Map<string, string>();
  const ensure = (x: string) => { if (!parent.has(x)) parent.set(x, x); };
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; let c = x; while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; } return r; };
  const union = (a: string, b: string) => { ensure(a); ensure(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  const byDiscord = new Map<string, string[]>();
  const display = new Map<string, string>();
  const rowByLower = new Map<string, { name: string; main_name: string | null; rank: string | null }>();
  for (const r of rows) {
    const ln = lc(r.name);
    ensure(ln);
    if (!display.has(ln)) display.set(ln, r.name);
    if (!rowByLower.has(ln)) rowByLower.set(ln, r);
    if (r.main_name) union(ln, lc(r.main_name));
    if (r.discord_id) { const arr = byDiscord.get(r.discord_id) ?? []; arr.push(ln); byDiscord.set(r.discord_id, arr); }
  }
  for (const [, arr] of byDiscord) for (let i = 1; i < arr.length; i++) union(arr[0], arr[i]);

  const members = new Map<string, Set<string>>();
  const familyOf = new Map<string, string>();
  for (const r of rows) {
    const ln = lc(r.name);
    const f = find(ln);
    familyOf.set(ln, f);
    const s = members.get(f) ?? new Set<string>();
    s.add(ln);
    members.set(f, s);
  }
  // Main = the best-ranked member of each family (Officer < … < Raid Alt).
  const mainName = new Map<string, string>();
  for (const [f, set] of members) {
    let best: string | null = null, bestRank = Infinity;
    for (const ln of set) {
      const ri = rankIndex(rowByLower.get(ln)?.rank);
      if (best === null || ri < bestRank || (ri === bestRank && ln < best)) { best = ln; bestRank = ri; }
    }
    mainName.set(f, display.get(best!) || best!);
  }
  return { familyOf, mainName, members, display };
}

// Approximate a tick's wall-clock time from its description, anchored to the
// raid start (UTC). OpenDKP descriptions are usually "Tick 1 (Raid Start)",
// "Tick 3 (2 Hour)", "Tick 4 (Raid End)". Embedded filename timestamps are
// skipped — their timezone is the parsing PC's local time, so they can't be
// compared to the UTC raid ts. Returns null when no relative anchor is found
// (caller falls back to the whole-raid window for chat corroboration).
function parseTickTime(raidTs: string, description: string | null): string | null {
  if (!description) return null;
  if (/raid\s*start/i.test(description)) return raidTs;
  const hr = description.match(/(\d+)\s*hour/i);
  if (hr) return new Date(Date.parse(raidTs) + parseInt(hr[1], 10) * 3600000).toISOString();
  if (/raid\s*end/i.test(description)) return new Date(Date.parse(raidTs) + 3 * 3600000).toISOString();
  return null;
}

// (5) Potentially-missing raid ticks — family-aware, evidence-backed.
//
// A "missed tick" only counts when the person was demonstrably PRESENT but not
// in the snapshot. Three cases (Uilnayar 2026-06-23):
//   • INTERIOR gap — ticked (on any of their characters) BEFORE and AFTER the
//     missed tick. Self-evident: a swap / LD / zone cost them a tick.
//   • END-OF-RAID (trailing) — missed the last tick(s) but combat or chat
//     shows they were still there. These matter most (loot eligibility).
//   • RAID-START (leading) — missed the first tick(s) but combat/chat shows
//     they were already there. (The first tick is taken at 8:30 sharp, so an
//     8:31 entry legitimately misses it — that has no combat/chat *before* the
//     tick, so it is NOT flagged.)
// Late joins and early leaves with no corroborating presence are normal
// partial attendance and never flagged. Grouped by family → "Main (Alt)" when
// an alt held the surrounding ticks; each row lists which tick of which raid
// and the evidence (⚔ combat / 💬 chat). Officer hand-credits in OpenDKP.
async function loadPotentialMissingTicks(): Promise<QueueCategory> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const summary = 'Raiders who were present (ticked before/after, or shown by combat + chat) but missing from a tick snapshot — a swap/LD/zone mid-raid, or still fighting at raid end when the last loot tick was taken. Late joins / early leaves with no corroboration aren\'t flagged. Grouped by family; expand for which tick of which raid + evidence. Officer hand-credits in OpenDKP.';
  const emptyCat: QueueCategory = { id: 'missing_ticks', icon: '🎟️', title: 'Potentially missing raid ticks', summary, count: 0, items: [], fixHelpHref: 'https://wolfpack.opendkp.com/#/raids' };

  const [{ data: raids }, fam] = await Promise.all([
    sb.from('opendkp_raids').select('raid_id, ts, name').gte('ts', since).order('ts', { ascending: false }),
    loadFamilyIndex(sb),
  ]);
  const raidRows = (raids ?? []) as { raid_id: number; ts: string; name: string | null }[];
  if (raidRows.length === 0) return emptyCat;
  const raidMeta = new Map<number, { ts: string; name: string | null }>();
  for (const r of raidRows) raidMeta.set(r.raid_id, { ts: r.ts, name: r.name });

  const { data: ticks } = await sb
    .from('opendkp_ticks')
    .select('raid_id, tick_id, description, value, attendees')
    .in('raid_id', raidRows.map(r => r.raid_id));
  type TickRow = { raid_id: number; tick_id: number; description: string | null; value: number | null; attendees: string[] | null };
  const byRaid = new Map<number, TickRow[]>();
  for (const t of (ticks ?? []) as TickRow[]) { const l = byRaid.get(t.raid_id) ?? []; l.push(t); byRaid.set(t.raid_id, l); }

  type Kind = 'interior' | 'trailing' | 'leading';
  type Incident = {
    familyId: string; raidId: number; raidTs: string; raidName: string;
    tickLabel: string; tickTime: string | null; onChar: string; value: number;
    kind: Kind; combatNear?: boolean; chatNear?: boolean;
  };
  const candidates: Incident[] = [];

  for (const [raidId, tickListRaw] of byRaid) {
    const tickList = [...tickListRaw].sort((a, b) => a.tick_id - b.tick_id);
    if (tickList.length < 2) continue;
    if (!tickList.every(t => Array.isArray(t.attendees) && t.attendees.length > 0)) continue;  // sync gap
    const meta = raidMeta.get(raidId)!;

    const famPresence = new Map<string, Set<string>[]>();
    tickList.forEach((t, idx) => {
      for (const a of (t.attendees || [])) {
        const ln = (a || '').toLowerCase();
        if (!ln) continue;
        const fid = fam.familyOf.get(ln);
        if (!fid) continue;                                                       // not a roster character
        let arr = famPresence.get(fid);
        if (!arr) { arr = tickList.map(() => new Set<string>()); famPresence.set(fid, arr); }
        arr[idx].add(ln);
      }
    });

    for (const [fid, arr] of famPresence) {
      const present = arr.map(s => s.size > 0);
      const first = present.indexOf(true);
      const last = present.lastIndexOf(true);
      if (first < 0) continue;
      for (let i = 0; i < tickList.length; i++) {
        if (present[i]) continue;
        const kind: Kind = (i > first && i < last) ? 'interior' : (i > last) ? 'trailing' : 'leading';
        const t = tickList[i];
        // The character they were on = nearest present family char (before, else after).
        let onLn = '';
        for (let j = i - 1; j >= 0; j--) { if (arr[j].size) { onLn = [...arr[j]][0]; break; } }
        if (!onLn) for (let j = i + 1; j < arr.length; j++) { if (arr[j].size) { onLn = [...arr[j]][0]; break; } }
        candidates.push({
          familyId: fid, raidId, raidTs: meta.ts, raidName: meta.name || `raid ${raidId}`,
          tickLabel: t.description || `tick ${t.tick_id}`, tickTime: parseTickTime(meta.ts, t.description),
          onChar: fam.display.get(onLn) || onLn, value: t.value || 0, kind,
        });
      }
    }
  }

  // ── Corroboration signals (chat + combat) for the families with candidates ──
  const candFamIds = new Set(candidates.map(c => c.familyId));
  const famChat = new Map<string, number[]>();    // familyId → chat ts (ms)
  const famCombat = new Map<string, number[]>();   // familyId → encounter start ts (ms)

  if (candFamIds.size > 0) {
    // Chat for every member of a candidate family (display + corroboration).
    const speakerToFam = new Map<string, string>();
    const speakers: string[] = [];
    for (const fid of candFamIds) for (const ln of (fam.members.get(fid) ?? [])) {
      const disp = fam.display.get(ln) || ln; speakers.push(disp); speakerToFam.set(disp.toLowerCase(), fid);
    }
    const { data: chat } = await sb.from('chat_messages')
      .select('speaker, ts').in('channel', ['guild', 'raid'])
      .in('speaker', speakers.slice(0, 400)).gte('ts', since).limit(20000);
    for (const m of ((chat ?? []) as { speaker: string | null; ts: string | null }[])) {
      if (!m.speaker || !m.ts) continue;
      const fid = speakerToFam.get(m.speaker.toLowerCase());
      if (!fid) continue;
      const arr = famChat.get(fid) ?? []; arr.push(Date.parse(m.ts)); famChat.set(fid, arr);
    }

    // Combat only matters for EDGE candidates (interior is self-evident). Fetch
    // per edge-raid: encounters in the raid window + which family members were
    // in them. Bounded — few raids produce edge candidates.
    const edge = candidates.filter(c => c.kind !== 'interior');
    const edgeRaidIds = [...new Set(edge.map(c => c.raidId))];
    const edgeFamIds = new Set(edge.map(c => c.familyId));
    const memberToFam = new Map<string, string>();
    const memberNames: string[] = [];
    for (const fid of edgeFamIds) for (const ln of (fam.members.get(fid) ?? [])) {
      const disp = fam.display.get(ln) || ln; memberNames.push(disp); memberToFam.set(disp.toLowerCase(), fid);
    }
    await Promise.all(edgeRaidIds.map(async (rid) => {
      const meta = raidMeta.get(rid)!;
      const lo = new Date(Date.parse(meta.ts) - 10 * 60000).toISOString();
      const hi = new Date(Date.parse(meta.ts) + 6 * 3600000).toISOString();
      const { data: encs } = await sb.from('encounters')
        .select('id, started_at').eq('guild_id', 'wolfpack')
        .gte('started_at', lo).lte('started_at', hi).limit(300);
      const encList = (encs ?? []) as { id: string; started_at: string }[];
      if (encList.length === 0) return;
      const startById = new Map(encList.map(e => [e.id, Date.parse(e.started_at)]));
      const { data: eps } = await sb.from('encounter_players')
        .select('encounter_id, character_name')
        .in('encounter_id', encList.map(e => e.id))
        .in('character_name', memberNames.slice(0, 400)).limit(20000);
      for (const ep of ((eps ?? []) as { encounter_id: string; character_name: string | null }[])) {
        if (!ep.character_name) continue;
        const fid = memberToFam.get(ep.character_name.toLowerCase());
        const t = startById.get(ep.encounter_id);
        if (!fid || t == null) continue;
        const arr = famCombat.get(fid) ?? []; arr.push(t); famCombat.set(fid, arr);
      }
    }));
  }

  // ── Resolve candidates: keep interior always; keep edges only when combat or
  // chat proves presence on the MISSING side of the tick. ──
  type Agg = { familyId: string; main: string; missed: number; last: string; incidents: Incident[]; alts: Set<string> };
  const byFamily = new Map<string, Agg>();
  for (const c of candidates) {
    const chatTs = famChat.get(c.familyId) ?? [];
    const combatTs = famCombat.get(c.familyId) ?? [];
    const tt = c.tickTime ? Date.parse(c.tickTime) : null;
    const within = (arr: number[], lo: number, hi: number) => arr.some(t => t >= lo && t <= hi);
    if (tt != null) {
      c.chatNear = within(chatTs, tt - 20 * 60000, tt + 20 * 60000);
      c.combatNear = within(combatTs, tt - 20 * 60000, tt + 20 * 60000);
    }

    let keep = c.kind === 'interior';
    if (!keep) {
      const raidLo = Date.parse(c.raidTs), raidHi = raidLo + 6 * 3600000;
      // present on the missing side: leading → at/before the tick; trailing → at/after.
      const lo = c.kind === 'leading' ? raidLo : (tt != null ? tt - 20 * 60000 : raidLo);
      const hi = c.kind === 'leading' ? (tt != null ? tt + 20 * 60000 : raidHi) : raidHi;
      keep = within(combatTs, lo, hi) || within(chatTs, lo, hi);
    }
    if (!keep) continue;

    const agg = byFamily.get(c.familyId) ?? { familyId: c.familyId, main: fam.mainName.get(c.familyId) || c.familyId, missed: 0, last: c.raidTs, incidents: [], alts: new Set<string>() };
    agg.missed += 1;
    if (c.raidTs > agg.last) agg.last = c.raidTs;
    agg.incidents.push(c);
    if (c.onChar && c.onChar.toLowerCase() !== agg.main.toLowerCase()) agg.alts.add(c.onChar);
    byFamily.set(c.familyId, agg);
  }

  const kindLabel: Record<Kind, string> = { interior: 'mid-raid gap', trailing: 'end-of-raid loot tick', leading: 'raid-start tick' };
  const items: QueueItem[] = [...byFamily.values()].map(agg => {
    const label = agg.alts.size ? `${agg.main} (${[...agg.alts].join(', ')})` : agg.main;
    const lines = agg.incidents
      .sort((a, b) => b.raidTs.localeCompare(a.raidTs))
      .map(inc => {
        const d = new Date(inc.raidTs).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
        const on = inc.onChar && inc.onChar.toLowerCase() !== agg.main.toLowerCase() ? ` on ${inc.onChar}` : '';
        const ev = [inc.combatNear ? '⚔ in combat' : '', inc.chatNear ? '💬 chatting' : ''].filter(Boolean).join(', ');
        return `${d} ${inc.raidName} — missed ${inc.tickLabel}${on} (${inc.value} DKP) · ${kindLabel[inc.kind]}${ev ? ` · ${ev}` : ''}`;
      });
    const trailing = agg.incidents.filter(i => i.kind === 'trailing').length;
    return {
      key:    agg.familyId,
      label,
      count:  agg.missed,
      last:   agg.last,
      detail: `${agg.missed} likely missed tick${agg.missed === 1 ? '' : 's'}${trailing ? ` (${trailing} at raid end — loot-relevant)` : ''}`,
      lines,
      href:   'https://wolfpack.opendkp.com/#/raids',
    };
  }).sort((a, b) => (b.count || 0) - (a.count || 0) || (b.last || '').localeCompare(a.last || ''));

  return { id: 'missing_ticks', icon: '🎟️', title: 'Potentially missing raid ticks', summary, count: items.length, items, fixHelpHref: 'https://wolfpack.opendkp.com/#/raids' };
}

// (6) Chat speaker misattribution. A misconfigured agent tails a stray
// eqlog_<Name> log (an old or foreign character still in the watched folder),
// so guild/raid chat the player typed on their REAL character is stamped with
// that stray name (Wabumkin's machine emitting "Dopefiend"/"Facehack";
// Chadivarius's emitting "Ashaiya"). The chat_attribution_conflicts RPC finds
// lines where the same in-game broadcast was stored under both a ghost name
// (non-roster, one uploader) and a real roster name (seen by bystanders). The
// fix is on the member's machine: remove the stray log from Mimic's watch dir.
async function loadChatMisattribution(): Promise<QueueCategory> {
  const sb = supabaseAdmin();
  const summary = 'Members whose agent is tailing a stray/old log file, so their guild chat posts under the wrong name (the bot now auto-relabels what it can, but the source should be fixed). Ask the member to remove the named log from the folder Mimic watches.';
  const { data, error } = await sb.rpc('chat_attribution_conflicts', { p_days: 7 });
  const rows = (data ?? []) as { ghost_speaker: string; uploader_discord_id: string; likely_real: string; lines: number; last_line: string }[];
  if (error || rows.length === 0) {
    return { id: 'chat_misattribution', icon: '🪪', title: 'Chat speaker misattribution', summary, count: 0, items: [], fixHelpHref: '/admin/agents' };
  }
  // Resolve uploader discord_id → member nickname for readable rows.
  const ids = [...new Set(rows.map(r => r.uploader_discord_id))];
  const { data: members } = await sb.from('wolfpack_members')
    .select('discord_id, nickname, global_name').in('discord_id', ids);
  const nameById = new Map<string, string>();
  for (const m of ((members ?? []) as { discord_id: string; nickname: string | null; global_name: string | null }[])) {
    nameById.set(m.discord_id, m.nickname || m.global_name || m.discord_id);
  }
  const items: QueueItem[] = rows.map(r => ({
    key:    `${r.uploader_discord_id}|${r.ghost_speaker}`,
    label:  `${nameById.get(r.uploader_discord_id) || r.uploader_discord_id}: relaying as “${r.ghost_speaker}”`,
    detail: `Real character looks like ${r.likely_real}. ${r.lines} line${r.lines === 1 ? '' : 's'} in 7d — their agent is tailing a stray eqlog_${r.ghost_speaker} log; have them remove it from Mimic's watch folder.`,
    count:  r.lines,
    last:   r.last_line,
    href:   '/admin/agents',
  }));
  return { id: 'chat_misattribution', icon: '🪪', title: 'Chat speaker misattribution', summary, count: items.length, items, fixHelpHref: '/admin/agents' };
}

// Load every category in parallel. Caller uses the total count for the
// banner, the per-category counts for the badges, and items for /admin/queue.
export async function loadAdminQueue(): Promise<{
  total:      number;
  categories: QueueCategory[];
}> {
  const categories = await Promise.all([
    loadUnrosteredChatSpeakers(),
    loadUnenrichableChatSpeakers(),
    loadUnregisteredOpenDKP(),
    loadAwaitingOpenDKPClaim(),
    loadPotentialMissingTicks(),
    loadChatMisattribution(),
  ]);
  const total = categories.reduce((acc, c) => acc + c.count, 0);
  return { total, categories };
}
