// /bards — collaborative bard PvP setups, centered on the El Bard art.
//
// What this is: a guild-wide gallery of bard PvP rotations contributed by
// our actual bards, captured via Mimic's UI Studio "Capture PvP draft"
// flow. The El Bard illustration anchors the page — bards have a strong
// visual culture (sheet music, instruments, multi-arms doing every song
// at once) and the page leans into it instead of looking like a CRM.
//
// Data source: web/public/bards/sets/manifest.json points at the JSON
// templates mirrored from apps/mimic/pvp-sets/. We render each set as a
// card with the rotation phases visible at a glance, plus era + capture
// date so the reader knows which Quarm expansion the set was tuned for
// (Cassindra-era songs won't help a Classic-only bard, etc.).
//
// Future: contributions land via a "Publish to /bards" button in Mimic's
// UI Studio. For now templates are committed to the repo and mirrored.

import { promises as fs } from 'fs';
import path from 'path';
import Image from 'next/image';

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
  clickies?: Clicky[];
};

async function loadSets(): Promise<BardSet[]> {
  const dir = path.join(process.cwd(), 'public', 'bards', 'sets');
  try {
    const manifestRaw = await fs.readFile(path.join(dir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw) as { sets: { file: string; featured?: boolean }[] };
    const out: BardSet[] = [];
    for (const entry of manifest.sets) {
      try {
        const raw = await fs.readFile(path.join(dir, entry.file), 'utf8');
        out.push(JSON.parse(raw) as BardSet);
      } catch {
        // skip — better to render what we have than 500 the page
      }
    }
    return out;
  } catch {
    return [];
  }
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default async function BardsPage() {
  const sets = await loadSets();

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* Hero — El Bard art + the page's reason for being. */}
      <section className="grid md:grid-cols-[1fr_2fr] gap-6 items-center mb-10 border-b border-border/40 pb-8">
        <div className="flex justify-center">
          <Image
            src="/bards/el-bard.png"
            alt="El Bard — the Overconfident Ubergod, surrounded by every bard song and instrument at once"
            width={560}
            height={560}
            priority
            className="rounded shadow-lg"
            style={{ width: 'auto', height: 'auto', maxWidth: '100%' }}
          />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-orange mb-2">El Bard</h1>
          <p className="text-sm text-fg/80 italic mb-3">The Overconfident Ubergod. One tune, and all fall silent.</p>
          <p className="text-sm text-fg/70 leading-relaxed mb-4">
            Bards on Quarm carry every spell-set, every clicky, every macro page — at
            once. This is where the pack shares their PvP rotations: the dirges, the
            mezzes, the resist-soaks, and the order they hit them in. Capture your
            own with Mimic&apos;s UI Studio (<code className="text-blue text-xs">Capture PvP draft</code>),
            review the JSON, drop it in <code className="text-blue text-xs">#bards</code>, and we&apos;ll
            add it to the gallery.
          </p>
          <div className="flex gap-3 flex-wrap text-xs">
            <a
              href="/mimic?direct=1"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-blue bg-[#1f6feb33] text-blue hover:bg-[#1f6feb66] transition-colors no-underline"
            >
              Get Mimic →
            </a>
            <a
              href="https://github.com/davehess/QuarmBossTracker/tree/main/apps/mimic/pvp-sets"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-bg/40 text-dim hover:bg-bg/70 hover:text-fg transition-colors no-underline"
            >
              Browse templates source →
            </a>
          </div>
        </div>
      </section>

      {/* Sets gallery */}
      <section>
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-xl font-bold text-fg">Shared rotations</h2>
          <span className="text-xs text-dim">{sets.length} set{sets.length === 1 ? '' : 's'}</span>
        </div>
        {sets.length === 0 && (
          <div className="text-sm text-dim border border-border/60 rounded p-4 bg-bg/30">
            No sets contributed yet. Be first — Mimic → UI Studio → Capture PvP draft.
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-5">
          {sets.map(set => (
            <article key={set.id} className="border border-border/60 rounded-lg p-4 bg-bg/40 hover:bg-bg/60 transition-colors">
              <header className="mb-3">
                <h3 className="text-lg font-bold text-fg mb-1">{set.name}</h3>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-dim">
                  {set.class && (
                    <span><span className="text-fg/60">Class:</span> <span className="text-orange">{set.class}</span></span>
                  )}
                  {set.era && (
                    <span><span className="text-fg/60">Era:</span> <span className="text-blue">{set.era}</span></span>
                  )}
                  {set.credit && (
                    <span><span className="text-fg/60">By:</span> <span className="text-fg">{set.credit}</span></span>
                  )}
                  {set.captured_at && (
                    <span><span className="text-fg/60">Captured:</span> {fmtDate(set.captured_at)}</span>
                  )}
                </div>
              </header>
              {set.description && (
                <p className="text-sm text-fg/80 mb-3 leading-relaxed">{set.description}</p>
              )}
              {set.availability_note && (
                <div className="text-xs bg-[#1f2a3d] border-l-2 border-[#f0d264] pl-3 py-2 mb-3 text-fg/80">
                  <strong className="text-[#f0d264]">Bring what you have.</strong> {set.availability_note}
                </div>
              )}
              {set.phases && set.phases.length > 0 && (
                <div className="space-y-2 mb-3">
                  {set.phases.map((ph, i) => (
                    <div key={i} className="bg-bg/60 rounded p-2 text-xs">
                      <div className="text-orange font-bold mb-1">
                        {ph.name}{ph.page_label && <span className="text-dim font-normal ml-2">{ph.page_label}</span>}
                      </div>
                      <div className="text-fg/70">
                        {(ph.buttons || []).map(b => b.label).filter(Boolean).join(' → ')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {set.clickies && set.clickies.length > 0 && (
                <div className="text-xs text-dim">
                  <span className="text-fg/60">Clickies:</span> {set.clickies.map(c => c.item).filter(Boolean).join(' · ')}
                </div>
              )}
              <div className="mt-3 pt-3 border-t border-border/40 flex justify-end gap-2 text-xs">
                <a
                  href={`/bards/sets/${set.id}`}
                  className="text-blue hover:underline"
                >
                  Full details →
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer className="mt-12 text-xs text-dim border-t border-border/40 pt-4">
        <p>
          El Bard art used with thanks to the EQ bard community.
          Want yours featured? Use Mimic&apos;s Capture flow and DM the JSON.
        </p>
      </footer>
    </div>
  );
}
