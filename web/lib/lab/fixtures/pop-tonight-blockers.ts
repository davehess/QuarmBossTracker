// Made-up data for the "who cannot enter tonight" draft. People come from LAB_RAID; zone and flag names are game data.
import { LAB_RAID } from '../people';
import { mapBlockers, type BlockersView, type FlagIn, type PlanIn } from '../../popTonightBlockersView';

export type LabState = 'full' | 'clear';

export const FLAGS: FlagIn[] = [
  { key: 'justice', short: 'Justice', label: 'Justice flag (Mavuin 3)' },
  { key: 'adler', short: 'Adler', label: 'Adler: say "ward"' },
  { key: 'door', short: 'Door', label: 'Innovation door' },
  { key: 'giwin', short: 'Giwin', label: 'Giwin: "test the machine"' },
  { key: 'longstep', short: 'Door opener: Xanamech, Nitram, then the factory door 7 lever', label: '' },
  { key: 'maze', short: 'Maze', label: 'Hedge maze + Thelin' },
  { key: 'adroha', short: 'Adroha', label: 'Adroha: "tortured by nightmares"' },
];

export const PLAN: PlanIn[] = [
  { id: 'valor', zoneName: 'Plane of Valor', needs: ['justice'],
    how: 'Tranquility, Valor portal, then the north bridge to the Justice door.',
    expect: 'Four named in a row, summoned adds on the second, no rampage.' },
  { id: 'innovation', zoneName: 'Plane of Innovation', needs: ['door', 'giwin', 'longstep'],
    how: 'Tranquility, Innovation portal, factory door 7 stays open while a flagged raider holds it.',
    expect: 'Prototypes first, then the Behemoth with a knockback every 40 seconds.' },
  { id: 'nightmare', zoneName: 'Plane of Nightmares', needs: ['maze', 'adroha'],
    how: 'Tranquility, Nightmares portal, the hedge maze from the south gate.',
    expect: 'Long walk, then Terris with heavy AE fear. Bring fear ward.' },
];

// Who lacks what tonight. Zone 1 nobody; zone 2 four people; zone 3 eleven.
const BLOCK: Record<string, string[]> = {
  Tolvane: ['giwin'], Kestrel: ['giwin'], Garrow: ['door', 'giwin'], Yorick: ['longstep'],
  Aldenmar: ['maze'], Corvale: ['adroha'], Zarrin: ['maze'], Maerwyn: ['maze', 'adroha'], Ulric: ['adroha'],
  Fenwick: ['maze'], Isolwen: ['adroha'], Norvane: ['maze'], Rowanne: ['adroha'], Sigrun: ['maze'],
  Wystan: ['adroha'],
};
// Raiders missing a flag that tonight does not need (shows in the full table only).
const NO_ADLER = new Set(['Jessamy', 'Ilara', 'Dravik']);

const hasFlag = (state: LabState) => (name: string, key: string): boolean => {
  if (state === 'clear') return true;
  if (key === 'adler') return !NO_ADLER.has(name);
  return !(BLOCK[name] ?? []).includes(key);
};

export function popBlockersFixture(state: LabState) {
  const has = hasFlag(state);
  const raiders = LAB_RAID.map((p) => ({ name: p.name }));
  const view: BlockersView = mapBlockers(PLAN, FLAGS, raiders, has);
  const table = {
    flags: FLAGS.map((f) => ({ key: f.key, short: f.key === 'longstep' ? 'Opener' : (f.short ?? f.key) })),
    rows: LAB_RAID.map((p) => ({ name: p.name, cls: p.cls, has: FLAGS.map((f) => has(p.name, f.key)) })),
  };
  // The viewer's own three characters, and what each still needs for tonight's targets.
  const mineNames = ['Brackwyn', 'Maerwyn', 'Tolvane'];
  const mine = mineNames.map((n) => {
    const m = mapBlockers(PLAN, FLAGS, [{ name: n }], has);
    return {
      name: n, cls: LAB_RAID.find((p) => p.name === n)?.cls ?? '',
      needs: m.zones.filter((z) => z.blocked.length).map((z) => ({ zone: z.zone, missing: z.blocked[0].missing })),
    };
  });
  return { view, table, mine };
}
