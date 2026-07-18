// Officer read-only view of the ingested guild-rules store (#94).
//
// Lists the rows /ingestrules wrote to guild_rules, grouped by channel, in rule
// order. Shows parsed (numbered) vs raw rows and flags deactivated (source
// message deleted) ones. Read-only — the source of truth is Discord; edit there
// and re-run /ingestrules. Officer gating is handled by the parent admin layout.
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type RuleRow = {
  id: string;
  channel_key: string;
  rule_number: number | null;
  title: string | null;
  body: string;
  category: string | null;
  source_message_id: string;
  source_edited_at: string | null;
  ingested_at: string;
  active: boolean;
};

const CHANNELS: { key: string; label: string; hint: string }[] = [
  { key: 'rules',      label: '📜 #rules',       hint: 'general guild rules' },
  { key: 'raid_rules', label: '⚔️ #raid-rules',  hint: 'raid conduct + attendance' },
  { key: 'loot_rules', label: '💰 #loot-rules',  hint: 'DKP / loot council' },
];

async function loadRules(): Promise<RuleRow[]> {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from('guild_rules')
    .select('id, channel_key, rule_number, title, body, category, source_message_id, source_edited_at, ingested_at, active')
    .eq('guild_id', 'wolfpack')
    .order('rule_number', { ascending: true, nullsFirst: false });
  return (data ?? []) as RuleRow[];
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
}

export default async function AdminRulesPage() {
  const rules = await loadRules();

  const byChannel = new Map<string, RuleRow[]>();
  for (const r of rules) {
    const list = byChannel.get(r.channel_key) || [];
    list.push(r);
    byChannel.set(r.channel_key, list);
  }

  const lastIngest = rules.reduce<string | null>((max, r) => {
    if (!r.ingested_at) return max;
    if (!max || r.ingested_at > max) return r.ingested_at;
    return max;
  }, null);

  const totalActive = rules.filter(r => r.active).length;

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/admin" className="text-blue hover:underline">← back to admin</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">📖 Guild rules store</h2>
        <p className="text-sm text-dim leading-6">
          The Discord rulebook (<code>#rules</code> / <code>#raid-rules</code> /
          <code>#loot-rules</code>) ingested into the queryable{' '}
          <code>guild_rules</code> table by the officer command{' '}
          <code>/ingestrules</code>. This is the single source later features
          (raid-kit checker, comp matcher, eligibility) read from instead of
          hard-coding rules. <b>Read-only</b> — edit a rule in Discord and re-run{' '}
          <code>/ingestrules</code>; edits update in place and deleted messages
          are flipped inactive. Numbered messages parse into a rule number +
          title; anything else is kept verbatim as a <b>raw</b> row so nothing is
          dropped.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
          <Stat label="Active rules" value={totalActive} />
          <Stat label="Channels ingested" value={byChannel.size} />
          <Stat label="Numbered" value={rules.filter(r => r.active && r.rule_number != null).length} />
          <Stat label="Last ingest" text={fmtDate(lastIngest)} />
        </div>
      </section>

      {rules.length === 0 && (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          No rules ingested yet. An officer runs <code>/ingestrules</code> in
          Discord after setting <code>RULES_CHANNEL_ID</code>,{' '}
          <code>RAID_RULES_CHANNEL_ID</code>, and <code>LOOT_RULES_CHANNEL_ID</code>.
        </section>
      )}

      {CHANNELS.map(chan => {
        const list = (byChannel.get(chan.key) || []);
        if (list.length === 0) return null;
        const active = list.filter(r => r.active);
        const inactive = list.length - active.length;
        return (
          <section key={chan.key} className="bg-panel border border-border rounded-lg">
            <h3 className="text-sm text-orange px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
              <span>{chan.label} <span className="text-dim">— {chan.hint}</span></span>
              <span className="text-[10px] text-dim">
                {active.length} active{inactive > 0 ? ` · ${inactive} inactive (deleted)` : ''}
              </span>
            </h3>
            <ul className="divide-y divide-border/40">
              {list.map(r => (
                <li key={r.id} className={`px-4 py-3 ${r.active ? '' : 'opacity-40'}`}>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    {r.rule_number != null ? (
                      <span className="text-gold text-sm font-mono shrink-0">#{r.rule_number}</span>
                    ) : (
                      <span className="text-[10px] uppercase tracking-wide text-dim border border-border rounded px-1 py-0.5 shrink-0">raw</span>
                    )}
                    {r.title && <span className="text-text text-sm font-semibold">{r.title}</span>}
                    {!r.active && <span className="text-[10px] text-red-400">deactivated</span>}
                    {r.category && <span className="text-[10px] text-blue border border-border rounded px-1">{r.category}</span>}
                  </div>
                  <p className="text-xs text-dim leading-5 mt-1 whitespace-pre-wrap break-words">{r.body}</p>
                  <div className="text-[10px] text-dim mt-1">
                    msg {r.source_message_id}
                    {r.source_edited_at ? ` · edited ${fmtDate(r.source_edited_at)}` : ''}
                    {` · ingested ${fmtDate(r.ingested_at)}`}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Stat({ label, value, text }: { label: string; value?: number; text?: string }) {
  return (
    <div className="bg-bg border border-border rounded p-3">
      <div className="text-2xl text-text">{text ?? (value ?? 0).toLocaleString()}</div>
      <div className="text-dim text-xs">{label}</div>
    </div>
  );
}
