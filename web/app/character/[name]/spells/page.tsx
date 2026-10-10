// /character/[name]/spells — per-character spell exchange.
//
// What it answers: "which vendor-buyable spells for this class hasn't this
// character scribed yet, and is a guildmate already holding the scroll?"
// PQDI's Missing Spells parser inspired this; the guild-holdings overlay is
// the part PQDI can't do (the guild lead, 2026-06-23).
//
// Data path (see migration 20260624020000_spell_exchange.sql):
//   • character_spellbook — uploaded on /me (📖 Upload spellbook).
//   • character_missing_spells(guild, character, class_bit) RPC — purchasable
//     scrolls for the class minus what's scribed, + derived level + holders.
//   • spell_scroll_sources(int[]) RPC — every vendor + dropper per scroll,
//     zones resolved through the spawn tables (we DO mirror the merchant→
//     NPC→zone chain since 2026-08-18; the old PQDI deep-links are now the
//     cross-check, not the answer). Rendering + the zone-by-zone 🛒 shopping
//     mode live in MissingSpellsView (client); grouping in lib/spellSources.
//
// Visibility mirrors the inventory page: owner + officers always; others need
// characters.show_inventory_publicly (the /me "Inventory page" switch — the
// quests page has had its own switch since 2026-09-25).

import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';
import { classBit, normalizeClass } from '@/lib/class-titles';
import { groupSources, vendorSpots, type ItemSources, type VendorSpots } from '@/lib/spellSources';
import { fetchScrollSources } from '@/lib/capSafeReads';
import MissingSpellsView from './MissingSpellsView';
import { poolTierByName, type PoolRow } from '@/lib/popSpells';
import { GUILD_TAG } from '@/lib/guild';

import type { Metadata } from 'next';
import { characterMeta } from '@/lib/pageMeta';

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  const { name } = await params;
  const { title, description } = characterMeta(name, 'spells');
  return { title, description };
}

export const dynamic = 'force-dynamic';

type MissingSpell = {
  spell_name: string;
  scroll_item_id: number | null;
  spell_id: number | null;
  scribe_level: number | null;
  held_by: string[];
  buyable: boolean;
  // PoP = only obtainable from Planes of Power sources (sold only in PoK or
  // dropped in a PoP zone) or scribe level 61+. Called out separately because
  // those scrolls come from different places (live since 2026-10-01).
  pop: boolean;
};

export default async function CharacterSpellsPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  if (!/^[A-Za-z]{2,}$/.test(decoded)) notFound();

  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/character/${encodeURIComponent(name)}/spells`);

  const sb = supabaseAdmin();
  const { data: charRows } = await sb
    .from('characters')
    .select('name, class, discord_id, show_inventory_publicly')
    .eq('guild_id', GUILD_TAG)
    .ilike('name', decoded)
    .limit(1);
  const char = (charRows && charRows[0]) as
    | { name: string; class: string | null; discord_id: string | null; show_inventory_publicly: boolean }
    | undefined;
  if (!char) notFound();

  // Visibility gate (same as quests).
  const officer = await isOfficer(user.id);
  let isOwner = false;
  if (char.discord_id) {
    const { data: me } = await sb.from('wolfpack_members')
      .select('discord_id').eq('user_id', user.id).maybeSingle();
    isOwner = !!me?.discord_id && me.discord_id === char.discord_id;
  }
  if (!officer && !isOwner && !char.show_inventory_publicly) {
    return (
      <div className="space-y-4">
        <div className="text-sm"><Link href={`/character/${encodeURIComponent(decoded)}`} className="text-blue hover:underline">← back to {decoded}</Link></div>
        <section className="bg-panel border border-border rounded-lg p-6">
          <h2 className="text-xl text-gold">🔒 Private</h2>
          <p className="text-sm text-dim mt-2">
            {decoded} hasn&apos;t made their inventory and spellbook public yet. Only
            the owner (and officers) can see this page.
          </p>
        </section>
      </div>
    );
  }

  const bit = classBit(char.class);
  const baseClass = normalizeClass(char.class);

  // Quest-script parchment pools for this class (pop_parchment_pools view) —
  // drives the "PoP · <parchment>" badges from what the trainer actually
  // awards, not from spell levels (Lacunanight, 2026-08-25).
  const { data: poolRows } = await sb
    .from('pop_parchment_pools')
    .select('class_name, tier, scroll_item_id, spell_name');
  const popTiers = poolTierByName((poolRows ?? []) as PoolRow[], char.class);

  // Scribed count (for the header summary).
  const { count: scribedCount } = await sb
    .from('character_spellbook')
    .select('id', { count: 'exact', head: true })
    .eq('guild_id', GUILD_TAG)
    .ilike('character_name', decoded);

  let missing: MissingSpell[] = [];
  let rpcError: string | null = null;
  if (bit > 0) {
    const { data, error } = await sb.rpc('character_missing_spells', {
      p_guild_id: GUILD_TAG, p_character: decoded, p_class_bit: bit,
    });
    if (error) rpcError = error.message;
    else missing = (data ?? []) as MissingSpell[];
  }

  const hasBook = (scribedCount ?? 0) > 0;

  // Where-from sources for every missing scroll, one RPC. Failure here only
  // costs the dropdown detail — the list itself must still render.
  let sourcesByItem: Record<number, ItemSources> = {};
  const scrollIds = [...new Set(missing.map(m => m.scroll_item_id).filter((n): n is number => typeof n === 'number'))];
  if (scrollIds.length) {
    // spell_scroll_sources is a set-returning function with no ORDER BY, and one
    // spellbook is up to 4,632 rows — 40 of 117 spellbook characters are over
    // PostgREST's 1,000-row response cap. The _json variant returns the same
    // rows as ONE jsonb array, which the cap does not touch.
    const srcRows = await fetchScrollSources(sb, scrollIds);
    if (srcRows.length) {
      sourcesByItem = Object.fromEntries(groupSources(srcRows).entries());
    }
  }

  // Where each vendor stands, for the 📍 /map Y X copy (the guild lead, 2026-09-28).
  // Vendors only: across every spell scroll no vendor has more than 3 spawn
  // points (463 in all, measured 2026-09-28), so both reads stay under the
  // cap. A dropper can have 100+ points; its name links to its NPC page instead.
  let spots: VendorSpots = {};
  const vendorIds = [...new Set(Object.values(sourcesByItem)
    .flatMap(s => s.merchants.map(v => v.npcId))
    .filter((n): n is number => typeof n === 'number'))];
  if (vendorIds.length) {
    const { data: entries } = await sb.from('eqemu_spawnentry')
      .select('npc_id, spawngroup_id').in('npc_id', vendorIds).limit(1000);
    const groups = [...new Set((entries ?? []).map(e => e.spawngroup_id as number))];
    if (groups.length) {
      const { data: points } = await sb.from('eqemu_spawn2')
        .select('id, spawngroup_id, zone_short, x, y').in('spawngroup_id', groups).limit(1000);
      spots = vendorSpots(entries ?? [], points ?? []);
    }
  }

  const heldCount = missing.filter(m => m.held_by.length > 0).length;
  const buyableCount = missing.filter(m => m.buyable).length;
  const otherCount = missing.length - buyableCount;
  const popCount = missing.filter(m => m.pop).length;

  return (
    <div className="space-y-6">
      <div className="text-sm flex gap-4">
        <Link href={`/character/${encodeURIComponent(decoded)}`} className="text-blue hover:underline">← back to {decoded}</Link>
        <Link href={`/character/${encodeURIComponent(decoded)}/quests`} className="text-blue hover:underline">quests →</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold flex items-center gap-3 mb-1">
          📖 {decoded} — Missing spells
          <span className="text-[10px] tracking-widest font-bold px-2 py-0.5 rounded bg-orange/20 border border-orange/60 text-orange uppercase">Beta</span>
        </h2>
        <p className="text-sm text-dim leading-6">
          Every {baseClass ?? 'class'} spell {decoded} hasn&apos;t scribed yet —
          both vendor-buyable ones and the quest/drop/planar spells you have to
          go get. <span className="text-orange">🛒</span> = sold by a vendor;{' '}
          <span className="text-purple">⚔</span> = not sold, acquire it in the world.
          <b> Click any spell</b> to see exactly who sells or drops it and where —
          or flip to <b>🛒 Shopping list</b> to plan zone by zone.{' '}
          <span className="text-green">🎒</span> = a guildmate is holding the
          scroll right now — ask them first.{' '}
          <span className="text-[10px] font-bold px-1 py-0.5 rounded bg-blue/20 border border-blue/60 text-blue align-middle">PoP</span>{' '}
          = Planes of Power (level 61+, or only sold in PoK / dropped in a PoP
          zone). Levels come from guild spellbooks, so a few may be blank until
          someone uploads.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-dim">
          <span>Class: <span className="text-text">{baseClass ?? '—'}</span></span>
          <span>Scribed: <span className="text-text">{scribedCount ?? 0}</span></span>
          <span>Missing: <span className="text-text">{missing.length}</span></span>
          <span>🛒 Buyable: <span className="text-orange">{buyableCount}</span></span>
          <span>⚔ Go get: <span className="text-purple">{otherCount}</span></span>
          <span>🎒 Held by a guildmate: <span className="text-green">{heldCount}</span></span>
          <span>PoP: <span className="text-blue">{popCount}</span></span>
        </div>
        {!hasBook && (
          <p className="text-xs text-orange mt-3">
            ⚠ No spellbook uploaded for {decoded} yet, so this is the full class
            spell list. Paste the in-game spellbook via 📖 on{' '}
            <Link href="/me" className="text-blue hover:underline">/me</Link> to
            filter to what they still need.
          </p>
        )}
        {bit === 0 && (
          <p className="text-xs text-red mt-3">
            ⚠ {decoded} has no recognized caster class on record
            ({char.class ?? 'unknown'}), so there&apos;s no spell list to diff.
          </p>
        )}
        {rpcError && <p className="text-xs text-red mt-3">⚠ {rpcError}</p>}
      </section>

      {bit > 0 && (
        <section className="bg-panel border border-border rounded-lg p-5">
          {missing.length === 0 ? (
            <p className="text-sm text-dim italic">
              {hasBook ? `🎉 ${decoded} has every vendor-buyable spell for the class.` : 'No purchasable spells found for this class.'}
            </p>
          ) : (
            <MissingSpellsView
              missing={missing}
              sources={sourcesByItem}
              spots={spots}
              officer={officer}
              character={decoded}
              popTiers={popTiers}
            />
          )}
        </section>
      )}
    </div>
  );
}
