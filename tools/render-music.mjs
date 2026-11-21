// renders 20 s of the lounge band with OfflineAudioContext to review/music-sample.wav (needs a local server on :8765)
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 900000,
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setRequestInterception(true);
page.on('request', (r) => /openrouter\.ai|\.workers\.dev/.test(r.url()) ? r.abort() : r.continue());
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:8765/executive-board/index.html?offscreen&detail=low#1');
await page.waitForFunction(() => window.boardroom && window.boardroom.frames() > 0, { timeout: 600000, polling: 300 });
const t0 = Date.now();
const b64 = await page.evaluate(() => window.boardroom.renderMusic(20));
const out = process.argv[2] || '/workspace/executive-board/review/music-sample.wav';
writeFileSync(out, Buffer.from(b64, 'base64'));
console.log('rendered', out, 'in', ((Date.now() - t0) / 1000).toFixed(1), 's');
await browser.close();
