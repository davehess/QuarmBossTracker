'use client';

import { Fragment, useMemo, useState } from 'react';
import {
  CATEGORY_LABELS, ROLE_TARGETS, ROLE_LABELS,
  type BuffCategory, type Role,
} from '@/lib/buffs';

export type BuffRow = {
  name: string;
  className: string | null;
  role: Role;
  zone: string | null;
  updatedAt: string | null;
  buffCount: number;
  byCategory: Record<string, string[]>;
  other: string[];
};

const STALE_MS = 30 * 60 * 1000;

// Copy "/target <name>" so a raider can paste straight into EQ. Zeal's pipe is
// read-only (data flows OUT of EQ; there's no documented inbound slash-command
// surface), so clipboard is the right primitive. Brief ✓ feedback on success.
function CopyTargetButton({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    const text = '/target ' + name;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Older browsers / iframes without clipboard perms — fall back to a
      // hidden textarea + execCommand so the button never silently fails.
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopied(true); setTimeout(() => setCopied(false), 1200);
      } catch { /* nothing more we can do */ }
    }
  };
  return (
    <button
      onClick={onClick}
      title={'Copy "/target ' + name + '" to clipboard'}
      aria-label={'Copy /target ' + name}
      className="ml-1 inline-flex items-center justify-center w-5 h-5 text-[11px] rounded border border-border/60 text-dim hover:text-blue hover:border-blue align-middle"
    >
      {copied ? <span className="text-green">✓</span> : <span>📋</span>}
    </button>
  );
}

function ago(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

export default function BuffsGrid({ rows, categories }: { rows: BuffRow[]; categories: BuffCategory[] }) {
  // Distinct classes present, for the filter chips.
  const classes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.className || 'Unknown');
    return [...set].sort();
  }, [rows]);

  const [selectedClasses, setSelectedClasses] = useState<Set<string>>(new Set(classes));
  const [onlyGaps, setOnlyGaps]   = useState(false);
  const [hideStale, setHideStale] = useState(false);

  const toggleClass = (c: string) => {
    setSelectedClasses(prev => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  };

  const now = Date.now();
  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (!selectedClasses.has(r.className || 'Unknown')) return false;
      if (hideStale && r.updatedAt && (now - new Date(r.updatedAt).getTime()) > STALE_MS) return false;
      if (onlyGaps) {
        const target = ROLE_TARGETS[r.role] || [];
        const hasGap = target.some(cat => !(r.byCategory[cat]?.length));
        if (!hasGap) return false;
      }
      return true;
    });
  }, [rows, selectedClasses, onlyGaps, hideStale, now]);

  // Group by zone. In a raid the zone with the most of our people IS the raid —
  // so the busiest zone sorts to the top (that's who you care about), then the
  // rest by headcount, with "unknown zone" last. (Zeal reports each client's own
  // zone; we don't get true raid/group structure, so shared zone is the proxy
  // for "grouped up together".)
  const groups = useMemo(() => {
    const m = new Map<string, BuffRow[]>();
    for (const r of filtered) {
      const z = r.zone || 'Unknown zone';
      const arr = m.get(z);
      if (arr) arr.push(r); else m.set(z, [r]);
    }
    return [...m.entries()].sort((a, b) => {
      const au = a[0] === 'Unknown zone', bu = b[0] === 'Unknown zone';
      if (au !== bu) return au ? 1 : -1;
      if (b[1].length !== a[1].length) return b[1].length - a[1].length;
      return a[0].localeCompare(b[0]);
    });
  }, [filtered]);

  const colSpan = categories.length + 3;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl text-gold">🧪 Buffs</h1>
        <p className="text-sm text-dim mt-1">
          Who&apos;s carrying what, right now — so buffers can see the gaps at a glance.
        </p>
      </div>

      {/* Accuracy caveat — load-bearing. There is NO way to read another
          player's buffs from their own client; the only data we have is what
          each agent uploads about its OWN character via Zeal. So this page is
          accurate exactly to the extent that each raider runs Mimic / the
          agent — for everyone else we're inferring from indirect signals
          (their last /who, their last appearance) and that's it. */}
      <div className="bg-[#3a1010] border-2 border-[#a3260a] text-[#fca5a5] rounded-lg p-3 text-sm">
        <div className="font-bold text-red-300 mb-1">⚠️ Read this before trusting any of these rows</div>
        We <b>cannot read another player&apos;s buffs from your log</b> — there is no way to.
        Every row here is sourced from the <b>character&apos;s own</b> Mimic / agent upload (via Zeal).
        For raiders <b>not running the agent</b>, we can only infer so much from indirect signals,
        and a blank cell means &quot;we don&apos;t know,&quot; <i>not</i> &quot;definitely missing.&quot;
        <br /><br />
        <b>Want an accurate accounting for your own characters?</b> Install Mimic
        (<a href="https://wolfpack.quest/mimic" className="text-blue underline">wolfpack.quest/mimic</a>) or
        run the local agent — their buffs + zone will sync within seconds. Open <code>localhost:7777</code> for your live view.
      </div>

      {/* Filters */}
      <div className="bg-panel border border-border rounded-lg p-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-dim mr-1">Classes:</span>
          {classes.map(c => {
            const on = selectedClasses.has(c);
            return (
              <button
                key={c}
                onClick={() => toggleClass(c)}
                className={[
                  'px-2 py-0.5 rounded border text-xs transition-colors',
                  on ? 'bg-accent border-accent text-white' : 'bg-bg border-border text-dim hover:text-text',
                ].join(' ')}
              >
                {c}
              </button>
            );
          })}
          <button onClick={() => setSelectedClasses(new Set(classes))} className="text-[11px] text-blue hover:underline ml-1">all</button>
          <button onClick={() => setSelectedClasses(new Set())} className="text-[11px] text-blue hover:underline">none</button>
        </div>
        <div className="flex items-center gap-4 flex-wrap text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={onlyGaps} onChange={e => setOnlyGaps(e.target.checked)} />
            <span className="text-text">Only show characters with missing buffs</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={hideStale} onChange={e => setHideStale(e.target.checked)} />
            <span className="text-text">Hide logged-off (synced &gt;30m ago)</span>
          </label>
          <span className="text-dim ml-auto">{filtered.length} shown</span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-panel border border-border rounded-lg p-6 text-center text-dim text-sm">
          {rows.length === 0
            ? 'No live buff data yet. Have raiders run Mimic / the agent with Zeal enabled — buffs sync automatically.'
            : 'No characters match the current filters.'}
        </div>
      ) : (
        <div className="bg-panel border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-dim border-b border-border">
                <th className="text-left p-2 sticky left-0 bg-panel">Character</th>
                {categories.map(cat => (
                  <th key={cat} className="p-2 text-center whitespace-nowrap">{CATEGORY_LABELS[cat]}</th>
                ))}
                <th className="p-2 text-center">Other</th>
                <th className="p-2 text-right whitespace-nowrap">Synced</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([zone, zoneRows], gi) => (
                <Fragment key={zone}>
                  <tr className="bg-bg/60">
                    <td colSpan={colSpan} className="px-2 py-1.5 text-[11px]">
                      <span className="text-gold">📍 {zone}</span>
                      <span className="text-dim"> · {zoneRows.length} {zoneRows.length === 1 ? 'character' : 'characters'}</span>
                      {gi === 0 && groups.length > 1 && <span className="text-dim/70"> · most of the pack is here</span>}
                    </td>
                  </tr>
                  {zoneRows.map(r => {
                    const target = ROLE_TARGETS[r.role] || [];
                    const stale = r.updatedAt ? (now - new Date(r.updatedAt).getTime()) > STALE_MS : true;
                    return (
                      <tr key={r.name} className={['border-b border-border/40', stale ? 'opacity-50' : ''].join(' ')}>
                        <td className="p-2 sticky left-0 bg-panel">
                          <div className="text-text flex items-center">
                            <span>{r.name}</span>
                            <CopyTargetButton name={r.name} />
                          </div>
                          <div className="text-dim text-[10px]">
                            {[r.className || 'Unknown', ROLE_LABELS[r.role]].join(' · ')}
                          </div>
                        </td>
                        {categories.map(cat => {
                          const names = r.byCategory[cat];
                          const present = (names?.length || 0) > 0;
                          const expected = target.includes(cat);
                          return (
                            <td key={cat} className="p-2 text-center">
                              {present ? (
                                <span
                                  className="text-green inline-block max-w-[110px] truncate align-bottom"
                                  title={names!.join(', ')}
                                >
                                  {names![0]}{names!.length > 1 ? ' +' + (names!.length - 1) : ''}
                                </span>
                              ) : expected ? (
                                <span className="text-red-400" title="Expected for this role — missing">— missing</span>
                              ) : (
                                <span className="text-dim/40">·</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="p-2 text-center" title={r.other.join(', ')}>
                          {r.other.length > 0 ? <span className="text-dim">{r.other.length}</span> : <span className="text-dim/40">·</span>}
                        </td>
                        <td className="p-2 text-right text-dim whitespace-nowrap">{ago(r.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-dim">
        Cells show the actual <span className="text-green">buff/song name</span> in that category
        (hover for the full list when there&apos;s more than one) ·
        <span className="text-red-400"> — missing</span> = expected for the role but absent ·
        <span className="text-dim"> ·</span> not expected for the role ·
        grouped by zone (busiest zone = the raid, on top) ·
        click 📋 next to a name to copy <code>/target &lt;name&gt;</code> for pasting in EQ.
        The <b>Other</b> column counts buffs we couldn&apos;t categorize yet —
        hover it and send the names to an officer so we can map them. Target profiles per role are a
        starting point (<code>lib/buffs.ts</code>) and easy to tune.
      </p>
    </div>
  );
}
