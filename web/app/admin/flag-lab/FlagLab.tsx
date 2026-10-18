'use client';

// The Flag lab's two panels (the PoP flag matrix and the hail board), all state in useState: no fetch, no
// server action, no database. Reload or Reset and it is gone. Gate state comes from the same functions and
// the same GateMark /pop uses (web/lib/popFlags.ts, web/lib/popGateCell.ts, web/app/pop/GateMark.tsx).

import { useMemo, useState } from 'react';
import { POP_FLAG_DEFS, POP_FLAGS, POP_ZONES, TIER_LABELS, missingFor, zoneAccess } from '@/lib/popFlags';
import { SELF_TICK_TITLE, gateState, proofFor } from '@/lib/popGateCell';
import GateMark from '@/app/pop/GateMark';
import {
  FAKE_NOW, LAB_CLASSES, LAB_FAKE_NAMES, LAB_HAIL_STATES, LAB_PRESETS, LAB_SOURCES,
  buildHailScenario, deriveFlags, hailCfgs, isLabName, toggleSource,
  type LabHailMember, type LabHailState, type LabMember, type LabSource,
} from '@/lib/flagLabModel';
import { buildViews, withClock } from '@/lib/hailBoardView';

const MEMBER_SEED: LabMember[] = [
  { id: 'm1', name: 'Aldenmar', cls: 'Cleric', level: 65, flags: { ...LAB_PRESETS[1].flags } },
  { id: 'm2', name: 'Brackwyn', cls: 'Warrior', level: 65, flags: { ...LAB_PRESETS[2].flags } },
  { id: 'm3', name: 'Corvale', cls: 'Wizard', level: 64, flags: { ...LAB_PRESETS[4].flags } },
];
const HAIL_SEED: LabHailMember[] = LAB_FAKE_NAMES.slice(0, 8).map((name, i) => ({
  name, state: (['still', 'still', 'hailed_flag', 'hailed_seen', 'hailed_marked', 'already', 'still_prior_missing', 'still'] as LabHailState[])[i],
}));

const fakeBanner = 'FAKE DATA — nothing here is saved.';
function FakeBanner() {
  return (
    <p role="note" className="mb-4 rounded border border-orange/50 bg-orange/10 px-3 py-1.5 font-mono text-xs text-orange">
      {fakeBanner}
    </p>
  );
}

const inputCls = 'bg-bg border border-border rounded px-2 py-1 text-sm text-text';
const btnCls = 'px-2 py-1 rounded border border-border text-xs hover:text-text hover:border-gold';

// ── Flag matrix ────────────────────────────────────────────────────────────────────────────────────────

const TICKABLE = POP_FLAG_DEFS.filter(f => f.key !== 'unmapped');
const TIER_OF = (zone: string) => POP_ZONES.find(z => z.key === zone)?.tier ?? 1;

function FlagMatrixPanel({ members, setMembers }: { members: LabMember[]; setMembers: (m: LabMember[]) => void }) {
  const [selected, setSelected] = useState<string>(members[0]?.id ?? '');
  const [source, setSource] = useState<LabSource>('mimic');
  const [name, setName] = useState('');
  const [cls, setCls] = useState(LAB_CLASSES[0]);
  const [level, setLevel] = useState(65);
  const [nextId, setNextId] = useState(10);

  const sel = members.find(m => m.id === selected) ?? null;
  const patch = (id: string, fn: (m: LabMember) => LabMember) => setMembers(members.map(m => (m.id === id ? fn(m) : m)));
  const nameOk = isLabName(name) && !members.some(m => m.name.toLowerCase() === name.trim().toLowerCase());

  const derived = useMemo(() => members.map(m => ({ m, d: deriveFlags(m) })), [members]);
  const tiers = [1, 2, 3, 4, 5];

  return (
    <section className="bg-panel border border-border rounded-lg p-5" aria-label="Flag matrix preview">
      <h3 className="text-lg text-orange mb-1">PoP flag matrix</h3>
      <FakeBanner />

      <div className="flex flex-wrap items-end gap-2 mb-4">
        <label className="text-xs text-dim">Name
          <input className={`${inputCls} block w-32`} value={name} maxLength={24} placeholder="letters only"
                 onChange={e => setName(e.target.value)} />
        </label>
        <label className="text-xs text-dim">Class
          <select className={`${inputCls} block`} value={cls} onChange={e => setCls(e.target.value)}>
            {LAB_CLASSES.map(c => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-xs text-dim">Level
          <input type="number" min={1} max={65} className={`${inputCls} block w-20`} value={level}
                 onChange={e => setLevel(Math.min(65, Math.max(1, Number(e.target.value) || 1)))} />
        </label>
        <button type="button" className={btnCls} disabled={!nameOk}
                onClick={() => {
                  const id = `m${nextId}`;
                  setNextId(nextId + 1);
                  setMembers([...members, { id, name: name.trim(), cls, level, flags: {} }]);
                  setSelected(id);
                  setName('');
                }}>
          Add fake member
        </button>
      </div>

      {members.length === 0 && <p className="text-sm text-dim">No fake members yet. Add one above.</p>}

      {members.length > 0 && (
        <div className="overflow-x-auto mb-5">
          <table className="text-sm border-collapse">
            <thead>
              <tr className="text-left text-dim text-xs">
                <th className="pr-3 py-1 font-normal">Member</th>
                {POP_ZONES.map(z => (
                  <th key={z.key} className="px-1.5 py-1 font-normal text-center" title={`${z.name}: needs ${z.requires.map(f => POP_FLAGS[f]?.label ?? f).join(', ') || 'nothing'}`}>
                    {z.short}
                  </th>
                ))}
                <th className="px-2 py-1 font-normal text-center">Flags</th>
              </tr>
            </thead>
            <tbody>
              {derived.map(({ m, d }) => (
                <tr key={m.id} className={`border-t border-border ${m.id === selected ? 'bg-bg' : ''}`}>
                  <th className="pr-3 py-1 text-left font-normal whitespace-nowrap">
                    <button type="button" onClick={() => setSelected(m.id)}
                            className={m.id === selected ? 'text-gold' : 'text-text hover:text-blue'}>
                      {m.name}
                    </button>
                    <span className="text-xs text-dim"> {m.level} {m.cls}</span>
                  </th>
                  {POP_ZONES.map(z => {
                    // The same two calls /pop's AccessMark makes.
                    const g = gateState(z.requires, proofFor(z.requires, d), d.self);
                    const open = !zoneAccess(z, d.flags);
                    const miss = missingFor(z, d.flags).map(f => POP_FLAGS[f]?.label ?? f);
                    const title = open
                      ? `Missing ${miss.join(', ')}`
                      : g.mark === 'self' ? `${SELF_TICK_TITLE}: ${g.selfFlags.map(f => POP_FLAGS[f]?.label ?? f).join(', ')}.` : undefined;
                    return (
                      <td key={z.key} className="px-1.5 py-1 text-center">
                        {g.mark === 'none' ? <span className="text-dim" title={title}>—</span> : <GateMark kind={g.mark} title={title} />}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-center text-dim">{d.flags.size}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-dim mt-2 leading-5">
            <GateMark kind="mimic" /> Mimic recorded &nbsp; <GateMark kind="who" /> /who saw them &nbsp;
            <GateMark kind="loot" /> only loot proves &nbsp; <GateMark kind="self" /> their own tick &nbsp; — a flag still open.
            A flag proven two ways shows the strongest proof; a tick never shows over a proof.
          </p>
        </div>
      )}

      <div className="border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-sm text-dim">Editing</span>
          <select className={inputCls} value={selected} onChange={e => setSelected(e.target.value)} aria-label="Member to edit">
            {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          {sel && (
            <button type="button" className={btnCls}
                    onClick={() => { setMembers(members.filter(m => m.id !== sel.id)); setSelected(members.find(m => m.id !== sel.id)?.id ?? ''); }}>
              Remove member
            </button>
          )}
        </div>

        {sel && (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-xs text-dim">Preset:</span>
              {LAB_PRESETS.map(p => (
                <button key={p.id} type="button" className={btnCls} title={p.blurb}
                        onClick={() => patch(sel.id, m => ({ ...m, flags: { ...p.flags } }))}>
                  {p.label}
                </button>
              ))}
            </div>

            <fieldset className="mb-3">
              <legend className="text-xs text-dim mb-1">Source applied when you tick a flag below</legend>
              <div className="flex flex-wrap gap-3 text-sm">
                {LAB_SOURCES.map(s => (
                  <label key={s.key} className="inline-flex items-center gap-1">
                    <input type="radio" name="lab-source" checked={source === s.key} onChange={() => setSource(s.key)} />
                    {s.label}
                  </label>
                ))}
              </div>
            </fieldset>

            {tiers.map(t => {
              const defs = TICKABLE.filter(f => TIER_OF(f.zone) === t);
              if (!defs.length) return null;
              return (
                <div key={t} className="mb-2">
                  <div className="text-xs text-dim mb-1">{TIER_LABELS[t].name}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {defs.map(f => {
                      const srcs = sel.flags[f.key] ?? [];
                      const on = srcs.includes(source);
                      return (
                        <button key={f.key} type="button" aria-pressed={on} title={f.note ?? f.label}
                                onClick={() => patch(sel.id, m => ({ ...m, flags: toggleSource(m.flags, f.key, source) }))}
                                className={`px-2 py-0.5 rounded border text-xs ${on ? 'border-gold text-gold' : srcs.length ? 'border-blue/60 text-text' : 'border-border text-dim hover:text-text'}`}>
                          {f.label}
                          {srcs.length > 0 && (
                            <span className="ml-1 font-mono text-[10px] text-dim">
                              {LAB_SOURCES.filter(s => srcs.includes(s.key)).map(s => s.letter).join('')}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </section>
  );
}

// ── Hail board ─────────────────────────────────────────────────────────────────────────────────────────

function fmtLeft(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function HailBoardPanel({ roster, setRoster }: { roster: LabHailMember[]; setRoster: (r: LabHailMember[]) => void }) {
  const cfgs = hailCfgs();
  const [bossId, setBossId] = useState(cfgs[0].id);
  const [minutes, setMinutes] = useState(3);
  const [name, setName] = useState('');
  const cfg = cfgs.find(c => c.id === bossId) ?? cfgs[0];

  const view = useMemo(() => {
    const { window, data, nowMs } = buildHailScenario(cfg, minutes, roster);
    const v = buildViews([window], data, nowMs).get(window.id);
    return v ? withClock(v, nowMs) : null;
  }, [cfg, minutes, roster]);

  const nameOk = isLabName(name) && !roster.some(r => r.name.toLowerCase() === name.trim().toLowerCase());
  const setState = (n: string, state: LabHailState) => setRoster(roster.map(r => (r.name === n ? { ...r, state } : r)));
  const gone = view != null && view.ms_left === 0;

  return (
    <section className="bg-panel border border-border rounded-lg p-5" aria-label="Hail board preview">
      <h3 className="text-lg text-orange mb-1">Hail board</h3>
      <FakeBanner />

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="text-xs text-dim">Boss
          <select className={`${inputCls} block`} value={bossId} onChange={e => setBossId(e.target.value)}>
            {cfgs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-dim">Minutes since the kill
          <input type="number" min={0} max={60} className={`${inputCls} block w-24`} value={minutes}
                 onChange={e => setMinutes(Math.min(60, Math.max(0, Number(e.target.value) || 0)))} />
        </label>
        <span className="text-xs text-dim pb-1.5">
          {cfg.npc} stays {cfg.minutes ?? 20} min{cfg.flagCap ? `, flag cap ${cfg.flagCap}${cfg.flagTicks ? ` (counts ${cfg.flagTicks} per hail)` : ''}` : ', no cap read'}
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <div className="flex flex-wrap items-end gap-2 mb-2">
            <label className="text-xs text-dim">Add to roster
              <input className={`${inputCls} block w-32`} value={name} maxLength={24} placeholder="letters only"
                     onChange={e => setName(e.target.value)} />
            </label>
            <button type="button" className={btnCls} disabled={!nameOk}
                    onClick={() => { setRoster([...roster, { name: name.trim(), state: 'still' }]); setName(''); }}>
              Add
            </button>
            <button type="button" className={btnCls}
                    onClick={() => setRoster(LAB_FAKE_NAMES.map(n => roster.find(r => r.name === n) ?? { name: n, state: 'still' as LabHailState }))}>
              Fill 12 invented names
            </button>
          </div>
          <ul className="space-y-1">
            {roster.map(r => (
              <li key={r.name} className="flex items-center gap-2 text-sm">
                <span className="w-24 truncate">{r.name}</span>
                <select className={`${inputCls} text-xs`} value={r.state} aria-label={`${r.name} hail state`}
                        onChange={e => setState(r.name, e.target.value as LabHailState)}>
                  {LAB_HAIL_STATES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <button type="button" className="text-dim hover:text-red text-xs" aria-label={`Remove ${r.name}`}
                        onClick={() => setRoster(roster.filter(x => x.name !== r.name))}>✕</button>
              </li>
            ))}
          </ul>
          {cfg.prior.length === 0 && (
            <p className="text-xs text-dim mt-2">{cfg.name} has no prerequisite the board can claim, so “missing the step before” reads as plain still.</p>
          )}
        </div>

        {/* A Command Center lookalike: the order and wording of the Mimic card, drawn from buildViews' output. */}
        <div className="rounded-md border border-border bg-bg p-3 font-mono text-xs leading-5" aria-label="Command Center preview">
          {!view ? <p className="text-dim">No window.</p> : (
            <>
              <div className="flex justify-between gap-2 text-sm">
                <b className="text-gold">{view.boss_name}</b>
                <span className={gone ? 'text-red' : 'text-green'}>{gone ? 'NPC gone' : `${fmtLeft(view.ms_left)} left`}</span>
              </div>
              <div className="text-dim mb-2">{view.npc_name} · {view.zone}</div>
              <div className="mb-2">
                {view.flag_cap == null
                  ? <span className="text-dim">No flag cap known</span>
                  : <span>Flags: <b className="text-text">{view.flags_left}</b> left of {view.flag_cap} <span className="text-dim">({view.flags_granted} landed)</span></span>}
              </div>
              <HailList title={`Still to hail (${view.still.length})`} cls="text-orange" empty="Nobody left.">
                {view.still.map(s => (
                  <li key={s.name}>{s.name}{s.prior_missing && <span className="text-dim"> · missing the step before</span>}</li>
                ))}
              </HailList>
              <HailList title={`Hailed (${view.hailed.length})`} cls="text-green" empty="Nobody yet.">
                {view.hailed.map(h => (
                  <li key={h.name}>{h.name} <span className="text-dim">· {h.how === 'flag' ? 'flag landed' : h.how === 'seen' ? 'hail seen' : `tapped${h.by ? ` by ${h.by}` : ''}`}</span></li>
                ))}
              </HailList>
              <HailList title={`Already flagged (${view.already_flagged.length})`} cls="text-blue" empty="None.">
                {view.already_flagged.map(n => <li key={n}>{n}</li>)}
              </HailList>
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-dim mt-3">Clock fixed at {new Date(FAKE_NOW).toISOString().slice(11, 16)} UTC so the countdown is repeatable.</p>
    </section>
  );
}

function HailList({ title, cls, empty, children }: { title: string; cls: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <div className="mb-2">
      <div className={`${cls} font-bold`}>{title}</div>
      {items.length === 0 ? <div className="text-dim">{empty}</div> : <ul className="pl-3">{children}</ul>}
    </div>
  );
}

// ── Lab ────────────────────────────────────────────────────────────────────────────────────────────────

export default function FlagLab() {
  const [members, setMembers] = useState<LabMember[]>(MEMBER_SEED);
  const [roster, setRoster] = useState<LabHailMember[]>(HAIL_SEED);
  const [epoch, setEpoch] = useState(0);   // bumping it remounts the panels, so their own inputs reset too

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-dim leading-6">
          Pre-test the PoP flag gates and the hail board with invented raiders. Every name is made up.
        </p>
        <button type="button" className={btnCls}
                onClick={() => { setMembers(MEMBER_SEED); setRoster(HAIL_SEED); setEpoch(epoch + 1); }}>
          Reset sandbox
        </button>
      </div>
      <FlagMatrixPanel key={`m${epoch}`} members={members} setMembers={setMembers} />
      <HailBoardPanel key={`h${epoch}`} roster={roster} setRoster={setRoster} />
    </div>
  );
}
