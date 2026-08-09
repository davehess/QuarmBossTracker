'use client';

// Playable miniatures of three real Mimic overlays, for /about.
//
// REPRODUCTIONS, not screenshots: the live overlays read a local agent on
// localhost:7777, which a public page cannot reach. The visual language is
// copied from apps/mimic/tank.html, command.html and chchain.html — translucent
// black cards, mono type, hard-outlined text (they sit over EQ, so every glyph
// carries a shadow), the same HP/mana thresholds, the same GO!/DDR chrome.
//
// EVERYTHING NAMED HERE IS REAL AND VERIFIED (2026-08-09, Hitya's corrections):
//   · Peopleslayer is the Warrior main tank — latest recorded max HP 7,935
//     (character_live_state.self_hp_max)
//   · Ashieron is a Paladin — which is WHY he eats rampage under Divine Aura;
//     DA is 3 ticks = 18s (eqemu_spells 207). Latest recorded max HP 6,049.
//   · Elyas and Brynnja are Druids; Nature's Touch heals 978 (spell 1291)
//   · The CH chain is the real cleric rotation: Fargan, Uilnayar,
//     Stupidrichard, Mcdorf, Bwavair. Complete Heal is 7,500.
//   · Shei Vinitras (Akheva Ruins) is 650,000 HP in the catalog — she death
//     touches and rampages, which is why she is the demo target.
//   · Hitya is a Monk — hence the off-heal candidate row.
// Scripted loops, not random numbers: each demo plays one specific story.

import { useEffect, useRef, useState } from 'react';

const OUTLINE = { textShadow: '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,0 1px 2px #000' };

const PS_MAX = 7935;    // Peopleslayer, latest recorded max HP
const ASH_MAX = 6049;   // Ashieron, latest recorded max HP

function hpClass(p: number) {
  if (p > 55) return 'from-[#56d364] to-[#56d364]';
  if (p > 25) return 'from-[#f0d264] to-[#f0a52d]';
  return 'from-[#f87171] to-[#dc2626]';
}
const fmtHp = (pct: number, max: number) => Math.round((pct / 100) * max).toLocaleString();

// Shared pause-off-screen hook: a looping animation in a background tab or
// scrolled past is pure battery burn on a phone.
function useLoop(len: number, ms: number) {
  const [i, setI] = useState(0);
  const [running, setRunning] = useState(true);
  useEffect(() => {
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !running) return;
    const id = setInterval(() => setI(n => (n + 1) % len), ms);
    return () => clearInterval(id);
  }, [running, len, ms]);
  return { i, setRunning };
}

function DemoShell({ label, children, caption, onHover }: {
  label: React.ReactNode; children: React.ReactNode; caption: string;
  onHover?: (h: boolean) => void;
}) {
  return (
    <div
      className="h-full rounded-lg border border-border/60 bg-[#0b0f14] p-3 sm:p-4 select-none flex flex-col"
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      <div className="text-[10px] text-dim mb-2 flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
        {label}
      </div>
      <div className="rounded-md bg-black/60 p-2.5 font-mono text-white flex-1">{children}</div>
      <p className="text-[11px] text-dim mt-2.5 leading-relaxed">{caption}</p>
    </div>
  );
}

function Bar({ pct, cls, children, boxShadow }: {
  pct: number; cls: string; children?: React.ReactNode; boxShadow?: string;
}) {
  return (
    <div className="relative h-3.5 rounded-[3px] bg-[#222] overflow-hidden border border-white/[0.06]">
      <div className={`absolute inset-y-0 left-0 bg-gradient-to-r ${cls} transition-all duration-300`}
           style={{ width: `${pct}%`, boxShadow }} />
      {children}
    </div>
  );
}

function HealRow({ who, amt, pct, col, landed }: {
  who: string; amt: string; pct: number; col: string; landed?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] mt-0.5">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: col, boxShadow: '0 0 3px #000' }} />
      <span className="text-[#e6edf3] truncate max-w-[92px]" style={OUTLINE}>{who}</span>
      <span className="relative flex-1 h-2 bg-[#222] rounded-sm overflow-hidden min-w-[24px]">
        <span className="absolute inset-y-0 left-0 rounded-sm transition-all duration-200"
              style={{ width: `${pct}%`, background: col }} />
      </span>
      <span className="text-[#c9d1d9] tabular-nums" style={OUTLINE}>{amt}</span>
      <span className={`min-w-[30px] text-right font-semibold tabular-nums ${landed ? 'text-[#4ade80]' : ''}`} style={OUTLINE}>
        {landed ? 'healed' : `${((100 - pct) / 100 * 2.4).toFixed(1)}s`}
      </span>
    </div>
  );
}

/* ── 1 · Tank overlay — Peopleslayer under the CH chain, Ashieron eating
       rampage behind Divine Aura ─────────────────────────────────────────── */

type Heal = { who: string; amt: string; pct: number; col: string; landed?: boolean };
type TankBeat = {
  mt: number; mtGhost?: number; mtHeals: Heal[];
  ash: number; da: number | null; ashHeals: Heal[];
};

const CH = (who: string, pct: number, col: string, landed?: boolean): Heal =>
  ({ who, amt: '7.5k', pct, col, landed });
const NT = (who: string, pct: number, col: string, landed?: boolean): Heal =>
  ({ who, amt: '978', pct, col, landed });

const TANK_SCRIPT: TankBeat[] = [
  { mt: 92, mtHeals: [], ash: 100, da: 16, ashHeals: [] },
  { mt: 78, mtHeals: [CH('Fargan', 38, '#58a6ff')], ash: 100, da: 14, ashHeals: [] },
  { mt: 61, mtHeals: [CH('Fargan', 79, '#58a6ff')], ash: 100, da: 12, ashHeals: [] },
  { mt: 54, mtGhost: 44, mtHeals: [CH('Fargan', 100, '#58a6ff', true), CH('Uilnayar', 26, '#a371f7')], ash: 100, da: 9, ashHeals: [] },
  { mt: 97, mtHeals: [CH('Uilnayar', 68, '#a371f7')], ash: 100, da: 7, ashHeals: [] },
  { mt: 88, mtHeals: [CH('Uilnayar', 100, '#a371f7', true)], ash: 100, da: 4, ashHeals: [] },
  { mt: 80, mtHeals: [], ash: 100, da: 2, ashHeals: [] },
  { mt: 74, mtHeals: [CH('Stupidrichard', 30, '#f0b429')], ash: 71, da: null, ashHeals: [NT('Elyas', 52, '#56d364'), NT('Brynnja', 18, '#a371f7')] },
  { mt: 68, mtHeals: [CH('Stupidrichard', 74, '#f0b429')], ash: 83, da: null, ashHeals: [NT('Elyas', 100, '#56d364', true), NT('Brynnja', 76, '#a371f7')] },
  { mt: 93, mtHeals: [CH('Stupidrichard', 100, '#f0b429', true)], ash: 97, da: null, ashHeals: [NT('Brynnja', 100, '#a371f7', true)] },
];

export function TankOverlayDemo() {
  const { i, setRunning } = useLoop(TANK_SCRIPT.length, 1000);
  const b = TANK_SCRIPT[i];
  const daUp = b.da != null;

  return (
    <DemoShell label={<>live demo · hover to pause</>} onHover={h => setRunning(!h)}
      caption="The tank bar with the CH chain landing on it, and the rampage target riding out the hits under Divine Aura — with the heals already in the air for the moment it drops.">
      <div className="flex items-center gap-2 text-[12px] mb-1.5" style={{ color: '#f8b87b', ...OUTLINE }}>
        <span aria-hidden>🛡</span><span>Tank</span>
        <span className="text-[11px] text-[#9aa4ad] font-normal">Peopleslayer</span>
        <span className="ml-auto text-[9px] border border-white/20 rounded px-1 py-px text-[#9aa4ad] tracking-wider">local</span>
      </div>

      <div className="text-[10px] uppercase tracking-wider text-[#9aa4ad] mb-1" style={OUTLINE}>
        Main Tank — Peopleslayer
      </div>
      <Bar pct={b.mt} cls={hpClass(b.mt)}>
        {b.mtGhost != null && (
          <div className="absolute inset-y-0 z-[1] transition-all duration-300"
               style={{ left: `${b.mt}%`, width: `${b.mtGhost}%`,
                        background: 'repeating-linear-gradient(45deg,rgba(86,211,100,0.6),rgba(86,211,100,0.6) 4px,rgba(86,211,100,0.28) 4px,rgba(86,211,100,0.28) 8px)' }} />
        )}
        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold z-[2]" style={OUTLINE}>
          {fmtHp(b.mt, PS_MAX)} / {PS_MAX.toLocaleString()}
        </div>
      </Bar>
      <div className="mt-1 min-h-[38px]">
        {b.mtHeals.map(h => <HealRow key={h.who + h.amt} {...h} />)}
      </div>

      <div className="text-[10px] mt-1.5 mb-1" style={OUTLINE}>
        <span aria-hidden>💀</span> Rampage on <span style={{ color: '#f8b87b' }}>Ashieron</span>
      </div>
      <Bar
        pct={daUp ? 100 : b.ash}
        cls={daUp ? 'from-[#f0c419] to-[#d4a017]' : hpClass(b.ash)}
        boxShadow={daUp ? 'inset 0 0 8px rgba(240,196,25,.9)' : undefined}
      >
        {daUp && (
          <>
            <span className="absolute left-1 inset-y-0 flex items-center text-[9px] font-extrabold z-[2]" style={OUTLINE}>INV</span>
            <span className="absolute right-1 inset-y-0 flex items-center text-[9px] font-extrabold z-[2]" style={OUTLINE}>INV</span>
          </>
        )}
        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold z-[2]" style={OUTLINE}>
          {daUp ? `DIVINE AURA · ${b.da}s` : `${fmtHp(b.ash, ASH_MAX)} / ${ASH_MAX.toLocaleString()}`}
        </div>
      </Bar>
      <div className="mt-1 min-h-[30px]">
        {b.ashHeals.map(h => <HealRow key={h.who + h.amt} {...h} />)}
      </div>
    </DemoShell>
  );
}

/* ── 2 · Command Center — Shei Vinitras, DT clock, healer mana + DI ───────── */

const MANA_ROWS = [
  { who: 'Bwavair',  cls: 'Cleric', mana: 31 },
  { who: 'Uilnayar', cls: 'Cleric', mana: 48 },
  { who: 'Brynnja',  cls: 'Druid',  mana: 58 },
  { who: 'Fargan',   cls: 'Cleric', mana: 62 },
  { who: 'Elyas',    cls: 'Druid',  mana: 66 },
  { who: 'Mcdorf',   cls: 'Cleric', mana: 71 },
];

export function CommandCenterDemo() {
  const [t, setT] = useState(18);       // death-touch clock
  const [di, setDi] = useState(41);     // Mcdorf's DI recast
  const [shei, setShei] = useState(52); // boss % — ticking down from about half
  useEffect(() => {
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const id = setInterval(() => {
      setT(v => (v <= 1 ? 18 : v - 1));
      setDi(v => (v <= 1 ? 41 : v - 1));
      setShei(v => (v <= 43 ? 52 : v - 0.5));
    }, 1000);
    return () => clearInterval(id);
  }, []);
  const crit = t <= 6;

  return (
    <DemoShell label="the one overlay for the person calling the raid"
      caption="Boss HP, the death-touch clock, who is being rampaged, healer mana lowest-first, and which clerics still have Divine Intervention — pulled from every raider's log at once.">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-[12px]" style={{ color: '#f8b87b', ...OUTLINE }}>
          <span aria-hidden>🎛</span><span>Command Center</span>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#9aa4ad]" style={OUTLINE}>
            Target — Shei Vinitras
          </div>
          <Bar pct={shei} cls="from-[#f87171] to-[#dc2626]">
            <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold" style={OUTLINE}>
              {Math.round(shei)}% · {Math.round(650000 * shei / 100 / 1000)}k / 650k
            </div>
          </Bar>
        </div>

        <div className={`rounded-[4px] px-2 py-1 text-[11px] flex items-center justify-between border ${
          crit ? 'bg-red/20 border-red/60 animate-pulse' : 'bg-white/[0.04] border-white/10'}`}>
          <span style={OUTLINE}>☠ Death Touch</span>
          <span className="font-bold tabular-nums" style={OUTLINE}>{t}s</span>
        </div>

        <div className="rounded-[4px] px-2 py-1 text-[11px] bg-white/[0.04] border border-white/10" style={OUTLINE}>
          💀 Rampage on <span className="text-[#f8b87b]">Ashieron</span>
        </div>

        {/* HEALER MANA — lowest first, exactly as the real overlay sorts it,
            with the DI chips riding the header (#66). */}
        <div>
          <div className="flex items-center gap-1.5 flex-wrap text-[10px] uppercase tracking-wider text-[#9aa4ad] mb-1" style={OUTLINE}>
            <span>Healer mana</span>
            <span className="normal-case tracking-normal inline-flex items-center gap-1">
              <span className="rounded-[3px] border border-[rgba(86,211,100,0.6)] text-[#7ee787] px-1.5 text-[10px]">DI Fargan ✓</span>
              <span className="rounded-[3px] border border-[rgba(86,211,100,0.6)] text-[#7ee787] px-1.5 text-[10px]">Stupidrichard ✓</span>
              <span className="rounded-[3px] border border-[rgba(240,180,41,0.6)] text-[#f0b429] px-1.5 text-[10px] tabular-nums">Mcdorf {di}s</span>
            </span>
          </div>
          {MANA_ROWS.map(r => (
            <div key={r.who} className="flex items-center gap-1.5 text-[10px] mt-0.5">
              <span className="text-[#e6edf3] w-[88px] truncate" style={OUTLINE}>{r.who}</span>
              <span className="text-[#9aa4ad] w-[38px] text-[9px]">{r.cls}</span>
              <span className="relative flex-1 h-2 bg-[#222] rounded-sm overflow-hidden">
                <span className={`absolute inset-y-0 left-0 rounded-sm ${
                  r.mana <= 35 ? 'bg-gradient-to-r from-[#f0d264] to-[#f0a52d]' : 'bg-gradient-to-r from-[#5b8def] to-[#3f6fd6]'}`}
                  style={{ width: `${r.mana}%` }} />
              </span>
              <span className="text-[#9aa4ad] tabular-nums w-[30px] text-right" style={OUTLINE}>{r.mana}%</span>
            </div>
          ))}
        </div>
      </div>
    </DemoShell>
  );
}

/* ── 3 · CH chain — the five clerics, the GO! call, the DDR grade ─────────── */

const CHAIN = [
  { n: '01', who: 'Fargan',        mana: 62 },
  { n: '02', who: 'Uilnayar',      mana: 48 },
  { n: '03', who: 'Stupidrichard', mana: 78 },
  { n: '04', who: 'Mcdorf',        mana: 71 },
  { n: '05', who: 'Bwavair',       mana: 31 },
];
// Each slot plays: GO! → casting (2 beats) → lands with the DDR grade. 4 phases
// per slot; the loop walks the whole rotation so Mcdorf's PERFECT comes around.
const PHASES = 4;

export function ChChainDemo() {
  const { i, setRunning } = useLoop(CHAIN.length * PHASES, 900);
  const slot = Math.floor(i / PHASES);
  const phase = i % PHASES;              // 0 go · 1 cast 40% · 2 cast 85% · 3 landed
  const next = (slot + 1) % CHAIN.length;
  const beat = phase === 3 ? '2.8s' : `${(3.6 - phase * 0.9).toFixed(1)}s`;

  return (
    <DemoShell label={<>the healer&apos;s view — hover to pause</>} onHover={h => setRunning(!h)}
      caption="The Complete Heal rotation as a rhythm game: your number comes up, you get the GO!, your cast bar runs, and the landing is graded. Nobody counts to ten out loud anymore.">
      <div className="flex items-center gap-2 text-[12px] mb-1" style={{ color: '#f8b87b', ...OUTLINE }}>
        <span aria-hidden>✚</span><span>CH Chain</span>
        <span className="text-[10px] text-[#9aa4ad] font-normal tabular-nums ml-auto">beat {beat}</span>
      </div>
      <div className="text-[10px] text-[#9aa4ad] mb-1.5" style={OUTLINE}>
        MT <span className="text-[#e6edf3]">Peopleslayer</span> · {PS_MAX.toLocaleString()} max
      </div>

      {CHAIN.map((c, idx) => {
        const isGo = idx === slot && phase === 0;
        const isCasting = idx === slot && (phase === 1 || phase === 2);
        const isLanded = idx === slot && phase === 3;
        const isNext = idx === next && phase >= 2;
        const rowBg = isGo ? 'bg-[rgba(240,180,41,0.22)] border-l-[#f0b429] animate-pulse'
          : isCasting ? 'bg-[rgba(86,211,100,0.12)] border-l-[#56d364]'
          : isNext ? 'bg-[rgba(240,180,41,0.12)] border-l-[#f0b429]'
          : 'border-l-transparent';
        return (
          <div key={c.n} className={`relative border-l-2 rounded-r px-1.5 py-0.5 mt-0.5 ${rowBg}`}>
            <div className="flex items-center gap-2 text-[11px]">
              <span className={`inline-flex items-center justify-center w-[22px] h-[15px] rounded border text-[9px] font-bold tabular-nums ${
                isGo ? 'text-[#7ee787] border-[rgba(126,231,135,0.75)] bg-[rgba(126,231,135,0.15)]' : 'text-[#9aa4ad] border-white/15'}`}
                style={OUTLINE}>{c.n}</span>
              <span className={`${isGo || isNext ? 'text-[#f6c365] font-bold' : isCasting ? 'text-[#7ee787]' : 'text-[#e6edf3]'}`} style={OUTLINE}>
                {c.who}
              </span>
              <span className="ml-auto tabular-nums font-semibold text-[10px]"
                    style={{ ...OUTLINE, color: c.mana <= 35 ? '#f87171' : c.mana <= 60 ? '#f0b429' : '#56d364' }}>
                {c.mana}%
              </span>
              {isGo && (
                <span className="inline-block font-extrabold text-[10px] text-[#052e12] bg-[#7ee787] rounded-lg px-1.5 tracking-wide"
                      style={{ boxShadow: '0 0 8px rgba(126,231,135,0.65)' }}>GO!</span>
              )}
            </div>
            {isCasting && (
              <div className="h-1 bg-white/10 rounded mt-0.5 overflow-hidden">
                <div className="h-full bg-[#56d364] transition-all duration-700" style={{ width: phase === 1 ? '42%' : '86%' }} />
              </div>
            )}
            {/* DDR grade sticker (Hitya 2026-07-31) — flashes on the landing. */}
            {isLanded && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
                <span className="font-black italic text-[13px] tracking-wider"
                      style={{ color: '#f6c365', textShadow: '-1.5px -1.5px 0 #000,1.5px -1.5px 0 #000,-1.5px 1.5px 0 #000,1.5px 1.5px 0 #000,0 0 10px rgba(246,195,101,.8)' }}>
                  PERFECT
                </span>
              </div>
            )}
          </div>
        );
      })}

      <div className="flex items-center justify-between text-[10px] text-[#9aa4ad] mt-1.5" style={OUTLINE}>
        <span>NEXT <span className="text-[#f6c365] font-bold">{CHAIN[next].n} {CHAIN[next].who}</span></span>
        <span className="tabular-nums">in {beat}</span>
      </div>

      {/* Off-heal candidates — Hitya the monk, colored by HP severity. */}
      <div className="mt-2 rounded bg-black/40 px-2 py-1.5">
        <div className="text-[9px] uppercase tracking-wider text-[#9aa4ad] mb-0.5" style={OUTLINE}>Off-heal candidates</div>
        <div className="flex items-center gap-2 text-[10px]" style={OUTLINE}>
          <span className="font-semibold text-[#fca5a5]">Hitya</span>
          <span className="text-[#9aa4ad] text-[9px] flex-1">taking single-target damage off-tank</span>
          <span className="font-bold tabular-nums text-[#f0b429]">67%</span>
        </div>
      </div>
    </DemoShell>
  );
}

/* ── 4 · Loot auction chips — Shei's drops on the two-minute clock ────────── */

const LOOT = [
  { name: 'Crys`Va Mask', qty: 1 },
  { name: 'Shadowsong Cloak', qty: 2 },
  { name: "Spell: Transon's Elemental Renewal", qty: 1 },
  { name: "Spell: Sha's Advantage", qty: 1 },
];

export function LootTtsDemo() {
  const [s, setS] = useState(112); // 1:52 of the 2:00 window
  useEffect(() => {
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const id = setInterval(() => setS(v => (v <= 4 ? 112 : v - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = Math.floor(s / 60), ss = String(s % 60).padStart(2, '0');

  return (
    <div className="rounded-md bg-black/60 p-3 font-mono text-white text-xs space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-gold animate-pulse" />
        <span style={{ textShadow: '0 1px 2px #000' }}>
          &ldquo;Loot posted — <span className="text-gold">five items</span>, bidding for two minutes.&rdquo;
        </span>
      </div>
      {LOOT.map(l => (
        <div key={l.name} className="flex items-center gap-2 text-[11px] text-[#c9d1d9]">
          <span className="rounded border border-white/15 px-1.5 py-px tabular-nums text-[#f6c365]">{mm}:{ss}</span>
          <span className="truncate">{l.name}</span>
          {l.qty > 1 && <span className="text-[#9aa4ad]">×{l.qty}</span>}
        </div>
      ))}
    </div>
  );
}
