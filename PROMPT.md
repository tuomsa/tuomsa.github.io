# Prompt: Executive Board

Build a real-time 3D scene for the browser: **five people in a board meeting** around a long table in a
**penthouse "Executive Board" room**. The city sits at blue hour behind floor-to-ceiling glass. It should look like
a quiet, expensive moment you could stand inside and walk around. Then you sit down at the end of the table and pitch
the board an idea, and the five of them answer you.

## What matters most (in this order)
1. **It reads instantly.** Someone glancing at a frame should see five seated people, a board table, a penthouse
   room and a city skyline, with no explanation.
2. **It looks good.** Warm interior light against a cool dusk outside, soft shadows, glossy wood and stone.
3. **It runs smoothly** on an ordinary desktop GPU at 1080p–1440p.
4. **It is small and self-contained.** One file. A small download comes last, after the three above.

## Hard rules
- **Procedural math only.** No image files, models, fonts-as-art, video or sound files. The only network traffic is
  the AI board's chat requests.
  Every shape comes from equations: parametric surfaces, revolved profiles, swept pipes, superellipsoids, extruded
  outlines. Every surface pattern (wood grain, marble, fabric, screens, windows) comes from noise and math in shaders.
- **WebGPU, written by hand.** No Three.js, Babylon or any other engine or helper library.
- **One file:** `index.html` opens directly in Chrome or Edge. No build step is required to run it.
- **Readable source for now.** Keep the code unminified, commented and structured in clear parts. Minifying is a
  separate, later step and must not change how the scene looks.
- **Don't produce garbage every frame.** Allocate buffers, arrays and pass descriptors up front, and reuse them.

## The scene
- **Room:** about 16 × 12 m with a 4 m ceiling. Two walls are glass, meeting at a corner behind the head of the table,
  with slim dark mullions. Polished stone floor tiles and a dark rug under the table. A recessed ceiling cove with a
  hidden warm light strip. Recessed downlights. A walnut feature wall with a wall display showing a results dashboard
  (bars, a trend line and a donut chart, all drawn in the shader), and a credenza below it.
- **Table:** a long walnut table with rounded ends on two bronze plinths. Laptops, leather folios, notepads, pens,
  water glasses, espresso cups, carafes and a conference speaker on top.
- **Lighting:** a linear pendant above the table is the key light and casts soft shadows. Six ceiling downlights,
  cool dusk light through the glass, and occlusion that grounds things under the table and in the room's creases.
- **People:** five seated board members with clearly different builds, skin tones, hair (side parting, crop, bun,
  long), suits, shirts and ties, and one pair of glasses.
  - **Roles:** the CEO sits at the head; the others are the CFO, CTO, Head of HR and the **Devil's Advocate**.
  - **The Devil's Advocate** is a visibly red, humanlike devil in a black suit: red skin, small curved horns, pointed
    ears, a goatee, amber eyes and a pointed tail, all modelled procedurally.
  - **Life:** breathing, small head movements and the CEO's hand gesture.
- **The visitor's chair:** an empty executive chair at the open end of the table, facing the CEO.
- **Outside:** a blue-hour sky with afterglow where the sun has just set, a thin cloud deck and a few stars. The city
  should be endless, not a backdrop picture: a ray-marched skyline of towers with lit and unlit windows, office and
  residential lighting moods, roof beacons, glowing streets with moving traffic far below, and haze toward the horizon.
- **Plants:** a few fiddle-leaf figs in planters.

## Camera and controls
- **Walk only.**
  - Eye height is fixed at 1.65 m. `W` `A` `S` `D` move on the floor plane, so pitch never changes height.
  - Mouse look uses pointer lock; `Shift` walks faster.
  - Collision: the visitor is a circle pushed out of the walls and glass, the table, the chairs, the plants and the
    credenza.
- **Sitting:**
  - Near the empty chair, show "Press F to sit".
  - `F` glides the camera into it (about 1.2 m eye height, facing the CEO) and releases the pointer.
  - While seated, show a chat box (Enter in the box, or Send) and a "Stand up" button. Drag to look around.
  - Seated actions are buttons only: no keyboard shortcuts while seated (no C, R, E, F or Esc). Walking keeps
    WASD and mouse, `F` to sit, and `E` for the idea list. Typing in the chat box never triggers any action.
  - Keys typed into the box must never move or stand you.
- **Developer views:** fixed viewpoints (`1`–`9`, `#1`…`#9`, `#seat`) exist only behind `?dev` / `?offscreen`.
- `Esc` brings back the title overlay. `I` toggles a small stats line.

## The AI board
- **Calls:**
  - Send each idea to OpenRouter's chat completions endpoint, through the Cloudflare Worker (never with a key in the page).
  - Use free models only: `openrouter/free` first, then one or two specific `:free` models as fallbacks.
  - A 429, a 5xx, a timeout (about 20 s) or an empty answer moves on to the next model.
  - Make a fixed small number of attempts, then show a stock line. Never retry endlessly.
- **Order:** the members answer one at a time (CEO, CFO, CTO, HR, Devil's Advocate). Each sees the idea and the
  earlier replies.
- **Personas:** each role has its own system prompt. The Devil's Advocate is skeptical and hard to please.
- **Reply style:** one short spoken sentence of at most about 100 characters, in plain language, with no emojis,
  markdown, quotes or labels.
- **Client-side cleanup:** keep only letters, digits, spaces and `. , ? ! '`, then cut to about 100 characters at a
  word.
- **Safety:**
  - Show all model and user text with `textContent`, never as HTML.
  - Cap the user's idea at about 300 characters and each reply at about 80 tokens.
  - Lock the input during a round.
  - Put the idea in its own clearly delimited user-role message, and pass earlier replies as user content, never
    inside the system prompt.
  - Never put an API key in the page. Send requests to a Cloudflare Worker (`WORKER_URL`, `worker/worker.js`) with
    only `Content-Type: application/json`. The Worker holds the key as the secret `OPENROUTER_API_KEY1`
    (`wrangler secret put OPENROUTER_API_KEY1`). It allow-lists the three models and caps the body at 16,000 bytes,
    20 messages (system/user/assistant), 4,000 characters per message and 120 tokens, with reasoning off. It
    fails closed on origin: a required `ALLOWED_ORIGIN`, otherwise a 403 with no upstream call, and CORS echoes only
    that origin. It answers a 204 preflight, reads the body as a stream and stops at 16 KB, and rejects over-long
    content rather than cutting it. It forces `stream: false`, adds the Bearer and `X-Title: Executive Board`, and
    times out upstream after 18 s (504). It never echoes OpenRouter's error bodies: 429/401/402 pass through with a
    generic body and other errors become 502. A missing secret gives a 500 "proxy misconfigured" with no upstream
    call.
  - Required deployment hardening: `ALLOWED_ORIGIN`, a rate limit of about 30 POST requests a minute per IP, and a
    spend cap on the key, because `Origin` can be faked outside browsers.
  - Add a CSP meta: `default-src 'self'`, inline script and style, and `connect-src` only the Worker.
  - While `WORKER_URL` is the placeholder, send nothing and show "Set WORKER_URL in index.html to your Cloudflare
    Worker". Treat 400/401/402/403/413 from the Worker as final, with a short friendly message.
  - Don't log request or response bodies.
- **Mock mode:** `?mock` (and every headless capture) answers with canned lines and makes no network calls.

## Speech bubbles and gaze
- **Bubbles:**
  - One HTML bubble per member, made once and anchored above the head by projecting a 3D point with the
    view-projection matrix every frame.
  - Hide a bubble when its head is behind the camera or off-screen.
  - Show a typing indicator while waiting. Keep a reply for about 40 s, then fade it. A new submit clears the
    bubbles at once (they go to the idea wall) before the new round starts. Use a round token so late replies from
    an older round are dropped.
  - Briefly show the visitor's own idea above the chat box.
- **Gaze:**
  - Heads, and a little of the torso, turn smoothly within the neck's range.
  - Idle: everyone watches the CEO.
  - When the visitor sits down or pitches: everyone looks at the visitor.
  - While someone speaks: the others look at the speaker, and the speaker looks at the visitor.

## Verification
- **Renders, not claims.** Capture all six viewpoints as PNGs from a real browser. Headless or software-GPU browsers
  may not composite a WebGPU canvas, so provide a mode (`?offscreen`) that renders into a texture, plus a hook that
  reads the frame back from the GPU (`boardroom.capture()`, with a timeout).
- **Look at the renders and iterate** until five people, the table and the penthouse are obvious in each view. Watch
  in particular for: faces or heads with holes or z-fighting (never hide a second shell inside the skin), shirt fronts
  that read as masks, buildings so close or so bright that the skyline turns into a wall, and cameras inside geometry.
- Validate every setting that comes from outside (URL parameters) against a known set, with a safe default, so the
  generated WGSL is always valid.

- **Capture the new features too:**
  - a Devil's Advocate close-up;
  - the seated view;
  - a frame with the bubbles, with the HTML overlay screenshotted and composited over the GPU frame.

## Deliver
`index.html`, a README, this prompt file, the renders in `shots/` and a zip of the project.

## Coffee break
- While seated, a toggle button switches between the board meeting (the default) and a coffee break. Show
  the current mode clearly, and change the input's placeholder (for example "Share something with the table").
- **During a coffee break:**
  - All five hold coffee cups and sip now and then, staggered: the forearm, hand and cup swing to the mouth.
  - Drive the sip from time in the existing vertex pose math, with no per-frame allocations, and keep the cup
    attached to the hand.
  - The same personalities go off duty: small talk about what the visitor shares, guides, fixing cars, hobbies. The
    devil stays a playful contrarian.
- **Rules:**
  - Same sequential flow and the same delimited user-message layout (with its own markers, escaped the same way).
  - Lock the toggle during a round. Personas never swap mid-round.

## The idea wall
- **Board:** a large procedural cork board on a solid wall, visible from the visitor's chair or easy to walk to.
- **Slips:**
  - Every bubble that expires or is replaced becomes a post-it in the member's colour (the devil's red-ish), with
    the role and the text.
  - Each round is headed by a slip with the visitor's idea, the round number and the mode.
  - Lay the slips out in columns per round and show the latest rounds.
  - Session only: no storage. Keep at most about 60 slips and drop the oldest.
- **Rendering:**
  - Draw on a 2D canvas with `fillText` only, wrapped to the slip width.
  - Copy it into a preallocated texture (with mips) only when a slip is added, never per frame.
  - The text must be readable up close.
- The **Idea wall** button (and `E` while walking) opens a readable HTML list of all slips (`textContent` only). It never fires while typing in the chat box.

## Shared memory and another round
- Keep a session transcript: the visitor's ideas and every member's replies, with speaker labels.
  - Pass it to every member as user-role content (delimiter-escaped, never in the system prompt).
  - Cap it to the last ~3 rounds or ~2,000 characters.
- An "Another round" button while seated (no key): enabled only when not busy and after at least one round.
  - It starts a round with no new input. Each member continues the current topic, reacting to the others (including
    earlier replies in the same round).
  - Same length limit, round token, archiving and post-its ("Round N, continued"), in both modes.

## 1-on-1 conversations
- Walking within ~1.3 m of a member and roughly facing them shows "F to talk with <Title>" plus a visible
  "Talk to <Title>" button, on desktop too. The empty chair and the members compete; the nearest wins.
- The camera glides to a collision-checked spot ~1 m from them, at their eye level. They look at the visitor, and the
  others idle with an occasional glance.
- Only that member answers. Use their persona (the coffee one in a break) plus a private one-to-one framing.
- Buttons only: Send (Enter in the box) and Leave. No keys.
- Never during a board round. Board controls (round, Another round, coffee toggle) stay locked while it is open.
- Per-member private transcript, capped at ~2000 characters, sent as defused user-role content. Never mixed into the
  board's shared transcript or the idea wall.
- Reuse askModels, the round token, STOP_ROUND, try/finally, sanitize and textContent.
- Leave makes any late reply stale and aborts its request with an AbortController. Mock mode has canned private lines
  per role.

## Music
- Calm, original lounge jazz made with Web Audio, no files:
  - an FM electric piano with rootless voicings over a slow ii–V–I-flavoured progression;
  - a walking bass;
  - brushes and a ride, swung, 80–95 BPM;
  - a light seeded melody.
- Schedule with a lookahead timer against `AudioContext.currentTime`, never rAF or interval timing. One-shot nodes
  end and are disconnected; shared buses, the reverb and the noise buffer are made once.
- Start the context only from a user gesture, at volume ~0.25, through a master gain.
- A corner mute button and volume slider (clamped 0–1, 44 px on touch), plus M while walking. Settings live in
  validated localStorage, with a try/catch.
- Loop seamlessly: keep booking `nextBarTime += barDuration` on the audio clock, and wrap the chart index without a
  restart, so the loop's first bar lands exactly one bar after its last and tails carry over. Give every note an
  attack/release envelope that starts and ends at exactly 0, with no hard gain steps. Ramp volume and mute over
  ~30 ms, and fade in over ~0.3 s on start and resume. Re-anchor the next bar at currentTime plus the lookahead
  on resume instead of booking missed bars. Verify by rendering 2.5 loops offline and comparing the sample
  jumps and 50 ms RMS at the loop boundaries with the other bar starts.
- Suspend while hidden. Duck in a coffee break and a 1-on-1. Fewer voices on phones.
- Tests read the context state; mock and offscreen runs never wait on audio.

## Phones and touch
- Detect touch with `(pointer: coarse)` and allow `?touch` to force it.
- Walking:
  - A virtual joystick bottom-left walks: dead zone ~0.15, magnitude clamped to 1, same collision as keys.
  - A drag anywhere else looks around.
  - Use Pointer Events with `setPointerCapture`, one `pointerId` per role, so walk and look work with two fingers.
  - Release on `pointerup`, `pointercancel` and `lostpointercapture`, and when the tab hides.
  - No pointer lock on touch.
- Tap buttons are at least 44 px:
  - contextual Sit (near the chair) and Stand;
  - Coffee break, Another round, Idea wall and Send;
  - a views button only in `?dev`.
- `touch-action: none` goes only on the canvas and the joystick, never on the body, so text and lists still scroll.
- Viewport: `width=device-width, viewport-fit=cover`, no zoom. Respect safe-area insets.
- Use a chat font of at least 16 px. Use `visualViewport` to lift the chat bar above the keyboard, and never resize the
  3D view for it.
- Small screens:
  - bubbles at most 160 px wide, with a smaller font;
  - when there is no room above, a bubble slides sideways;
  - the idea list fills the screen and shows a "scroll for more" cue;
  - narrow screens keep ~88° horizontal (vertical up to ~128°); below 0.85 width/height the seat leans back 0.55 m and
    up 0.08 m (pitch −0.12) and the visitor's own chair is not drawn from there;
  - a bubble whose speaker is off-screen docks at that side's edge with an arrow, so no line is ever dropped.
- With no WebGPU, say so with `textContent` and name browsers to try. Do not fall back to another renderer.

## Performance
- Profile first; there are dev-only `skip=` switches for each pass.
- Cache what changes slowly:
  - Bake the skyline at reduced size; refresh it at once when the view moves, otherwise every few frames.
  - Redraw the shadow map every few frames, or at once when any pose in it (gaze, sip, coffee arms) changes.
- Tiers:
  - High: 4× MSAA, depth pre-pass, half-size bloom.
  - Low: no MSAA, quarter-size bloom, at most 3 noise octaves, smaller shadow map and skyline.
  - Auto picks low on touch and small screens. The title-screen picker writes only allow-listed `?detail` values.
- Resolution:
  - Cap DPR at 1.5 (1 on touch) and clamp to `maxTextureDimension2D`.
  - Adaptive resolution scale 0.5–1 with hysteresis: down after ~1 s slow, up after ~3 s fast.
  - Rebuild targets only on a step change; debounce resizes by 200 ms.
- Scheduling:
  - Pause on `visibilitychange` and reset the clock on return.
  - Use ~30 fps when idle.
  - Update bubble DOM at ~30 Hz.
  - Zero allocations per frame.
- `I` shows fps, ms, size, scale and tier.

