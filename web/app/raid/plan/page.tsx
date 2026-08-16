// /raid/plan — Fight Cards, the pre-raid readiness page (task #43,
// docs/DESIGN-fight-cards.md; Hitya: "conceptually it was a checklist for each
// of the fights to make sure that we had the player composition that we
// needed, and a review of the tactics that keep us from wasting time and
// wiping").
//
// One card per fight. Comp / kit / tactics are officer-authored text (v1 — the
// structured comp-template and kit joins land with the #93 integration); the
// CALLOUTS column is resolved LIVE against guild_triggers by id, so what the
// card claims is armed is what the fleet is actually polling — never a copy.
// A linked id that no longer resolves renders MISSING in red: a card promising
// a callout that cannot fire is the worst lie a pre-raid page can tell.
//
// Officers author inline (same pattern as the /parses officer strip): a
// create form at the bottom, an edit form folded into each card.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { cleanBossName } from '@/lib/format';
import {
  orderCards, resolveTriggers, triggerSummary,
  type FightCardRow, type TriggerRow,
} from '@/lib/fightCards';
import { createFightCard, updateFightCard, deleteFightCard } from './actions';

export const dynamic = 'force-dynamic';

const SUMMARY_CLS: Record<string, string> = {
  ok: 'text-green border-green/40 bg-green/10',
  warn: 'text-orange border-orange/40 bg-orange/10',
  bad: 'text-red border-red/50 bg-red/10',
  none: 'text-dim border-dim/40',
};

export default async function RaidPlanPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/raid/plan');
  const officer = await isOfficer(user.id);

  const sb = supabaseAdmin();
  const { data: cardRows, error } = await sb
    .from('fight_cards')
    .select('id, boss_npc_id, title, comp_notes, kit_notes, tactics, trigger_ids, guide_ref, sort_order, active, updated_by, updated_at')
    .eq('guild_id', 'wolfpack')
    .order('sort_order', { ascending: true });
  if (error) {
    return <div className="bg-panel border border-red rounded-lg p-4 text-red text-sm font-mono">Error loading fight cards: {error.message}</div>;
  }
  const all = (cardRows ?? []) as FightCardRow[];
  const cards = orderCards(all.filter(c => c.active));
  const inactive = all.filter(c => !c.active);

  // Live trigger state for every linked id — plus the full list (name-sorted)
  // for the officer picker.
  const { data: trigRows } = await sb
    .from('guild_triggers')
    .select('id, name, enabled, timer_duration_sec, warning_seconds, warning_text, cooldown_seconds, actions, updated_at')
    .order('name', { ascending: true });
  const triggers = (trigRows ?? []) as TriggerRow[];
  const triggersById = new Map(triggers.map(t => [t.id, t]));

  // Boss names for every card in one query.
  const bossIds = [...new Set(all.map(c => c.boss_npc_id))];
  const bossNames = new Map<number, string>();
  if (bossIds.length) {
    const { data: npcRows } = await sb
      .from('eqemu_npc_types').select('id, name').in('id', bossIds);
    for (const r of (npcRows ?? []) as { id: number; name: string }[]) bossNames.set(r.id, r.name);
  }

  const TriggerPicker = ({ selected }: { selected: string[] }) => (
    <label className="block text-xs text-dim">
      Linked callouts (guild triggers — hold Ctrl/Cmd to multi-select)
      <select
        name="trigger_ids" multiple size={8}
        defaultValue={selected}
        className="mt-1 w-full bg-bg border border-border rounded p-1 text-text text-xs"
      >
        {triggers.map(t => (
          <option key={t.id} value={t.id}>
            {t.enabled ? '● ' : '○ '}{t.name}
          </option>
        ))}
      </select>
    </label>
  );

  const CardFields = ({ c }: { c?: FightCardRow }) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
      <label className="block text-dim">Boss NPC id (eqemu id — the /guide and PQDI id)
        <input name="boss_npc_id" required defaultValue={c?.boss_npc_id ?? ''}
               className="mt-1 w-full bg-bg border border-border rounded p-1 text-text" />
      </label>
      <label className="block text-dim">Title (optional — &quot;Tunare — the kite&quot;)
        <input name="title" defaultValue={c?.title ?? ''}
               className="mt-1 w-full bg-bg border border-border rounded p-1 text-text" />
      </label>
      <label className="block text-dim sm:col-span-2">Composition needed
        <textarea name="comp_notes" rows={2} defaultValue={c?.comp_notes ?? ''}
                  className="mt-1 w-full bg-bg border border-border rounded p-1 text-text" />
      </label>
      <label className="block text-dim sm:col-span-2">Kit to bring
        <textarea name="kit_notes" rows={2} defaultValue={c?.kit_notes ?? ''}
                  className="mt-1 w-full bg-bg border border-border rounded p-1 text-text" />
      </label>
      <label className="block text-dim sm:col-span-2">Tactics review
        <textarea name="tactics" rows={5} defaultValue={c?.tactics ?? ''}
                  className="mt-1 w-full bg-bg border border-border rounded p-1 text-text" />
      </label>
      <div className="sm:col-span-2"><TriggerPicker selected={c?.trigger_ids ?? []} /></div>
      <label className="block text-dim">Guide link override (blank = /guide/&lt;id&gt;)
        <input name="guide_ref" defaultValue={c?.guide_ref ?? ''}
               className="mt-1 w-full bg-bg border border-border rounded p-1 text-text" />
      </label>
      <label className="block text-dim">Sort order
        <input name="sort_order" defaultValue={c?.sort_order ?? 0}
               className="mt-1 w-full bg-bg border border-border rounded p-1 text-text" />
      </label>
    </div>
  );

  const renderCard = (c: FightCardRow) => {
    const bossRaw = bossNames.get(c.boss_npc_id);
    const boss = bossRaw ? cleanBossName(bossRaw) : `npc ${c.boss_npc_id}`;
    const resolved = resolveTriggers(c.trigger_ids, triggersById);
    const summary = triggerSummary(resolved);
    return (
      <section key={c.id} className="bg-panel border border-border rounded-lg p-4">
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
          <h3 className="text-base text-gold flex items-center gap-2 flex-wrap">
            <span>{c.title || boss}</span>
            {c.title && <span className="text-dim text-xs font-normal">({boss})</span>}
            <span className={`text-[10px] uppercase tracking-wide px-1.5 py-px rounded border ${SUMMARY_CLS[summary.level]}`}>
              {summary.label}
            </span>
          </h3>
          <span className="text-xs whitespace-nowrap">
            <Link href={c.guide_ref || `/guide/${c.boss_npc_id}`} className="text-blue hover:underline">guide</Link>
            <a href={`https://www.pqdi.cc/npc/${c.boss_npc_id}`} target="_blank" rel="noreferrer"
               className="ml-2 text-blue hover:underline">[PQDI]</a>
          </span>
        </div>

        {(['comp_notes', 'kit_notes', 'tactics'] as const).map(k => c[k] && (
          <div key={k} className="mb-2">
            <div className="text-[10px] text-dim uppercase tracking-wide">
              {k === 'comp_notes' ? 'Composition' : k === 'kit_notes' ? 'Kit' : 'Tactics'}
            </div>
            <div className="text-xs text-text whitespace-pre-wrap leading-5">{c[k]}</div>
          </div>
        ))}

        {resolved.length > 0 && (
          <div className="mb-1">
            <div className="text-[10px] text-dim uppercase tracking-wide mb-1">Callouts (live from guild triggers)</div>
            <ul className="text-xs space-y-0.5">
              {resolved.map(r => (
                <li key={r.id} className="flex items-baseline gap-2 flex-wrap">
                  {r.state === 'armed' && <span className="text-green" title="Enabled — the fleet is polling this">✓ armed</span>}
                  {r.state === 'denoted' && <span className="text-dim" title="Exists but disabled on purpose — enabling is one toggle">○ denoted</span>}
                  {r.state === 'missing' && <span className="text-red font-semibold" title="This id no longer resolves to a trigger — the card promises a callout that cannot fire">⚠ MISSING</span>}
                  <span className={r.state === 'missing' ? 'text-red font-mono text-[10px]' : 'text-text'}>{r.name}</span>
                  {r.timerSec != null && <span className="text-dim">timer {r.timerSec}s</span>}
                  {r.warningSec != null && r.warningText && <span className="text-dim">&quot;{r.warningText}&quot; at T−{r.warningSec}s</span>}
                  {r.tts && <span className="text-dim">says &quot;{r.tts}&quot;</span>}
                  {r.cooldownSec != null && r.cooldownSec > 0 && <span className="text-dim/70">cd {r.cooldownSec}s</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {officer && (
          <details className="mt-2 pt-2 border-t border-border/50">
            <summary className="cursor-pointer text-[11px] text-dim hover:text-text">edit card</summary>
            <form action={updateFightCard} className="mt-2 space-y-2">
              <input type="hidden" name="id" value={c.id} />
              <CardFields c={c} />
              <div className="flex items-center gap-3">
                <label className="text-xs text-dim flex items-center gap-1">
                  <input type="checkbox" name="active" defaultChecked={c.active} /> active
                </label>
                <button type="submit" className="px-2 py-1 rounded text-xs border border-blue/50 text-blue hover:bg-bg">Save</button>
              </div>
            </form>
            <form action={deleteFightCard} className="mt-1">
              <input type="hidden" name="id" value={c.id} />
              <button type="submit" className="text-[11px] text-red/70 hover:text-red underline decoration-dotted">delete card</button>
            </form>
          </details>
        )}
      </section>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl text-gold">Fight cards</h2>
        <p className="text-xs text-dim mt-1 leading-5 max-w-3xl">
          The pre-raid checklist, one card per fight: the composition it needs, the kit to bring,
          the tactics that keep us from wasting time and wiping — and the callouts, read live from
          the guild trigger list so &quot;armed&quot; means armed right now, not when the card was written.
        </p>
      </div>

      {cards.length === 0 && (
        <div className="bg-panel border border-border rounded-lg p-4 text-sm text-dim italic">
          No fight cards yet{officer ? ' — add the first one below.' : '.'}
        </div>
      )}
      {cards.map(renderCard)}

      {officer && inactive.length > 0 && (
        <details className="bg-panel border border-border/50 rounded-lg p-4">
          <summary className="cursor-pointer text-xs text-dim">
            {inactive.length} inactive card{inactive.length === 1 ? '' : 's'} (hidden from members)
          </summary>
          <div className="mt-3 space-y-4">{orderCards(inactive).map(renderCard)}</div>
        </details>
      )}

      {officer && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h3 className="text-sm text-blue mb-2">New fight card</h3>
          <form action={createFightCard} className="space-y-2">
            <CardFields />
            <button type="submit" className="px-2 py-1 rounded text-xs border border-blue/50 text-blue hover:bg-bg">Create</button>
          </form>
        </section>
      )}
    </div>
  );
}
