// The zones the route planner knows. Add one = its json and its settings .ts in this folder, and a line here.
import type { ZoneData } from '../types';
import { potactics } from './potactics';
import { solrotower } from './solrotower';

export const ZONES: Record<string, ZoneData> = { potactics, solrotower };
export const DEFAULT_ZONE = 'potactics';

export function zoneData(zone: string | null | undefined): ZoneData | null {
  return zone && Object.prototype.hasOwnProperty.call(ZONES, zone) ? ZONES[zone] : null;
}

/** For the picker: every zone, in the order above. */
export const zoneList = (): { zone: string; name: string; stub: boolean }[] => Object.values(ZONES).map(z => ({ zone: z.zone, name: z.name, stub: z.stub }));
