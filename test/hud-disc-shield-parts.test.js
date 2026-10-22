// test/hud-disc-shield-parts.test.js — how the Disc and Shield cooldowns read on the Timers canvas and the HUD.
//
// The guild lead, 2026-10-22: the Canvas listed a monk's one shared discipline timer as "Innerflame ready";
// it now arrives as "Disc" / "Disc: Innerflame" from the agent and the pieces draw the label as it is. The
// warrior's Shield is a row of its own with a 12 s "active" window over the 3-minute reuse. parts.js runs for
// real; the HUD's (me.html) cooldown helpers are checked as comment-stripped source.
//
// Run: npx vitest run test/hud-disc-shield-parts.test.js
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
let W;
beforeAll(() => {
  globalThis.window = globalThis;
  require(path.join(ROOT, 'apps', 'mimic', 'parts.js'));
  W = globalThis.WpParts;
});

const AT = 1_000_000;
const data = (cooldowns) => ({ character: 'Aldenmar', cooldowns });
const disc = (label, ms) => ({ key: 'disc', label, ms_left: ms, total_ms: 1584_000, seen: true });
const shield = (ms, on) => Object.assign({ key: 'shield', label: 'Shield', ms_left: ms, total_ms: 180_000, seen: true },
  on ? { active_ms_left: on, active_total_ms: 12_000 } : {});

describe('the cooldown list piece', () => {
  const list = (cds) => W.byId['me.cooldowns'].get(data(cds), Date.now()).items;

  it('shows the one Disc row under the name the agent sends', () => {
    const rows = list([disc('Disc: Innerflame', 600_000), shield(0)]);
    expect(rows.map(r => r.name)).toEqual(['Disc: Innerflame', 'Shield']);
    expect(rows[0]).toMatchObject({ short: 'DISC', ready: false });
    expect(list([disc('Disc', 0)])[0]).toMatchObject({ name: 'Disc', short: 'DISC', ready: true, text: 'ready' });
  });

  it('a shield being held up counts its 12 s in green, then goes back to the reuse', () => {
    const [on] = list([shield(175_000, 7_000)]);
    expect(on).toMatchObject({ name: 'Shield', short: 'SHLD', ready: false });
    expect(on.text).toMatch(/^on 0:0[5-7]$/);
    const [after] = list([shield(167_000)]);
    expect(after.text).toMatch(/^2:4[6-7]$/);
    expect(after.short).toBe('SHLD');
  });
});

describe('the one-cooldown countdown pieces', () => {
  const view = (key, cds) => W.byId['me.cd_' + key].get(data(cds), AT);

  it('there is a Shield piece beside the Disc one', () => {
    expect(W.byId['me.cd_shield']).toBeTruthy();
    expect(W.byId['me.cd_disc']).toBeTruthy();
  });

  it('Shield reads "Shield: active" for its 12 s, then the 3-minute reuse', () => {
    expect(view('shield', [shield(175_000, 7_000)])).toMatchObject({ endAt: AT + 7_000, total: 12_000, label: 'Shield: active' });
    expect(view('shield', [shield(167_000)])).toMatchObject({ endAt: AT + 167_000, total: 180_000, label: 'Shield' });
    expect(view('shield', [shield(0)])).toMatchObject({ doneText: 'ready', label: 'Shield' });
  });

  it('Disc carries the agent\'s label, so it names the discipline only while it runs', () => {
    expect(view('disc', [disc('Disc: Innerflame', 300_000)]).label).toBe('Disc: Innerflame');
    expect(view('disc', [disc('Disc', 0)]).label).toBe('Disc');
  });
});

describe('the HUD (me.html)', () => {
  const me = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'me.html')));

  it('shortens Shield to SHLD, shows the active window as "on", and does not call an active shield ready', () => {
    expect(me).toContain("'Shield': 'SHLD'");
    expect(me).toContain("c.on > 0 ? 'on ' + tfmt(c.on)");
    expect(me).toContain('!c.failed && !(c.on > 0)');
    expect(me).toMatch(/c\.active_ms_left > 0 \? Math\.max\(0, c\.active_ms_left - dt\) : 0/);
  });
});
