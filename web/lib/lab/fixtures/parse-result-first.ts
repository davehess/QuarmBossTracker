// Made-up fight for the parse-result-first draft. Everyone comes from LAB_RAID; nothing here is a real fight.
import { LAB_RAID, labRand, labInt } from '../people';
import type { ResultView, ViewRole } from '../../parseResultFirstView';

const VIEWER_MAIN = 'Tolvane';   // a rogue, lands mid-table at rank 14
const VIEWER_HEALER = 'Merrin';  // a cleric, lands near the bottom
const clsOf = (n: string) => LAB_RAID.find((p) => p.name === n)?.cls ?? null;

function build(state: 'killed' | 'wipe', role: ViewRole): ResultView {
  const wipe = state === 'wipe';
  const dur = wipe ? 188 : 252;
  const others = LAB_RAID.filter((p) => p.name !== VIEWER_MAIN && p.name !== VIEWER_HEALER)
    .map((p) => ({ p, k: labRand(p.name, 7) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.p.name);
  const order = [...others];
  order.splice(13, 0, VIEWER_MAIN);   // rank 14
  order.splice(38, 0, VIEWER_HEALER); // rank 39 of 42
  const players = order.map((name, i) => {
    const dps = Math.round(1900 * Math.pow(0.93, i) * (wipe ? 0.8 : 1) * (0.97 + labRand(name, 3) * 0.04));
    return { name, dps, damage: Math.round(dps * dur * (0.985 + labRand(name, 5) * 0.015)) };
  }).sort((a, b) => b.damage - a.damage);
  const total = players.reduce((s, p) => s + p.damage, 0);
  const deathNames = wipe
    ? order.filter((_, i) => i % 2 === 0).slice(0, 18)
    : ['Zarrin', 'Fenwick', 'Ysolde'];
  const deaths = deathNames.map((name, i) => ({
    name, atSec: wipe ? 70 + i * 6 + labInt(name, 0, 4) : [42, 125, 211][i],
  }));
  return {
    boss: 'Cazic Thule', zone: 'Plane of Fear', whenLabel: 'Wed 8:47 PM',
    state, bossHpLeftPct: wipe ? 22 : null,
    durationSec: dur, totalDamage: total, raidDps: total / dur,
    players: players.map((p, i) => ({ rank: i + 1, name: p.name, cls: clsOf(p.name), damage: p.damage, dps: p.dps, pct: (p.damage / total) * 100 })),
    deaths,
    tanks: [
      { name: 'Aldenmar', hits: 412, taken: 1_840_000, avoided: 96 },
      { name: 'Brannoc', hits: 118, taken: 520_000, avoided: 31 },
    ],
    healers: [
      { name: 'Brackwyn', healed: 1_120_000, ticks: 296 },
      { name: 'Elsbeth', healed: 905_000, ticks: 261 },
      { name: 'Xanthe', healed: 760_000, ticks: 224 },
      { name: VIEWER_HEALER, healed: 318_000, ticks: 97 },
    ],
    events: [
      { atSec: 0, label: 'Engaged' },
      { atSec: 42, label: 'Rampage' },
      { atSec: 95, label: 'Fear wave' },
      { atSec: 140, label: 'Adds spawned' },
      { atSec: 188, label: 'Enrage' },
      { atSec: wipe ? 188 : 252, label: wipe ? 'Raid wiped' : 'Boss died' },
    ],
    loot: wipe ? [] : [
      { item: 'Orb of Mastery', who: 'Holdfast', dkp: 42 },
      { item: 'Fearbound Sash', who: 'Dravik', dkp: 31 },
      { item: 'Crystallized Dread', who: 'Corvale', dkp: 18 },
      { item: 'Shard of Terror', who: 'Rethlan', dkp: 12 },
    ],
    contributors: [
      { name: 'Corvale', damage: total * 0.99 }, { name: 'Brackwyn', damage: total * 0.97 },
      { name: VIEWER_MAIN, damage: total * 0.96 }, { name: 'Holdfast', damage: total * 0.93 },
      { name: 'Quillon', damage: total * 0.9 },
    ].map((c) => ({ name: c.name, damage: Math.round(c.damage) })),
    mine: [VIEWER_MAIN, VIEWER_HEALER],
    role,
  };
}

export const fixtureKill = (role: ViewRole = 'damage') => build('killed', role);
export const fixtureWipe = (role: ViewRole = 'damage') => build('wipe', role);
