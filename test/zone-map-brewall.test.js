// test/zone-map-brewall.test.js — the spectator map's second layer: the in-game map text parser
// (web/lib/zoneMap/brewall.ts), the file-name guard (web/lib/zoneMap/source.ts) and the fetchers'
// hit / miss / failure split (web/lib/zoneMap/load.ts).
//
// Every string here is invented. The real map files are third-party art with no stated licence and
// are never copied into this public repo, not even as a fixture; the parser is exercised on a few
// made-up rows that have the same shape.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseBrewallMaps } from '../web/lib/zoneMap/brewall.ts';
import { brewallFileNames, brewallFileUrl } from '../web/lib/zoneMap/source.ts';

// ---- parser ---------------------------------------------------------------------------------

describe('parseBrewallMaps', () => {
  const text = [
    'L 10.0, 20.0, 5.4, -30.0, 40.0, 6.0, 255, 0, 128',
    'L 1,2,3,4,5,6,7,8,9',
    'P 100.4, -200.6, 7.0, 255, 0, 0, 3, to_The_Test_Zone',
    'P 0.0, 0.0, 0.0, 10, 20, 30, 2, Zone_Line,_North',
  ].join('\n');
  const out = parseBrewallMaps([text]);

  it('reads lines and labels', () => {
    expect(out.lines).toHaveLength(2);
    expect(out.labels).toHaveLength(2);
  });

  it('negates x and y into the server frame and leaves z alone', () => {
    // file (10, 20, 5.4)-(-30, 40, 6) -> server (-10, -20, 5)-(30, -40, 6)
    expect(out.lines[0]).toEqual([-10, -20, 5, 30, -40, 6, 255, 0, 128]);
    expect(out.lines[1]).toEqual([-1, -2, 3, -4, -5, 6, 7, 8, 9]);
    // labels get the same flip: file (100.4, -200.6) -> server (-100, 201)
    expect(out.labels[0]).toEqual([-100, 201, 7, 'to The Test Zone']);
  });

  it('turns underscores into spaces and keeps a comma inside the label', () => {
    expect(out.labels[1][3]).toBe('Zone Line, North');
  });

  it('never yields -0 (a negated 0)', () => {
    expect(out.labels[1].slice(0, 3)).toEqual([0, 0, 0]);
    expect(parseBrewallMaps(['L 0, 0, 0, 0, 0, 0, 1, 2, 3']).lines[0]).toEqual([0, 0, 0, 0, 0, 0, 1, 2, 3]);
  });

  it('bounds the drawn lines, in the server frame', () => {
    expect(out.bounds).toEqual({ minX: -10, maxX: 30, minY: -40, maxY: -2 });
  });

  it('tolerates CRLF, a byte-order mark, indentation, blank lines and no space after commas', () => {
    const messy = String.fromCharCode(0xfeff) + 'L 1,2,3,4,5,6,7,8,9\r\n\r\n   P 5 ,6, 7 ,0,0,0,2,  spaced_out  \r\n\r\n';
    const r = parseBrewallMaps([messy]);
    expect(r.lines).toEqual([[-1, -2, 3, -4, -5, 6, 7, 8, 9]]);
    expect(r.labels).toEqual([[-5, -6, 7, 'spaced out']]);
  });

  it('skips garbage instead of failing, and does not read blank fields as zero', () => {
    const r = parseBrewallMaps([[
      'Lorem ipsum dolor',
      'L 1, 2, 3',                         // too few fields
      'L a, b, c, d, e, f, g, h, i',       // not numbers
      'L , , , , , , , , ',                // blank fields: Number("") would be 0, a phantom line at the origin
      'P 1, 2, 3, 4, 5, 6, 7, ',           // no label text
      'P 1, 2, 3, 4, 5, 6',                // no label field at all
      'X 1, 2, 3, 4, 5, 6, 7, 8, 9',       // not a line or a point
      '# a comment',
      'L 9, 9, 9, 8, 8, 8, 1, 1, 1',       // and one good row among them
    ].join('\n')]);
    expect(r.lines).toEqual([[-9, -9, 9, -8, -8, 8, 1, 1, 1]]);
    expect(r.labels).toEqual([]);
  });

  it('clamps colour channels into 0-255', () => {
    expect(parseBrewallMaps(['L 1, 1, 1, 2, 2, 2, 300, -5, 12']).lines[0].slice(6)).toEqual([255, 0, 12]);
  });

  it('merges several files of one zone into one layer', () => {
    const r = parseBrewallMaps(['L 1, 1, 1, 2, 2, 2, 0, 0, 0', 'P 3, 3, 3, 0, 0, 0, 2, Somewhere', 'L 5, 5, 5, 6, 6, 6, 0, 0, 0']);
    expect(r.lines).toHaveLength(2);
    expect(r.labels).toEqual([[-3, -3, 3, 'Somewhere']]);
  });

  it('falls back to the labels for bounds when a zone has no lines, and to zeros when it has nothing', () => {
    expect(parseBrewallMaps(['P 10, 20, 0, 0, 0, 0, 2, A', 'P -30, 40, 0, 0, 0, 0, 2, B']).bounds)
      .toEqual({ minX: -10, maxX: 30, minY: -40, maxY: -20 });
    expect(parseBrewallMaps([''])).toEqual({ lines: [], labels: [], bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } });
  });
});

// ---- file names -----------------------------------------------------------------------------

describe('brewallFileNames / brewallFileUrl', () => {
  const listing = [
    'testzone.txt', 'TestZone_1.txt', 'testzone2.txt', 'TestZone2_1.txt', 'otherzone.txt',
    'testzone_2.txt', 'testzone_1.txt.exe', 'testzone_1.txt\n', '../testzone.txt', 'a/testzone.txt', 'testzone_123.txt',
  ];

  it('picks a zone\'s own files whatever their case, and nothing else', () => {
    expect(brewallFileNames('testzone', listing)).toEqual(['TestZone_1.txt', 'testzone.txt', 'testzone_2.txt']);
    // a zone whose name is a prefix of another's must not pull in the other's files
    expect(brewallFileNames('testzone2', listing)).toEqual(['TestZone2_1.txt', 'testzone2.txt']);
  });

  it('returns nothing for a zone the listing does not have', () => {
    expect(brewallFileNames('nowhere', listing)).toEqual([]);
  });

  it('guesses lowercase and capitalised spellings when there is no listing', () => {
    expect(brewallFileNames('testzone', null)).toEqual(['testzone.txt', 'testzone_1.txt', 'Testzone_1.txt']);
  });

  it('refuses a zone name that is not a short name', () => {
    expect(() => brewallFileNames('../x', null)).toThrow();
    expect(() => brewallFileNames('Test', [])).toThrow();
  });

  it('builds the raw URL only for a plain map file name', () => {
    expect(brewallFileUrl('TestZone_1.txt'))
      .toBe('https://raw.githubusercontent.com/coastalredwood/Zeal/main/Zeal/zone_map_src/map_files/TestZone_1.txt');
    for (const bad of ['../xx.txt', 'aa/bb.txt', 'aa.txt.exe', 'xx.txt\n', 'aa bb.txt', '', 'aa%2fbb.txt', 'aa.TXT']) {
      expect(() => brewallFileUrl(bad)).toThrow();
    }
  });
});

// ---- fetchers -------------------------------------------------------------------------------

describe('fetchBrewallLayer / fetchEqemuLayer', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  // A fake fetch over a table of url-suffix -> [status, body]; anything else is a 404. Records the URLs asked for.
  function fakeFetch(table) {
    const asked = [];
    vi.stubGlobal('fetch', async (url) => {
      asked.push(String(url));
      const hit = Object.entries(table).find(([suffix]) => String(url).endsWith(suffix));
      const [status, body] = hit ? hit[1] : [404, 'Not Found'];
      return new Response(body, { status });
    });
    return asked;
  }
  // The module remembers the directory listing between calls, so each test loads a fresh copy.
  const load = async () => { vi.resetModules(); return import('../web/lib/zoneMap/load.ts'); };
  const LISTING = JSON.stringify([
    { name: 'testzone.txt', type: 'file' }, { name: 'TestZone_1.txt', type: 'file' }, { name: 'otherzone.txt', type: 'file' },
  ]);

  it('fetches the real-cased files from the listing and merges lines with labels', async () => {
    const asked = fakeFetch({
      '/map_files?ref=main': [200, LISTING],
      '/map_files/testzone.txt': [200, 'L 1, 2, 3, 4, 5, 6, 7, 8, 9'],
      '/map_files/TestZone_1.txt': [200, 'P 9, 9, 9, 0, 0, 0, 2, A_Place'],
    });
    const { fetchBrewallLayer } = await load();
    const r = await fetchBrewallLayer('testzone');
    expect(r.complete).toBe(true);
    expect(r.layer.lines).toHaveLength(1);
    expect(r.layer.labels).toEqual([[-9, -9, 9, 'A Place']]);
    expect(asked.some(u => u.endsWith('/map_files/TestZone_1.txt'))).toBe(true);
    expect(asked.some(u => u.includes('otherzone'))).toBe(false);
  });

  it('is null, and complete, when the listing has no file for the zone (and asks for none)', async () => {
    const asked = fakeFetch({ '/map_files?ref=main': [200, LISTING] });
    const { fetchBrewallLayer } = await load();
    expect(await fetchBrewallLayer('nowhere')).toEqual({ layer: null, complete: true });
    expect(asked.filter(u => u.includes('raw.githubusercontent'))).toEqual([]);
  });

  it('guesses the names and says so when the listing cannot be read', async () => {
    fakeFetch({
      '/map_files?ref=main': [403, '{"message":"rate limited"}'],
      '/map_files/testzone.txt': [200, 'L 1, 2, 3, 4, 5, 6, 7, 8, 9'],
      '/map_files/Testzone_1.txt': [200, 'P 9, 9, 9, 0, 0, 0, 2, A_Place'],
    });
    const { fetchBrewallLayer } = await load();
    const r = await fetchBrewallLayer('testzone');
    expect(r.complete).toBe(false);
    expect(r.layer.lines).toHaveLength(1);
    expect(r.layer.labels).toHaveLength(1);
  });

  it('does not call a zone map-less when the names were only guessed', async () => {
    // A mixed-case label file the guess missed would otherwise be cached as "this zone has no art".
    fakeFetch({ '/map_files?ref=main': [403, 'rate limited'] });
    const { fetchBrewallLayer } = await load();
    expect(await fetchBrewallLayer('testzone')).toEqual({ layer: null, complete: false });
  });

  it('throws on a failing map file rather than reading it as "no map"', async () => {
    fakeFetch({ '/map_files?ref=main': [200, LISTING], '/map_files/testzone.txt': [500, 'oops'] });
    const { fetchBrewallLayer } = await load();
    await expect(fetchBrewallLayer('testzone')).rejects.toThrow(/500/);
  });

  it('EQEmu: a 404 is "no map", any other failure throws', async () => {
    fakeFetch({ '/base/gone.map': [404, 'Not Found'], '/base/broken.map': [503, 'down'] });
    const { fetchEqemuLayer } = await load();
    expect(await fetchEqemuLayer('gone')).toBeNull();
    await expect(fetchEqemuLayer('broken')).rejects.toThrow(/503/);
  });
});
