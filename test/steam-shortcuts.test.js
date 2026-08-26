// Steam Deck (#156): reading and rewriting Steam's binary shortcuts.vdf.
//
// What these tests are really protecting: that file holds ALL of a user's
// non-Steam games, not just ours, and Steam gives no API for it — we edit the
// bytes by hand. Two failure modes cost real damage and neither is visible from
// inside Mimic:
//
//   • a field or an entry we fail to preserve is somebody's launch options, grid
//     artwork or whole game, deleted on the next write;
//   • a non-idempotent upsert gives the raider a second "EverQuest" in their
//     library every time the installer runs.
//
// So the format tests build their buffers BY HAND from the type bytes rather
// than through the module's own serializer — otherwise a wrong encoder would
// simply agree with itself.
//
// Run: npx vitest run test/steam-shortcuts.test.js

import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { ROOT } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const S = require_(path.join(ROOT, 'apps', 'mimic', 'steamShortcuts.js'));

// ── hand-rolled binary KeyValues, straight from the spec ────────────────────
const NUL  = Buffer.from([0x00]);
const cstr = (s) => Buffer.concat([Buffer.from(s, 'utf8'), NUL]);
const str  = (k, v) => Buffer.concat([Buffer.from([0x01]), cstr(k), cstr(v)]);
const int  = (k, n) => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n, 0);
  return Buffer.concat([Buffer.from([0x02]), cstr(k), b]);
};
const map  = (k, ...body) => Buffer.concat([Buffer.from([0x00]), cstr(k), ...body, Buffer.from([0x08])]);
const doc  = (...entries) => Buffer.concat([Buffer.from([0x00]), cstr('shortcuts'), ...entries, Buffer.from([0x08, 0x08])]);

describe('binary VDF round trip', () => {
  // One realistic file: our launcher plus a second game, a nested tags map, a
  // couple of int32 booleans, and the negative appid every non-Steam shortcut
  // has (the top bit is always set, so the signed value is always < 0).
  const FILE = doc(
    map('0',
      int('appid', -1330006095),
      str('AppName', 'EverQuest (Wolf Pack)'),
      str('Exe', '"/home/deck/wolfpack-eq.sh"'),
      str('StartDir', '"/home/deck/"'),
      str('icon', ''),
      str('ShortcutPath', ''),
      str('LaunchOptions', 'ENABLE_GAMESCOPE_WSI=0 %command%'),
      int('IsHidden', 0),
      int('AllowDesktopConfig', 1),
      int('AllowOverlay', 1),
      int('LastPlayTime', 1755000000),
      map('tags', str('0', 'Favorite'), str('1', 'EverQuest')),
    ),
    map('1',
      int('appid', -7),
      str('AppName', 'Some Other Game'),
      str('Exe', '"/home/deck/other"'),
      map('tags'),
    ),
  );

  const EXPECTED = [
    {
      appid: -1330006095,
      AppName: 'EverQuest (Wolf Pack)',
      Exe: '"/home/deck/wolfpack-eq.sh"',
      StartDir: '"/home/deck/"',
      icon: '',
      ShortcutPath: '',
      LaunchOptions: 'ENABLE_GAMESCOPE_WSI=0 %command%',
      IsHidden: 0,
      AllowDesktopConfig: 1,
      AllowOverlay: 1,
      LastPlayTime: 1755000000,
      tags: { 0: 'Favorite', 1: 'EverQuest' },
    },
    { appid: -7, AppName: 'Some Other Game', Exe: '"/home/deck/other"', tags: {} },
  ];

  it('parses maps, strings, int32s, a negative appid and a nested tags map', () => {
    expect(S.parseShortcuts(FILE)).toEqual(EXPECTED);
  });

  it('re-serializes byte-identically to what Steam wrote', () => {
    // Byte-identical, not merely equivalent: anything else means we reordered or
    // retyped a field, and a diffed file is how you find out you broke Steam.
    expect(S.serializeShortcuts(S.parseShortcuts(FILE)).equals(FILE)).toBe(true);
  });

  it('objects survive parse(serialize(x)) unchanged', () => {
    expect(S.parseShortcuts(S.serializeShortcuts(EXPECTED))).toEqual(EXPECTED);
  });

  it('keeps unknown fields Steam added in some other client version', () => {
    // We must never be the reason a field vanishes: this file is shared with
    // every other tool the user runs, and future Steam builds add keys.
    const withNovel = doc(map('0',
      str('AppName', 'X'),
      str('FlatpakAppID', ''),
      str('SomeFieldFromANewerSteam', 'keep me'),
      int('DevkitOverrideAppID', 0),
      int('SomeFutureFlag', 1),
    ));
    const parsed = S.parseShortcuts(withNovel);
    expect(parsed[0].SomeFieldFromANewerSteam).toBe('keep me');
    expect(parsed[0].SomeFutureFlag).toBe(1);
    expect(S.serializeShortcuts(parsed).equals(withNovel)).toBe(true);
  });

  it('int32s are little-endian and signed', () => {
    // Wrong endianness or an unsigned write turns an appid into a different
    // (still plausible-looking) number, and the grid art silently stops loading.
    expect(S.parseShortcuts(doc(map('0', int('appid', -1330006095))))[0].appid).toBe(-1330006095);
    expect([...S._int32(-1330006095)]).toEqual([0xB1, 0xB7, 0xB9, 0xB0]);
    expect([...S._int32(1)]).toEqual([1, 0, 0, 0]);
    // A caller handing us the UNSIGNED spelling of the same appid (what grid
    // filenames use) must produce the same four bytes, not a clamp to INT_MAX.
    expect([...S._int32(2964961201)]).toEqual([0xB1, 0xB7, 0xB9, 0xB0]);
  });
});

describe('a Deck that has never had a non-Steam game', () => {
  it('an absent or zero-length file is [] , not a crash', () => {
    expect(S.parseShortcuts(null)).toEqual([]);
    expect(S.parseShortcuts(undefined)).toEqual([]);
    expect(S.parseShortcuts(Buffer.alloc(0))).toEqual([]);
  });

  it('serializing [] produces a valid minimal document ending in two 0x08', () => {
    const buf = S.serializeShortcuts([]);
    expect(buf.equals(doc())).toBe(true);
    expect(buf[0]).toBe(0x00);
    expect(buf.toString('utf8', 1, 10)).toBe('shortcuts');
    expect([...buf.slice(-2)]).toEqual([0x08, 0x08]);   // close map, close document
    expect(S.parseShortcuts(buf)).toEqual([]);
  });

  it('refuses a corrupt file instead of parsing it short', () => {
    // The dangerous shape: parse returns fewer entries than the file holds, we
    // write that back, and the user's other games are gone. Throwing makes the
    // installer stop, which is the only safe answer.
    const corrupt = Buffer.concat([Buffer.from([0x00]), cstr('shortcuts'), Buffer.from([0x07]), cstr('what')]);
    expect(() => S.parseShortcuts(corrupt)).toThrow(/unknown field type/i);
    const truncated = Buffer.concat([Buffer.from([0x00]), cstr('shortcuts'), map('0', str('AppName', 'X'))]);
    expect(() => S.parseShortcuts(truncated)).toThrow(/unexpected end of file/i);
  });
});

describe('upsertShortcut — run the installer twice, get ONE library entry', () => {
  const ours = {
    appid: S.shortcutAppId('"/home/deck/wolfpack-eq.sh"', 'EverQuest (Wolf Pack)'),
    AppName: 'EverQuest (Wolf Pack)',
    Exe: '"/home/deck/wolfpack-eq.sh"',
    StartDir: '"/home/deck/"',
    LaunchOptions: 'ENABLE_GAMESCOPE_WSI=0 %command%',
  };

  it('is idempotent: twice in a row is still one entry', () => {
    const a = S.upsertShortcut([], ours);
    expect(a.added).toBe(true);
    expect(a.index).toBe(0);
    const b = S.upsertShortcut(a.list, ours);
    expect(b.added).toBe(false);
    expect(b.index).toBe(0);
    expect(b.list).toHaveLength(1);
    // …and a third time, since "the installer ran again" has no upper bound.
    expect(S.upsertShortcut(b.list, ours).list).toHaveLength(1);
  });

  it('an update keeps the existing appid, tags and LastPlayTime', () => {
    // appid is where Steam files the user's grid artwork and tags are their
    // collections; recomputing or dropping either loses work Steam cannot
    // recover. Only the fields we actually pass may change.
    const existing = [{
      appid: -42,
      AppName: 'EverQuest (Wolf Pack)',
      Exe: '"/home/deck/old-launcher.sh"',
      LaunchOptions: 'old',
      LastPlayTime: 1755000000,
      tags: { 0: 'Favorite' },
      SomeFutureFlag: 1,
    }];
    const { list, added, index } = S.upsertShortcut(existing, {
      AppName: 'EverQuest (Wolf Pack)',
      Exe: '"/home/deck/wolfpack-eq.sh"',
      LaunchOptions: 'ENABLE_GAMESCOPE_WSI=0 %command%',
    });
    expect(added).toBe(false);
    expect(index).toBe(0);
    expect(list[0].appid).toBe(-42);
    expect(list[0].tags).toEqual({ 0: 'Favorite' });
    expect(list[0].LastPlayTime).toBe(1755000000);
    expect(list[0].SomeFutureFlag).toBe(1);
    expect(list[0].Exe).toBe('"/home/deck/wolfpack-eq.sh"');
    expect(list[0].LaunchOptions).toBe('ENABLE_GAMESCOPE_WSI=0 %command%');
  });

  it('a falsy appid never overwrites the real one', () => {
    // A caller building a fresh shortcut object with `appid: 0` as a placeholder
    // must not orphan the artwork filed under the existing id.
    const { list } = S.upsertShortcut([{ appid: -42, AppName: 'X', Exe: '"/x"' }], { AppName: 'X', appid: 0 });
    expect(list[0].appid).toBe(-42);
  });

  it('still appends a genuinely different game', () => {
    const { list } = S.upsertShortcut([{ AppName: 'Some Other Game', Exe: '"/home/deck/other"' }], ours);
    expect(list).toHaveLength(2);
    expect(list[1].AppName).toBe('EverQuest (Wolf Pack)');
    // The unrelated game is untouched — this is the whole "don't wreck the
    // library" contract in one assertion.
    expect(list[0]).toEqual({ AppName: 'Some Other Game', Exe: '"/home/deck/other"' });
  });

  it('matches on Exe when one side is quoted and the other is not', () => {
    // Steam writes Exe quoted; steamtinkerlaunch and hand edits often do not.
    // Miss this and a user who added the shortcut themselves gets a duplicate.
    const bare = S.upsertShortcut([{ AppName: 'EQ (mine)', Exe: '/home/deck/wolfpack-eq.sh' }], ours);
    expect(bare.added).toBe(false);
    expect(bare.list).toHaveLength(1);
    expect(bare.list[0].AppName).toBe('EverQuest (Wolf Pack)');

    const quoted = S.upsertShortcut([{ AppName: 'EQ (mine)', Exe: '"/home/deck/wolfpack-eq.sh"' }],
      { AppName: 'EverQuest (Wolf Pack)', Exe: '/home/deck/wolfpack-eq.sh' });
    expect(quoted.added).toBe(false);
    expect(quoted.list).toHaveLength(1);
  });

  it('AppName matching is case-sensitive, like Steam\'s own library', () => {
    const { added, list } = S.upsertShortcut([{ AppName: 'mimic', Exe: '"/a"' }], { AppName: 'Mimic', Exe: '"/b"' });
    expect(added).toBe(true);
    expect(list).toHaveLength(2);
  });

  it('does not mutate the caller\'s array or the row it matched', () => {
    const original = [{ AppName: 'EverQuest (Wolf Pack)', Exe: '"/old"', LaunchOptions: 'old' }];
    const snapshot = JSON.parse(JSON.stringify(original));
    S.upsertShortcut(original, ours);
    expect(original).toEqual(snapshot);
  });

  it('survives a write/read cycle as one entry', () => {
    // End to end: the shape upsert produces has to be serializable, because
    // that is the only thing the user ever sees.
    const { list } = S.upsertShortcut(S.parseShortcuts(S.serializeShortcuts([])), ours);
    expect(S.parseShortcuts(S.serializeShortcuts(list))).toEqual([ours]);
  });
});

describe('shortcutAppId — the id Steam files grid artwork under', () => {
  const exe = '"/home/deck/wolfpack-eq.sh"';
  const name = 'EverQuest (Wolf Pack)';

  it('crc32 is the real IEEE 802.3 one', () => {
    // The canonical check vector. A homegrown crc that is merely self-consistent
    // would produce ids Steam does not agree with, so pin it to the standard.
    expect(S._crc32('123456789')).toBe(0xCBF43926);
    expect(S._crc32('')).toBe(0);
  });

  it('is deterministic', () => {
    expect(S.shortcutAppId(exe, name)).toBe(S.shortcutAppId(exe, name));
  });

  it('has the top bit set and fits a signed int32', () => {
    const id = S.shortcutAppId(exe, name);
    expect(Number.isInteger(id)).toBe(true);
    expect(id).toBeLessThan(0);                       // top bit set ⇒ negative
    expect(id >= -2147483648 && id <= 2147483647).toBe(true);
    expect(((id >>> 0) & 0x80000000) >>> 0).toBe(0x80000000);
    expect(id).toBe((S._crc32(exe + name) | 0x80000000) | 0);
  });

  it('round-trips through the int32 field unchanged', () => {
    // The whole reason it is returned signed: a value that does not survive
    // writeInt32LE would land in the file as a different game's id.
    const id = S.shortcutAppId(exe, name);
    const buf = S.serializeShortcuts([{ appid: id, AppName: name, Exe: exe }]);
    expect(S.parseShortcuts(buf)[0].appid).toBe(id);
  });

  it('different exe or name ⇒ different id', () => {
    expect(S.shortcutAppId(exe, name)).not.toBe(S.shortcutAppId(exe, 'EverQuest'));
    expect(S.shortcutAppId(exe, name)).not.toBe(S.shortcutAppId('"/home/deck/other.sh"', name));
  });
});

describe('findSteamUserConfigs — where the file actually lives', () => {
  // A fake filesystem, so this runs anywhere: no Steam, no home dir, no writes.
  const fakeFs = (paths) => {
    const set = new Set(paths);
    return {
      existsSync: (p) => set.has(p),
      readdirSync: (p) => [...set]
        .filter(x => x.startsWith(p + '/') && !x.slice(p.length + 1).includes('/'))
        .map(x => x.slice(p.length + 1)),
    };
  };
  const A = '/home/deck/.steam/steam/userdata';
  const B = '/home/deck/.local/share/Steam/userdata';

  it('finds a user under the .steam/steam layout', () => {
    const F = fakeFs([A, `${A}/76561198000000001`, `${A}/76561198000000001/config`,
      `${A}/76561198000000001/config/shortcuts.vdf`]);
    const found = S.findSteamUserConfigs('/home/deck', F);
    expect(found).toHaveLength(1);
    expect(found[0].steamId).toBe('76561198000000001');
    expect(found[0].shortcutsPath).toBe(`${A}/76561198000000001/config/shortcuts.vdf`);
    expect(found[0].exists).toBe(true);
  });

  it('finds a user under the .local/share/Steam layout too', () => {
    // Which of the two is the real directory varies by distro and by how Steam
    // was installed; checking only one is how this misses on a non-Deck Linux.
    const F = fakeFs([B, `${B}/76561198000000002`, `${B}/76561198000000002/config`]);
    const found = S.findSteamUserConfigs('/home/deck', F);
    expect(found).toHaveLength(1);
    expect(found[0].steamId).toBe('76561198000000002');
    expect(found[0].shortcutsPath).toBe(`${B}/76561198000000002/config/shortcuts.vdf`);
    // No file yet — a user who has never added a non-Steam game. Still a valid
    // target: creating it is the point.
    expect(found[0].exists).toBe(false);
  });

  it('de-dupes the same user seen through both paths, preferring .steam/steam', () => {
    // On SteamOS ~/.steam/steam is a symlink to ~/.local/share/Steam, so both
    // roots list the same profile. Returning it twice would have us write the
    // file, then write it again over our own output.
    const id = '76561198000000003';
    const F = fakeFs([
      A, `${A}/${id}`, `${A}/${id}/config`, `${A}/${id}/config/shortcuts.vdf`,
      B, `${B}/${id}`, `${B}/${id}/config`, `${B}/${id}/config/shortcuts.vdf`,
    ]);
    const found = S.findSteamUserConfigs('/home/deck', F);
    expect(found).toHaveLength(1);
    expect(found[0].shortcutsPath.startsWith(A)).toBe(true);
  });

  it('skips anonymous and 0 — neither is a signed-in user', () => {
    // A shortcut written into either simply never shows up in the library, and
    // the user is left staring at an installer that claims it worked.
    const F = fakeFs([
      A, `${A}/anonymous`, `${A}/anonymous/config`, `${A}/anonymous/config/shortcuts.vdf`,
      `${A}/0`, `${A}/0/config`, `${A}/0/config/shortcuts.vdf`,
      `${A}/76561198000000004`, `${A}/76561198000000004/config`,
    ]);
    const found = S.findSteamUserConfigs('/home/deck', F);
    expect(found.map(f => f.steamId)).toEqual(['76561198000000004']);
  });

  it('returns both users on a shared Deck', () => {
    const F = fakeFs([
      A, `${A}/76561198000000005`, `${A}/76561198000000005/config`,
      `${A}/76561198000000006`, `${A}/76561198000000006/config`,
    ]);
    expect(S.findSteamUserConfigs('/home/deck', F).map(f => f.steamId))
      .toEqual(['76561198000000005', '76561198000000006']);
  });

  it('no Steam at all is an empty list, not a throw', () => {
    expect(S.findSteamUserConfigs('/home/deck', fakeFs([]))).toEqual([]);
  });
});
