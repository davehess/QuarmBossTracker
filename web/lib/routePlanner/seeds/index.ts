// Plans the page can offer when a zone has nothing saved yet. A seed is a plan an officer made elsewhere and handed over:
// the committed json is the plan document with the author dropped (nothing in it names a person; the labels are NPC names
// and objectives), and `label` is what the first saved version of an import is called.
import type { Plan } from '../types';
import { sanitize } from '../plan';
import potacticsTonight from './potactics-2026-10-21.json';

export type Seed = { label: string; plan: Plan };

const SEEDS: Record<string, Seed> = {
  potactics: { label: 'Imported from the officers’ planner, Oct 21', plan: sanitize(potacticsTonight) },
};

export function seedFor(zone: string): Seed | null {
  return Object.prototype.hasOwnProperty.call(SEEDS, zone) ? SEEDS[zone] : null;
}
