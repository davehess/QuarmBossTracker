'use client';

// Sortable + filterable /who directory table with inline officer edits.
// Class and Zek are <select>s wired to server actions; edits update optimistically
// then router.refresh() reconciles against the DB. Override values are visually
// distinguished from observed values so it's clear what's curated vs collected.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setWhoClass, setWhoZek } from './actions';
import { BASE_CLASSES } from './classes';

export type WhoRow = {
  character: string;
  race: string | null;
  level: number | null;
  observedClass: string | null;
  classOverride: string | null;
  rosterClass: string | null;     // from the OpenDKP roster (members)
  effectiveClass: string | null;
  guild: string | null;
  guildRank: string | null;
  zone: string | null;        // short name (e.g. "oasis")
  zoneName: string | null;    // long display name, falls back to short
  anonymous: boolean;
  gm: boolean;
  lastSeen: string | null;
  firstSeen: string | null;
  obsCount: number;
  autoZek: boolean;
  // True when autoZek came from proximity inference, not an observed guild.
  inferredZek: boolean;
  zekOverride: boolean | null;   // null = unset (auto)
  effectiveZek: boolean;
  setByName: string | null;
};

type SortKey = 'character' | 'level' | 'class' | 'guild' | 'rank' | 'lastSeen' | 'obsCount' | 'zek' | 'zone';
type ZekFilter = 'all' | 'zek' | 'notzek';

function ago(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h';
  const d = Math.floor(h / 24); if (d < 30) return d + 'd';
  const mo = Math.floor(d / 30); if (mo < 12) return mo + 'mo';
  return Math.floor(mo / 12) + 'y';
}

export default function WhoTable({ rows: initial, canEdit = false }: { rows: WhoRow[]; canEdit?: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<WhoRow[]>(initial);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // Filters
  const [q, setQ] = useState('');
  const [classFilter, setClassFilter] = useState<string>('all'); // all | <class> | __none__
  const [zekFilter, setZekFilter] = useState<ZekFilter>('all');
  const [missingClassOnly, setMissingClassOnly] = useState(false);
  const [anonOnly, setAnonOnly] = useState(false);

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>('lastSeen');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'character' || k === 'class' || k === 'guild' || k === 'zone' ? 'asc' : 'desc'); }
  }

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter(r => {
      if (needle) {
        const hay = (r.character + ' ' + (r.guild || '') + ' ' + (r.effectiveClass || '') + ' ' + (r.zoneName || '') + ' ' + (r.zone || '')).toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (classFilter === '__none__') { if (r.effectiveClass) return false; }
      else if (classFilter !== 'all') { if (r.effectiveClass !== classFilter) return false; }
      if (zekFilter === 'zek' && !r.effectiveZek) return false;
      if (zekFilter === 'notzek' && r.effectiveZek) return false;
      if (missingClassOnly && r.effectiveClass) return false;
      if (anonOnly && !r.anonymous) return false;
      return true;
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    const cmp = (a: WhoRow, b: WhoRow): number => {
      switch (sortKey) {
        case 'character': return a.character.localeCompare(b.character) * dir;
        case 'level':     return ((a.level ?? -1) - (b.level ?? -1)) * dir;
        case 'class':     return (a.effectiveClass || '').localeCompare(b.effectiveClass || '') * dir;
        case 'guild':     return (a.guild || '').localeCompare(b.guild || '') * dir;
        case 'rank':      return (a.guildRank || '').localeCompare(b.guildRank || '') * dir;
        case 'zone': {
          // Sort by zone, then by level (highest first) within a zone. Rows with
          // no known zone always sink to the bottom regardless of direction.
          const az = a.zoneName, bz = b.zoneName;
          if (!az && !bz) return (b.level ?? -1) - (a.level ?? -1);
          if (!az) return 1;
          if (!bz) return -1;
          const c = az.localeCompare(bz) * dir;
          return c !== 0 ? c : (b.level ?? -1) - (a.level ?? -1);
        }
        case 'obsCount':  return (a.obsCount - b.obsCount) * dir;
        case 'zek':       return ((a.effectiveZek ? 1 : 0) - (b.effectiveZek ? 1 : 0)) * dir;
        case 'lastSeen':
        default:          return ((Date.parse(a.lastSeen || '') || 0) - (Date.parse(b.lastSeen || '') || 0)) * dir;
      }
    };
    return out.sort(cmp);
  }, [rows, q, classFilter, zekFilter, missingClassOnly, anonOnly, sortKey, sortDir]);

  function patchRow(name: string, patch: Partial<WhoRow>) {
    setRows(rs => rs.map(r => (r.character === name ? { ...r, ...patch } : r)));
  }

  function onClassChange(r: WhoRow, value: string) {
    const next = value || null;
    const prev = { classOverride: r.classOverride, effectiveClass: r.effectiveClass };
    patchRow(r.character, { classOverride: next, effectiveClass: next ?? r.observedClass });
    setErr(null);
    startTransition(async () => {
      const res = await setWhoClass(r.character, next);
      if (!res.ok) { patchRow(r.character, prev); setErr(res.error ?? 'failed'); }
      else router.refresh();
    });
  }

  function onZekChange(r: WhoRow, value: string) {
    const next: boolean | null = value === 'zek' ? true : value === 'no' ? false : null;
    const prev = { zekOverride: r.zekOverride, effectiveZek: r.effectiveZek };
    patchRow(r.character, { zekOverride: next, effectiveZek: next != null ? next : r.autoZek });
    setErr(null);
    startTransition(async () => {
      const res = await setWhoZek(r.character, next);
      if (!res.ok) { patchRow(r.character, prev); setErr(res.error ?? 'failed'); }
      else router.refresh();
    });
  }

  const Th = ({ k, label, className }: { k: SortKey; label: string; className?: string }) => (
    <th
      className={`px-2 py-1 text-left cursor-pointer select-none hover:text-text ${className || ''}`}
      onClick={() => toggleSort(k)}
    >
      {label}{sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <section className="bg-panel border border-border rounded-lg p-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search name / guild / class…"
          className="bg-bg border border-border rounded px-2 py-1 text-text w-56"
        />
        <select value={classFilter} onChange={e => setClassFilter(e.target.value)}
          className="bg-bg border border-border rounded px-2 py-1 text-text">
          <option value="all">All classes</option>
          <option value="__none__">— no class —</option>
          {BASE_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={zekFilter} onChange={e => setZekFilter(e.target.value as ZekFilter)}
          className="bg-bg border border-border rounded px-2 py-1 text-text">
          <option value="all">Zek: all</option>
          <option value="zek">Zek only</option>
          <option value="notzek">Non-Zek only</option>
        </select>
        <label className="flex items-center gap-1 text-dim cursor-pointer">
          <input type="checkbox" checked={missingClassOnly} onChange={e => setMissingClassOnly(e.target.checked)} />
          missing class
        </label>
        <label className="flex items-center gap-1 text-dim cursor-pointer">
          <input type="checkbox" checked={anonOnly} onChange={e => setAnonOnly(e.target.checked)} />
          anon
        </label>
        <span className="ml-auto text-dim">{view.length.toLocaleString()} shown{pending ? ' · saving…' : ''}</span>
      </div>
      {err && <div className="text-red text-xs mb-2">{err}</div>}

      <div className="overflow-auto max-h-[70vh] border border-border rounded">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-panel text-dim border-b border-border">
            <tr>
              <Th k="character" label="Character" />
              <Th k="level" label="Lvl" />
              <Th k="class" label="Class" />
              <Th k="guild" label="Guild" />
              <Th k="rank" label="Rank" />
              <Th k="zone" label="Zone" />
              <Th k="zek" label="Zek" />
              <Th k="obsCount" label="Seen #" />
              <Th k="lastSeen" label="Last" />
            </tr>
          </thead>
          <tbody>
            {view.map(r => (
              <tr key={r.character} className="border-b border-border/50 hover:bg-bg/40">
                <td className="px-2 py-1 whitespace-nowrap">
                  <span className="text-text">{r.character}</span>
                  {r.race && <span className="text-dim"> · {r.race}</span>}
                  {r.gm && <span className="ml-1 text-gold">GM</span>}
                  {r.anonymous && <span className="ml-1 text-dim">(anon)</span>}
                </td>
                <td className="px-2 py-1 text-dim">{r.level ?? '—'}</td>
                <td className="px-2 py-1">
                  {canEdit ? (
                    <select
                      value={r.classOverride ?? ''}
                      disabled={pending}
                      onChange={e => onClassChange(r, e.target.value)}
                      title={r.classOverride
                        ? `override (observed: ${r.observedClass || 'none'})`
                        : (r.observedClass ? 'observed in /who' : (r.rosterClass ? 'from OpenDKP roster' : 'no class observed'))}
                      className={`bg-bg border rounded px-1 py-0.5 ${
                        r.classOverride ? 'border-gold text-gold'
                          : r.observedClass ? 'border-border text-text'
                          : r.rosterClass ? 'border-border text-dim'
                          : 'border-red/60 text-red'}`}
                    >
                      <option value="">{r.observedClass ? `(obs: ${r.observedClass})` : (r.rosterClass ? `(roster: ${r.rosterClass})` : '— set —')}</option>
                      {BASE_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : (
                    <span className={r.classOverride ? 'text-gold' : r.observedClass ? 'text-text' : r.rosterClass ? 'text-dim' : 'text-dim'}
                      title={r.classOverride ? 'officer-set' : r.observedClass ? 'observed in /who' : r.rosterClass ? 'from OpenDKP roster' : 'unknown'}>
                      {r.effectiveClass || '—'}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1 text-dim whitespace-nowrap">{r.guild || '—'}</td>
                <td className="px-2 py-1 text-dim">{r.guildRank || '—'}</td>
                <td className="px-2 py-1 text-dim whitespace-nowrap" title={r.zone || ''}>{r.zoneName || '—'}</td>
                <td className="px-2 py-1">
                  {canEdit ? (
                    <select
                      value={r.zekOverride === true ? 'zek' : r.zekOverride === false ? 'no' : 'auto'}
                      disabled={pending}
                      onChange={e => onZekChange(r, e.target.value)}
                      title={r.zekOverride != null
                        ? 'manually set by an officer'
                        : (r.autoZek
                            ? (r.inferredZek
                                ? 'auto (inferred): unguilded but observed in a zone with a Zek-guilded character within ±3 minutes during PvP'
                                : 'auto: seen in a Zek / Rise of Zek guild')
                            : 'auto: never seen in a Zek guild')}
                      className={`bg-bg border rounded px-1 py-0.5 ${
                        r.effectiveZek ? 'border-red text-red' : 'border-border text-dim'}`}
                    >
                      <option value="auto">{r.autoZek ? (r.inferredZek && !r.zekOverride ? 'Auto: Zek?' : 'Auto: Zek') : 'Auto: not Zek'}</option>
                      <option value="zek">Force Zek</option>
                      <option value="no">Force not Zek</option>
                    </select>
                  ) : (
                    r.effectiveZek
                      ? <span className="text-red font-semibold" title={
                          r.zekOverride != null ? 'officer-flagged' :
                          r.inferredZek      ? 'inferred — unguilded but seen in a zone with a Zek-guilded character within ±3 minutes during PvP' :
                                               'seen in a Zek / Rise of Zek guild'
                        }>{r.zekOverride == null && r.inferredZek ? 'Zek?' : 'Zek'}</span>
                      : <span className="text-dim">—</span>
                  )}
                </td>
                <td className="px-2 py-1 text-dim">{r.obsCount.toLocaleString()}</td>
                <td className="px-2 py-1 text-dim whitespace-nowrap" title={r.lastSeen || ''}>{ago(r.lastSeen)}</td>
              </tr>
            ))}
            {view.length === 0 && (
              <tr><td colSpan={9} className="px-2 py-6 text-center text-dim">no characters match these filters</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
