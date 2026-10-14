// Shared fixtures for the EQ item-link rule, which lives twice: the bot's
// linkifyEqItems (index.js, tested by eq-item-link.test.js on main) and the
// agent's transformEqItemLinks (packages/wolfpack-logsync/index.js, tested by
// eq-item-link-agent.test.js, which ships with the agent on beta).
//
// The rule: a link is \x12 + the item id as 7 zero-padded DECIMAL digits + the
// item name + \x12. The four `hexId` values are what the old decoder produced
// (5 of the digits read as hex), measured against chat_messages on 2026-10-10.

export const LINK_FIXTURES = [
  { name: 'Ragebringer',             id: 11057, hexId: 4357 },
  { name: 'Primal Velium War Lance', id: 27325, hexId: 10034 },
  { name: 'Fedora Secundae',         id: 29452, hexId: 10565 },
  { name: 'Crown of Narandi',        id: 1746,  hexId: 372 },
  { name: 'A Lucid Shard',           id: 22194, hexId: 8729 },
  // A digit inside the name: only the raw \x12 form keeps it whole (the stripped
  // fallback's casing guess stops at "Page"), so rawOnly.
  { name: 'Page 19 of Dark Power',   id: 28779, hexId: 10359, rawOnly: true },
];

export const rawLink = (f) => '\x12' + String(f.id).padStart(7, '0') + f.name + '\x12';
export const strippedLink = (f) => String(f.id).padStart(7, '0') + f.name;
export const pqdi = (id) => `<https://www.pqdi.cc/item/${id}>`;
