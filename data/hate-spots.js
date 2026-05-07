// Shared Plane of Hate mini-boss spawn point definitions.
// Used by /livehatekill, /pvphatekill, /livehate, /pvphate.

const HATE_SPOTS = {
  1:  { label: 'Spot 1 — Organ Hall Upper',        desc: 'First floor, Organ Hall (upstairs)' },
  2:  { label: 'Spot 2 — Organ Hall West',         desc: 'First floor, Organ Hall (west)' },
  3:  { label: 'Spot 3 — East Building Upper',     desc: 'First floor, East Building (upstairs)' },
  4:  { label: 'Spot 4 — East Building Lower',     desc: 'First floor, East Building (lower)' },
  5:  { label: 'Spot 5 — Church Middle Upper',     desc: 'First floor, Church (upstairs middle, 2nd floor)' },
  6:  { label: 'Spot 6 — Church Pathing',          desc: 'First floor, Church (pathing)' },
  7:  { label: 'Spot 7 — Church South Lower',      desc: 'First floor, Church (downstairs south)' },
  8:  { label: 'Spot 8 — Church South Upper',      desc: 'First floor, Church (upstairs south, 2nd floor)' },
  9:  { label: 'Spot 9 — Church West Upper',       desc: 'First floor, Church (upstairs west)' },
  10: { label: 'Spot 10 — 2F North Spawn',         desc: 'Second floor, North spawn' },
  11: { label: 'Spot 11 — 2F East Spawn',          desc: 'Second floor, East spawn' },
  12: { label: 'Spot 12 — 2F South Spawn',         desc: 'Second floor, South spawn' },
};

// Grouped by area for display commands
const HATE_AREA_GROUPS = [
  { name: '🏛️ Organ Hall (Floor 1)',   spots: [1, 2] },
  { name: '🏢 East Building (Floor 1)', spots: [3, 4] },
  { name: '⛪ Church (Floor 1)',         spots: [5, 6, 7, 8, 9] },
  { name: '⬆️ Second Floor',            spots: [10, 11, 12] },
];

module.exports = { HATE_SPOTS, HATE_AREA_GROUPS };
