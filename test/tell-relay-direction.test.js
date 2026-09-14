// test/tell-relay-direction.test.js — the DM relay's arrow points from the speaker.
//
// Hitya, 2026-09-14, with the #pvp-style DM thread open: "These are still
// going the wrong direction." A tell Fandango sent was drawn as
// "**Fandango** ← Hitya", which reads as Hitya speaking. The stored rows were
// checked against the raw log lines and every direction was right — only the
// drawing was backwards. Now both directions read SPEAKER → LISTENER, so the
// left name is always who spoke.
//
// Runs the real _relayTellsToDM against a fake Discord client (captures the
// one DM it sends) — a comment cannot satisfy a rendered string.
//
// Run: npx vitest run test/tell-relay-direction.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
// End anchor: the first line of the best-effort stamp that follows the send —
// a comment, so a slice failure is loud, never silent.
const block = sliceBlock(src, 'async function _relayTellsToDM(discordUserId, ownerCharacter, tellRows) {',
                              '    // Best-effort: stamp dm_relayed_at on the rows we just DMed.');

async function render(rows) {
  const sent = [];
  const client = { users: { fetch: async () => ({ send: async (m) => { sent.push(m.content); } }) } };
  // Close the function after the send: the slice stops before the stamp, so
  // we terminate the try with a catch and the function body here.
  const fn = new Function('client', 'require', block + "\n  } catch (e) { throw e; } }\n  return _relayTellsToDM;")(client, () => ({}));
  await fn('123', 'Hitya', rows);
  return sent[0] || '';
}

const row = (direction, text, ts) => ({ direction, other_name: 'Fandango', text, ts });

describe('_relayTellsToDM', () => {
  it('draws a received tell as Other → Owner, and a sent one as Owner → Other', async () => {
    const out = await render([
      row('incoming', 'wut u bringing', '2026-09-14T16:20:30Z'),
      row('outgoing', 'monk',           '2026-09-14T16:20:34Z'),
    ]);
    expect(out).toContain('📬 **Fandango** → Hitya: wut u bringing');
    expect(out).toContain('Hitya → **Fandango**: monk');
    expect(out).not.toContain('←');
  });

  it('keeps the lines in the order the tells happened', async () => {
    const out = await render([
      row('outgoing', 'second', '2026-09-14T16:20:34Z'),
      row('incoming', 'first',  '2026-09-14T16:20:30Z'),
    ]);
    expect(out.indexOf('first')).toBeLessThan(out.indexOf('second'));
  });
});
