// /db/spell/[id] — wpqdi spell detail (guild-gated). eqemu_spells is minimal
// (no per-class scribe levels — see the catalog cheat-sheet), so we show the
// effects (best-effort decode), resist/target, duration, the identifying cast
// messages, and a cross-link to the spell's scroll item (→ /db/item) when one
// exists. Clicky/proc reverse-lookup ("granted by which items") is a v2 add.

import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import {
  type SpellRow, decodeSpellEffects, fmtDuration, fmtSeconds, RESIST_NAME, TARGET_NAME,
} from '@/lib/spellDecode';

export const dynamic = 'force-dynamic';

const SPELL_COLS =
  'id, name, mana, buffduration, buffdurationformula, targettype, skill,' +
  ' effect_id_1, effect_base_value_1, effect_id_2, effect_base_value_2,' +
  ' effect_id_3, effect_base_value_3, cast_time, recast_time, resist_type,' +
  ' resist_diff, good_effect, cast_on_you, cast_on_other, spell_fades, raw';

export default async function DbSpellPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const spellId = Number(id);
  if (!Number.isInteger(spellId) || spellId <= 0) notFound();

  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/db/spell/${spellId}`);

  const sb = supabaseAdmin();
  const { data: spellData } = await sb.from('eqemu_spells').select(SPELL_COLS).eq('id', spellId).maybeSingle();
  const spell = spellData as SpellRow | null;
  if (!spell) notFound();

  // Cross-link to the scroll item (Spell: <name>), if the catalog has one.
  let scrollItemId: number | null = null;
  if (spell.name) {
    const { data: scroll } = await sb.from('eqemu_items')
      .select('id').ilike('name', `Spell: ${spell.name}`).limit(1).maybeSingle();
    scrollItemId = (scroll as { id: number } | null)?.id ?? null;
  }

  const effects = decodeSpellEffects(spell);
  const good = spell.good_effect === 1;
  const target = spell.targettype != null ? (TARGET_NAME[spell.targettype] ?? `type ${spell.targettype}`) : null;
  const resist = spell.resist_type != null ? (RESIST_NAME[spell.resist_type] ?? `type ${spell.resist_type}`) : null;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="text-sm text-dim">
        <Link href="/search" className="text-blue hover:underline">← search</Link>
        <span className="mx-2">·</span>
        <span className="text-dim/70">wpqdi · spell #{spellId}</span>
      </div>

      <section className="bg-panel border border-border rounded-lg p-4">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h1 className="text-xl text-gold">{spell.name}</h1>
          <span className={`text-[10px] uppercase tracking-wider ${good ? 'text-green' : 'text-red-400'}`}>
            {good ? 'beneficial' : 'detrimental'}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm">
          {target && <Stat k="Target">{target}</Stat>}
          {resist && <Stat k="Resist">{resist}{spell.resist_diff ? ` (${spell.resist_diff > 0 ? '+' : ''}${spell.resist_diff})` : ''}</Stat>}
          {spell.mana != null && spell.mana > 0 && <Stat k="Mana">{spell.mana}</Stat>}
          <Stat k="Cast">{fmtSeconds(spell.cast_time)}</Stat>
          {spell.recast_time != null && spell.recast_time > 0 && <Stat k="Recast">{fmtSeconds(spell.recast_time)}</Stat>}
          <Stat k="Duration">{fmtDuration(spell.buffduration)}</Stat>
        </div>
        <div className="mt-3 text-[11px] flex flex-wrap gap-3">
          <a href={`https://www.pqdi.cc/spell/${spellId}`} target="_blank" rel="noreferrer" className="text-blue hover:underline">View on PQDI ↗</a>
          {scrollItemId != null && (
            <Link href={`/db/item/${scrollItemId}`} className="text-blue hover:underline">Scroll item →</Link>
          )}
        </div>
      </section>

      {/* Effects */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h2 className="text-sm text-orange mb-2">Effects</h2>
        {effects.length ? (
          <ul className="text-sm space-y-1">
            {effects.map((e, i) => <li key={i} className="text-text">• {e}</li>)}
          </ul>
        ) : <p className="text-dim text-xs">No decodable effect slots.</p>}
        <p className="text-dim/60 text-[10px] mt-2">Effects are decoded best-effort from the catalog; unlabeled slots show the raw SPA id.</p>
      </section>

      {/* Identifying messages */}
      {(spell.cast_on_you || spell.cast_on_other || spell.spell_fades) && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-orange mb-2">Log messages</h2>
          <div className="grid grid-cols-1 gap-1 text-sm">
            {spell.cast_on_you && <Msg k="On you">{spell.cast_on_you}</Msg>}
            {spell.cast_on_other && <Msg k="On other">&lt;name&gt; {spell.cast_on_other}</Msg>}
            {spell.spell_fades && <Msg k="Fades">{spell.spell_fades}</Msg>}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-dim text-[10px] uppercase tracking-wide">{k}</span>
      <span className="text-right text-text">{children}</span>
    </div>
  );
}
function Msg({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-dim text-[10px] uppercase tracking-wide w-16 shrink-0">{k}</span>
      <span className="text-text/90 italic">{children}</span>
    </div>
  );
}
