// /me/tells — your inbound /tell history. PRIVATE scope: only you ever see
// this page. Two views: a conversation grid (each row = one other person,
// most-recent-first), and a stream of the last N tells across everyone.
//
// Data source: `tells` table, gated by RLS to (wolfpack_members.user_id =
// auth.uid()) so the SQL itself enforces the privacy promise — even if a
// page change tried to leak it, the database would refuse.
//
// Enable by flipping the **Tells: ON** toggle on /me (per character).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import TellNotifications from './TellNotifications';
import BulkTellsToggle from './BulkTellsToggle';
import TellsSnoozeControl from './TellsSnoozeControl';
import { userTz, fmtShort, relTime } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

type TellRow = {
  id: number;
  owner_character: string;
  direction: 'incoming' | 'outgoing';
  other_name: string;
  text: string;
  ts: string;
  dm_relayed_at: string | null;
};

async function loadOwnerCharacters(userId: string) {
  const admin = supabaseAdmin();
  const { data: pack } = await admin
    .from('wolfpack_members')
    .select('discord_id, tells_dm_paused_until')
    .eq('user_id', userId)
    .maybeSingle();
  if (!pack?.discord_id) return { discordId: null, pausedUntil: null as string | null, chars: [] as { name: string; tell_relay: boolean }[] };
  const { data: chars } = await admin
    .from('characters')
    .select('name, tell_relay')
    .eq('guild_id', 'wolfpack')
    .eq('discord_id', pack.discord_id);
  return {
    discordId:   pack.discord_id,
    pausedUntil: (pack as { tells_dm_paused_until: string | null }).tells_dm_paused_until ?? null,
    chars:       (chars ?? []) as { name: string; tell_relay: boolean }[],
  };
}

async function loadTells(discordId: string): Promise<TellRow[]> {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from('tells')
    .select('id, owner_character, direction, other_name, text, ts, dm_relayed_at')
    .eq('owner_discord_id', discordId)
    .order('ts', { ascending: false })
    .limit(2000);
  return (data ?? []) as TellRow[];
}

type Conversation = {
  other: string;
  total: number;
  incoming: number;
  outgoing: number;
  lastTs: string;
  lastText: string;
  lastDirection: 'incoming' | 'outgoing';
  lastChar: string;
};

function buildConversations(tells: TellRow[]): Conversation[] {
  const by = new Map<string, Conversation>();
  for (const t of tells) {
    const key = t.other_name.toLowerCase();
    let c = by.get(key);
    if (!c) {
      c = { other: t.other_name, total: 0, incoming: 0, outgoing: 0,
            lastTs: t.ts, lastText: t.text, lastDirection: t.direction, lastChar: t.owner_character };
      by.set(key, c);
    }
    c.total += 1;
    if (t.direction === 'incoming') c.incoming += 1; else c.outgoing += 1;
    if (t.ts > c.lastTs) {
      c.lastTs = t.ts; c.lastText = t.text;
      c.lastDirection = t.direction; c.lastChar = t.owner_character;
    }
    // Keep newest name spelling if it differs.
    if (t.ts >= c.lastTs) c.other = t.other_name;
  }
  return [...by.values()].sort((a, b) => b.lastTs.localeCompare(a.lastTs));
}

// fmtTs/relTime now come from @/lib/timezone (imported at top of file via
// the userTz fmtShort/relTime helpers).

export default async function TellsPage() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/signin?next=/me/tells');

  const tz = await userTz();
  const { discordId, chars, pausedUntil } = await loadOwnerCharacters(user.id);
  const optedIn = chars.filter(c => c.tell_relay);
  const tells   = discordId ? await loadTells(discordId) : [];
  const conversations = buildConversations(tells);
  const recent = tells.slice(0, 50);

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-2xl text-gold flex items-center gap-3">
              <span aria-hidden>📬</span>
              <span>Inbound /tell</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-purple/20 text-purple border-purple/40 font-mono">PRIVATE</span>
            </h2>
            <p className="text-sm text-dim mt-2 max-w-2xl">
              Only you see this. When you flip <span className="text-orange">Tells: ON</span> on{' '}
              <Link href="/me" className="text-blue hover:underline">/me</Link>, the agent
              forwards incoming and outgoing tells for that character here — and DMs you
              on Discord when an incoming tell lands while you're away. Tells from other
              players' agents are never collected.
            </p>
          </div>
        </div>
        {discordId && (
          <div className="mt-4 pt-3 border-t border-border/40">
            <div className="text-[10px] text-dim mb-2">Notify me when a tell lands while I&apos;m away</div>
            <TellNotifications discordId={discordId} />
            <div className="mt-3 pt-3 border-t border-border/40">
              <div className="text-[10px] text-dim mb-2">Mute the Discord DM for a stretch — tells still record to this page while paused</div>
              <TellsSnoozeControl pausedUntil={pausedUntil} />
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
          <Stat label="Conversations" value={conversations.length} />
          <Stat label="Total tells"   value={tells.length} />
          <Stat label="Incoming"      value={tells.filter(t => t.direction === 'incoming').length} color="text-blue" />
          <Stat label="Outgoing"      value={tells.filter(t => t.direction === 'outgoing').length} color="text-green" />
        </div>
        {chars.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border/40">
            <div className="text-[10px] text-dim mb-2">
              One-click opt-in for every character you own (covers alts whose Discord link the roster
              import missed). Per-character toggles still live on <Link href="/me" className="text-blue hover:underline">/me</Link>.
            </div>
            <BulkTellsToggle optedIn={optedIn.length} total={chars.length} />
            {optedIn.length === 0 && (
              <div className="mt-3 bg-bg border border-orange/40 rounded p-3 text-sm">
                <span className="text-orange">None of your characters have Tells enabled.</span>{' '}
                Default is off — your tells stay private until you opt in.
              </div>
            )}
          </div>
        )}
      </section>

      {conversations.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h3 className="text-lg text-orange mb-3">Conversations</h3>
          <ul className="divide-y divide-border/40">
            {conversations.slice(0, 50).map(c => (
              <li key={c.other.toLowerCase()} className="py-2 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-text">{c.other}</span>
                    <span className="text-[10px] text-dim">
                      {c.total} tell{c.total === 1 ? '' : 's'}
                      {c.incoming > 0 && <> · {c.incoming} in</>}
                      {c.outgoing > 0 && <> · {c.outgoing} out</>}
                    </span>
                  </div>
                  <div className="text-xs text-dim mt-1 truncate">
                    <span className={c.lastDirection === 'incoming' ? 'text-blue' : 'text-green'}>
                      {c.lastDirection === 'incoming' ? '←' : '→'}
                    </span>{' '}
                    {c.lastText}
                  </div>
                </div>
                <div className="text-right text-[10px] text-dim whitespace-nowrap">
                  <div>{relTime(c.lastTs)}</div>
                  <div className="text-dim/70">{c.lastChar}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-lg text-orange mb-3">Recent stream</h3>
        {recent.length === 0 ? (
          <div className="text-sm text-dim italic">
            {optedIn.length === 0
              ? 'No tells collected yet — opt in on /me to start.'
              : 'No tells yet. Once a tell lands on your opted-in character, it shows here.'}
          </div>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {recent.map(t => (
              <li key={t.id} className="flex items-start gap-2">
                <span className={`mt-0.5 ${t.direction === 'incoming' ? 'text-blue' : 'text-green'}`}>
                  {t.direction === 'incoming' ? '←' : '→'}
                </span>
                <span className="text-text shrink-0">
                  {t.direction === 'incoming' ? t.other_name : t.owner_character}
                </span>
                <span className="text-dim shrink-0">{t.direction === 'incoming' ? '→' : 'told'}</span>
                <span className="text-text shrink-0">
                  {t.direction === 'incoming' ? t.owner_character : t.other_name}
                </span>
                <span className="text-dim shrink-0">:</span>
                <span className="text-text break-words min-w-0 flex-1">{t.text}</span>
                <span className="text-dim/70 text-[10px] whitespace-nowrap shrink-0" title={t.ts}>
                  {fmtShort(t.ts, tz)}{t.dm_relayed_at && <span title="DM'd to you">{' '}🔔</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
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
