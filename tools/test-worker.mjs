// unit test for worker/worker.js in Node: the upstream fetch is replaced by a stub, so nothing leaves this machine
// usage: node tools/test-worker.mjs
import worker from '../worker/worker.js';
const ORIGIN = 'https://me.github.io';
let upstreamCalls = [], fails = 0, upstream = { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'stub reply' } }] }) }, hang = false;
globalThis.fetch = async (url, init) => {
  upstreamCalls.push({ url, init });
  if (hang) return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': 'application/json' } });
};
const ok = (cond, label) => { console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}`); if (!cond) fails++; };
const env = { OPENROUTER_API_KEY1: 'test-secret-not-a-real-key', ALLOWED_ORIGIN: ORIGIN };
const post = (body, extra = {}, e = env) => worker.fetch(new Request('https://w.example/', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body) }), e);
const good = { model: 'openrouter/free', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'x'.repeat(3000) }], max_tokens: 999, temperature: 2, stream: true };

// fail closed on origin
let n = upstreamCalls.length;
let r = await post(good, {}, { OPENROUTER_API_KEY1: 'k' });
ok(r.status === 403 && !r.headers.get('Access-Control-Allow-Origin'), 'ALLOWED_ORIGIN unset: 403, no CORS header');
r = await post(good, { Origin: 'https://evil.example' });
ok(r.status === 403 && !r.headers.get('Access-Control-Allow-Origin'), 'wrong origin: 403, no CORS header');
r = await worker.fetch(new Request('https://w.example/', { method: 'POST', body: JSON.stringify(good) }), env);
ok(r.status === 403, 'no Origin header (curl and the like): 403');
const multi = { ...env, ALLOWED_ORIGIN: 'https://a.example, https://me.github.io' };
r = await post(good, {}, multi);
ok(r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === ORIGIN, 'comma-separated list: an exact entry passes, CORS echoes that one origin');
n = upstreamCalls.length;
ok((await post(good, { Origin: 'https://me.github.io/' }, multi)).status === 403, 'trailing slash is not the same origin: 403');
ok((await post(good, { Origin: 'http://me.github.io' }, multi)).status === 403, 'other scheme: 403');
ok((await post(good, { Origin: 'https://me.github.io.evil.example' }, multi)).status === 403, 'look-alike suffix: 403');
ok((await post(good, { Origin: 'null' }, { ...env, ALLOWED_ORIGIN: 'null' })).status === 403, "file:// pages (Origin 'null') never pass, even if listed");
ok(upstreamCalls.length === n, 'refused origins never reach upstream');

// the happy path
r = await post(good);
const sent = upstreamCalls.at(-1), sentBody = JSON.parse(sent.init.body);
ok(r.status === 200 && (await r.json()).choices[0].message.content === 'stub reply', 'forwards and streams back a successful body');
ok(r.headers.get('Access-Control-Allow-Origin') === ORIGIN, 'CORS echoes only the allowed origin');
ok(sent.url === 'https://openrouter.ai/api/v1/chat/completions', 'upstream is the OpenRouter chat endpoint');
ok(sent.init.headers.Authorization === 'Bearer test-secret-not-a-real-key' && sent.init.headers['X-Title'] === 'Executive Board', 'Bearer from env.OPENROUTER_API_KEY1 and X-Title');
ok(sentBody.max_tokens === 120 && sentBody.stream === false && sentBody.reasoning.enabled === false && !('temperature' in sentBody), 'max_tokens capped at 120, stream forced off, reasoning off, only checked fields');
const pre = await worker.fetch(new Request('https://w.example/', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env);
ok(pre.status === 204 && pre.headers.get('Access-Control-Allow-Origin') === ORIGIN, 'OPTIONS preflight: 204 with CORS for the allowed origin');

// input checks
n = upstreamCalls.length;
ok((await post({ ...good, model: 'openai/gpt-4o' })).status === 400, 'model not on the allow-list: 400');
ok((await post({ ...good, messages: Array(21).fill({ role: 'user', content: 'a' }) })).status === 400, 'more than 20 messages: 400');
ok((await post({ ...good, messages: [{ role: 'tool', content: 'a' }] })).status === 400, 'role outside system/user/assistant: 400');
r = await post({ ...good, messages: [{ role: 'user', content: 'y'.repeat(4001) }] });
ok(r.status === 400 && (await r.json()).error === 'message too long', 'content over 4000 chars: 400 (rejected, not sliced)');
ok((await post('{not json')).status === 400, 'invalid JSON: 400');
ok((await post({ ...good, messages: [{ role: 'user', content: 'y'.repeat(17000) }] })).status === 413, 'body over 16000 bytes: 413');
// a streamed body with no Content-Length: read in chunks, stopped right after the limit
let pulled = 0;
const big = new ReadableStream({ pull(c) { if (pulled >= 64000) return c.close(); pulled += 4000; c.enqueue(new Uint8Array(4000).fill(32)); } });
r = await worker.fetch(new Request('https://w.example/', { method: 'POST', headers: { Origin: ORIGIN }, body: big, duplex: 'half' }), env);
ok(r.status === 413 && pulled <= 20000, `streamed body: 413 after reading ${pulled} of 64000 bytes`);
ok((await worker.fetch(new Request('https://w.example/', { method: 'GET', headers: { Origin: ORIGIN } }), env)).status === 405, 'GET: 405');
ok(upstreamCalls.length === n, 'rejected requests never reach upstream');
r = await post(good, {}, { ALLOWED_ORIGIN: ORIGIN });
ok(r.status === 500 && (await r.json()).error === 'proxy misconfigured', 'missing secret: 500 {error: proxy misconfigured}');

// upstream errors: generic bodies, never echoed
for (const [status, expect] of [[429, 429], [401, 401], [402, 402], [500, 502], [404, 502]]) {
  upstream = { status, body: JSON.stringify({ error: { message: 'SECRET-UPSTREAM-DETAIL' } }) };
  r = await post(good);
  const text = await r.text();
  ok(r.status === expect && !text.includes('SECRET-UPSTREAM-DETAIL') && JSON.parse(text).error === 'upstream error' && JSON.parse(text).status === status,
    `upstream ${status}: ${expect} with a generic body (${text})`);
}
upstream = { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'stub reply' } }] }) };
// timeout: shortened by faking the clock is overkill; check the 18 s timer fires into a 504 using real timers
hang = true;
const t0 = Date.now();
r = await post(good);
ok(r.status === 504 && (await r.json()).error === 'upstream timeout', `upstream hangs: 504 after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
hang = false;
console.log(`worker tests: ${fails} failures (upstream stubbed, 0 network calls)`);
process.exit(fails ? 1 : 0);
