# Executive Board AI Worker

A small Cloudflare Worker that keeps the OpenRouter key off the page. The page posts the board's requests to
this Worker. The Worker:
- checks the origin;
- checks the request: allowed models only, at most 20 messages of at most 4,000 characters each, and a body of
  at most 16,000 bytes read as a stream;
- caps replies at 120 tokens and forces `stream: false` and reasoning off;
- adds the key from a Worker secret and forwards the request to OpenRouter with an 18 s timeout.

It **fails closed**: with no `ALLOWED_ORIGIN`, or a different origin, every request gets a 403 and nothing goes
upstream.

## Required setup
All five are needed:
1. **Deploy**, from this folder: `npx wrangler deploy`.
   Or, in the dashboard, go to Workers & Pages → Create → Worker and upload or paste `worker.js`. If you deploy from
   the dashboard, the Worker's name need not match `wrangler.toml`.
2. **Secret `OPENROUTER_API_KEY1`:** run `npx wrangler secret put OPENROUTER_API_KEY1` and paste the key when asked.
   In the dashboard: Settings → Variables and Secrets → add a **Secret**. Never put the key in a file.
3. **Variable `ALLOWED_ORIGIN`:** your GitHub Pages origin, e.g. `https://<user>.github.io`, exactly, with no path
   and no trailing slash. A comma-separated list is allowed. Without it the Worker refuses everything. See the
   step-by-step below.
4. **A rate-limit rule:** about 30 POST requests a minute per IP on the Worker's route. In the dashboard: Security →
   WAF → Rate limiting rules.
5. **A spend cap on the OpenRouter key:** in OpenRouter's key settings, give this key a small credit limit.

The `Origin` check only stops other websites in a browser. Scripts and tools outside a browser can send any
`Origin` header they like, so the rate limit and the spend cap are what actually bound the cost.

### Setting `ALLOWED_ORIGIN` (required)
In the Cloudflare dashboard:
1. Open **Workers & Pages** and click your Worker.
2. Open **Settings**, then **Variables and Secrets**, then click **Add**.
3. Choose type **Text**. The name is `ALLOWED_ORIGIN`.
4. The value is your site's exact origin: the scheme and host only, with no path and no trailing slash, e.g.
   `https://name.github.io`. For a project site at `https://name.github.io/repo/`, the origin is still
   `https://name.github.io`. To allow several, separate them with commas:
   `https://name.github.io,http://localhost:8000`.
5. Click **Deploy** (or **Save and deploy**).

Or, with wrangler, put it in `wrangler.toml` and run `npx wrangler deploy`:
```toml
[vars]
ALLOWED_ORIGIN = "https://name.github.io"
```

Good to know:
- **Fail closed:** until `ALLOWED_ORIGIN` is set, the Worker answers 403 to everything, and the board shows
  "The Worker refused this page. Check ALLOWED_ORIGIN."
- **Exact match:** `https://name.github.io/` (with a slash), `http://` instead of `https`, or another subdomain
  are all different origins and get a 403.
- **Local testing:** a page opened as `file://` has no origin (the browser sends `null`), so it can never go
  through the Worker. Use `index.html?mock` for canned replies. Or serve the folder
  (`python3 -m http.server 8000`, then open http://localhost:8000/) and temporarily add `http://localhost:8000` to
  the list. Remove it again when you are done.

Then paste the Worker URL into `WORKER_URL` near the top of `../index.html`, and into the `connect-src` of the
page's Content-Security-Policy. This project's URL is `https://frosty-cherry-5715.tuomashiljanen.workers.dev`.

## What it answers
| Status | When |
|---|---|
| 403 | `ALLOWED_ORIGIN` unset, or the request's `Origin` is different (no CORS headers either) |
| 204 | CORS preflight (`OPTIONS`) from the allowed origin |
| 405 | anything but `POST` |
| 413 | a body over 16,000 bytes (it stops reading at the limit) |
| 400 | invalid JSON, a model not on the list, a bad role, more than 20 messages, or a message over 4,000 characters |
| 500 | `{"error":"proxy misconfigured"}`: the secret is missing (nothing goes upstream) |
| 504 | OpenRouter took longer than 18 s |
| 429 / 401 / 402 | the same status from OpenRouter, with a generic `{"error":"upstream error","status":N}` body |
| 502 | any other OpenRouter error, with the same generic body |
| 200 | OpenRouter's reply, streamed through |

OpenRouter's error bodies are never passed on.

Allowed models: `openrouter/free`, `nvidia/nemotron-3-ultra-550b-a55b:free`, `google/gemma-4-31b-it:free`.

For `wrangler dev`, put the secret in `.dev.vars` (`OPENROUTER_API_KEY1=...`). `.gitignore` excludes it, along with
`.env*` and `.wrangler/`.
