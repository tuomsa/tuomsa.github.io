// Phone checks and captures: touch UI at 390x844 (portrait) and 844x390 (landscape), emulated touch.
// Like capture-board.mjs, pages open with ?offscreen (canned mock replies) and every request to openrouter.ai is
// aborted, so this never touches the API. ?touch forces the touch interface regardless of the emulated pointer.
// usage: node capture-mobile.mjs <outDir> [jobs]   jobs: walk,seat-portrait,seat-landscape   (page served at :8765)
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const outDir = process.argv[2] || 'shots';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 900000,
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'] });
let blocked = 0, failures = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures++; };

async function open(width, height, hash) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: width > height });
  await page.setRequestInterception(true);
  page.on('request', (r) => { if (/openrouter\.ai|\.workers\.dev/.test(r.url())) { blocked++; r.abort(); } else r.continue(); });
  page.on('console', (m) => { if (!/favicon|404/.test(m.text())) console.log('  [console]', m.type(), m.text().slice(0, 200)); });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.goto(`http://localhost:8765/executive-board/index.html?offscreen&touch${hash}`);
  await page.waitForFunction(() => (window.boardroom && window.boardroom.frames() > 2) || document.documentElement.classList.contains('broken'), { timeout: 600000, polling: 500 });
  return page;
}
const frames = (page) => page.evaluate(() => window.boardroom.frames());
const nextFrames = async (page, n = 2) => { const f = await frames(page); await page.waitForFunction((k) => window.boardroom.frames() >= k, { timeout: 600000, polling: 200 }, f + n); };
const gpu = async (page, file) => {
  const url = await page.evaluate(() => window.boardroom.capture(600000));
  writeFileSync(file, Buffer.from(url.split(',')[1], 'base64')); console.log('saved', file);
};
const overlay = async (page, file) => {
  await page.evaluate(() => { document.documentElement.style.background = 'transparent'; document.body.style.background = 'transparent'; });
  await page.screenshot({ path: file, omitBackground: true }); console.log('saved', file);
};
// raw touch through the DevTools protocol, so two fingers can be down at once (each gets its own pointerId)
const touch = (cdp, type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });

async function seatedRound(page, idea) {
  await page.evaluate(() => { window.boardroom.snapGaze(); window.boardroom.bubbleLife(3600000); });
  await page.waitForFunction(() => window.boardroom.mode() === 'seated', { timeout: 600000, polling: 500 });
  await page.type('#idea', idea);
  await page.tap('#send');
  await new Promise((d) => setTimeout(d, 500));
  await page.waitForFunction(() => !document.getElementById('send').disabled, { timeout: 600000, polling: 300 });
  await page.evaluate(() => { window.boardroom.speaker(4); document.getElementById('yourIdea').classList.add('show'); });
  await nextFrames(page, 2);
}

for (const job of (process.argv[3] || 'walk,seat-portrait,seat-landscape').split(',')) {
  const t0 = Date.now();
  if (job === 'walk') {
    const page = await open(390, 844, '#walk');
    const cdp = await page.createCDPSession();
    const q = await page.evaluate(() => window.boardroom.quality());
    check(q.touch && q.tier === 'low' && q.asked === 'auto', `touch device gets the low tier automatically (${JSON.stringify(q)})`);
    const ui = await page.evaluate(() => ({
      stick: getComputedStyle(document.getElementById('stick')).display, touchAction: getComputedStyle(document.getElementById('view')).touchAction,
      bodyTouch: getComputedStyle(document.body).touchAction, pointerLock: !!document.pointerLockElement,
      stickBox: document.getElementById('stick').getBoundingClientRect().toJSON() }));
    check(ui.stick === 'block', 'joystick shown while walking');
    check(ui.touchAction === 'none' && ui.bodyTouch !== 'none', 'touch-action:none on the canvas only, not the body');
    check(!ui.pointerLock, 'no pointer lock on touch');
    check(await page.evaluate(() => getComputedStyle(document.getElementById('viewsBtn')).display === 'none'), 'Views button hidden without ?dev');
    // stand a step from the empty chair, facing the board: the Sit button appears
    await page.evaluate(() => window.boardroom.teleport(4.55, 0.35, -0.08, -Math.PI / 2));
    await nextFrames(page, 2);
    const sitShown = await page.evaluate(() => getComputedStyle(document.getElementById('sitBtn')).display !== 'none');
    check(sitShown, 'contextual Sit button near the chair');
    const sizes = await page.evaluate(() => [...document.querySelectorAll('#touchBar button')].filter((b) => b.offsetParent).map((b) => [b.id, b.offsetWidth, b.offsetHeight]));
    check(sizes.every(([, w, h]) => w >= 44 && h >= 44), `tap targets at least 44 px ${JSON.stringify(sizes)}`);
    // two fingers: left thumb on the stick (pushed forward), right finger dragging to look
    const cx = ui.stickBox.x + ui.stickBox.width / 2, cy = ui.stickBox.y + ui.stickBox.height / 2;
    const before = await page.evaluate(() => window.boardroom.eye());
    await touch(cdp, 'touchStart', [[cx, cy], [300, 400]]);
    await touch(cdp, 'touchMove', [[cx, cy - 40], [270, 400]]);
    const held = await page.evaluate(() => window.boardroom.touchState());
    check(held.stickHeld && held.looking && held.stick[1] < -0.3, `stick and look on separate fingers ${JSON.stringify(held)}`);
    await overlay(page, `${outDir}/m-walk.dom.png`);
    await nextFrames(page, 3);
    const during = await page.evaluate(() => window.boardroom.eye());
    check(during[0] < before[0] - 0.02, `walked forward with the stick (x ${before[0].toFixed(3)} -> ${during[0].toFixed(3)})`);
    check(Math.abs(during[4] - before[4]) > 0.05, `looked around with the second finger (yaw ${before[4].toFixed(3)} -> ${during[4].toFixed(3)})`);
    await touch(cdp, 'touchCancel', []);
    const after = await page.evaluate(() => window.boardroom.touchState());
    check(!after.stickHeld && !after.looking && after.stick[0] === 0 && after.stick[1] === 0, 'touchcancel releases stick and look (nothing sticks)');
    const stopA = await page.evaluate(() => window.boardroom.eye()); await nextFrames(page, 2);
    const stopB = await page.evaluate(() => window.boardroom.eye());
    check(Math.abs(stopA[0] - stopB[0]) < 1e-6 && Math.abs(stopA[2] - stopB[2]) < 1e-6, 'no drift after release');
    // dead zone: a 5 px nudge does nothing
    await touch(cdp, 'touchStart', [[cx, cy]]); await touch(cdp, 'touchMove', [[cx + 5, cy]]);
    const nudge = await page.evaluate(() => window.boardroom.touchState());
    check(nudge.stick[0] === 0 && nudge.stick[1] === 0, 'dead zone swallows a small nudge');
    // far outside the pad: clamped to length 1
    await touch(cdp, 'touchMove', [[cx + 300, cy - 300]]);
    const far = await page.evaluate(() => window.boardroom.touchState());
    check(Math.hypot(...far.stick) <= 1.0001, `push clamped to 1 (${Math.hypot(...far.stick).toFixed(3)})`);
    await touch(cdp, 'touchEnd', []);
    // walk into the glass for a while: collision still holds the visitor inside
    await page.evaluate(() => window.boardroom.teleport(4.55, 0.35, 0, Math.PI / 2));   // facing +x, toward a wall
    await touch(cdp, 'touchStart', [[cx, cy]]); await touch(cdp, 'touchMove', [[cx, cy - 80]]);
    await nextFrames(page, 40);
    await touch(cdp, 'touchEnd', []);
    const walled = await page.evaluate(() => window.boardroom.eye());
    check(walled[0] < 8, `collision still applies (x = ${walled[0].toFixed(2)})`);
    // back at the chair for the picture, then tap Sit
    await page.evaluate(() => window.boardroom.teleport(4.55, 0.35, -0.08, -Math.PI / 2));
    await nextFrames(page, 2);
    await touch(cdp, 'touchStart', [[cx, cy]]); await touch(cdp, 'touchMove', [[cx - 22, cy - 34]]);
    await overlay(page, `${outDir}/m-walk.dom.png`);
    await touch(cdp, 'touchCancel', []);
    await page.evaluate(() => window.boardroom.teleport(4.55, 0.35, -0.08, -Math.PI / 2));
    await nextFrames(page, 2);
    await gpu(page, `${outDir}/m-walk.gpu.png`);
    await page.tap('#sitBtn');
    await page.waitForFunction(() => window.boardroom.mode() === 'seated', { timeout: 600000, polling: 300 });
    check(true, 'tapping Sit seats the visitor');
    await page.close();
  } else if (job === 'seat-portrait' || job === 'seat-landscape') {
    const portrait = job === 'seat-portrait';
    const page = await open(portrait ? 390 : 844, portrait ? 844 : 390, '#seat');
    await seatedRound(page, portrait ? 'Turn the roof into a rooftop garden for staff' : 'A four day work week for the whole company');
    const fit = await page.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      const bubbles = [...document.querySelectorAll('.bubble.show:not(.off)')].map((b) => b.getBoundingClientRect());
      const inside = bubbles.every((b) => b.left >= -1 && b.right <= innerWidth + 1 && b.top >= -1);
      let overlap = 0;
      for (let i = 0; i < bubbles.length; i++) for (let j = i + 1; j < bubbles.length; j++) {
        const a = bubbles[i], b = bubbles[j];
        if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) overlap++;
      }
      return { n: bubbles.length, inside, overlap, maxW: Math.max(...bubbles.map((b) => b.width)), font: getComputedStyle(document.getElementById('idea')).fontSize,
               bar: r('seatBar').toJSON(), buttons: ['send', 'standUp', 'coffeeToggle', 'againButton', 'wallButton'].map((id) => [id, Math.round(r(id).width), Math.round(r(id).height)]) };
    });
    check(fit.n === 5 && fit.inside && fit.overlap === 0, `bubbles on screen, ${fit.n} shown, ${fit.overlap} overlapping, widest ${fit.maxW.toFixed(0)} px`);
    check(fit.maxW <= 161, 'small-screen bubbles at most 160 px wide');
    check(fit.font === '16px', `chat input font ${fit.font}`);
    check(fit.buttons.every(([, w, h]) => w >= 44 && h >= 44), `seated buttons at least 44 px ${JSON.stringify(fit.buttons)}`);
    check(fit.bar.bottom <= (portrait ? 844 : 390) && fit.bar.top > 0, 'chat bar fits on screen');
    // touch-drag look while seated
    const cdp = await page.createCDPSession();
    const y0 = (await page.evaluate(() => window.boardroom.eye()))[4];
    await touch(cdp, 'touchStart', [[portrait ? 200 : 420, 150]]); await touch(cdp, 'touchMove', [[portrait ? 160 : 380, 150]]); await touch(cdp, 'touchEnd', []);
    await nextFrames(page, 2);
    const y1 = (await page.evaluate(() => window.boardroom.eye()))[4];
    check(Math.abs(y1 - y0) > 0.05, `seated drag-to-look (yaw ${y0.toFixed(3)} -> ${y1.toFixed(3)})`);
    await page.evaluate(() => window.boardroom.turn(0));
    await nextFrames(page, 2);
    await page.focus('#idea');
    await gpu(page, `${outDir}/m-${job}.gpu.png`);
    await overlay(page, `${outDir}/m-${job}.dom.png`);
    if (portrait) {
      // the idea wall list, full screen, after the round has been pinned
      // two more rounds on the same topic (the Another round button), so the list is long enough to scroll
      for (let k = 0; k < 2; k++) {
        await page.evaluate(() => window.boardroom.retire());
        await page.tap('#againButton');
        await new Promise((d) => setTimeout(d, 500));
        await page.waitForFunction(() => !document.getElementById('send').disabled, { timeout: 600000, polling: 300 });
      }
      await page.evaluate(() => { window.boardroom.retire(); });
      await new Promise((d) => setTimeout(d, 1500));
      await page.tap('#wallButton');
      await new Promise((d) => setTimeout(d, 400));
      const panel = await page.evaluate(() => { const r = document.getElementById('wallPanel').getBoundingClientRect(); const l = document.getElementById('wallList');
        return { w: r.width, h: r.height, scrolls: l.scrollHeight > l.clientHeight, more: document.getElementById('wallPanel').classList.contains('more') }; });
      check(panel.w >= 389 && panel.h >= 843, `idea list full screen (${panel.w}x${panel.h})`);
      check(panel.scrolls && panel.more, `long list scrolls and shows the "scroll for more" cue (${panel.scrolls}, ${panel.more})`);
      await overlay(page, `${outDir}/m-wall.dom.png`);
      await page.evaluate(() => { const l = document.getElementById('wallList'); l.scrollTop = l.scrollHeight; });
      await new Promise((d) => setTimeout(d, 300));
      check(!(await page.evaluate(() => document.getElementById('wallPanel').classList.contains('more'))), 'cue hides at the bottom of the list');
    }
    await page.close();
  }
  if (job === 'talk-portrait') {
    // walk up to the CTO, tap Talk, chat privately, tap Leave; the music control in the corner
    const page = await open(390, 844, '#walk');
    const cdp = await page.createCDPSession();
    const box = await page.evaluate(() => [...document.querySelectorAll('#musicBtn, #musicVol')].map((e) => { const r = e.getBoundingClientRect(); return [e.id, Math.round(r.width), Math.round(r.height), Math.round(r.right), Math.round(r.top)]; }));
    check(box.every(([, w, h]) => w >= 44 && h >= 44), `music control tap targets ${JSON.stringify(box)}`);
    await page.tap('#musicBtn');   // the tap is also the gesture that may start audio; it toggles mute
    await new Promise((d) => setTimeout(d, 600));
    let m = await page.evaluate(() => window.boardroom.music());
    if (m.muted) { await page.tap('#musicBtn'); await new Promise((d) => setTimeout(d, 600)); m = await page.evaluate(() => window.boardroom.music()); }
    check(!m.muted && m.context === 'running', `music playing after taps ${JSON.stringify(m)}`);
    const h = (await page.evaluate(() => window.boardroom.heads()))[2];
    const sx = h.x - Math.sin(h.face) * 1.05, sz = h.z - Math.cos(h.face) * 1.05;
    await page.evaluate((a, b, y) => window.boardroom.teleport(a, b, -0.1, y), sx, sz, Math.atan2(h.x - sx, -(h.z - sz)));
    await nextFrames(page, 2);
    const tb = await page.evaluate(() => { const b = document.getElementById('talkBtn'); const r = b.getBoundingClientRect(); return { shown: getComputedStyle(b).display !== 'none', text: b.textContent, w: r.width, h: r.height }; });
    check(tb.shown && tb.text === 'Talk to CTO' && tb.h >= 44, `Talk button on the phone ${JSON.stringify(tb)}`);
    await gpu(page, `${outDir}/m-talkhint.gpu.png`); await overlay(page, `${outDir}/m-talkhint.dom.png`);
    await page.tap('#talkBtn');
    await page.waitForFunction(() => window.boardroom.mode() === 'talk', { timeout: 600000, polling: 300 });
    const bar = await page.evaluate(() => ({ leave: (() => { const r = document.getElementById('leaveTalk').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
      font: getComputedStyle(document.getElementById('idea')).fontSize, stick: getComputedStyle(document.getElementById('stick')).display }));
    check(bar.leave[0] >= 44 && bar.leave[1] >= 44 && bar.font === '16px' && bar.stick === 'none', `phone 1-on-1 bar: Leave ${bar.leave}, input ${bar.font}, joystick hidden`);
    await page.type('#idea', 'Can I borrow an engineer for a week?');
    await page.tap('#send');
    await new Promise((d) => setTimeout(d, 400));
    await page.waitForFunction(() => !document.getElementById('send').disabled, { timeout: 600000, polling: 300 });
    const said = await page.evaluate(() => [...document.querySelectorAll('.bubble.show')].map((b) => b.querySelector('b').textContent + ': ' + b.querySelector('.say').textContent));
    check(said.length === 1 && said[0].startsWith('CTO:'), `only the CTO answered ${JSON.stringify(said)}`);
    await page.evaluate(() => { window.boardroom.snapGaze(); document.getElementById('yourIdea').classList.add('show'); });
    await nextFrames(page, 2);
    await gpu(page, `${outDir}/m-talk.gpu.png`); await overlay(page, `${outDir}/m-talk.dom.png`);
    await page.tap('#leaveTalk');
    await page.waitForFunction(() => window.boardroom.mode() === 'walk', { timeout: 600000, polling: 300 });
    const after = await page.evaluate(() => getComputedStyle(document.getElementById('stick')).display);
    check(after === 'block', 'Leave returns to walking, joystick back');
    void cdp;
    await page.close();
  }
  console.log(job, 'done in', ((Date.now() - t0) / 1000).toFixed(1), 's');
}
console.log('requests to openrouter.ai blocked:', blocked, '| failures:', failures);
await browser.close();
