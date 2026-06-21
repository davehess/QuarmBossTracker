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
  id:           'unrostered_chat' | 'unenrichable_chat';
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
  const [{ data: opendkp }, { data: msgs }] = await Promise.all([
    sb.from('opendkp_character_id_to_name').select('character_name'),
    sb.from('chat_messages')
      .select('speaker, ts')
      .in('channel', ['guild', 'raid'])
      .gt('ts', new Date(Date.now() - 14 * 86400000).toISOString())
      .limit(20000),
  ]);
  const rostered = new Set<string>();
  for (const r of (opendkp ?? []) as { character_name: string }[]) {
    if (r.character_name) rostered.add(r.character_name.toLowerCase());
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

// Load every category in parallel. Caller uses the total count for the
// banner, the per-category counts for the badges, and items for /admin/queue.
export async function loadAdminQueue(): Promise<{
  total:      number;
  categories: QueueCategory[];
}> {
  const categories = await Promise.all([
    loadUnrosteredChatSpeakers(),
    loadUnenrichableChatSpeakers(),
  ]);
  const total = categories.reduce((acc, c) => acc + c.count, 0);
  return { total, categories };
}
