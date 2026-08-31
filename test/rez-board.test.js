// test/rez-board.test.js — the Command Center "Needs rez" board.
// SOURCE-SLICE tier: the call-out parser and the board state machine are
// sliced out of the shipped agent, so edits to the real code are exercised.
//
// Hitya 2026-08-20: "lets build in a 'needs rez' section of command center …
// if the rezzer has mimic and we see them rezzing the corpse OR if someone
// calls it out in guild/raid chat as 'REZ <name>' or 'rezzing <name>' we can
// make that person's name glow brighter until it says 'rezzed' next to them.
// When they enter the zone, they've been rezzed. Someone could also ask for a
// rez when they're already in the same zone."

import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, AGENT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const block = sliceBlock(
  src,
  'const _deadSince = new Map();',
  "|| String(a.name).localeCompare(String(b.name));\n  });\n}",
);
const api = evalBlock(
  // _isOurPetName is a free identifier in the slice (pets never reach the
  // board, added 2026-08-30). Default: nothing is a pet; one test overrides it.
  'const console = { log(){}, warn(){} };\n'
  + 'let _petNames = new Set();\n'
  + 'const _isOurPetName = (n) => _petNames.has(String(n||"").toLowerCase());\n'
  + 'const _setPetNames = (arr) => { _petNames = new Set(arr); };\n' + block,
  ['parseRezCallout', 'noteRezIncoming', 'noteRezRequest', 'noteRezDone',
   'noteRezFromChat', '_rezBoardSnapshot', '_noteDeath', '_clearDeath',
   '_rezState', '_deadSince', 'REZ_DONE_LINGER_MS', 'REZ_REQUEST_TTL_MS', '_setPetNames'],
);
const {
  parseRezCallout, noteRezIncoming, noteRezRequest, noteRezDone,
  noteRezFromChat, _rezBoardSnapshot, _noteDeath, _rezState, _deadSince,
  REZ_DONE_LINGER_MS, REZ_REQUEST_TTL_MS, _setPetNames,
} = api;

beforeEach(() => { _rezState.clear(); _deadSince.clear(); });

describe('parseRezCallout — reading the raid chat', () => {
  it('the two forms Hitya named', () => {
    expect(parseRezCallout('REZ Hitya')).toEqual({ target: 'Hitya' });
    expect(parseRezCallout('rezzing Hitya')).toEqual({ target: 'Hitya' });
  });

  it('normalises case and tolerates the usual phrasing', () => {
    expect(parseRezCallout('rez canopy')).toEqual({ target: 'Canopy' });
    expect(parseRezCallout('rezzing on Fittir now')).toEqual({ target: 'Fittir' });
    expect(parseRezCallout('Rezz Dant')).toEqual({ target: 'Dant' });
  });

  it('a bare ask is a REQUEST from the speaker, not a target named "me"', () => {
    for (const s of ['rez me', 'rez plz', 'rez pls', 'need a rez', 'can I get a rez', 'rez please']) {
      expect(parseRezCallout(s), s).toEqual({ selfRequest: true });
    }
  });

  it('ignores chat with no rez in it', () => {
    expect(parseRezCallout('nice pull')).toBeNull();
    expect(parseRezCallout('')).toBeNull();
    expect(parseRezCallout(null)).toBeNull();
  });
});

describe('the board', () => {
  it('a death with nobody on it reads "needs"', () => {
    _noteDeath('statlander', Date.now() - 60_000);
    const rows = _rezBoardSnapshot();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'statlander', state: 'needs' });
    expect(rows[0].dead_ms).toBeGreaterThan(50_000);
  });

  it('a chat call-out puts the corpse into the glowing state, with the rezzer', () => {
    _noteDeath('hitya', Date.now() - 30_000);
    noteRezFromChat({ channel: 'raid', speaker: 'Fargan', body: 'rez Hitya' });
    const row = _rezBoardSnapshot().find(r => r.name.toLowerCase() === 'hitya');
    expect(row.state).toBe('incoming');
    expect(row.rezzer).toBe('Fargan');
  });

  it('life on an independent channel (_clearDeath) is the rezzed confirmation', () => {
    _noteDeath('canopy', Date.now() - 30_000);
    noteRezIncoming('Canopy', 'Fargan');
    api._clearDeath('canopy');                 // group-HP watcher saw HP > 0
    const row = _rezBoardSnapshot().find(r => r.name.toLowerCase() === 'canopy');
    expect(row.state).toBe('rezzed');
  });

  it('a rezzed row lingers so it can be READ, then leaves', () => {
    _noteDeath('melting', Date.now() - 30_000);
    api._clearDeath('melting');
    expect(_rezBoardSnapshot()).toHaveLength(1);
    const e = _rezState.get('melting');
    e.doneAt = Date.now() - (REZ_DONE_LINGER_MS + 1000);
    expect(_rezBoardSnapshot()).toHaveLength(0);
  });

  it('someone already in the zone can ASK, with no death behind it', () => {
    noteRezFromChat({ channel: 'guild', speaker: 'Rockin', body: 'rez me plz' });
    const rows = _rezBoardSnapshot();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Rockin', state: 'needs', requested: true });
    expect(rows[0].dead_ms).toBeNull();
  });

  it('an unanswered request ages out instead of sitting there all night', () => {
    noteRezRequest('Utoh', Date.now());
    _rezState.get('utoh').since = Date.now() - (REZ_REQUEST_TTL_MS + 1000);
    expect(_rezBoardSnapshot()).toHaveLength(0);
  });

  it('glowing rows sort above waiting ones, longest-dead first', () => {
    _noteDeath('older', Date.now() - 300_000);
    _noteDeath('newer', Date.now() - 10_000);
    _noteDeath('claimed', Date.now() - 20_000);
    noteRezIncoming('claimed', 'Fargan');
    expect(_rezBoardSnapshot().map(r => r.name)).toEqual(['claimed', 'older', 'newer']);
  });

  it('only guild and raid chat drive the board — not tells or say', () => {
    _noteDeath('dant', Date.now() - 10_000);
    noteRezFromChat({ channel: 'tell', speaker: 'Someone', body: 'rez Dant' });
    expect(_rezBoardSnapshot()[0].state).toBe('needs');
  });
});

describe('pets never reach the board', () => {
  it('a summoned/charm pet is not a rez candidate', () => {
    // Hitya, 2026-08-30: "Jtik is a pet". A healer reading that row spends a
    // rez on something no rez can touch, and it pushes a real corpse down.
    _setPetNames(['jtik']);
    _noteDeath('Jtik', Date.now() - 30_000);
    _noteDeath('Dafeet', Date.now() - 30_000);
    const names = _rezBoardSnapshot(Date.now()).map(r => String(r.name).toLowerCase());
    expect(names).not.toContain('jtik');
    expect(names).toContain('dafeet');
    _setPetNames([]);
  });

  it('keeps the name as written for a real corpse', () => {
    _noteDeath('Dwimmerlaik', Date.now() - 20_000);
    const row = _rezBoardSnapshot(Date.now()).find(r => String(r.name).toLowerCase() === 'dwimmerlaik');
    expect(row).toBeTruthy();
    expect(row.name).toBe('Dwimmerlaik');
  });
});
