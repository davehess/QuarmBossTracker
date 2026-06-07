// /bards/sets/[id] — full details view for a single contributed bard
// rotation. Lays out every phase + button + clicky with the same
// schema the Mimic UI Studio preview panel uses, but in a wide
// shareable web layout.

import { promises as fs } from 'fs';
import path from 'path';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-static';
export const revalidate = 3600;

type Button = {
  slot?: number;
  label?: string;
  color?: number;
  lines?: string[];
  notes?: string;
};
type Phase = {
  name: string;
  page?: number;
  page_label?: string;
  buttons?: Button[];
};
type Clicky = {
  slot: string;
  item?: string;
  tier?: string;
  required?: boolean;
  provides?: string;
  alternatives?: string[];
  notes?: string;
};
type SpellSet = { name: string; spells?: string[] };
type Potion   = { name: string; use?: string };

type BardSet = {
  id: string;
  name: string;
  version?: number;
  class?: string;
  credit?: string;
  era?: string;
  captured_at?: string;
  description?: string;
  availability_note?: string;
  phases?: Phase[];
  spell_sets?: SpellSet[];
  clickies?: Clicky[];
  potions?: Potion[];
};

async function loadSet(id: string): Promise<BardSet | null> {
  const dir = path.join(process.cwd(), 'public', 'bards', 'sets');
  try {
    const manifestRaw = await fs.readFile(path.join(dir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw) as { sets: { file: string }[] };
    for (const entry of manifest.sets) {
      try {
        const raw = await fs.readFile(path.join(dir, entry.file), 'utf8');
        const set = JSON.parse(raw) as BardSet;
        if (set.id === id) return set;
      } catch {}
    }
  } catch {}
  return null;
}

export async function generateStaticParams() {
  const dir = path.join(process.cwd(), 'public', 'bards', 'sets');
  try {
    const manifestRaw = await fs.readFile(path.join(dir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw) as { sets: { file: string }[] };
    const out: { id: string }[] = [];
    for (const entry of manifest.sets) {
      try {
        const raw = await fs.readFile(path.join(dir, entry.file), 'utf8');
        const set = JSON.parse(raw) as BardSet;
        out.push({ id: set.id });
      } catch {}
    }
    return out;
  } catch {
    return [];
  }
}

export default async function BardSetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const set = await loadSet(id);
  if (!set) notFound();

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <Link href="/bards" className="text-xs text-dim hover:text-fg no-underline">
        ← back to bards
      </Link>
      <header className="mt-3 mb-6 border-b border-border/40 pb-4">
        <h1 className="text-2xl font-bold text-orange mb-2">{set.name}</h1>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-dim">
          {set.class && <span><span className="text-fg/60">Class:</span> <span className="text-orange">{set.class}</span></span>}
          {set.era   && <span><span className="text-fg/60">Era:</span> <span className="text-blue">{set.era}</span></span>}
          {set.credit && <span><span className="text-fg/60">Contributed by:</span> <span className="text-fg">{set.credit}</span></span>}
          {set.captured_at && (
            <span><span className="text-fg/60">Captured:</span> {new Date(set.captured_at).toLocaleDateString()}</span>
          )}
        </div>
        {set.description && (
          <p className="mt-3 text-sm text-fg/80 leading-relaxed">{set.description}</p>
        )}
        {set.availability_note && (
          <div className="mt-3 text-xs bg-[#1f2a3d] border-l-3 border-[#f0d264] pl-3 py-2 text-fg/80">
            <strong className="text-[#f0d264]">Bring what you have on the truck.</strong> {set.availability_note}
          </div>
        )}
      </header>

      {/* Phases */}
      {set.phases && set.phases.length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-bold text-fg mb-3">Rotation <span className="text-xs text-dim font-normal">core — required</span></h2>
          <div className="space-y-4">
            {set.phases.map((ph, i) => (
              <div key={i} className="border border-border/60 rounded-lg p-4 bg-bg/40">
                <div className="text-orange font-bold mb-3">
                  {ph.name}
                  {ph.page_label && <span className="text-dim font-normal ml-3 text-sm">{ph.page_label}</span>}
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-dim border-b border-border/30">
                      <th className="py-1 pr-2 w-10">Slot</th>
                      <th className="py-1 pr-3 w-32">Label</th>
                      <th className="py-1 pr-3 w-40">Cast</th>
                      <th className="py-1">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ph.buttons || []).map((b, j) => (
                      <tr key={j} className="border-b border-border/15 hover:bg-bg/60">
                        <td className="py-1 pr-2 text-dim">{b.slot != null ? b.slot + 1 : '?'}</td>
                        <td className="py-1 pr-3 font-bold text-fg">{b.label}</td>
                        <td className="py-1 pr-3 font-mono text-blue text-xs">
                          {(b.lines || []).join(' ; ')}
                        </td>
                        <td className="py-1 text-fg/70">{b.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Spell sets */}
      {set.spell_sets && set.spell_sets.length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-bold text-fg mb-2">Spell sets</h2>
          {set.spell_sets.map((ss, i) => (
            <div key={i} className="border border-border/60 rounded p-3 bg-bg/40 mb-2">
              <div className="font-bold text-fg mb-1 text-sm">{ss.name}</div>
              <div className="text-xs text-fg/70">{(ss.spells || []).join(' · ')}</div>
            </div>
          ))}
        </section>
      )}

      {/* Clickies */}
      {set.clickies && set.clickies.length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-bold text-fg mb-1">Optional clickies</h2>
          <p className="text-xs text-dim mb-3">Gear-tier-dependent. Skip any you don&apos;t have on the truck — alternatives noted where available.</p>
          <div className="space-y-2">
            {set.clickies.map((c, i) => (
              <div key={i} className="border border-border/40 rounded p-3 bg-bg/30">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-fg/60 text-xs">{c.slot}:</span>
                  <span className="font-bold text-fg">{c.item}</span>
                  {c.tier && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg/60 text-[#a371f7] border border-border/40">{c.tier}</span>
                  )}
                  {c.required
                    ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#3d1d1d] text-[#ff7b72]">REQUIRED</span>
                    : <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg/60 text-dim border border-border/40">optional</span>}
                </div>
                {c.provides && <div className="mt-1 text-xs text-green">Provides: {c.provides}</div>}
                {c.alternatives && c.alternatives.length > 0 && (
                  <div className="mt-1 text-xs text-blue">If you don&apos;t have it: {c.alternatives.join(' / ')}</div>
                )}
                {c.notes && <div className="mt-1 text-xs text-dim">{c.notes}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Potions */}
      {set.potions && set.potions.length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-bold text-fg mb-2">Optional potions</h2>
          {set.potions.map((p, i) => (
            <div key={i} className="text-sm text-fg/80 mb-1">
              <span className="font-bold">{p.name}</span> {p.use && <span className="text-dim">— {p.use}</span>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
