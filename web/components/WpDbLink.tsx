// The parenthetical "(WP)" link we drop next to every outbound pqdi.cc link so
// a member can open OUR in-house copy instead (wpqdi — guild-gated, on
// wolfpack.quest). Additive: the pqdi.cc link stays; this sits beside it.
//
// eqemu ids ARE pqdi.cc's ids (same EQEmu source), so `id` is the same value
// used in the pqdi href — `pqdi.cc/item/<id>` ⇄ `/db/item/<id>`.
//
// Plain component (no 'use client') — it's just a next/link, safe to render
// inside both server and client components. Only wire kinds whose /db/<kind>
// page actually exists yet (today: item). Others 404 until built.

import Link from 'next/link';

export type WpDbKind = 'item' | 'spell' | 'npc' | 'faction';

export default function WpDbLink({ kind, id, className }: {
  kind: WpDbKind;
  id: number | string;
  className?: string;
}) {
  return (
    <span className={`text-dim/70 ${className ?? ''}`}>
      {' ('}
      <Link href={`/db/${kind}/${id}`} className="text-blue/70 hover:text-blue hover:underline"
            title="Open on wolfpack.quest (wpqdi)">WP</Link>
      {')'}
    </span>
  );
}
