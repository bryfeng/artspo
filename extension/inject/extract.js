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
  let bodyLine;

  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;

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

  // background color samples from the scroll pass
  out.bgSamples = A.colors || {};
  return out;
})();
