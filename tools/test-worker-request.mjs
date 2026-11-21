// checks the page's AI request in a headless browser without any network: a test copy of index.html gets a fake
// WORKER_URL, every request to it is answered by this script, and anything else external is aborted.
// usage: node tools/test-worker-request.mjs   (needs `python3 -m http.server 8765 --directory /workspace`)
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const SRC = new URL('../index.html', import.meta.url);
const FAKE = 'https://test-worker.example.workers.dev';
mkdirSync('/workspace/build/wtest', { recursive: true });
const html = readFileSync(SRC, 'utf8');
// whatever URL the page holds (the placeholder or a real Worker) is swapped in the test copies, so this test never
// reaches a real Worker; requests to any other host are aborted and counted below
const urlLine = /const WORKER_URL = '[^'\n]*';/;
if (!urlLine.test(html)) throw new Error('WORKER_URL line not found');
// the page's CSP allows only its own Worker, so the copies get the same URL in connect-src
const setUrl = (h, url) => h.replace(urlLine, `const WORKER_URL = '${url}';`).replace(/connect-src [^;"]+/, `connect-src ${url}`);
// the page script is a module, so the test copies (never the shipped page) expose two functions on window
const expose = (h) => h.replace(/<\/script>(?![\s\S]*<\/script>)/, 'window.__t = { askModels, holdRound };\n</script>');
writeFileSync('/workspace/build/wtest/placeholder.html', expose(setUrl(html, 'https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev')));
writeFileSync('/workspace/build/wtest/index.html', expose(setUrl(html, FAKE)));

let fails = 0; const ok = (c, l) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${l}`); if (!c) fails++; };
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 600000,
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'] });
let seen = [], openrouter = 0, external = 0, nextStatus = 200;
async function open(path) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const url = r.url();
    if (url.includes('openrouter')) { openrouter++; return r.abort(); }
    if (url.startsWith(FAKE)) {
      seen.push({ method: r.method(), headers: r.headers(), body: r.postData() });
      if (r.method() === 'OPTIONS') return r.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
      const status = nextStatus;
      return r.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
        body: status === 200 ? JSON.stringify({ choices: [{ message: { content: 'Bold plan, show me numbers.' } }] }) : JSON.stringify({ error: { message: 'x' } }) });
    }
    if (!url.startsWith('http://localhost:8765/')) { external++; return r.abort(); }   // incl. the real *.workers.dev
    r.continue();
  });
  // these pages run without ?offscreen (mock mode would skip the network code), and headless SwiftShader cannot
  // upload canvas images to a presented WebGPU context; that one error is the headless setup, not the page
  page.on('pageerror', (e) => {
    if (/copyExternalImageToTexture/.test(e.message)) { console.log('  (headless-only, ignored)', e.message); return; }
    console.log('pageerror', e.message); fails++;
  });
  await page.goto(`http://localhost:8765/${path}`);
  await page.waitForFunction(() => window.__t && typeof window.__t.askModels === 'function', { timeout: 120000 });
  return page;
}
const ask = (page) => page.evaluate(async () => {
  const a = await window.__t.askModels([{ role: 'system', content: 'test' }, { role: 'user', content: 'MESSAGE START\nhi\nMESSAGE END' }], 'CEO');
  return typeof a === 'string' ? { line: a } : a;
});

// 1. a fresh copy (WORKER_URL still the placeholder): a friendly message and no request at all
let page = await open('build/wtest/placeholder.html');
ok(await page.evaluate(() => /connect-src https:\/\/YOUR-WORKER/.test(document.querySelector('meta[http-equiv="Content-Security-Policy"]').content)), 'test copies carry their own URL in the CSP');
let a = await ask(page);
ok(a && a.stopRound && a.message === 'Set WORKER_URL in index.html to your Cloudflare Worker.' && seen.length === 0, `placeholder: friendly message, no request (${JSON.stringify(a)})`);
await page.waitForFunction(() => document.querySelectorAll('.bubble').length === 5, { timeout: 300000, polling: 200 });   // main() built the bubbles
const said = await page.evaluate(async () => {
  await window.__t.holdRound('test idea').catch((e) => 'err ' + e.name);
  return [...document.querySelectorAll('.bubble, [class*="bubble"]')].map((b) => b.textContent).join(' | ');
});
ok(/Set WORKER_URL in index\.html to your Cloudflare Worker/.test(said) && seen.length === 0, `a round shows the setup message in a bubble, no request ("${said.slice(0, 120)}")`);
await page.close();

// 2. a test copy with a Worker URL: the request goes there, JSON only, no Authorization, no key
page = await open('build/wtest/index.html');
seen = []; nextStatus = 200;
a = await ask(page);
const post = seen.find((s) => s.method === 'POST'), body = post ? JSON.parse(post.body) : {};
ok(a.line === 'Bold plan, show me numbers.', 'a 200 from the Worker becomes the reply');
ok(!!post && !('authorization' in post.headers) && /application\/json/.test(post.headers['content-type'] || ''), `POST to WORKER_URL with Content-Type JSON and no Authorization (headers: ${post ? Object.keys(post.headers).join(',') : 'none'})`);
const keyPrefix = new RegExp(['sk', 'or', ''].join('-'));   // OpenRouter key prefix, built so this file never contains it
ok(!keyPrefix.test(post.body) && !Object.values(post.headers).some((v) => keyPrefix.test(v) || /Bearer/i.test(v)), 'no key or Bearer anywhere in the request');
ok(body.model === 'openrouter/free' && Array.isArray(body.messages) && body.max_tokens === 80 && body.reasoning && body.reasoning.enabled === false, `body: model, messages, max_tokens, reasoning off (${Object.keys(body).join(',')})`);
for (const [status, re] of [[403, /ALLOWED_ORIGIN/], [401, /refused/], [402, /credit/], [413, /too large/], [400, /rejected/]]) {
  seen = []; nextStatus = status;
  a = await ask(page);
  ok(a && a.stopRound && re.test(a.message) && seen.filter((s) => s.method === 'POST').length === 1, `${status}: no retry, message "${a && a.message}"`);
}
seen = []; nextStatus = 429;
a = await page.evaluate(async () => { const t = Date.now(); const r = await window.__t.askModels([{ role: 'user', content: 'x' }], 'CEO'); return { r, ms: Date.now() - t }; });
const posts = seen.filter((s) => s.method === 'POST').map((s) => JSON.parse(s.body).model);
ok(a.r === null && posts.length === 5 && new Set(posts).size === 3, `429: retries across the fallback models, then gives up (${posts.join(' > ')})`);
await page.close();
await browser.close();
console.log(`requests to openrouter.ai: ${openrouter} | other external requests aborted: ${external} | failures: ${fails}`);
process.exit(fails ? 1 : 0);
