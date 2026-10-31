// 2026-10-30: a raider typed @here in raid chat and the relay posted it as a live "[@here]" mention, pinging the
// channel. Relayed chat must never ping: the text is neutralised AND every relay send/edit disables mentions.
import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const block = sliceBlock(src, 'function sanitizeChatText(raw) {', '// EQ item link');
const { sanitizeChatText } = evalBlock(block, ['sanitizeChatText']);

describe('relayed chat never pings', () => {
  it('breaks @here and @everyone so Discord cannot read them as mentions', () => {
    for (const word of ['@here', '@everyone', '@HERE']) {
      const out = sanitizeChatText('hey ' + word + ' pull');
      expect(out).not.toMatch(/@(here|everyone)\b/i);
      expect(out).toContain('@​');
    }
  });

  it('still neutralises user, role and channel mentions', () => {
    expect(sanitizeChatText('<@123> <@&456> <#789>')).toBe('[mention] [mention] [channel]');
  });

  it('the relay send and its heal edit both pass allowedMentions { parse: [] }', () => {
    const code = stripJs(src);
    expect(code).toMatch(/const sent = await ch\.send\(\{ content: `\$\{tsPrefix\}\*\*\$\{safeSpeaker\}\*\*\$\{whoTag\}: \$\{safeText\}`, allowedMentions: \{ parse: \[\] \} \}\)/);
    expect(code).toMatch(/relayEntry\.msg\.edit\(\{ content: `\$\{tsPrefix\}\*\*\$\{bestSpeaker\}\*\*\$\{whoTag\}: \$\{bestText\}`, allowedMentions: \{ parse: \[\] \} \}\)/);
  });
});
