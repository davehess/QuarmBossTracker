// test/npc-speech-triggers.test.js — triggers hear NPC speech, never a player's.
//
// The guild lead, 2026-09-30: "yes to NPC speech". The privacy drop list removes every says / shouts /
// tells-you line, which also hid scripted boss events from triggers (the Tribunal's trials, Coirnav's
// shouts, Etumer). npcSpeechLine lets NPC speakers through to the trigger engine only: a speaker with a
// space in the name, or one of the named one-word NPCs. Runs the real predicate against real line shapes.
//
// Run: npx vitest run test/npc-speech-triggers.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const block = [
  sliceBlock(src, 'const NPC_SPEECH_ONE_WORD = ', ';'),
  sliceBlock(src, 'const NPC_SPEECH_RX = ', ';'),
  sliceBlock(src, 'function npcSpeechLine(line) {', '\n}'),
].join('\n');
// eslint-disable-next-line no-new-func
const npcSpeechLine = new Function(block + '\nreturn npcSpeechLine;')();
const T = '[Wed Oct 01 20:00:00 2026] ';

describe('NPC speech reaches triggers', () => {
  it.each([
    ["The Tribunal says, 'Then begin.'", 'a trial starting'],
    ["The Tribunal tells you, 'You have completed a trial - impressive for mortals.  You can tell Mavuin that we will hear his plea.'", 'the flag tell'],
    ["Agent of The Tribunal says, 'The trial is yet underway.  You must wait.'", 'a long NPC name'],
    ["Thelin Poxbourne says, 'Please stay close, I know not what horror Terris will unleash upon us.'", 'an escort'],
    ["Etumer says, 'Perhaps you could find some way to overwhelm Mujaki?'", 'a named one-word NPC'],
    ["Coirnav the Avatar of Water shouts, 'Violaters of this plane be banished from this domain!'", 'a boss shout'],
    ["a grimling warder shouts, 'Master! The sacred ring of fire has been cleansed of trespassers.'", 'an event reset'],
    ["Aldenmar`s warder tells you, 'Attacking a gnoll Master.'", 'a pet'],
  ])('%s (%s)', (line) => {
    expect(npcSpeechLine(T + line)).toBe(true);
  });
});

describe("a player's words stay hidden", () => {
  it.each([
    ["Rethlan tells you, 'meet me at the bank'", 'a tell'],
    ["Rethlan says, 'hail'", 'a player /say'],
    ["Rethlan shouts, 'WTS a lute'", 'a player shout'],
    ["Rethlan says out of character, 'lfg'", 'OOC'],
    ["Rethlan tells the group, 'inc'", 'group'],
    ["Rethlan tells the guild, 'The Tribunal says, go'", 'guild chat quoting an NPC'],
    ["Rethlan tells the raid, 'Etumer says, ready'", 'raid chat quoting an NPC'],
    ["Rethlan tells General:2, 'hi'", 'a channel'],
    ["Rethlan tells Wolfpackofficer:5, 'plan'", 'the officer channel'],
    ["You told Rethlan, 'secret'", 'an outgoing tell'],
    ["You say, 'Hail, Etumer'", 'your own /say'],
    ["Vox shouts, 'You dare?'", 'a one-word NPC nobody named'],
  ])('%s (%s)', (line) => {
    expect(npcSpeechLine(T + line)).toBe(false);
  });
});

describe('where it applies', () => {
  const code = stripJs(src);
  it('the live trigger gate and the replay both let NPC speech through', () => {
    expect(code).toMatch(/if \(triggerVisibleLine\(line, dropPatterns\) \|\| npcSpeechLine\(line\)\) \{/);
    expect(code).toMatch(/if \(\(triggerVisibleLine\(raw\) \|\| npcSpeechLine\(raw\)\) && lines\.length < REPLAY_LINE_CAP\)/);
  });
  it('the feedback log excerpt does not: NPC speech is never uploaded with a report', () => {
    const fb = sliceBlock(code, 'function _feedbackLineAllowed(line) {', '\n}');
    expect(fb).toMatch(/triggerVisibleLine\(line\)/);
    expect(fb).not.toMatch(/npcSpeechLine/);
  });
});
