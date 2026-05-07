// Shared Plane of Hate mini-boss spawn point definitions.
// Used by /livehatekill, /pvphatekill, /livehate, /pvphate, /hateboard.
// Spots 4 and 6 do not exist on this server.

const HATE_SPOTS = {
  1:  { label: 'Spot 1 — Organ Hall Upper',        desc: 'First floor, Organ Hall (upstairs)',          pqdiUrl: 'https://www.pqdi.cc/spawngroup/76326/21449682' },
  2:  { label: 'Spot 2 — Organ Hall West',         desc: 'First floor, Organ Hall (west)',              pqdiUrl: 'https://www.pqdi.cc/spawngroup/76326/21449685' },
  3:  { label: 'Spot 3 — East Building Upper',     desc: 'First floor, East Building (upstairs)',       pqdiUrl: 'https://www.pqdi.cc/spawngroup/76326/363944' },
  5:  { label: 'Spot 5 — Church Middle Upper',     desc: 'First floor, Church (upstairs middle)',       pqdiUrl: 'https://www.pqdi.cc/spawngroup/76326/21449631' },
  7:  { label: 'Spot 7 — Church South Lower',      desc: 'First floor, Church (downstairs south)',      pqdiUrl: 'https://www.pqdi.cc/spawngroup/76326/21449632' },
  8:  { label: 'Spot 8 — Church South Upper',      desc: 'First floor, Church (upstairs south)',        pqdiUrl: 'https://www.pqdi.cc/spawngroup/76326/21449632' },
  9:  { label: 'Spot 9 — Church West Upper',       desc: 'First floor, Church (upstairs west)',         pqdiUrl: 'https://www.pqdi.cc/spawngroup/76326/21449667' },
  10: { label: 'Spot 10 — 2F North Spawn',         desc: 'Second floor, North spawn',                  pqdiUrl: 'https://www.pqdi.cc/spawngroup/76326/21449679' },
  11: { label: 'Spot 11 — 2F East Spawn',          desc: 'Second floor, East spawn',                   pqdiUrl: 'https://www.pqdi.cc/spawngroup/76326/368076' },
  12: { label: 'Spot 12 — 2F South Spawn',         desc: 'Second floor, South spawn',                  pqdiUrl: 'https://www.pqdi.cc/spawngroup/76326/21449686' },
};

// Grouped by area for display commands
const HATE_AREA_GROUPS = [
  { name: '🏛️ Organ Hall (Floor 1)',   spots: [1, 2] },
  { name: '🏢 East Building (Floor 1)', spots: [3] },
  { name: '⛪ Church (Floor 1)',         spots: [5, 7, 8, 9] },
  { name: '⬆️ Second Floor',            spots: [10, 11, 12] },
];

// Valid spot numbers (for slash command validation)
const VALID_HATE_SPOTS = new Set(Object.keys(HATE_SPOTS).map(Number));

module.exports = { HATE_SPOTS, HATE_AREA_GROUPS, VALID_HATE_SPOTS };
