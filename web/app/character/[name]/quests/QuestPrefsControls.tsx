'use client';

// Per-quest layout controls: hide, dismiss, drag-to-reorder. Mounted on each
// quest row in active/stacks lists. Owner-or-officer enforcement happens
// server-side in actions.ts; the controls just call the actions.
//
// Reorder uses native HTML5 drag-and-drop (zero deps) and persists in batches
// — moving a card emits one reorderQuests() call with the new order. Hide /
// dismiss are per-button. (Uilnayar 2026-06-23.)

import { useTransition } from 'react';
import { setQuestHidden, setQuestDismissed, moveQuest, promoteTurnin, demoteTurnin, dismissTurnin, restoreTurnin } from './actions';

export function QuestActionButtons({ character, questId }: { character: string; questId: number }) {
  const [pending, start] = useTransition();
  const wrap = (fn: () => Promise<unknown>) => () => start(() => fn().then(() => {}));
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px]">
      <button type="button" disabled={pending}
        onClick={wrap(() => moveQuest(character, questId, 'up'))}
        className="text-dim hover:text-blue disabled:opacity-40" title="Move up">▲</button>
      <button type="button" disabled={pending}
        onClick={wrap(() => moveQuest(character, questId, 'down'))}
        className="text-dim hover:text-blue disabled:opacity-40" title="Move down">▼</button>
      <button type="button" disabled={pending}
        onClick={wrap(() => setQuestHidden(character, questId, true))}
        className="text-dim hover:text-orange disabled:opacity-40"
        title="Hide this quest (still in the picker; bring it back any time)">👁 hide</button>
      <button type="button" disabled={pending}
        onClick={wrap(() => setQuestDismissed(character, questId, true))}
        className="text-dim hover:text-red disabled:opacity-40"
        title="Dismiss — 'I'm not doing this.' Folds it into the Dismissed section.">✕ dismiss</button>
    </span>
  );
}

// Per-turn-in controls for the discovery panel (Uilnayar 2026-06-24).
//   • 'discovery' → ▲ to active  +  🚫 dismiss
//   • 'promoted'  → ✕ remove (un-pin from Active)
//   • 'dismissed' → ↺ restore (back to discovery)
export function TurninControls({ character, turninId, kind }: { character: string; turninId: number; kind: 'discovery' | 'promoted' | 'dismissed' }) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) => () => start(() => fn().then(() => {}));
  if (kind === 'promoted') {
    return (
      <button type="button" disabled={pending} onClick={run(() => demoteTurnin(character, turninId))}
        className="text-[10px] text-dim hover:text-red disabled:opacity-40" title="Remove from Active quests">✕ remove</button>
    );
  }
  if (kind === 'dismissed') {
    return (
      <button type="button" disabled={pending} onClick={run(() => restoreTurnin(character, turninId))}
        className="text-[10px] text-blue hover:underline disabled:opacity-40">↺ restore</button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-[10px]">
      <button type="button" disabled={pending} onClick={run(() => promoteTurnin(character, turninId))}
        className="text-blue hover:underline disabled:opacity-40" title="Move to Active quests">▲ to active</button>
      <button type="button" disabled={pending} onClick={run(() => dismissTurnin(character, turninId))}
        className="text-dim hover:text-red disabled:opacity-40" title="Not interested — hide from discovery">🚫 dismiss</button>
    </span>
  );
}

export function QuestUnhideButton({ character, questId, label }: { character: string; questId: number; label: 'unhide' | 'restore' }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => (label === 'unhide'
        ? setQuestHidden(character, questId, false)
        : setQuestDismissed(character, questId, false)).then(() => {}))}
      className="text-blue hover:underline text-[10px] disabled:opacity-40"
    >
      ↺ {label}
    </button>
  );
}
