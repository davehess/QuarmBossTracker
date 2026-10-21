// Screenshots the ?v=b landing variant (desktop 1280 and phone 390) from a running web dev server, and reports any
// horizontal page scroll. node scripts/raidmimic-shots/page-shots.mjs <base-url> <out-dir>
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire((process.env.PLAYWRIGHT_MODULE_DIR || '/opt/node-tools/node_modules') + '/');
const { chromium } = require('playwright');
const [base = 'http://localhost:3111', out = '.'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
for (const [name, vp, dsf] of [['desktop', { width: 1280, height: 900 }, 1], ['phone', { width: 390, height: 844 }, 2]]) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: dsf });
  await page.goto(`${base}/raidmimic?v=b`, { waitUntil: 'networkidle' });
  // lazy images load as they scroll into view: walk the page once, then back to the top
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 500) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(120); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    imgs: [...document.images].filter(i => i.src.includes('/raidmimic/shots/')).map(i => [i.getAttribute('src'), i.complete && i.naturalWidth > 0, i.loading, i.width, i.height]),
  }));
  console.log(name, JSON.stringify(m));
  await page.screenshot({ path: path.join(out, `landing-b-${name}.png`), fullPage: true });
  await page.close();
}
await browser.close();
