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
};

export const solrotower = makeZone(settings, json as unknown as ZoneJson);
