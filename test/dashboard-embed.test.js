// The dashboard slice (Decision #3, docs/ARCHITECT-REBUILD-2026-08-16.md):
// packages/wolfpack-logsync/dashboard.html is AUTHORED; the WEB_HTML literal
// in the agent is GENERATED from it by scripts/sync-dashboard-embed.js. The
// shipped artifact is still the single committed index.js, so the fleet's
// raw-fetch update chain is untouched — only authoring changed.
//
// What this retires: the escape-hazard class. Two blank dashboards shipped
// (v2.4.25 bare \n, v2.4.27 bare \'), and it bit twice more in 2026-08-29..30
// (a bare \n; a backtick inside a COMMENT terminating the literal). Proven
// dead at ship time: all three killers authored naively in dashboard.html,
// folded, served byte-correct.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { AGENT_INDEX, readSource, stripJs } from './_source-slice.js';

const require2 = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(AGENT_INDEX), '..', '..');
const sync = require2(path.join(ROOT, 'scripts', 'sync-dashboard-embed.js'));
const agentSrc = readSource(AGENT_INDEX);
const html = fs.readFileSync(sync.HTML, 'utf8');

describe('dashboard embed', () => {
  it('WEB_HTML is exactly the machine fold of dashboard.html', () => {
    // The load-bearing invariant: the .html is authoritative, the literal is
    // build output. Checked with the SAME transform the sync tool uses, so the
    // gate and the generator cannot disagree.
    const region = sync.literalRegion(agentSrc);
    expect(region).not.toBeNull();
    const actual = agentSrc.slice(region[0], region[1]);
    expect(actual.length).toBe(sync.buildLiteral(html).length);
    expect(actual).toBe(sync.buildLiteral(html));
  });

  it('the generated region carries its do-not-edit banner', () => {
    expect(agentSrc).toMatch(/GENERATED — do not edit this literal[\s\S]{0,400}const WEB_HTML = `/);
  });

  it('agent-side interpolations use {{WP:...}} — never bare ${} in the html', () => {
    // ${} in the .html can be page CONTENT (it is, once, in prose), so it can
    // never be trusted to mean "agent code". The distinct syntax is the fence.
    const interps = html.match(/\{\{WP:[\s\S]*?\}\}/g) || [];
    expect(interps.length).toBeGreaterThanOrEqual(7);
    for (const i of interps) expect(i).not.toMatch(/\n/);   // one-line exprs only
    // ...and every one survives into the literal as a real interpolation
    const lit = sync.buildLiteral(html);
    expect((lit.match(/(?<!\\)\$\{/g) || []).length).toBe(interps.length);
  });

  it('folds the three historical page-killers without breaking the page', () => {
    // backtick in a comment, ${} in text, bare \n in a browser string — each
    // shipped or nearly shipped a blank dashboard when escaped by hand.
    const naughty = html.replace('<script>',
      "<script>\n// hazard ` probe ${} here\nvar wpP = 'a\\nb';\n");
    const lit = sync.buildLiteral(naughty);
    const value = new Function('AGENT_VERSION', 'BACKUP_KEEP', 'process',
      'return `' + lit + '`')('t', 1, { env: {} });
    expect(value).toContain('hazard ` probe ${} here');
    expect(value).toContain("var wpP = 'a\\nb';");
  });

  it('refuses the sentinel character rather than corrupting silently', () => {
    expect(() => sync.buildLiteral('x\x01y')).toThrow(/sentinel/);
  });

  it('the drift gate runs inside check:dashboard, sharing the sync transform', () => {
    const checker = stripJs(readSource(path.join(ROOT, 'scripts', 'check-agent-dashboard.js')));
    expect(checker).toMatch(/require\('\.\/sync-dashboard-embed\.js'\)/);
    // the CALL, not the definition — unwiring the gate leaves the function
    // behind, and a definition-only match waved that mutation through
    expect(checker).toMatch(/if \(checkDashboardDrift\(\) > 0\) process\.exit\(1\)/);
  });
});
