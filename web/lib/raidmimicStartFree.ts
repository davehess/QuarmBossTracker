// "Free to start": what the raidmimic.com onboarding pages say about money before anyone sets anything up (the guild
// lead, 2026-11-02: "keep working on the onboarding flow for raidmimic.com. talk about planned pricing to start ... so it
// stays free to start"). Shown on /raidmimic/setup and /guilds/new as a preview on beta (?v=b short, ?v=c cost table);
// with no ?v= the pages stay as production shows them. Every price comes from raidmimicStory.ts, every "why" from
// docs/DESIGN-raidmimic-hosted.md §8e (what costs us money is what we charge for, DECISIONS §527).
import { GUILD_PRICE, INDIVIDUAL_PRICE, priceLabel } from './raidmimicStory';

export type StartFreeVariant = 'b' | 'c';
export function startFreeVariant(v: string | undefined): StartFreeVariant | null {
  return v === 'b' || v === 'c' ? v : null;
}

export const START_FREE = {
  chip: 'Free to start',
  lead: 'Setting up Mimic or starting a guild costs nothing, and nothing asks for a card.',
  free: 'Free stays free: the overlays, triggers, the meter on your own PC, and your PoP flags and boss kills synced.',
  planned: `Planned: Pro · Guild at ${priceLabel(GUILD_PRICE)}, for the parts that cost us money to keep: replays, merged parses, raid reviews and a bot in your Discord.`,
  promise: 'Nothing is charged until you choose a plan.',
  more: 'See pricing',
  tableTitle: 'Free to start, and why the rest will cost money',
  tableLead: 'What costs us money to run is what a plan pays for. Everything else is free.',
  individual: `Pro · Individual (cloud backups of your layouts): ${priceLabel(INDIVIDUAL_PRICE)}.`,
} as const;

export interface CostRow { what: string; why: string }
export const FREE_ROWS: readonly CostRow[] = [
  { what: 'Overlays, triggers, the meter on your PC', why: 'Runs on your own machine.' },
  { what: 'PoP flags and boss kills, synced', why: 'A few rows per player a night.' },
  { what: 'Your guild’s feed of its flags and kills', why: 'A few hundred bytes per event.' },
];
export const PAID_ROWS: readonly CostRow[] = [
  { what: 'Replays, spectator, raid reviews', why: 'The biggest store we keep: about 41 MB a raid night.' },
  { what: 'Merged parses and every raider’s row', why: 'Storage that grows every night.' },
  { what: 'Chat relay and /who history', why: 'Storage.' },
  { what: 'A Raid Mimic bot in your Discord', why: 'A running bot per server.' },
];
