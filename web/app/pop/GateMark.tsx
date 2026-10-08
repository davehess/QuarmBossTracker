// The mark in a gate cell on /pop (page.tsx and SelfFlagCells.tsx share it, so a cell looks the same
// whether it is read-only or a button): a green ✓ for a flag Mimic recorded, a blue ✓ for one /who proved,
// a purple ✓ for one only loot proved (the character looted in the plane), and a gold ☑ for one its owner
// ticked on the site, which is their own word and not a record (the guild lead, 2026-10-03). No hooks and
// no 'use client', so the server page renders it directly.

import type { GateMarkKind } from '@/lib/popGateCell';

const LOOK: Record<Exclude<GateMarkKind, 'none'>, { glyph: string; cls: string }> = {
  mimic: { glyph: '✓', cls: 'text-green' },
  who: { glyph: '✓', cls: 'text-blue' },
  loot: { glyph: '✓', cls: 'text-purple' },
  self: { glyph: '☑', cls: 'text-gold' },
};

export default function GateMark({ kind, title }: { kind: Exclude<GateMarkKind, 'none'>; title?: string }) {
  const { glyph, cls } = LOOK[kind];
  return <span className={cls} title={title}>{glyph}</span>;
}
