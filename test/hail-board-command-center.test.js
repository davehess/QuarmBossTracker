// test/hail-board-command-center.test.js — the Command Center's hail board card.
//
// The guild lead, 2026-10-05 (option A, one board the whole raid shares): a PoP boss died, its flag NPC
// stands for 20 minutes, and the Command Center lists who still has to hail it and who has. Runs the
// overlay's REAL card renderer (sliced out of apps/mimic/command.html) over the payload the agent hands
// it (state.hail). Names are invented.
//
// Run: npx vitest run test/hail-board-command-center.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';

const cmd = readSource(path.join(ROOT, 'apps', 'mimic', 'command.html'));
const block = sliceBlock(cmd, '  var HAIL_STILL_CAP = 30;', '    return h;\n  }');

function load() {
  const collapsed = {};
  const stubs = "var esc = function(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); };"
    + 'var _isCollapsed = function(k){ return !!collapsed[k]; };';
  // eslint-disable-next-line no-new-func
  const api = new Function('collapsed', stubs + block + '\nreturn { hailBoardHtml, hailClockText, _hailMore, _hailPend };')(collapsed);
  return { ...api, collapsed };
}

const names = (prefix, n) => Array.from({ length: n }, (_, i) => prefix + i);
const win = (over = {}) => ({
  id: 'w1', boss_name: 'Aerin`Dar', npc_name: 'A Planar Projection', ms_left: 17 * 60_000 + 52_000, ends_at_ms: 1_790_000_000_000,
  still: [{ name: 'Brackwyn' }, { name: 'Corvale', prior_missing: true }, { name: 'Rethlan' }, { name: 'Nyssara' }, { name: 'Zarrin' }, { name: 'Ordeth' }],
  hailed: [{ name: 'Kestrin', how: 'flag' }, { name: 'Valmora', how: 'seen' }, { name: 'Thessaly', how: 'marked', by: 'Halvard' }],
  already_flagged: names('Flagged', 12), seen_by: 9, ...over,
});
const chips = (html, cls) => (html.match(new RegExp('<span class="hail-chip ' + cls + '[^"]*"[^>]*>[\\s\\S]*?</span>(?:</span>)?', 'g')) || []);

describe('the card', () => {
  const { hailBoardHtml } = load();
  const html = hailBoardHtml([win()], 'Aldenmar');

  it('is headed Hail and the flag NPC, with the clock beside it', () => {
    expect(html).toContain('Hail · <span class="npc">A Planar Projection</span>');
    expect(html).toMatch(/<span class="hail-clock" data-end="1790000000000"><\/span>/);
  });

  it('lists who still has to hail, with the count', () => {
    expect(html).toContain('Still to hail <b>(6)</b>');
    for (const n of ['Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Ordeth']) expect(html).toMatch(new RegExp('hail-chip tap[^>]*>' + n));
  });

  it('tags a raider who is missing an earlier step, in amber, and nobody else', () => {
    const flagged = chips(html, 'tap flag');
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toContain('Corvale');
    expect(flagged[0]).toContain('⚠ needs prior step');
    expect(html.match(/needs prior step/g)).toHaveLength(1);
  });

  it('lists who has hailed, with the count, and how the bot knows', () => {
    expect(html).toContain('Hailed ✓ <b>(3)</b>');
    expect(html).toMatch(/hail-chip ok" title="Got the flag">Kestrin/);
    expect(html).toMatch(/hail-chip ok" title="Seen hailing">Valmora/);
    expect(html).toMatch(/hail-chip ok undo"[^>]*title="Marked by Halvard - tap to undo">Thessaly/);
  });

  it('says how many were flagged before the window opened, and how many Mimics are watching', () => {
    expect(html).toContain('12 already flagged');
    expect(html).toContain('seen by 9 Mimics · tap a name to mark it hailed');
  });

  it('says "Mimic" for one, and nothing when the bot did not say', () => {
    expect(hailBoardHtml([win({ seen_by: 1 })], 'x')).toContain('seen by 1 Mimic · tap');
    const none = hailBoardHtml([win({ seen_by: 0, already_flagged: [] })], 'x');
    expect(none).toContain('<div class="hail-foot">tap a name to mark it hailed</div>');
    expect(none).not.toContain('already flagged');
  });

  it('with nobody left, says so instead of an empty list', () => {
    const h = hailBoardHtml([win({ still: [] })], 'x');
    expect(h).toContain('Nobody left to hail ✓');
    expect(h).not.toContain('Still to hail');
  });

  it('a name is escaped, in the chip and in the attribute that carries it back', () => {
    const h = hailBoardHtml([win({ still: [{ name: '<b>"x"' }] })], 'x');
    expect(h).not.toContain('<b>"x"');
    expect(h).toContain('data-hail-name="&lt;b&gt;&quot;x&quot;"');
  });
});

describe('the clock', () => {
  const { hailBoardHtml, hailClockText } = load();

  it('reads minutes and seconds left, and "closed" at the end', () => {
    const end = 5_000_000;
    expect(hailClockText(end, end - (17 * 60 + 52) * 1000)).toBe('17:52 left');
    expect(hailClockText(end, end - 45_000)).toBe('0:45 left');
    expect(hailClockText(end, end - 61_000)).toBe('1:01 left');
    expect(hailClockText(end, end)).toBe('closed');
    expect(hailClockText(end, end + 3000)).toBe('closed');
  });

  it('is never in the card\'s HTML, so the board is byte-stable from one poll to the next', () => {
    const a = hailBoardHtml([win({ ms_left: 900_000 })], 'x');
    const b = hailBoardHtml([win({ ms_left: 897_000 })], 'x');
    expect(a).toBe(b);
    expect(a).not.toMatch(/\d+:\d\d left/);
  });
});

describe('the buttons', () => {
  const h = load();

  it('every name that can be tapped carries the hover handshake and what a tap does', () => {
    const html = h.hailBoardHtml([win()], 'x');
    const tappable = html.match(/<span class="hail-chip [^>]*data-hail-act="[^"]*"[^>]*>/g);
    expect(tappable).toHaveLength(7);   // six still, one hand-made mark
    for (const t of tappable) {
      expect(t).toContain(' data-wp-interact ');
      expect(t).toMatch(/data-hail-win="w1"/);
      expect(t).toMatch(/data-hail-name="[A-Za-z]+"/);
    }
    expect(html.match(/data-hail-act="mark"/g)).toHaveLength(6);
    expect(html.match(/data-hail-act="unmark"/g)).toHaveLength(1);
  });

  it('only a hand-made mark can be undone; a flag or a witnessed hail is not a button', () => {
    const html = h.hailBoardHtml([win()], 'x');
    for (const n of ['Kestrin', 'Valmora']) {
      const chip = html.match(new RegExp('<span class="hail-chip ok"[^>]*>' + n + '</span>'));
      expect(chip, n).not.toBeNull();
      expect(chip[0]).not.toContain('data-hail-act');
      expect(chip[0]).not.toContain('data-wp-interact');
    }
    expect(html).toMatch(/data-hail-act="unmark" data-hail-win="w1" data-hail-name="Thessaly"/);
  });

  it('the collapse caret and the "+N more" tail carry it too', () => {
    const html = h.hailBoardHtml([win({ hailed: names('H', 20).map((n) => ({ name: n, how: 'flag' })) })], 'x');
    expect(html).toMatch(/<span class="sec-toggle" data-wp-interact data-collapse-key="hail"/);
    expect(html).toMatch(/<span class="hail-more" data-wp-interact data-hail-more="w1\|hailed"/);
  });

  it('a tap that has been sent dims its chip until the answer is in', () => {
    const t = load();
    expect(t.hailBoardHtml([win()], 'x')).not.toContain(' pend');
    t._hailPend.add('w1|rethlan');
    const html = t.hailBoardHtml([win()], 'x');
    expect(chips(html, 'tap')).toHaveLength(6);
    expect(html).toMatch(/hail-chip tap pend"[^>]*data-hail-name="Rethlan"/);
    expect(html.match(/ pend"/g)).toHaveLength(1);
  });

  it('puts you first in the list, marked', () => {
    const html = h.hailBoardHtml([win()], 'rethlan');
    const first = html.indexOf('data-hail-name="');
    expect(html.slice(first, first + 30)).toContain('Rethlan');
    expect(html).toMatch(/hail-chip tap me"[^>]*data-hail-name="Rethlan"/);
  });
});

describe('a long list does not outgrow the window', () => {
  it('shows the first 8 who have hailed and "+N more"', () => {
    const { hailBoardHtml } = load();
    const html = hailBoardHtml([win({ hailed: names('H', 31).map((n) => ({ name: n, how: 'flag' })) })], 'x');
    expect(chips(html, 'ok')).toHaveLength(8);
    expect(html).toContain('+23 more');
    expect(html).toContain('Hailed ✓ <b>(31)</b>');
  });

  it('shows the first 30 who still have to, and opens to the whole list on a tap', () => {
    const t = load();
    const w = win({ still: names('S', 70).map((n) => ({ name: n })) });
    const closed = t.hailBoardHtml([w], 'x');
    expect(chips(closed, 'tap')).toHaveLength(30);
    expect(closed).toContain('+40 more');
    expect(closed).toContain('Still to hail <b>(70)</b>');
    t._hailMore.add('w1|still');
    const open = t.hailBoardHtml([w], 'x');
    expect(chips(open, 'tap')).toHaveLength(70);
    expect(open).toContain('fewer ▴');
    expect(open).not.toContain('+40 more');
  });

  it('draws at most three windows, the one closing first on top', () => {
    const { hailBoardHtml } = load();
    const ws = ['a', 'b', 'c', 'd'].map((id, i) => win({ id, npc_name: 'NPC ' + id, ms_left: (4 - i) * 60_000 }));
    const html = hailBoardHtml(ws, 'x');
    expect(html.match(/class="card hail-card"/g)).toHaveLength(3);
    expect(html.indexOf('NPC d')).toBeLessThan(html.indexOf('NPC c'));
    expect(html).not.toContain('NPC a');
  });
});

describe('collapsing', () => {
  it('keeps the header, the clock and the count of who is left, and drops the lists', () => {
    const t = load();
    t.collapsed.hail = true;
    const html = t.hailBoardHtml([win()], 'x');
    expect(html).toContain('▸ Hail · <span class="npc">A Planar Projection</span> (6)');
    expect(html).toContain('class="hail-clock"');
    expect(html).not.toContain('hail-chip');
    expect(html).not.toContain('hail-foot');
  });
});

describe('wired into the Command Center', () => {
  const body = stripJs(cmd);

  it('shows only while a window is open, and sits under the fight cards but above the long lists', () => {
    const at = body.indexOf('if (s.hail && s.hail.length) {');
    expect(at).toBeGreaterThan(-1);
    expect(body.slice(at, at + 600)).toContain('html += hailBoardHtml(s.hail, s.character);');
    expect(at).toBeGreaterThan(body.indexOf('if (s.rampage && s.rampage.target) {'));
    expect(at).toBeGreaterThan(body.indexOf("html += '<div class=\"card\">'\n           +    '<div class=\"head\">Main Tank"));
    expect(at).toBeLessThan(body.indexOf('if (s.da_broadcasts && s.da_broadcasts.length) {'));
    expect(at).toBeLessThan(body.indexOf('if (s.healer_mana && s.healer_mana.length) {'));
    expect(at).toBeLessThan(body.indexOf('if (s.rolls && s.rolls.length) {'));
  });

  it('a tap posts to the agent: window, name and which way', () => {
    const tap = body.slice(body.indexOf('function hailTap('), body.indexOf('function hailTap(') + 900);
    expect(tap).toContain("fetch('http://127.0.0.1:' + PORT + '/api/hail-mark'");
    expect(tap).toContain("method: 'POST'");
    expect(tap).toContain('JSON.stringify({ window_id: wid, name: name, hailed: hailed })');
    expect(tap).toContain('.then(done, done)');
  });

  it('chips act on the press (a repaint between press and release would lose a click), through one delegated handler', () => {
    const md = body.slice(body.indexOf("contentEl.addEventListener('mousedown'"), body.indexOf("contentEl.addEventListener('mousedown'") + 600);
    expect(md).toContain(".closest('.hail-chip[data-hail-act]')");
    expect(md).toContain("chip.getAttribute('data-hail-act') === 'mark'");
  });

  it('"+N more" and the hover handshake are in the delegated handlers', () => {
    expect(body).toMatch(/closest\('\.hail-more'\)/);
    const handshakes = body.match(/t\.closest\('\[data-wp-interact\]'\)/g) || [];
    expect(handshakes).toHaveLength(2);   // mouseover and mouseout
  });

  it('the clocks are painted once a second, and after every repaint', () => {
    expect(body).toContain('setInterval(paintHailClocks, 1000);');
    expect(body).toMatch(/contentEl\.__wpHtml = html;\s*\n\s*paintHailClocks\(\);/);
  });
});
