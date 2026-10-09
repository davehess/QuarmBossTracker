// test/eqmimic-landing.test.js — the eqmimic.quest landing page (the guild lead, 2026-10-08; DECISIONS §209).
//
// What this pins:
//   - the routing function the middleware and these tests share (eqmimicLandingTarget): / and unknown
//     paths -> the landing page with EVERY query parameter dropped, /feedback -> the form (Mimic opens
//     exactly that),
//   - the middleware, RUN against a stand-in for next/server, agrees with it,
//   - the rights notice: the page's words are the wolfpack.quest footer's words, verbatim, so the two
//     cannot drift; it sits directly under the video block, before the overlay gallery, and again in the
//     footer,
//   - the page order (the guild lead, 2026-10-09: video, then overlay highlights, then setup) and that the
//     layout variants are gone,
//   - the scenarios: their shape, the #clip-<slug> hash helpers (run, not read), and that the player
//     renders a <video> for a scenario with a `src` and a placeholder for one without,
//   - the content module is complete (every step list the brief asked for) and public-safe.
//
// Source-text assertions run over comment-stripped source (CLAUDE.md "comments satisfy text assertions");
// the mutation checks that proved each one can fail are listed in DECISIONS §209.
//
// Run: npx vitest run test/eqmimic-landing.test.js

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  eqmimicLandingTarget, EQMIMIC_FEEDBACK_PATH, EQMIMIC_LANDING_PATH,
} from '../web/lib/eqmimicHost.ts';
import * as C from '../web/lib/eqmimicLanding.ts';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel) => stripJs(read(rel));
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const sentences = (s) => norm(s).split(/(?<=\.)\s+/);

describe('eqmimicLandingTarget (the routing both the middleware and the page rely on)', () => {
  it('/ and /index -> the landing page', () => {
    expect(eqmimicLandingTarget('/', '')).toEqual({ pathname: EQMIMIC_LANDING_PATH, search: '' });
    expect(eqmimicLandingTarget('/index', '')).toEqual({ pathname: EQMIMIC_LANDING_PATH, search: '' });
  });
  it('the retired layout switch is dropped like any other query: ?v=b and ?v=c show the one landing page', () => {
    expect(eqmimicLandingTarget('/', '?v=b')).toEqual({ pathname: '/eqmimic', search: '' });
    expect(eqmimicLandingTarget('/', 'v=c')).toEqual({ pathname: '/eqmimic', search: '' });
    expect(eqmimicLandingTarget('/', '?v=B').search).toBe('');
  });
  it('every query parameter is dropped', () => {
    expect(eqmimicLandingTarget('/', '?v=zzz&utm=1')).toEqual({ pathname: '/eqmimic', search: '' });
    expect(eqmimicLandingTarget('/', '?utm_source=x&token=secret')).toEqual({ pathname: '/eqmimic', search: '' });
    expect(eqmimicLandingTarget('/', '?v=b&utm=1&token=secret').search).toBe('');
    expect(eqmimicLandingTarget('/', '?v=a').search).toBe('');
  });
  it('/feedback -> the form, query dropped (the prefill rides the fragment, which never reaches the server)', () => {
    expect(eqmimicLandingTarget('/feedback', '')).toEqual({ pathname: EQMIMIC_FEEDBACK_PATH, search: '' });
    expect(eqmimicLandingTarget('/feedback', '?v=b&text=hello')).toEqual({ pathname: EQMIMIC_FEEDBACK_PATH, search: '' });
    expect(eqmimicLandingTarget('/feedback/', '').pathname).toBe(EQMIMIC_FEEDBACK_PATH);
    expect(eqmimicLandingTarget('/Feedback', '').pathname).toBe(EQMIMIC_FEEDBACK_PATH);
  });
  it('anything else -> the landing page', () => {
    for (const p of ['/anything', '/me', '/admin/feedback', '/api/agent/chat', '/eqmimic', '/eqmimic/feedback', '/feedbackx', '/feedback/extra', '//']) {
      expect(eqmimicLandingTarget(p, '?token=secret').pathname, p).toBe(EQMIMIC_LANDING_PATH);
      expect(eqmimicLandingTarget(p, '?token=secret').search, p).toBe('');
    }
  });
  it('the ?v= machinery is gone from the host module, the page and the middleware', () => {
    expect(code('web/lib/eqmimicHost.ts')).not.toMatch(/eqmimicLandingVariant|URLSearchParams|[?&]v=/);
    expect(code('web/app/eqmimic/page.tsx')).not.toMatch(/searchParams|eqmimicLandingVariant/);
    expect(code('web/middleware.ts')).not.toMatch(/eqmimicLandingVariant/);
    for (const L of ['A', 'B', 'C']) expect(fs.existsSync(path.join(ROOT, `web/app/eqmimic/_landing/Layout${L}.tsx`))).toBe(false);
  });
});

describe('the middleware, run', () => {
  // The eqmimic branch touches only NextResponse.next/rewrite and request.nextUrl/headers, so it runs
  // against a small stand-in for next/server (CI installs the root packages only). The wolfpack.quest
  // half of "unchanged" lives in test/anon-feedback-surface.test.js, which walks the real middleware.
  function fakeNextServer() {
    class NextRequest {
      constructor(url, init = {}) {
        const nu = new URL(url);
        nu.clone = () => new URL(nu.href);
        this.url = url; this.method = init.method || 'GET';
        this.headers = new Headers(init.headers || {}); this.nextUrl = nu;
      }
    }
    const res = (h) => ({ headers: new Headers(h) });
    return { NextRequest, NextResponse: { next: () => res({ 'x-middleware-next': '1' }), rewrite: (u) => res({ 'x-middleware-rewrite': String(u) }) } };
  }
  async function run(url) {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'anon-test-key';
    const fake = fakeNextServer();
    vi.doMock('next/server', () => fake);
    vi.doMock('@supabase/ssr', () => ({ createServerClient: () => { throw new Error('the eqmimic branch must not build a session client'); } }));
    const { middleware } = await import('../web/middleware.ts');
    const res = await middleware(new fake.NextRequest(url, { headers: { host: new URL(url).host } }), { waitUntil() {} });
    const to = res.headers.get('x-middleware-rewrite');
    return to ? new URL(to) : null;
  }

  it('/ -> the landing page', async () => {
    const to = await run('https://eqmimic.quest/');
    expect(to.pathname).toBe('/eqmimic');
    expect(to.search).toBe('');
  });
  it('/?v=b -> the landing page, query dropped (the layout switch is retired)', async () => {
    const to = await run('https://eqmimic.quest/?v=b');
    expect(to.pathname).toBe('/eqmimic');
    expect(to.search).toBe('');
  });
  it('/?v=zzz&utm=1 -> the landing page with no parameters', async () => {
    const to = await run('https://www.eqmimic.quest/?v=zzz&utm=1');
    expect(to.pathname).toBe('/eqmimic');
    expect(to.search).toBe('');
  });
  it('/feedback#cat=bug&text=hi -> the form (Mimic’s address keeps working)', async () => {
    const to = await run('https://eqmimic.quest/feedback#cat=bug&text=hi');
    expect(to.pathname).toBe(EQMIMIC_FEEDBACK_PATH);
    expect(to.search).toBe('');
  });
  it('/anything -> the landing page', async () => {
    const to = await run('https://eqmimic.quest/anything?x=1');
    expect(to.pathname).toBe('/eqmimic');
    expect(to.search).toBe('');
  });
  it('the Mimic app still opens only the one form address', () => {
    // The ALLOW regex lives in apps/mimic/main.js (its own test runs it); this guards the pairing: the
    // address it allows is one the middleware sends to the form, and the landing root is NOT allowed.
    const line = read('apps/mimic/main.js').split('\n').find(l => /const ALLOW = \/\^https/.test(l));
    const ALLOW = new Function(line.trim() + '\nreturn ALLOW;')();
    const opened = new URL('https://eqmimic.quest/feedback#cat=bug&text=hi');
    expect(ALLOW.test(opened.href)).toBe(true);
    expect(eqmimicLandingTarget(opened.pathname, opened.search).pathname).toBe(EQMIMIC_FEEDBACK_PATH);
    expect(ALLOW.test('https://eqmimic.quest/')).toBe(false);
  });
});

describe('the rights notice', () => {
  const layout = read('web/app/layout.tsx');
  const fromLayout = layout.match(/EverQuest is a registered trademark[\s\S]*?endorsed by Daybreak Game Company LLC\./);

  it('the wolfpack.quest footer notice is still where this test looks for it', () => {
    expect(fromLayout).not.toBeNull();
  });
  it('is the wolfpack.quest wording, verbatim, sentence for sentence', () => {
    expect(sentences(C.RIGHTS_NOTICE)).toEqual(sentences(fromLayout[0]));
    expect(sentences(C.RIGHTS_NOTICE)).toHaveLength(3);
  });
  it('carries the plain fan-project sentence', () => {
    expect(C.FAN_PROJECT_LINE).toBe('Wolf Pack Mimic is a fan project by Wolf Pack, a Project Quarm guild; it is open source (AGPL-3.0-or-later).');
  });

  const parts = code('web/app/eqmimic/_landing/Parts.tsx');
  it('the notice component renders both sentences from the content module, at readable size', () => {
    const block = parts.slice(parts.indexOf('export function RightsNotice'), parts.indexOf('export function SectionHead'));
    expect(block.length).toBeGreaterThan(200);
    expect(block).toMatch(/\{RIGHTS_NOTICE\}/);
    expect(block).toMatch(/\{FAN_PROJECT_LINE\}/);
    expect(block).not.toMatch(/text-\[(?:9|10|11)px\]|text-dim\/70/);
  });
  it('the footer repeats it', () => {
    const footer = parts.slice(parts.indexOf('export function LandingFooter'));
    expect(footer).toMatch(/<RightsNotice\b/);
  });
  it('the notice sits directly under the video block, before the overlay gallery, and the footer closes the page', () => {
    const src = code('web/app/eqmimic/_landing/Landing.tsx');
    const player = src.indexOf('<ScenarioPlayer');
    const watchEnd = src.indexOf('</section>', player);
    const notice = src.indexOf('<RightsNotice');
    expect(player).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(watchEnd);
    // Nothing else is rendered between the end of the video block and the notice.
    expect(src.slice(watchEnd + '</section>'.length, notice).trim()).toBe('');
    expect(notice).toBeLessThan(src.indexOf('<OverlayGallery'));
    expect(src.indexOf('<LandingFooter')).toBeGreaterThan(src.lastIndexOf('</section>'));
  });
});

describe('the page', () => {
  const page = code('web/app/eqmimic/page.tsx');
  it('is [beta] in its title, not indexable, and public (no session code)', () => {
    expect(page).toMatch(/\[beta\] Wolf Pack Mimic (?:\\u2014|—) a free overlay suite for Project Quarm/);
    expect(page).toMatch(/robots: \{ index: false, follow: false \}/);
    expect(page).not.toMatch(/getSessionUser|supabase/i);
  });
  it('renders the one landing, with no layout choice', () => {
    expect(page).toMatch(/return <Landing ctx=\{ctx\} \/>/);
    expect(page).not.toMatch(/LayoutA|LayoutB|LayoutC|variant/);
  });
  it('the header carries the [beta] badge linking the feedback form, and the Download button', () => {
    const parts = code('web/app/eqmimic/_landing/Parts.tsx');
    const header = parts.slice(parts.indexOf('export function Header'), parts.indexOf('export function RightsNotice'));
    expect(header).toMatch(/<h1[^>]*>\{HERO\.title\}<\/h1>/);
    expect(header).toMatch(/<a href=\{ctx\.feedback\}[\s\S]*?\[beta\]/);
    expect(header).toMatch(/this page is new/);
    expect(header).toMatch(/href=\{ctx\.download\}/);
  });
  it('the download button is the absolute wolfpack.quest address on the eqmimic host', () => {
    expect(C.WOLFPACK_ORIGIN + C.DOWNLOAD_PATH).toBe('https://wolfpack.quest/mimic?direct=1');
    expect(C.WOLFPACK_ORIGIN + C.LINUX_PATH).toBe('https://wolfpack.quest/mimic/linux?direct=1');
    expect(page).toMatch(/download: `\$\{WOLFPACK_ORIGIN\}\$\{DOWNLOAD_PATH\}`/);
    expect(page).toMatch(/download: DOWNLOAD_PATH/);
  });
  it('on the eqmimic host the form is /feedback; on Wolf Pack hosts it is its real path', () => {
    expect(page).toMatch(/feedback: '\/feedback'/);
    expect(page).toMatch(/feedback: '\/eqmimic\/feedback'/);
  });
});

describe('the shell and the form keep their looks', () => {
  it('the bare layout sets no max width; the form page sets its own max-w-2xl', () => {
    const layout = code('web/app/layout.tsx');
    const bare = layout.slice(layout.indexOf("isEqmimicHost(headers().get('host'))"), layout.indexOf('await getSessionUser()'));
    expect(bare).not.toMatch(/max-w-/);
    expect(code('web/app/eqmimic/feedback/page.tsx')).toMatch(/className="mx-auto max-w-2xl space-y-5 py-4"/);
  });
});

describe('the content module', () => {
  it('the five pieces are in connection order, and only the last is guild-only', () => {
    expect(C.PIECES.map(p => p.id)).toEqual(['zeal', 'log', 'agent', 'mimic', 'guild']);
    expect(C.PIECES.filter(p => p.guildOnly).map(p => p.id)).toEqual(['guild']);
    for (const p of C.PIECES) {
      expect(p.body.length).toBeGreaterThan(80);
      expect(p.flow).toHaveLength(3);
    }
    const all = C.PIECES.map(p => p.body).join(' ');
    for (const needle of ['named pipe', '/log on', 'eqlog_', '7777', 'on your', 'always-on-top']) expect(all.toLowerCase()).toContain(needle.toLowerCase());
  });
  it('the standalone setup has its six steps and the three-part troubleshooting, EPERM first', () => {
    expect(C.SETUP_STEPS).toHaveLength(6);
    const text = C.SETUP_STEPS.map(s => s.title + ' ' + s.body).join(' ');
    for (const needle of ['SmartScreen', 'More info', 'Run anyway', 'outside your EverQuest folder', 'Run local-only', 'Browse', 'Set up EQ for me', 'Log=TRUE', 'eqclient.ini', '/log on', 'Zeal', 'tray']) expect(text).toContain(needle);
    expect(C.TROUBLESHOOTING).toHaveLength(3);
    expect(C.TROUBLESHOOTING[0].sign).toContain('EPERM');
    expect(C.TROUBLESHOOTING[0].fix).toMatch(/compatibility mode on eqgame\.exe/);
    expect(C.TROUBLESHOOTING[0].first).toBe(true);
    expect(C.TROUBLESHOOTING[1].fix).toMatch(/outside your EverQuest folder/);
    expect(C.TROUBLESHOOTING[2].fix).toMatch(/administrator/);
    expect(C.GUIDE_LINK.href).toBe('https://wolfpack.quest/start');
  });
  it('local mode is described honestly', () => {
    const text = C.LOCAL_MODE.lead + ' ' + C.LOCAL_MODE.points.join(' ');
    for (const needle of ['nothing is sent', 'bundled', 'Buff queue', 'Extended Target', 'Target Info', 'Command Center', 'personal triggers file', 'GitHub']) expect(text).toContain(needle);
  });
  it('about a dozen overlays, each marked local or guild, guild ones named', () => {
    expect(C.OVERLAYS.length).toBeGreaterThanOrEqual(12);
    for (const o of C.OVERLAYS) expect(['local', 'guild']).toContain(o.scope);
    expect(C.OVERLAYS.filter(o => o.scope === 'guild').map(o => o.name)).toEqual(['Target Info', 'Buff queue', 'Extended Target']);
  });
  it('privacy: five bullets and the honest caveat', () => {
    expect(C.PRIVACY_BULLETS).toHaveLength(5);
    const text = C.PRIVACY_BULLETS.join(' ');
    for (const needle of ['signing out stops every upload', 'Officer, group, custom-channel, /say, OOC, shout and auction', 'on your PC', 'off until you opt in', 'keystrokes', 'clipboard', 'no admin', 'open source']) expect(text).toContain(needle);
    expect(C.PRIVACY_CAVEAT).toMatch(/live status and the results of your \/who/);
    expect(C.PRIVACY_URL).toBe('https://wolfpack.quest/privacy');
  });
  it('hive mind: seven ordered steps, the honest list, the costs and the doc links', () => {
    expect(C.HIVE_STEPS).toHaveLength(7);
    const steps = C.HIVE_STEPS.map(s => s.title + ' ' + s.body + ' ' + (s.code || '')).join('\n');
    for (const needle of ['https://github.com/davehess/QuarmBossTracker', 'selfhost-bootstrap-db.sh', 'Discord application', '.env.example', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_GUILD_ID', 'WOLFPACK_AGENT_TOKEN', 'DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'guild/config.json', 'Never commit secrets', 'docker compose up -d', 'GUILD_PROVISION=auto', 'Vercel or Coolify', 'redirect URLs', 'sign in with Discord']) expect(steps).toContain(needle);
    const honest = C.NOT_FINISHED.items.join(' ');
    for (const needle of ['wizard is only designed', 'hard-coded to wolfpack.quest', 'about a day of work', '.env.example still holds Wolf Pack defaults', '100 MB', 'doctor']) expect(honest).toContain(needle);
    expect(C.NOT_FINISHED.title).toBe('Not finished yet (honest list)');
    const costs = JSON.stringify(C.COSTS);
    for (const needle of ['$25', '$5', '$2', '$0', '$30', 'Railway Free cannot run the bot', 'Supabase Free', 'electricity', 'September 2026']) expect(costs).toContain(needle);
    expect(C.DOC_LINKS.map(d => d.href)).toEqual([
      'https://github.com/davehess/QuarmBossTracker/blob/main/docs/SELFHOSTING.md',
      'https://github.com/davehess/QuarmBossTracker/blob/main/docs/DESIGN-guild-kit.md',
      'https://github.com/davehess/QuarmBossTracker/blob/main/guild/README.md',
      'https://github.com/davehess/QuarmBossTracker/blob/main/docs/COSTS.md',
    ]);
    expect(C.HELP_LINE).toBe('Questions or want help standing it up?');
  });
  it('the hero is the one-breath line and the platform note is honest about Linux', () => {
    expect(C.HERO.line).toBe('Overlays for Project Quarm: DPS, timers, charm, buffs, triggers and more, drawn over EverQuest, free and open source.');
    expect(C.HERO.platformNote).toMatch(/Windows is the supported target/);
    expect(C.HERO.platformNote).toMatch(/experimental/);
  });
  it('is public-safe: no ids, tokens, addresses, project refs, or member names; the demo guild is invented', () => {
    const src = read('web/lib/eqmimicLanding.ts');
    expect(src).not.toMatch(/\b\d{17,20}\b/);                       // Discord snowflakes
    expect(src).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/); // IPv4
    expect(src).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{10,}|xox[bp]-/); // tokens
    expect(src).not.toMatch(/zhtoekwakucbckvatfky|supabase\.co|vercel\.app|railway\.app/);
    expect(src).not.toMatch(/dmhess@|@gmail/);
    expect(src).toMatch(/Lantern Watch/);
  });
});

describe('the page order (the guild lead, 2026-10-09: video, then overlay highlights, then setup)', () => {
  const src = code('web/app/eqmimic/_landing/Landing.tsx');
  const at = (needle) => { const i = src.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };
  it('header, player, notice, overlay gallery, setup, pieces, privacy, hive mind, footer — in that order', () => {
    const order = ['<Header', '<ScenarioPlayer', '<RightsNotice', '<OverlayGallery', '<SetupSteps', '<Ledger', '<PiecesCompact', '<PrivacyStrip', '<Hive ', '<LandingFooter'].map(at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('the sections carry the ids the page links to', () => {
    for (const id of ['watch', 'rights', 'overlays', 'setup', 'ledger', 'pieces', 'privacy', 'hive']) expect(src).toContain(`id="${id}"`);
  });
  it('the ledger folds in both columns from the retired ledger layout', () => {
    const parts = code('web/app/eqmimic/_landing/Parts.tsx');
    expect(parts).toContain('On your PC (free, no account)');
    expect(parts).toContain('Needs a guild server');
    expect(parts).toMatch(/scope="local"/);
    expect(parts).toMatch(/scope="guild"/);
  });
  it('ScenarioPlayer is the ONLY client component; the rest of the page stays server-rendered', () => {
    // (the anonymous form under eqmimic/feedback is a different page with its own client component)
    const dir = path.join(ROOT, 'web/app/eqmimic/_landing');
    const files = [...fs.readdirSync(dir).map(f => path.join(dir, f)), path.join(ROOT, 'web/app/eqmimic/page.tsx')];
    const clients = files.filter(f => /^\s*['"]use client['"]/m.test(fs.readFileSync(f, 'utf8')));
    expect(clients.map(f => path.basename(f))).toEqual(['ScenarioPlayer.tsx']);
  });
});

describe('the scenarios (the big player and its picker)', () => {
  it('SCENARIOS replaces HIGHLIGHTS, with the six placeholder scenarios in the guild lead’s order', () => {
    expect(C.HIGHLIGHTS).toBeUndefined();
    expect(C.SCENARIOS.map(s => s.slug)).toEqual(['dps-threat', 'triggers', 'charm-pets', 'hive-mind', 'zone-timers', 'setup']);
    expect(C.SCENARIOS.map(s => s.title)).toEqual([
      'DPS and threat in a raid', 'Triggers and timers', 'Charm and pets',
      'Hive mind: buff queue and extended target', 'Zone timers: the boar stampede', 'Setting it up in five minutes',
    ]);
  });
  it('each has a unique, link-safe slug, a title and a caption; the optional fields are the right type', () => {
    const slugs = new Set();
    for (const s of C.SCENARIOS) {
      expect(s.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(slugs.has(s.slug), s.slug).toBe(false); slugs.add(s.slug);
      expect(typeof s.title).toBe('string'); expect(s.title.length).toBeGreaterThan(5);
      expect(typeof s.caption).toBe('string'); expect(s.caption.length).toBeGreaterThan(10);
      for (const k of ['src', 'poster']) if (s[k] !== undefined) expect(typeof s[k]).toBe('string');
      if (s.durationSec !== undefined) expect(s.durationSec).toBeGreaterThan(0);
      // Nothing external is embedded: a clip is a path on this site or it is not set.
      for (const k of ['src', 'poster']) if (s[k]) expect(s[k]).not.toMatch(/^(?:https?:)?\/\//);
    }
  });
  it('the placeholders carry no src yet (the guild lead supplies the clips)', () => {
    for (const s of C.SCENARIOS) expect(s.src, s.slug).toBeUndefined();
  });

  it('scenarioFromHash: the named scenario, else the first', () => {
    const S = C.SCENARIOS;
    expect(C.scenarioFromHash('#clip-charm-pets', S)).toBe('charm-pets');
    expect(C.scenarioFromHash('clip-setup', S)).toBe('setup');
    expect(C.scenarioFromHash('#clip-zone-timers', S)).toBe('zone-timers');
    for (const h of ['', '#', '#setup', '#clip-', '#clip-nope', '#CLIP-triggers', '#clip-triggers-extra', '#overlays', '#xclip-triggers']) {
      expect(C.scenarioFromHash(h, S), h).toBe(S[0].slug);
    }
    expect(C.scenarioFromHash('#clip-setup', [])).toBe('');
  });
  it('matchScenario: null (not the first) when the fragment names no scenario, so a click on #setup keeps the selection', () => {
    expect(C.matchScenario('#clip-triggers', C.SCENARIOS)).toBe('triggers');
    for (const h of ['', '#setup', '#clip-nope', '#overlays']) expect(C.matchScenario(h, C.SCENARIOS), h).toBeNull();
  });
  it('scenarioHash is what scenarioFromHash reads back, for every scenario', () => {
    for (const s of C.SCENARIOS) {
      expect(C.scenarioHash(s.slug)).toBe(`#clip-${s.slug}`);
      expect(C.scenarioFromHash(C.scenarioHash(s.slug), C.SCENARIOS)).toBe(s.slug);
    }
  });
  it('formatDuration: m:ss, and nothing at all when unknown', () => {
    expect(C.formatDuration(95)).toBe('1:35');
    expect(C.formatDuration(60)).toBe('1:00');
    expect(C.formatDuration(9)).toBe('0:09');
    for (const v of [undefined, 0, -3, NaN, Infinity]) expect(C.formatDuration(v), String(v)).toBe('');
  });

  const player = code('web/app/eqmimic/_landing/ScenarioPlayer.tsx');
  it('a scenario with a src renders a controlled, lazy <video> with no autoplay; without one, a placeholder naming it', () => {
    const stage = player.slice(player.indexOf('function Stage'), player.indexOf('export default function ScenarioPlayer'));
    expect(stage).toMatch(/s\.src \? \(/);
    expect(stage).toMatch(/<video key=\{s\.slug\} src=\{s\.src\} poster=\{s\.poster\} controls playsInline preload="none"/);
    expect(stage).not.toMatch(/autoPlay|autoplay|\bmuted\b/);
    expect(stage).toMatch(/clip coming/);
    expect(stage).toMatch(/\{s\.title\}/);
    expect(stage).toMatch(/aspect-video/);
    expect(stage.indexOf('<video')).toBeLessThan(stage.indexOf('clip coming'));
  });
  it('the picker is a list of <button>s, the selected one aria-current, with a visible focus ring and tap targets of 44px or more', () => {
    expect(player).toMatch(/<button type="button" onClick=\{\(\) => pick\(s\.slug\)\} aria-current=\{on \? 'true' : undefined\}/);
    expect(player).toMatch(/focus-visible:outline/);
    const btn = player.slice(player.indexOf('<button'), player.indexOf('</button>'));
    const minH = btn.match(/min-h-(\d+)/);
    expect(minH).not.toBeNull();
    expect(Number(minH[1]) * 4).toBeGreaterThanOrEqual(44);
    expect(player).toMatch(/lg:flex-col/);        // a right-hand column on desktop
    expect(player).toMatch(/overflow-x-auto/);    // a scrollable row on a phone
  });
  it('a pick updates the hash, and the page reads it on load and on hashchange — but only a fragment that names a scenario', () => {
    expect(player).toMatch(/replaceState\(null, '', scenarioHash\(next\)\)/);
    expect(player).toMatch(/setSlug\(scenarioFromHash\(window\.location\.hash, SCENARIOS\)\)/);
    expect(player).toMatch(/addEventListener\('hashchange'/);
    expect(player).toMatch(/const named = matchScenario\(window\.location\.hash, SCENARIOS\);\s*if \(named\) setSlug\(named\);/);
  });
  it('the overlay gallery shows a still or a clip only when one is set', () => {
    const parts = code('web/app/eqmimic/_landing/Parts.tsx');
    const media = parts.slice(parts.indexOf('function OverlayMedia'), parts.indexOf('/** The overlay gallery'));
    expect(media).toMatch(/if \(o\.clip\) \{[\s\S]*<video src=\{o\.clip\}[\s\S]*if \(o\.still\) \{[\s\S]*<img src=\{o\.still\}[\s\S]*return null;/);
    for (const o of C.OVERLAYS) for (const k of ['still', 'clip']) if (o[k] !== undefined) {
      expect(typeof o[k]).toBe('string');
      expect(o[k]).not.toMatch(/^(?:https?:)?\/\//);
    }
  });
  it('the overlay cards are tagged [local] or [guild] and the badge text is honest', () => {
    const parts = code('web/app/eqmimic/_landing/Parts.tsx');
    expect(parts).toMatch(/scope === 'local'[\s\S]*\[local\][\s\S]*\[guild\]/);
    const gallery = parts.slice(parts.indexOf('export function OverlayGallery'), parts.indexOf('// ─── The ledger'));
    expect(gallery).toMatch(/<ScopeBadge scope=\{o\.scope\} \/>/);
    expect(gallery).toMatch(/\{OVERLAYS\.map\(o =>/);
  });
  it('the landing code fetches and embeds nothing external', () => {
    for (const rel of ['Parts.tsx', 'Landing.tsx', 'ScenarioPlayer.tsx']) {
      const src = code(`web/app/eqmimic/_landing/${rel}`);
      expect(src).not.toMatch(/<iframe|<script|\bfetch\(|youtube|vimeo/i);
    }
    // The one <img> is the gallery's guarded still; the player and the page have none.
    expect(player).not.toMatch(/<img\b/);
    expect(code('web/app/eqmimic/_landing/Landing.tsx')).not.toMatch(/<img\b/);
    expect(code('web/app/eqmimic/_landing/Parts.tsx').match(/<img\b/g)).toHaveLength(1);
  });
  it('the landing source is public-safe: no ids, tokens, addresses or project refs', () => {
    for (const rel of ['Parts.tsx', 'Landing.tsx', 'ScenarioPlayer.tsx']) {
      const src = read(`web/app/eqmimic/_landing/${rel}`);
      expect(src).not.toMatch(/\b\d{17,20}\b|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|zhtoekwakucbckvatfky|supabase\.co|eyJ[A-Za-z0-9_-]{10,}/);
    }
  });
});
