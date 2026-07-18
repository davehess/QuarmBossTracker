// /admin/comp — officer editor for raid composition templates (#93).
//
// Named archetype-group targets stored as a jsonb array in comp_templates (one
// row per guild; overlay_tuning pattern). The editor is a validated JSON
// textarea + live rendered preview (CompEditor). The planned-vs-actual matcher
// on /admin/signups reads a template by name and diffs it against signups.

import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { ARCHETYPES } from '@/lib/comp';
import CompEditor from './CompEditor';

export const dynamic = 'force-dynamic';

// Shown when the guild has never saved a template — a runnable starting point,
// not a mandate. Deliberately small; officers grow it in the textarea.
const STARTER = [
  {
    name: 'Standard 60-man',
    groups: [
      { name: 'Main Tank', requires: [
        { class: 'Warrior', count: 1 },
        { class: 'Cleric', count: 3 },
        { archetype: 'support', count: 1 },
      ] },
      { name: 'Off Tank', requires: [
        { archetype: 'tank', count: 1 },
        { class: 'Cleric', count: 2 },
        { archetype: 'support', count: 1 },
      ] },
      { name: 'Melee', requires: [{ archetype: 'melee', count: 6 }] },
      { name: 'Casters', requires: [{ archetype: 'ranged', count: 6 }] },
    ],
    minimums: [
      { archetype: 'healer', count: 8 },
      { archetype: 'support', count: 4 },
    ],
  },
];

export default async function AdminCompPage() {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from('comp_templates')
    .select('templates, updated_by_name, updated_at')
    .eq('guild_id', 'wolfpack')
    .maybeSingle();

  const templates = Array.isArray(data?.templates) ? data!.templates : [];
  const initialJson = JSON.stringify(templates.length ? templates : STARTER, null, 2);
  const seeded = templates.length === 0;

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/admin" className="text-blue hover:underline">← back to admin</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">🧩 Raid comp templates</h2>
        <p className="text-sm text-dim leading-6">
          Named target compositions the <Link href="/admin/signups" className="text-blue hover:underline">sign-ups matcher</Link> checks
          a raid against — role/archetype gap deltas at pull time (&quot;need 1 more cleric-archetype healer&quot;).
          Each template is groups of slots; a slot names either a specific <code>class</code> or an
          <code> archetype</code> ({ARCHETYPES.join(' / ')}) and a <code>count</code>. Optional raid-wide
          <code> minimums</code> act as FLOORS (they raise a requirement, they don&apos;t add bodies to the headcount).
          Edits validate as you type; Save writes the whole set.
          {data?.updated_by_name
            ? <> Last saved by <span className="text-text">{data.updated_by_name}</span> · {new Date(data.updated_at).toLocaleString()}.</>
            : <> Never saved — the box below is a starter you can edit.</>}
        </p>
        {seeded && (
          <p className="text-xs text-orange mt-2">
            No templates saved yet — showing a starter &quot;Standard 60-man&quot;. Nothing is stored until you Save.
          </p>
        )}
      </section>

      <section className="bg-panel border border-border rounded-lg p-5">
        <CompEditor initialJson={initialJson} />
      </section>

      <section className="bg-panel border border-border rounded-lg p-4 text-xs text-dim leading-5">
        <div className="font-semibold text-text mb-1">Shape</div>
        <pre className="bg-bg border border-border rounded p-3 overflow-x-auto whitespace-pre text-text">{`[
  {
    "name": "Standard 60-man",
    "groups": [
      { "name": "Main Tank", "requires": [
        { "class": "Warrior", "count": 1 },
        { "class": "Cleric", "count": 3 },
        { "archetype": "support", "count": 1 }
      ] }
    ],
    "minimums": [ { "archetype": "healer", "count": 8 } ]
  }
]`}</pre>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>A <b>class</b> slot counts toward both that class AND its archetype (a Warrior need is also a tank need).</li>
          <li><b>archetype</b> ∈ {ARCHETYPES.join(' / ')}. tank = war/pal/sk · healer = clr/dru/shm · support = enc/brd · melee = mnk/rog/rng/bst · ranged = wiz/mag/nec.</li>
          <li><b>minimums</b> raise a requirement to at least that number without adding to the group headcount total.</li>
        </ul>
      </section>
    </div>
  );
}
