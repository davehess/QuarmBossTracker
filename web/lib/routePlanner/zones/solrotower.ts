// Tower of Solusek Ro (solrotower), the next progression zone. The data file (solrotower.json: walls by floor, the mobs,
// the pathers, the doors and teleports, and whatever nights have been recorded) is built separately and dropped in here;
// until then it is a stub and the page says so. Everything below is a default the data file may override through its own
// `config`. The tower is vertical (many levels), which is what `floors` in the data file are for.
import type { ZoneJson } from '../types';
import { makeZone, type ZoneSettings } from './make';
import json from './solrotower.json';

const settings: ZoneSettings = {
  zone: 'solrotower',
  zoneId: 212,
  name: 'Tower of Solusek Ro',
  title: 'Sol Ro tower route planner',
  blurb: 'Tower of Solusek Ro. Plan the five minis and Solusek Ro, bend the route around walls, send some of the raid up a different staircase.',
  popKeys: ['flag_solro_minis', 'flag_solro'],
  // From the zone's scripts (solrotower/*.lua): each wing boss leaves a cauldron everyone clicks for their own wing flag
  // (one digit of sol_room); Solusek Ro is only worth killing with all five digits (plus Miak's preflag and the Rallos Zek flag), so he goes last.
  buildNotes: {
    greedy: 'Built with nearest-next from the zone-in (straight-line distance, so check the floors); each wing is boss then cauldron click, Solusek Ro and his Projection last.',
    checklist: 'Built in checklist order: the five wings (boss, then everyone clicks the cauldron), then Solusek Ro and his Projection.',
  },
  groups: [
    { id: 'xuzl', rank: 1, popKey: 'flag_solro_minis', pins: [{ mob: 'xuzl' }, { mob: 'caul_xuzl', kind: 'objective', note: 'Everyone clicks the cauldron: wing flag (sol_room digit 1)' }] },
    { id: 'arlyxir', rank: 2, popKey: 'flag_solro_minis', pins: [{ mob: 'arlyxir' }, { mob: 'caul_arlyxir', kind: 'objective', note: 'Everyone clicks the cauldron: wing flag (sol_room digit 2)' }] },
    {
      id: 'dresolik', rank: 3, popKey: 'flag_solro_minis',
      pins: [
        { mob: 'dres_guardians', note: 'All four Guardians; the last one down summons the Protector' },
        { mob: 'protector', y: 1624 },
        { mob: 'caul_dresolik', kind: 'objective', note: 'Everyone clicks the cauldron: wing flag (sol_room digit 3)' },
      ],
    },
    {
      id: 'rizlona', rank: 4, popKey: 'flag_solro_minis',
      pins: [
        { mob: 'rizlona' },
        { mob: 'rizlona2', y: 2424, note: 'Stands up where the first form dies' },
        { mob: 'caul_rizlona', kind: 'objective', note: 'Everyone clicks the cauldron: wing flag (sol_room digit 4)' },
      ],
    },
    { id: 'jiva', rank: 5, popKey: 'flag_solro_minis', pins: [{ mob: 'jiva' }, { mob: 'caul_jiva', kind: 'objective', note: 'Everyone clicks the cauldron: wing flag (sol_room digit 5)' }] },
    {
      id: 'solro', rank: 6, popKey: 'flag_solro', last: true,
      pins: [
        { mob: 'guardians_fire', optional: true, note: 'The six Guardians of Fire in his corridor' },
        { mob: 'solro' },
        { mob: 'proj', label: 'Hail Planar Projection (Solusek Ro)', kind: 'objective', note: 'Hail with all five wing flags, Miak\'s preflag and the Rallos Zek flag' },
      ],
    },
  ],
};

export const solrotower = makeZone(settings, json as unknown as ZoneJson);
