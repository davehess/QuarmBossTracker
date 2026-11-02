// The panel for ?v=gate-a / ?v=gate-b on /pop/guide (the guild lead, 2026-11-01: "the side bar where it says
// specifically what you're missing, not just the last thing mentioned"). Kept out of page.tsx so the page's own
// text, which other tests hold to, stays what it was; page.tsx calls this once and draws what comes back above the
// checklist.
//
//   gate-a  the "Next up for <character>" card (NextUp.tsx) whose "Waiting on something else" lists every piece of
//           each blocked gate, ✅ / ⏳ / ❌ / ❓, with a verdict (GateMissing.tsx).
//   gate-b  one gate across the whole family, a column per piece and a "What's left" verdict (GateTable.tsx).
//
// What each character is known to hold: Mimic, /who and loot (loadRoute's `flags`), plus what their owner ticked.
// The pieces and the rules are web/lib/popGatePieces.ts and popGateStatus.ts.

import type { ReactNode } from 'react';
import { GATES } from '@/lib/popGatePieces';
import { gateCardEntries, gateKeyOr, gateReport, type GateInput } from '@/lib/popGateStatus';
import { charNextSteps, nextCard } from '@/lib/popNextSteps';
import { POP_ZONE_BY_KEY } from '@/lib/popFlags';
import { flagForTickKey } from '@/lib/popSelfFlags';
import NextUp from './NextUp';
import GateTable from './GateTable';
import { loadFullReads } from './gateData';
import type { RouteChar } from './GuideRoute';

export async function gatePanel({ mode, chars, c, all, gate }: {
  mode: 'a' | 'b'; chars: RouteChar[]; c?: string; all?: string; gate?: string;
}): Promise<ReactNode> {
  const href = (variant: 'gate-a' | 'gate-b', name: string | null, gateKey?: string) => {
    const q = new URLSearchParams();
    if (name) q.set('c', name);
    q.set('v', variant);
    if (all === '1') q.set('all', '1');
    if (gateKey) q.set('gate', gateKey);
    return `/pop/guide?${q}`;
  };
  const first = (chars.find(ch => c && ch.name.toLowerCase() === c.toLowerCase()) ?? chars.find(ch => ch.isMain) ?? chars[0])?.name ?? null;

  const fullReads = await loadFullReads(chars.map(ch => ch.name));
  const inputFor = (ch: RouteChar): GateInput => ({
    flags: [...(ch.flags ?? []), ...ch.manual.map(flagForTickKey).filter((f): f is string => !!f)],
    seen: ch.seenIn.map(s => s.zone),
    fullRead: fullReads.has(ch.name.toLowerCase()),
  });

  if (mode === 'a') {
    const cards = chars.map(ch => ({ name: ch.name, cls: ch.cls, isMain: ch.isMain, card: nextCard(charNextSteps(ch)) }));
    const gates = Object.fromEntries(chars.map((ch, n) => [ch.name, gateCardEntries(cards[n].card.blocked, inputFor(ch))]));
    return <NextUp chars={cards} initial={first} anchorPrefix="guide-" compareHref={href('gate-b', first)} gates={gates} />;
  }

  const selected = gateKeyOr(gate);
  const zone = POP_ZONE_BY_KEY[selected];
  const rows = chars.map(ch => {
    const rep = gateReport(zone, inputFor(ch));
    return { name: ch.name, cls: ch.cls, isMain: ch.isMain, pieces: rep.pieces, verdict: rep.verdict };
  });
  return (
    <GateTable gates={GATES.map(g => ({ key: g.key, name: g.name, short: g.short }))} selected={selected} rows={rows}
               hrefFor={key => href('gate-b', c ?? null, key)} singleHref={href('gate-a', first)} />
  );
}
