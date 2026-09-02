// test/zeal-capability-agent.test.js — the AGENT half of "whose client can
// actually hand us a spawn id".
//
// Hitya, 2026-09-01: "let me start tracking zeal versions so we can work
// towards knowing when someone has that Target and spawn ID. fall back is if
// they tag."
//
// ⚠ THE CENTRAL POINT, and the reason these are two fields rather than one:
// THE VERSION CANNOT ANSWER THE CAPABILITY QUESTION. Zeal PR #229 is not
// released, and a build carrying it reports the SAME version string as a stock
// build of the same release — the author's own patched client reports "1.4.5".
// A version test would therefore call a capable client incapable. Capability is
// OBSERVED (did an id actually arrive), version is for chasing adoption.
//
// ⚠ And capability LATCHES. "No target right now" is the common case between
// pulls and is not evidence the client cannot supply an id; a flag that flapped
// with targeting would make the fleet board useless.
//
// ⚠ THIS FILE LIVES ON `beta`, because the agent does. Its sibling
// test/zeal-version-capability.test.js covers the bot + web halves and lives on
// `main`. The agent↔bot CONTRACT is asserted here rather than there, because
// beta is the only branch that carries both sources at once (main→beta syncs
// continuously; nothing flows the other way).
//
// Run: npx vitest run test/zeal-capability-agent.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, ROOT, AGENT_INDEX, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';
import path from 'node:path';

const agentSrc = readSource(AGENT_INDEX);

function build() {
  return evalBlock(
    'const _clientVersions = new Map();\n'
    // ⚠ The end anchor is the COMMENT after the block, never a line of the
    // block itself. Anchoring on noteSpawnIdSeen's own body meant any mutation
    // to that body broke the slice and read as "suite failed to load" — which
    // looks like a kill but proves nothing about the assertion.
    + sliceBlock(agentSrc, 'function _newestZealVersion() {', '\n// Snapshot for the dashboard + /api/state.')
    + '\nfunction seen(){ return _spawnIdSeen; }'
    + '\nfunction setVer(ch, zeal, at){ _clientVersions.set(ch, { zeal, at }); }',
    ['_newestZealVersion', 'noteSpawnIdSeen', 'seen', 'setVer'],
  );
}

let h;
beforeEach(() => { h = build(); });

describe('the reported Zeal version', () => {
  it('is null before anyone has typed /zeal', () => {
    expect(h._newestZealVersion()).toBe(null);
  });

  it('reports the version, not the character', () => {
    h.setVer('hitya', '1.4.5', '2026-09-01T10:00:00Z');
    expect(h._newestZealVersion()).toBe('1.4.5');
  });

  // Zeal is per-CLIENT: one install serves every character on the box, so the
  // freshest reading is the machine's rather than whoever last ran /zeal.
  it('takes the FRESHEST reading across watched characters', () => {
    h.setVer('canopy', '1.4.4', '2026-09-01T09:00:00Z');
    h.setVer('hitya',  '1.4.6', '2026-09-01T11:00:00Z');
    h.setVer('utoh',   '1.4.3', '2026-09-01T08:00:00Z');
    expect(h._newestZealVersion()).toBe('1.4.6');
  });

  it('skips characters that reported other dll versions but no Zeal one', () => {
    h.setVer('hitya', null, '2026-09-01T12:00:00Z');
    h.setVer('canopy', '1.4.5', '2026-09-01T09:00:00Z');
    expect(h._newestZealVersion()).toBe('1.4.5');
  });
});

describe('the capability latch', () => {
  it('starts false — absence of proof, not proof of absence', () => {
    expect(h.seen()).toBe(false);
  });

  it('latches on the first real id', () => {
    h.noteSpawnIdSeen(4425);
    expect(h.seen()).toBe(true);
  });

  // ⚠ The flapping guard: between pulls there is no target and no id.
  it('STAYS latched once the target is cleared', () => {
    h.noteSpawnIdSeen(4425);
    h.noteSpawnIdSeen(null);
    h.noteSpawnIdSeen(undefined);
    expect(h.seen()).toBe(true);
  });

  it('does not latch on a null, undefined or non-numeric id', () => {
    h.noteSpawnIdSeen(null); h.noteSpawnIdSeen(undefined);
    h.noteSpawnIdSeen('4425'); h.noteSpawnIdSeen(Number.NaN);
    expect(h.seen()).toBe(false);
  });

  it('latches on id 0 — a falsy but valid slot', () => {
    h.noteSpawnIdSeen(0);
    expect(h.seen()).toBe(true);
  });
});

describe('wiring', () => {
  const agent = stripJs(agentSrc);

  it('both facts ride agent_state, which every tracked upload already carries', () => {
    expect(agent).toContain('zeal_version: _newestZealVersion(),');
    expect(agent).toContain('spawn_id_capable: _spawnIdSeen,');
  });

  // ⚠ WHERE the latch sits is the whole correctness of the capability flag.
  // The live-state upload is change-signature gated, so a capable client can
  // hand us ids for an entire fight without ever tripping a send; latching
  // there would report it incapable. It has to sit on the pipe-state intake,
  // which runs on every snapshot Mimic forwards.
  it('latches on the pipe intake, not on the gated upload path', () => {
    const intake = sliceBlock(
      agent,
      "      if (req.url === '/api/zeal-state' && req.method === 'POST') {",
      '_zealState[character] = { ...st, updatedAt: Date.now() };',
    );
    for (const call of ['noteSpawnIdSeen(st.spawn_id)', 'noteSpawnIdSeen(st.target_id)',
      'noteSpawnIdSeen(st.pet_id)']) {
      expect(agent).toContain(call);          // exists at all
      expect(intake).not.toContain(call);     // ...and BELOW the intake anchor
    }
    // Everything after the intake anchor, up to the end of that handler.
    const after = agent.slice(agent.indexOf(intake) + intake.length);
    expect(after.slice(0, 800)).toContain('noteSpawnIdSeen(st.target_id)');
  });

  // All three, not just the target: a client sitting at the guild lobby with
  // nothing targeted still streams its OWN spawn_id every frame, so keying
  // capability on the target alone would leave idle-but-capable boxes unproven.
  it('accepts any of the three ids as proof, not the target alone', () => {
    expect(agent).toContain('noteSpawnIdSeen(st.spawn_id)');
    expect(agent).toContain('noteSpawnIdSeen(st.pet_id)');
  });

  // The upload site must stay a plain read — see zeal-spawn-id-capture.test.js,
  // which asserts that exact line byte-for-byte.
  it('does not latch inside the live-state payload builder', () => {
    const upload = sliceBlock(agent, '      target_name:    st.target_name || null,', '\n      loc_x:');
    expect(upload).not.toContain('noteSpawnIdSeen');
  });
});

// ── The contract, asserted where both sides of it exist ─────────────────────
//
// The agent writes these two keys and the bot reads them by name. A rename on
// one side is silent everywhere else: the bot would just record null forever
// and the board would report a capable fleet as incapable. `beta` is the only
// branch carrying both sources, so this pairing can only be checked here.
describe('the agent↔bot contract', () => {
  const agent = stripJs(agentSrc);
  const bot   = stripJs(readSource(BOT_INDEX));

  it('the bot reads exactly the keys the agent writes', () => {
    expect(agent).toContain('zeal_version: _newestZealVersion(),');
    expect(bot).toContain('agentState.zeal_version');
    expect(agent).toContain('spawn_id_capable: _spawnIdSeen,');
    expect(bot).toContain('agentState.spawn_id_capable');
  });

  it('capability is a SEPARATE field from the version, never derived from it', () => {
    // A version comparison here would be the bug this whole design avoids.
    const fn = sliceBlock(bot, 'function _trackUpload(', '\n}\n');
    expect(fn).not.toMatch(/zeal_version[^;]*>=|semver|parseFloat\(.*zeal/i);
  });
});
