// apps/bristlebane/tools/fake-raid-live.js — DEV ONLY. Answers GET /api/agent/raid-live from a JSON file so
// the smoke test (see ../README.md) can start, quiet and end a "raid" by hand without 6 real raiders
// uploading positions. Binds to localhost and checks no token.
//
//   node tools/fake-raid-live.js [port] [file]       defaults: 8787, ./fake-raid-live.json
//   echo '{"live":true}'               > fake-raid-live.json     a raid is on
//   echo '{"live":false}'              > fake-raid-live.json     the raid went quiet
//   echo '{"live":true,"ended":true}'  > fake-raid-live.json     an officer pressed End raid
//
// Then run the bot with BOT_API_URL=http://127.0.0.1:8787/api/agent

'use strict';

const http = require('node:http');
const fs = require('node:fs');

const port = Number(process.argv[2]) || 8787;
const file = process.argv[3] || 'fake-raid-live.json';

// The bot's own night key: MM/DD/YYYY in Eastern time.
const nightKey = () => new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

http.createServer((req, res) => {
  if (!req.url.startsWith('/api/agent/raid-live')) { res.writeHead(404); return res.end(); }
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* no file, or half-written: quiet */ }
  const live = s.live === true;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    live, placed: live ? 14 : 0, lastRowAt: live ? Date.now() : null,
    nightKey: s.nightKey || nightKey(), ended: s.ended === true, inWindow: true,
  }));
}).listen(port, '127.0.0.1', () => console.log(`fake raid-live on http://127.0.0.1:${port}/api/agent/raid-live, reading ${file}`));
