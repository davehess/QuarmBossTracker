// Route planner: "Build plan from checklist". Pure (no DOM), so the order rules are tested rather than eyeballed.
//
// What goes in, and why (the guild lead, 2026-10-21: "build in the named and ones in the plan"):
//   a. every NAMED mob in the zone that has a catalog spawn point (the zone's build groups name them);
//   b. the PoP checklist objectives of the zone (web/lib/popGuide.ts: kill Vallon, kill Tallon, kill Rallos, each with
//      the Projection to hail after), in the checklist's own order when the order is "checklist";
//   c. the scripted mobs that have no spawn point of their own but ARE the objective (the Rallos event chain, the
//      Projections), each with its script links (the pin shows them through its mob);
//   d. the bosses on the raid planner's fight cards (/raid/plan) for this zone, marked `onPlan`, which come FIRST.
//
// ORDER. Groups of pins, not single pins, are what get ordered: an event chain stays a chain.
//   greedy     nearest-next from the start (straight-line distance to the group's first pin)
//   checklist  the PoP checklist order for the groups that complete a checklist step, the rest in their listed order
// In both, the groups that hold a fight-card boss are laid down before the others, and a `lead` group (a hail on the
// way in) sits right after the start.
import { dist, uid as defaultUid } from './plan';
import type { BuildGroup, BuildOrder, BuildPinSpec, Mob, Pin, ZoneData } from './types';

export type ChecklistStep = { key: string; title: string };

export type BuildInput = {
  zone: ZoneData;
  mobs: readonly Mob[];                // the zone's mobs, plus any fight-card boss the static data does not know
  order: BuildOrder;
  onPlanNpcs: readonly number[];       // npc ids on the fight cards, in card order
  checklist: readonly ChecklistStep[]; // the zone's PoP checklist steps, in the guide's order
  uid?: () => string;
};

export type BuildResult = { pins: Pin[]; note: string; onPlanPins: number };

type Group = { spec: BuildGroup; pins: Pin[]; onPlan: boolean };

export function buildPlanPins(input: BuildInput): BuildResult {
  const { zone, mobs, order, checklist } = input;
  const uid = input.uid ?? defaultUid;
  const MOB = new Map(mobs.map(m => [m.id, m]));
  const onPlanSet = new Set(input.onPlanNpcs);

  const mkPin = (spec: BuildPinSpec): Pin => {
    const m = MOB.get(spec.mob);
    if (!m) throw new Error(`route planner: build names a mob that does not exist: ${spec.mob}`);
    const pin: Pin = {
      id: uid(), label: spec.label ?? m.name, kind: spec.kind ?? m.kind, optional: !!spec.optional, x: m.x, y: spec.y ?? m.y,
    };
    if (m.z !== undefined) pin.z = m.z;
    pin.mob = m.id;
    if (m.npc !== undefined) pin.npc = m.npc;
    const note = spec.note ?? m.checklist;
    if (note) pin.note = note;
    if (m.npc !== undefined && onPlanSet.has(m.npc)) pin.onPlan = true;
    return pin;
  };

  const startMob = MOB.get(zone.start.mob);
  if (!startMob) throw new Error(`route planner: the zone's start mob does not exist: ${zone.start.mob}`);
  const startPin = mkPin({ mob: zone.start.mob, label: zone.start.label, kind: zone.start.kind });

  // the zone's own groups
  const groups: Group[] = zone.groups.map(spec => {
    const pins = spec.pins.map(mkPin);
    return { spec, pins, onPlan: pins.some(p => p.onPlan) };
  });

  // (a) every named mob the zone's groups do not lay down: a boss is a required stop, a named is optional. A zone with no
  // groups of its own (one nobody has written a build for) is built from this alone.
  const laid = new Set(groups.flatMap(g => g.pins.map(p => p.npc)).filter((n): n is number => n !== undefined));
  let rankBase = zone.groups.reduce((a, g) => Math.max(a, g.rank), 0) + 1;
  for (const m of mobs) {
    if (m.id === zone.start.mob || m.npc === undefined || laid.has(m.npc) || (m.kind !== 'boss' && m.kind !== 'named')) continue;
    laid.add(m.npc);
    const spec: BuildGroup = { id: `named-${m.npc}`, rank: rankBase++, pins: [{ mob: m.id, optional: m.kind === 'named' }] };
    const pins = spec.pins.map(mkPin);
    groups.push({ spec, pins, onPlan: pins.some(p => p.onPlan) });
  }
  input.onPlanNpcs.forEach((npc, i) => {
    if (laid.has(npc)) return;
    const m = mobs.find(x => x.npc === npc);
    if (!m) return;
    laid.add(npc);
    const spec: BuildGroup = { id: `card-${npc}`, rank: rankBase + i, pins: [{ mob: m.id }] };
    const pins = spec.pins.map(mkPin);
    groups.push({ spec, pins, onPlan: true });
  });

  const stepIndex = (key?: string) => (key ? checklist.findIndex(s => s.key === key) : -1);
  const rankOf = (g: Group) => {
    const i = stepIndex(g.spec.popKey);
    return i >= 0 ? i : checklist.length + g.spec.rank;
  };

  const lead = groups.filter(g => g.spec.lead);
  const final = groups.filter(g => g.spec.last && !g.spec.lead);
  const rest = groups.filter(g => !g.spec.lead && !g.spec.last);
  const first = rest.filter(g => g.onPlan), later = rest.filter(g => !g.onPlan);

  const seq: Group[] = [...lead];
  const origin: { x: number; y: number } = (() => {
    const lastLead = lead[lead.length - 1];
    return lastLead ? lastLead.pins[lastLead.pins.length - 1] : startPin;
  })();

  if (order === 'checklist') {
    seq.push(...[...first].sort((a, b) => rankOf(a) - rankOf(b)), ...[...later].sort((a, b) => rankOf(a) - rankOf(b)));
  } else {
    let cur = { x: origin.x, y: origin.y };
    for (const bucket of [first, later]) {
      const left = [...bucket];
      while (left.length) {
        let bi = 0, bd = Infinity;
        left.forEach((g, i) => { const d = dist(cur, g.pins[0]); if (d < bd) { bd = d; bi = i; } });
        const g = left.splice(bi, 1)[0];
        if (g.spec.swapFirstTwo && g.pins.length > 1 && dist(cur, g.pins[0]) > dist(cur, g.pins[1])) {
          [g.pins[0], g.pins[1]] = [g.pins[1], g.pins[0]];   // inside the event chain the two door guards come first, nearest one first
        }
        seq.push(g);
        cur = g.pins[g.pins.length - 1];
      }
    }
  }

  seq.push(...[...final].sort((a, b) => rankOf(a) - rankOf(b)));

  const pins = [startPin, ...seq.flatMap(g => g.pins)];
  const onPlanPins = pins.filter(p => p.onPlan).length;
  const base = zone.buildNotes?.[order] ?? (order === 'greedy'
    ? 'Built with nearest-next from the zone-in (straight-line distance); each event stays one chain.'
    : 'Built in PoP checklist order, then the other bosses and named. Zone-in first.');
  const note = onPlanPins
    ? `${base} ${onPlanPins} pin${onPlanPins === 1 ? '' : 's'} from the fight cards on /raid/plan ${onPlanPins === 1 ? 'is' : 'are'} marked "on the plan" and laid down first.`
    : base;
  return { pins, note, onPlanPins };
}
