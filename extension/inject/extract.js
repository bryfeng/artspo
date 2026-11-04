// Evaluated once at the end of the inspection pass (after load + scroll).
// Returns plain JSON: design tokens, components, motion logs, library signals.
(() => {
  const A = window.__artspo || {};
  const desc = A.desc || ((el) => el.tagName.toLowerCase());
  const text = A.text || ((el) => (el.textContent || '').trim().slice(0, 40));
  const VW = innerWidth;
  // "FT Aktual-13a0b0149837d76d" → "FT Aktual"; drop metric-fallback faces ("Inter Placeholder", "X Fallback")
  const cleanFam = (f) => String(f || '').split(',')[0].replace(/["']/g, '').trim()
    .replace(/[-_ ]?[0-9a-f]{8,}$/i, '').replace(/\s+(Placeholder|Fallback)$/i, '').trim();
  const isFallbackFace = (f) => /\s(Placeholder|Fallback)$/i.test(f);
  // keep only shadow layers that draw something (Tailwind ships stacks of transparent zero layers)
  const realShadow = (v) => {
    if (!v || v === 'none') return null;
    const layers = v.split(/,(?![^(]*\))/).map((x) => x.trim()).filter((l) => {
      const c = l.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}|oklab\([^)]*\)|oklch\([^)]*\)|lab\([^)]*\)|color\([^)]*\)/i);
      const alpha = c ? (c[0].match(/[,/]\s*([\d.]+%?)\s*\)$/) || [])[1] : undefined;
      if (alpha !== undefined && parseFloat(alpha) === 0) return false;
      if (c && /^rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(c[0])) return false;
      const nums = l.replace(c ? c[0] : '', '').match(/-?[\d.]+px/g) || [];
      return nums.some((n) => parseFloat(n) !== 0);
    });
    return layers.length ? layers.join(', ') : null;
  };
  const out = { meta: {}, text: {}, type: {}, shape: {}, spacing: {}, components: {}, motion: {}, libs: [], signals: {} };

  // ---------- meta ----------
  const meta = (sel, attr = 'content') => document.querySelector(sel)?.getAttribute(attr) || undefined;
  out.meta = {
    title: document.title,
    description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
    themeColor: meta('meta[name="theme-color"]'),
    generator: meta('meta[name="generator"]'),
    ogImage: meta('meta[property="og:image"]'),
    lang: document.documentElement.lang || undefined,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    pageHeight: document.documentElement.scrollHeight,
  };

  // ---------- walk visible elements once ----------
  const all = Array.from(document.body ? document.body.querySelectorAll('*') : []).slice(0, 6000);
  const tally = (map, key, w = 1, ex) => {
    if (key == null || key === '') return;
    const e = map[key] || (map[key] = { n: 0, w: 0, ex: [] });
    e.n++; e.w += w;
    if (ex && e.ex.length < 3 && !e.ex.includes(ex)) e.ex.push(ex);
  };
  const textColor = {}, families = {}, sizes = {}, radii = {}, shadows = {}, borders = {}, pads = {}, gaps = {}, transitions = {};
  const headings = [];
  const pictures = []; // [el, rect, computed style, url, kind] for the media inventory below
  let bodyLine;

  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (el.tagName === 'IMG' && el.currentSrc) pictures.push([el, r, cs, el.currentSrc, 'img']);
    if (cs.backgroundImage && cs.backgroundImage.includes('url(')) {
      for (const m of cs.backgroundImage.matchAll(/url\((['"]?)(.*?)\1\)/g)) pictures.push([el, r, cs, m[2], 'background']);
    }

    // own text length (direct text nodes only)
    let own = 0;
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent.trim().length;
    if (own > 0) {
      tally(textColor, cs.color, own);
      const fam = cleanFam(cs.fontFamily);
      tally(families, fam, own, el.tagName.toLowerCase());
      const key = `${Math.round(parseFloat(cs.fontSize))}|${cs.fontWeight}|${fam}`;
      tally(sizes, key, own, text(el).slice(0, 28));
      if (el.tagName === 'P' && own > 40 && (!bodyLine || own > bodyLine.chars)) {
        bodyLine = { size: cs.fontSize, lineHeight: cs.lineHeight, family: fam, maxWidth: Math.round(r.width), chars: own };
      }
    }
    if (/^H[1-3]$/.test(el.tagName) && headings.length < 8) {
      headings.push({
        tag: el.tagName.toLowerCase(), text: text(el), size: cs.fontSize, weight: cs.fontWeight,
        family: cleanFam(cs.fontFamily), letterSpacing: cs.letterSpacing,
        lineHeight: cs.lineHeight, transform: cs.textTransform !== 'none' ? cs.textTransform : undefined,
      });
    }

    const hasBg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none';
    const hasBorder = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
    if ((hasBg || hasBorder || el.tagName === 'IMG') && cs.borderTopLeftRadius !== '0px') {
      tally(radii, cs.borderRadius, 1, desc(el));
    }
    const sh = realShadow(cs.boxShadow);
    if (sh) tally(shadows, sh, 1, desc(el));
    if (hasBorder) tally(borders, `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, 1, desc(el));

    // section rhythm: big blocks' vertical padding
    if (r.width > VW * 0.6 && !el.classList.contains('pin-spacer')) {
      for (const p of [cs.paddingTop, cs.paddingBottom]) if (parseFloat(p) >= 16) tally(pads, p);
    }
    if (cs.display.includes('flex') || cs.display.includes('grid')) {
      if (cs.rowGap && cs.rowGap !== 'normal' && cs.rowGap !== '0px') tally(gaps, cs.rowGap);
      if (cs.columnGap && cs.columnGap !== 'normal' && cs.columnGap !== '0px') tally(gaps, cs.columnGap);
    }

    // declared transitions (hover / state changes we didn't trigger)
    if (cs.transitionDuration && cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0)) {
      const props = cs.transitionProperty.split(',').map((s) => s.trim());
      const durs = cs.transitionDuration.split(',').map((s) => s.trim());
      const eases = cs.transitionTimingFunction.split(/,(?![^(]*\))/).map((s) => s.trim());
      props.forEach((p, i) => {
        const d = durs[i % durs.length];
        if (parseFloat(d) <= 0) return;
        tally(transitions, `${p}|${d}|${eases[i % eases.length]}`, 1, desc(el));
      });
    }
  }

  const top = (map, n, by = 'w') =>
    Object.entries(map).sort((a, b) => b[1][by] - a[1][by]).slice(0, n).map(([k, v]) => ({ value: k, n: v.n, w: v.w, ex: v.ex }));

  out.text.colors = top(textColor, 6);
  out.type.families = top(families, 5);
  out.type.sizes = top(sizes, 10);
  out.type.headings = headings;
  out.type.body = bodyLine;
  out.type.fontFaces = Array.from(document.fonts || [])
    .filter((f) => f.status === 'loaded' && !isFallbackFace(f.family.replace(/["']/g, '')))
    .map((f) => `${cleanFam(f.family)} ${f.weight}${f.style !== 'normal' ? ' ' + f.style : ''}`)
    .filter((v, i, a) => a.indexOf(v) === i).slice(0, 16);
  out.shape.radii = top(radii, 6, 'n');
  out.shape.shadows = top(shadows, 4, 'n');
  out.shape.borders = top(borders, 4, 'n');
  out.spacing.sectionPadding = top(pads, 6, 'n');
  out.spacing.gaps = top(gaps, 6, 'n');
  out.motion.declaredTransitions = top(transitions, 14, 'n');

  // ---------- components: buttons / CTAs ----------
  const btns = {};
  const CMP_BOX = '[class*="cky-"],[id*="onetrust"],[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="Cybot"],[id*="didomi"],[id*="usercentrics"]';
  for (const el of document.querySelectorAll('a, button, [role="button"], input[type="submit"]')) {
    if (el.closest(CMP_BOX)) continue; // consent dialogs aren't the site's design
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 24 || r.height > 90) continue;
    const cs = getComputedStyle(el);
    const bgc = cs.backgroundColor;
    const filled = bgc !== 'rgba(0, 0, 0, 0)' && bgc !== 'transparent';
    const outlined = !filled && parseFloat(cs.borderTopWidth) > 0;
    if (!filled && !outlined) continue;
    const key = [filled ? 'filled' : 'outline', bgc, cs.color, cs.borderRadius, cs.fontWeight, cs.textTransform, cs.borderTopColor].join('|');
    const e = btns[key] || (btns[key] = {
      kind: filled ? 'filled' : 'outline', background: bgc, color: cs.color, radius: cs.borderRadius,
      padding: `${cs.paddingTop} ${cs.paddingRight}`, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
      textTransform: cs.textTransform !== 'none' ? cs.textTransform : undefined,
      border: outlined ? `${cs.borderTopWidth} ${cs.borderTopColor}` : undefined,
      height: Math.round(r.height), n: 0, labels: [],
    });
    e.n++;
    const t = text(el);
    if (t && e.labels.length < 3 && !e.labels.includes(t)) e.labels.push(t);
  }
  out.components.buttons = Object.values(btns).sort((a, b) => b.n - a.n).slice(0, 4);

  // ---------- motion logs from instrumentation ----------
  out.motion.css = A.css || [];
  out.motion.waapi = A.waapi || [];
  out.motion.gsap = A.gsap || [];
  out.motion.inline = A.inline ? Array.from(A.inline.values()).filter((r) => r.segs.some((s) => s.n >= 3)) : [];
  out.motion.running = (document.getAnimations ? document.getAnimations() : []).slice(0, 40).map((a) => {
    const t = a.effect?.getTiming?.() || {};
    return {
      type: a.constructor.name, name: a.animationName || a.transitionProperty || a.id || '',
      el: a.effect?.target ? desc(a.effect.target) : '?', duration: t.duration, easing: t.easing,
      iterations: t.iterations, delay: t.delay,
    };
  });

  // GSAP runtime (when exposed globally): live tweens + ScrollTriggers
  try {
    const g = window.gsap;
    if (g?.globalTimeline) {
      out.motion.gsapLive = g.globalTimeline.getChildren(true, true, false).slice(0, 40).map((tw) => ({
        targets: (tw.targets?.() || []).slice(0, 1).map((t) => (t.nodeType === 1 ? desc(t) : typeof t))[0],
        duration: tw.duration?.(), ease: typeof tw.vars?.ease === 'string' ? tw.vars.ease : undefined,
        delay: tw.vars?.delay, props: Object.keys(tw.vars || {}).filter((k) => !/^(on|ease|duration|delay|scrollTrigger)/.test(k)).slice(0, 6),
      }));
    }
    const ST = window.ScrollTrigger || g?.core?.globals?.()?.ScrollTrigger;
    if (ST?.getAll) {
      out.motion.scrollTriggers = ST.getAll().slice(0, 30).map((st) => ({
        trigger: st.trigger ? desc(st.trigger) : '?', start: Math.round(st.start), end: Math.round(st.end),
        startSpec: String(st.vars?.start ?? ''), endSpec: String(st.vars?.end ?? ''),
        scrub: st.vars?.scrub, pin: !!st.vars?.pin,
        animation: st.animation ? { duration: st.animation.duration?.(), ease: st.animation.vars?.ease } : undefined,
      }));
    }
  } catch {}

  // ---------- @keyframes from readable stylesheets ----------
  const keyframes = {};
  const blocked = [];
  const usedNames = new Set((A.css || []).filter((c) => c.kind === 'animation').map((c) => c.name));
  for (const a of out.motion.running) if (a.name) usedNames.add(a.name);
  const walk = (rules) => {
    for (const r of rules) {
      if (r.type === 7 /* KEYFRAMES_RULE */) {
        if (Object.keys(keyframes).length < 40) keyframes[r.name] = r.cssText.replace(/\s+/g, ' ').slice(0, 600);
      } else if (r.cssRules) {
        try { walk(r.cssRules); } catch {}
      }
    }
  };
  for (const sh of document.styleSheets) {
    try { walk(sh.cssRules); } catch { if (sh.href) blocked.push(sh.href); }
  }
  out.motion.keyframes = keyframes;
  out.motion.usedKeyframes = Array.from(usedNames);
  out.blockedStylesheets = blocked.slice(0, 12);

  // ---------- library & platform signals ----------
  const scripts = Array.from(document.scripts).map((s) => s.src).filter(Boolean);
  const src = (re) => scripts.some((s) => re.test(s));
  const has = (sel) => { try { return !!document.querySelector(sel); } catch { return false; } };
  const html = document.documentElement;
  const libs = [];
  const add = (name, ok, note) => { if (ok) libs.push(note ? `${name} (${note})` : name); };
  add('GSAP', !!window.gsap || A.gsapGlobal || src(/gsap|greensock|TweenMax/i), window.gsap ? 'global' : 'bundled or script');
  add('ScrollTrigger', !!window.ScrollTrigger || src(/ScrollTrigger/i) || has('.pin-spacer'));
  add('Lenis smooth scroll', !!window.Lenis || !!window.lenis || html.classList.contains('lenis') || src(/lenis/i));
  add('Locomotive Scroll', !!window.LocomotiveScroll || html.classList.contains('has-scroll-smooth') || has('[data-scroll-container]'));
  add('Framer Motion / Framer', has('[data-framer-name],[data-framer-appear-id],[data-projection-id]') || /framer/i.test(out.meta.generator || ''));
  add('Webflow interactions', html.hasAttribute('data-wf-site') || has('[data-w-id]'));
  add('Lottie', !!(window.lottie || window.bodymovin) || has('lottie-player,dotlottie-player,[data-animation-path]') || src(/lottie|bodymovin/i));
  add('Rive', has('canvas[class*="rive" i]') || src(/rive/i));
  add('Spline', has('spline-viewer') || src(/spline/i));
  add('Three.js', !!window.THREE || src(/three(\.module)?(\.min)?\.js/i));
  add('WebGL canvas', !!(A.canvas && (A.canvas.webgl || A.canvas.webgl2 || A.canvas['experimental-webgl'])));
  add('Swiper', !!window.Swiper || has('.swiper'));
  add('Splide', has('.splide'));
  add('AOS (animate on scroll)', has('[data-aos]'));
  add('Barba / Swup page transitions', has('[data-barba],[data-swup]') || !!window.barba);
  add('Motion One', !!window.Motion);
  add('anime.js', !!window.anime || src(/anime(\.min)?\.js/i));
  add('Next.js', !!window.__NEXT_DATA__ || has('#__next'));
  add('Nuxt', !!window.__NUXT__);
  add('Tailwind (utility classes)', has('[class*="px-"][class*="py-"]'));
  out.libs = libs;

  out.signals = {
    video: document.querySelectorAll('video').length,
    autoplayVideo: Array.from(document.querySelectorAll('video')).filter((v) => v.autoplay || !v.paused).length,
    canvas: document.querySelectorAll('canvas').length,
    canvasContexts: A.canvas || {},
    iframes: document.querySelectorAll('iframe').length,
    svgAnimated: document.querySelectorAll('svg animate, svg animateTransform, svg animateMotion').length,
    cursorFollow: has('[class*="cursor" i]:not(body):not(html)'),
    details: document.querySelectorAll('details, [aria-expanded]').length,
  };

  // ---------- media: the page's own vector art, images, video and animation files ----------
  // An inventory of what's on the page, with each item's role and treatment. The inspector then takes the files
  // themselves from Chrome's network cache and saves them into the clip's assets/ folder.
  try { out.media = media(); } catch (e) { out.media = { error: String(e?.message || e) }; }

  // background color samples from the scroll pass
  out.bgSamples = A.colors || {};
  return out;

  function media() {
    const top0 = scrollY;
    const abs = (u) => { try { return new URL(u, location.href).href; } catch { return ''; } };
    const hayOf = (el, extra = '') => [el.id, el.getAttribute('class'), el.getAttribute('aria-label'), el.getAttribute('alt'), el.getAttribute('title'), extra].join(' ');
    const home = (el) => el.closest(`a[href="/"],a[href="./"],a[href="${location.origin}"],a[href="${location.origin}/"]`);
    const roleOf = (el, r, extra = '') => {
      const y = r.top + top0;
      const side = Math.max(r.width, r.height);
      if (/(^|[\s_-])(logo|brand|wordmark|logotype)/i.test(hayOf(el, extra)) || (home(el) && y < 240 && side > 24)) return 'logo';
      if (side <= 48) return 'icon';
      const round = parseFloat(getComputedStyle(el).borderTopLeftRadius) >= Math.min(r.width, r.height) / 3;
      if (/avatar|author|profile|headshot/i.test(hayOf(el, extra)) || (side <= 128 && Math.abs(r.width - r.height) < 6 && round)) return 'avatar';
      if (y < innerHeight && r.width * r.height > innerWidth * innerHeight * 0.18) return 'hero';
      return null;
    };
    const treatment = (cs, el) => ({
      fit: el.tagName === 'IMG' && cs.objectFit !== 'fill' ? cs.objectFit : undefined,
      radius: cs.borderRadius && cs.borderRadius !== '0px' ? cs.borderRadius : undefined,
      filter: cs.filter && cs.filter !== 'none' ? cs.filter : undefined,
      blend: cs.mixBlendMode && cs.mixBlendMode !== 'normal' ? cs.mixBlendMode : undefined,
      mask: (cs.maskImage || cs.webkitMaskImage || 'none') !== 'none' ? true : undefined,
      opacity: +cs.opacity < 1 ? +(+cs.opacity).toFixed(2) : undefined,
    });

    // -- inline SVG: serialized with its computed paint, so the file looks the same outside the page's CSS
    const NS = 'http://www.w3.org/2000/svg';
    const PAINT = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'fill-rule', 'opacity', 'fill-opacity', 'stroke-opacity'];
    const SHAPE = /^(path|circle|rect|line|polyline|polygon|ellipse|text|tspan|use)$/;
    const LOTTIE = 'lottie-player,dotlottie-player,dotlottie-wc,[data-animation-path],[data-lottie],[data-animation-type="lottie"]';
    // what the drawing stands for: its own label, else the label of the button or link it sits in
    const labelOf = (svg) => {
      const own = svg.getAttribute('aria-label') || svg.querySelector('title')?.textContent || '';
      const host = svg.closest('a,button,[role="button"]');
      const t = own || host?.getAttribute('aria-label') || host?.getAttribute('title') || (host?.textContent || '').trim();
      return t && t.trim().length <= 32 ? t.trim() : undefined;
    };
    const urlRef = (v) => v.replace(/url\(["']?[^#"')]*#([^"')]+)["']?\)/g, 'url(#$1)');
    const mode = (arr) => { const c = {}; let best, n = 0; for (const v of arr) if (v != null) { c[v] = (c[v] || 0) + 1; if (c[v] > n) { n = c[v]; best = v; } } return best; };
    const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + s.length.toString(36); };
    const svgs = new Map();
    let markupBudget = 4e6;
    for (const svg of Array.from(document.querySelectorAll('svg')).slice(0, 600)) {
      if (svg.ownerSVGElement) continue;                                   // nested: part of a bigger drawing
      if (svg.closest(LOTTIE) || svg.querySelector('[id^="__lottie_element"]')) continue; // a Lottie frame; the JSON is saved instead
      const r = svg.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;                           // sprite sheets and hidden defs
      const cs = getComputedStyle(svg);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const clone = svg.cloneNode(true);
      const src = [svg, ...svg.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
      const strokes = [], caps = [], joins = [], colors = new Set();
      let line = 0, solid = 0, shapes = 0;
      src.forEach((el, i) => {
        if (i > 1500) return; // a huge illustration: paint the first 1,500 elements, keep the rest as drawn in the markup
        const tag = el.tagName.toLowerCase();
        if (i && !SHAPE.test(tag) && tag !== 'g') return;
        const s = getComputedStyle(el);
        for (const p of PAINT) { const v = s.getPropertyValue(p); if (v) dst[i].setAttribute(p, urlRef(v)); }
        if (!SHAPE.test(tag)) return;
        shapes++;
        const stroked = s.stroke !== 'none' && parseFloat(s.strokeWidth) > 0;
        const filled = s.fill !== 'none' && parseFloat(s.fillOpacity) > 0;
        if (stroked) { strokes.push(s.strokeWidth); caps.push(s.strokeLinecap); joins.push(s.strokeLinejoin); if (!s.stroke.startsWith('url')) colors.add(s.stroke); }
        if (filled && !s.fill.startsWith('url')) colors.add(s.fill);
        if (stroked && !filled) line++; else if (filled && !stroked) solid++;
      });
      // sprite icons (<use href="#icon">): draw the referenced symbol in place, so the file stands alone
      for (const u of clone.querySelectorAll('use')) {
        const ref = u.getAttribute('href') || u.getAttribute('xlink:href') || '';
        const target = ref.startsWith('#') && document.getElementById(ref.slice(1));
        if (!target) continue;
        const g = document.createElementNS(NS, 'g');
        for (const at of Array.from(u.attributes)) if (!/^(href|xlink:href|x|y|width|height)$/.test(at.name)) g.setAttribute(at.name, at.value);
        const x = u.getAttribute('x'), y = u.getAttribute('y');
        if (x || y) g.setAttribute('transform', `translate(${x || 0} ${y || 0})${g.getAttribute('transform') ? ' ' + g.getAttribute('transform') : ''}`);
        if (target.tagName.toLowerCase() === 'symbol') {
          if (!clone.getAttribute('viewBox') && target.getAttribute('viewBox')) clone.setAttribute('viewBox', target.getAttribute('viewBox'));
          for (const c of Array.from(target.childNodes)) g.append(c.cloneNode(true));
        } else g.append(target.cloneNode(true));
        u.replaceWith(g);
      }
      clone.setAttribute('xmlns', NS);
      if (!clone.getAttribute('width')) clone.setAttribute('width', String(Math.round(r.width)));
      if (!clone.getAttribute('height')) clone.setAttribute('height', String(Math.round(r.height)));
      let markup = new XMLSerializer().serializeToString(clone);
      const key = hash(markup);
      const seen = svgs.get(key);
      if (seen) { seen.n++; continue; }
      if (markup.length > 200000 || markup.length > markupBudget) markup = '';
      markupBudget -= markup.length;
      svgs.set(key, {
        key, markup, w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.top + top0),
        viewBox: clone.getAttribute('viewBox') || undefined, role: roleOf(svg, r) || (Math.max(r.width, r.height) > 120 ? 'illustration' : 'graphic'),
        style: line && !solid ? 'line' : solid && !line ? 'solid' : shapes ? 'mixed' : undefined,
        strokeWidth: mode(strokes), cap: mode(caps), join: mode(joins), colors: [...colors].slice(0, 4), shapes, n: 1,
        label: labelOf(svg),
      });
    }

    // -- images: <img> and CSS backgrounds, with where and how they're shown
    const images = new Map();
    for (const [el, r, cs, raw, kind] of pictures) {
      const url = raw.startsWith('data:') ? raw : abs(raw);
      if (!url || url.startsWith('blob:') || (url.startsWith('data:') && url.length > 400000)) continue;
      const hit = images.get(url);
      if (hit) { hit.n++; continue; }
      const alt = el.tagName === 'IMG' ? (el.getAttribute('alt') || '').trim().slice(0, 80) : '';
      images.set(url, {
        url, kind, role: roleOf(el, r, url.startsWith('data:') ? '' : url) || (kind === 'background' ? 'background' : null),
        w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.top + top0),
        nw: el.naturalWidth || undefined, nh: el.naturalHeight || undefined, alt: alt || undefined,
        repeat: kind === 'background' && cs.backgroundRepeat !== 'no-repeat' && !/cover|contain/.test(cs.backgroundSize) ? cs.backgroundRepeat : undefined,
        ...treatment(cs, el), n: 1,
      });
    }

    // -- video
    const videos = [];
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const src = v.currentSrc || v.src || v.querySelector('source')?.src || '';
      videos.push({
        url: src.startsWith('blob:') ? '' : abs(src), streamed: src.startsWith('blob:') || undefined, poster: v.poster ? abs(v.poster) : undefined,
        w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.top + top0), vw: v.videoWidth || undefined, vh: v.videoHeight || undefined,
        duration: Number.isFinite(v.duration) ? +v.duration.toFixed(1) : undefined, loop: v.loop || undefined, autoplay: v.autoplay || undefined,
        muted: v.muted || undefined, playing: !v.paused || undefined, role: roleOf(v, r), ...treatment(getComputedStyle(v), v),
      });
      if (videos.length >= 20) break;
    }

    // -- animation files the page declares (the inspector also finds them among what the page loaded)
    const lottie = [];
    for (const el of document.querySelectorAll(LOTTIE)) {
      const s = el.getAttribute('src') || el.dataset.animationPath || el.dataset.src || el.dataset.lottie || '';
      if (s && !lottie.includes(abs(s))) lottie.push(abs(s));
    }

    const icons = Array.from(document.querySelectorAll('link[rel~="icon" i],link[rel="apple-touch-icon" i],link[rel="mask-icon" i]'))
      .map((l) => ({ url: abs(l.getAttribute('href') || ''), rel: l.rel, sizes: l.getAttribute('sizes') || undefined, type: l.type || undefined }))
      .filter((i) => i.url).slice(0, 8);
    const share = abs(meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]') || '') || undefined;

    return {
      svgs: [...svgs.values()],
      images: [...images.values()].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 300),
      videos, lottie, icons, share,
      counts: { svg: svgs.size, images: images.size, video: videos.length },
    };
  }
})();
