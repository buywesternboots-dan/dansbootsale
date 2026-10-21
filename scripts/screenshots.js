import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.BASE || 'http://127.0.0.1:4173';
const out = '/opt/cursor/artifacts/screenshots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/local/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});
const widths = [360, 768, 1280, 1920];

async function shoot(page, name) {
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const offenders = [...document.querySelectorAll('body *')].filter(el => el.scrollWidth > doc.clientWidth + 2 && el.clientWidth > 0).slice(0, 6).map(el => el.className || el.tagName);
    return { scroll: doc.scrollWidth, client: doc.clientWidth, offenders };
  });
  if (overflow.scroll > overflow.client + 1) {
    console.log('OVERFLOW', name, overflow);
  } else {
    console.log('ok', name, overflow.client);
  }
}

const context = await browser.newContext();
const page = await context.newPage();
await page.goto(base + '/?demo=1', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.card', { timeout: 15000 });
const bootHref = await page.locator('.card').first().getAttribute('href');

for (const width of widths) {
  await page.setViewportSize({ width, height: width < 800 ? 780 : 1000 });
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.card', { timeout: 15000 });
  await page.waitForFunction(() => {
    const img = document.querySelector('.card img');
    return img && img.complete && img.naturalWidth > 0;
  }, { timeout: 20000 }).catch(() => {});
  await shoot(page, `home-${width}`);
  if (width === 360) {
    await page.getByRole('button', { name: 'Filters' }).click();
    await page.waitForTimeout(400);
    await shoot(page, 'filters-360');
    await page.getByRole('button', { name: 'Done' }).click();
  }
  await page.goto(base + bootHref, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app h1', { timeout: 15000 });
  await page.waitForFunction(() => {
    const img = document.querySelector('#app .gmain img');
    return img && img.complete && img.naturalWidth > 0;
  }, { timeout: 20000 }).catch(() => {});
  await shoot(page, `boot-${width}`);
}

await page.setViewportSize({ width: 1280, height: 900 });
for (const path of ['/how', '/privacy', '/admin', '/corral', '/boot-search']) {
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await shoot(page, path.replace(/\//g, '') || 'page');
}
await page.setViewportSize({ width: 320, height: 700 });
await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
await shoot(page, 'home-320');
await browser.close();
console.log('screenshots written', out);
