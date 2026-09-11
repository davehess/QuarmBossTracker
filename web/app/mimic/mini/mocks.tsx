'use client';

// Animated overlay mocks for /mimic/mini. Every mock is a PURE function of
// the scenario clock `t` (seconds, looping every LOOP) and the Zeal toggle, so
// the page can drive them all from one ticker and freeze them for
// prefers-reduced-motion. Names and the parse are real (see lib/miniReview).
//
// The full-mode mocks approximate today's overlays from their own CSS; the
// minis are the three renditions per overlay. Nothing here talks to Mimic.

import { useState } from 'react';
import s from './mocks.module.css';
import { CAST, KAAS_PARSE, type Choice } from '@/lib/miniReview';

export const LOOP = 20;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r = (v: number) => Math.round(v);
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const k = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? r(n / 1e3) + 'k' : String(r(n));
const num = (n: number) => r(n).toLocaleString('en-US');
const hpCls = (p: number) => (p <= 25 ? s.lo : p <= 50 ? s.mid : s.hi);

// ── scenario ────────────────────────────────────────────────────────────────
function tankHp(t: number) {
  const frac = (t % 5) / 5;
  return { hp: clamp(r(100 - 34 * frac + 4 * Math.sin(t * 7)), 10, 100), flash: (t % 5) < 0.35 };
}
const mobHp = (t: number) => clamp(r(64 - 0.9 * t), 0, 100);
// Damage shield: the box shows what ONE hit returns — the sum of the tank's
// active DS buffs (Shield of Blades 65 + Barrier of Combustion 20) — not the
// fight's running total (Hitya 2026-09-11). It pops on each hit; the number
// only changes when a DS lands or fades.
const DS_PER_HIT = 85;
const dsHits = (t: number) => 13 + Math.floor(t / 0.8);
function ramp(t: number) {
  if (t < 6 || t >= 18) return null;
  const hp = clamp(r(58 - (t - 6) * 2.2 + 3 * Math.sin(t * 5)), 5, 100);
  const da = t >= 10 ? Math.max(0, 10 - (t - 10)) : null;
  return { who: CAST.rampTank, hp, da, crit: da != null && da <= 3 };
}
type ChState = 'casting' | 'interrupted' | 'landed' | 'queued';
function chain(t: number) {
  return CAST.clerics.map((name, i) => {
    const el = (((t - i * 4) % LOOP) + LOOP) % LOOP;
    const interrupted = name === 'Mcdorf' && el >= 6 && el < 10;
    const state: ChState = interrupted ? 'interrupted' : el < 10 ? 'casting' : el < 10.8 ? 'landed' : 'queued';
    return { name, el, state, startsIn: LOOP - el, me: name === CAST.me_cleric };
  });
}
function targetTimers(t: number) {
  const root = t < 14 ? 14 - t : t >= 17 ? 48 - (t - 17) : null;
  return { slow: 161 - t, root };
}
function charm(t: number) {
  const rem = 29 - t;
  return { rem, urgent: rem <= 10, petHp: clamp(r(71 - 0.3 * t + 2 * Math.sin(t * 4)), 0, 100), tick: (t % 6) / 6 };
}
type ExtRow = { name: string; hp: number; target: string | null; cc: 'S' | 'M' | null; chips: string[]; raiders: string[]; star?: boolean; count?: number };
function ext(t: number, zeal: boolean): ExtRow[] {
  const elder1: ExtRow = { name: 'an elder thought horror', hp: clamp(r(88 - 2 * t), 0, 100), target: CAST.mt, cc: 'S', chips: ["Turgur's Insects", 'Tashanian', 'Malosini'], raiders: ['Currygoat', 'Fittir', 'Fawx', 'Wabumkin', 'Dant', 'Lucker', 'Damyu', 'Atlasius', 'Pyxil'] };
  const elder2: ExtRow = { name: 'an elder thought horror', hp: clamp(r(30 + 2 * Math.sin(t * 3)), 0, 100), target: 'Syko', cc: null, chips: ['Tashanian'], raiders: ['Syko', 'Menttok', 'Kravenn'] };
  const guard: ExtRow | null = t < 15.3 ? { name: 'a horror guard', hp: clamp(r(46 - 3 * t), 0, 100), target: CAST.mt2, cc: 'M', chips: ['Glamour of Kintaz'], raiders: ['Hoden', 'Jankzer'] } : null;
  const evoker: ExtRow = { name: 'a thought horror evoker', hp: clamp(r(100 - 0.5 * t), 0, 100), target: null, cc: null, chips: [], raiders: ['Mezapod'] };
  if (zeal) return [elder1, ...(guard ? [guard] : []), elder2, evoker];
  // Older Zeal: name-keyed. The two elders collapse into ONE row whose HP is
  // whichever spawn the pipe saw last — it jumps between them every 2s.
  const pick = Math.floor(t / 2) % 2 === 0 ? elder1 : elder2;
  const merged: ExtRow = { ...elder1, hp: pick.hp, target: pick.target, star: true, count: 2, chips: [...elder1.chips, ...elder2.chips], raiders: [...elder1.raiders, ...elder2.raiders] };
  return [merged, ...(guard ? [guard] : []), evoker];
}
function pet(t: number) {
  return { hp: clamp(r(92 - 3 * Math.abs(Math.sin(t * 1.3))), 0, 100), hasteRem: 130 - t, haste: 66, target: CAST.bossShort };
}
function meter(t: number) {
  const elapsed = 129 + t;
  const rows = KAAS_PARSE.rows.map(([name, dmg]) => ({ name, dmg: dmg * elapsed / KAAS_PARSE.durationSec }));
  const total = KAAS_PARSE.total * elapsed / KAAS_PARSE.durationSec;
  const meIdx = rows.findIndex(x => x.name === CAST.me_dps);
  return { elapsed, rows, total, meIdx, gap: rows[meIdx - 1].dmg - rows[meIdx].dmg - 40 * t };
}
const POP_OBJ = [
  { label: 'Corner tank set', by: 'Currygoat', at: 0 },
  { label: 'Kite team on adds (54s)', by: 'Ghalix', at: 6 },
  { label: 'Melee at max range', by: 'Fittir', at: 13 },
  { label: 'Hail Projection at centre', by: null, at: null },
];
const popObjs = (t: number) => POP_OBJ.map(o => ({ ...o, done: o.at != null && t >= o.at }));
type Need = { who: string; g: number };
function queue(t: number) {
  const G = CAST.groups;
  const need = (names: string[]): Need[] => names.map(w => ({ who: w, g: G[w] ?? 6 }));
  const buffs: [string, Need[]][] = [
    ['Haste', need(t < 8 ? ['Currygoat', 'Hoden', 'Fittir', 'Fawx'] : ['Currygoat', 'Hoden', 'Fittir'])],
    ['Resists', need(['Wabumkin', 'Dant'])],
    ['Regen', need(['Ashieron'])],
    ['Shield', need(['Syko'])],
  ];
  const cures: [string, Need[]][] = [
    ['Curse', need(t < 12 ? ['Kravenn', 'Lucker', 'Hoden'] : ['Kravenn', 'Lucker'])],
    ['Poison', need(['Fittir'])],
  ];
  return { buffs, cures };
}

// ── atoms ───────────────────────────────────────────────────────────────────
function Hp({ pct, tail, thick, flash, cls }: { pct: number; tail?: React.ReactNode; thick?: boolean; flash?: boolean; cls?: string }) {
  return (
    <div className={[s.hr, cls ?? hpCls(pct), thick ? s.thick : '', flash ? s.flash : ''].join(' ')}>
      <span className={s.pct}>{pct}%</span>
      <span className={s.bar}><i style={{ width: `${pct}%` }} /></span>
      <span className={s.tail}>{tail}</span>
    </div>
  );
}
const Ctl = () => (<><span className={`${s.ctl} ${s.ctlL}`}>✥</span><span className={`${s.ctl} ${s.ctlR}`}>✕</span></>);
function Ds({ t, off }: { t: number; off?: boolean }) {
  const n = dsHits(t);
  return <span key={n} className={[s.ds, s.dsPop, off ? s.dsOff : ''].join(' ')} title="damage returned on each hit — the sum of the tank's damage-shield buffs">{DS_PER_HIT}/hit</span>;
}
const Mr = ({ cur, full }: { cur: number; full: number }) => (<span className={s.t}>MR <span className={s.mrDown}>{cur}</span> <span className={s.dim}>({full})</span></span>);
const Star = () => <span className={s.star}>*</span>;
const NameOnlyFoot = () => <div className={s.foot}><Star /> name-only on this Zeal — may include another same-name mob</div>;

// ── TANK ────────────────────────────────────────────────────────────────────
function TankFull({ t }: { t: number }) {
  const { hp, flash } = tankHp(t); const rp = ramp(t);
  return (
    <div className={s.ov}><Ctl />
      <div className={s.ttl}>🛡 Tank · {CAST.mt}</div>
      <Hp pct={hp} thick flash={flash} tail={<><span className={s.nm}>{CAST.mt}</span><span className={s.dim}>{num(hp * 62)}/6,200</span></>} />
      <div className={`${s.chrow} ${s.casting}`}><span className={s.num}>CH</span><span>← Fargan</span><span>{(10 - (t % 10)).toFixed(1)}s</span><div className={s.cbar}><i style={{ width: `${(t % 10) * 10}%` }} /></div></div>
      <div style={{ color: '#56d364', fontWeight: 700, fontSize: 13 }}>{num(DS_PER_HIT * dsHits(t))} returned <span style={{ color: '#7ee787' }}>· {DS_PER_HIT}/hit</span> <span className={s.dim} style={{ fontWeight: 400, fontSize: 10 }}>· {dsHits(t)} hits</span></div>
      <div className={s.foot} style={{ fontStyle: 'normal' }}>Shield of Blades 65 · Barrier of Combustion 20</div>
      {rp && (
        <div className={s.ramp}>
          <div style={{ display: 'flex', gap: 6 }}>💀 Rampage on <span className={s.who}>{rp.who}</span>{rp.da != null && <span className={s.da}>DA in {r(rp.da)}s</span>}</div>
          <Hp pct={rp.hp} thick tail={rp.crit ? <span className={s.call}>— start CH on {rp.who}!</span> : <span className={s.dim}>{num(rp.hp * 58)}/5,800</span>} />
        </div>
      )}
    </div>
  );
}
function TankMini({ t, choice }: { t: number; choice: Choice }) {
  const { hp, flash } = tankHp(t); const rp = ramp(t); const mob = mobHp(t);
  if (choice === 'a') return (
    <div className={s.ov}><Ctl />
      <Hp pct={hp} flash={flash} tail={<><span className={s.nm}>{CAST.mt}</span><span className={s.arr}>←</span><span className={s.tg}>{CAST.bossShort}</span><Ds t={t} /></>} />
      {rp && <div className={s.ramp}><Hp pct={rp.hp} tail={<><span className={s.who}>💀 {rp.who}</span>{rp.da != null && <span className={s.da}>DA {r(rp.da)}s</span>}{rp.crit && <span className={s.call}>CH!</span>}</>} /></div>}
    </div>);
  if (choice === 'b') return (
    <div className={s.ov}><Ctl />
      <Hp pct={mob} tail={<span className={s.tg}>{CAST.bossShort}</span>} />
      <Hp pct={hp} flash={flash} tail={<><span className={s.nm}>{CAST.mt}</span><Ds t={t} /></>} />
      {rp && <div className={s.ramp}><Hp pct={rp.hp} tail={<><span className={s.who}>💀 {rp.who}</span>{rp.da != null && <span className={s.da}>DA {r(rp.da)}s</span>}</>} /></div>}
    </div>);
  return (
    <div className={s.ov}><Ctl />
      <Hp pct={hp} flash={flash} tail={<><span className={s.nm}>{CAST.mt}</span><span className={s.arr}>←</span><span className={s.tg}>{CAST.bossShort}</span><Ds t={t} />{rp && <span className={s.rampChip}>💀 {rp.who} {rp.hp}%{rp.da != null ? ` · DA ${r(rp.da)}s` : ''}{rp.crit ? ' · CH!' : ''}</span>}</>} />
    </div>);
}

// ── TARGET INFO ─────────────────────────────────────────────────────────────
const RESISTS: [string, number, number | null][] = [['AC', 1150, null], ['MR', 100, 40], ['FR', 75, null], ['CR', 75, null], ['PR', 80, 60], ['DR', 80, 60]];
function TargetFull({ t, zeal }: { t: number; zeal: boolean }) {
  const hp = mobHp(t); const { slow, root } = targetTimers(t);
  const rows: [string, number, number][] = [['Tashanian', 132 - t, 180], ["Turgur's Insects", slow, 180], ['Malosini', 110 - t, 180], ...(root != null ? [['Enveloping Roots', root, 48] as [string, number, number]] : [])];
  return (
    <div className={s.ov}><Ctl />
      <div className={s.ttl}>🎯 Target <span className={s.tabs}><span className={`${s.tab} ${s.tabOn}`}>Stats</span><span className={s.tab}>Loot</span><span className={s.tab}>Spells</span></span></div>
      <div><span className={s.nm}>{CAST.boss}</span>{!zeal && <Star />} <span className={s.dim}>· L66 · Ssraeshza</span></div>
      <Hp pct={hp} thick tail={<span className={s.dim}>{k(hp * 19000)} / 1.9M</span>} />
      <div className={s.pill + ' ' + s.slow} style={{ alignSelf: 'flex-start' }}>SLOWED · Turgur&apos;s · by Utoh · {mmss(slow)}</div>
      <div className={s.rgrid}>{RESISTS.map(([n, full, cur]) => (
        <div key={n} className={s.rs}><b>{n}</b><span className={`${s.cur} ${cur != null ? s.mrDown : ''}`}>{num(cur ?? full)}</span><span className={s.full}>{cur != null ? `(${full})` : ''}</span></div>
      ))}</div>
      <div className={s.sech}><span className={s.sechC}>debuffs</span><span className={s.dim}>{rows.length}</span></div>
      {rows.map(([n, rem, tot]) => (
        <div key={n} className={s.tm + ' ' + s.tmRed}><span className={s.lab}>{n}</span><span className={s.bar}><i style={{ width: `${clamp(rem / tot * 100, 0, 100)}%` }} /></span><span className={s.t}>{mmss(Math.max(0, rem))}</span></div>
      ))}
      {!zeal && <NameOnlyFoot />}
    </div>
  );
}
function TargetMini({ t, zeal, choice }: { t: number; zeal: boolean; choice: Choice }) {
  const hp = mobHp(t); const { slow, root } = targetTimers(t);
  const name = <span className={s.tg}>{CAST.bossShort}{!zeal && <Star />}</span>;
  if (choice === 'a') return (
    <div className={s.ov}><Ctl />
      <Hp pct={hp} tail={<>{name}<span className={`${s.pill} ${s.slow}`}>SLOW {mmss(slow)}</span>{root != null ? <span className={`${s.pill} ${s.root} ${root <= 12 ? s.urgent : ''}`}>ROOT {mmss(root)}</span> : <span className={`${s.pill} ${s.ghost}`}>no root</span>}</>} />
      {!zeal && <NameOnlyFoot />}
    </div>);
  if (choice === 'b') return (
    <div className={s.ov}><Ctl />
      <Hp pct={hp} tail={name} />
      <div className={`${s.tm} ${s.tmSlow}`}><span className={s.lab}>SLOW</span><span className={s.bar}><i style={{ width: `${slow / 180 * 100}%` }} /></span><span className={s.t}>{mmss(slow)}</span></div>
      {root != null && <div className={`${s.tm} ${s.tmRoot}`}><span className={s.lab}>ROOT</span><span className={s.bar}><i style={{ width: `${root / 48 * 100}%` }} /></span><span className={s.t}>{mmss(root)}</span></div>}
      {!zeal && <NameOnlyFoot />}
    </div>);
  return (
    <div className={s.ov}><Ctl />
      <div className={s.line2}>
        <Hp pct={hp} tail={name} />
        <div className={s.hairline} title={`slow ${mmss(slow)}`}><i style={{ width: `${slow / 180 * 100}%`, background: '#f0b429' }} /></div>
        <div className={s.hairline} title={root != null ? `root ${mmss(root)}` : 'not rooted'}><i style={{ width: `${root != null ? root / 48 * 100 : 0}%`, background: '#58a6ff' }} /></div>
      </div>
      {!zeal && <NameOnlyFoot />}
    </div>);
}

// ── CH CHAIN ────────────────────────────────────────────────────────────────
function MtRow({ t }: { t: number }) { const { hp, flash } = tankHp(t); return <Hp pct={hp} flash={flash} tail={<><span className={s.nm}>{CAST.mt}</span><span className={s.dim}>MT</span></>} />; }
function ChRow({ h, i, showBar }: { h: ReturnType<typeof chain>[number]; i: number; showBar: boolean }) {
  const cls = h.state === 'casting' ? s.casting : h.state === 'interrupted' ? s.interrupted : h.state === 'landed' ? s.landed : '';
  const txt = h.state === 'casting' ? `casting · ${(10 - h.el).toFixed(1)}s` : h.state === 'interrupted' ? 'INTERRUPTED' : h.state === 'landed' ? 'landed ✓' : `in ${h.startsIn.toFixed(1)}s`;
  const isNext = h.state === 'queued' && h.startsIn <= 4;
  return (
    <div className={`${s.chrow} ${cls} ${isNext ? s.next : ''}`}>
      <span className={s.num}>#{i + 1}</span><span>{h.name}{h.me ? ' (you)' : ''}</span><span>{isNext ? `GO in ${h.startsIn.toFixed(1)}s` : txt}</span>
      {showBar && (h.state === 'casting' || h.state === 'interrupted') && <div className={s.cbar}><i className={h.state === 'interrupted' ? s.red : ''} style={{ width: `${(h.state === 'interrupted' ? 6 : h.el) * 10}%` }} /></div>}
    </div>
  );
}
function ChFull({ t }: { t: number }) {
  const hs = chain(t);
  return (
    <div className={s.ov}><Ctl />
      <div className={s.ttl}>⛑ CH chain · {CAST.mt}</div>
      <MtRow t={t} />
      {hs.map((h, i) => <ChRow key={h.name} h={h} i={i} showBar />)}
    </div>
  );
}
function ChMini({ t, choice }: { t: number; choice: Choice }) {
  const hs = chain(t);
  if (choice === 'a') {
    const me = hs.find(h => h.me)!; const i = hs.indexOf(me);
    return (<div className={s.ov}><Ctl /><MtRow t={t} /><ChRow h={me} i={i} showBar /></div>);
  }
  if (choice === 'b') return (
    <div className={`${s.ov} ${s.wide}`}><Ctl />
      <MtRow t={t} />
      <div className={s.axis}><span>◀ lands</span><span>│ cast starts</span><span>next ▶</span></div>
      {hs.map(h => {
        let blk: React.ReactNode = null;
        if (h.state === 'casting') blk = <span className={`${s.blk} ${s.bC}`} style={{ left: `${50 - h.el * 5}%`, width: `${Math.max(2, h.el * 5)}%` }} />;
        else if (h.state === 'interrupted') blk = <span className={`${s.blk} ${s.bX}`} style={{ left: '20%', width: '30%' }} />;
        else if (h.state === 'landed') blk = <span className={`${s.blk} ${s.bL}`} style={{ left: 0, width: '6%' }} />;
        else if (h.startsIn <= 9) blk = <span className={`${s.blk} ${s.bQ}`} style={{ left: `${50 + h.startsIn * 5}%`, width: '10%' }} />;
        const c = h.state === 'casting' ? s.cC : h.state === 'interrupted' ? s.cX : h.state === 'landed' ? s.cL : h.startsIn <= 9 ? s.cQ : s.cI;
        return <div key={h.name} className={s.lane}><span className={`${s.lnm} ${c}`}>{h.name}</span><span className={s.trk}>{blk}</span></div>;
      })}
    </div>);
  return (
    <div className={s.ov}><Ctl />
      <MtRow t={t} />
      <div className={s.ladder}>
        {hs.map(h => {
          const d = h.state === 'casting' ? s.dC : h.state === 'interrupted' ? s.dX : h.state === 'landed' ? s.dL : h.startsIn <= 4 ? s.dQ : s.dI;
          const txt = h.state === 'casting' ? `${(10 - h.el).toFixed(1)}s` : h.state === 'interrupted' ? 'INT' : h.state === 'landed' ? '✓' : `${h.startsIn.toFixed(0)}s`;
          return (<div key={h.name} style={{ display: 'contents' }}>
            <span><i className={`${s.dot} ${d}`} /></span>
            <span className={h.me ? s.nm : ''}>{h.name}</span>
            <span className={s.t}>{txt}</span>
            {h.state === 'casting' && <div className={s.cbar} style={{ gridColumn: '1 / -1' }}><i style={{ width: `${h.el * 10}%` }} /></div>}
          </div>);
        })}
      </div>
    </div>);
}

// ── CHARM ───────────────────────────────────────────────────────────────────
const CHARM_PET = 'a thought horror evoker', CHARM_TGT = 'an elder thought horror';
function CharmFull({ t, zeal }: { t: number; zeal: boolean }) {
  const c = charm(t);
  return (
    <div className={s.ov}><Ctl />
      <div className={s.ttl}>🐺 Charm · {CAST.enchanter}</div>
      <div><span className={s.nm}>{CHARM_PET}</span>{!zeal && <Star />} <span className={`${s.pill} ${s.mez}`}>CHARMED</span></div>
      <div className={`${s.tm} ${s.tmCharm}`}><span className={s.lab}>tick</span><span className={s.bar}><i style={{ width: `${c.tick * 100}%` }} /></span><span className={s.t}>{(6 - c.tick * 6).toFixed(0)}s</span></div>
      <div className={`${s.tm} ${c.urgent ? s.tmRed : s.tmCharm}`}><span className={s.lab}>{c.urgent ? 'RECHARM' : 'charm'}</span><span className={s.bar}><i style={{ width: `${c.rem / 30 * 100}%` }} /></span><span className={s.t}>{mmss(Math.max(0, c.rem))}</span></div>
      <Hp pct={c.petHp} tail={<><span className={s.arr}>→</span><span className={s.tg}>{CHARM_TGT}</span></>} />
      <div><span className={s.bchip}>Tashanian<span className={s.rem}>2:12</span></span><span className={s.bchip}>Haste<span className={s.rem}>{mmss(130 - t)}</span></span></div>
      {!zeal && <NameOnlyFoot />}
    </div>
  );
}
function CharmMini({ t, zeal, choice }: { t: number; zeal: boolean; choice: Choice }) {
  const c = charm(t); const mr = <Mr cur={30} full={65} />;
  if (choice === 'a') return (
    <div className={s.ov}><Ctl />
      <Hp pct={c.petHp} tail={<><span className={s.nm}>{CHARM_PET}{!zeal && <Star />}</span><span className={s.arr}>→</span><span className={s.tg}>{CHARM_TGT}</span></>} />
      <div className={`${s.tm} ${c.urgent ? s.tmRed : s.tmCharm}`}><span className={s.lab}>⏳ {mmss(Math.max(0, c.rem))}{c.urgent ? ' recharm' : ''}</span><span className={s.bar}><i style={{ width: `${c.rem / 30 * 100}%` }} /></span>{mr}</div>
      {!zeal && <NameOnlyFoot />}
    </div>);
  if (choice === 'b') return (
    <div className={s.ov}><Ctl />
      <div className={`${s.tm} ${c.urgent ? s.tmRed : s.tmCharm}`}><span className={s.lab}>⏳ {mmss(Math.max(0, c.rem))}</span><span className={s.bar}><i style={{ width: `${c.rem / 30 * 100}%` }} /></span><span className={s.t}><span className={hpCls(c.petHp)}><span className={s.pct}>{c.petHp}%</span></span> {CHARM_PET}{!zeal && <Star />} <span className={s.dim}>→</span> <span className={s.tg}>{CHARM_TGT}</span> · {mr}</span></div>
      {!zeal && <NameOnlyFoot />}
    </div>);
  return (
    <div className={`${s.ov} ${s.narrow}`} title={`${CHARM_PET} → ${CHARM_TGT}`}><Ctl />
      <div className={`${s.big} ${c.urgent ? s.bigRed : ''}`} style={{ textAlign: 'center' }}>{mmss(Math.max(0, c.rem))}</div>
      <div className={s.hairline}><i style={{ width: `${c.petHp}%`, background: c.petHp > 50 ? '#56d364' : c.petHp > 25 ? '#f0b429' : '#f85149' }} /></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}><span className={hpCls(c.petHp)}><span className={s.pct}>{c.petHp}%</span></span>{mr}{!zeal && <Star />}</div>
    </div>);
}

// ── EXTENDED TARGET ─────────────────────────────────────────────────────────
function ExtFull({ t, zeal }: { t: number; zeal: boolean }) {
  const rows = ext(t, zeal);
  return (
    <div className={`${s.ov} ${s.wide}`}><Ctl />
      <div className={s.ttl}>🎯 Extended target · {rows.length} mobs</div>
      {rows.map((m, i) => (
        <div key={i} style={{ borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 2 }}>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}><span className={s.tg}>{m.name}{m.star && <Star />}</span>{m.cc === 'S' && <span className={`${s.pill} ${s.slow}`}>SLOW</span>}{m.cc === 'M' && <span className={`${s.pill} ${s.mez}`}>MEZ</span>}<span className={s.dim} style={{ marginLeft: 'auto', fontSize: 10 }}>{m.raiders.length} on it</span></div>
          <Hp pct={m.hp} thick tail={m.target ? <><span className={s.arr}>→</span><span className={s.nm}>{m.target}</span></> : <span className={s.dim}>—</span>} />
          <div>{m.chips.map(c => <span key={c} className={s.bchip}>{c}</span>)}</div>
          <div className={s.foot} style={{ fontStyle: 'normal' }}>{m.raiders.slice(0, 4).join(', ')}{m.raiders.length > 4 ? ` +${m.raiders.length - 4}` : ''}</div>
        </div>
      ))}
      {!zeal && <div className={s.foot}><Star /> non-unique name — buffs/debuffs may be inaccurate (same-name mobs share a name on the pipe)</div>}
    </div>
  );
}
function ExtMini({ t, zeal, choice }: { t: number; zeal: boolean; choice: Choice }) {
  const rows = ext(t, zeal);
  const tail = (m: ExtRow) => (<>
    <span className={s.tg}>{m.name}{m.star && <Star />}</span>
    <span className={s.arr}>→</span>{m.target ? <span className={s.nm}>{m.target}</span> : <span className={s.dim}>—</span>}
    {choice === 'a' && m.cc === 'S' && <span className={`${s.pill} ${s.slow}`}>S</span>}
    {choice === 'a' && m.cc === 'M' && <span className={`${s.pill} ${s.mez}`}>M</span>}
    {choice === 'a' && m.chips.length > 0 && <span className={`${s.pill} ${s.ghost}`} title={m.chips.join(', ')}>·{m.chips.length}</span>}
  </>);
  if (choice !== 'c') return (
    <div className={`${s.ov} ${s.wide}`}><Ctl />
      {rows.map((m, i) => <Hp key={i} pct={m.hp} tail={tail(m)} />)}
      {!zeal && <NameOnlyFoot />}
    </div>);
  // C — grouped by name: ×N and the lowest HP of the group.
  const groups = new Map<string, ExtRow[]>();
  for (const m of rows) groups.set(m.name, [...(groups.get(m.name) ?? []), m]);
  return (
    <div className={`${s.ov} ${s.wide}`}><Ctl />
      {[...groups.entries()].map(([name, ms]) => {
        const low = ms.reduce((a, b) => (a.hp < b.hp ? a : b));
        const n = ms.length > 1 ? ms.length : (ms[0].count ?? 1);
        return <Hp key={name} pct={low.hp} tail={<><span className={s.tg}>{name}{ms[0].star && <Star />}</span>{n > 1 && <span className={`${s.pill} ${s.ghost}`}>×{n}{zeal ? '' : '?'}</span>}<span className={s.dim}>lowest</span></>} />;
      })}
      {!zeal && <div className={s.foot}><Star /> older Zeal cannot count same-name mobs — every ×N is a guess</div>}
    </div>);
}

// ── PET ─────────────────────────────────────────────────────────────────────
function PetFull({ t }: { t: number }) {
  const p = pet(t);
  return (
    <div className={s.ov}><Ctl />
      <div className={s.ttl}>🐾 Pets</div>
      <div className={s.pet}>
        <div><span className={s.nm}>{CAST.magePet}</span> <span className={s.owner}>{CAST.mage}</span></div>
        <Hp pct={p.hp} thick tail={<span className={s.dim}>HP</span>} />
        <div className={s.foot} style={{ fontStyle: 'normal' }}>→ <span className={s.tg}>{p.target}</span> <span className={s.dim}>{r(t % 7)}s ago</span></div>
        <div className={s.bufb}>Burnout V<div className={s.bb}><i style={{ width: `${p.hasteRem / 180 * 100}%`, background: '#56d364' }} /></div></div>
        <div className={s.bufb}>Aegis of Ro<div className={s.bb}><i style={{ width: '72%', background: '#56d364' }} /></div></div>
      </div>
    </div>
  );
}
function PetMini({ t, choice }: { t: number; choice: Choice }) {
  const p = pet(t);
  const haste = <span className={`${s.pill} ${s.ghost}`} style={{ color: p.hasteRem <= 10 ? '#f0b429' : '#56d364' }}>⚡{p.haste}%</span>;
  if (choice === 'a') return (<div className={s.ov}><Ctl /><Hp pct={p.hp} tail={<><span className={s.nm}>{CAST.magePet}</span><span className={s.arr}>→</span><span className={s.tg}>{p.target}</span>{haste}</>} /></div>);
  if (choice === 'b') return (
    <div className={s.ov}><Ctl />
      <Hp pct={p.hp} tail={<><span className={s.nm}>{CAST.magePet}</span><span className={s.arr}>→</span><span className={s.tg}>{p.target}</span></>} />
      <div className={`${s.tm} ${s.tmHaste}`}><span className={s.lab}>⚡ {p.haste}%</span><span className={s.bar}><i style={{ width: `${p.hasteRem / 180 * 100}%` }} /></span><span className={s.t}>{mmss(p.hasteRem)}</span></div>
    </div>);
  return (
    <div className={`${s.ov} ${s.narrow}`} title={`${CAST.magePet} → ${p.target}`}><Ctl />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'baseline', paddingTop: 6 }}>
        <span className={`${s.big} ${hpCls(p.hp)}`} style={{ color: p.hp > 50 ? '#56d364' : p.hp > 25 ? '#f0b429' : '#f85149' }}>{p.hp}%</span>
        <span className={s.big} style={{ color: '#d29922', fontSize: 14 }}>⚡{p.haste}%</span>
      </div>
      <div style={{ textAlign: 'center', fontSize: 10 }}><span className={s.arr}>→</span> <span className={s.tg}>{p.target}</span></div>
    </div>);
}

// ── DPS / TANK METER ────────────────────────────────────────────────────────
function Tabs({ copied }: { copied?: boolean }) {
  return <span className={s.tabs}><span className={s.tab} style={copied ? { color: '#56d364', borderColor: '#56d364' } : undefined}>{copied ? '✓' : '📋'}</span><span className={s.tab}>−</span><span>6</span><span className={s.tab}>+</span><span className={`${s.tab} ${s.tabOn}`}>DPS</span><span className={s.tab}>Tank</span><span className={s.tab}>Hist</span></span>;
}
function Rank({ i, name, dmg, elapsed, total, me, red }: { i: number; name: string; dmg: number; elapsed: number; total: number; me?: boolean; red?: boolean }) {
  return (
    <div className={`${s.rank} ${me ? s.me : ''}`}>
      <span className={s.r}>#{i + 1}</span><span className={s.n}>{name}</span>
      <span className={s.v}>{k(dmg)} <small>@{num(dmg / elapsed)}</small></span>
      <span className={`${s.share} ${red ? s.shareRed : ''}`}><i style={{ width: `${dmg / total * 100}%` }} /></span>
    </div>
  );
}
function DpsFull({ t }: { t: number }) {
  const m = meter(t); const N = 6;
  return (
    <div className={`${s.ov} ${s.wide}`}><Ctl />
      <div className={s.ttl}><span style={{ color: '#56d364' }}>●</span><span>⚔️ {KAAS_PARSE.boss}</span><Tabs copied={t % LOOP > 15 && t % LOOP < 17} /></div>
      {m.rows.slice(0, N).map((x, i) => <Rank key={x.name} i={i} name={x.name} dmg={x.dmg} elapsed={m.elapsed} total={m.total} />)}
      <div className={s.meExtra}><Rank i={m.meIdx} name={CAST.me_dps} dmg={m.rows[m.meIdx].dmg} elapsed={m.elapsed} total={m.total} me /></div>
      <div className={s.foot} style={{ fontStyle: 'normal' }}>{k(m.total)} · {m.elapsed}s · {num(m.total / m.elapsed)} dps</div>
    </div>
  );
}
function DpsMini({ t, choice }: { t: number; choice: Choice }) {
  const m = meter(t); const me = m.rows[m.meIdx];
  if (choice === 'a') return (
    <div className={s.ov}><Ctl />
      <div className={`${s.rank} ${s.me}`}><span className={s.r}>#{m.meIdx + 1}</span><span className={s.n}>{me.name} <span className={s.dim}>· {KAAS_PARSE.boss}</span></span><span className={s.v}>{k(me.dmg)} <small>@{num(me.dmg / m.elapsed)} · {(me.dmg / m.total * 100).toFixed(1)}%</small></span><span className={s.share}><i style={{ width: `${me.dmg / m.total * 100}%` }} /></span></div>
    </div>);
  if (choice === 'b') return (
    <div className={s.ov}><Ctl />
      {[m.meIdx - 1, m.meIdx, m.meIdx + 1].map(i => <Rank key={i} i={i} name={m.rows[i].name} dmg={m.rows[i].dmg} elapsed={m.elapsed} total={m.total} me={i === m.meIdx} />)}
    </div>);
  const above = m.rows[m.meIdx - 1];
  return (
    <div className={s.ov}><Ctl />
      <div className={`${s.rank} ${s.me}`}><span className={s.r}>#{m.meIdx + 1}</span><span className={s.n}>{me.name} <span className={s.gap}>−{k(m.gap)} to {above.name} ↑</span></span><span className={s.v}>{k(me.dmg)} <small>@{num(me.dmg / m.elapsed)}</small></span><span className={s.share}><i style={{ width: `${me.dmg / m.total * 100}%` }} /></span></div>
    </div>);
}

// ── POP RAIDS ───────────────────────────────────────────────────────────────
function PopFull({ t }: { t: number }) {
  const objs = popObjs(t);
  return (
    <div className={`${s.ov} ${s.wide}`}><Ctl />
      <div className={s.ttl}>PoP · Plane of Time · P4 Rallos Zek <span style={{ marginLeft: 'auto' }}>◀ 4/9 ▶ · ↗</span></div>
      <div className={s.notes}>DPS check; corner tank; adds every 54s (kite team); melee at max range (AE ramp). Hail Projection center.</div>
      <div className={s.sech}><span className={s.sechB}>tracker</span><span className={s.dim}>raid-wide</span></div>
      {objs.map(o => <div key={o.label} className={`${s.obj} ${o.done ? s.done : ''}`}><span>{o.done ? '☑' : '☐'}</span><span>{o.label}</span>{o.done && <span className={s.by}>✓ {o.by}</span>}</div>)}
      <div className={s.sech}><span className={s.sechB}>loot</span></div>
      <div className={s.foot} style={{ fontStyle: 'normal' }}>Mark of Rallos Zek · Warlord&apos;s Crown of Might · …</div>
    </div>
  );
}
function PopMini({ t, choice }: { t: number; choice: Choice }) {
  const objs = popObjs(t); const done = objs.filter(o => o.done).length;
  const [open, setOpen] = useState(false);
  if (choice === 'a') return (
    <div className={s.ov}><Ctl />
      <div className={s.ttl}>PoP · P4 Rallos <span style={{ marginLeft: 'auto' }}>↗</span></div>
      {objs.map(o => <div key={o.label} className={`${s.obj} ${o.done ? s.done : ''}`}><span>{o.done ? '☑' : '☐'}</span><span>{o.label}</span>{o.done && <span className={s.by}>✓ {o.by}</span>}</div>)}
    </div>);
  if (choice === 'b') return (
    <div className={s.ov}><Ctl />
      <div className={s.ttl}>PoP · P4 Rallos <button type="button" className={s.chip} onClick={() => setOpen(v => !v)}><b>{done}</b>/{objs.length} ✓</button><span style={{ marginLeft: 'auto' }}>↗</span></div>
      {open && objs.map(o => <div key={o.label} className={`${s.obj} ${o.done ? s.done : ''}`}><span>{o.done ? '☑' : '☐'}</span><span>{o.label}</span></div>)}
      {!open && <div className={s.foot}>click the count to expand</div>}
    </div>);
  const next = objs.find(o => !o.done);
  return (
    <div className={s.ov}><Ctl />
      <div className={s.obj}><span className={s.dim}>{done}/{objs.length}</span><span>☐ <span className={s.nm}>{next ? next.label : 'all done'}</span></span><span style={{ marginLeft: 'auto' }}>↗</span></div>
    </div>);
}

// ── BUFF QUEUE ──────────────────────────────────────────────────────────────
function BuffFull({ t }: { t: number }) {
  const q = queue(t);
  return (
    <div className={`${s.ov} ${s.wide}`}><Ctl />
      <div className={s.sech}><span className={s.sechC}>🩸 Debuff queue</span><span className={s.dim}>{q.cures.reduce((a, [, n]) => a + n.length, 0)}</span><span className={s.dim}>cures needed · curse → blind → poison → disease</span></div>
      {q.cures.flatMap(([cat, ns]) => ns.map(n => <div key={cat + n.who} className={s.qrow}><span><span className={s.nm}>{n.who}</span> <span className={s.dim}>G{n.g}</span> · {cat}</span><span className={s.dim}>{cat === 'Curse' ? 'Remove Greater Curse' : 'Abolish Poison'}</span></div>))}
      <div className={s.sech}><span className={s.sechB}>✨ Buff queue</span><span className={s.dim}>{q.buffs.reduce((a, [, n]) => a + n.length, 0)}</span><span className={s.dim}>online · same zone first</span></div>
      {q.buffs.flatMap(([cat, ns]) => ns.map(n => <div key={cat + n.who} className={s.qrow}><span><span className={s.nm}>{n.who}</span> <span className={s.dim}>G{n.g}</span> · {cat}</span><span className={s.dim}>{cat === 'Haste' ? 'Celerity' : cat === 'Resists' ? 'Talisman of Epuration' : cat === 'Regen' ? 'Regrowth' : 'Shield of Blades'}</span></div>))}
    </div>
  );
}
function BuffMini({ t, choice }: { t: number; choice: Choice }) {
  const q = queue(t);
  const [open, setOpen] = useState<string | null>(null);
  const chip = (cat: string, ns: Need[], cure: boolean) => (
    <button key={cat} type="button" className={`${s.chip} ${cure ? s.cure : ''} ${open === cat ? s.chipOn : ''}`} onClick={() => setOpen(o => (o === cat ? null : cat))}>{cat} <b>{ns.length}</b></button>
  );
  const expanded = (ns: Need[]) => <div className={s.exp}>{ns.map(n => <span key={n.who}>{n.who} <span className={s.g}>G{n.g}</span></span>)}</div>;
  const all = [...q.cures.map(x => [...x, true] as [string, Need[], boolean]), ...q.buffs.map(x => [...x, false] as [string, Need[], boolean])];
  const openNs = all.find(([c]) => c === open)?.[1];
  if (choice === 'a') return (
    <div className={`${s.ov} ${s.wide}`}><Ctl />
      <div className={s.chips}><span className={s.clab}>🩸 cure</span>{q.cures.map(([c, ns]) => chip(c, ns, true))}</div>
      <div className={s.chips}><span className={s.clab}>✨ buff</span>{q.buffs.map(([c, ns]) => chip(c, ns, false))}</div>
      {openNs ? expanded(openNs) : <div className={s.foot}>click a category to see who</div>}
    </div>);
  if (choice === 'b') return (
    <div className={`${s.ov} ${s.wide}`}><Ctl />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
        <div className={s.chips}><span className={s.clab}>✨ buff</span></div><div className={s.chips}><span className={s.clab}>🩸 cure</span></div>
        {Array.from({ length: Math.max(q.buffs.length, q.cures.length) }).flatMap((_, i) => [
          <div key={'b' + i}>{q.buffs[i] ? chip(q.buffs[i][0], q.buffs[i][1], false) : null}</div>,
          <div key={'c' + i}>{q.cures[i] ? chip(q.cures[i][0], q.cures[i][1], true) : null}</div>,
        ])}
      </div>
      {openNs && expanded(openNs)}
    </div>);
  // C — by group
  const byG = new Map<number, { who: string; what: string }[]>();
  for (const [cat, ns, cure] of all) for (const n of ns) byG.set(n.g, [...(byG.get(n.g) ?? []), { who: n.who, what: (cure ? '🩸 ' : '') + cat }]);
  const gOpen = open ? Number(open) : null;
  return (
    <div className={`${s.ov} ${s.wide}`}><Ctl />
      <div className={s.tiles}>{[1, 2, 3, 4, 5, 6].map(g => {
        const items = byG.get(g) ?? []; const hot = items.some(x => x.what.startsWith('🩸'));
        return <button key={g} type="button" className={`${s.tile} ${gOpen === g ? s.tileOn : ''} ${hot ? s.tileHot : ''}`} onClick={() => setOpen(o => (o === String(g) ? null : String(g)))}>G{g}<b>{items.length || '·'}</b></button>;
      })}</div>
      {gOpen != null ? <div className={s.exp}>{(byG.get(gOpen) ?? []).map(x => <span key={x.who + x.what}>{x.who} <span className={s.g}>{x.what}</span></span>)}</div> : <div className={s.foot}>click a group to see who needs what</div>}
    </div>);
}

// ── public surface ──────────────────────────────────────────────────────────
export function FullMock({ overlay, t, zeal }: { overlay: string; t: number; zeal: boolean }) {
  switch (overlay) {
    case 'tank': return <TankFull t={t} />;
    case 'target': return <TargetFull t={t} zeal={zeal} />;
    case 'ch': return <ChFull t={t} />;
    case 'charm': return <CharmFull t={t} zeal={zeal} />;
    case 'ext': return <ExtFull t={t} zeal={zeal} />;
    case 'pet': return <PetFull t={t} />;
    case 'dps': return <DpsFull t={t} />;
    case 'pop': return <PopFull t={t} />;
    case 'buff': return <BuffFull t={t} />;
    default: return null;
  }
}
export function MiniMock({ overlay, choice, t, zeal }: { overlay: string; choice: Choice; t: number; zeal: boolean }) {
  switch (overlay) {
    case 'tank': return <TankMini t={t} choice={choice} />;
    case 'target': return <TargetMini t={t} zeal={zeal} choice={choice} />;
    case 'ch': return <ChMini t={t} choice={choice} />;
    case 'charm': return <CharmMini t={t} zeal={zeal} choice={choice} />;
    case 'ext': return <ExtMini t={t} zeal={zeal} choice={choice} />;
    case 'pet': return <PetMini t={t} choice={choice} />;
    case 'dps': return <DpsMini t={t} choice={choice} />;
    case 'pop': return <PopMini t={t} choice={choice} />;
    case 'buff': return <BuffMini t={t} choice={choice} />;
    default: return null;
  }
}

/** The right-click menu with the two new rows — shown once in the ground rules. */
export function MenuMock() {
  return (
    <div className={s.menu}>
      <span>🛠 Setup ALL overlays</span>
      <span>🛠 Setup THIS overlay</span>
      <span className={s.mdim}>👁 Hide this overlay</span>
      <span className={s.new}>▭ Mini mode: ON (this overlay)</span>
      <span className={s.new}>📌 Keep mini through Minimize-all: off</span>
      <span className={s.mdim}>🌫 Background: off (this overlay)</span>
      <span className={s.mdim}>⬆ Grow upward: off (this overlay)</span>
    </div>
  );
}
export function BarRuleMock({ t }: { t: number }) {
  const { hp, flash } = tankHp(t);
  return (
    <div className={s.ov}><Ctl />
      <Hp pct={hp} flash={flash} tail={<span className={s.nm}>{CAST.mt}</span>} />
      <Hp pct={41} tail={<span className={s.nm}>{CAST.mt2}</span>} />
      <Hp pct={18} tail={<span className={s.nm}>{CAST.shamans[1]}</span>} />
    </div>
  );
}
export const Stage = ({ children, cap }: { children: React.ReactNode; cap?: string }) => (
  <div className={s.stage}>{cap && <div className={s.cap}>{cap}</div>}{children}</div>
);
