// Verification captures for the board round. Runs headless Chrome on a software WebGPU adapter.
// Every page is opened with ?offscreen (which also forces the canned "mock" board replies) and any request to
// openrouter.ai is aborted as a second guard, so these captures never use the API.
// usage: node capture-board.mjs <outDir>     (expects the page served at http://localhost:8765/executive-board/)
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const outDir = process.argv[2] || 'shots';
const W = 1280, H = 720;
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 900000,
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'] });
let blocked = 0;

async function open(hash) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on('request', (r) => { if (/openrouter\.ai|\.workers\.dev/.test(r.url())) { blocked++; r.abort(); } else r.continue(); });
  page.on('console', (m) => { if (!/favicon|404/.test(m.text())) console.log('  [console]', m.type(), m.text().slice(0, 200)); });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.goto(`http://localhost:8765/executive-board/index.html?offscreen&detail=high${hash}`);
  await page.waitForFunction(() => (window.boardroom && window.boardroom.frames() > 2) || document.documentElement.classList.contains('broken'), { timeout: 600000, polling: 500 });
  return page;
}
const gpu = async (page, file) => {
  const url = await page.evaluate(() => window.boardroom.capture(600000));
  writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log('saved', file);
};
// the HTML overlay alone, on a transparent background, to lay over the GPU frame afterwards
const overlay = async (page, file) => {
  await page.evaluate(() => { document.documentElement.style.background = 'transparent'; document.body.style.background = 'transparent'; });
  await page.screenshot({ path: file, omitBackground: true });
  console.log('saved', file);
};
const which = process.argv[3] || 'devil,seat,round,tail';

for (const job of which.split(',')) {
  const t0 = Date.now();
  if (job === 'devil' || job === 'tail') {
    const page = await open(job === 'devil' ? '#7' : '#8');
    await page.evaluate(() => window.boardroom.snapGaze());
    await page.waitForFunction((n) => window.boardroom.frames() > n, { timeout: 600000, polling: 500 }, await page.evaluate(() => window.boardroom.frames()) + 1);
    await gpu(page, `${outDir}/${job}.gpu.png`);
    await page.close();
  } else if (job === 'seat') {
    const page = await open('#seat');
    await page.evaluate(() => window.boardroom.snapGaze());
    await page.waitForFunction(() => window.boardroom.mode() === 'seated', { timeout: 600000, polling: 500 });
    await gpu(page, `${outDir}/seat.gpu.png`);
    await overlay(page, `${outDir}/seat.dom.png`);
    await page.close();
  } else if (job === 'coffee') {
    // a coffee-break round, then every cup lifted to the lips for the frame
    const page = await open('#seat');
    await page.evaluate(() => { window.boardroom.snapGaze(); window.boardroom.bubbleLife(3600000); window.boardroom.coffee(true); });
    await page.waitForFunction(() => window.boardroom.mode() === 'seated', { timeout: 600000, polling: 500 });
    await page.type('#idea', 'I found a great guide to fixing a squeaky bike brake');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('send').disabled, { timeout: 600000, polling: 300 });
    await page.evaluate(() => { window.boardroom.sip(1); window.boardroom.speaker(-1); document.getElementById('yourIdea').classList.add('show'); });
    const f = await page.evaluate(() => window.boardroom.frames());
    await page.waitForFunction((n) => window.boardroom.frames() > n, { timeout: 600000, polling: 500 }, f + 1);
    console.log(await page.evaluate(() => [...document.querySelectorAll('.bubble .say')].map((e) => e.textContent).join(' | ')));
    await gpu(page, `${outDir}/coffee.gpu.png`);
    await overlay(page, `${outDir}/coffee.dom.png`);
    await page.close();
  } else if (job === 'wall') {
    // two quick rounds (one meeting, one coffee break) whose bubbles expire onto the idea wall
    const page = await open('#seat');
    await page.evaluate(() => { window.boardroom.snapGaze(); window.boardroom.bubbleLife(4000); });
    await page.waitForFunction(() => window.boardroom.mode() === 'seated', { timeout: 600000, polling: 500 });
    for (const [text, coffee] of [['Replace all meetings with a weekly ten minute stand up on the roof terrace', false], ['Has anyone tried the new ramen place downstairs, the broth is amazing', true]]) {
      await page.evaluate((c) => window.boardroom.coffee(c), coffee);
      await page.type('#idea', text);
      await page.keyboard.press('Enter');
      await new Promise((d) => setTimeout(d, 500));
      await page.waitForFunction(() => !document.getElementById('send').disabled, { timeout: 600000, polling: 300 });
    }
    // another round on the same topic (no new input), via the Another round button (seated actions are buttons only)
    await page.click('#againButton');
    await new Promise((d) => setTimeout(d, 500));
    await page.waitForFunction(() => !document.getElementById('send').disabled, { timeout: 600000, polling: 300 });
    const msgs = await page.evaluate(() => window.boardroom.mockMessages());
    console.log('last request layout:', msgs.map((m) => m.role).join(','));
    msgs.forEach((m, k) => console.log(`  [${k}] ${m.role}: ${m.content.replace(/\n/g, ' / ').slice(0, 230)}`));
    console.log('continued bubbles:', await page.evaluate(() => [...document.querySelectorAll('.bubble .say')].map((e) => e.textContent).join(' | ')));
    await page.evaluate(() => window.boardroom.retire());
    // seated, turned toward the wall
    await page.evaluate(() => window.boardroom.turn(-1.22, 0.06));
    let f = await page.evaluate(() => window.boardroom.frames());
    await page.waitForFunction((n) => window.boardroom.frames() > n, { timeout: 600000, polling: 500 }, f + 1);
    await gpu(page, `${outDir}/seatwall.gpu.png`);
    await overlay(page, `${outDir}/seatwall.dom.png`);
    // close up
    await page.evaluate(() => window.boardroom.view(9));
    f = await page.evaluate(() => window.boardroom.frames());
    await page.waitForFunction((n) => window.boardroom.frames() > n, { timeout: 600000, polling: 500 }, f + 1);
    await gpu(page, `${outDir}/wall.gpu.png`);
    // the readable list (E)
    await page.evaluate(() => window.boardroom.wall(true));
    await overlay(page, `${outDir}/wallpanel.dom.png`);
    await page.close();
  } else if (job === 'round') {
    const page = await open('#seat');
    await page.evaluate(() => { window.boardroom.snapGaze(); window.boardroom.bubbleLife(3600000); });
    await page.waitForFunction(() => window.boardroom.mode() === 'seated', { timeout: 600000, polling: 500 });
    await page.type('#idea', 'A four day work week for the whole company');
    await page.keyboard.press('Enter');
    const said = await page.evaluate(() => new Promise((done) => {
      const poll = setInterval(() => { if (!document.getElementById('send').disabled) { clearInterval(poll); done(1); } }, 300);
    }));
    // freeze on the devil as the speaker so the gaze shows "everyone looks at him", then a frame or two to apply it
    await page.evaluate(() => { window.boardroom.speaker(4); });
    const f = await page.evaluate(() => window.boardroom.frames());
    await page.waitForFunction((n) => window.boardroom.frames() > n, { timeout: 600000, polling: 500 }, f + 1);
    // re-show the visitor's line so it is visible in the same frame as the bubbles
    await page.evaluate(() => document.getElementById('yourIdea').classList.add('show'));
    const texts = await page.evaluate(() => [...document.querySelectorAll('.bubble')].map((b) => `${b.querySelector('b').textContent}: ${b.querySelector('.say').textContent} [${b.className}]`));
    console.log(texts.join('\n'));
    await gpu(page, `${outDir}/round.gpu.png`);
    await overlay(page, `${outDir}/round.dom.png`);
    await page.close();
  }
  console.log(job, 'done in', ((Date.now() - t0) / 1000).toFixed(1), 's');
}
console.log('requests to openrouter.ai blocked:', blocked);
await browser.close();
