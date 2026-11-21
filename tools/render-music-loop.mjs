// renders 2.5 loops of the band offline to review/music-loop-check.wav and writes the loop timing beside it
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 900000,
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setRequestInterception(true);
page.on('request', (r) => /openrouter\.ai|\.workers\.dev/.test(r.url()) ? r.abort() : r.continue());
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:8765/executive-board/index.html?offscreen&detail=low#1');
await page.waitForFunction(() => window.boardroom && window.boardroom.musicLoop, { timeout: 600000 });
const loop = await page.evaluate(() => window.boardroom.musicLoop());
const seconds = Math.ceil((loop.firstBar + loop.loopSeconds * 2.5) * 10) / 10;
const b64 = await page.evaluate((s) => window.boardroom.renderMusic(s), seconds);
writeFileSync(process.argv[2] || '/workspace/executive-board/review/music-loop-check.wav', Buffer.from(b64, 'base64'));
console.log(JSON.stringify({ ...loop, seconds }));
await browser.close();
