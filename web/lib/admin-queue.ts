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

const WINDOW = '14 days';

export type QueueItem = {
  key:        string;
  label:      string;
  detail?:    string;
  count?:     number;        // recent message count etc — sortable/display
  last?:      string | null; // ISO timestamp
  href?:      string;        // optional jump-to-fix link
};

export type QueueCategory = {
  id:           'unrostered_chat' | 'unenrichable_chat' | 'unregistered_opendkp' | 'awaiting_opendkp_claim' | 'missing_ticks';
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

// (5) Potentially-missing raid ticks. OpenDKP is the source of truth for
// attendance; when a character is present for SOME ticks of a raid but not
// ALL of them, they were in the raid yet missed a tick — usually from
// switching characters, zoning, or going LD (Uilnayar 2026-06-23). We only
// consider raids where EVERY tick has attendees captured (fully-synced), so
// a sync gap (empty-attendee tick) never false-flags the whole raid. Per
// character we report how many ticks they missed across the last 30 days +
// when it last happened, so an officer can decide whether to hand-credit it
// in OpenDKP.
async function loadPotentialMissingTicks(): Promise<QueueCategory> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: raids } = await sb
    .from('opendkp_raids')
    .select('raid_id, ts')
    .gte('ts', since)
    .order('ts', { ascending: false });
  const raidRows = (raids ?? []) as { raid_id: number; ts: string }[];
  if (raidRows.length === 0) {
    return { id: 'missing_ticks', icon: '🎟️', title: 'Potentially missing raid ticks',
      summary: 'Raiders present for some ticks of a raid but not all — likely a character swap, zone, or LD that cost a tick. Officer can hand-credit in OpenDKP.',
      count: 0, items: [], fixHelpHref: 'https://wolfpack.opendkp.com/#/raids' };
  }
  const tsByRaid = new Map<number, string>();
  for (const r of raidRows) tsByRaid.set(r.raid_id, r.ts);

  const { data: ticks } = await sb
    .from('opendkp_ticks')
    .select('raid_id, tick_id, attendees')
    .in('raid_id', raidRows.map(r => r.raid_id));
  type TickRow = { raid_id: number; tick_id: number; attendees: string[] | null };

  // Group ticks by raid.
  const byRaid = new Map<number, TickRow[]>();
  for (const t of (ticks ?? []) as TickRow[]) {
    const list = byRaid.get(t.raid_id) ?? [];
    list.push(t);
    byRaid.set(t.raid_id, list);
  }

  // For each FULLY-SYNCED raid (every tick populated), find characters who
  // attended ≥1 tick but fewer than all ticks → missed a tick.
  type Miss = { missed: number; last: string };
  const byChar = new Map<string, Miss>();   // displayName → aggregate
  const display = new Map<string, string>(); // lower → original-case name
  for (const [raidId, tickList] of byRaid) {
    if (tickList.length < 2) continue;       // single-tick raid — nothing to "miss"
    const allPopulated = tickList.every(t => Array.isArray(t.attendees) && t.attendees.length > 0);
    if (!allPopulated) continue;             // sync gap — don't false-flag
    const total = tickList.length;
    const presentCount = new Map<string, number>();
    for (const t of tickList) {
      for (const a of (t.attendees || [])) {
        const k = (a || '').toLowerCase();
        if (!k) continue;
        presentCount.set(k, (presentCount.get(k) || 0) + 1);
        if (!display.has(k)) display.set(k, a);
      }
    }
    const ts = tsByRaid.get(raidId) || '';
    for (const [k, n] of presentCount) {
      if (n >= total) continue;              // got every tick — fine
      const missedHere = total - n;
      const cur = byChar.get(k);
      if (!cur) byChar.set(k, { missed: missedHere, last: ts });
      else { cur.missed += missedHere; if (ts > cur.last) cur.last = ts; }
    }
  }

  const items: QueueItem[] = [...byChar.entries()]
    .map(([k, v]) => ({
      key:    k,
      label:  display.get(k) || k,
      count:  v.missed,
      last:   v.last,
      detail: `missed ${v.missed} tick${v.missed === 1 ? '' : 's'} (present for the raid)`,
      href:   'https://wolfpack.opendkp.com/#/raids',
    }))
    .sort((a, b) => (b.count || 0) - (a.count || 0) || (b.last || '').localeCompare(a.last || ''));

  return {
    id:      'missing_ticks',
    icon:    '🎟️',
    title:   'Potentially missing raid ticks',
    summary: 'Raiders present for some ticks of a raid but not all over the last 30 days — likely a character swap, zone, or LD that cost a tick. Only fully-synced raids are checked (no sync-gap false positives). Officer can hand-credit the tick in OpenDKP.',
    count:   items.length,
    items,
    fixHelpHref: 'https://wolfpack.opendkp.com/#/raids',
  };
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
  ]);
  const total = categories.reduce((acc, c) => acc + c.count, 0);
  return { total, categories };
}
