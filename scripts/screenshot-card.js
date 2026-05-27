// Renders promo-card.html to a PNG using Playwright
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  const htmlPath = path.join(__dirname, 'promo-card.html');
  await page.setViewportSize({ width: 964, height: 1200 });
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle' });

  // Measure actual card height after layout
  const cardHeight = await page.evaluate(() => {
    const card = document.querySelector('.card');
    const body = document.querySelector('body');
    return body.scrollHeight;
  });

  await page.setViewportSize({ width: 964, height: cardHeight + 64 });

  const outPath = path.join(__dirname, 'wolfpack-logsync-promo.png');
  await page.screenshot({ path: outPath, fullPage: true });
  console.log('Saved:', outPath);

  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
