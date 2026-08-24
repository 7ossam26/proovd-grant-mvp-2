/* ============================================================================
   PROOVD-MOTION.JS — the GSAP motion layer
   Source of truth: "Proovd Design System" doc §6.

   Load order (§6.7 — vendored files, never CDN, never hand-inlined,
   never imported from npm — never install the gsap package):
     <script src="vendor/gsap/gsap.min.js"></script>
     <script src="vendor/gsap/ScrollTrigger.min.js"></script>
     <script src="vendor/gsap/Flip.min.js"></script>
     <script src="vendor/gsap/SplitText.min.js"></script>
     <link rel="stylesheet" href="proovd.css">
     <script src="proovd-motion.js"></script>   ← this file, last

   In React: never call init() directly. Mount frontend/src/motion/
   MotionProvider.tsx and drive motion through useProovdMotion() /
   useGsapScope() — a raw init() binds listeners to DOM nodes React
   later replaces, and animations then die silently as the app grows.

   What it does:
   1. Fails loud + safe (§6.6): missing GSAP → html.no-motion + a console
      error; proovd.css then provides jump-cut fallbacks. Nothing is ever
      trapped behind motion.
   2. Waits for fonts before measuring and splitting text, with a timeout
      backstop so a blocked font never stalls the interface.
   3. Implements the §6.5 kit with the exact tuned parameters, exposed two
      ways:
        - declaratively, via data-attributes bound by Proovd.init()
          (data-reveal, data-hover, data-press, data-scroll, data-progress,
           data-count-to, data-grid, data-accordion, data-modal-open,
           data-drawer-open, data-menu-open, data-tabs, data-splash)
        - imperatively, via window.Proovd.* (toast, pageSlide, curtain,
          buttonProgress, numberRoll, …)
   Generators pick recipes; they never invent durations or eases (§6.1).
   ========================================================================= */

(function () {
  'use strict';

  /* ───────────────────────────────── §6.1 MOTION TOKENS — verbatim */
  const MOTION = {
    dur: {
      instant: 0.12, // hover, press, focus response
      quick:   0.20, // small state changes, color swaps
      base:    0.35, // morphs, selection, most component motion
      slow:    0.60, // drawers, flow steps, large reveals
      grand:   0.90, // splash, page transitions — nothing exceeds this
    },
    ease: {
      out:    'power3.out',
      hero:   'power4.out',
      move:   'power2.inOut',
      snap:   'back.out(1.4)',
      bounce: 'bounce.out',
      exit:   'power2.in',
    },
    stagger: { tight: 0.04, base: 0.08 },
    text: { chars: 0.015, words: 0.065, lines: 0.08 },
    dist: { enter: 16 },
  };

  /* ─────────────────────────── fail-loud notice (§3, §6.6) — console only.
     USER REVISION 2026-08-24: this used to paint an accent-yellow bar across
     the top of the page. It is reported to the console instead, by product
     direction — a false brand-failure banner shown to a real customer is worse
     than the failure it was built to catch. Nothing is swallowed: the checks
     still run, the error still fires, and html.no-motion + proovd.css's
     jump-cut fallbacks remain the user-visible degrade. The Set replaces the
     old data-msg DOM dedupe: init() re-runs on every navigation, and a repeat
     of the same message says nothing new. */
  const reported = new Set();
  function notice(msg) {
    if (reported.has(msg)) return;
    reported.add(msg);
    console.error('[proovd] ' + msg);
  }

  /* ───────────────────────────── §6.6 GUARD: no GSAP → degrade loudly.
     proovd.css's `html.no-motion` rules keep every state reachable. */
  if (!window.gsap) {
    document.documentElement.classList.add('no-motion');
    notice('Motion failed to load');
    window.Proovd = new Proxy(
      { MOTION: MOTION, failed: true, notice: notice },
      { get(t, k) { return k in t ? t[k] : function () {}; } }
    );
    return;
  }

  const G = window.gsap;

  /* register whichever plugins the page vendored (§6.7) */
  const PLUGINS = ['Flip', 'ScrollTrigger', 'SplitText', 'ScrambleTextPlugin', 'TextPlugin']
    .map(function (n) { return window[n]; })
    .filter(Boolean);
  if (PLUGINS.length) G.registerPlugin.apply(G, PLUGINS);

  const Flip = window.Flip || null;
  const ST   = window.ScrollTrigger || null;
  const SPLT = window.SplitText || null;
  const HAS_SCRAMBLE = !!window.ScrambleTextPlugin;
  const HAS_TEXT     = !!window.TextPlugin;

  /* force3D belongs in config(), never in defaults(). defaults() copies its
     keys onto EVERY tween's vars, including the internal zero-duration tween
     gsap.delayedCall() builds on a plain callback object — and ScrollTrigger
     calls delayedCall on enable. force3D is a CSSPlugin property, so on a
     non-DOM target no plugin claims it and gsap warns, twice, on every page
     load:  "Invalid property force3D set to true Missing plugin?"
     config() is where the global lives (it ships as force3D:"auto"), and it is
     read only where transforms are actually written, so DOM tweens behave
     exactly as before and the dummy tweens stay quiet. */
  G.config({ force3D: true });
  G.defaults({ ease: MOTION.ease.out, duration: MOTION.dur.base, overwrite: 'auto' });

  /* ───────────────────────────────────────────── shared helpers */
  const RM    = window.matchMedia('(prefers-reduced-motion: reduce)');
  const PHONE = window.matchMedia('(max-width: 600px)');
  const reduced = function () { return RM.matches; };

  /* §6.1: on mobile, multiply durations by 0.85 */
  function t(s) { return PHONE.matches ? s * 0.85 : s; }

  function cssVar(name, el) {
    return getComputedStyle(el || document.documentElement).getPropertyValue(name).trim();
  }
  const BRAND = function () { return cssVar('--brand') || '#41ED98'; };
  const GREY  = function () { return cssVar('--grey')  || '#A2AFA8'; };
  const DARK  = function () { return cssVar('--dark')  || '#013F17'; };
  const MINT  = function () { return cssVar('--mint')  || '#E9FFE1'; };

  /* rest/hover color pairs resolved from the section-mode slots (proovd.css
     writes them into --r-* / --h-* on each button) */
  function hoverColors(el) {
    const cs = getComputedStyle(el);
    const v = function (n) { return cs.getPropertyValue(n).trim(); };
    return {
      rest:  { backgroundColor: v('--r-bg'),  color: v('--r-text'),  outlineColor: v('--r-border') },
      hover: { backgroundColor: v('--h-bg'),  color: v('--h-text'),  outlineColor: v('--h-border') },
    };
  }

  /* content is never hidden behind motion that might not run (§6.6):
     everything we hide is registered here, force-revealed by a backstop */
  const pending = new Set();
  function holdHidden(el) { pending.add(el); G.set(el, { autoAlpha: 0 }); }
  function release(el) { pending.delete(el); }
  setTimeout(function () {
    pending.forEach(function (el) { G.set(el, { autoAlpha: 1, clearProps: 'opacity,visibility' }); });
    pending.clear();
  }, 3000);

  /* ───────────────────────────────── §3 SATOSHI
     Wait for fonts before measuring text. Timeout backstop so a blocked font
     never stalls anything. */
  const fontsReady = Promise.race([
    (document.fonts && document.fonts.ready) || Promise.resolve(),
    new Promise(function (res) { setTimeout(res, 1800); }),
  ]);

  /* ═══════════════════════════════════════════ §6.4/§6.5 TEXT KIT
     All splits revert on complete; masks get breathing room; skip masking
     under tight leading; reduced motion = full text, quick fade. */

  function maskPad(split) {
    (split.masks || []).forEach(function (m) {
      m.style.paddingBlock = '0.15em';
      m.style.marginBlock = '-0.15em';
    });
  }

  function fadeReveal(el) {
    release(el);
    G.to(el, { autoAlpha: 1, duration: MOTION.dur.quick, ease: MOTION.ease.out });
  }

  /* Headline rise — masked words, yPercent 120→0, 0.65s hero, stagger .065 */
  function headlineRise(el) {
    if (reduced() || !SPLT) return fadeReveal(el);
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) / parseFloat(cs.fontSize);
    const canMask = !(lh && lh < 1.1);          // §6.4 tight-leading exception
    try {
      const split = new SPLT(el, canMask
        ? { type: 'lines,words', mask: 'lines' }
        : { type: 'lines,words' });
      if (canMask) maskPad(split);
      G.set(el, { autoAlpha: 1 }); release(el);
      G.from(split.words, {
        yPercent: 120,
        autoAlpha: canMask ? 1 : 0,
        duration: t(0.65),
        ease: MOTION.ease.hero,
        stagger: MOTION.text.words,
        onComplete: function () { split.revert(); },   // §6.4 always revert
      });
    } catch (e) { fadeReveal(el); }
  }

  /* Line flip — whole lines, rotationX -90→0 from the baseline, 0.35s
     power3.in, stagger .03 */
  function lineFlip(el) {
    if (reduced() || !SPLT) return fadeReveal(el);
    try {
      const split = new SPLT(el, { type: 'lines' });
      G.set(el, { autoAlpha: 1, perspective: 600 }); release(el);
      G.from(split.lines, {
        rotationX: -90,
        y: '0.5em',
        autoAlpha: 0,
        transformOrigin: '50% 100%',
        duration: t(0.35),
        ease: 'power3.in',
        stagger: 0.03,
        onComplete: function () { split.revert(); G.set(el, { clearProps: 'perspective' }); },
      });
    } catch (e) { fadeReveal(el); }
  }

  /* Word slide — words from the left, x -60→0 + fade, 0.55s, stagger .04 */
  function wordSlide(el) {
    if (reduced() || !SPLT) return fadeReveal(el);
    try {
      const split = new SPLT(el, { type: 'words' });
      G.set(el, { autoAlpha: 1 }); release(el);
      G.from(split.words, {
        x: -60,
        autoAlpha: 0,
        duration: t(0.55),
        ease: MOTION.ease.out,
        stagger: 0.04,
        onComplete: function () { split.revert(); },
      });
    } catch (e) { fadeReveal(el); }
  }

  /* Scramble — 0.4s, one live status word settling. Never body copy. */
  function scramble(el, text) {
    const target = text != null ? text : el.textContent;
    if (reduced() || !HAS_SCRAMBLE) { el.textContent = target; return; }
    G.to(el, { duration: t(0.4), ease: 'none',
      scrambleText: { text: target, chars: 'upperAndLowerCase' } });
  }

  /* Typewriter — 0.7s, the product speaking one conversational line. */
  function typewriter(el, text) {
    const target = text != null ? text : (el.getAttribute('data-type-text') || el.textContent);
    if (reduced() || !HAS_TEXT) { el.textContent = target; return; }
    el.textContent = '';
    G.set(el, { autoAlpha: 1 }); release(el);
    G.to(el, { duration: t(0.7), ease: 'none', text: target });
  }

  const REVEALS = { headline: headlineRise, lede: lineFlip, kicker: wordSlide, typewriter: typewriter };

  /* ═══════════════════════════════════════════ §6.5 HOVER + PRESS
     Interaction feedback answers within `instant` (§6.1). */

  function bindHover(el, kind) {
    if (el.__pvHover) return;
    el.__pvHover = true;
    if (reduced()) kind = kind === 'sweep' || kind === 'swap' ? 'colors' : 'none';

    const inD  = t(0.15), outD = t(0.2);

    if (kind === 'swap' || kind === 'colors' || kind === 'primary') {
      const scaleTo = kind === 'swap' ? 1.3 : kind === 'primary' ? 1.02 : 1;
      el.addEventListener('mouseenter', function () {
        if (el.__pvBusy) return;
        const c = hoverColors(el);
        G.to(el, Object.assign({ scale: reduced() ? 1 : scaleTo, duration: inD, ease: 'power2.out' }, c.hover));
      });
      el.addEventListener('mouseleave', function () {
        if (el.__pvBusy) return;
        const c = hoverColors(el);
        G.to(el, Object.assign({ scale: 1, duration: outD, ease: 'power2.out' }, c.rest));
      });
    }

    if (kind === 'grow') {
      el.addEventListener('mouseenter', function () { G.to(el, { scale: 1.3, duration: inD, ease: 'power2.out' }); });
      el.addEventListener('mouseleave', function () { G.to(el, { scale: 1,   duration: outD, ease: 'power2.out' }); });
    }

    /* Underline draw — scaleX 0→1 from the left, collapse to the right */
    if (kind === 'underline') {
      el.classList.add('u');
      el.addEventListener('mouseenter', function () {
        G.set(el, { '--uo': 'left center' });
        G.to(el, { '--u': 1, duration: t(0.3), ease: MOTION.ease.out });
      });
      el.addEventListener('mouseleave', function () {
        G.set(el, { '--uo': 'right center' });
        G.to(el, { '--u': 0, duration: t(0.3), ease: MOTION.ease.out });
      });
    }

    /* Fill sweep — brand fill sweeps in L→R behind the label, reverses R→L */
    if (kind === 'sweep') {
      /* intent delay: the sweep waits ~0.1s, so grazing past the button
         never flashes — a killed timeline before first render shows nothing */
      let enterTl = null;
      el.addEventListener('mouseenter', function () {
        const c = hoverColors(el);
        if (enterTl) enterTl.kill();
        G.set(el, { '--so': 'left center' });
        enterTl = G.timeline({ delay: 0.1 })
          .to(el, { '--sweep': 1, duration: t(0.3), ease: 'power2.out' }, 0)
          .to(el, { color: c.hover.color, outlineColor: c.hover.outlineColor, duration: t(0.3), ease: 'power2.out' }, 0);
      });
      el.addEventListener('mouseleave', function () {
        if (enterTl) { enterTl.kill(); enterTl = null; }
        const c = hoverColors(el);
        G.set(el, { '--so': 'right center' });
        G.to(el, { '--sweep': 0, duration: t(0.3), ease: 'power2.out' });
        G.to(el, { color: c.rest.color, outlineColor: c.rest.outlineColor, duration: t(0.3), ease: 'power2.out' });
      });
    }
  }

  /* Press — compress to 0.78 (default) or squash & pop (delight, §5.8) */
  function bindPress(el, kind) {
    if (el.__pvPress || reduced()) return;
    el.__pvPress = true;
    const down = function (e) {
      /* capture the pointer: the compress moves edges out from under the
         finger, which used to swallow clicks near the rim */
      if (el.setPointerCapture && e && e.pointerId !== undefined) {
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
      }
      if (kind === 'pop') G.to(el, { scaleX: 1.06, scaleY: 0.9, duration: t(0.12), ease: 'power2.out' });
      else G.to(el, { scale: 0.78, duration: t(0.12), ease: 'power2.out' });
    };
    const up = function () {
      if (kind === 'pop') G.to(el, { scaleX: 1, scaleY: 1, duration: t(0.4), ease: 'back.out(2.5)' });
      else G.to(el, { scale: 1, duration: t(0.25), ease: MOTION.ease.out });
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('pointercancel', up);
  }

  /* ═══════════════════════════════════════════ STATE (§6.3 tier 2) */

  /* Toggle — knob travels (quick, ease move); track tweens to selection */
  function bindToggle(tg) {
    if (tg.__pvToggle) return;
    tg.__pvToggle = true;
    const knob = tg.querySelector('.toggle__knob');
    if (!knob) return;
    const travel = function () { return tg.clientWidth - knob.offsetWidth - 6; };
    if (tg.classList.contains('is-on')) G.set(knob, { x: travel() });
    tg.setAttribute('aria-pressed', String(tg.classList.contains('is-on')));
    tg.addEventListener('click', function () {
      const on = tg.classList.toggle('is-on');
      tg.setAttribute('aria-pressed', String(on));
      const d = reduced() ? 0 : t(MOTION.dur.quick);
      /* USER REVISION: on-state = dark fill + mint knob */
      G.to(knob, { x: on ? travel() : 0, duration: d, ease: MOTION.ease.move });
      G.to(knob, { backgroundColor: on ? MINT() : GREY(), duration: d });
      G.to(tg,   { outlineColor: on ? DARK() : GREY(),
                   backgroundColor: on ? DARK() : '#FFFFFF',
                   duration: d });
    });
  }

  /* Check draw — SVG stroke via dashoffset, 0.6s */
  function checkDraw(path) {
    if (!path || !path.getTotalLength) return;
    const len = path.getTotalLength();
    G.set(path, { strokeDasharray: len, strokeDashoffset: len, opacity: 1 });
    G.to(path, { strokeDashoffset: 0, duration: reduced() ? 0 : t(0.6), ease: MOTION.ease.out });
  }

  /* Checkbox / selectable option — selection treatment animates in (§1) */
  function bindOption(op) {
    if (op.__pvOption) return;
    op.__pvOption = true;
    op.setAttribute('aria-pressed', String(op.classList.contains('is-selected')));
    op.addEventListener('click', function () {
      const on = op.classList.toggle('is-selected');
      op.setAttribute('aria-pressed', String(on));
      const path = op.querySelector('.option__box path');
      if (on && path && !reduced()) checkDraw(path);
    });
  }

  /* Stepper — the giant number bumps directionally: out the way you push,
     in from the other side (≈0.3s total). At min/max it shakes its head.
     Optional data-min / data-max on the .stepper (default min 0). */
  function bindStepper(st) {
    if (st.__pvStep) return;
    st.__pvStep = true;
    const val = st.querySelector('.stepper__value');
    if (!val) return;
    let num = val.querySelector('.stepper__num');
    if (!num) {
      num = document.createElement('span');
      num.className = 'stepper__num';
      num.textContent = val.textContent.trim();
      val.textContent = '';
      val.appendChild(num);
    }
    const min = st.hasAttribute('data-min') ? parseFloat(st.getAttribute('data-min')) : 0;
    const max = st.hasAttribute('data-max') ? parseFloat(st.getAttribute('data-max')) : Infinity;
    const bump = function (dir) {
      const cur = parseFloat(num.textContent) || 0;
      const next = Math.min(max, Math.max(min, cur + dir));
      if (next === cur) {
        if (!reduced()) {
          G.fromTo(num, { x: 0 }, { x: dir * 6, duration: t(0.07), yoyo: true, repeat: 3,
            ease: 'power1.inOut', clearProps: 'x' });
        }
        return;
      }
      if (reduced()) { num.textContent = next; return; }
      G.timeline()
        .to(num, { yPercent: dir * -70, autoAlpha: 0, duration: t(0.1), ease: MOTION.ease.exit })
        .add(function () { num.textContent = next; })
        .fromTo(num, { yPercent: dir * 70 },
          { yPercent: 0, autoAlpha: 1, duration: t(0.2), ease: MOTION.ease.snap });
    };
    st.addEventListener('click', function (e) {
      const b = e.target.closest('.stepper__btn');
      if (!b || !st.contains(b)) return;
      bump((b.getAttribute('data-step') === '-1' || /[−-]/.test(b.textContent)) ? -1 : 1);
    });
  }

  /* Text input — border tweens to brand on focus, grey on blur (§6.5) */
  function bindInput(input) {
    if (input.__pvInput) return;
    input.__pvInput = true;
    if (!input.placeholder && !input.getAttribute('aria-label') && !input.id) {
      console.warn('Proovd (§7.1): input without placeholder or label — an input is never a silent box.', input);
    }
    input.addEventListener('focusin', function () {
      G.to(input, { outlineColor: BRAND(), duration: t(MOTION.dur.base), ease: MOTION.ease.out });
    });
    input.addEventListener('focusout', function () {
      G.to(input, { outlineColor: GREY(), duration: t(MOTION.dur.quick), ease: MOTION.ease.out });
    });
    /* opt-in focus morph: [data-morph-focus] grows via .is-focused (define
       the size change in CSS; Flip animates it) */
    if (input.hasAttribute('data-morph-focus')) {
      input.addEventListener('focusin', function () {
        morph(input, function () { input.classList.add('is-focused'); });
      });
      input.addEventListener('focusout', function () {
        morph(input, function () { input.classList.remove('is-focused'); });
      });
    }
  }

  /* Number roll — values travel, they don't blink. 0.65s power2.out */
  function numberRoll(el, to) {
    const target = parseFloat(String(to).replace(/[^\d.\-]/g, ''));
    if (isNaN(target)) return;
    const from = parseFloat(String(el.textContent).replace(/[^\d.\-]/g, '')) || 0;
    if (reduced()) { el.textContent = target.toLocaleString(); return; }
    const decimals = (String(to).split('.')[1] || '').length;
    const proxy = { v: from };
    G.to(proxy, {
      v: target, duration: t(0.65), ease: 'power2.out',
      onUpdate: function () {
        el.textContent = decimals
          ? proxy.v.toFixed(decimals)
          : Math.round(proxy.v).toLocaleString();
      },
    });
  }

  /* Progress fill — scaleX 0→pct, 0.95s bounce.out (hard rule treatment §1) */
  function progress(el, pct) {
    const fill = el.querySelector('.progress__fill') || el;
    const p = Math.max(0, Math.min(1, pct));
    el.style.setProperty('--p', p);                    // no-motion parity
    G.to(fill, { scaleX: p, duration: reduced() ? MOTION.dur.quick : t(0.95),
                 ease: reduced() ? MOTION.ease.out : MOTION.ease.bounce });
  }

  /* ═══════════════════════════════════════════ COMPONENTS (§6.3 tier 3) */

  /* Toast — enters from below with back.out(1.7), holds ~1s, exits down */
  function toast(msg, opts) {
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'toast toast--' + (opts.accent === 'blue' ? 'blue' : 'yellow');
    el.setAttribute('role', 'status');
    el.textContent = msg;
    if (opts.sub) {
      const s = document.createElement('span');
      s.className = 'toast__sub';
      s.textContent = opts.sub;
      el.appendChild(s);
    }
    document.body.appendChild(el);
    G.set(el, { xPercent: -50 });                       // re-center via GSAP
    const hold = opts.hold != null ? opts.hold : 1;
    if (reduced()) {
      setTimeout(function () { el.remove(); }, (hold + 1) * 1000);
      return el;
    }
    G.timeline({ onComplete: function () { el.remove(); } })
      .from(el, { y: 30, autoAlpha: 0, duration: t(0.4), ease: 'back.out(1.7)' })
      .to(el,   { y: 20, autoAlpha: 0, duration: t(0.2), ease: MOTION.ease.exit }, '+=' + hold);
    return el;
  }

  /* Drawer — the Explore surface (§5.2). Sheet from the bottom on phone,
     side drawer from the right on desktop (§8). In .4 + tab stagger; out .28 */
  function drawerOpen(drawer) {
    drawer = typeof drawer === 'string' ? document.querySelector(drawer) : drawer;
    if (!drawer) return;
    drawer.hidden = false;
    const axis = PHONE.matches ? { yPercent: 100 } : { xPercent: 100 };
    if (reduced()) { G.set(drawer, { xPercent: 0, yPercent: 0, autoAlpha: 1 }); return; }
    const tl = G.timeline();
    tl.from(drawer, Object.assign({ duration: t(0.4), ease: MOTION.ease.out }, axis));
    const tabs = drawer.querySelectorAll('.tab');
    if (tabs.length) tl.from(tabs, { y: 16, autoAlpha: 0, duration: t(0.3), stagger: MOTION.stagger.tight }, '-=0.15');
  }
  function drawerClose(drawer) {
    drawer = typeof drawer === 'string' ? document.querySelector(drawer) : drawer;
    if (!drawer) return;
    const axis = PHONE.matches ? { yPercent: 100 } : { xPercent: 100 };
    const done = function () { drawer.hidden = true; G.set(drawer, { clearProps: 'transform,opacity,visibility' }); };
    if (reduced()) return done();
    G.to(drawer, Object.assign({ duration: t(0.28), ease: MOTION.ease.exit, onComplete: done }, axis));
  }

  /* Accordion — height morph 0.2s, chevron rotates 45° (§6.5) */
  function bindAccordion(root) {
    if (root.__pvAcc) return;
    root.__pvAcc = true;
    const head = root.querySelector('.accordion__head');
    const body = root.querySelector('.accordion__body');
    const chev = root.querySelector('.accordion__chev');
    if (!head || !body) return;
    let open = root.classList.contains('is-open');
    G.set(body, { height: open ? 'auto' : 0 });
    if (chev) G.set(chev, { rotation: open ? 45 : 0 });
    head.setAttribute('aria-expanded', String(open));
    head.addEventListener('click', function () {
      open = !open;
      root.classList.toggle('is-open', open);
      head.setAttribute('aria-expanded', String(open));
      const d = reduced() ? 0 : t(0.2);
      G.to(body, { height: open ? 'auto' : 0, duration: d, ease: MOTION.ease.out });
      if (chev) G.to(chev, { rotation: open ? 45 : 0, duration: d, ease: MOTION.ease.out });
    });
  }

  /* Modal — grows from its trigger (§6.5), never fades in from a void */
  function ensureScrim() {
    let scrim = document.querySelector('.scrim');
    if (!scrim) {
      scrim = document.createElement('div');
      scrim.className = 'scrim';
      scrim.hidden = true;
      document.body.appendChild(scrim);
    }
    return scrim;
  }
  let openModal = null;
  function modalOpen(modal, trigger) {
    modal = typeof modal === 'string' ? document.querySelector(modal) : modal;
    if (!modal) return;
    const scrim = ensureScrim();
    scrim.hidden = false; modal.hidden = false;
    openModal = modal;
    G.set(modal, { xPercent: -50, yPercent: -50 });     // keep CSS centering
    if (reduced()) { G.set([modal, scrim], { autoAlpha: 1 }); return; }
    if (trigger && trigger.getBoundingClientRect) {
      const m = modal.getBoundingClientRect();
      const r = trigger.getBoundingClientRect();
      G.set(modal, { transformOrigin:
        (r.left + r.width / 2 - m.left) + 'px ' + (r.top + r.height / 2 - m.top) + 'px' });
    }
    G.from(scrim, { autoAlpha: 0, duration: t(0.25) });
    G.from(modal, { scale: 0.6, autoAlpha: 0, duration: t(0.2), ease: MOTION.ease.out });
  }
  function modalClose(modal) {
    modal = modal || openModal;
    modal = typeof modal === 'string' ? document.querySelector(modal) : modal;
    if (!modal) return;
    const scrim = document.querySelector('.scrim');
    const done = function () {
      modal.hidden = true; if (scrim) scrim.hidden = true;
      G.set(modal, { clearProps: 'all' });
      openModal = null;
    };
    if (reduced()) return done();
    G.to(modal, { scale: 0.85, autoAlpha: 0, duration: t(0.2), ease: MOTION.ease.exit, onComplete: done });
    if (scrim) G.to(scrim, { autoAlpha: 0, duration: t(0.2), ease: MOTION.ease.exit });
  }

  /* Tabs — active color tweens (clearProps so classes stay in charge);
     the underline slides + resizes to the active tab, 0.2s.
     The tab container needs position:relative for the underline. */
  function bindTabs(container) {
    if (container.__pvTabs) return;
    container.__pvTabs = true;
    const underline = container.querySelector('.tab-underline');
    const park = function (animate) {
      if (!underline) return;
      const a = container.querySelector('.tab.is-active');
      if (!a) return;
      const to = { x: a.offsetLeft, width: a.offsetWidth };
      if (animate && !reduced()) {
        G.to(underline, Object.assign({ duration: t(0.2), ease: MOTION.ease.out }, to));
      } else G.set(underline, to);
    };
    park();
    fontsReady.then(function () { park(); });      // widths shift when Satoshi lands
    window.addEventListener('resize', function () { park(); });
    container.addEventListener('click', function (e) {
      const tab = e.target.closest('.tab');
      if (!tab || !container.contains(tab)) return;
      const prev = container.querySelector('.tab.is-active');
      if (prev === tab) return;
      const d = t(MOTION.dur.quick);
      if (prev) {
        const pc = getComputedStyle(prev).color;
        prev.classList.remove('is-active');
        if (!reduced()) G.from(prev, { color: pc, duration: d, clearProps: 'color' });
      }
      const before = getComputedStyle(tab).color;
      tab.classList.add('is-active');
      if (!reduced()) G.from(tab, { color: before, duration: d, clearProps: 'color' });
      park(true);
    });
  }

  /* Dropdown — scaleY unfolds from the top, items stagger; exits fast */
  function bindMenuTrigger(trigger) {
    if (trigger.__pvMenu) return;
    trigger.__pvMenu = true;
    const sel = trigger.getAttribute('data-menu-open');
    const menu = document.querySelector(sel);
    if (!menu) return;
    let open = false;
    const close = function () {
      if (!open) return; open = false;
      const done = function () { menu.hidden = true; G.set(menu, { clearProps: 'all' }); };
      if (reduced()) return done();
      G.to(menu, { scaleY: 0, autoAlpha: 0, duration: t(0.15), ease: MOTION.ease.exit, onComplete: done });
    };
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      if (open) return close();
      open = true; menu.hidden = false;
      if (reduced()) { G.set(menu, { autoAlpha: 1 }); return; }
      G.set(menu, { transformOrigin: 'top center' });
      G.from(menu, { scaleY: 0, autoAlpha: 0, duration: t(0.3), ease: MOTION.ease.out });
      G.from(menu.children, { autoAlpha: 0, y: -8, duration: t(0.25), stagger: MOTION.stagger.tight, delay: 0.05 });
    });
    document.addEventListener('click', function (e) { if (open && !menu.contains(e.target)) close(); });
  }

  /* ═══════════════════════════════════ §6.5 PAGE TRANSITIONS (tier 4)
     Overlap 0.8 — the incoming page moves before the outgoing is gone.
     Direction is semantic: left = forward, right = back, up = opening,
     down = dismissing. */
  const DIRS = {
    left:  { inFrom: { xPercent:  100 }, outTo: { xPercent: -35 } },
    right: { inFrom: { xPercent: -100 }, outTo: { xPercent:  35 } },
    up:    { inFrom: { yPercent:  100 }, outTo: { yPercent: -35 } },
    down:  { inFrom: { yPercent: -100 }, outTo: { yPercent:  35 } },
  };

  function pageSlide(incoming, outgoing, opts) {
    opts = opts || {};
    const D = DIRS[opts.dir || 'left'] || DIRS.left;
    incoming = typeof incoming === 'string' ? document.querySelector(incoming) : incoming;
    outgoing = typeof outgoing === 'string' ? document.querySelector(outgoing) : outgoing;
    if (!incoming) return;
    incoming.hidden = false;
    /* the incoming page must cover the retreating one, whatever the DOM
       order — otherwise the old page shows through on the way back */
    G.set(incoming, { zIndex: 5 });
    if (outgoing) G.set(outgoing, { zIndex: 1 });
    if (reduced()) {
      if (outgoing) { outgoing.hidden = true; }
      G.fromTo(incoming, { autoAlpha: 0 }, { autoAlpha: 1, duration: MOTION.dur.quick, clearProps: 'zIndex' });
      return;
    }
    const dd = t(0.7);
    const tl = G.timeline();
    if (outgoing) {
      tl.to(outgoing, Object.assign({
        autoAlpha: 0.35, duration: dd, ease: MOTION.ease.move,
        onComplete: function () { outgoing.hidden = true; G.set(outgoing, { clearProps: 'transform,opacity,visibility,zIndex' }); },
      }, D.outTo), 0);
    }
    tl.from(incoming, Object.assign({
      duration: dd,
      ease: opts.celebrate ? MOTION.ease.bounce : 'back.out(1.2)',
    }, D.inFrom), dd * (1 - 0.8));                       // overlap 0.8
    tl.set(incoming, { clearProps: 'zIndex' });
    return tl;
  }

  /* Curtain — two #012D10 panels close, swap happens behind, panels part */
  function curtain(swap) {
    const mk = function (side) {
      const p = document.createElement('div');
      p.style.cssText =
        'position:fixed;top:0;bottom:0;' + side + ':0;width:50.5vw;' +
        'background:' + (cssVar('--darker') || '#012D10') + ';z-index:1500;';
      document.body.appendChild(p);
      return p;
    };
    if (reduced()) { return Promise.resolve().then(swap || function () {}); }
    const L = mk('left'), R = mk('right');
    G.set(L, { xPercent: -100 }); G.set(R, { xPercent: 100 });
    return new Promise(function (resolve) {
      const tl = G.timeline({ onComplete: function () { L.remove(); R.remove(); resolve(); } });
      tl.to([L, R], { xPercent: 0, duration: t(0.55), ease: MOTION.ease.move })
        .add(function () { try { if (swap) swap(); } catch (e) { console.error(e); } })
        .to(L, { xPercent: -100, duration: t(0.55), ease: MOTION.ease.move }, '+=0.05')
        .to(R, { xPercent:  100, duration: t(0.55), ease: MOTION.ease.move }, '<');
      /* backstop: never trap the user behind panels (§6.6) */
      setTimeout(function () { if (L.isConnected) { L.remove(); R.remove(); resolve(); } }, 4000);
    });
  }

  /* Unroll — detail rises from the bottom, parent recedes underneath */
  function unroll(incoming, outgoing) {
    incoming = typeof incoming === 'string' ? document.querySelector(incoming) : incoming;
    outgoing = typeof outgoing === 'string' ? document.querySelector(outgoing) : outgoing;
    if (!incoming) return;
    incoming.hidden = false;
    if (reduced()) { G.fromTo(incoming, { autoAlpha: 0 }, { autoAlpha: 1, duration: MOTION.dur.quick }); return; }
    G.set(incoming, { zIndex: 5 });
    if (outgoing) {
      G.set(outgoing, { zIndex: 1 });
      G.to(outgoing, { scale: 0.97, autoAlpha: 0.5, duration: t(0.7), ease: MOTION.ease.move });
    }
    G.from(incoming, { yPercent: 100, duration: t(0.7), ease: MOTION.ease.out,
      onComplete: function () {
        /* the old page is fully covered now — hide it BEFORE dropping the
           incoming page's z-index, or DOM order flashes it back on top */
        if (outgoing) {
          outgoing.hidden = true;
          G.set(outgoing, { clearProps: 'transform,opacity,visibility,zIndex' });
        }
        G.set(incoming, { clearProps: 'zIndex' });
      } });
  }

  /* ═══════════════════════════════════ §6.3 LAYOUT MORPHS (Flip)
     The doc's "things reflow, containers grow" tier. Capture the state,
     make the change, animate the difference — nothing teleports.
       Proovd.morph(el, 'is-expanded')          toggle a class through Flip
       Proovd.morph(el, fn)                     any DOM change (reorder, resize…)
     Entering elements fade/scale in; leaving elements fade out. */
  function morph(target, change, vars) {
    target = typeof target === 'string' ? document.querySelector(target) : target;
    if (!target) return;
    const isFn = typeof change === 'function';
    const apply = isFn ? change : function () { target.classList.toggle(String(change)); };
    if (reduced() || !Flip) { apply(target); return; }
    if (isFn && Flip && target.children.length > 1) {
      /* layout reflow — children move (reorder / add / remove) */
      const state = Flip.getState(target.children);
      apply(target);
      Flip.from(state, Object.assign({
        targets: target.children,
        duration: t(MOTION.dur.base),
        ease: MOTION.ease.out,
        onEnter: function (els) {
          return G.fromTo(els, { autoAlpha: 0, scale: 0.94 }, { autoAlpha: 1, scale: 1, duration: t(0.25) });
        },
        onLeave: function (els) { return G.to(els, { autoAlpha: 0, duration: t(0.15) }); },
      }, vars || {}));
      return;
    }
    /* container morph — manual rect FLIP: measure, change, tween the
       difference. Needs no plugin. Runs at 0.5s (base read as too fast for
       a growing box) and fades entering children in. */
    const visible = function (ch) { return getComputedStyle(ch).display !== 'none'; };
    const before = new Set(Array.prototype.filter.call(target.children, visible));
    const r0 = target.getBoundingClientRect();
    apply(target);
    const r1 = target.getBoundingClientRect();
    const entering = Array.prototype.filter.call(target.children, function (ch) {
      return visible(ch) && !before.has(ch);
    });
    const dur  = (vars && vars.duration) || t(0.5);
    const ease = (vars && vars.ease) || MOTION.ease.out;
    const dh = Math.abs(r1.height - r0.height) > 0.5;
    const dw = Math.abs(r1.width  - r0.width)  > 0.5;
    if (!dh && !dw) {
      if (entering.length) G.from(entering, { autoAlpha: 0, duration: t(0.25) });
      return;
    }
    const prevOverflow = target.style.overflow;
    target.style.overflow = 'hidden';
    const fromV = {};
    const toV = { duration: dur, ease: ease, onComplete: function () {
      G.set(target, { clearProps: 'height,width' });
      target.style.overflow = prevOverflow;
    } };
    if (dh) { fromV.height = r0.height; toV.height = r1.height; }
    if (dw) { fromV.width  = r0.width;  toV.width  = r1.width; }
    G.fromTo(target, fromV, toV);
    if (entering.length) {
      G.fromTo(entering, { autoAlpha: 0, y: 8 },
        { autoAlpha: 1, y: 0, duration: t(0.3), delay: dur * 0.35, ease: MOTION.ease.out, clearProps: 'y' });
    }
  }

  /* data-morph="class-name" — clicking the element toggles the class via Flip */
  function bindMorph(el) {
    if (el.__pvMorph) return;
    el.__pvMorph = true;
    el.addEventListener('click', function () {
      morph(el, el.getAttribute('data-morph') || 'is-expanded');
    });
  }

  /* ═══════════════════════════════════ SCROLL (§6.5) — once, never jacked */
  function bindScroll(el) {
    if (el.__pvScroll) return;
    el.__pvScroll = true;
    const kind = el.getAttribute('data-scroll') || 'rise';
    if (reduced() || !ST) {
      if (ST) {
        G.from(el, { autoAlpha: 0, duration: MOTION.dur.quick,
          scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
      }
      return;
    }
    if (kind === 'scale') {
      G.from(el, { scale: 0.92, autoAlpha: 0, duration: t(0.6), ease: 'back.out(1.2)',
        scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
    } else {
      G.from(el, { y: 48, autoAlpha: 0, duration: t(1.2), ease: MOTION.ease.out,
        scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
    }
  }

  /* Grid assemble — cells scale 0→1, back.out(1.7), from center */
  function gridAssemble(el) {
    const cells = el.children;
    if (!cells.length) return;
    if (reduced()) return;
    const tween = function () {
      G.from(cells, { scale: 0, duration: t(0.75), ease: 'back.out(1.7)',
        stagger: { each: 0.07, from: 'center', grid: 'auto' } });
    };
    if (ST) {
      ST.create({ trigger: el, start: 'top 85%', once: true, onEnter: tween });
    } else tween();
  }

  /* ═══════════════════════════════════ §6.5 BUTTON → PROGRESS → DONE
     One element, three lives. `work` = Promise, seconds, or nothing (1.2s). */
  function buttonProgress(btn, work) {
    if (btn.__pvBusy) return Promise.resolve();
    btn.__pvBusy = true;
    let label = btn.querySelector('.btn__label');
    if (!label) {
      label = document.createElement('span');
      label.className = 'btn__label';
      while (btn.firstChild) label.appendChild(btn.firstChild);
      btn.appendChild(label);
    }
    let fill = btn.querySelector('.btn__fill');
    if (!fill) {
      fill = document.createElement('span');
      fill.className = 'btn__fill';
      btn.insertBefore(fill, label);
    }
    const original = label.textContent;
    btn.disabled = true;

    const wait = (work && typeof work.then === 'function')
      ? work
      : new Promise(function (res) { setTimeout(res, (typeof work === 'number' ? work : 1.2) * 1000); });

    const restore = function () {
      const state = Flip ? Flip.getState(btn) : null;
      btn.classList.remove('is-progress', 'is-done');
      btn.style.minWidth = '';
      label.textContent = original;
      G.set(fill, { scaleX: 0 });
      if (state) Flip.from(state, { duration: t(MOTION.dur.base), ease: MOTION.ease.out });
      btn.disabled = false;
      btn.__pvBusy = false;
    };

    return new Promise(function (resolve) {
      try {
        if (reduced()) {
          btn.classList.add('is-progress');
          label.textContent = 'Working…';
          wait.then(function () {
            label.textContent = '✓';
            setTimeout(function () { restore(); resolve(); }, 900);
          });
          return;
        }
        /* 1 — morph into the progress treatment (width morph, 0.35s) */
        const state = Flip ? Flip.getState(btn) : null;
        btn.classList.add('is-progress');
        btn.style.minWidth = (btn.offsetWidth + 48) + 'px';
        if (state) Flip.from(state, { duration: t(0.35), ease: MOTION.ease.out });
        /* 2 — fill creeps to 90% while the work runs (1.2s power2.inOut) */
        G.to(fill, { scaleX: 0.9, duration: t(1.2), ease: MOTION.ease.move });
        wait.then(function () {
          /* 3 — complete the fill, snap into done */
          G.to(fill, { scaleX: 1, duration: t(0.2), ease: MOTION.ease.out,
            onComplete: function () {
              btn.classList.add('is-done');
              label.textContent = '✓';
              G.from(label, { scale: 0, duration: t(0.4), ease: 'back.out(2)' });
              /* 4 — hold, then morph back */
              G.delayedCall(1.2, function () { restore(); resolve(); });
            } });
        }).catch(function () { restore(); resolve(); });
      } catch (e) { console.error(e); restore(); resolve(); }
    });
  }

  /* ═══════════════════════════════════ §6.5 SPLASH — once per session,
     skipped on return, timeout backstop, never traps (§6.6). */
  function splash(el) {
    el = el || document.querySelector('[data-splash]');
    if (!el) return Promise.resolve();
    let finished = false;
    const done = function () {
      if (finished) return; finished = true;
      el.hidden = true;
    };
    try {
      if (reduced() || sessionStorage.getItem('pvSplash')) { done(); return Promise.resolve(); }
      sessionStorage.setItem('pvSplash', '1');
    } catch (e) { /* sessionStorage may be unavailable — still play once */ }
    if (finished) return Promise.resolve();

    const backstop = setTimeout(done, 4000);            // guaranteed exit
    return new Promise(function (resolve) {
      try {
        const stickers = el.querySelectorAll('.sticker');
        const word = el.querySelector('[data-splash-word]');
        const tl = G.timeline({ onComplete: function () { clearTimeout(backstop); done(); resolve(); } });
        if (stickers.length) {
          tl.from(stickers, { scale: 0, duration: t(0.4), ease: 'back.out(1.7)', stagger: MOTION.stagger.base });
        }
        if (word) tl.from(word, { autoAlpha: 0, duration: t(0.3) }, '-=0.1');
        tl.to(el, { yPercent: -100, duration: t(0.7), ease: MOTION.ease.move, delay: 0.5 });
      } catch (e) { clearTimeout(backstop); done(); resolve(); }
    });
  }

  /* ═══════════════════════════════════════════════ INIT — bind the page */
  function init(root) {
    root = root || document;
    const $$ = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

    /* text reveals wait for fonts (§6.4: split after fonts settle) */
    const reveals = $$('[data-reveal]');
    reveals.forEach(holdHidden);
    fontsReady.then(function () {
      reveals.forEach(function (el) {
        const fn = REVEALS[el.getAttribute('data-reveal')] || fadeReveal;
        if (ST && el.hasAttribute('data-reveal-scroll')) {
          ST.create({ trigger: el, start: 'top 88%', once: true, onEnter: function () { fn(el); } });
        } else fn(el);
      });
    });

    /* hovers — explicit data-hover wins; sensible defaults per tier */
    $$('[data-hover]').forEach(function (el) { bindHover(el, el.getAttribute('data-hover')); });
    $$('.btn--primary:not([data-hover])').forEach(function (el) { bindHover(el, 'swap'); });  /* USER REVISION: swap is the primary default */
    $$('.btn--secondary:not([data-hover])').forEach(function (el) { bindHover(el, 'sweep'); });
    $$('a:not([data-hover]):not(.btn), .btn--tertiary:not([data-hover])').forEach(function (el) { bindHover(el, 'underline'); });

    /* press — every tappable compresses (§6.3); data-press="pop" = delight */
    $$('[data-press]').forEach(function (el) { bindPress(el, el.getAttribute('data-press')); });
    $$('.btn, .option, .toggle, .stepper__btn, .tab').forEach(function (el) {
      if (!el.hasAttribute('data-press')) bindPress(el, 'compress');
    });

    $$('.toggle').forEach(bindToggle);
    $$('.stepper').forEach(bindStepper);
    $$('.option').forEach(bindOption);
    $$('.input').forEach(bindInput);
    $$('[data-accordion]').forEach(bindAccordion);
    $$('[data-morph]').forEach(bindMorph);
    $$('[data-tabs]').forEach(bindTabs);
    $$('[data-menu-open]').forEach(bindMenuTrigger);

    $$('[data-modal-open]').forEach(function (b) {
      if (b.__pvModal) return; b.__pvModal = true;
      b.addEventListener('click', function () { modalOpen(b.getAttribute('data-modal-open'), b); });
    });
    $$('[data-modal-close]').forEach(function (b) {
      if (b.__pvModalC) return; b.__pvModalC = true;
      b.addEventListener('click', function () { modalClose(b.closest('.modal')); });
    });
    $$('[data-drawer-open]').forEach(function (b) {
      if (b.__pvDrawer) return; b.__pvDrawer = true;
      b.addEventListener('click', function () { drawerOpen(b.getAttribute('data-drawer-open')); });
    });
    $$('[data-drawer-close]').forEach(function (b) {
      if (b.__pvDrawerC) return; b.__pvDrawerC = true;
      b.addEventListener('click', function () { drawerClose(b.closest('.drawer')); });
    });

    $$('[data-scroll]').forEach(bindScroll);
    $$('[data-grid]').forEach(function (el) { if (!el.__pvGrid) { el.__pvGrid = true; gridAssemble(el); } });
    $$('[data-count-to]').forEach(function (el) {
      if (el.__pvCount) return; el.__pvCount = true;
      const run = function () { numberRoll(el, el.getAttribute('data-count-to')); };
      if (ST) ST.create({ trigger: el, start: 'top 90%', once: true, onEnter: run });
      else run();
    });
    $$('[data-progress]').forEach(function (el) {
      if (el.__pvProg) return; el.__pvProg = true;
      const run = function () { progress(el, parseFloat(el.getAttribute('data-progress')) || 0); };
      if (ST) ST.create({ trigger: el, start: 'top 90%', once: true, onEnter: run });
      else run();
    });

    /* Esc closes what grew (§8.2) */
    if (!document.__pvEsc) {
      document.__pvEsc = true;
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && openModal) modalClose(openModal);
      });
      document.addEventListener('click', function (e) {
        if (e.target.classList && e.target.classList.contains('scrim')) modalClose();
      });
    }

    splash();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); });
  } else {
    init();
  }

  /* ─────────────────────────────────────────────── public API */
  window.Proovd = {
    MOTION: MOTION,
    failed: false,
    init: init,
    notice: notice,
    /* text */
    headlineRise: headlineRise, lineFlip: lineFlip, wordSlide: wordSlide,
    scramble: scramble, typewriter: typewriter,
    /* state */
    numberRoll: numberRoll, progress: progress, checkDraw: checkDraw,
    /* components */
    toast: toast, drawerOpen: drawerOpen, drawerClose: drawerClose,
    modalOpen: modalOpen, modalClose: modalClose,
    /* transitions */
    pageSlide: pageSlide, curtain: curtain, unroll: unroll,
    /* delight */
    gridAssemble: gridAssemble, buttonProgress: buttonProgress, splash: splash,
    morph: morph,
  };
})();
