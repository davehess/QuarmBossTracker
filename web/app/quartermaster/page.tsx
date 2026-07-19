// /quartermaster — #82 Quartermaster v1. Member-visible guild logistics, two boards:
//
//   Board 1 — utility-kit coverage: who owns the items that keep a raid moving
//     (charm, cures, resist buffs, emergency survival, mana, travel, invis,
//     haste). Read from character_gear × eqemu_items, extending the raidKit
//     idiom. VISIBLE ownership only — the bank is stripped before upload — so a
//     blank means "not seen", not "doesn't exist".
//   Board 2 — common-quest checklist: the guild's recurring chains from the
//     officer-authored quest_catalog + quest_required_item, checked off against
//     each character's VISIBLE inventory (character_inventory). Your own
//     characters up top; officers also get a whole-roster "who's missing what"
//     rollup. A turned-in / banked piece reads as "not seen" (visible bags only).
//
// GUILD scope, standard auth gate. exclude_inventory / exclude_from_stats
// characters never appear on either board.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';
import { ownedCharacters } from '@/lib/ownedCharacters';
import {
  KIT_CATALOG, KIT_ITEM_IDS, KIT_CATEGORY_LABEL, computeKitCoverage,
  ownedFromRows, computeQuestProgress,
  type KitOwnerRow, type KitCoverage, type KitCategory,
  type QuestDef, type QuestProgress, type OwnedItems,
} from '@/lib/quartermaster';

export const dynamic = 'force-dynamic';

// Same membership predicate the attendance + readiness pages use (Raid Alts are
// DKP placeholders, not people in a slot).
const ROSTER_RANKS = new Set(['Raid Pack', 'Officer', 'Pack Leader', 'Recruit']);

type CharRow = {
  name: string; class: string | null; rank: string | null;
  main_name: string | null; main_name_override: string | null;
  exclude_from_stats: boolean | null; exclude_inventory: boolean | null;
};
const mainOf = (c: CharRow) => (c.main_name_override && c.main_name_override.trim())
  || (c.main_name && c.main_name.trim()) || c.name;
const excluded = (c: CharRow) => !!c.exclude_from_stats || !!c.exclude_inventory;

type Loaded = {
  coverage: KitCoverage[];
  quests: QuestDef[];
  myChars: { name: string; main: string; className: string | null; hasInv: boolean; progress: QuestProgress[] }[];
  officer: null | {
    quest: QuestDef;
    assessed: number;              // roster raiders with inventory we could check
    complete: string[];            // characters complete
    missing: string[];             // characters not complete (partial or none)
  }[];
};

async function load(userId: string, officer: boolean): Promise<Loaded> {
  const sb = supabaseAdmin();

  const { data: charData } = await sb
    .from('characters')
    .select('name, class, rank, main_name, main_name_override, exclude_from_stats, exclude_inventory')
    .eq('guild_id', 'wolfpack');
  const chars = (charData ?? []) as CharRow[];
  const charByLower = new Map(chars.map(c => [c.name.toLowerCase(), c]));

  // ── Board 1 — kit coverage (gear rows for exactly the catalog ids) ──────────
  const { data: gearData } = await sb
    .from('character_gear')
    .select('character, item_id')
    .in('item_id', KIT_ITEM_IDS)
    .in('loc', ['equipped', 'bag'])
    .limit(20000);
  const kitRows: KitOwnerRow[] = [];
  for (const g of (gearData ?? []) as { character: string; item_id: number }[]) {
    const c = charByLower.get(g.character.toLowerCase());
    if (!c || excluded(c)) continue;
    kitRows.push({ itemId: g.item_id, character: c.name, main: mainOf(c), className: c.class });
  }
  const coverage = computeKitCoverage(KIT_CATALOG, kitRows);

  // ── Board 2 — quest defs from the officer-authored catalog ──────────────────
  const [{ data: qData }, { data: riData }] = await Promise.all([
    sb.from('quest_catalog')
      .select('id, name, category, display_order')
      .eq('guild_id', 'wolfpack').eq('active', true).order('display_order'),
    sb.from('quest_required_item')
      .select('quest_id, item_id, item_name, quantity, optional, display_order')
      .order('display_order'),
  ]);
  const riByQuest = new Map<number, { item_id: number | null; item_name: string; quantity: number | null; optional: boolean | null }[]>();
  for (const r of (riData ?? []) as { quest_id: number; item_id: number | null; item_name: string; quantity: number | null; optional: boolean | null }[]) {
    (riByQuest.get(r.quest_id) ?? riByQuest.set(r.quest_id, []).get(r.quest_id)!).push(r);
  }
  const quests: QuestDef[] = ((qData ?? []) as { id: number; name: string; category: string | null }[]).map(q => ({
    id: q.id,
    name: q.name,
    category: q.category,
    steps: (riByQuest.get(q.id) ?? []).map(r => ({
      label: (r.quantity && r.quantity > 1 ? `${r.quantity}× ` : '') + r.item_name,
      itemId: r.item_id,
      itemName: r.item_name,
      quantity: r.quantity ?? 1,
      optional: !!r.optional,
    })),
  }));

  // ── Inventory (once, for my chars ∪ roster raiders when officer) ────────────
  const owned = await ownedCharacters(userId);
  const myCharRows = owned
    .map(oc => charByLower.get(oc.name.toLowerCase()))
    .filter((c): c is CharRow => !!c && !excluded(c));
  const rosterRows = officer
    ? chars.filter(c => c.rank && ROSTER_RANKS.has(c.rank) && !excluded(c))
    : [];

  const invNames = [...new Set([...myCharRows, ...rosterRows].map(c => c.name))];
  const invByChar = new Map<string, OwnedItems>();
  if (invNames.length) {
    const rowsByChar = new Map<string, { item_id: number | null; item_name: string | null; quantity: number | null }[]>();
    const { data: invData } = await sb
      .from('character_inventory')
      .select('character_name, item_id, item_name, quantity')
      .eq('guild_id', 'wolfpack')
      .in('character_name', invNames)
      .limit(50000);
    for (const r of (invData ?? []) as { character_name: string; item_id: number | null; item_name: string | null; quantity: number | null }[]) {
      const k = r.character_name.toLowerCase();
      (rowsByChar.get(k) ?? rowsByChar.set(k, []).get(k)!).push(r);
    }
    for (const [k, rows] of rowsByChar) invByChar.set(k, ownedFromRows(rows));
  }

  const myChars = myCharRows
    .map(c => {
      const owned = invByChar.get(c.name.toLowerCase());
      return {
        name: c.name,
        main: mainOf(c),
        className: c.class,
        hasInv: !!owned,
        progress: quests.map(q => computeQuestProgress(q, owned ?? { byId: new Map(), names: new Map() })),
      };
    })
    .sort((a, b) => a.main.localeCompare(b.main) || a.name.localeCompare(b.name));

  const officerRollup = officer ? quests.map(q => {
    const complete: string[] = [];
    const missing: string[] = [];
    let assessed = 0;
    for (const c of rosterRows) {
      const owned = invByChar.get(c.name.toLowerCase());
      if (!owned) continue;                 // no inventory upload → can't assess
      assessed++;
      const p = computeQuestProgress(q, owned);
      (p.complete ? complete : missing).push(c.name);
    }
    return { quest: q, assessed, complete: complete.sort(), missing: missing.sort() };
  }) : null;

  return { coverage, quests, myChars, officer: officerRollup };
}

export default async function QuartermasterPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/quartermaster');
  const officer = await isOfficer(user.id);
  const { coverage, quests, myChars, officer: rollup } = await load(user.id, officer);

  // Group Board 1 by category for a scannable layout.
  const byCat = new Map<KitCategory, KitCoverage[]>();
  for (const c of coverage) (byCat.get(c.entry.category) ?? byCat.set(c.entry.category, []).get(c.entry.category)!).push(c);
  const gaps = coverage.filter(c => c.gap);

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold mb-1">🧰 Quartermaster</h2>
        <p className="text-sm text-dim leading-6">
          Guild logistics at a glance — <b>who owns the utility items that keep a raid moving</b>, and
          <b> how far along the recurring quest chains</b> each character is. So &quot;does anyone have X?&quot;
          stops being a <code>/gu</code> question. Everything here is <b>visible ownership only</b>: the
          bank and shared bank are stripped on each member&apos;s machine before anything uploads, so a blank
          means <i>we can&apos;t see it</i>, not that nobody has it. Characters opted out of inventory/stats
          tracking never appear.
        </p>
      </section>

      {/* ── Board 1 — utility-kit coverage ─────────────────────────────────── */}
      <section className="bg-panel border border-border rounded-lg p-5 space-y-4">
        <div>
          <h3 className="text-lg text-orange">🎒 Utility-kit coverage</h3>
          <p className="text-xs text-dim leading-5">
            Trackable raid movers, from worn + bag gear. Each shows how many raiders own it and who — click a
            name for their page. {gaps.length > 0
              ? <>Right now <span className="text-orange font-semibold">{gaps.length}</span> {gaps.length === 1 ? 'entry has' : 'entries have'} a coverage gap (below).</>
              : <span className="text-green">No coverage gaps right now.</span>}
          </p>
        </div>

        {gaps.length > 0 && (
          <div className="bg-bg border border-orange/40 rounded p-3">
            <div className="text-xs uppercase tracking-wide text-orange mb-1">Coverage gaps</div>
            <ul className="text-sm space-y-0.5">
              {gaps.map(c => <li key={c.entry.key} className="text-orange">• {c.gap}</li>)}
            </ul>
          </div>
        )}

        {[...byCat.entries()].map(([cat, entries]) => (
          <div key={cat}>
            <div className="text-xs uppercase tracking-wide text-dim mb-2">{KIT_CATEGORY_LABEL[cat]}</div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {entries.map(c => <KitCard key={c.entry.key} cov={c} />)}
            </div>
          </div>
        ))}
      </section>

      {/* ── Board 2 — common-quest checklist ───────────────────────────────── */}
      <section className="bg-panel border border-border rounded-lg p-5 space-y-4">
        <div>
          <h3 className="text-lg text-orange">🗝️ Common-quest checklist</h3>
          <p className="text-xs text-dim leading-5">
            The guild&apos;s recurring chains (keys, shards, turn-ins), officer-managed in{' '}
            <Link href="/admin/quests" className="text-blue hover:underline">the quest catalog</Link>, checked off
            against each character&apos;s <b>visible inventory</b>. A step you&apos;ve already turned in or stashed in
            the bank reads as <i>not seen</i> — visible bags only. Steps with nothing to detect show as
            <span className="text-dim"> —</span> (officer/manual — no manual check-off UI yet).
          </p>
        </div>

        {quests.length === 0 ? (
          <p className="text-sm text-dim">No active quests in the catalog yet. Officers add them in <Link href="/admin/quests" className="text-blue hover:underline">/admin/quests</Link>.</p>
        ) : (
          <>
            <div>
              <div className="text-sm text-text mb-2">Your characters</div>
              {myChars.length === 0 ? (
                <p className="text-xs text-dim">
                  No characters linked to your account yet (or all opted out). Link them on{' '}
                  <Link href="/me" className="text-blue hover:underline">/me</Link> and generate an inventory export in game.
                </p>
              ) : (
                <MyProgressTable quests={quests} chars={myChars} />
              )}
            </div>

            {rollup && (
              <div className="pt-2 border-t border-border">
                <div className="text-sm text-gold mb-1 flex items-center gap-2">
                  🛡 Officer rollup — who&apos;s missing what
                  <span className="text-[10px] tracking-widest font-bold px-2 py-0.5 rounded bg-blue/20 border border-blue/60 text-blue uppercase">Officers</span>
                </div>
                <p className="text-[11px] text-dim mb-2">
                  Roster raiders with an inventory upload we can read. &quot;Missing&quot; = not detected as complete
                  in visible bags (may already be turned in). Raiders with no inventory upload aren&apos;t counted.
                </p>
                <OfficerRollup rollup={rollup} />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function KitCard({ cov }: { cov: KitCoverage }) {
  const shown = cov.owners.slice(0, 30);
  const more = cov.owners.length - shown.length;
  return (
    <div className="bg-bg border border-border rounded p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm text-text">{cov.entry.label}</div>
        <div className={`text-xs font-mono ${cov.ownerCount === 0 ? 'text-orange' : 'text-green'}`}>{cov.ownerCount} {cov.ownerCount === 1 ? 'owner' : 'owners'}</div>
      </div>
      <div className="text-[11px] text-dim mb-1">{cov.entry.grants}</div>
      {cov.gap && <div className="text-[11px] text-orange mb-1">⚠ {cov.gap}</div>}
      {cov.owners.length > 0 && (
        <div className="text-[11px] leading-5">
          {shown.map((o, i) => (
            <span key={o.character}>
              <Link href={`/character/${encodeURIComponent(o.character)}`} className="text-blue hover:underline">{o.character}</Link>
              {o.main !== o.character && <span className="text-dim"> ({o.main})</span>}
              {i < shown.length - 1 ? <span className="text-dim">, </span> : null}
            </span>
          ))}
          {more > 0 && <span className="text-dim"> +{more} more</span>}
        </div>
      )}
    </div>
  );
}

function statusCell(p: QuestProgress) {
  if (!p.quest.steps.length) return <span className="text-dim">—</span>;
  if (p.detectable === 0) return <span className="text-dim" title="nothing to auto-detect on this quest">—</span>;
  if (p.complete) return <span className="text-green" title="all visible steps present">✓</span>;
  const cls = p.have === 0 ? 'text-dim' : 'text-orange';
  return <span className={cls} title={`${p.have} of ${p.detectable} visible steps`}>{p.have}/{p.detectable}</span>;
}

function MyProgressTable({
  quests, chars,
}: {
  quests: QuestDef[];
  chars: { name: string; main: string; className: string | null; hasInv: boolean; progress: QuestProgress[] }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <thead className="text-dim uppercase">
          <tr className="border-b border-border">
            <th className="text-left px-3 py-2 font-normal">Quest</th>
            {chars.map(c => (
              <th key={c.name} className="text-center px-3 py-2 font-normal whitespace-nowrap">
                <Link href={`/character/${encodeURIComponent(c.name)}/quests`} className="text-blue hover:underline">{c.name}</Link>
                {!c.hasInv && <div className="text-[9px] text-dim normal-case">no inv yet</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {quests.map((q, qi) => (
            <tr key={q.id} className="border-b border-border/40 hover:bg-[#1a212c]">
              <td className="px-3 py-1.5 text-text">{q.name}</td>
              {chars.map(c => (
                <td key={c.name} className="px-3 py-1.5 text-center font-mono">
                  {c.hasInv ? statusCell(c.progress[qi]) : <span className="text-dim">·</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OfficerRollup({
  rollup,
}: {
  rollup: { quest: QuestDef; assessed: number; complete: string[]; missing: string[] }[];
}) {
  return (
    <div className="space-y-2">
      {rollup.map(r => (
        <div key={r.quest.id} className="bg-bg border border-border rounded p-3">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-sm text-text">{r.quest.name}</div>
            <div className="text-xs font-mono text-dim">
              <span className="text-green">{r.complete.length}</span> / {r.assessed} have it
            </div>
          </div>
          {r.assessed === 0 ? (
            <div className="text-[11px] text-dim mt-1">No roster raiders have an inventory upload to check yet.</div>
          ) : r.missing.length === 0 ? (
            <div className="text-[11px] text-green mt-1">Everyone assessed has it.</div>
          ) : (
            <div className="text-[11px] text-dim mt-1">
              <span className="text-orange">Missing ({r.missing.length}):</span>{' '}
              {r.missing.slice(0, 40).map((n, i) => (
                <span key={n}>
                  <Link href={`/character/${encodeURIComponent(n)}/quests`} className="text-blue hover:underline">{n}</Link>
                  {i < Math.min(r.missing.length, 40) - 1 ? ', ' : ''}
                </span>
              ))}
              {r.missing.length > 40 && <span> +{r.missing.length - 40} more</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
