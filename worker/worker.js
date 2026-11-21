// Executive Board AI proxy (Cloudflare Worker). The page POSTs { model, messages, max_tokens, reasoning } here; this
// Worker checks it, adds the OpenRouter key from the secret OPENROUTER_API_KEY1 and forwards it to OpenRouter. The key
// never reaches the browser.
//
// Required secret: OPENROUTER_API_KEY1 (npx wrangler secret put OPENROUTER_API_KEY1)
// Required var:    ALLOWED_ORIGIN, your site's exact origin, e.g. https://you.github.io (scheme, no path, no trailing
//                  slash), or several separated by commas. Without it every request gets a 403 (fail closed). Origin is only a browser-side guard: other clients can fake it, so also keep a
//                  rate-limit rule on this Worker and a spend cap on the OpenRouter key.

const UPSTREAM = 'https://openrouter.ai/api/v1/chat/completions';
const MODELS = new Set(['openrouter/free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'google/gemma-4-31b-it:free']);
const ROLES = new Set(['system', 'user', 'assistant']);
const MAX_BODY_BYTES = 16000;
const MAX_MESSAGES = 20;
const MAX_CONTENT_CHARS = 4000;
const MAX_TOKENS = 120;
const UPSTREAM_TIMEOUT_MS = 18000;
const PASS_THROUGH = new Set([401, 402, 429]);   // statuses the page acts on (stop or try the next model)

// ALLOWED_ORIGIN -> a list of exact origins; 'null' (file:// pages, sandboxed frames) is never accepted
function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGIN || '').split(',').map((o) => o.trim()).filter((o) => o && o !== 'null');
}

// a JSON answer from the Worker itself
function out(status, obj, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

// reads the body as a stream and gives up as soon as it passes the limit (null = too large)
async function readLimited(request, limit) {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return all;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    // fail closed: no configured origin, or one that is not exactly on the list, gets nothing (and no CORS headers)
    if (!origin || !allowedOrigins(env).includes(origin)) return out(403, { error: 'origin not allowed' });
    const headers = {
      'Access-Control-Allow-Origin': origin,   // exactly the caller's origin, which is on the list
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return out(405, { error: 'POST only' }, { ...headers, Allow: 'POST, OPTIONS' });
    if (!env.OPENROUTER_API_KEY1) return out(500, { error: 'proxy misconfigured' }, headers);

    const declared = Number(request.headers.get('Content-Length') || 0);
    if (declared > MAX_BODY_BYTES) return out(413, { error: 'body too large' }, headers);
    const raw = await readLimited(request, MAX_BODY_BYTES);
    if (raw === null) return out(413, { error: 'body too large' }, headers);

    let body;
    try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return out(400, { error: 'invalid JSON' }, headers); }
    if (!body || typeof body !== 'object') return out(400, { error: 'invalid body' }, headers);
    if (!MODELS.has(body.model)) return out(400, { error: 'model not allowed' }, headers);
    if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
      return out(400, { error: 'messages must be 1 to 20 items' }, headers);
    }
    const messages = [];
    for (const m of body.messages) {
      if (!m || !ROLES.has(m.role) || typeof m.content !== 'string') return out(400, { error: 'bad message' }, headers);
      if (m.content.length > MAX_CONTENT_CHARS) return out(400, { error: 'message too long' }, headers);
      messages.push({ role: m.role, content: m.content });
    }
    const asked = Number(body.max_tokens);
    const maxTokens = Number.isFinite(asked) && asked > 0 ? Math.min(Math.floor(asked), MAX_TOKENS) : MAX_TOKENS;

    // only the checked fields go upstream, never streamed
    const stop = new AbortController(), timer = setTimeout(() => stop.abort(), UPSTREAM_TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetch(UPSTREAM, {
        method: 'POST', signal: stop.signal,
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY1}`,
          'Content-Type': 'application/json',
          'X-Title': 'Executive Board',
        },
        body: JSON.stringify({ model: body.model, messages, max_tokens: maxTokens, stream: false, reasoning: { enabled: false } }),
      });
    } catch {
      clearTimeout(timer);
      return stop.signal.aborted ? out(504, { error: 'upstream timeout' }, headers) : out(502, { error: 'upstream error' }, headers);
    }
    if (!upstream.ok) {
      // never echo OpenRouter's error body; keep only the statuses the page acts on
      clearTimeout(timer);
      upstream.body?.cancel().catch(() => {});
      const status = PASS_THROUGH.has(upstream.status) ? upstream.status : 502;
      return out(status, { error: 'upstream error', status: upstream.status }, headers);
    }
    // stream the successful body back with the same status (the timeout still covers the body)
    const { readable, writable } = new TransformStream();
    upstream.body.pipeTo(writable).catch(() => {}).finally(() => clearTimeout(timer));
    return new Response(readable, {
      status: upstream.status,
      headers: { ...headers, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
    });
  },
};
