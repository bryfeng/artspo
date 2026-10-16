// The automated inspection pass. Drives a tab over the Chrome DevTools Protocol
// (chrome.debugger): reload with instrumentation, wait out load animations, scroll with
// real wheel events, capture a filmstrip + full page, then extract tokens and motion.

const VIEW = { width: 1440, height: 900 };
const STEP = Math.round(VIEW.height * 0.8);
const MAX_STEPS = 40;
const MAX_FRAMES = 12;
const MAX_FULL_HEIGHT = 12000;
const THROTTLED_FPS = 20;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms))]);

// paste the top-viewport PNG over the full-page PNG; return JPEG base64
async function composite(bodyB64, topB64) {
  const bmp = async (b64) => createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
  const body = await bmp(bodyB64);
  const c = new OffscreenCanvas(body.width, body.height);
  const g = c.getContext('2d');
  g.drawImage(body, 0, 0);
  if (topB64) g.drawImage(await bmp(topB64), 0, 0);
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

let sources;
async function loadSources() {
  if (sources) return sources;
  const get = async (p) => (await fetch(chrome.runtime.getURL(p))).text();
  sources = { instrument: await get('inject/instrument.js'), extract: await get('inject/extract.js') };
  return sources;
}

class Session {
  constructor(tabId) {
    this.target = { tabId };
    this.waiters = [];
    this.detached = null;
    this.onEvent = (src, method, params) => {
      if (src.tabId !== tabId) return;
      this.waiters = this.waiters.filter((w) => (w.method === method ? (w.resolve(params), false) : true));
    };
    this.onDetach = (src, reason) => {
      if (src.tabId !== tabId) return;
      this.detached = reason;
      this.waiters.forEach((w) => w.reject(new Error(`debugger detached (${reason})`)));
      this.waiters = [];
    };
  }
  async attach() {
    chrome.debugger.onEvent.addListener(this.onEvent);
    chrome.debugger.onDetach.addListener(this.onDetach);
    await chrome.debugger.attach(this.target, '1.3');
  }
  send(method, params = {}) {
    if (this.detached) return Promise.reject(new Error(`debugger detached (${this.detached})`));
    return chrome.debugger.sendCommand(this.target, method, params);
  }
  waitFor(method, ms) {
    return withTimeout(new Promise((resolve, reject) => this.waiters.push({ method, resolve, reject })), ms, method);
  }
  async eval(expression, { awaitPromise = false, timeout = 15000 } = {}) {
    const res = await withTimeout(
      this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }), timeout, 'evaluate');
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description?.split('\n')[0] || res.exceptionDetails.text);
    return res.result?.value;
  }
  async close() {
    chrome.debugger.onEvent.removeListener(this.onEvent);
    chrome.debugger.onDetach.removeListener(this.onDetach);
    if (!this.detached) await chrome.debugger.detach(this.target).catch(() => {});
  }
}

async function openTarget(mode) {
  if (mode === 'window') {
    // The viewport is set by device-metrics emulation, so the window only needs to exist. Screens smaller than
    // 1440×1000 reject that size ("bounds must be at least 50% within visible screen space"), so fall back.
    const base = { url: 'about:blank', focused: false, type: 'normal', state: 'normal' };
    const win = await chrome.windows.create({ ...base, width: VIEW.width, height: VIEW.height + 100, left: 0, top: 0 })
      .catch(() => chrome.windows.create({ ...base, width: 800, height: 600 }))
      .catch(() => chrome.windows.create(base));
    return { tabId: win.tabs[0].id, close: () => chrome.windows.remove(win.id).catch(() => {}) };
  }
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  return { tabId: tab.id, close: () => chrome.tabs.remove(tab.id).catch(() => {}) };
}

// Pull @keyframes for the names that were actually used out of cross-origin stylesheets
// (the page can't read them; the extension can fetch them with its host permissions).
async function fetchKeyframes(hrefs, names) {
  const found = {};
  if (!names.length) return found;
  for (const href of hrefs.slice(0, 8)) {
    try {
      const css = await withTimeout(fetch(href).then((r) => r.text()), 8000, 'stylesheet');
      for (const name of names) {
        if (found[name]) continue;
        const i = css.search(new RegExp(`@(?:-webkit-)?keyframes\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`));
        if (i < 0) continue;
        let depth = 0, j = css.indexOf('{', i);
        for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}' && --depth === 0) break; }
        found[name] = css.slice(i, j + 1).replace(/\s+/g, ' ').slice(0, 600);
      }
    } catch {}
  }
  return found;
}

async function inspectOnce(url, mode, onProgress = () => {}) {
  const { instrument, extract } = await loadSources();
  const started = Date.now();
  const diag = { mode: mode === 'window' ? 'separate unfocused window' : 'background tab', viewport: `${VIEW.width}×${VIEW.height}`, errors: [] };
  const target = await openTarget(mode);
  const s = new Session(target.tabId);
  try {
    await s.attach();
    await s.send('Page.enable');
    await s.send('Runtime.enable');
    await s.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch((e) => diag.errors.push('focus emulation: ' + e.message));
    await s.send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: false });
    // (scrollbars: hidden via injected CSS below; Emulation.setScrollbarsHidden can stall captureScreenshot)
    await s.send('Page.addScriptToEvaluateOnNewDocument', { source: instrument });

    onProgress('loading');
    const loaded = s.waitFor('Page.loadEventFired', 30000);
    const nav = await s.send('Page.navigate', { url });
    if (nav.errorText) throw new Error(`page failed to load (${nav.errorText})`);
    await loaded.catch((e) => diag.errors.push('load: ' + e.message));
    await s.eval('document.fonts ? document.fonts.ready.then(() => true) : true', { awaitPromise: true, timeout: 6000 }).catch(() => {});
    await sleep(3000); // let load animations play out while instrumentation records them

    const hasInstr = await s.eval('!!window.__artspo');
    if (!hasInstr) diag.errors.push('instrumentation did not load (page CSP or navigation)');
    diag.fpsLoad = hasInstr ? await s.eval('__artspo.rafFps()') : undefined;
    diag.visibility = await s.eval('document.visibilityState').catch(() => undefined);
    if (hasInstr && diag.fpsLoad < THROTTLED_FPS && mode === 'tab') {
      return { throttled: true, diag };
    }

    // ---- consent banners ----
    const consent = await s.eval('__artspo ? __artspo.hideConsent() : null').catch(() => null);
    if (consent?.hidden?.length) {
      diag.consentHidden = consent.hidden;
      if (consent.unlocked) diag.consentUnlocked = true;
      await sleep(300);
    }

    // ---- scroll pass ----
    // Scroll by real wheel events (so smooth-scroll libraries respond), measure where the page actually
    // went, recover when it doesn't move, stop at the bottom, and keep frames evenly spaced by position.
    onProgress('scrolling');
    await s.eval('__artspo && (__artspo.phase = "scroll", __artspo.sampleColors())').catch(() => {});
    const scroll = { mode: await s.eval('__artspo ? __artspo.pickScroller() : "window"').catch(() => 'window'),
                     steps: 0, methods: {}, overshoots: 0, duplicateFrames: 0, trace: [] };
    const pos = () => s.eval('__artspo ? __artspo.pos() : Math.round(scrollY)');
    const maxPos = () => s.eval('__artspo ? __artspo.maxPos() : document.documentElement.scrollHeight - innerHeight');
    const settle = async (from) => {           // wait until the position stops changing (smooth scroll)
      let last = from, still = 0;
      for (let t = 0; t < 2200; t += 110) {
        await sleep(110);
        const p = await pos();
        if (p === last) { if (++still >= 3) return p; } else { still = 0; last = p; }
      }
      return last;
    };
    const frames = [];
    let lastFrame = null;
    const grab = async () => {
      const data = (await withTimeout(s.send('Page.captureScreenshot', { format: 'jpeg', quality: 72 }), 8000, 'screenshot')).data;
      if (data === lastFrame) { scroll.duplicateFrames++; return; }
      lastFrame = data; frames.push(data);
    };
    const startMax = await maxPos();
    const spacing = Math.max(STEP, startMax / (MAX_FRAMES - 1));
    let y = await pos(), lastFrameY = y;
    let delta = STEP;                          // adapts when smooth scroll multiplies the wheel
    try { await grab(); }
    catch (e) {
      // a background tab that isn't producing frames can't be screenshotted; redo the pass in a window
      if (mode === 'tab') return { throttled: true, diag: { ...diag, fallbackWhy: 'screenshots stalled in the background tab' } };
      throw e;
    }
    for (let i = 1; i <= MAX_STEPS; i++) {
      const max = await maxPos();
      if (y >= max - 2) { scroll.reachedBottom = true; break; }
      const before = y;
      await withTimeout(s.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: VIEW.width / 2, y: VIEW.height / 2, deltaX: 0, deltaY: delta }), 3000, 'wheel')
        .catch((e) => { scroll.wheelError = e.message; });
      onProgress(`scrolling: step ${i}`);
      y = await settle(before);
      let method = 'wheel';
      if (y - before < 40) {                    // stalled: try keys, then a direct scroll, then re-pick the scroller
        try {
          await withTimeout(s.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 }), 2000, 'key');
          await withTimeout(s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 }), 2000, 'key');
        } catch (e) { scroll.keyError = e.message; }
        y = await settle(before); method = 'key';
        if (y - before < 40) { await s.eval(`__artspo ? __artspo.nudge(${STEP}) : scrollBy(0, ${STEP})`); y = await settle(before); method = 'scrollBy'; }
        if (y - before < 40) {
          const m = await s.eval('__artspo ? __artspo.pickScroller() : "window"').catch(() => 'window');
          if (m !== scroll.mode) { scroll.mode = m; await s.eval(`__artspo.nudge(${STEP})`); y = await settle(before); method = 'container'; }
        }
        if (y - before < 40 && y >= (await maxPos()) - 2) { scroll.reachedBottom = true; break; } // bottom, not a stall
        if (y - before < 40) {
          scroll.stalledAt = y;
          scroll.lock = await s.eval('__artspo ? __artspo.scrollLock() : null').catch(() => null);
          break;
        }
      }
      const moved = y - before;
      if (moved > STEP * 1.3) {
        scroll.overshoots++;
        if (method === 'wheel') delta = Math.max(120, Math.round(delta * STEP / moved)); // aim for ~one STEP per wheel
      }
      scroll.methods[method] = (scroll.methods[method] || 0) + 1;
      scroll.steps = i;
      scroll.trace.push(y);
      if (i === 3) diag.fpsScroll = await s.eval('__artspo ? __artspo.rafFps() : undefined');
      await s.eval('__artspo && __artspo.sampleColors()').catch(() => {});
      const atBottom = y >= (await maxPos()) - 2;
      if (y - lastFrameY >= spacing * 0.9 || atBottom) {
        if (frames.length < MAX_FRAMES) { await grab().catch((e) => diag.errors.push('frame: ' + e.message)); lastFrameY = y; }
      }
      onProgress(`scrolling ${Math.round((y / Math.max(1, max)) * 100)}%`);
    }
    if (scroll.methods.scrollBy || scroll.methods.container) {
      const lock = await s.eval('__artspo ? __artspo.scrollLock() : null').catch(() => null);
      if (lock) scroll.bypassedLock = lock;
    }
    if (!scroll.reachedBottom && scroll.stalledAt === undefined && y >= (await maxPos()) - 2) scroll.reachedBottom = true;
    if (diag.fpsScroll === undefined && hasInstr) diag.fpsScroll = await s.eval('__artspo.rafFps()');
    scroll.endY = y;
    scroll.maxY = await maxPos();
    diag.scroll = scroll;
    diag.scrollSteps = scroll.steps;
    await sleep(1000);

    // ---- extract ----
    onProgress('extracting');
    const result = await s.eval(extract, { timeout: 30000 });
    if (result?.blockedStylesheets?.length) {
      const names = (result.motion.usedKeyframes || []).filter((n) => !result.motion.keyframes[n]);
      Object.assign(result.motion.keyframes, await fetchKeyframes(result.blockedStylesheets, names));
      diag.keyframesFetched = true;
    }

    // ---- full page ----
    // Fixed elements (navs, chat widgets) get painted at odd places in a beyond-viewport capture, so: shoot the
    // top viewport with them, shoot the full page without them, then paste the top viewport back on.
    onProgress('full-page screenshot');
    // make sure the page is really at the top: sticky headers are drawn wherever the scroll position is
    let topY = -1;
    for (let k = 0; k < 4 && topY !== 0; k++) {
      await s.eval('__artspo ? __artspo.toTop() : scrollTo(0, 0)');
      if (k >= 1) {
        await withTimeout(s.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: VIEW.width / 2, y: VIEW.height / 2, deltaX: 0, deltaY: -100000 }), 3000, 'wheel').catch(() => {});
      }
      topY = await settle(await pos());
    }
    if (topY !== 0) diag.errors.push(`could not return to the top before the full-page shot (stuck at ${topY}px); sticky headers may appear mid-page`);
    await sleep(600);
    let full;
    try {
      const top = (await withTimeout(s.send('Page.captureScreenshot', { format: 'png' }), 10000, 'screenshot')).data;
      const nFixed = await s.eval('__artspo ? __artspo.hideFixed() : 0').catch(() => 0);
      if (scroll.mode !== 'window') { await s.eval('__artspo.unboxScroller()').catch(() => {}); await sleep(300); }
      const metrics = await s.send('Page.getLayoutMetrics');
      const size = metrics.cssContentSize || metrics.contentSize;
      let pageH = Math.ceil(size.height);

      const height = Math.min(pageH, MAX_FULL_HEIGHT);
      diag.heightCapped = pageH > MAX_FULL_HEIGHT;
      const body = (await withTimeout(s.send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: VIEW.width, height, scale: 1 },
      }), 30000, 'full-page screenshot')).data;
      await s.eval('__artspo && __artspo.restoreFixed()').catch(() => {});
      full = await composite(body, nFixed ? top : null);
      if (nFixed) diag.fixedHandled = nFixed;
      if (scroll.mode !== 'window') diag.containerUnboxed = true;
    } catch (e) {
      diag.errors.push('full-page screenshot: ' + e.message);
    }

    diag.throttled = (diag.fpsLoad ?? 60) < THROTTLED_FPS || (diag.fpsScroll ?? 60) < THROTTLED_FPS;
    diag.durationS = Math.round((Date.now() - started) / 1000);
    return { result, frames, full, diag };
  } finally {
    await s.close();
    await target.close();
  }
}

// Background tab first (least disruptive). If Chrome throttles it — rAF stalls in hidden
// tabs, which freezes JS-driven motion — redo the pass in a small unfocused window.
export async function inspect(url, onProgress) {
  const first = await inspectOnce(url, 'tab', onProgress);
  if (!first.throttled) return first;
  const second = await inspectOnce(url, 'window', onProgress);
  second.diag.fallbackReason = first.diag.fallbackWhy || `background tab ran at ${first.diag.fpsLoad} fps`;
  return second;
}
