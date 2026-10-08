// test/anon-feedback-clean.test.js — the anonymous-feedback cleaner (web/lib/anonFeedbackClean.ts).
// (the guild lead, 2026-10-08: the eqmimic.quest form "needs to clean data before it even gets logged,
// looking for any sql, data exfiltration".)
//
// BEHAVIOUR tests: they run the real cleaner. Secret-shaped fixtures are assembled at runtime from
// parts so no real-looking key sits in the repo as one literal. The benign cases matter as much as the
// hostile ones: plain EverQuest prose must come through untouched or the form eats real reports.
//
// Run: npx vitest run test/anon-feedback-clean.test.js

import { describe, it, expect } from 'vitest';
import { cleanAnonMessage, cleanDiscordContact, MAX_MESSAGE_CHARS } from '../web/lib/anonFeedbackClean.ts';

const PAD = ' The DPS overlay froze during the raid.';
const clean = (s) => cleanAnonMessage(s + PAD);

// Fixtures built from parts.
const b = (n, ch = 'a') => ch.repeat(n);
const JWT = ['eyJ' + b(12, 'h'), b(20, 'p'), b(20, 's')].join('.');
const DISCORD_TOKEN = [b(24, 'M'), b(6, 'x'), b(27, 'y')].join('.');
const GH = 'ghp_' + b(36, 'Z');
const AWS = 'AKIA' + 'IOSFODNN7EXAMPLE';
const SK = 'sk-' + b(32, 'q');
const B64 = b(44, 'Q') + '==';
const HEX = '0123456789abcdef'.repeat(2);

describe('benign EverQuest text survives untouched', () => {
  const benign = [
    'Select your target, union of the raid groups drops items. /tell me about Plane of Fear at 50% hp.',
    'The drop table for Vox is wrong and the loot never shows up in the window.',
    'I cannot select a spell from the gem bar after zoning, it just stays greyed out.',
    'Insert into the gem slot does nothing when I drag the spell (three times now).',
    'Mimic 2.7.10 on win32: install.sh is not the issue, it crashed.No idea why it happens.',
    'My log is C:\\EverQuest\\Logs\\eqlog_Aldenmar_pq.proj.txt and it is huge after a raid.',
    'I sleep (afk) at 3 pm and the timer shows 50% on the DPS meter when hp < boss.',
    'Agent 3.5.44 and Mimic 2.7.10 both show the same thing, I <3 the overlay though.',
    'Delete from my UI folder did not help, the layout still resets on every start.',
    'Select a mob from the list, then the window shows nothing at all.',
    'Warriors and level=60 or class=war look wrong in the /who list for me.',
    'Open C:\\Users is fine but the /home button on the UI does nothing for me.',
  ];
  for (const text of benign) {
    it(JSON.stringify(text.slice(0, 48)), () => {
      const r = cleanAnonMessage(text);
      expect(r.reject).toBeUndefined();
      expect(r.text).toBe(text);
      expect(r.flags).toEqual([]);
    });
  }
});

describe('SQL-looking text is redacted and flagged', () => {
  const sql = [
    "x UNION SELECT password FROM users",
    'x UNION/**/ALL/**/SELECT 1,2,3',
    'SELECT * FROM users',
    'select password from users',
    'select name, email from members where id = 1',
    "INSERT INTO users (id, admin) VALUES (1, true)",
    "UPDATE users SET admin = 1",
    'DELETE FROM users WHERE 1=1',
    'DROP TABLE users;',
    'ALTER TABLE users ADD COLUMN x int',
    'TRUNCATE TABLE audit_log',
    "EXEC xp_cmdshell 'dir'",
    "name' OR 1=1",
    "name' or 'a'='a",
    'admin"; --',
    "x'/**/OR/**/1=1",
    'AND pg_sleep(5)',
    'something sleep(10) here',
    'benchmark(1000000,md5(1))',
    'select * from information_schema.tables',
    // Evasions: fullwidth letters, zero-width characters, HTML wedged inside a keyword.
    '\uFF35\uFF2E\uFF29\uFF2F\uFF2E \uFF33\uFF25\uFF2C\uFF25\uFF23\uFF34 password',
    'UN\u200BION SEL\u200DECT password',
    'SEL<b>ECT * FR</b>OM users',
  ];
  for (const q of sql) {
    it(JSON.stringify(q.slice(0, 40)), () => {
      const r = clean(q);
      expect(r.flags).toContain('sql');
      expect(r.text).toContain('[removed]');
      // None of the statement words may survive as words, even with the markers in between.
      expect(r.text).not.toMatch(/\b(union|select|drop|truncate|alter|insert|exec|xp_cmdshell|pg_sleep|sleep|benchmark|information_schema)\b/i);
      expect(r.text).not.toMatch(/\b(or|and)\W{0,12}(1\s*=\s*1|'a'\s*=\s*'a)/i);
      expect(r.text).not.toMatch(/from\s+users|'a'='a/i);
    });
  }
  it('UNION SELECT with no FROM is still caught on its own', () => {
    const r = clean('1 UNION SELECT 1,2,3');
    expect(r.flags).toContain('sql');
    expect(r.text).not.toMatch(/union|select/i);
  });
  it('a quote-glued comment is removed', () => {
    expect(clean("name'--").flags).toContain('sql');
    expect(clean("name'; -- gone").text).not.toMatch(/--/);
  });
  it('time-based and file functions are removed as calls', () => {
    for (const q of ['pg_sleep(5)', 'load_file(0x2f)', 'waitfor delay 0:0:5', "x into outfile y"]) {
      expect(clean(q).flags).toContain('sql');
    }
  });
});

describe('links, domains and addresses', () => {
  const urls = [
    'http://evil.example/steal?x=1', 'https://a.b/c?d=e#f', 'visit evil.com now', 'go to WWW.EVIL.COM please',
    'www.evil.xyz/login', 'join discord.gg/abc123', 'javascript:alert(1)', 'send it to evil[dot]com thanks',
    'ftp://user:pw@host/file', 'ssh://root@10.0.0.1',
  ];
  for (const u of urls) {
    it('url ' + JSON.stringify(u), () => {
      const r = clean(u);
      expect(r.flags).toContain('url');
      expect(r.text).not.toMatch(/evil|discord\.gg|javascript:|ftp:|ssh:/i);
    });
  }
  for (const e of ['mail me at bobby@example.com', 'mail bobby [at] example [dot] com', 'x.y+z@sub.example.org']) {
    it('email ' + JSON.stringify(e), () => {
      const r = clean(e);
      expect(r.flags).toContain('email');
      expect(r.text).not.toMatch(/example/i);
    });
  }
  for (const ip of ['server 192.168.1.20:8080 is down', 'host 8.8.8.8.', '2001:0db8:85a3:0000:0000:8a2e:0370:7334 here', 'loopback ::1 there', 'link fe80::1 ok']) {
    it('ip ' + JSON.stringify(ip), () => {
      const r = clean(ip);
      expect(r.flags).toContain('ip');
      expect(r.text).not.toMatch(/192\.168|8\.8\.8\.8|2001:|::1|fe80/);
    });
  }
});

describe('secrets', () => {
  const secrets = {
    jwt: JWT, 'discord token': DISCORD_TOKEN, 'github key': GH, 'aws key': AWS, 'sk key': SK,
    base64: B64, hex: HEX, 'password pair': 'password=hunter2xyz', 'password colon': 'Password: hunter2xyz',
    'token pair': 'token=abcdef123456', 'apikey colon': 'apikey:abcdef123456',
    'connection string': 'postgres://user:pw@db.internal:5432/app', bearer: 'Authorization: Bearer ' + b(30, 'k'),
  };
  for (const [name, s] of Object.entries(secrets)) {
    it(name, () => {
      const r = clean('here is mine ' + s + ' ok');
      expect(r.flags).toContain('secret');
      expect(r.text).not.toContain(s);
      expect(r.text).not.toMatch(/hunter2|abcdef123456|postgres:|ghp_|AKIA|eyJ/);
    });
  }
});

describe('paths that carry a user name', () => {
  const paths = [
    'C:\\Users\\bobby\\Documents\\EQ\\eqlog.txt', 'c:/users/bobby/desktop/x.txt', 'C:\\Users\\John Smith\\Desktop\\x.txt',
    '/home/bobby/.config/mimic/log', '/Users/bobby/Library/x', '\\\\fileserver\\share\\x',
  ];
  for (const p of paths) {
    it(JSON.stringify(p), () => {
      const r = clean('crash log at ' + p + ' attached');
      expect(r.flags).toContain('path');
      expect(r.text).not.toMatch(/bobby|Smith/i);
    });
  }
});

describe('HTML, template syntax, mentions, invisible characters', () => {
  it('strips tags and script blocks entirely', () => {
    const r = cleanAnonMessage('The timers freeze after a zone and the <b>bold</b> text is cut off <script>alert(1)</script> in the overlay <img src=x onerror=alert(1)> window, every single time.');
    expect(r.flags).toContain('html');
    expect(r.text).not.toMatch(/<|alert|onerror/);
    expect(r.text).toContain('bold');
  });
  it('strips a tag rebuilt by the first pass', () => {
    const r = clean('<scr<script></script>ipt>alert(1)</script>');
    expect(r.text).not.toMatch(/<script|alert/i);
  });
  it('redacts template and shell syntax', () => {
    for (const t of ['${process.env.SECRET}', '{{7*7}}', '$(whoami)']) {
      const r = clean(t);
      expect(r.flags).toContain('script');
      expect(r.text).not.toMatch(/whoami|process\.env|7\*7/);
    }
  });
  it('redacts mass pings', () => {
    const r = clean('@everyone look');
    expect(r.flags).toContain('mention');
    expect(r.text).not.toContain('@everyone');
  });
  it('removes control, zero-width and bidi characters and says so', () => {
    const r = cleanAnonMessage('hello\u0000 wor\u200Bld \u202Eevil\u202C and some more text');
    expect(r.flags).toContain('control');
    expect(r.text).toBe('hello world evil and some more text');
  });
  it('folds look-alike characters before scanning (NFKC)', () => {
    expect(cleanAnonMessage('\uFF45\uFF56\uFF49\uFF4C\uFF0E\uFF43\uFF4F\uFF4D is the site' + PAD).flags).toContain('url');
  });
});

describe('limits and rejection', () => {
  it('caps at 4000 characters and flags it', () => {
    const r = cleanAnonMessage('word '.repeat(2000));
    expect(r.text.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    expect(r.flags).toContain('truncated');
    expect(r.reject).toBeUndefined();
  });
  it('survives a multi-megabyte paste quickly', () => {
    const t0 = Date.now();
    const r = cleanAnonMessage('a.b.c.d '.repeat(400000));
    expect(r.flags).toContain('truncated');
    expect(Date.now() - t0).toBeLessThan(3000);
  });
  it('accepts exactly 10 real characters and rejects 9', () => {
    expect(cleanAnonMessage('abcde fghij').reject).toBeUndefined();
    expect(cleanAnonMessage('abcde fghi').reject).toMatch(/little more/);
  });
  it('rejects when too little survives the redaction, with the cut-specific reason', () => {
    const r = cleanAnonMessage('ok SELECT * FROM users');
    expect(r.reject).toMatch(/too little left/);
    expect(r.text).toBe('');
    expect(r.flags).toContain('sql');
  });
  it('rejects when more than half the input was redacted, even if 10 real characters remain', () => {
    const hostile = 'http://' + b(60) + '.example/x';
    const r = cleanAnonMessage('the overlay froze again today ' + hostile);
    expect(r.reject).toMatch(/Most of that/);
    expect(r.text).toBe('');
  });
  it('keeps a message where redaction is a minority', () => {
    const r = cleanAnonMessage('the overlay froze again today during the raid and the timers stopped, see https://evil.example/x');
    expect(r.reject).toBeUndefined();
    expect(r.text).toContain('[removed]');
    expect(r.text).toContain('timers stopped');
  });
  it('merges neighbouring markers', () => {
    const r = clean('http://a.example http://b.example http://c.example');
    expect(r.text).not.toMatch(/\[removed\]\s*\[removed\]/);
  });
  it('treats non-strings as empty', () => {
    for (const v of [null, undefined, 42, {}, []]) expect(cleanAnonMessage(v).reject).toBeTruthy();
  });
});

describe('cleanDiscordContact', () => {
  it('accepts new usernames, lowercased, with or without @', () => {
    expect(cleanDiscordContact('Wolfie_99')).toEqual({ contact: 'wolfie_99', flags: [] });
    expect(cleanDiscordContact('@some.name')).toEqual({ contact: 'some.name', flags: [] });
    expect(cleanDiscordContact('  ab  ')).toEqual({ contact: 'ab', flags: [] });
  });
  it('rejects consecutive dots, bad length and bad characters', () => {
    for (const bad of ['a..b', 'x', b(33), 'has space', 'semi;colon', 'a<b>c', 'http://x.y', 'me@evil.com', "x'--"]) {
      expect(cleanDiscordContact(bad)).toEqual({ contact: null, flags: ['contact_invalid'] });
    }
  });
  it('accepts legacy name#1234 (case kept) and user ids', () => {
    expect(cleanDiscordContact('Old Name#1234')).toEqual({ contact: 'Old Name#1234', flags: [] });
    expect(cleanDiscordContact('123456789012345678')).toEqual({ contact: '123456789012345678', flags: [] });
    expect(cleanDiscordContact('1'.repeat(33))).toEqual({ contact: null, flags: ['contact_invalid'] });
    expect(cleanDiscordContact('name#12345')).toEqual({ contact: null, flags: ['contact_invalid'] });
  });
  it('treats empty and non-strings as no contact, not as invalid', () => {
    for (const v of ['', '   ', '@', null, undefined, 5]) expect(cleanDiscordContact(v)).toEqual({ contact: null, flags: [] });
  });
  it('strips invisible characters before validating', () => {
    expect(cleanDiscordContact('wolf\u200Bie')).toEqual({ contact: 'wolfie', flags: [] });
  });
});
