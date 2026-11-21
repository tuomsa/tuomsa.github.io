// boots index.html under its Content-Security-Policy and reports any violation: WebGPU frames, a mock round, the
// music (a real click), fonts. Requests to openrouter.ai and *.workers.dev are aborted.
// usage: node tools/test-csp.mjs   (needs `python3 -m http.server 8765 --directory /workspace`)
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 900000,
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
let blocked = 0, fails = 0, errors = [];
await page.setRequestInterception(true);
page.on('request', (r) => { if (/openrouter\.ai|\.workers\.dev/.test(r.url())) { blocked++; r.abort(); } else r.continue(); });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {   // the local test server has no favicon; that 404 is not the page's
  if (m.type() === 'error' && !/favicon\.ico$/.test(m.location()?.url || '')) errors.push(m.text().slice(0, 200));
});
await page.evaluateOnNewDocument(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
});
const ok = (c, l) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${l}`); if (!c) fails++; };
await page.goto('http://localhost:8765/executive-board/index.html?offscreen&detail=low#1');
const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '');
ok(/connect-src https:\/\/frosty-cherry-5715\.tuomashiljanen\.workers\.dev/.test(csp) && /default-src 'self'/.test(csp), 'CSP meta present, connect-src is only the Worker');
await page.waitForFunction(() => window.boardroom && window.boardroom.frames() > 3, { timeout: 600000, polling: 200 });
ok(true, 'WebGPU boots and renders frames');
await page.mouse.click(480, 270); await new Promise((d) => setTimeout(d, 1200));
const m = await page.evaluate(() => window.boardroom.music());
ok(m.context === 'running' && m.ticking, `audio runs under the CSP ${JSON.stringify(m)}`);
const before = await page.evaluate(() => window.boardroom.sessionRounds());
await page.evaluate(() => window.boardroom.ask('A rooftop garden for the staff'));
await page.waitForFunction((n) => window.boardroom.sessionRounds() > n && !window.boardroom.busy?.(), { timeout: 600000, polling: 500 }, before).catch(() => {});
const lines = await page.evaluate(() => [...document.querySelectorAll('.bubble .say')].map((b) => b.textContent).filter(Boolean));
ok(lines.length >= 1, `a mock round runs (${lines.length} bubbles with text)`);
const fonts = await page.evaluate(async () => { await document.fonts.ready; return { status: document.fonts.status, family: getComputedStyle(document.body).fontFamily.slice(0, 60) }; });
ok(fonts.status === 'loaded', `fonts ready (${fonts.family})`);
const violations = await page.evaluate(() => window.__csp);
ok(violations.length === 0, `no CSP violations ${JSON.stringify(violations)}`);
ok(errors.length === 0, `no page errors ${JSON.stringify(errors)}`);
await browser.close();
console.log(`requests to openrouter.ai / workers.dev aborted: ${blocked} | failures: ${fails}`);
process.exit(fails ? 1 : 0);
