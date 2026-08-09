'use client';

// Playable miniatures of two real Mimic overlays, for /about.
//
// These are REPRODUCTIONS, not screenshots and not the live overlays: the real
// ones read a local agent on localhost:7779, which a public web page cannot and
// should not reach. The visual language is copied from apps/mimic/tank.html and
// command.html so what people see here is what they will actually get —
// translucent black cards, mono type, outlined text (the overlays sit on top of
// EQ, so every glyph carries a hard shadow to stay readable over any scene),
// and the same green/amber/red HP thresholds.
//
// The tank card runs a scripted loop rather than random numbers, because the
// point being demonstrated is a specific sequence: the boss rampages, HP
// collapses, heals land, a Divine Aura window opens. Random walk would show
// motion but not the story.

import { useEffect, useRef, useState } from 'react';

const OUTLINE = { textShadow: '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,0 1px 2px #000' };

function hpClass(p: number) {
  if (p > 55) return 'from-[#56d364] to-[#56d364]';
  if (p > 25) return 'from-[#f0d264] to-[#f0a52d]';
  return 'from-[#f87171] to-[#dc2626]';
}

// One beat of the scripted fight. `inv` = invulnerable (Divine Aura up).
type Beat = { hp: number; inv?: boolean; ghost?: number; heals: { who: string; amt: string; pct: number; col: string; landed?: boolean }[] };

const SCRIPT: Beat[] = [
  { hp: 96, heals: [] },
  { hp: 88, heals: [{ who: 'Ashieron', amt: '2.1k', pct: 35, col: '#58a6ff' }] },
  { hp: 71, heals: [{ who: 'Ashieron', amt: '2.1k', pct: 78, col: '#58a6ff' }] },
  { hp: 52, ghost: 22, heals: [{ who: 'Ashieron', amt: '2.1k', pct: 100, col: '#58a6ff', landed: true }, { who: 'Melting', amt: '4.4k', pct: 30, col: '#a371f7' }] },
  { hp: 34, ghost: 38, heals: [{ who: 'Melting', amt: '4.4k', pct: 72, col: '#a371f7' }, { who: 'Hopeya', amt: '4.4k', pct: 20, col: '#56d364' }] },
  { hp: 19, ghost: 55, heals: [{ who: 'Melting', amt: '4.4k', pct: 100, col: '#a371f7', landed: true }, { who: 'Hopeya', amt: '4.4k', pct: 64, col: '#56d364' }] },
  { hp: 62, heals: [{ who: 'Hopeya', amt: '4.4k', pct: 100, col: '#56d364', landed: true }] },
  { hp: 78, inv: true, heals: [] },
  { hp: 78, inv: true, heals: [] },
  { hp: 91, heals: [] },
];

export function TankOverlayDemo() {
  const [i, setI] = useState(0);
  const [running, setRunning] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Pause when off-screen or when the tab is hidden — a looping animation in
    // a background tab is pure battery burn on a phone.
    const mq = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (mq || !running) return;
    timer.current = setInterval(() => setI(n => (n + 1) % SCRIPT.length), 900);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [running]);

  const b = SCRIPT[i];
  const barCls = b.inv ? 'from-[#f0c419] to-[#d4a017]' : hpClass(b.hp);

  return (
    <div
      className="rounded-lg border border-border/60 bg-[#0b0f14] p-3 sm:p-4 select-none"
      onMouseEnter={() => setRunning(false)}
      onMouseLeave={() => setRunning(true)}
    >
      <div className="text-[10px] text-dim mb-2 flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
        live demo · hover to pause
      </div>

      {/* The card itself — translucent black, exactly as it sits over EQ. */}
      <div className="rounded-md bg-black/60 p-2.5 font-mono text-white">
        <div className="flex items-center gap-2 text-[12px] mb-1.5" style={{ color: '#f8b87b', ...OUTLINE }}>
          <span aria-hidden>🛡</span><span>Tank</span>
          <span className="text-[11px] text-[#9aa4ad] font-normal">Grabthar</span>
          <span className="ml-auto text-[9px] border border-white/20 rounded px-1 py-px text-[#9aa4ad] tracking-wider">local</span>
        </div>

        <div className="text-[10px] uppercase tracking-wider text-[#9aa4ad] mb-1" style={OUTLINE}>
          Main Tank — Grabthar
        </div>

        <div className="relative h-3.5 rounded-[3px] bg-[#222] overflow-hidden border border-white/[0.06]">
          {/* Projected-HP ghost: where HP lands once the inbound heals connect.
              Striped so it never reads as current HP. */}
          {b.ghost != null && (
            <div
              className="absolute inset-y-0 z-[1] transition-all duration-300"
              style={{
                left: `${b.hp}%`, width: `${b.ghost}%`,
                background:
                  'repeating-linear-gradient(45deg,rgba(86,211,100,0.6),rgba(86,211,100,0.6) 4px,rgba(86,211,100,0.28) 4px,rgba(86,211,100,0.28) 8px)',
              }}
            />
          )}
          <div
            className={`absolute inset-y-0 left-0 bg-gradient-to-r ${barCls} transition-all duration-300`}
            style={{ width: `${b.hp}%`, boxShadow: b.inv ? 'inset 0 0 8px rgba(240,196,25,.9)' : undefined }}
          />
          {b.inv && (
            <>
              <span className="absolute left-1 inset-y-0 flex items-center text-[9px] font-extrabold z-[2]" style={OUTLINE}>INV</span>
              <span className="absolute right-1 inset-y-0 flex items-center text-[9px] font-extrabold z-[2]" style={OUTLINE}>INV</span>
            </>
          )}
          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold z-[2]" style={OUTLINE}>
            {b.inv ? 'DIVINE AURA' : `${b.hp}%`}
          </div>
        </div>

        {/* Inbound heals in flight — one row each, filling as the cast completes. */}
        <div className="mt-1.5 min-h-[36px]">
          {b.heals.map(h => (
            <div key={h.who} className="flex items-center gap-1.5 text-[10px] mt-0.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: h.col, boxShadow: '0 0 3px #000' }} />
              <span className="text-[#e6edf3] truncate max-w-[88px]" style={OUTLINE}>{h.who}</span>
              <span className="relative flex-1 h-2 bg-[#222] rounded-sm overflow-hidden min-w-[28px]">
                <span className="absolute inset-y-0 left-0 rounded-sm transition-all duration-200"
                      style={{ width: `${h.pct}%`, background: h.col }} />
              </span>
              <span className="text-[#c9d1d9] tabular-nums" style={OUTLINE}>{h.amt}</span>
              <span className={`min-w-[26px] text-right font-semibold tabular-nums ${h.landed ? 'text-[#4ade80]' : ''}`} style={OUTLINE}>
                {h.landed ? 'healed' : `${((100 - h.pct) / 100 * 2.5).toFixed(1)}s`}
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-dim mt-2.5 leading-relaxed">
        The tank bar, the heals already in the air, and where HP will be when they land — so a
        healer can see the save is covered and hold the next one, instead of three clerics
        dumping on the same hit.
      </p>
    </div>
  );
}

export function CommandCenterDemo() {
  const [t, setT] = useState(18);
  useEffect(() => {
    const mq = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (mq) return;
    const id = setInterval(() => setT(v => (v <= 1 ? 18 : v - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  const crit = t <= 6;

  return (
    <div className="rounded-lg border border-border/60 bg-[#0b0f14] p-3 sm:p-4 select-none">
      <div className="text-[10px] text-dim mb-2">the one overlay for the person calling the raid</div>

      <div className="rounded-md bg-black/60 p-2.5 font-mono text-white space-y-1.5">
        <div className="flex items-center gap-2 text-[12px]" style={{ color: '#f8b87b', ...OUTLINE }}>
          <span aria-hidden>🎛</span><span>Command Center</span>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#9aa4ad]" style={OUTLINE}>Target — Aten Ha Ra</div>
          <div className="relative h-3.5 rounded-[3px] bg-[#222] overflow-hidden border border-white/[0.06]">
            <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#f87171] to-[#dc2626]" style={{ width: '23%' }} />
            <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold" style={OUTLINE}>23%</div>
          </div>
        </div>

        {/* Death Touch countdown — the number the raid lead is actually watching. */}
        <div className={`rounded-[4px] px-2 py-1 text-[11px] flex items-center justify-between border ${
          crit ? 'bg-red/20 border-red/60 animate-pulse' : 'bg-white/[0.04] border-white/10'}`}>
          <span style={OUTLINE}>☠ Death Touch</span>
          <span className="font-bold tabular-nums" style={OUTLINE}>{t}s</span>
        </div>

        <div className="rounded-[4px] px-2 py-1 text-[11px] bg-white/[0.04] border border-white/10" style={OUTLINE}>
          💀 Rampage on <span className="text-[#f8b87b]">Borim</span>
        </div>

        {/* DI availability per cleric — ✓ ready, seconds = on cooldown, ? = never observed. */}
        <div className="flex items-center gap-1.5 flex-wrap text-[10px]" style={OUTLINE}>
          <span className="text-[#9aa4ad]">DI:</span>
          <span className="text-[#56d364]">Ashieron ✓</span><span className="text-dim">·</span>
          <span className="text-[#f0a52d]">Melting 41s</span><span className="text-dim">·</span>
          <span className="text-[#9aa4ad] italic">Hopeya ?</span>
        </div>
      </div>

      <p className="text-[11px] text-dim mt-2.5 leading-relaxed">
        Boss HP, the death-touch clock, who is being rampaged, and which clerics still have
        Divine Intervention — pulled from every raider&apos;s log at once, not just yours.
      </p>
    </div>
  );
}
