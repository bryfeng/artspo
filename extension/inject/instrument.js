// Injected at document_start (via CDP Page.addScriptToEvaluateOnNewDocument) on the
// inspection tab only. Records motion as it happens so load animations aren't missed.
// Everything lands on window.__artspo; extract.js reads it at the end of the pass.
(() => {
  if (window.top !== window || window.__artspo) return;
  const T0 = performance.now();
  const now = () => Math.round(performance.now() - T0);
  const A = (window.__artspo = {
    phase: 'load',
    css: [],        // CSS animation / transition starts
    waapi: [],      // Element.animate() calls (Framer Motion, Motion One, hand-rolled)
    gsap: [],       // GSAP tween/timeline calls, when gsap is reachable
    inline: new Map(), // element -> inline-style motion segments (JS-driven motion)
    canvas: {},     // context types requested: { webgl: n, '2d': n }
    raf: { ticks: [] },
    colors: {},     // background color samples from the viewport grid
  });
  const CAP = 400;

  // ---- element descriptor -------------------------------------------------
  const cls = (el) =>
    (typeof el.className === 'string' ? el.className : el.getAttribute?.('class') || '')
      .split(/\s+/).filter(Boolean).slice(0, 2).map((c) => c.slice(0, 32));
  const desc = (el) => {
    if (!el || el.nodeType !== 1) return '?';
    const id = el.id && el.id.length < 30 ? '#' + el.id : '';
    const c = cls(el);
    return el.tagName.toLowerCase() + id + (c.length ? '.' + c.join('.') : '');
  };
  // first ~40 chars of visible text, with spaces between text nodes ("Payouts Global…", not "PayoutsGlobal…")
  // (text inside <style>, <script>, <noscript>, <template> is code, not content: skip it)
  const CODE_TAGS = new Set(['STYLE', 'SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'style', 'script']);
  const textFilter = { acceptNode: (n) => (CODE_TAGS.has(n.parentNode?.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) };
  const text = (el) => {
    if (!el || el.nodeType !== 1) return '';
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, textFilter);
    let s = '';
    for (let n = w.nextNode(); n && s.length < 40; n = w.nextNode()) {
      const t = n.textContent.replace(/\s+/g, ' ').trim();
      if (t) s += (s ? ' ' : '') + t;
    }
    return s.slice(0, 40);
  };
  A.desc = desc;
  A.text = text;

  // ---- hide the page's own scrollbars so screenshots show the full 1440px design width
  const hideBars = () => {
    const st = document.createElement('style');
    st.dataset.artspo = 'scrollbars';
    st.textContent = '*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}';
    (document.head || document.documentElement).appendChild(st);
  };
  if (document.documentElement) hideBars(); else document.addEventListener('readystatechange', hideBars, { once: true });

  // ---- rAF heartbeat: tells us whether the tab is being throttled ---------
  const tick = () => {
    const t = performance.now();
    A.raf.ticks.push(t);
    if (A.raf.ticks.length > 600) A.raf.ticks.splice(0, 300);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  A.rafFps = () => {
    const cut = performance.now() - 1000;
    return A.raf.ticks.filter((t) => t >= cut).length;
  };

  // ---- CSS animations & transitions ---------------------------------------
  const pick = (list, i) => {
    const parts = String(list || '').split(/,(?![^(]*\))/).map((s) => s.trim());
    return parts[i % parts.length] || parts[0] || '';
  };
  addEventListener('animationstart', (e) => {
    if (A.css.length >= CAP) return;
    const cs = getComputedStyle(e.target);
    const names = cs.animationName.split(',').map((s) => s.trim());
    const i = Math.max(0, names.indexOf(e.animationName));
    A.css.push({
      kind: 'animation', t: now(), phase: A.phase, scrollY: Math.round(scrollY),
      el: desc(e.target), text: text(e.target), name: e.animationName,
      duration: pick(cs.animationDuration, i), easing: pick(cs.animationTimingFunction, i),
      delay: pick(cs.animationDelay, i), iterations: pick(cs.animationIterationCount, i),
    });
  }, true);
  addEventListener('transitionstart', (e) => {
    if (A.css.length >= CAP) return;
    const cs = getComputedStyle(e.target);
    const props = cs.transitionProperty.split(',').map((s) => s.trim());
    let i = props.indexOf(e.propertyName);
    if (i < 0) i = props.indexOf('all');
    if (i < 0) i = 0;
    A.css.push({
      kind: 'transition', t: now(), phase: A.phase, scrollY: Math.round(scrollY),
      el: desc(e.target), text: text(e.target), property: e.propertyName,
      duration: pick(cs.transitionDuration, i), easing: pick(cs.transitionTimingFunction, i),
      delay: pick(cs.transitionDelay, i),
    });
  }, true);

  // ---- Web Animations API -------------------------------------------------
  const origAnimate = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    try {
      if (A.waapi.length < CAP) {
        const o = typeof options === 'number' ? { duration: options } : options || {};
        let kf = '';
        try { kf = JSON.stringify(keyframes).slice(0, 300); } catch {}
        A.waapi.push({
          t: now(), phase: A.phase, scrollY: Math.round(scrollY), el: desc(this), text: text(this),
          keyframes: kf, duration: o.duration, easing: o.easing, delay: o.delay,
          iterations: o.iterations, fill: o.fill,
        });
      }
    } catch {}
    return origAnimate.apply(this, arguments);
  };

  // ---- canvas context types (WebGL detection without touching canvases) ---
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type) {
    try { A.canvas[type] = (A.canvas[type] || 0) + 1; } catch {}
    return origGetContext.apply(this, arguments);
  };

  // ---- GSAP: wrap tween factories if gsap is ever assigned to window ------
  const describeTargets = (targets) => {
    try {
      const arr = typeof targets === 'string' ? [targets]
        : targets && targets.length !== undefined && typeof targets !== 'string' ? Array.from(targets) : [targets];
      const first = arr[0];
      const d = typeof first === 'string' ? first : first?.nodeType === 1 ? desc(first) : typeof first;
      return arr.length > 1 ? `${d} (+${arr.length - 1})` : d;
    } catch { return '?'; }
  };
  // ScrollTrigger's pinning calls gsap.set / gsap.to with transform resets; those aren't the site's animations
  const RESET_KEYS = /^(x|y|z|xPercent|yPercent|rotation|rotationX|rotationY|rotationZ|scale|scaleX|scaleY|skewX|skewY|force3D|clearProps|top|left|width|height|overwrite)$/;
  const isInternal = (method, vars) => method === 'set' ||
    (vars.duration === undefined && Object.keys(vars).every((k) => RESET_KEYS.test(k) && (k === 'force3D' || k === 'overwrite' || vars[k] === 0 || vars[k] === 1)));
  const logGsap = (method, targets, vars, extra) => {
    if (A.gsap.length >= CAP || !vars || typeof vars !== 'object') return;
    if (isInternal(method, vars)) return;
    const st = vars.scrollTrigger;
    const props = Object.keys(vars).filter((k) =>
      !['duration', 'ease', 'delay', 'stagger', 'scrollTrigger', 'onComplete', 'onUpdate', 'onStart',
        'repeat', 'yoyo', 'paused', 'immediateRender', 'overwrite', 'id'].includes(k));
    A.gsap.push({
      t: now(), phase: A.phase, method, targets: describeTargets(targets),
      props: props.slice(0, 8).map((k) => `${k}: ${String(vars[k]).slice(0, 24)}`),
      from: extra ? Object.keys(extra).slice(0, 6).map((k) => `${k}: ${String(extra[k]).slice(0, 24)}`) : undefined,
      duration: vars.duration, ease: typeof vars.ease === 'string' ? vars.ease : vars.ease ? 'custom' : undefined,
      delay: vars.delay, stagger: typeof vars.stagger === 'object' ? JSON.stringify(vars.stagger).slice(0, 80) : vars.stagger,
      repeat: vars.repeat, yoyo: vars.yoyo,
      scrollTrigger: st ? (typeof st === 'object'
        ? { trigger: describeTargets(st.trigger), start: String(st.start ?? ''), end: String(st.end ?? ''),
            scrub: st.scrub, pin: !!st.pin, toggleActions: st.toggleActions }
        : { trigger: describeTargets(st) }) : undefined,
    });
  };
  const wrapGsap = (g) => {
    if (!g || g.__artspoWrapped) return g;
    try {
      g.__artspoWrapped = true;
      for (const m of ['to', 'from', 'set']) {
        const o = g[m];
        if (typeof o === 'function') g[m] = function (t, v) { logGsap(m, t, v); return o.apply(this, arguments); };
      }
      const ft = g.fromTo;
      if (typeof ft === 'function') g.fromTo = function (t, a, b) { logGsap('fromTo', t, b, a); return ft.apply(this, arguments); };
      const tl = g.timeline;
      if (typeof tl === 'function') {
        g.timeline = function (vars) {
          const timeline = tl.apply(this, arguments);
          try {
            if (vars?.scrollTrigger) logGsap('timeline', vars.scrollTrigger.trigger, vars);
            for (const m of ['to', 'from']) {
              const o = timeline[m];
              timeline[m] = function (t, v) { logGsap('tl.' + m, t, v); return o.apply(this, arguments); };
            }
            const f = timeline.fromTo;
            timeline.fromTo = function (t, a, b) { logGsap('tl.fromTo', t, b, a); return f.apply(this, arguments); };
          } catch {}
          return timeline;
        };
      }
    } catch {}
    return g;
  };
  let _gsap;
  try {
    Object.defineProperty(window, 'gsap', {
      configurable: true, enumerable: true,
      get: () => _gsap,
      set: (v) => { _gsap = wrapGsap(v); A.gsapGlobal = true; },
    });
  } catch {}

  // ---- inline-style motion (GSAP bundles, Framer Motion, custom rAF code) -
  const SEG_GAP = 300;
  const onMutations = (records) => {
    const t = now();
    for (const r of records) {
      const el = r.target;
      if (el.nodeType !== 1) continue;
      let rec = A.inline.get(el);
      if (!rec) {
        if (A.inline.size >= 300) continue;
        rec = { el: desc(el), text: text(el), segs: [] };
        A.inline.set(el, rec);
      }
      const style = el.getAttribute('style') || '';
      const last = rec.segs[rec.segs.length - 1];
      if (!last || t - last.t1 > SEG_GAP) {
        if (rec.segs.length >= 6) continue;
        // from = style before this burst; first = first frame (fills in props the old style lacked)
        rec.segs.push({ t0: t, t1: t, phase: A.phase, scrollY: Math.round(scrollY), from: r.oldValue || '', first: style, to: style, n: 1 });
      } else {
        last.t1 = t; last.to = style; last.n++;
      }
    }
  };
  const startObserver = () => {
    new MutationObserver(onMutations).observe(document.documentElement, {
      subtree: true, attributes: true, attributeFilter: ['style'], attributeOldValue: true,
    });
  };
  if (document.documentElement) startObserver();
  else document.addEventListener('readystatechange', startObserver, { once: true });

  // ---- consent banners: hide them so screenshots and measurements show the site, not the CMP
  const CMP_SEL = [
    '#onetrust-banner-sdk', '#onetrust-consent-sdk', '#CybotCookiebotDialog', '#didomi-host', '#usercentrics-root',
    '#truste-consent-track', '.truste_box_overlay', '#qc-cmp2-container', '[id^="sp_message_container"]', '.osano-cm-window',
    '#termly-code-snippet-support', '.iubenda-cs-container', '#cmpbox', '#cookiescript_injected', '.cky-consent-container',
    '.cc-window', '#cookie-law-info-bar', '[aria-label*="cookie" i][role="dialog"]', '[aria-label*="consent" i]',
    '.cky-modal', '.cky-overlay', '.cky-preference-center', '#onetrust-pc-sdk', '.onetrust-pc-dark-filter', '#CybotCookiebotDialogBodyUnderlay',
  ].join(',');
  const CONSENT_TXT = /\b(cookies?|consent|gdpr|ccpa|tracking technologies|your privacy)\b/i;
  const CONSENT_BTN = /^(accept|accept all|agree|allow|allow all|reject|reject all|decline|deny|got it|ok|okay|i understand|manage|preferences|customi[sz]e|settings|save)/i;
  A.hideConsent = () => {
    const hidden = [];
    const hide = (el, why) => {
      if (!el || el.dataset.artspoHidden) return;
      el.dataset.artspoHidden = 'consent';
      el.style.setProperty('display', 'none', 'important');
      hidden.push(`${desc(el)} (${why})`);
    };
    try { document.querySelectorAll(CMP_SEL).forEach((el) => hide(el, 'known CMP')); } catch {}
    // generic: fixed/sticky boxes that talk about cookies and offer accept/reject buttons
    for (const el of document.body ? document.body.querySelectorAll('div,section,aside,dialog,form,footer') : []) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      const t = el.innerText || '';
      if (t.length > 1500 || !CONSENT_TXT.test(t)) continue; // big fixed wrappers hold whole pages, not banners
      const btns = Array.from(el.querySelectorAll('button,a,[role="button"]')).map((b) => (b.innerText || '').trim());
      if (btns.some((b) => CONSENT_BTN.test(b))) hide(el, 'cookie text + buttons');
    }
    // CMPs often lock scrolling while open
    let unlocked = false;
    if (hidden.length) {
      for (const el of [document.documentElement, document.body]) {
        if (el && getComputedStyle(el).overflowY === 'hidden') { el.style.setProperty('overflow', 'auto', 'important'); unlocked = true; }
      }
    }
    return { hidden, unlocked };
  };

  // ---- fixed elements: hidden for the full-page capture, then the top viewport is pasted back over it
  A.hideFixed = () => {
    let n = 0;
    for (const el of document.body ? document.body.querySelectorAll('*') : []) {
      if (getComputedStyle(el).position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      el.dataset.artspoFixed = el.style.getPropertyValue('visibility') || '-';
      el.style.setProperty('visibility', 'hidden', 'important');
      n++;
    }
    return n;
  };
  A.restoreFixed = () => {
    document.querySelectorAll('[data-artspo-fixed]').forEach((el) => {
      const v = el.dataset.artspoFixed;
      if (v === '-') el.style.removeProperty('visibility'); else el.style.setProperty('visibility', v);
      delete el.dataset.artspoFixed;
    });
  };

  // ---- scroll helpers: the page may scroll the window, or an inner container (scroll-hijacking layouts)
  A.scroller = null;
  const docScrollable = () => (document.scrollingElement || document.documentElement).scrollHeight > innerHeight + 40;
  A.pickScroller = () => {
    if (docScrollable()) { A.scroller = null; return 'window'; }
    let best = null, bestArea = 0;
    for (const el of document.body ? document.body.querySelectorAll('*') : []) {
      if (el.scrollHeight <= el.clientHeight + 40) continue;
      const oy = getComputedStyle(el).overflowY;
      if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
      const area = el.clientWidth * el.clientHeight;
      if (area > bestArea) { best = el; bestArea = area; }
    }
    A.scroller = best && bestArea > innerWidth * innerHeight * 0.4 ? best : null;
    return A.scroller ? desc(A.scroller) : 'window';
  };
  A.pos = () => Math.round(A.scroller ? A.scroller.scrollTop : scrollY);
  A.maxPos = () => Math.round(A.scroller
    ? A.scroller.scrollHeight - A.scroller.clientHeight
    : Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0) - innerHeight);
  A.nudge = (px) => { (A.scroller || window).scrollBy(0, px); return A.pos(); };
  // for the full-page shot of a container-scrolling page: let the container grow to its content
  A.unboxScroller = () => {
    if (!A.scroller) return false;
    for (let el = A.scroller; el && el.nodeType === 1; el = el.parentElement) {
      el.style.setProperty('height', 'auto', 'important');
      el.style.setProperty('max-height', 'none', 'important');
      el.style.setProperty('overflow', 'visible', 'important');
    }
    return true;
  };
  // back to the very top; smooth-scroll libraries may need a nudge to drop their own target
  A.toTop = () => {
    try { const l = window.lenis || window.__lenis; if (l && typeof l.scrollTo === 'function') l.scrollTo(0, { immediate: true, force: true }); } catch {}
    (A.scroller || window).scrollTo(0, 0);
    return A.pos();
  };
  A.scrollLock = () => {
    const html = document.documentElement;
    if (html.classList.contains('lenis-stopped')) return 'smooth-scroll library is stopped (a menu or modal may be open)';
    for (const el of [html, document.body]) if (el && getComputedStyle(el).overflowY === 'hidden' && !A.scroller) return `${el.tagName.toLowerCase()} has overflow: hidden`;
    return null;
  };

  // ---- viewport color sampling (called by the service worker per scroll step)
  const bgOf = (el) => {
    while (el && el.nodeType === 1) {
      const cs = getComputedStyle(el);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        const m = cs.backgroundImage.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/i);
        if (/url\(/.test(cs.backgroundImage) && !m) return 'image';
        if (m) return m[0];
      }
      const c = cs.backgroundColor;
      if (c && c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c)) return c;
      if (el.tagName === 'IMG' || el.tagName === 'VIDEO' || el.tagName === 'CANVAS') return el.tagName.toLowerCase();
      el = el.parentElement;
    }
    return 'rgb(255, 255, 255)';
  };
  A.sampleColors = () => {
    const W = innerWidth, H = innerHeight, cols = 24, rows = 15;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const el = document.elementFromPoint(((i + 0.5) * W) / cols, ((j + 0.5) * H) / rows);
        const k = bgOf(el);
        A.colors[k] = (A.colors[k] || 0) + 1;
      }
    }
    return true;
  };
})();
