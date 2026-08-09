// #194 — Zeal /tag capture: the spawn-id side door.
//
// First cut of this feature invented a social grammar ("tag %T 87") — Uilnayar
// corrected it (2026-08-05): Zeal has a NATIVE /tag command that applies to
// your current target and broadcasts through rsay/gsay/a joined ZT* channel.
// The wire format, VERIFIED from CoastalRedwood/Zeal nameplate.cpp (cloned and
// read, not the wiki):
//
//     ZEALTAG | <tag_text> | <target_name> | <spawn_id>
//
// "ZT" is the accepted abbreviated header; the delimiter is exactly " | ";
// 'clear' clears all tags; 'ChatChannel: <name>' is autojoin plumbing.
// tag_text prefixes: +/@ append, ! replace, - erase, ^?^ shape where ? is
// R/O/Y/G/B/W (colored arrows), P (paw), S (stop sign), - (clear shape).
//
// THE PAYLOAD FIELD IS THE SPAWN ID — the one datum the Zeal pipe never
// carries. Every /tag in the channel hands us the mob's true per-zone
// identity, logged by every channel member.
//
// PRIVACY: ZT-channel lines still match the custom-channel drop pattern and
// never upload raw. rsay-borne tags are raid chat (kept) but are EXCLUDED
// from the Discord chat relay — machine traffic, not conversation. Only the
// structured extract ships.
//
// Run: npx vitest run test/tag-channel.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, sliceBlock, sliceArrayLiteral, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

function harness() {
  // The whole module: shape map through zealTagsSnapshot's closing return.
  const full = sliceBlock(src, "const _ZEAL_TAG_SHAPES = ", '\n  return out;\n}');
  const prelude = `
    function parseEqTimestamp(line) {
      return /^\\[/.test(line) ? new Date('2026-08-05T01:00:00Z') : null;
    }
  `;
  // eslint-disable-next-line no-new-func
  return new Function(prelude + full
    + '\nreturn { noteTagChannelLine, zealTagsSnapshot, _zealTags, _applyZealTagMessage,'
    + '\n  _tagLineParts, _tagPrettyPrintSeen: () => _tagPrettyPrintSeen };')();
}

const NOW = new Date('2026-08-05T01:00:05Z').getTime();
// Read the shipped TTL rather than restating it, so raising the constant can
// never leave this file asserting the old value.
const h_TAG_FRESH_MS = () => {
  const m = src.match(/const _TAG_FRESH_MS = ([\d_]+);/);
  if (!m) throw new Error('_TAG_FRESH_MS not found in agent source');
  return Number(m[1].replace(/_/g, ''));
};
const CH = (who, msg) => `[Wed Aug 05 21:10:01 2026] ${who} tells ZTwolfpacktag:5, '${msg}'`;
const RSAY = (who, msg) => `[Wed Aug 05 21:10:01 2026] ${who} tells the raid, '${msg}'`;

describe('privacy + relay hygiene', () => {
  it('ZT-channel tag lines still match the custom-channel drop pattern', () => {
    // The load-bearing assertion: capture rides BESIDE the filter, never
    // through a hole in it.
    const drops = sliceArrayLiteral(src, 'const DEFAULT_DROP_PATTERNS = [');
    const line = CH('Naggato', 'ZEALTAG | Naggato-Tanking | Thall Va Xakra | 1234');
    expect(drops.some(rx => rx instanceof RegExp && rx.test(line))).toBe(true);
  });

  it('rsay-borne tag messages are excluded from the Discord chat relay', () => {
    // parseChatLine feeds the /rs relay; a ZEALTAG line through it would spam
    // the raid channel with machine traffic on every tag.
    const fn = sliceBlock(src, 'function parseChatLine(line, selfName) {', '\n}');
    expect(fn).toMatch(/ZEALTAG \| /);
    expect(fn).toMatch(/ZT \| /);
  });

  it('the capture hook runs on the raw tail line', () => {
    expect(src).toMatch(/try \{ noteTagChannelLine\(line, b\.character\); \} catch/);
  });

  // Adding the gsay transport put GROUP chat on the capture path for the
  // first time. Group chat is privacy-critical (small group, not guild-wide),
  // so the same "capture rides beside the filter" invariant has to hold for
  // it — in BOTH directions, and against triggerVisibleLine, which is
  // default-KEEP and therefore sees anything the drop list misses.
  describe('group-say tags stay private', () => {
    const drops = sliceArrayLiteral(src, 'const DEFAULT_DROP_PATTERNS = [');
    const dropped = (line) => drops.some(rx => rx instanceof RegExp && rx.test(line));
    const TAG = "ZEALTAG | Bardy | a Darkpaw warrior | 511";

    it('incoming group say is dropped', () => {
      expect(dropped(`[Wed Aug 05 21:10:01 2026] Bardy tells the group, '${TAG}'`)).toBe(true);
    });

    it('BOTH self wordings are dropped', () => {
      expect(dropped(`[Wed Aug 05 21:10:01 2026] You say to your group, '${TAG}'`)).toBe(true);
      expect(dropped(`[Wed Aug 05 21:10:01 2026] You tell your party, '${TAG}'`),
        'the list carried only "say to your group"; Zeal enumerates "tell your party" too').toBe(true);
    });

    it('group say never reaches the Discord chat relay', () => {
      // parseChatLine gates on "guild," / "raid," before anything else, so
      // group lines can't even enter it — assert the gate, not the outcome of
      // one sample line.
      const fn = sliceBlock(src, 'function parseChatLine(line, selfName) {', '\n}');
      expect(fn).toMatch(/indexOf\('guild,'\) === -1 && line\.indexOf\('raid,'\) === -1/);
    });
  });
});

describe('noteTagChannelLine — the real wire format', () => {
  it('parses a channel tag: spawn id, name, text, tagger', () => {
    const h = harness();
    expect(h.noteTagChannelLine(CH('Naggato', 'ZEALTAG | Naggato-Tanking | Thall Va Xakra | 1234'), 'Me')).toBe(true);
    const [t] = h.zealTagsSnapshot(NOW);
    expect(t.spawn_id).toBe(1234);
    expect(t.mob).toBe('thall va xakra');
    expect(t.mobDisplay).toBe('Thall Va Xakra');
    expect(t.text).toBe('Naggato-Tanking');
    expect(t.shape).toBeNull();
    expect(t.tagger).toBe('Naggato');
  });

  it('accepts the abbreviated ZT header', () => {
    const h = harness();
    expect(h.noteTagChannelLine(CH('Naggato', 'ZT | OT2 | Thall Va Xakra | 1240'), 'Me')).toBe(true);
    expect(h.zealTagsSnapshot(NOW)[0].spawn_id).toBe(1240);
  });

  it('extracts the ^?^ shape prefix — the arrows/paw/stop-sign syntax', () => {
    const h = harness();
    h.noteTagChannelLine(CH('Naggato', 'ZEALTAG | ^G^Naggato-Tanking | Thall Va Xakra | 1234'), 'Me');
    h.noteTagChannelLine(CH('Borim', 'ZEALTAG | ^s^ | Thall Va Xakra | 1240'), 'Me');
    const byId = Object.fromEntries(h.zealTagsSnapshot(NOW).map(t => [t.spawn_id, t]));
    expect(byId[1234].shape).toBe('G');
    expect(byId[1234].text).toBe('Naggato-Tanking');
    expect(byId[1240].shape, 'case-insensitive, text optional').toBe('S');
    expect(byId[1240].text).toBe('');
  });

  it('two same-name tags with different spawn ids are two entries — the whole point', () => {
    const h = harness();
    h.noteTagChannelLine(CH('Naggato', 'ZEALTAG | Naggato-Tanking | Thall Va Xakra | 1234'), 'Me');
    h.noteTagChannelLine(CH('Borim', 'ZEALTAG | Borim-Tanking | Thall Va Xakra | 1240'), 'Me');
    expect(h.zealTagsSnapshot(NOW)).toHaveLength(2);
  });

  it("rides rsay too — same message through raid chat", () => {
    const h = harness();
    expect(h.noteTagChannelLine(RSAY('Naggato', 'ZEALTAG | Assist Me | Aten Ha Ra | 900'), 'Me')).toBe(true);
    expect(h.zealTagsSnapshot(NOW)[0].tagger).toBe('Naggato');
  });

  // ── The transports the first cut missed. Hitya's first live test (two
  // `a Darkpaw warrior`s tagged Bardy and Cano, NOT in a raid) captured
  // NOTHING — the parser knew only the ZT channel and rsay, and `/tag gsay`
  // is the natural transport when you're in a group and not a raid.
  // nameplate.cpp handle_tag_command: rsay | gsay | chat | local, where gsay
  // gates on GroupInfo->is_in_group() — it is GROUP say, not guild.
  describe('every transport Zeal can broadcast over', () => {
    const CASES = [
      ['gsay, other',        `[Wed Aug 05 21:10:01 2026] Bardy tells the group, 'ZEALTAG | Bardy | a Darkpaw warrior | 511'`, 'Bardy'],
      ['gsay, self',         `[Wed Aug 05 21:10:01 2026] You tell your party, 'ZEALTAG | Bardy | a Darkpaw warrior | 511'`, 'Uilnayar'],
      ['rsay, self',         `[Wed Aug 05 21:10:01 2026] You tell the raid, 'ZEALTAG | Bardy | a Darkpaw warrior | 511'`, 'Uilnayar'],
      ['chat channel, self', `[Wed Aug 05 21:10:01 2026] You say to Ztwolfpacktag:1, 'ZEALTAG | Bardy | a Darkpaw warrior | 511'`, 'Uilnayar'],
      ['chat channel, mixed-case name (join_tag_channel lowercases then capitalizes)',
                             `[Wed Aug 05 21:10:01 2026] Bardy tells Ztwolfpacktag:1, 'ZEALTAG | Bardy | a Darkpaw warrior | 511'`, 'Bardy'],
      // AbbreviatedChat=2 rewrites the LOG line to "[P] [Sender]: body" and
      // drops the quotes entirely (chat.cpp abbreviateChat). Zeal has already
      // substituted the real name for "You" by then.
      ['abbreviated group',  `[Wed Aug 05 21:10:01 2026] [P] [Bardy]: ZEALTAG | Bardy | a Darkpaw warrior | 511`, 'Bardy'],
      ['abbreviated raid',   `[Wed Aug 05 21:10:01 2026] [R] [Bardy]: ZEALTAG | Bardy | a Darkpaw warrior | 511`, 'Bardy'],
      ['abbreviated channel (numeric prefix)',
                             `[Wed Aug 05 21:10:01 2026] [1] [Bardy]: ZEALTAG | Bardy | a Darkpaw warrior | 511`, 'Bardy'],
    ];
    for (const [label, line, tagger] of CASES) {
      it(`captures ${label}`, () => {
        const h = harness();
        expect(h.noteTagChannelLine(line, 'Uilnayar'), label).toBe(true);
        const [t] = h.zealTagsSnapshot(NOW);
        expect(t.spawn_id).toBe(511);
        expect(t.mobDisplay).toBe('a Darkpaw warrior');
        expect(t.text).toBe('Bardy');
        expect(t.tagger, 'tagger read off whatever prefix precedes the header').toBe(tagger);
      });
    }

    it('the two same-name adds from the failing field test come back as two rows', () => {
      // Two `a Darkpaw warrior`s, tagged Bardy and Cano over GROUP say.
      const h = harness();
      h.noteTagChannelLine(`[Wed Aug 05 21:10:01 2026] You tell your party, 'ZEALTAG | Bardy | a Darkpaw warrior | 511'`, 'Uilnayar');
      h.noteTagChannelLine(`[Wed Aug 05 21:10:05 2026] You tell your party, 'ZEALTAG | Cano | a Darkpaw warrior | 512'`, 'Uilnayar');
      const byId = Object.fromEntries(h.zealTagsSnapshot(NOW).map(t => [t.spawn_id, t.text]));
      expect(byId).toEqual({ 511: 'Bardy', 512: 'Cano' });
    });

    it('_tagLineParts hands the payload over quote-free, both shapes', () => {
      // Contract of the extractor itself. parseInt happens to tolerate a
      // trailing quote today, so an end-to-end spawn-id check can NOT see
      // this — but every field is read positionally off the last delimiter,
      // and Zeal already demonstrates it appends suffixes after the payload
      // (prettyprint's " (Arrow:G)"). Assert the boundary where it is real.
      const h = harness();
      expect(h._tagLineParts(`[Wed Aug 05 21:10:01 2026] Bardy tells the group, 'ZEALTAG | Bardy | a Darkpaw warrior | 511'`, 'Me'))
        .toEqual({ payload: 'ZEALTAG | Bardy | a Darkpaw warrior | 511', tagger: 'Bardy' });
      expect(h._tagLineParts(`[Wed Aug 05 21:10:01 2026] [P] [Bardy]: ZEALTAG | Bardy | a Darkpaw warrior | 511`, 'Me'))
        .toEqual({ payload: 'ZEALTAG | Bardy | a Darkpaw warrior | 511', tagger: 'Bardy' });
      expect(h._tagLineParts(`[Wed Aug 05 21:10:01 2026] Bardy says, 'no tag here'`, 'Me')).toBeNull();
    });
  });

  it("'clear' broadcast wipes every stored tag", () => {
    const h = harness();
    h.noteTagChannelLine(CH('Naggato', 'ZEALTAG | Naggato-Tanking | Thall Va Xakra | 1234'), 'Me');
    expect(h.noteTagChannelLine(CH('Naggato', 'ZEALTAG | clear | 0 | 0'), 'Me')).toBe(true);
    expect(h.zealTagsSnapshot(NOW)).toEqual([]);
  });

  it("a bare '-' erase drops that spawn's tag; ChatChannel autojoin is ignored", () => {
    const h = harness();
    h.noteTagChannelLine(CH('Naggato', 'ZEALTAG | Naggato-Tanking | Thall Va Xakra | 1234'), 'Me');
    expect(h.noteTagChannelLine(CH('Naggato', 'ZEALTAG | - | Thall Va Xakra | 1234'), 'Me')).toBe(true);
    expect(h.zealTagsSnapshot(NOW)).toEqual([]);
    expect(h.noteTagChannelLine(CH('Naggato', 'ZEALTAG | ChatChannel: ZTwolfpacktag | 0 | 0'), 'Me')).toBe(false);
  });

  it('append/replace prefixes strip to the display text', () => {
    const h = harness();
    h.noteTagChannelLine(CH('Naggato', 'ZEALTAG | +TASH | Thall Va Xakra | 1234'), 'Me');
    expect(h.zealTagsSnapshot(NOW)[0].text).toBe('TASH');
  });

  it('a non-tag line is ignored', () => {
    const h = harness();
    expect(h.noteTagChannelLine(CH('Naggato', 'anyone got a port?'), 'Me')).toBe(false);
    expect(h.noteTagChannelLine(`[Wed Aug 05 21:10:01 2026] Naggato says, 'ZEALTAG is a cool feature'`, 'Me')).toBe(false);
    expect(h._zealTags.size).toBe(0);
  });

  it('outgoing channel form resolves the tagger to the watched character', () => {
    const h = harness();
    const line = `[Wed Aug 05 21:10:01 2026] You tell ZTwolfpacktag:5, 'ZEALTAG | MT | Aten Ha Ra | 900'`;
    expect(h.noteTagChannelLine(line, 'Uilnayar')).toBe(true);
    expect(h.zealTagsSnapshot(NOW)[0].tagger).toBe('Uilnayar');
  });

  it('a tag SURVIVES a whole boss fight', () => {
    // The bug this pins: at the old 120s TTL, the first tag that ever captured
    // successfully (six uploaders, spawn_id 360, 2026-08-06) aged out four
    // minutes in while the boss was still at 32%. Bosses run 5-10 minutes and a
    // tag is a deliberate fight-long mark, so it has to outlive the fight.
    const h = harness();
    h.noteTagChannelLine(CH('Melting', 'ZEALTAG | KILL AND SLEEP | Thall Va Xakra | 360'), 'Me');
    const [t] = h.zealTagsSnapshot(NOW + 5 * 60_000);   // 5 minutes in
    expect(t, 'still marked five minutes into the fight').toBeTruthy();
    expect(t.text).toBe('KILL AND SLEEP');
    expect(t.spawn_id).toBe(360);
  });

  it('freshness sweep still expires a tag eventually', () => {
    // Derived from the SHIPPED constant, never a hard-coded number — the old
    // test asserted 121s and silently became wrong the moment the TTL changed.
    const ttl = h_TAG_FRESH_MS();
    expect(ttl, 'must cover a long boss fight').toBeGreaterThanOrEqual(5 * 60_000);
    const h = harness();
    h.noteTagChannelLine(CH('Naggato', 'ZEALTAG | X | a wolf | 5'), 'Me');
    expect(h.zealTagsSnapshot(NOW + ttl + 1000)).toEqual([]);
    expect(h._zealTags.size, 'expired entries are swept, not just hidden').toBe(0);
  });

  it('garbage spawn ids and malformed messages are rejected', () => {
    const h = harness();
    expect(h._applyZealTagMessage('ZEALTAG | X | a wolf | notanumber', 'N', NOW)).toBe(false);
    expect(h._applyZealTagMessage('ZEALTAG | onlytwo', 'N', NOW)).toBe(false);
    expect(h._zealTags.size).toBe(0);
  });
});

describe('zeal.ini readiness (readZealTagConfig)', () => {
  // The channel persists in [Zeal] NameplateTagChannel once seen — the
  // dashboard reads it instead of assuming the user is set up.
  function run(files) {
    const block = sliceBlock(src, 'let _zealTagCfgCache = ', '\n  return rows;\n}');
    const prelude = `
      const stats = { watchedLogs: [{ file: 'A:/EQ/Logs/eqlog_Uil_pq.proj.txt' }] };
      const path = { dirname: (f) => f.slice(0, f.lastIndexOf('/')), join: (...a) => a.join('/') };
      const files = ${JSON.stringify(files)};
      const fs = { existsSync: (p) => p in files, readFileSync: (p) => files[p] };
      const Date_now = Date.now;
    `;
    // eslint-disable-next-line no-new-func
    return new Function(prelude + block + '\nreturn readZealTagConfig();')();
  }
  // Zeal writes `.\zeal.ini` relative to the EQ ROOT (io_ini.h), i.e. the
  // PARENT of the log dir — not next to the logs. 3.5.33 looked only in the
  // log dir, so on every real install the card said "no zeal.ini found yet"
  // and the readiness check could never fire.
  const INI = 'A:/EQ/zeal.ini';
  const LOGDIR_INI = 'A:/EQ/Logs/zeal.ini';

  it('reads the persisted channel + enable flag from [Zeal]', () => {
    const rows = run({ [INI]: '[Other]\nNameplateTagChannel=Nope\n[Zeal]\nNameplateTagEnable=1\nNameplateTagChannel=ZTwolfpacktag\n[Next]\nX=1\n' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dir: 'A:/EQ', channel: 'ZTwolfpacktag', enabled: true });
    expect(rows[0].warnings, 'a healthy config raises nothing').toEqual([]);
  });

  it('finds zeal.ini in the EQ ROOT, the parent of the log dir', () => {
    // The bug that made the whole readiness check inert: Zeal's
    // kZealIniFilename is ".\\zeal.ini", resolved against eqgame.exe's
    // directory, and logs live in a Logs\ subfolder.
    const rows = run({ [INI]: '[Zeal]\nNameplateTagChannel=ZTwolfpacktag\nNameplateTagEnable=1\n' });
    expect(rows, 'an ini one level up must not be invisible').toHaveLength(1);
    expect(rows[0].dir).toBe('A:/EQ');
  });

  it('still reads an ini sitting next to the logs (in-EQ-folder installs)', () => {
    const rows = run({ [LOGDIR_INI]: '[Zeal]\nNameplateTagChannel=ZTfallback\n' });
    expect(rows[0].channel).toBe('ZTfallback');
    expect(rows[0].dir).toBe('A:/EQ/Logs');
  });

  it('the EQ root wins when both exist — that is the one Zeal writes', () => {
    const rows = run({
      [INI]: '[Zeal]\nNameplateTagChannel=ZTroot\n',
      [LOGDIR_INI]: '[Zeal]\nNameplateTagChannel=ZTstale\n',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe('ZTroot');
  });

  it('a key OUTSIDE the [Zeal] section is never read — section walk, not grep', () => {
    const rows = run({ [INI]: '[Other]\nNameplateTagChannel=ZTwrong\n' });
    expect(rows[0]).toMatchObject({ dir: 'A:/EQ', channel: null, enabled: null });
  });

  it('no zeal.ini → empty, not an error', () => {
    expect(run({})).toEqual([]);
  });

  it('disabled tags surface as enabled:false so the card can nudge', () => {
    const rows = run({ [INI]: '[Zeal]\nNameplateTagChannel=ZTwolfpacktag\nNameplateTagEnable=0\n' });
    expect(rows[0].enabled).toBe(false);
  });

  // ── The settings that make capture fail SILENTLY. This is the reason the
  // readiness read exists at all: a tag that never reaches the log looks
  // exactly like nobody tagging, which is what the first live test looked
  // like. All three are LOCAL-client settings — the filter runs on my client
  // for my display — so my ini fully decides whether my log is degraded.
  const READY = '[Zeal]\nNameplateTagChannel=ZTwolfpacktag\nNameplateTagEnable=1\n';
  const warnsOf = (ini) => run({ [INI]: ini })[0].warnings.join(' ');

  it('/tag suppress on is flagged — Zeal clears the message before it is logged', () => {
    // nameplate.cpp handle_zeal_spam_filter: `msg = ""` and PrintChat skips
    // the log write on an empty buffer. Unrecoverable downstream.
    expect(warnsOf(READY + 'NameplateTagSuppress=1\n')).toMatch(/suppress off/);
    expect(warnsOf(READY + 'NameplateTagSuppress=0\n')).not.toMatch(/suppress/);
  });

  it('/tag prettyprint on is flagged ONLY when the filter that invokes it is on', () => {
    // prettyprint_tag_message rewrites to "text => target" and drops the
    // spawn id — but handle_zeal_spam_filter returns early unless
    // setting_tag_filter is on, so prettyprint alone is inert.
    expect(warnsOf(READY + 'NameplateTagFilter=1\nNameplateTagPrettyPrint=1\n')).toMatch(/prettyprint off/);
    expect(warnsOf(READY + 'NameplateTagPrettyPrint=1\n'),
      'prettyprint without filter never runs — do not send the user chasing it').not.toMatch(/prettyprint/);
    expect(warnsOf(READY + 'NameplateTagFilter=1\n'),
      'filter alone only re-colors the line; the payload survives').not.toMatch(/prettyprint/);
  });

  it('suppress outranks prettyprint — one actionable fix, not two', () => {
    const w = run({ [INI]: READY + 'NameplateTagSuppress=1\nNameplateTagFilter=1\nNameplateTagPrettyPrint=1\n' })[0].warnings;
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/suppress off/);
  });

  it('a missing channel is flagged with the one-time fix', () => {
    expect(warnsOf('[Zeal]\nNameplateTagEnable=1\n')).toMatch(/\/tag channel ZTwolfpacktag/);
  });

  it('AbbreviatedChat is read but never warned about — the parser handles both shapes', () => {
    const row = run({ [INI]: READY + 'AbbreviatedChat=2\n' })[0];
    expect(row.abbrev).toBe(2);
    expect(row.warnings).toEqual([]);
  });
});

describe('prettyprint sighting (log-side backup for an unreachable zeal.ini)', () => {
  it('recognises a rewritten tag and remembers the sample', () => {
    const h = harness();
    // What `/tag filter on` + `/tag prettyprint on` actually emits.
    expect(h.noteTagChannelLine(
      `[Wed Aug 05 21:10:01 2026] Bardy tells the group, 'Bardy => a Darkpaw warrior (Arrow:G)'`, 'Me'),
      'still returns false — there is no spawn id to store').toBe(false);
    expect(h._tagPrettyPrintSeen().sample).toBe('Bardy => a Darkpaw warrior');
  });

  it('handles the abbreviated shape and the no-shape form', () => {
    const h = harness();
    h.noteTagChannelLine(`[Wed Aug 05 21:10:01 2026] [P] [Bardy]: Cano => a Darkpaw warrior`, 'Me');
    expect(h._tagPrettyPrintSeen().sample).toBe('Cano => a Darkpaw warrior');
  });

  it('ordinary chat containing an arrow is not mistaken for a tag', () => {
    const h = harness();
    h.noteTagChannelLine(`[Wed Aug 05 21:10:01 2026] Bardy tells the group, 'pull => camp'`, 'Me');
    // Two words either side is exactly the pretty shape, so this one DOES
    // register — the sighting is a hint, not an ingest path, and the only
    // consequence is a dashboard nudge. What must NOT happen is a stored tag.
    expect(h.zealTagsSnapshot(NOW), 'a sighting never becomes a tag').toEqual([]);
  });

  it('a line with no arrow at all leaves the sighting untouched', () => {
    const h = harness();
    h.noteTagChannelLine(`[Wed Aug 05 21:10:01 2026] Bardy tells the group, 'inc adds'`, 'Me');
    expect(h._tagPrettyPrintSeen()).toBeNull();
  });
});

describe('zeal_tags upload payload', () => {
  const block = sliceBlock(src, 'zeal_tags: (() => {', '})(),');
  const build = (tags, nowMs) => {
    const body = block.slice('zeal_tags: '.length).replace(/,$/, '');
    // The payload now gates on zone (ids are per-zone and reused) and picks
    // which tags survive the upload cap. Both are exercised in
    // test/zeal-tag-agent.test.js; here they are inert so this stays a test of
    // the payload SHAPE.
    // eslint-disable-next-line no-new-func
    return new Function('now', 'zealTagsSnapshot', 'st', 'noteZoneForTags', '_zoneName',
      '_pickTagsForUpload', 'return ' + body)(
      nowMs, () => tags, { zone: 'thedeep' }, () => false, z => z, t => t);
  };

  it('ships the structured extract, capped', () => {
    const out = build([{ spawn_id: 1234, mob: 'thall va xakra', mobDisplay: 'Thall Va Xakra',
      text: 'Naggato-Tanking', shape: 'G', tagger: 'Naggato', tsMs: NOW - 3000 }], NOW);
    expect(out).toEqual([{ spawn_id: 1234, mob: 'Thall Va Xakra', text: 'Naggato-Tanking',
      shape: 'G', tagger: 'Naggato', since: new Date(NOW - 3000).toISOString(),
      // Append semantics ride along; null here because this fixture predates
      // them, which is exactly what an older agent's payload looks like.
      mode: null, appended_to: null, replaced_tagger: null }]);
    expect(build([], NOW)).toBeNull();
  });

  it('ships mode + appended_to when the tag was an append', () => {
    const out = build([{ spawn_id: 114, mob: 'derakor the vindicator',
      mobDisplay: 'Derakor the Vindicator', text: 'SLOWED', shape: null,
      tagger: 'Canniball', tsMs: NOW - 1000, mode: 'append', appendedTo: 'Dafeet' }], NOW);
    expect(out[0]).toMatchObject({ mode: 'append', appended_to: 'Dafeet', tagger: 'Canniball' });
  });
});

// ── Bot-side wiring (source assertions — the weld is inline in the handler) ──
describe('bot integration points', () => {
  const bot = readSource(new URL('../index.js', import.meta.url).pathname
    .replace('/scratchpad/beta-wt/index.js', '/scratchpad/beta-wt/index.js'));
  void bot;

  it('the agent sanitizes shapes to the Zeal set on capture', () => {
    expect(src).toMatch(/_ZEAL_TAG_SHAPES = \{ r: 'R', o: 'O', y: 'Y', g: 'G', b: 'B', w: 'W', p: 'P', s: 'S' \}/);
  });
});

// ── Append semantics (Hitya 2026-08-06) ──────────────────────────────────
// "tags can append as well if you do a /tag chat +<tag> with a plus symbol."
//
// The prefix used to be stripped and thrown away, which was harmless while the
// only consumer was a row label. It is not harmless for the identity log: an
// append is a SECOND TAGGER on one spawn id, and it names the person appended
// onto — two clients agreeing on one id in a single observation, with none of
// the upload-timing luck the two-independent-taggers path depends on.
describe('zeal /tag — append semantics carry the prior tagger', () => {
  const TNOW = Date.parse('2026-08-06T01:35:52.000Z');
  const h = harness();
  beforeEach(() => h._zealTags.clear());

  const tag = (payload, who, at = TNOW) =>
    h._applyZealTagMessage(payload, who, at);
  const one = () => h.zealTagsSnapshot(TNOW)[0];

  it('records mode=set for a plain tag', () => {
    tag('ZEALTAG | TANKING | Derakor the Vindicator | 114', 'Dafeet');
    expect(one()).toMatchObject({ mode: 'set', appendedTo: null, text: 'TANKING' });
  });

  it('a + append from a SECOND tagger names who they appended onto', () => {
    tag('ZEALTAG | TANKING | Derakor the Vindicator | 114', 'Dafeet');
    tag('ZEALTAG | +SLOWED | Derakor the Vindicator | 114', 'Canniball');
    expect(one()).toMatchObject({
      mode: 'append',
      appendedTo: 'Dafeet',        // ← the proof: two names, one spawn id
      tagger: 'Canniball',
      spawn_id: 114,
    });
  });

  it('@ is an append too', () => {
    tag('ZEALTAG | TANKING | a wolf | 7', 'Dafeet');
    tag('ZEALTAG | @ADD | a wolf | 7', 'Jankzer');
    expect(one()).toMatchObject({ mode: 'append', appendedTo: 'Dafeet' });
  });

  it('! is a replace, not an append', () => {
    tag('ZEALTAG | TANKING | a wolf | 7', 'Dafeet');
    tag('ZEALTAG | !MINE | a wolf | 7', 'Jankzer');
    expect(one()).toMatchObject({ mode: 'replace', appendedTo: null });
  });

  it('appending to your OWN tag proves nothing, so appendedTo stays null', () => {
    tag('ZEALTAG | TANKING | a wolf | 7', 'Dafeet');
    tag('ZEALTAG | +SLOWED | a wolf | 7', 'Dafeet');
    expect(one()).toMatchObject({ mode: 'append', appendedTo: null });
  });

  it('an append with no prior tag has nobody to name', () => {
    tag('ZEALTAG | +SLOWED | a wolf | 7', 'Canniball');
    expect(one()).toMatchObject({ mode: 'append', appendedTo: null });
  });

  it('text still holds only the appender fragment — the merge is the log\'s job', () => {
    tag('ZEALTAG | TANKING | a wolf | 7', 'Dafeet');
    tag('ZEALTAG | +SLOWED | a wolf | 7', 'Canniball');
    // In game the nameplate reads "TANKING SLOWED"; we deliberately keep the
    // fragment and let SQL reconstruct, so nobody reads tag_text as what the
    // raid saw.
    expect(one().text).toBe('SLOWED');
  });
});
