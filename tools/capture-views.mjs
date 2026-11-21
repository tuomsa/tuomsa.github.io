// Renders viewpoints of /workspace/executive-board/index.html headlessly and saves PNGs via GPU readback.
// Serve this folder on :8765 (python3 -m http.server 8765), npm i puppeteer-core, then:
// usage: node tools/capture-views.mjs 1,2,3 [outDir] [width] [height] [detail]
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const views = (process.argv[2] || '1').split(',');
const outDir = process.argv[3] || '/workspace/executive-board/shots';
const W = +(process.argv[4] || 1280), H = +(process.argv[5] || 720), detail = process.argv[6] || 'high';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 900000,
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'] });
for (const v of views) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);   // never reach the API or the Worker
  page.on('request', (r) => (/openrouter\.ai|\.workers\.dev/.test(r.url()) ? r.abort() : r.continue()));
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (!/favicon|404/.test(m.text())) console.log('  [console]', m.type(), m.text().slice(0, 400)); });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  const t0 = Date.now();
  await page.goto(`http://localhost:8765/index.html?offscreen&detail=${detail}#${v}`);
  await page.waitForFunction(() => (window.boardroom && window.boardroom.frames() > 2) || document.documentElement.className === 'broken', { timeout: 600000, polling: 500 });
  const broken = await page.evaluate(() => document.documentElement.className === 'broken' ? document.getElementById('status').textContent : '');
  if (broken) { console.log(`view ${v}: BROKEN: ${broken}`); await page.close(); continue; }
  const url = await page.evaluate(() => window.boardroom.capture(600000));
  const file = `${outDir}/view${v}.png`;
  writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`view ${v}: saved ${file} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.close();
}
await browser.close();
