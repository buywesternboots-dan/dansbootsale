// Regenerates everything that shows the tool name WITHOUT JavaScript, from eBayBootSearch/config.js:
//   1. the <!--brand:start--> ... <!--brand:end--> block in eBayBootSearch/index.html (title, meta, OG tags)
//   2. the fallback text inside the sign/heading markup (so it is right even before brand.js runs)
//   3. eBayBootSearch/img/og.jpg (1200x630 link-preview image of the sign)
// The live banner itself is HTML/CSS and reads config.js directly, so it never needs this script.
// Usage: node scripts/build-banner.js [--shots DIR]     (needs puppeteer-core + Chrome; NODE_PATH ok)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..'), TOOL = path.join(ROOT, 'eBayBootSearch');
const sandbox = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(TOOL, 'config.js'), 'utf8'), sandbox);
const C = sandbox.window.BOOTSEARCH_CONFIG;
const name = C.toolName, sub = C.toolSubtitle, site = C.siteName;
if (/ebay/i.test(name)) throw new Error('toolName must not contain "eBay" (EPN naming rule)');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const words = name.trim().split(/\s+/), top = words.length >= 3 ? words[0] : '', main = words.length >= 3 ? words.slice(1).join(' ') : words.join(' ');
const base = 'https://www.dansbootsale.com';

let html = fs.readFileSync(path.join(TOOL, 'index.html'), 'utf8');
const block = `<!--brand:start (generated from config.js by scripts/build-banner.js; edit config.js, not this block) -->
<title>${esc(name)} – ${esc(sub)} | ${esc(site)}</title>
<meta name="description" content="${esc(name)}: build a detailed search for western boots by size, width, 190+ makers, condition and price. ${esc(sub)}; results open on eBay. Not affiliated with or endorsed by eBay.">
<link rel="canonical" href="${base}${C.shareUrl}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site)}">
<meta property="og:url" content="${base}${C.shareUrl}">
<meta property="og:title" content="${esc(name)}">
<meta property="og:description" content="${esc(sub)}. Find western boots by size, width, maker and more.">
<meta property="og:image" content="${base}/eBayBootSearch/img/og.jpg">
<meta property="og:image:alt" content="${esc(name)} sign. Boot search form for eBay listings.">
<meta name="twitter:card" content="summary_large_image">
<!--brand:end-->`;
html = html.replace(/<!--brand:start[\s\S]*?<!--brand:end-->/, block)
  .replace(/(<span id="signTop">)[^<]*(<\/span>)/, `$1${esc(top)}$2`)
  .replace(/(<div class="sign-main" id="signMain" aria-hidden="true">)[^<]*(<\/div>)/, `$1${esc(main)}$2`)
  .replace(/(<h1 class="sr-only" id="toolName">)[^<]*(<\/h1>)/, `$1${esc(name)}$2`)
  .replace(/(<p class="bs-sub" id="toolSub">)[^<]*(<\/p>)/, `$1${esc(sub)}$2`)
  .replace(/(<div class="sign" id="sign" role="img" aria-label=")[^"]*(")/, `$1${esc(name)} (sign)$2`);
fs.writeFileSync(path.join(TOOL, 'index.html'), html);
console.log('index.html brand block updated for', JSON.stringify(name));

(async () => {
  const puppeteer = require('puppeteer-core');
  const port = 8000 + Math.floor(Math.random() * 900);
  const srv = spawn(process.execPath, [path.join(__dirname, 'dev-server.js'), String(port)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 700));
  const shotsIdx = process.argv.indexOf('--shots'), SHOTS = shotsIdx > 0 ? process.argv[shotsIdx + 1] : '';
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const url = `http://localhost:${port}${C.shareUrl}`;
    // link-preview image: the sign alone, centered on the tan band, 1200x630
    await page.setViewport({ width: 1200, height: 630 });
    await page.goto(url, { waitUntil: 'networkidle0' }); await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
      document.body.innerHTML = ''; document.body.style.margin = 0;
      const h = document.createElement('div'); h.className = 'bs-hero';
      h.style.cssText = 'height:630px;align-items:center;padding:0 60px;flex-direction:column;justify-content:center;gap:22px';
      h.innerHTML = `<div class="sign" id="sign" style="width:1000px;padding:30px 50px 26px">
        <div class="sign-top" id="signTopRow" style="font-size:52px"><i class="flour" style="flex-basis:200px"></i><span id="signTop"></span><i class="flour r" style="flex-basis:200px"></i></div>
        <div class="sign-main" id="signMain" style="font-size:128px;-webkit-text-stroke:5px var(--red)"></div>
        <div class="sign-bot" style="font-size:30px"><i class="star">&#9733;</i><i class="rule" style="flex-basis:600px;height:3px"></i><i class="star">&#9733;</i></div></div>
        <p class="bs-sub" id="toolSub" style="font-size:30px"></p>`;
      document.body.appendChild(h);
      const C = window.BOOTSEARCH_CONFIG, w = C.toolName.trim().split(/\s+/);
      document.getElementById('signTop').textContent = w.length >= 3 ? w[0] : '';
      document.getElementById('signTopRow').hidden = w.length < 3;
      document.getElementById('signMain').textContent = w.length >= 3 ? w.slice(1).join(' ') : w.join(' ');
      document.getElementById('toolSub').textContent = C.toolSubtitle;
      const m = document.getElementById('signMain'); let s = 128; while (m.scrollWidth > 900 && s > 30) { s -= 2; m.style.fontSize = s + 'px'; }
    });
    fs.mkdirSync(path.join(TOOL, 'img'), { recursive: true });
    await page.screenshot({ path: path.join(TOOL, 'img', 'og.jpg'), type: 'jpeg', quality: 88 });
    console.log('wrote eBayBootSearch/img/og.jpg');
    if (SHOTS) {
      for (const [vp, w] of [['desktop', 1280], ['mobile', 390]]) {
        await page.setViewport({ width: w, height: 800, deviceScaleFactor: vp === 'mobile' ? 2 : 1 });
        await page.goto(url, { waitUntil: 'networkidle0' }); await page.evaluate(() => document.fonts.ready);
        const el = await page.evaluate(() => { const a = document.querySelector('.bs-hero').getBoundingClientRect(), b = document.querySelector('.bs-titlebar').getBoundingClientRect(); return { x: 0, y: 0, width: innerWidth, height: b.bottom + 4 }; });
        await page.screenshot({ path: path.join(SHOTS, `banner-after-${vp}.png`), clip: el });
      }
      console.log('wrote banner screenshots to', SHOTS);
    }
  } finally { await browser.close(); srv.kill(); }
})().catch(e => { console.error(e); process.exit(1); });
