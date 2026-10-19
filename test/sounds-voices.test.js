// test/sounds-voices.test.js — sound effects, voice packs, pronunciation, and the Willsapper proc
// (the guild lead, 2026-10-14).
//
// A member wanted a custom "slap" when their Willsapper weapon procs. Then: "different voice packs,
// get player pronunciation right … allow users to add their own sound effects. allow them to use the
// sound effects instead of callouts tts."
//
//   · the shipped library is real files, small, and every name the editor offers resolves
//   · a trigger stores a NAME ("slap" / "custom:<file>"), never a path; a URL still plays as before
//   · sound_mode 'replace' plays the sound INSTEAD of speaking, and falls back to speaking when the
//     file is not on this PC
//   · a member's own sound on a guild trigger is applied at fire time on this PC only
//   · after_my_melee_ms: "<mob> yawns." is Energy Sap's landing text, but ten other spells print it —
//     it fires only just after the player's OWN melee hit on that same mob
//   · pronunciation: whole words, case-insensitive, longest name first, one pass; the synced list is
//     fetched with an ETag and a 404 means "off", not an error
//
// The shipped agent runs for real (require); the dashboard and triggers.html are slices.
//
// Run: npx vitest run test/sounds-voices.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const SHIPPED = path.join(ROOT, 'apps', 'mimic', 'sounds');
const soundLib = require_('../apps/mimic/sounds.js');
const WPVoice = require_('../apps/mimic/voice.js');

let agent, tmp, userDir, stateDir;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-sounds-'));
  userDir = path.join(tmp, 'sounds'); stateDir = path.join(tmp, 'state');
  fs.mkdirSync(userDir); fs.mkdirSync(stateDir);
  process.env.WOLFPACK_SOUNDS_DIR = SHIPPED;
  process.env.WOLFPACK_SOUNDS_USER_DIR = userDir;
  agent = require_('../packages/wolfpack-logsync/index.js');
  agent._setVoiceStateDirForTest(stateDir);
});
afterAll(() => {
  agent._setVoiceStateDirForTest(null);
  delete process.env.WOLFPACK_SOUNDS_DIR; delete process.env.WOLFPACK_SOUNDS_USER_DIR;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
});
function cleanUser() { for (const f of fs.readdirSync(userDir)) fs.rmSync(path.join(userDir, f)); }
const wav = (name, size = 400) => fs.writeFileSync(path.join(userDir, name), Buffer.alloc(size, 1));

describe('the shipped sound library', () => {
  const NAMES = ['slap', 'bell', 'chime', 'alarm', 'horn', 'gong', 'pop', 'whoosh'];

  it('has the eight sounds, each a real, small audio file', () => {
    const files = fs.readdirSync(SHIPPED);
    for (const n of NAMES) {
      const f = files.find(x => path.basename(x, path.extname(x)) === n);
      expect(f, n).toBeTruthy();
      const st = fs.statSync(path.join(SHIPPED, f));
      expect(st.size, n + ' size').toBeGreaterThan(1000);
      expect(st.size, n + ' under 60 KB').toBeLessThan(60 * 1024);
      const head = fs.readFileSync(path.join(SHIPPED, f)).subarray(0, 4).toString('latin1');
      expect(['RIFF', 'OggS']).toContain(head);
    }
  });

  it('Mimic lists and resolves them by name (and turns a name into a file URL)', () => {
    const list = soundLib.listSounds(SHIPPED, userDir);
    expect(list.map(s => s.name)).toEqual(expect.arrayContaining(NAMES));
    expect(list.every(s => s.source === 'shipped')).toBe(true);
    expect(soundLib.resolveSoundPath('slap', SHIPPED, userDir)).toBe(path.join(SHIPPED, 'slap.wav'));
    expect(soundLib.resolveSoundUrl('SLAP', SHIPPED, userDir)).toMatch(/^file:\/\/.*slap\.wav$/);
  });

  it('electron-builder ships the folder outside the asar, where main.js looks for it', () => {
    const pkg = JSON.parse(readSource(path.join(ROOT, 'apps', 'mimic', 'package.json')));
    expect(pkg.build.extraResources).toContainEqual({ from: 'sounds', to: 'sounds' });
    expect(pkg.build.files).toContain('!sounds/**');
    const main = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));
    expect(main).toMatch(/process\.resourcesPath, 'sounds'/);
    expect(main).toMatch(/ipcMain\.handle\('sounds:list'/);
    expect(main).toMatch(/ipcMain\.handle\('sounds:resolve'/);
    expect(main).toMatch(/ipcMain\.handle\('sounds:open-folder'/);
    expect(main).toContain('WOLFPACK_SOUNDS_USER_DIR');
  });
});

describe('a member\'s own sounds', () => {
  beforeEach(cleanUser);

  it('a custom file with a shipped name overrides it; any other file is "custom:<file>"', () => {
    wav('slap.mp3'); wav('my airhorn.wav');
    for (const lib of [
      (n) => soundLib.resolveSoundPath(n, SHIPPED, userDir),
      (n) => agent._soundResolve(n),
    ]) {
      expect(lib('slap')).toBe(path.join(userDir, 'slap.mp3'));
      expect(lib('custom:my airhorn.wav')).toBe(path.join(userDir, 'my airhorn.wav'));
      expect(lib('bell')).toBe(path.join(SHIPPED, 'bell.ogg'));
    }
    const list = soundLib.listSounds(SHIPPED, userDir);
    expect(list.find(s => s.name === 'slap')).toMatchObject({ source: 'custom', overrides: true, file: 'slap.mp3' });
    expect(list.find(s => s.name === 'custom:my airhorn.wav')).toMatchObject({ source: 'custom' });
    expect(agent._soundList().map(s => s.name)).toEqual(list.map(s => s.name));
  });

  it('only .wav / .mp3 / .ogg of a sane size count', () => {
    wav('notes.txt'); wav('empty.wav', 0); wav('huge.wav', 8 * 1024 * 1024 + 1); wav('fine.ogg');
    const names = agent._soundList().map(s => s.name);
    expect(names).toContain('custom:fine.ogg');
    for (const bad of ['notes.txt', 'empty.wav', 'huge.wav']) expect(names).not.toContain('custom:' + bad);
  });

  it('a name can never reach outside the two folders', () => {
    fs.writeFileSync(path.join(tmp, 'secret.wav'), 'x');
    for (const bad of ['../secret', '../secret.wav', 'custom:../secret.wav', 'custom:..\\secret.wav', '/etc/passwd', 'C:\\x.wav', 'custom:', '', null, 'slap/../x']) {
      expect(soundLib.resolveSoundPath(bad, SHIPPED, userDir), String(bad)).toBeNull();
      expect(agent._soundResolve(bad), String(bad)).toBeNull();
    }
  });

  it('a value a member picks is cleaned to a name, a custom: file or a URL — never a path', () => {
    expect(agent._cleanSoundName(' Slap ')).toBe('slap');
    expect(agent._cleanSoundName('custom:my airhorn.wav')).toBe('custom:my airhorn.wav');
    expect(agent._cleanSoundName('https://wolfpack.quest/sounds/x.mp3')).toBe('https://wolfpack.quest/sounds/x.mp3');
    for (const bad of ['C:\\Users\\x\\a.wav', '../a', 'custom:../a.wav', 'custom:a.exe', 'file:///etc/passwd', '']) expect(agent._cleanSoundName(bad), bad).toBe('');
  });
});

describe('sound_mode: add / replace, volume, and a missing file', () => {
  it('the spec cleans volume to 0-1 and mode to add|replace', () => {
    expect(agent._soundSpecOf({ sound: 'slap', sound_volume: 7, sound_mode: 'replace' })).toEqual({ sound: 'slap', sound_volume: 1, sound_mode: 'replace' });
    expect(agent._soundSpecOf({ sound: 'slap', sound_volume: '0.25', sound_mode: 'nonsense' })).toEqual({ sound: 'slap', sound_volume: 0.25 });
    expect(agent._soundSpecOf({ sound: 'slap' })).toEqual({ sound: 'slap' });
    expect(agent._soundSpecOf({ sound_volume: 0.5 })).toEqual({ sound_volume: 0.5 });
  });

  it('replace silences the spoken callout when the sound can play, and not when it cannot', () => {
    const ok = agent._applySoundSpec({ text: 'X' }, { sound: 'slap', sound_mode: 'replace' });
    expect(ok).toMatchObject({ sound: 'slap', sound_mode: 'replace', mute: true });
    const gone = agent._applySoundSpec({ text: 'X' }, { sound: 'no such sound', sound_mode: 'replace' });
    expect(gone.mute).toBeUndefined();   // missing file: speak instead of saying nothing
    const add = agent._applySoundSpec({ text: 'X' }, { sound: 'slap' });
    expect(add).toMatchObject({ sound: 'slap', sound_mode: 'add' });
    expect(add.mute).toBeUndefined();
    expect(agent._applySoundSpec({ text: 'X' }, { sound: 'https://wolfpack.quest/a.mp3', sound_mode: 'replace' }).mute).toBe(true);
  });

  it('a personal trigger carries sound, volume and mode onto the fired overlay', () => {
    agent._setWatchedLogsForTest([{ character: 'Brackwyn', logPath: 'x' }]);
    const t = agent._compilePersonalTrigger({ id: 'snd-1', name: 'snd-1', pattern: 'a gnoll yelps', enabled: true,
      actions: [{ type: 'text_overlay', text: 'YELP', tts: 'yelp', sound: 'bell', sound_volume: 0.4, sound_mode: 'replace' }] });
    agent._setPersonalTriggersForTest([t]);
    const t0 = Date.now() - 1;
    agent.evaluateTriggersAgainstLine('[Wed Oct 14 20:15:01 2026] a gnoll yelps.', Date.now(), 'Brackwyn');
    const f = agent._waitForFires(t0, 0);
    return f.then((fires) => {
      const mine = fires.find(x => x.trigger === 'snd-1');
      expect(mine).toMatchObject({ sound: 'bell', sound_volume: 0.4, sound_mode: 'replace', mute: true, sound_only: false });
    });
  });

  it('a URL sound on a guild trigger keeps playing as it always did', async () => {
    agent._setPersonalTriggersForTest([agent._compilePersonalTrigger({ id: 'snd-url', name: 'snd-url', pattern: 'a gnoll sneezes', enabled: true,
      actions: [{ type: 'text_overlay', text: 'ACHOO', sound: 'https://wolfpack.quest/sounds/vexthal.mp3' }] })]);
    const t0 = Date.now() - 1;
    agent.evaluateTriggersAgainstLine('[Wed Oct 14 20:15:02 2026] a gnoll sneezes.', Date.now(), 'Brackwyn');
    const mine = (await agent._waitForFires(t0, 0)).find(x => x.trigger === 'snd-url');
    expect(mine.sound).toBe('https://wolfpack.quest/sounds/vexthal.mp3');
    expect(mine.sound_mode).toBe('add');
    expect(mine.mute).toBe(false);
  });

  it('a standalone sound action plays (it was a no-op before) and flashes and says nothing', async () => {
    agent._setPersonalTriggersForTest([agent._compilePersonalTrigger({ id: 'snd-only', name: 'snd-only', pattern: 'a gnoll coughs', enabled: true,
      actions: [{ type: 'sound', sound: 'pop', sound_volume: 0.6 }] })]);
    const t0 = Date.now() - 1;
    agent.evaluateTriggersAgainstLine('[Wed Oct 14 20:15:03 2026] a gnoll coughs.', Date.now(), 'Brackwyn');
    const mine = (await agent._waitForFires(t0, 0)).find(x => x.trigger === 'snd-only');
    expect(mine).toMatchObject({ sound: 'pop', sound_volume: 0.6, sound_only: true, mute: true });
  });
});

describe('this PC\'s own sound on a guild trigger it cannot edit', () => {
  it('is saved beside the other state, cleaned, and applied to a fire of that trigger — relayed or not', async () => {
    const out = agent._setSoundOverride({ id: 'guild-uuid-1', sound: 'Gong', sound_volume: 0.5, sound_mode: 'replace' });
    expect(out).toMatchObject({ ok: true, override: { sound: 'gong', sound_volume: 0.5, sound_mode: 'replace' } });
    const saved = JSON.parse(fs.readFileSync(path.join(stateDir, 'trigger_sound_overrides.json'), 'utf8'));
    expect(saved.overrides['guild-uuid-1'].sound).toBe('gong');

    const t0 = Date.now() - 1;
    // a relayed guild fire: no log line of ours, just the overlay with the guild trigger's id
    agent._pushOverlay({ text: 'RUN', tts: 'run', trigger: 'Some guild trigger', trigger_id: 'guild-uuid-1', scope: 'guild_relay', firedAt: Date.now(), shownAt: Date.now() });
    // and one of a trigger with no override stays as the guild made it
    agent._pushOverlay({ text: 'STAY', tts: 'stay', trigger: 'Another', trigger_id: 'guild-uuid-2', scope: 'guild', firedAt: Date.now(), shownAt: Date.now() });
    const fires = await agent._waitForFires(t0, 0);
    expect(fires.find(f => f.trigger === 'Some guild trigger')).toMatchObject({ sound: 'gong', sound_volume: 0.5, sound_mode: 'replace', mute: true });
    expect(fires.find(f => f.trigger === 'Another')).toMatchObject({ sound: null, mute: false });

    // reload from disk, then an empty sound clears it
    for (const k of Object.keys(agent._soundOverrides)) delete agent._soundOverrides[k];
    agent.loadSoundOverrides();
    expect(agent._soundOverrides['guild-uuid-1'].sound).toBe('gong');
    expect(agent._setSoundOverride({ id: 'guild-uuid-1', sound: '' }).override).toBeNull();
    expect(agent._soundOverrides['guild-uuid-1']).toBeUndefined();
  });

  it('refuses a bad id or a path for a sound', () => {
    expect(agent._setSoundOverride({ id: '../x', sound: 'slap' }).ok).toBe(false);
    agent._setSoundOverride({ id: 'g-path', sound: 'C:\\evil.wav' });
    expect(agent._soundOverrides['g-path']).toBeUndefined();
  });
});

describe('after_my_melee_ms — the Willsapper proc, told from the shaman slows that print the same words', () => {
  const tpl = () => agent.SUGGESTED_TRIGGERS.find(t => t.id === 'proc_willsapper');
  const row = () => agent._compilePersonalTrigger(agent._templateToPersonalRow(tpl()));
  const fires = (n) => agent._fireLog.filter(f => f.name === n).length;
  const T = Date.UTC(2026, 9, 14, 20, 15, 0);
  const hit = (s, mob) => `[Wed Oct 14 20:15:${String(s).padStart(2, '0')} 2026] You slash ${mob} for 52 points of damage.`;
  const yawn = (s, mob) => `[Wed Oct 14 20:15:${String(s).padStart(2, '0')} 2026] ${mob} yawns.`;

  beforeEach(() => {
    agent._setWatchedLogsForTest([{ character: 'Brackwyn', logPath: 'x' }, { character: 'Corvale', logPath: 'y' }]);
    agent._ownMeleeAt.clear();
    agent._setPersonalTriggersForTest([row()]);
  });

  it('the suggested trigger: anchored pattern, slap, replace, 1.5 s, and no spoken text', () => {
    const r = agent._templateToPersonalRow(tpl());
    expect(r.pattern).toBe('^\\[.+?\\]\\s+(?<target>.+?) yawns\\.$');
    expect(r.after_my_melee_ms).toBe(1500);
    expect(r.actions[0]).toMatchObject({ type: 'text_overlay', sound: 'slap', sound_mode: 'replace' });
    expect(r.actions[0].tts).toBeUndefined();
    expect(agent.PERSONAL_CARRY_FIELDS).toContain('after_my_melee_ms');
    expect(agent._soundResolve('slap')).toBeTruthy();
  });

  it('your own hit on the mob, then its yawn, fires', () => {
    const n0 = fires(tpl().label);
    agent.evaluateTriggersAgainstLine(hit(0, 'a gnoll warlord'), T, 'Brackwyn');
    agent.evaluateTriggersAgainstLine(yawn(0, 'A gnoll warlord'), T, 'Brackwyn');   // sentence case, same mob
    expect(fires(tpl().label)).toBe(n0 + 1);
  });

  it('a shaman\'s slow with no hit of yours on that mob does not', () => {
    const n0 = fires(tpl().label);
    agent.evaluateTriggersAgainstLine(yawn(5, 'A gnoll warlord'), T + 5000, 'Brackwyn');
    expect(fires(tpl().label)).toBe(n0);
  });

  it('a hit on a different mob, or too long ago, or by another character, does not count', () => {
    const n0 = fires(tpl().label);
    agent.evaluateTriggersAgainstLine(hit(0, 'a gnoll scout'), T, 'Brackwyn');
    agent.evaluateTriggersAgainstLine(yawn(0, 'A gnoll warlord'), T, 'Brackwyn');          // other mob
    agent.evaluateTriggersAgainstLine(hit(0, 'a gnoll warlord'), T, 'Brackwyn');
    agent.evaluateTriggersAgainstLine(yawn(4, 'A gnoll warlord'), T + 4000, 'Brackwyn');   // four seconds on
    agent.evaluateTriggersAgainstLine(yawn(4, 'A gnoll warlord'), T + 4000, 'Corvale');    // Corvale never hit it
    expect(fires(tpl().label)).toBe(n0);
  });

  it('one second on still counts (EQ stamps whole seconds); the same hit does not outlive the window', () => {
    const n0 = fires(tpl().label);
    agent.evaluateTriggersAgainstLine(hit(10, 'a gnoll warlord'), T + 10_000, 'Brackwyn');
    agent.evaluateTriggersAgainstLine(yawn(11, 'A gnoll warlord'), T + 11_000, 'Brackwyn');
    expect(fires(tpl().label)).toBe(n0 + 1);
    agent.evaluateTriggersAgainstLine(yawn(13, 'A gnoll warlord'), T + 13_000, 'Brackwyn');
    expect(fires(tpl().label)).toBe(n0 + 1);
  });

  it('only a melee hit is noted: a spell, a miss and a damage shield are not', () => {
    const n0 = fires(tpl().label);
    agent.evaluateTriggersAgainstLine('[Wed Oct 14 20:15:00 2026] You hit a gnoll warlord for 300 points of non-melee damage.', T, 'Brackwyn');
    agent.evaluateTriggersAgainstLine('[Wed Oct 14 20:15:00 2026] You try to slash a gnoll warlord, but miss!', T, 'Brackwyn');
    agent.evaluateTriggersAgainstLine('[Wed Oct 14 20:15:00 2026] a gnoll warlord is pierced by YOUR thorns for 5 points of non-melee damage.', T, 'Brackwyn');
    agent.evaluateTriggersAgainstLine(yawn(0, 'A gnoll warlord'), T, 'Brackwyn');
    expect(fires(tpl().label)).toBe(n0);
    agent.evaluateTriggersAgainstLine('[Wed Oct 14 20:15:01 2026] You frenzy on a gnoll warlord for 80 points of damage.', T + 1000, 'Brackwyn');
    agent.evaluateTriggersAgainstLine(yawn(1, 'A gnoll warlord'), T + 1000, 'Brackwyn');
    expect(fires(tpl().label)).toBe(n0 + 1);
  });

  it('a trigger without the field is untouched', () => {
    const plain = agent._compilePersonalTrigger({ id: 'plain-yawn', name: 'plain-yawn', pattern: '(?<target>.+?) yawns\\.', enabled: true, actions: [{ type: 'text_overlay', text: 'Y' }] });
    agent._setPersonalTriggersForTest([plain]);
    agent.evaluateTriggersAgainstLine(yawn(0, 'A gnoll warlord'), T, 'Brackwyn');
    expect(fires('plain-yawn')).toBeGreaterThan(0);
  });

  it('a window with no capture takes any hit of yours in it', () => {
    expect(agent._afterMyMeleeOk({ after_my_melee_ms: 1500 }, {}, T, 'brackwyn')).toBe(false);
    agent._noteOwnMelee(hit(0, 'a gnoll warlord'), T, 'brackwyn');
    expect(agent._afterMyMeleeOk({ after_my_melee_ms: 1500 }, {}, T + 500, 'brackwyn')).toBe(true);
    expect(agent._afterMyMeleeOk({ after_my_melee_ms: 1500 }, {}, T + 9000, 'brackwyn')).toBe(false);
    expect(agent._afterMyMeleeOk({}, {}, T, 'brackwyn')).toBe(true);   // no field = no gate
  });
});

describe('GINA / EQLogParser import brings a trigger\'s sound along', () => {
  const GINA = (inner) => `<SharedTriggers><Triggers><Trigger><Name>T</Name><TriggerText>x</TriggerText>${inner}</Trigger></Triggers></SharedTriggers>`;
  beforeEach(cleanUser);

  it('reads a file name from the tags a GINA pack carries; a bare True/False switch is no file, but is remembered', () => {
    const [a] = agent._parseTriggerXml(GINA('<PlayMediaFile>True</PlayMediaFile><MediaFileName>C:\\Sounds\\ding.wav</MediaFileName>'));
    expect(a).toMatchObject({ sound_file: 'C:\\Sounds\\ding.wav', plays_sound: true });
    const [b] = agent._parseTriggerXml(GINA('<PlayMediaFile>True</PlayMediaFile>'));
    expect(b.sound_file).toBeUndefined();
    expect(b.plays_sound).toBe(true);
    const [c] = agent._parseTriggerXml(GINA('<PlayMediaFile>False</PlayMediaFile>'));
    expect(c.plays_sound).toBeUndefined();
    const [d] = agent._parseTriggerXml(GINA('<SoundFileName>chime.mp3</SoundFileName>'));
    expect(d.sound_file).toBe('chime.mp3');
  });

  it('reads EQLogParser\'s SoundToPlay', () => {
    const tgf = JSON.stringify([{ Name: 'folder', Nodes: [{ Name: 'Mez', TriggerData: { Pattern: 'x', SoundToPlay: 'C:\\EQLP\\beep.wav' } }] }]);
    expect(agent._parseTriggerTgfJson(tgf)[0]).toMatchObject({ sound_file: 'C:\\EQLP\\beep.wav', plays_sound: true });
  });

  it('a file on this PC is copied into the sounds folder and named custom:<file>', () => {
    const src = path.join(tmp, 'ding dong!.wav'); fs.writeFileSync(src, Buffer.alloc(900, 3));
    const r = agent._importSoundFile(src);
    expect(r).toEqual({ ok: true, value: 'custom:ding dong_.wav', copied: true });
    expect(fs.existsSync(path.join(userDir, 'ding dong_.wav'))).toBe(true);
    expect(agent._soundResolve(r.value)).toBe(path.join(userDir, 'ding dong_.wav'));
    // the same file again is not copied twice; a different one of the same name gets its own
    expect(agent._importSoundFile(src)).toEqual({ ok: true, value: 'custom:ding dong_.wav', copied: false });
    fs.writeFileSync(src, Buffer.alloc(901, 4));
    expect(agent._importSoundFile(src)).toEqual({ ok: true, value: 'custom:ding dong_-2.wav', copied: true });
  });

  it('a missing file, a wrong kind of file or nothing at all is refused with a reason (the trigger keeps its TTS)', () => {
    expect(agent._importSoundFile(path.join(tmp, 'nowhere.wav'))).toMatchObject({ ok: false, why: 'the file is not on this PC' });
    fs.writeFileSync(path.join(tmp, 'a.exe'), 'x');
    expect(agent._importSoundFile(path.join(tmp, 'a.exe'))).toMatchObject({ ok: false });
    expect(agent._importSoundFile('')).toMatchObject({ ok: false });
    expect(agent._importSoundFile('C:\\Windows\\media\\tada.wav').ok).toBe(false);   // not on this (Linux) test box
  });

  it('the import route attaches the sound to the alert, reports the ones left behind, and counts copies', () => {
    const route = sliceBlock(stripJs(readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'))),
      "if (req.url === '/api/personal-triggers/import' && req.method === 'POST') {", "sound_notes: soundNotes.slice(0, 50) }));");
    expect(route).toContain('_importSoundFile(t.sound_file)');
    expect(route).toContain("at.sound = snd.value");
    expect(route).toContain("actions.push({ type: 'sound', sound: snd.value })");
    expect(route).toContain('soundNotes.push(');
    expect(route).toContain('sounds_copied: soundsCopied');
  });
});

describe('pronunciation', () => {
  const map =[{ name: 'Aldenmar', say: 'Ahl-den-mar' }, { name: 'Aldenmar Prime', say: 'Ahl-den-mar Prime' }, { name: 'Nyssara', say: 'Nih-sar-uh' }];

  it('replaces whole words, case-insensitively, and leaves a name inside a longer word alone', () => {
    const f = agent._applyPronunciations;
    expect(f('Aldenmar is down', map)).toBe('Ahl-den-mar is down');
    expect(f('ALDENMAR and nyssara', map)).toBe('Ahl-den-mar and Nih-sar-uh');
    expect(f("heal Aldenmar's pet", map)).toBe("heal Ahl-den-mar's pet");
    expect(f('Aldenmarx and xAldenmar', map)).toBe('Aldenmarx and xAldenmar');
    expect(f('no names here', map)).toBe('no names here');
    expect(f('', map)).toBe('');
    expect(f('Aldenmar', null)).toBe('Aldenmar');
    expect(f('Aldenmar', [])).toBe('Aldenmar');
  });

  it('takes the longest name first, and never re-replaces its own output', () => {
    const f = agent._applyPronunciations;
    expect(f('Aldenmar Prime died', map)).toBe('Ahl-den-mar Prime died');
    expect(f('Aldenmar Prime and Aldenmar', map)).toBe('Ahl-den-mar Prime and Ahl-den-mar');
    const loop = [{ name: 'Brackwyn', say: 'Brackwyn Corvale' }, { name: 'Corvale', say: 'Cor-vale' }];
    expect(f('Brackwyn', loop)).toBe('Brackwyn Corvale');   // one pass
  });

  it('accepts a Map or a plain object, and treats a name\'s regex characters as text', () => {
    const f = agent._applyPronunciations;
    expect(f('Aldenmar', new Map([['aldenmar', 'Ahl']]))).toBe('Ahl');
    expect(f('Aldenmar', { aldenmar: 'Ahl' })).toBe('Ahl');
    expect(f('Ak`Anon (x) now', [{ name: 'Ak`Anon (x)', say: 'Ack-uh-non' }])).toBe('Ack-uh-non now');
    expect(f('anything', [{ name: '.*', say: 'boom' }])).toBe('anything');
  });

  it('every spoken string passes through it — and a sound-only or muted fire is left alone', async () => {
    agent._setPronunciationsForTest([{ name: 'Aldenmar', say: 'Ahl-den-mar' }], { Corvale: 'Cor-vale', aldenmar: 'AL-den-mar' });
    const t0 = Date.now() - 1;
    agent._pushOverlay({ text: 'RIP Aldenmar', trigger: 'rip', firedAt: Date.now(), shownAt: Date.now() });
    agent._pushOverlay({ text: 'Corvale pull', tts: 'Corvale is pulling', trigger: 'pull', firedAt: Date.now(), shownAt: Date.now() });
    const fires = await agent._waitForFires(t0, 0);
    expect(fires.find(f => f.trigger === 'rip').tts).toBe('RIP AL-den-mar');   // this PC's own entry wins over the synced one
    expect(fires.find(f => f.trigger === 'pull').tts).toBe('Cor-vale is pulling');
    expect(fires.find(f => f.trigger === 'pull').text).toBe('Corvale pull');     // what is SHOWN is untouched
    agent._setPronunciationsForTest([], {});
  });

  describe('the synced list', () => {
    const realFetch = globalThis.fetch;
    let calls;
    const stub = (resp) => { globalThis.fetch = async (url, init) => { calls.push({ url: String(url), headers: (init && init.headers) || {} }); return resp(); }; };
    beforeEach(() => { calls = []; agent._setPronunciationsForTest([], {}); for (const f of fs.readdirSync(stateDir)) fs.rmSync(path.join(stateDir, f), { force: true }); });
    afterAll(() => { globalThis.fetch = realFetch; });
    const opts = { botUrl: 'https://bot.example/api/agent/encounter', token: 'tok' };

    it('fetches with If-None-Match once it has an ETag, applies the entries and caches them', async () => {
      stub(() => ({ status: 200, ok: true, headers: { get: (h) => (h.toLowerCase() === 'etag' ? '"v1"' : null) }, json: async () => ({ version: 1, entries: [{ name: 'Aldenmar', say: 'Ahl-den-mar' }] }) }));
      expect(await agent.pollPronunciations(opts)).toBe('updated');
      expect(calls[0].url).toBe('https://bot.example/api/agent/pronunciations');
      expect(calls[0].headers['If-None-Match']).toBeUndefined();
      expect(agent._applySpokenPronunciations('Aldenmar')).toBe('Ahl-den-mar');
      expect(JSON.parse(fs.readFileSync(path.join(stateDir, 'pronunciations_cache.json'), 'utf8')).entries).toHaveLength(1);
      stub(() => ({ status: 304, ok: false, headers: { get: () => null }, json: async () => null }));
      expect(await agent.pollPronunciations(opts)).toBe('unchanged');
      expect(calls[1].headers['If-None-Match']).toBe('"v1"');
      expect(agent._applySpokenPronunciations('Aldenmar')).toBe('Ahl-den-mar');   // a 304 keeps the list
      expect(agent._pronStatePayload().feature).toBe('on');
    });

    it('a 404 is "an older server": the feature is off, quietly', async () => {
      stub(() => ({ status: 404, ok: false, headers: { get: () => null }, json: async () => ({}) }));
      expect(await agent.pollPronunciations(opts)).toBe('off');
      expect(agent._pronStatePayload().feature).toBe('off');
      expect(agent._applySpokenPronunciations('Aldenmar')).toBe('Aldenmar');
    });

    it('local mode (no token) makes no request', async () => {
      stub(() => { throw new Error('should not be called'); });
      expect(await agent.pollPronunciations({ botUrl: opts.botUrl, token: '' })).toBe('local');
      expect(calls).toHaveLength(0);
    });

    it('a network failure changes nothing', async () => {
      agent._setPronunciationsForTest([{ name: 'Aldenmar', say: 'Ahl-den-mar' }], {});
      stub(() => { throw new Error('offline'); });
      expect(await agent.pollPronunciations(opts)).toBe('error');
      expect(agent._applySpokenPronunciations('Aldenmar')).toBe('Ahl-den-mar');
    });
  });
});

describe('voice packs (shipped)', () => {
  const VOICES = [{ name: 'Microsoft Zira Desktop - English (United States)' }, { name: 'Microsoft David Desktop - English (United States)' }];
  let PACKS;
  beforeAll(() => { PACKS = agent.VOICE_PACKS; });

  it('four presets, Default being what every callout used before', () => {
    expect(PACKS.map(p => p.id)).toEqual(['default', 'herald', 'quick', 'narrator']);
    expect(PACKS[0]).toMatchObject({ rate: 1.05, pitch: 1, voices: [] });
    expect(PACKS.find(p => p.id === 'herald').rate).toBeLessThan(1);
    expect(PACKS.find(p => p.id === 'herald').pitch).toBeLessThan(1);
    expect(PACKS.find(p => p.id === 'quick').rate).toBeGreaterThan(1.2);
  });

  it('picks the first installed voice that matches the pack, and the pack\'s speed and pitch', () => {
    const p = WPVoice.pick(PACKS, { pack: 'herald' }, null, VOICES);
    expect(p.voice.name).toContain('David');
    expect(p).toMatchObject({ rate: 0.9, pitch: 0.75, pack: 'herald' });
    expect(WPVoice.pick(PACKS, { pack: 'quick' }, null, VOICES).voice.name).toContain('Zira');
  });

  it('a pack whose voices are not installed falls back to the default voice but keeps its speed and pitch', () => {
    const p = WPVoice.pick(PACKS, { pack: 'herald' }, null, [{ name: 'Some Other Voice' }]);
    expect(p.voice).toBeNull();
    expect(p).toMatchObject({ rate: 0.9, pitch: 0.75 });
    expect(WPVoice.pick(PACKS, { pack: 'herald' }, null, [])).toMatchObject({ voice: null, rate: 0.9 });
  });

  it('nothing set = the old fixed voice; an unknown pack falls back too', () => {
    expect(WPVoice.pick(PACKS, null, null, VOICES)).toMatchObject({ voice: null, rate: 1.05, pitch: 1 });
    expect(WPVoice.pick([], { pack: 'herald' }, null, VOICES)).toMatchObject({ voice: null, rate: 1.05, pitch: 1 });
    expect(WPVoice.pick(PACKS, { pack: 'nope' }, null, VOICES)).toMatchObject({ rate: 1.05, pitch: 1 });
  });

  it('hand settings win over the pack: a named voice, a speed, a pitch; junk is ignored', () => {
    const cfg = { pack: 'herald', voiceName: 'Microsoft Zira Desktop - English (United States)', rate: 1.4, pitch: 1.2 };
    expect(WPVoice.pick(PACKS, cfg, null, VOICES)).toMatchObject({ rate: 1.4, pitch: 1.2 });
    expect(WPVoice.pick(PACKS, cfg, null, VOICES).voice.name).toContain('Zira');
    expect(WPVoice.pick(PACKS, { pack: 'herald', rate: 99, pitch: 'x' }, null, VOICES)).toMatchObject({ rate: 0.9, pitch: 0.75 });
    // a named voice that was uninstalled falls through to the pack's own
    expect(WPVoice.pick(PACKS, { pack: 'herald', voiceName: 'Gone Voice' }, null, VOICES).voice.name).toContain('David');
  });

  it('a callout\'s own pack outranks the player\'s choice, hand settings included', () => {
    const cfg = { pack: 'quick', voiceName: 'Microsoft Zira Desktop - English (United States)', rate: 1.9, pitch: 1.5 };
    const p = WPVoice.pick(PACKS, cfg, 'herald', VOICES);
    expect(p).toMatchObject({ rate: 0.9, pitch: 0.75, pack: 'herald' });
    expect(p.voice.name).toContain('David');
  });
});

describe('triggers.html — what a fire does with a sound', () => {
  const html = readSource(path.join(ROOT, 'apps', 'mimic', 'triggers.html'));
  const cut = (start) => { const i = html.indexOf(start); const j = html.indexOf('\n  }', i); return html.slice(i, j + 4); };
  function harness(playResult) {
    return new Function('playResult', `
      const calls = []; var PART = null, _visualElsewhere = false;
      function flash(){ calls.push('flash'); } function speak(t, m){ calls.push('speak:' + t + (m && m.voice_pack ? '@' + m.voice_pack : '')); }
      function playSound(u, v){ calls.push('sound:' + u + (v != null ? '@' + v : '')); return playResult === undefined ? undefined : Promise.resolve(playResult); }
      function showFeedback(){} function offerMute(){} function offerVoice(){} function pinSticky(){}
      function _speakable(s){ return s; }
      ${cut('  let alertsEnabled = true;')}
      ${cut('  function fire(t){')}
      return { calls, applyTtsStatus, fire };
    `)(playResult);
  }
  const on = (h) => h.applyTtsStatus({ enableTriggerTts: true });

  it('"add" (and the old plain url) speaks and plays, as before', () => {
    const h = harness(true); on(h);
    h.fire({ text: 'Run', tts: 'run', sound: 'bell', sound_volume: 0.4 });
    expect(h.calls).toEqual(['flash', 'speak:run', 'sound:bell@0.4']);
  });

  it('"replace" plays the sound and does not speak', async () => {
    const h = harness(true); on(h);
    h.fire({ text: 'Run', tts: 'run', sound: 'slap', sound_mode: 'replace' });
    await Promise.resolve(); await Promise.resolve();
    expect(h.calls).toEqual(['flash', 'sound:slap']);
  });

  it('"replace" speaks after all when the sound could not be played, so a missing file never costs the callout', async () => {
    const h = harness(false); on(h);
    h.fire({ text: 'Run', tts: 'run', sound: 'slap', sound_mode: 'replace' });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(h.calls).toEqual(['flash', 'sound:slap', 'speak:run']);
  });

  it('a muted fire stays muted even in replace mode, and a callout\'s voice pack reaches speak', async () => {
    const h = harness(false); on(h);
    h.fire({ text: 'Run', tts: 'run', sound: 'slap', sound_mode: 'replace', mute: true });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(h.calls).toEqual(['flash', 'sound:slap']);
    const g = harness(true); on(g);
    g.fire({ text: 'Run', tts: 'run', voice_pack: 'herald' });
    expect(g.calls).toContain('speak:run@herald');
  });

  it('a standalone sound plays and does nothing else; alerts off still silences it', () => {
    const h = harness(true); on(h);
    h.fire({ text: 'x', sound: 'pop', sound_volume: 0.6, sound_only: true });
    expect(h.calls).toEqual(['sound:pop@0.6']);
    const off = harness(true); off.applyTtsStatus({ enableTriggerTts: false });
    off.fire({ text: 'x', sound: 'pop', sound_only: true });
    expect(off.calls).toEqual([]);
  });

  it('the player resolves a name through Mimic, plays a URL as it is, and honours volume and Mute', () => {
    const code = stripJs(html);
    expect(code).toContain('window.mimic.resolveSound(name)');
    expect(code).toMatch(/if \(\/\^https\?:\\\/\\\/\/i\.test\(name\)\) return Promise\.resolve\(name\);/);
    expect(code).toMatch(/a\.volume = \(volume != null && isFinite\(v\) && v >= 0 && v <= 1\) \? v : 0\.9;/);
    expect(code).toMatch(/function playSound\(url, volume\)\{\s*if\(!url \|\| _wpMutedNow\(\)\) return;\s*if \(PART\) return;/);
    expect(code).toContain('window.WPVoice.pick(');
  });
});

describe('the dashboard — the trigger form, the guild row, the cards', () => {
  const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
  const { wpTrigApplyForm } = evalBlock(sliceBlock(dash, 'function wpTrigApplyForm(base, f) {', '\n}\n'), ['wpTrigApplyForm']);
  const base = { id: 'p1', name: 'N', pattern: 'x', actions: [{ type: 'text_overlay', text: 'T', color: 'red', duration_ms: 5000 }] };
  const form = (extra) => Object.assign({ name: 'N', pattern: 'x', cooldown: 0, overlay: 'T', tts: '', color: 'red', duration: 5000, timerSec: 0, endEarly: '', zeal: null,
    warnSec: 0, warnText: '', warnTts: true, loop: false, loopMax: 0 }, extra);

  it('the editor saves the sound, "instead of speaking" and a voice pack on the trigger', () => {
    const r = wpTrigApplyForm(base, form({ sound: 'slap', soundVolume: 0.5, soundReplace: true, voicePack: 'herald' }));
    expect(r.actions[0]).toMatchObject({ sound: 'slap', sound_mode: 'replace', sound_volume: 0.5 });
    expect(r.voice_pack).toBe('herald');
  });

  it('writes only what differs from the default: mode add is absent, volume 0.9 is absent', () => {
    const r = wpTrigApplyForm(base, form({ sound: 'bell', soundVolume: 0.9, soundReplace: false, voicePack: '' }));
    expect(r.actions[0].sound).toBe('bell');
    expect(r.actions[0].sound_mode).toBeUndefined();
    expect(r.actions[0].sound_volume).toBeUndefined();
    expect(r.voice_pack).toBeUndefined();
  });

  it('"none" clears a sound; a caller with no sound box leaves a saved one (an imported URL) alone', () => {
    const had = wpTrigApplyForm(base, form({ sound: 'slap', soundReplace: true, soundVolume: 0.3 }));
    const cleared = wpTrigApplyForm(had, form({ sound: '' }));
    expect(cleared.actions[0].sound).toBeUndefined();
    expect(cleared.actions[0].sound_mode).toBeUndefined();
    expect(cleared.actions[0].sound_volume).toBeUndefined();
    const url = { ...base, actions: [{ ...base.actions[0], sound: 'https://wolfpack.quest/s.mp3' }] };
    expect(wpTrigApplyForm(url, form({})).actions[0].sound).toBe('https://wolfpack.quest/s.mp3');
  });

  it('the form has the sound row, the Sounds and Voice cards exist, and the guild row carries "My sound"', () => {
    const f = sliceBlock(dash, 'function buildEditorHtml() {', "+ '</div>';\n  }");
    for (const id of ['trigNewSound', 'trigSoundPlay', 'trigNewSoundVol', 'trigNewSoundReplace', 'trigNewVoicePack']) expect(f, id).toContain('id="' + id + '"');
    const code = stripJs(dash);
    expect(code).toContain('<div id="wpSounds" class="card wide"></div>');
    expect(code).toContain('<div id="wpVoice" class="card wide"></div>');
    expect(code).toContain('/api/sounds/open-folder');
    expect(code).toContain('/api/pronunciation-suggest?name=');
    expect(sliceBlock(code, 'function renderGuildTriggersCard(s) {', '\n}\n')).toContain('wpSoundOverrideHtml(t, _ov)');
  });
});

describe('the setup walkthrough — Your voice, Say your name', () => {
  const page = readSource(path.join(ROOT, 'apps', 'mimic', 'welcome.html'));
  const script = page.slice(page.indexOf('<script>'), page.lastIndexOf('</script>'));
  const block = sliceBlock(script, 'function agentGet(p) {', '\n  function bDone(el) {').replace(/\n  function bDone\(el\) \{$/, '');

  function build(over = {}) {
    const calls = { cfg: [], post: [], samples: [], fetched: [] };
    const S = Object.assign({ cfg: {}, port: 7779, agentReady: true, signedIn: true, eqConfigured: true, visited: new Set(), excluded: new Set(['hiddenone']),
      chars: [{ character: 'Aldenmar' }, { character: 'Hiddenone' }, { character: 'Brackwyn' }] }, over.S || {});
    const fetchStub = (url) => {
      calls.fetched.push(url);
      const body = url.includes('/api/voice-packs') ? { packs: agent.VOICE_PACKS }
        : url.includes('/api/pronunciations') ? { feature: 'on', characters: [{ name: 'Aldenmar', say: 'Ahl-den-mar', source: 'synced' }, { name: 'Brackwyn', say: '', source: '' }] }
        : { name: 'x', suggestions: ['Brack-win', { say: 'Brak-win' }], tips: ['Stress the first syllable.'], current: '', available: true };
      return Promise.resolve({ ok: true, json: async () => body });
    };
    const M = { saveConfig: (c) => { calls.cfg.push(c); return Promise.resolve(true); },
      agentPost: (route, b) => { calls.post.push([route, b]); return Promise.resolve(over.postResult || { ok: true, status: 200, body: { ok: true } }); } };
    const el = { html: '', set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html; }, querySelectorAll: () => [] };
    const api = new Function('S', 'M', 'fetch', 'window', 'calls', `
      function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
      function $() { return { addEventListener() {} }; }
      function turnsOn(items) { return '<turns>' + items.join('|') + '</turns>'; }
      var changedCount = 0; function changed() { changedCount++; }
      ${block}
      return { bVoice, bNames, savePron, nameChars, sampleSay, S, changed: () => changedCount };
    `)(S, M, fetchStub, { WPVoice: { sample: (...a) => calls.samples.push(a) } }, calls);
    return { api, el, calls, S };
  }
  const settle = () => new Promise(r => setTimeout(r, 5));

  it('Your voice lists the four packs once the engine answers, with the saved one checked', async () => {
    const { api, el, S } = build({ S: { cfg: { voice: { pack: 'herald' } } } });
    api.bVoice(el);
    expect(el.html).toContain('Loading the voice packs');
    await settle();
    api.bVoice(el);
    for (const p of agent.VOICE_PACKS) expect(el.html).toContain('value="' + p.id + '"');
    expect(el.html).toMatch(/value="herald" checked/);
    expect(el.html).not.toMatch(/value="default" checked/);
    expect(el.html).toContain('data-sample="quick"');
    expect(S.voicePacks).toHaveLength(4);
  });

  it('with the engine still starting it says so and asks for nothing', () => {
    const { api, el, calls } = build({ S: { agentReady: false } });
    api.bVoice(el);
    expect(el.html).toContain('Waiting for the engine');
    expect(calls.fetched).toEqual([]);
  });

  it('Say your name lists the characters that are not hidden, loads suggestions and tips, and shows what is saved', async () => {
    const { api, el, S } = build();
    expect(api.nameChars()).toEqual(['Aldenmar', 'Brackwyn']);
    api.bNames(el);
    await settle(); await settle();
    api.bNames(el);
    expect(el.html).toContain('Aldenmar');
    expect(el.html).not.toContain('Hiddenone');
    expect(el.html).toContain('said as “Ahl-den-mar”');
    expect(el.html).toContain('Brack-win');          // a plain suggestion
    expect(el.html).toContain('Brak-win');           // one given as {say}
    expect(el.html).toContain('Stress the first syllable.');
    expect(el.html).toContain('data-keep-typing');   // the text box that holds a redraw off
    expect(S.pronFeature).toBe('on');
  });

  it('Save for the guild posts {character, say} through main; This PC only posts the local route', async () => {
    const { api, calls, S } = build();
    api.bNames({ set innerHTML(v) { void v; }, querySelectorAll: () => [] });
    await settle();
    api.savePron('Brackwyn', 'Brack-win', true);
    await settle();
    api.savePron('Brackwyn', 'Brack-win', false);
    await settle();
    expect(calls.post).toEqual([['/api/pronunciation', { character: 'Brackwyn', say: 'Brack-win' }], ['/api/pronunciations/local', { name: 'Brackwyn', say: 'Brack-win' }]]);
    expect(S.pron.brackwyn.say).toBe('Brack-win');
    expect(S.pron.brackwyn.note).toBe('Saved on this PC.');
    expect(S.visited.has('names')).toBe(true);
  });

  it('a refused guild save keeps what was typed and points to This PC only; an empty box saves nothing', async () => {
    const { api, calls, S } = build({ postResult: { ok: false, status: 403, body: { ok: false, error: 'Only the character\'s owner can set it.' } } });
    api.savePron('Brackwyn', 'Brack-win', true);
    await settle();
    expect(S.pron.brackwyn.note).toContain('Only the character\'s owner can set it.');
    expect(S.pron.brackwyn.note).toContain('keep it on this PC only');
    expect(S.pron.brackwyn.say).toBeUndefined();
    calls.post.length = 0;
    api.savePron('Brackwyn', '', true);
    expect(calls.post).toEqual([]);
    expect(S.pron.brackwyn.note).toContain('Type how it should sound first');
  });

  it('a redraw waits while the name box has the focus, and the engine route is the only one main will post to', () => {
    const code = stripJs(page);
    expect(code).toMatch(/if \(ae && ae\.hasAttribute && ae\.hasAttribute\('data-keep-typing'\)\) \{ _renderHeld = true; return; \}/);
    const main = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));
    expect(main).toContain("new Set(['/api/pronunciation', '/api/pronunciations/local'])");
    expect(stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js')))).toContain("ipcRenderer.invoke('agent-post', route, body)");
    // both steps are optional and sit right after the characters
    const ids = [...code.matchAll(/\{ id: '([a-z]+)',\s+icon/g)].map(m => m[1]);
    expect(ids.indexOf('voice')).toBe(ids.indexOf('chars') + 1);
    expect(ids.indexOf('names')).toBe(ids.indexOf('chars') + 2);
    expect(code).not.toMatch(/id: 'voice',[^}]*kind:/);
  });
});

describe('Mimic Settings — Voice and sounds', () => {
  const settings = readSource(path.join(ROOT, 'apps', 'mimic', 'settings.html'));
  const main = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));
  it('has the pack list, voice, speed, pitch, a sample, and the sounds folder, none of it waiting on Save', () => {
    for (const id of ['voicePacks', 'voiceName', 'voiceRate', 'voicePitch', 'voiceHear', 'voiceReset', 'soundsFolder']) expect(settings).toContain('id="' + id + '"');
    expect(settings).toContain('<script src="voice.js"></script>');
    expect(stripJs(settings)).toContain('window.mimic.saveConfig({ voice: _voice })');
    expect(stripJs(settings)).toContain('window.mimic.openSoundsFolder()');
  });
  it('the voice defaults live in Mimic\'s config, and the tray reaches the sounds folder too (tray-dashboard parity)', () => {
    expect(main).toMatch(/voice: \{ pack: 'default', voiceName: '', rate: null, pitch: null \}/);
    expect(main).toContain("label: 'Open my sounds folder (add your own trigger sounds)'");
  });
});
