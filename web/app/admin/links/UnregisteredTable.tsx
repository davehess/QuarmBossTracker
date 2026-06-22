'use client';

// Sortable "Not in OpenDKP" table. Each row is a character streaming from a
// member's Mimic with no OpenDKP entry; the Register cell is the
// OpenDkpRegisterRow client form (level/class/race/rank + DM + Register).
// Sort by character name, owner, or level so officers can work the list in
// whatever order suits them (Uilnayar 2026-06-22 — "make this section
// sortable by name or owner"). Level is filled from /who sightings server-
// side, including the owner's own /who when their Mimic captured it.

import { useMemo, useState } from 'react';
import OpenDkpRegisterRow from './OpenDkpRegisterRow';

export type UnregRowView = {
  name:            string;
  ownerLabel:      string;
  did:             string;
  level:           number | null;
  cls:             string | null;
  rank:            string;
  parentName:      string | null;
  parentOpenDkpId: number | null;
};

type SortKey = 'name' | 'owner' | 'level';

export default function UnregisteredTable({ rows }: { rows: UnregRowView[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('owner');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');

  function toggle(k: SortKey) {
    if (k === sortKey) setDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setDir(k === 'level' ? 'desc' : 'asc'); }
  }

  const sorted = useMemo(() => {
    const mul = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'name':  return a.name.localeCompare(b.name) * mul;
        case 'owner': return (a.ownerLabel.localeCompare(b.ownerLabel) || a.name.localeCompare(b.name)) * mul;
        case 'level': return (((a.level ?? -1) - (b.level ?? -1)) || a.name.localeCompare(b.name)) * mul;
        default:      return 0;
      }
    });
  }, [rows, sortKey, dir]);

  const Th = ({ k, label, className }: { k: SortKey; label: string; className?: string }) => (
    <th
      className={`text-left px-3 py-2 font-normal cursor-pointer select-none hover:text-text ${className || ''}`}
      onClick={() => toggle(k)}
    >
      {label}{sortKey === k ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <table className="w-full text-xs">
      <thead className="text-dim hidden sm:table-header-group">
        <tr className="border-b border-border">
          <Th k="name"  label="Character" />
          <Th k="owner" label="Owner" />
          <Th k="level" label="Lvl / Class" />
          <th className="text-left px-3 py-2 font-normal">Suggested rank</th>
          <th className="text-left px-3 py-2 font-normal">Register</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map(u => (
          <tr key={u.name} className="border-b border-border/40 hover:bg-[#1a212c]">
            <td className="px-3 py-2 text-text font-medium">{u.name}</td>
            <td className="px-3 py-2 text-dim">{u.ownerLabel}</td>
            <td className="px-3 py-2 text-dim">{u.level != null ? `L${u.level}` : '?'}{u.cls ? ` ${u.cls}` : ''}</td>
            <td className={`px-3 py-2 ${u.rank === 'Raid Alt' ? 'text-green' : 'text-dim'}`}>{u.rank}</td>
            <td className="px-3 py-2">
              <OpenDkpRegisterRow
                name={u.name}
                observedClass={u.cls ?? null}
                observedLevel={u.level ?? null}
                observedRace={null}
                parentName={u.parentName}
                parentOpenDkpId={u.parentOpenDkpId}
                uploaderDiscordId={u.did}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
