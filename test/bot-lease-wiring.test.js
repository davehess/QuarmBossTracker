// The bot logs in to Discord only while it holds the lease (utils/botLease.js, DECISIONS §562). These pin the four
// places index.js depends on it: login, upload refusal before ready, the health answer, and release at shutdown.
import { describe, it, expect } from 'vitest';
import { BOT_INDEX, readSource, stripJs } from './_source-slice.js';

const src = stripJs(readSource(BOT_INDEX));

describe('bot lease wiring in index.js', () => {
  it('logs in exactly once, and only after waitForLease resolves', () => {
    const logins = src.match(/client\.login\(/g) || [];
    expect(logins.length).toBe(1);
    const at = src.indexOf('client.login(');
    const wait = src.lastIndexOf('_botLease.waitForLease().then(', at);
    expect(wait).toBeGreaterThan(-1);
    const between = src.slice(wait, at);
    expect(between).toMatch(/if \(_shuttingDown\) return;/);
    expect(between).toMatch(/_botLease\.startRenewing\(/);
  });

  it('refuses agent uploads with a retryable 503 until the bot is ready', () => {
    expect(src).toMatch(/if \(!_botReady && req\.method === 'POST' && \/\^\\\/api\\\/agent\\\/\/\.test\(req\.url \|\| ''\)\) \{\s*res\.writeHead\(503/);
  });

  it('reports a standby as healthy so a deploy can retire the old bot', () => {
    expect(src).toMatch(/const ready = \(_botReady \|\| role === 'standby'\) && !_shuttingDown;/);
  });

  it('releases the lease after closing Discord at shutdown', () => {
    const shut = src.slice(src.indexOf('function _gracefulShutdown('));
    const body = shut.slice(0, shut.indexOf("process.on('SIGTERM'"));
    const destroy = body.indexOf('client.destroy()');
    const release = body.lastIndexOf('_botLease.release()');   // the holder's release; the first is the standby's early one
    expect(destroy).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(destroy);
  });

  it('a standby being stopped stops waiting at once, before the drain', () => {
    const shut = src.slice(src.indexOf('function _gracefulShutdown('));
    const body = shut.slice(0, shut.indexOf("process.on('SIGTERM'"));
    const early = body.indexOf('if (!_botLease.isHolder()) _botLease.release()');
    expect(early).toBeGreaterThan(-1);
    expect(early).toBeLessThan(body.indexOf('const drainMs'));
  });
});
