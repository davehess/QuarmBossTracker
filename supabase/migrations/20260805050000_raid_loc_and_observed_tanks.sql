-- #194 same-name mob serialization — the two coverage-multiplier columns.
--
-- raid_roster loc/heading: Zeal's type-5 raid pipe carries loc+heading for
-- EVERY raid member, but the agent's compact mapping dropped both (gap 3 in
-- docs/DESIGN-mob-serialization.md). Forwarding them means ONE Mimic-running
-- raider provides position for the whole raid — the clustering stops being
-- limited by Mimic adoption (30-45%).
--
-- character_live_state.observed_tanks: the observer's log shows every mob→player
-- melee connect in range (recentTankHits records ALL victims, not just self).
-- Forwarding the compact recent set means one observer also names WHICH tank
-- each same-name instance is hitting, covering tanks who run nothing.
-- Shape: [{ "mob": "a thall va xakra", "tank": "Grabthar", "since": "ISO" }]
--
-- Privacy: raid-member coordinates are intra-guild data of guildmates, the same
-- class as the HP we already forward — noted in docs/PRIVACY.md alongside this
-- migration.

ALTER TABLE raid_roster ADD COLUMN IF NOT EXISTS loc_x   double precision;
ALTER TABLE raid_roster ADD COLUMN IF NOT EXISTS loc_y   double precision;
ALTER TABLE raid_roster ADD COLUMN IF NOT EXISTS loc_z   double precision;
ALTER TABLE raid_roster ADD COLUMN IF NOT EXISTS heading double precision;
-- Position freshness is NOT captured_at: the roster row heartbeats on a slow
-- cadence while loc rides every type-5 fire that reaches an upload. Consumers
-- must gate on loc_at, never captured_at, before trusting a coordinate.
ALTER TABLE raid_roster ADD COLUMN IF NOT EXISTS loc_at  timestamptz;

ALTER TABLE character_live_state ADD COLUMN IF NOT EXISTS observed_tanks jsonb;
