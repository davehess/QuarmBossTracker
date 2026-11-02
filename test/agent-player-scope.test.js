// A flag-sync-only Mimic link (scope 'player', DECISIONS §526): the bot lets that session poll, check the version and upload
// PoP flags, and answers 403 to everything else. The agent's durable queue drops a 4xx as permanent, so it must not queue the
// other streams for it. Mimic pushes the identity with scope 'player' (apps/mimic/hubs.js identityFromPoll); the agent reads it.
//
// Run: npx vitest run test/agent-player-scope.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const raw = readSource(AGENT_INDEX);
const src = stripJs(raw);

// The real helper and its allow-list, run against stubs for the two session variables it reads.
function scope(token, identity) {
  const block = sliceBlock(raw, "const _PLAYER_SCOPE_KINDS = new Set(['pop_flag']);", "_mimicIdentity.scope === 'player'); }");
  // eslint-disable-next-line no-new-func
  return new Function('_mimicSessionToken', '_mimicIdentity', block + '\nreturn { _playerScope, _PLAYER_SCOPE_KINDS };')(token, identity);
}

describe('_playerScope', () => {
  it('is true only for a live session whose identity carries scope player', () => {
    expect(scope('wpms_x', { scope: 'player', discord_id: '1' })._playerScope()).toBe(true);
    expect(scope('wpms_x', { scope: 'member', guild_id: 'alpha' })._playerScope()).toBe(false);
    expect(scope('wpms_x', { discord_id: '1', is_officer: true })._playerScope()).toBe(false);   // a Wolf Pack session
    expect(scope('wpms_x', null)._playerScope()).toBe(false);
    expect(scope('', { scope: 'player' })._playerScope()).toBe(false);                            // signed out
  });
  it('lets PoP flags through and nothing else', () => {
    expect([...scope('t', { scope: 'player' })._PLAYER_SCOPE_KINDS]).toEqual(['pop_flag']);
  });
});

describe('the agent holds a player session to that list', () => {
  const enqueue = sliceBlock(src, 'function enqueueUpload(kind, payload) {', '\n}\n');
  it('enqueueUpload refuses every other kind for it, before anything is queued', () => {
    const a = enqueue.indexOf('_playerScope() && !_PLAYER_SCOPE_KINDS.has(kind)');
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(enqueue.indexOf('_uploadQueue.push'));
  });
  it('the direct live-state POST is held too', () => {
    const post = sliceBlock(src, 'function _postLiveState(targetUrl, token, payload) {', '\n}\n');
    expect(post).toMatch(/if \(_playerScope\(\)\) return;/);
  });
  it('PoP flags still go through the queue as kind pop_flag, mapped to the route the bot allows', () => {
    expect(src).toMatch(/enqueueUpload\('pop_flag'/);
    expect(src).toMatch(/case 'pop_flag':\s+return base \+ '\/pop_flags';/);
  });
});
