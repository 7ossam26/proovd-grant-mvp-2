/**
 * React-state-driven motion helpers.
 *
 * The Radix components (Toggle, Option, Modal, Drawer, Menu, Accordion, Tabs)
 * own their *state* — so their motion is React-state-driven and must go through
 * the imperative path, not the runtime's declarative `data-*` binders (DNA §6,
 * tech-stack §3.3). These helpers are that path: each reads GSAP + the §6.1
 * tokens from `window.Proovd` and animates, or returns having done nothing when
 * the runtime is absent or `prefers-reduced-motion` is set — in which case the
 * component's `.is-*` class + proovd.css's `html.no-motion` rules jump-cut the
 * same end state (DNA §6.6). Durations/eases are read from the runtime, never
 * re-hardcoded; colours are read from CSS custom properties, never literals.
 */

// The vendored runtime is plain JS on window; gsap is likewise a global.
type GSAP = {
  set: (t: unknown, v: Record<string, unknown>) => unknown;
  to: (t: unknown, v: Record<string, unknown>) => unknown;
  from: (t: unknown, v: Record<string, unknown>) => unknown;
  fromTo: (
    t: unknown,
    a: Record<string, unknown>,
    b: Record<string, unknown>,
  ) => unknown;
  timeline: (v?: Record<string, unknown>) => {
    from: (t: unknown, v: Record<string, unknown>, p?: string | number) => unknown;
    to: (t: unknown, v: Record<string, unknown>, p?: string | number) => unknown;
    // Both real members of a GSAP timeline, declared here when the first
    // caller needed them (Creator Flow v2 Session B). The shim describes the
    // vendored runtime rather than a subset somebody happened to use, so
    // widening it is a correction and not a new capability.
    fromTo: (
      t: unknown,
      from: Record<string, unknown>,
      to: Record<string, unknown>,
      p?: string | number,
    ) => unknown;
    // `add` and `set` are likewise real timeline members, declared when the
    // Founder Flow v2 invite choreography needed them (2026-08-20). The
    // reference composes its claim entrance as ONE timeline with a callback
    // (`tl.add(openBand, '-=0.3')`) rather than as chained tweens, and losing
    // that would lose the overlap the whole sequence is built on.
    add: (t: unknown, p?: string | number) => unknown;
    set: (t: unknown, v: Record<string, unknown>, p?: string | number) => unknown;
    // `call` is likewise a real timeline member, declared when the Founder
    // Flow v2 reach orbit needed it (2026-08-20). The reference reveals its
    // CTA from inside the same timeline that runs the count and the collapse
    // (`this._rtl.call(...)`), which is what puts the button on screen at the
    // exact frame the last phone leaves; a `setTimeout` beside the timeline
    // would drift the moment a frame is dropped.
    call: (fn: () => void, params?: unknown[], p?: string | number) => unknown;
    // Likewise real, declared when Last look needed it (2026-08-20): its
    // handoff sits at 55% of the word timeline's OWN length, which depends on
    // how many words the headline split into.
    duration: () => number;
    kill: () => unknown;
  };
  killTweensOf: (t: unknown) => unknown;
  /*
    GSAP's own ticker. The reach orbit is driven by it rather than by a second
    `requestAnimationFrame` loop — the reference's own comment says why: "the
    whole thing driven by GSAP's existing ticker rather than a second animation
    loop", so the orbit's frames and the tweens that pop each phone are the
    same clock and cannot drift apart.
  */
  ticker: {
    add: (fn: (time: number, deltaTime: number) => void) => unknown;
    remove: (fn: (time: number, deltaTime: number) => void) => unknown;
    wake?: () => unknown;
  };
};

/* GSAP Flip is vendored at `public/vendor/gsap/Flip.min.js` and stays loaded,
   but nothing in this file reaches for it any more: the campaign type's travel
   is the reference's own hand-written FLIP (`kindLand` below), and `Flip.from`
   does not produce the same movement. */

function gsap(): GSAP | null {
  const g = (window as unknown as { gsap?: GSAP }).gsap;
  return g ?? null;
}

export function reduced(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

function phone(): boolean {
  return window.matchMedia?.('(max-width: 600px)').matches === true;
}

/** §6.1: motion runs ×0.85 on phones. */
function t(s: number): number {
  return phone() ? s * 0.85 : s;
}

type DurKey = 'instant' | 'quick' | 'base' | 'slow' | 'grand';
type EaseKey = 'out' | 'hero' | 'move' | 'snap' | 'bounce' | 'exit';

function dur(k: DurKey): number {
  return t(window.Proovd?.MOTION.dur[k] ?? 0.35);
}
function ease(k: EaseKey): string {
  return window.Proovd?.MOTION.ease[k] ?? 'power3.out';
}

export function cssVar(name: string, el?: Element): string {
  return getComputedStyle(el ?? document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/** True when live GSAP motion should run. When false, callers apply the class
 *  end-state and let proovd.css jump-cut it. */
export function motionLive(): boolean {
  const P = window.Proovd;
  return !!P && !P.failed && !!gsap() && !reduced();
}

/* ── Toggle — knob travels, track + knob colours tween (§7.1, runtime parity) */
export function animateToggle(
  track: HTMLElement,
  knob: HTMLElement,
  on: boolean,
  animate: boolean,
): void {
  const g = gsap();
  if (!motionLive() || !g) return; // CSS .is-on handles the end state
  const travel = track.clientWidth - knob.offsetWidth - 6; // knob inset each side (proovd.css)
  const surface = cssVar('--surface') || cssVar('--white');
  const d = animate ? dur('quick') : 0;
  g.to(knob, { x: on ? travel : 0, duration: d, ease: ease('move') });
  g.to(knob, {
    backgroundColor: on ? cssVar('--mint') : cssVar('--grey'),
    duration: d,
  });
  g.to(track, {
    outlineColor: on ? cssVar('--dark') : cssVar('--grey'),
    backgroundColor: on ? cssVar('--dark') : surface,
    duration: d,
  });
}

/* ── Stepper — the freshly-rendered number arrives from the push direction
   (§6.5). The old value's exit is React's re-render; the new one slides in. */
export function bumpStepperIn(num: HTMLElement, dir: number): void {
  const g = gsap();
  if (!g || !motionLive() || dir === 0) return;
  g.from(num, {
    yPercent: dir * 70,
    autoAlpha: 0,
    duration: dur('quick'),
    ease: ease('snap'),
  });
}

/* ── Flow step — the incoming step slides in from the semantic direction
   (§6.5, DNA §5.9): forward enters from the right, back from the left. */
export function slideStep(el: HTMLElement, dir: 'forward' | 'back'): void {
  const g = gsap();
  if (!g || !motionLive()) return;
  g.from(el, {
    xPercent: dir === 'forward' ? 100 : -100,
    duration: dur('slow'),
    ease: ease('move'),
  });
}

/* ── Tab underline — slides + resizes to the active tab (§6.5 Flip.fit) */
export function moveTabUnderline(
  underline: HTMLElement,
  active: HTMLElement | null,
  animate: boolean,
): void {
  const g = gsap();
  // No GSAP → the underline stays hidden; Radix's aria-selected and the
  // .tab.is-active colour still convey which tab is active (never colour-only).
  if (!active || !g) return;
  const to = { x: active.offsetLeft, width: active.offsetWidth };
  if (!motionLive() || !animate) {
    g.set(underline, to);
    return;
  }
  g.to(underline, { ...to, duration: dur('quick'), ease: ease('out') });
}

/* ── Accordion — height morph 0↔auto, chevron rotates 45° (§6.5). `onDone`
   lets the caller defer Radix's unmount until a collapse finishes. */
export function animateAccordion(
  body: HTMLElement,
  chevron: HTMLElement | null,
  open: boolean,
  animate: boolean,
  onDone?: () => void,
): void {
  const g = gsap();
  if (!g || !motionLive()) {
    body.style.height = open ? 'auto' : '0';
    if (chevron) chevron.style.transform = open ? 'rotate(45deg)' : 'rotate(0deg)';
    onDone?.();
    return;
  }
  const d = animate ? dur('quick') : 0;
  if (chevron) g.to(chevron, { rotation: open ? 45 : 0, duration: d, ease: ease('out') });
  if (open) {
    g.fromTo(
      body,
      { height: 0 },
      { height: 'auto', duration: d, ease: ease('out'), onComplete: onDone },
    );
  } else {
    g.to(body, { height: 0, duration: d, ease: ease('out'), onComplete: onDone });
  }
}

/* ── Modal — grows from its trigger, never a centred void (§6.5) */
export function animateModalOpen(
  modal: HTMLElement,
  overlay: HTMLElement | null,
  trigger: HTMLElement | null,
): void {
  const g = gsap();
  g?.set(modal, { xPercent: -50, yPercent: -50 }); // preserve CSS centring
  if (!g || !motionLive()) return;
  if (trigger) {
    const m = modal.getBoundingClientRect();
    const r = trigger.getBoundingClientRect();
    g.set(modal, {
      transformOrigin: `${r.left + r.width / 2 - m.left}px ${
        r.top + r.height / 2 - m.top
      }px`,
    });
  }
  if (overlay) g.from(overlay, { autoAlpha: 0, duration: dur('quick') });
  g.from(modal, { scale: 0.6, autoAlpha: 0, duration: dur('quick'), ease: ease('out') });
}

export function animateModalClose(
  modal: HTMLElement,
  overlay: HTMLElement | null,
  done: () => void,
): void {
  const g = gsap();
  if (!g || !motionLive()) return done();
  g.to(modal, {
    scale: 0.85,
    autoAlpha: 0,
    duration: dur('quick'),
    ease: ease('exit'),
    onComplete: done,
  });
  if (overlay) g.to(overlay, { autoAlpha: 0, duration: dur('quick'), ease: ease('exit') });
}

/* ── Drawer / Sheet — side panel on desktop, bottom sheet on phone (§8) */
function drawerAxis(): Record<string, number> {
  return phone() ? { yPercent: 100 } : { xPercent: 100 };
}

export function animateDrawerOpen(
  drawer: HTMLElement,
  overlay: HTMLElement | null,
  tabs: Element[],
): void {
  const g = gsap();
  if (!g || !motionLive()) return;
  if (overlay) g.from(overlay, { autoAlpha: 0, duration: dur('quick') });
  const tl = g.timeline();
  tl.from(drawer, { ...drawerAxis(), duration: dur('slow'), ease: ease('out') });
  if (tabs.length) {
    tl.from(
      tabs,
      { y: 16, autoAlpha: 0, duration: dur('base'), stagger: 0.04 },
      '-=0.15',
    );
  }
}

export function animateDrawerClose(
  drawer: HTMLElement,
  overlay: HTMLElement | null,
  done: () => void,
): void {
  const g = gsap();
  if (!g || !motionLive()) return done();
  g.to(drawer, {
    ...drawerAxis(),
    duration: dur('base'),
    ease: ease('exit'),
    onComplete: done,
  });
  if (overlay) g.to(overlay, { autoAlpha: 0, duration: dur('base'), ease: ease('exit') });
}

/* ── Dropdown menu — scaleY unfold from the top, items stagger (§6.5) */
export function animateMenuOpen(menu: HTMLElement): void {
  const g = gsap();
  if (!g || !motionLive()) return;
  g.set(menu, { transformOrigin: 'top center' });
  g.from(menu, { scaleY: 0, autoAlpha: 0, duration: dur('base'), ease: ease('out') });
  g.from(menu.children, {
    autoAlpha: 0,
    y: -8,
    duration: dur('base'),
    stagger: 0.04,
    delay: 0.05,
  });
}

export function animateMenuClose(menu: HTMLElement, done: () => void): void {
  const g = gsap();
  if (!g || !motionLive()) return done();
  g.to(menu, {
    scaleY: 0,
    autoAlpha: 0,
    duration: dur('instant'),
    ease: ease('exit'),
    onComplete: done,
  });
}

/* ── Campaign page v2 ──────────────────────────────────────────────────────
   Two helpers the rebuilt public campaign page needs and nothing else in the
   system had. Both are the reference's own behaviour, moved off raw inline
   GSAP and behind `motionLive()` (DNA §6). */

/**
 * The demo stage's message, on each change of moment.
 *
 * The reference does this with a CSS `@keyframes demo-in` that re-fires because
 * the node is replaced by `innerHTML`. React reuses the node, so a CSS
 * animation would run once and never again — the imperative path is not a
 * stylistic preference here, it is the only one that works.
 */
export function animateDemoMessage(el: HTMLElement): void {
  const g = gsap();
  if (!g || !motionLive()) return;
  g.from(el, { y: 8, autoAlpha: 0, duration: dur('quick'), ease: ease('out') });
}

/**
 * The threshold bar fills from the left when it first scrolls into view.
 *
 * `once: true` — a bar that re-fills every time it passes the fold is the
 * attention farming §30 forbids, and it re-announces nothing useful either.
 *
 * `value` is REQUIRED and is the end state, 0–1. It is not read off the
 * element, and that is the whole point of this signature: `Progress` owns
 * `.progress__fill`, whose resting transform is `scaleX(0)` with the runtime
 * tweening it to the real value on mount. A `gsap.from` here would take
 * whatever scaleX it happened to observe as its DESTINATION — mid-tween, or
 * the untouched 1 — and a threshold bar that renders full at 168 of 250 is
 * the worst thing this page could get wrong. So the caller passes the number
 * it already rendered into the accessible value text, and the two cannot
 * disagree. Returns a teardown so a React effect kills the trigger with the
 * component; with no ScrollTrigger or no motion this does nothing at all and
 * `Progress`'s own mechanism stands.
 */
export function fillOnScroll(
  fill: HTMLElement,
  trigger: HTMLElement,
  value: number,
): () => void {
  const g = gsap();
  const ST = (window as unknown as { ScrollTrigger?: unknown }).ScrollTrigger;
  if (!g || !ST || !motionLive()) return () => {};
  const end = Math.max(0, Math.min(1, value));
  const tween = g.fromTo(
    fill,
    { scaleX: 0 },
    {
      scaleX: end,
      transformOrigin: 'left center',
      duration: dur('slow'),
      ease: ease('out'),
      overwrite: 'auto',
      scrollTrigger: { trigger, start: 'top 78%', once: true },
    },
  ) as { scrollTrigger?: { kill: () => void }; kill?: () => void };
  return () => {
    tween.scrollTrigger?.kill();
    tween.kill?.();
  };
}


/* ── Founder Flow v2 ───────────────────────────────────────────────────────
   The four motions the twenty-six-page Founder onboarding flow needs, moved
   off the reference's raw inline GSAP and behind `motionLive()` (DNA §6).

   Every duration below is a `ProovdAPI.MOTION.dur` token rather than the
   reference's own number, and each comment records which reference value the
   token stands in for. §6.1's ceiling is `grand: 0.90` — "nothing exceeds
   this" — and the reference's longest here is 0.62s, so nothing had to be cut
   to fit. What did change is that three near-identical eases (`power3.out`,
   `power3.inOut`, `power2.in`) resolve to the three the system already names. */

/**
 * The relay entrance. Every page in the flow uses it.
 *
 * The reference stages every `data-anim` child at `x: 150 * direction,
 * opacity: 0` and relays them in at 0.62s `power3.out` with a 0.085s stagger,
 * reversed `from: 'end'` on back navigation. `direction` is +1 forward, −1
 * back, and first paint is always forward.
 *
 * 150 is a value on a fixed 2496px stage rendered at `scale(0.37)`. The
 * README's own conversion (§Fidelity, option 2) is to divide by ~2.7, giving
 * ~56 CSS px at 1440 — and it is capped against the viewport, because a 56px
 * horizontal slide at 320px is a quarter of the screen.
 *
 * `data-anim="grow"` is the reference's own exception and scales instead; it
 * is partitioned out here rather than branched on at the call site, so a page
 * that wants the grow marks one element and nothing else changes.
 */
export function relayIn(stage: HTMLElement | null, direction: 1 | -1): () => void {
  const g = gsap();
  if (!g || !stage || !motionLive()) return () => {};
  const all = Array.from(stage.querySelectorAll('[data-anim]'));
  const grows = all.filter((el) => el.getAttribute('data-anim') === 'grow');
  const relay = all.filter((el) => el.getAttribute('data-anim') !== 'grow');
  const travel = Math.min(56, window.innerWidth / 8) * direction;

  if (relay.length) {
    g.fromTo(
      relay,
      { x: travel, autoAlpha: 0 },
      {
        x: 0,
        autoAlpha: 1,
        duration: dur('slow'), // 0.60 stands in for the reference's 0.62
        ease: ease('out'), // power3.out
        stagger: {
          each: window.Proovd?.MOTION.stagger.base ?? 0.08,
          // Back navigation relays from the LAST child, so the element the
          // person is returning toward is the one that arrives first.
          from: direction === -1 ? 'end' : 'start',
        },
        overwrite: 'auto',
      },
    );
  }

  // The grow is the reference's `back.out(1.35)`; `snap` is `back.out(1.4)`.
  if (grows.length) {
    g.fromTo(
      grows,
      { scale: 0.6, autoAlpha: 0 },
      {
        scale: 1,
        autoAlpha: 1,
        duration: dur('slow'),
        ease: ease('snap'),
        overwrite: 'auto',
      },
    );
  }

  // The README's own stuck sweep, and the runtime's 3s force-reveal applied to
  // a set it cannot see: `holdHidden` only registers `[data-reveal]`, and these
  // elements are staged by an inline `fromTo` instead. A dropped tween would
  // otherwise leave a blank page with a working keyboard path — the worst
  // failure this flow has, because nothing about it looks broken.
  const sweep = window.setTimeout(() => {
    for (const el of all) {
      if (Number(getComputedStyle(el).opacity) < 0.9) {
        g.set(el, { clearProps: 'transform,opacity,visibility' });
      }
    }
  }, 2200);
  return () => window.clearTimeout(sweep);
}

/**
 * The page exit, matching the reference's 200ms fade and 400ms fallback.
 *
 * The outgoing page fades before the route changes, so `done` is what actually
 * navigates. The fallback exists because a tween in a backgrounded tab does not
 * progress: without it, a Founder who switched tabs mid-transition comes back
 * to a page that faded and never left. That is the one thing this helper must
 * not get wrong, so the timer ships inside it rather than at each call site.
 *
 * The `setTimeout` here drives a NAVIGATION, never a status: nothing about what
 * is recorded depends on it, and if it fires early the only cost is that a fade
 * is cut short.
 */
export function pageExit(stage: HTMLElement | null, done: () => void): void {
  const g = gsap();
  if (!g || !stage || !motionLive()) {
    done();
    return;
  }
  let ran = false;
  // `pageGo` wakes the same ticker before its fade. This matters after the tab
  // has been backgrounded: a sleeping ticker otherwise makes the exit appear
  // to be skipped and the fallback performs the route change instead.
  g.ticker?.wake?.();
  const fallback = window.setTimeout(() => {
    if (ran) return;
    ran = true;
    done();
  }, 400);
  g.to(stage, {
    autoAlpha: 0,
    duration: dur('quick'), // 0.20 stands in for the reference's 0.28
    ease: ease('exit'), // power2.in
    overwrite: 'auto',
    onComplete: () => {
      if (ran) return;
      ran = true;
      window.clearTimeout(fallback);
      done();
    },
  });
}

/**
 * The invitation splash — Creator Flow v2, Session B, 2026-08-19.
 *
 * The reference plays a 2.6-second hand-written `requestAnimationFrame` track
 * with a 1.2s safety timeout, and it plays it every time the screen mounts.
 * Three things about that do not survive contact with the Spec, so three things
 * are different here and each is a mechanism rather than a promise:
 *
 * 1. **It is capped at `grand`.** DNA §6.1 fixes 0.90s as the ceiling nothing
 *    exceeds, and §30 forbids countdown pressure — an animation that holds
 *    somebody for two and a half seconds before they may act is a countdown
 *    with better typography. The whole track runs inside one `grand`.
 * 2. **The skip control is present from the first frame**, and it is a real
 *    button rendered by the surface rather than something this helper reveals.
 *    That is why `onDone` is called on skip too: there is exactly one way the
 *    splash ends, so a skipped one cannot leave the page in a half-entered
 *    state (§28.5 — the whole walk is reachable by keyboard, including out of
 *    the first thing it shows).
 * 3. **`reduced()` short-circuits it before it starts.** Not a faster version:
 *    the caller gets `false` back and never mounts it at all, which is the
 *    jump-cut rather than a second animated path to maintain.
 *
 * Playing it once per token is the SURFACE's decision, not this helper's — the
 * helper animates, and the record of whether somebody has already seen it is
 * `hasSeenSplash` in the flow's own module state.
 *
 * Returns whether it actually ran. `false` means the caller should treat the
 * splash as already finished.
 */
export function playSplash(
  scene: HTMLElement | null,
  onDone: () => void,
): { ran: boolean; stop: () => void } {
  const g = gsap();
  if (!g || !scene || !motionLive()) return { ran: false, stop: () => {} };

  const sticker = scene.querySelector('[data-splash="sticker"]');
  const flash = scene.querySelector('[data-splash="flash"]');
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onDone();
  };

  const tl = g.timeline({ onComplete: finish });
  if (sticker) {
    tl.fromTo(
      sticker,
      { scale: 0.72, rotate: -8, autoAlpha: 0 },
      {
        scale: 1,
        rotate: 0,
        autoAlpha: 1,
        duration: dur('slow'), // 0.60 — the reference's peel-in beat
        ease: ease('snap'), // back.out(1.4) for its own back.out
      },
    );
  }
  if (flash) {
    tl.fromTo(
      flash,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: dur('instant'), ease: ease('out') },
      '>-0.10',
    );
    tl.to(flash, { autoAlpha: 0, duration: dur('quick'), ease: ease('exit') });
  }

  // The reference's 1.2s safety timeout, kept and tightened to the §6.1
  // ceiling. A tween in a backgrounded tab does not progress, and without this
  // the splash is a full-screen overlay that never lifts — which is a locked
  // page rather than a missing animation. It drives only the reveal.
  const safety = window.setTimeout(finish, 900 + 300);

  return {
    ran: true,
    stop: () => {
      window.clearTimeout(safety);
      tl.kill();
      finish();
    },
  };
}

/* ── Founder Flow v2 — screen 1, the invite ────────────────────────────────
   Rebuilt 2026-08-20 to the supplied reference's own claim choreography.

   Screen 1 does NOT use `relayIn`. The reference gives the front door a
   bespoke entrance — the splash lifts, the pale band unrolls, and the copy
   arrives behind it word by word — and a page that fades in sideways with
   everything else would lose the one beat the flow's first screen has. So the
   invite renders `data-invite="…"` markers instead of `data-anim`, which is
   what makes `relayIn` a no-op on it rather than something to switch off.

   Every duration is a §6.1 token, with the reference's own number recorded
   beside it. Its longest here is 0.62s and §6.1's ceiling is `grand: 0.90`,
   so nothing had to be cut to fit. */

/** GSAP SplitText, vendored at `public/vendor/gsap/SplitText.min.js`. */
type SplitTextCtor = new (
  target: Element,
  vars: Record<string, unknown>,
) => { words: Element[]; revert: () => void };

function splitText(): SplitTextCtor | null {
  return (window as unknown as { SplitText?: SplitTextCtor }).SplitText ?? null;
}

/**
 * The invite's entrance, splash included.
 *
 * `stage` is the screen's own root — everything the timeline touches is inside
 * it, including the meta row, which on this screen is the column's first child
 * rather than page chrome.
 *
 * `splash` is the overlay when one is being played and `null` when it has
 * already run this session — which is the reference's own `splashOn`, and is
 * why the timeline's first position is `'-=0.3'` against the lift or `0`
 * without it. The band opens under whichever it is.
 *
 * ── The band unrolls with a height tween, not with Flip ────────────────────
 * The reference captures a Flip state over the band AND everything below it,
 * restores the height, and flips — so the copy is carried down as the band
 * grows. Flip does that by writing inline transforms onto those same elements,
 * which are at that moment staged at `autoAlpha: 0` and about to be tweened on
 * `y` and `yPercent`. Two owners of one transform is how a headline lands 16px
 * out of place and nothing looks broken. A height tween on the band alone
 * reflows its siblings for free and has one owner, which is the reference's own
 * documented fallback (`else g.from(band,{height:0,…})`).
 *
 * ── The split waits for fonts ──────────────────────────────────────────────
 * DNA §6.4: split after fonts settle, or SplitText measures the fallback face
 * and the words land at the wrong widths. The staging is synchronous so there
 * is nothing to flash in the meantime; only the play is deferred, raced against
 * the reference's own 1.2s timeout so a font that never resolves cannot strand
 * the page.
 *
 * Returns a teardown. `onSplashDone` is what un-mounts the overlay, and it runs
 * exactly once — from the lift, from the safety timer, or immediately when
 * motion is off (DNA §6.6: the jump-cut is the same end state, not a second
 * path through the code).
 */
export function inviteIntro(
  stage: HTMLElement | null,
  splash: HTMLElement | null,
  onSplashDone: () => void,
): () => void {
  const g = gsap();
  let splashDone = false;
  const finishSplash = () => {
    if (splashDone) return;
    splashDone = true;
    onSplashDone();
  };

  if (!g || !stage || !motionLive()) {
    finishSplash();
    return () => {};
  }

  const pick = (name: string) =>
    stage.querySelector<HTMLElement>('[data-invite="' + name + '"]');

  // The reference's `data-anim="meta"` is the whole first row of the column —
  // the setup time on the left, HELP on the right.
  const top = pick('meta');
  const band = pick('band');
  const head = pick('head');
  const lede = pick('lede');
  const legal = pick('legal');
  const cta = pick('cta');

  const rest = [top, lede, legal].filter((el): el is HTMLElement => !!el);
  const tail = [lede, legal].filter((el): el is HTMLElement => !!el);

  // ── Stage everything now, synchronously, before the font race ────────────
  if (rest.length) g.set(rest, { autoAlpha: 0, y: 16 });
  if (cta) g.set(cta, { autoAlpha: 0, scale: 0.94, transformOrigin: '50% 50%' });

  let bandHeight = 0;
  if (band) {
    // Measured from the stylesheet, never from whatever is on the element.
    // React re-invokes an effect immediately after tearing it down under
    // StrictMode, so this runs twice on every development mount — and a second
    // pass that measured the `0px` the first pass wrote would tween 0 to 0 and
    // leave the band collapsed for good. Clearing first, and restoring in the
    // teardown below, is what makes a re-run identical to a first run.
    band.style.height = '';
    band.style.overflow = '';
    // `offsetHeight`, never `getBoundingClientRect()`: the band lives inside a
    // `scale()`d stage, so the rect is the SCALED height while the value being
    // tweened back into `style.height` is a local one. Measuring the rect made
    // the band open to a fraction of its size.
    bandHeight = band.offsetHeight;
    band.style.overflow = 'hidden';
    band.style.height = '0px';
  }

  let split: { words: Element[]; revert: () => void } | null = null;
  const S = splitText();
  if (head) {
    if (S) {
      try {
        split = new S(head, { type: 'words' });
        g.set(split.words, { autoAlpha: 0, yPercent: 60 });
      } catch {
        split = null;
        g.set(head, { autoAlpha: 0, y: 16 });
      }
    } else {
      g.set(head, { autoAlpha: 0, y: 16 });
    }
  }

  const revert = () => {
    try {
      split?.revert();
    } catch {
      /* a reverted split is not worth a broken page */
    }
    split = null;
  };

  const openBand = () => {
    if (!band) return;
    band.style.overflow = '';
    g.fromTo(
      band,
      { height: 0 },
      {
        height: bandHeight,
        duration: dur('slow'), // 0.60, the reference's own
        ease: ease('out'), // power3.out
        clearProps: 'height',
        overwrite: 'auto',
      },
    );
  };

  let killed = false;
  let timeline: ReturnType<GSAP['timeline']> | null = null;

  const run = () => {
    if (killed) return;
    const tl = g.timeline();
    timeline = tl;

    if (splash) {
      const outer = splash.querySelector('[data-invite-splash="outer"]');
      const inner = splash.querySelector('[data-invite-splash="inner"]');
      if (outer) {
        // 0.35 stands in for the reference's 0.4; `snap` is back.out(1.4) for
        // its back.out(1.7) — the system names one back ease and this is it.
        tl.from(outer, { scale: 0, duration: dur('base'), ease: ease('snap') });
      }
      if (inner) {
        tl.from(inner, { scale: 0, duration: dur('base'), ease: ease('snap') }, '-=0.25');
      }
      tl.to({}, { duration: 0.2 }); // the reference's own held beat
      tl.to(splash, {
        yPercent: -100,
        duration: dur('slow'), // 0.60 for the reference's 0.55
        ease: ease('move'), // power2.inOut
        onComplete: finishSplash,
      });
    }

    tl.add(openBand, splash ? '-=0.3' : 0);
    if (top) tl.to(top, { autoAlpha: 1, y: 0, duration: dur('base') }, '-=0.3');

    if (split) {
      tl.to(
        split.words,
        {
          autoAlpha: 1,
          yPercent: 0,
          duration: dur('slow'), // 0.60 for the reference's 0.55
          ease: ease('hero'), // power4.out
          stagger: window.Proovd?.MOTION.stagger.tight ?? 0.04,
          onComplete: revert,
        },
        '-=0.24',
      );
    } else if (head) {
      tl.to(
        head,
        { autoAlpha: 1, y: 0, duration: dur('slow'), ease: ease('hero') },
        '-=0.24',
      );
    }

    if (tail.length) {
      tl.to(tail, { autoAlpha: 1, y: 0, duration: dur('base'), stagger: 0.07 }, '-=0.5');
    }
    if (cta) {
      tl.to(
        cta,
        {
          autoAlpha: 1,
          scale: 1,
          duration: dur('slow'), // 0.60 for the reference's 0.5
          ease: ease('snap'), // back.out(1.4) for its back.out(1.2)
          clearProps: 'transform',
        },
        '-=0.2',
      );
    }
  };

  // The reference races `document.fonts.ready` against 1.2s and runs either
  // way. Both branches call `run`, so a rejected font promise is a played
  // animation rather than a page that never arrives.
  const fonts = document.fonts?.ready;
  if (fonts) {
    void Promise.race([
      fonts,
      new Promise((resolve) => window.setTimeout(resolve, 1200)),
    ]).then(run, run);
  } else {
    run();
  }

  // Two backstops, and they guard different failures. The first lifts a splash
  // whose tween never progressed — a full-screen overlay that does not leave is
  // a locked page rather than a missing animation. The second is `relayIn`'s
  // own stuck sweep: `holdHidden` registers `[data-reveal]` and these elements
  // are staged by an inline `set`, so the runtime's 3s force-reveal cannot see
  // them. A dropped tween would otherwise leave a blank page with a working
  // keyboard path, which is the worst failure this flow has.
  const lift = window.setTimeout(finishSplash, 2600);
  const sweep = window.setTimeout(() => {
    revert();
    const all = [top, band, head, lede, legal, cta].filter(
      (el): el is HTMLElement => !!el,
    );
    for (const el of all) {
      if (Number(getComputedStyle(el).opacity) < 0.9) {
        g.set(el, { clearProps: 'transform,opacity,visibility,height' });
      }
    }
  }, 4200);

  // The teardown stops tweens and restores what was staged. It deliberately
  // does NOT call `finishSplash`: that is a React state write, and StrictMode
  // tears an effect down and immediately re-runs it, so calling it here
  // un-mounts the overlay before the timeline that plays it has ever started —
  // a splash that never appears in development and does in production is the
  // worst way to find this out. A real unmount removes the overlay with the
  // component, and a state write against an unmounted component is a no-op.
  return () => {
    killed = true;
    window.clearTimeout(lift);
    window.clearTimeout(sweep);
    timeline?.kill();
    revert();
    if (band) {
      band.style.height = '';
      band.style.overflow = '';
    }
  };
}

/* ── Founder Flow v2 — screens 2 and 3, the confirmations ──────────────────
   Rebuilt 2026-08-20 to the supplied reference's own `problemIntro`,
   `revealHead` and `probToggle`.

   Like screen 1, these screens do NOT use `relayIn`. The reference gives them
   a bespoke entrance — the headline arrives word by word while the dark panel
   is a 4%-wide sliver, and the panel then opens sideways with the field, the
   edit control and the CTA rising behind it. A page that slid in sideways with
   everything at once would lose the beat the whole screen is built around. The
   markers are `data-prob-part`, not `data-anim`, which is what makes `relayIn`
   a no-op here rather than something to switch off.

   ── The durations are the reference's own numbers, not §6.1 tokens ─────────
   A DELIBERATE departure from this file's convention, and the only one.
   Elsewhere a reference number is rounded to the nearest token and recorded in
   a comment; here the brief is a 1:1 behavioural reproduction, and this
   sequence's beats (0.05, 0.24, 0.26, 0.28, 0.36, 0.38, 0.42) fall between
   `quick` 0.20 and `base` 0.35 in a way that rounding visibly flattens — the
   panel's 0.36 open and the field's 0.28 rise would become one duration and
   stop reading as two moves. The token each sits between is recorded beside
   it. The phone factor (§6.1: ×0.85) still applies, through the same `t()`
   every other helper uses, because that is the reference's own `k()`. Nothing
   exceeds §6.1's `grand: 0.90` ceiling. */

/** The reference's `k()`: its literal duration, with §6.1's phone factor. */
function refDur(seconds: number): number {
  return t(seconds);
}

/**
 * The scale a `[data-page-stage]` is currently rendered at.
 *
 * Read from the stage's own matrix rather than from the headline's box: a
 * shrink-to-fit or zero-width `h1` measures as ratio 1, and the reveal copy
 * then renders at full stage size and re-wraps — the reference records hitting
 * exactly that.
 */
function stageRatio(el: Element): number {
  const stage = el.closest('[data-page-stage]');
  if (!stage) return 1;
  const value = getComputedStyle(stage).transform;
  if (!value || value === 'none') return 1;
  const m = /matrix\(([^,]+)/.exec(value);
  const ratio = m?.[1] ? Number.parseFloat(m[1]) : 1;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

/**
 * The word-by-word headline reveal, run on a detached copy.
 *
 * Splitting needs spans, and the `h1` belongs to React's render — mutating it
 * leaves the next reconciliation diffing against foreign nodes. So the split
 * runs on a clone pinned over the real headline, which is never touched. That
 * is the reference's own reasoning, and it holds identically here.
 *
 * The sticker is filtered out of the words and animated separately: it is an
 * image inside the sentence, and a 175px picture rising 70% of its own height
 * alongside the text reads as a different element arriving late rather than as
 * one line landing.
 *
 * Returns a teardown. `onDone` runs exactly once — from the timeline, from the
 * fallback, or immediately when motion is off.
 *
 * `onNearly` is the reference's own fourth parameter (`revealHead(head, k,
 * done, nearlyDone)`) and it fires at 55% of the word timeline — its comment:
 * *let the page start moving before the last word lands*. Only Last look uses
 * it, and the beat is the whole point of that screen's entrance: waiting for
 * the reveal to finish leaves a visible dead frame between the title landing
 * and the rest arriving. It runs exactly once, before `onDone`, and it runs
 * even when there is nothing to split and even when motion is off — a caller
 * that hangs its own sequence off it must never be stranded by a missing
 * plugin.
 */
function revealHead(
  head: HTMLElement,
  onDone: () => void,
  onNearly?: () => void,
): () => void {
  const g = gsap();
  let nearly = false;
  const soon = () => {
    if (nearly) return;
    nearly = true;
    onNearly?.();
  };
  let called = false;
  const finish = () => {
    // The reference's `fin`: `soon()` first, then `done()`. Order matters when
    // the split never happened — the handoff must not arrive after the page
    // has already been declared settled.
    soon();
    if (called) return;
    called = true;
    onDone();
  };
  if (!g || !motionLive()) {
    finish();
    return () => {};
  }

  let clone: HTMLElement | null = null;
  let split: { words: Element[]; revert: () => void } | null = null;
  const drop = () => {
    try {
      split?.revert();
    } catch {
      /* a reverted split is not worth a broken page */
    }
    split = null;
    clone?.remove();
    clone = null;
  };

  const S = splitText();
  let words: Element[] = [];
  if (S) {
    try {
      const r = head.getBoundingClientRect();
      const ratio = stageRatio(head);
      // +2px slack: a shrink-to-fit headline measures exactly as wide as its
      // own text, and sub-pixel rounding alone was enough to wrap the copy.
      const w = Math.ceil(r.width / ratio) + 2;
      if (!w) throw new Error('unmeasurable');
      clone = head.cloneNode(true) as HTMLElement;
      clone.removeAttribute('data-prob-part');
      clone.setAttribute('aria-hidden', 'true');
      Object.assign(clone.style, {
        position: 'fixed',
        left: r.left + 'px',
        top: r.top + 'px',
        width: w + 'px',
        margin: '0',
        zIndex: '40',
        pointerEvents: 'none',
        opacity: '1',
        visibility: 'visible',
        transform: 'scale(' + ratio + ')',
        transformOrigin: '0 0',
      });
      document.body.appendChild(clone);
      split = new S(clone, { type: 'words' });
      words = split.words.filter(
        (el) => el.tagName !== 'IMG' && !el.querySelector('img'),
      );
    } catch {
      drop();
      words = [];
    }
  }

  if (!clone || !words.length) {
    drop();
    g.fromTo(
      head,
      { autoAlpha: 0, y: 22 },
      {
        autoAlpha: 1,
        y: 0,
        duration: refDur(0.3), // between quick 0.20 and base 0.35
        ease: ease('out'),
        onComplete: finish,
      },
    );
    // The reference's own `this.later(soon, Math.round(260*k))` on this branch:
    // with no words to split there is no timeline to hang the 55% call on, so
    // the handoff is timed instead. A page whose SplitText failed still runs
    // its sequence.
    const early = window.setTimeout(soon, Math.round(refDur(0.26) * 1000));
    return () => {
      window.clearTimeout(early);
      drop();
      g.killTweensOf(head);
    };
  }

  g.set(head, { autoAlpha: 0 });
  const tl = g.timeline({
    onComplete: () => {
      drop();
      g.set(head, { clearProps: 'opacity,visibility,transform' });
      finish();
    },
  });
  g.set(words, { autoAlpha: 0, yPercent: 70 });
  tl.to(words, {
    autoAlpha: 1,
    yPercent: 0,
    duration: refDur(0.38), // between base 0.35 and slow 0.60
    ease: ease('hero'), // power4.out
    stagger: 0.026,
  });
  // `tl.call(soon, null, tl.duration()*0.55)`. Positioned on the TIMELINE
  // rather than on a `setTimeout` beside it, so the handoff and the last word
  // share one clock: a dropped frame moves both or neither.
  tl.call(soon, undefined, tl.duration() * 0.55);

  const img = clone.querySelector('img');
  if (img) {
    g.set(img, { scale: 0, transformOrigin: '50% 50%' });
    tl.to(
      img,
      {
        scale: 1,
        duration: refDur(0.36), // base 0.35, one hundredth away
        ease: 'back.out(1.6)', // its own, between snap's 1.4 and the match's 1.9
      },
      '-=0.24',
    );
  }

  // The reference's own backstop, on the one failure that matters here: a
  // clone that never animated leaves the real headline hidden behind it.
  const fallback = window.setTimeout(() => {
    tl.kill();
    drop();
    g.set(head, { clearProps: 'opacity,visibility,transform' });
    finish();
  }, 3400);

  return () => {
    window.clearTimeout(fallback);
    tl.kill();
    drop();
    g.set(head, { clearProps: 'opacity,visibility,transform' });
  };
}

/**
 * Screens 2 and 3 — the entrance.
 *
 * `root` is the screen's own stage. Everything the timeline touches carries a
 * `data-prob-part` marker inside it.
 *
 * The panel opens from `scaleX: 0.04` — a sliver the width of a rule, widening
 * into the card. Everything is staged synchronously, before this frame paints,
 * so the card can never flash at full size before its own expand.
 *
 * `onSettled` runs once the headline has landed and the panel timeline has
 * been built: it is where the surface measures its scroll rail, because the
 * rail's geometry is only true once the field is at its real size.
 */
export function problemIntro(
  root: HTMLElement | null,
  onSettled: () => void,
): () => void {
  const g = gsap();
  if (!g || !root || !motionLive()) {
    onSettled();
    return () => {};
  }

  const pick = (name: string) =>
    root.querySelector<HTMLElement>('[data-prob-part="' + name + '"]');
  const head = pick('head');
  const panel = pick('panel');
  const field = pick('field');
  const edit = pick('edit');
  const cta = pick('cta');
  const staged = [head, panel, field, edit, cta].filter(
    (el): el is HTMLElement => !!el,
  );

  g.killTweensOf(staged);
  // Synchronously, before paint.
  if (head) g.set(head, { autoAlpha: 0 });
  if (panel) {
    g.set(panel, {
      scaleX: 0.04,
      autoAlpha: 0,
      transformOrigin: '50% 50%',
      force3D: true,
    });
  }
  if (field) g.set(field, { autoAlpha: 0, y: 14 });
  if (edit) g.set(edit, { autoAlpha: 0, y: 12 });
  if (cta) g.set(cta, { autoAlpha: 0, y: 18 });

  let rest: ReturnType<GSAP['timeline']> | null = null;
  const runRest = () => {
    const tl = g.timeline({ defaults: { ease: ease('out') } }); // power3.out
    rest = tl;
    if (panel) {
      tl.to(panel, { autoAlpha: 1, duration: refDur(0.05), ease: 'none' });
      tl.to(
        panel,
        {
          scaleX: 1,
          duration: refDur(0.36), // base 0.35, one hundredth away
          // The reference's power3.inOut. `move` is the system's one in-out
          // (power2.inOut); a second in-out would be a second answer to what
          // an in-out is.
          ease: ease('move'),
          clearProps: 'transform',
        },
        '<',
      );
    }
    if (field) {
      tl.to(
        field,
        { autoAlpha: 1, y: 0, duration: refDur(0.28), clearProps: 'transform' },
        '-=0.16',
      );
    }
    if (edit) {
      tl.to(
        edit,
        { autoAlpha: 1, y: 0, duration: refDur(0.24), clearProps: 'transform' },
        '-=0.2',
      );
    }
    if (cta) {
      tl.to(
        cta,
        { autoAlpha: 1, y: 0, duration: refDur(0.28), clearProps: 'transform' },
        '-=0.2',
      );
    }
    onSettled();
  };

  let stopHead: () => void = () => {};
  if (head) stopHead = revealHead(head, runRest);
  else runRest();

  // `relayIn`'s own stuck sweep, for a set the runtime cannot see: `holdHidden`
  // registers `[data-reveal]` and these are staged by an inline `set`. A
  // dropped tween would otherwise leave a blank page with a working keyboard
  // path, which is the worst failure this flow has.
  const sweep = window.setTimeout(() => {
    for (const el of staged) {
      if (Number(getComputedStyle(el).opacity) < 0.9) {
        g.set(el, { clearProps: 'transform,opacity,visibility' });
      }
    }
  }, 3400);

  return () => {
    window.clearTimeout(sweep);
    stopHead();
    rest?.kill();
    g.killTweensOf(staged);
  };
}

/**
 * Screens 2 and 3 — the read/edit swap.
 *
 * The reference's `probToggle`: the headline is the only thing that moves, and
 * it moves in the direction of travel — down into edit, up back out. The panel
 * and the CTA are not tweened at all, because their change is a height and a
 * margin the stylesheet transitions (`.5s` and `.45s` on the reference's own
 * `cubic-bezier(.22,1,.36,1)`). That is the one place this flow uses CSS
 * rather than GSAP, and it is the reference's own implementation rather than a
 * simplification of it.
 *
 * It kills whatever the entrance left running on the same elements first: a
 * toggle two hundred milliseconds into the arrival would otherwise have two
 * owners of one transform.
 */
export function problemToggle(
  root: HTMLElement | null,
  head: HTMLElement | null,
  entering: boolean,
): () => void {
  const g = gsap();
  if (!g || !root || !motionLive()) return () => {};

  const parts = Array.from(
    root.querySelectorAll<HTMLElement>('[data-prob-part]'),
  );
  g.killTweensOf(parts);
  g.set(parts, { clearProps: 'opacity,visibility,transform' });

  if (!head) return () => {};
  g.from(head, {
    autoAlpha: 0,
    y: entering ? 10 : -10,
    duration: refDur(0.42), // between base 0.35 and slow 0.60
    ease: ease('out'), // power3.out
    clearProps: 'opacity,visibility,transform',
  });

  return () => {
    g.killTweensOf(head);
  };
}

/* ── Screen 4 — the campaign type ─────────────────────────────────────────
   REBUILT 2026-08-20 to the supplied reference's `[data-kind]` screen, and,
   like `inviteIntro` and `problemIntro` above, its durations are its own
   literals rather than the nearest token. Three of this sequence's beats are
   the whole point of it — the sticker's 0.58s `back.out(1.7)` drop, the
   travel's 0.55s + 0.20s two-keyframe landing, and the confirm stage's
   0.80/0.84/0.95 holds — and rounding any of them to `base`/`slow` collapses
   moves the eye reads as separate. The token each sits between is recorded
   beside it, `refDur` still applies §6.1's phone factor (the reference's own
   `k()`), and nothing exceeds §6.1's `grand: 0.90` ceiling.

   Every marker is `data-kind-part` / `data-kind-art` / `data-kind-row` /
   `data-kind-flip-art`, never `data-anim` — so `FlowPage`'s `relayIn` finds
   nothing on this page and these helpers own it outright. That is the same
   mechanism `InviteClaim` and `ConfirmAnswer` use, and it is why there is no
   flag in `FlowPage` to keep in step.                                       */

function kindPart(root: HTMLElement, name: string): HTMLElement | null {
  return root.querySelector<HTMLElement>('[data-kind-part="' + name + '"]');
}

/**
 * The pick stage's entrance — the reference's `kindIntro`, pick branch.
 *
 * The headline reveals word by word (the same private `revealHead` screens 1–3
 * use), and only when it has landed does the rest follow: the sticker drops in
 * and settles while the arrows spread out from behind it, then the copy and
 * the CTA. The reference's own comment for it — "the sticker is the
 * personality here" — is why it gets a `back.out(1.7)` over more than half a
 * second while everything around it moves in a quarter of one.
 *
 * Everything is staged synchronously, before this frame paints, so nothing can
 * flash at full opacity ahead of its own entrance.
 */
export function kindIntro(root: HTMLElement | null): () => void {
  const g = gsap();
  if (!g || !root || !motionLive()) return () => {};

  const head = kindPart(root, 'head');
  const art = kindPart(root, 'art');
  const body = kindPart(root, 'body');
  const cta = kindPart(root, 'cta');
  const others = [art, body, cta].filter((el): el is HTMLElement => !!el);
  const sticker = art?.querySelector<HTMLElement>('[data-kind-art]') ?? null;
  const arrows = art
    ? Array.from(art.querySelectorAll<HTMLElement>('button'))
    : [];
  const staged = [
    ...others,
    ...(head ? [head] : []),
    ...(sticker ? [sticker] : []),
    ...arrows,
  ];

  g.killTweensOf(staged);
  if (head) g.set(head, { autoAlpha: 0 });
  if (others.length) g.set(others, { autoAlpha: 0, y: 20 });
  if (cta) g.set(cta, { scale: 0.94, transformOrigin: '50% 50%' });
  if (sticker) {
    g.set(sticker, {
      autoAlpha: 0,
      scale: 0.4,
      rotate: -14,
      y: -40,
      transformOrigin: '50% 100%',
    });
  }
  if (arrows.length) g.set(arrows, { autoAlpha: 0, scale: 0.6 });

  let rest: ReturnType<GSAP['timeline']> | null = null;
  const runRest = () => {
    const tl = g.timeline({ defaults: { ease: ease('out') } }); // power3.out
    rest = tl;
    if (art) tl.to(art, { autoAlpha: 1, y: 0, duration: refDur(0.22) });
    if (sticker) {
      tl.to(
        sticker,
        {
          autoAlpha: 1,
          scale: 1,
          rotate: 0,
          y: 0,
          duration: refDur(0.58), // between base 0.35 and slow 0.60
          ease: 'back.out(1.7)', // its own, between snap's 1.4 and the arrows' 1.9
          clearProps: 'transform',
        },
        '-=0.18',
      );
    }
    if (arrows.length) {
      tl.to(
        arrows,
        {
          autoAlpha: 1,
          scale: 1,
          duration: refDur(0.34), // base 0.35, one hundredth away
          ease: 'back.out(1.9)',
          stagger: 0.05,
          clearProps: 'transform',
        },
        '-=0.34',
      );
    }
    if (body) {
      tl.to(body, { autoAlpha: 1, y: 0, duration: refDur(0.24) }, '-=0.2');
    }
    if (cta) {
      tl.to(
        cta,
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: refDur(0.3), // between quick 0.20 and base 0.35
          ease: 'back.out(1.6)',
        },
        '-=0.18',
      );
    }
  };

  let stopHead: () => void = () => {};
  if (head) stopHead = revealHead(head, runRest);
  else runRest();

  // The reference's own 3400ms backstop. `relayIn` cannot see this set —
  // `holdHidden` registers `[data-reveal]` and these are staged by an inline
  // `set` — so a dropped tween would otherwise leave a blank page with a
  // working keyboard path, the worst failure this flow has.
  const sweep = window.setTimeout(() => {
    for (const el of staged) {
      if (Number(getComputedStyle(el).opacity) < 0.9) {
        g.set(el, { clearProps: 'transform,opacity,visibility' });
      }
    }
  }, 3400);

  return () => {
    window.clearTimeout(sweep);
    stopHead();
    rest?.kill();
    g.killTweensOf(staged);
  };
}

/**
 * The confirm stage's entrance — the reference's `kindIntro`, confirm branch.
 *
 * Only reached when the confirm stage arrives WITHOUT the select choreography
 * having produced it (the reference's "coming back from sign-in: the rows are
 * the page"). Arriving through `Select` runs `kindLand` instead, which is a
 * different sequence entirely because one of the stickers is already in flight.
 */
export function kindRowsIntro(root: HTMLElement | null): () => void {
  const g = gsap();
  if (!g || !root || !motionLive()) return () => {};
  const rows = [
    ...Array.from(root.querySelectorAll<HTMLElement>('[data-kind-row]')),
    kindPart(root, 'confirm'),
  ].filter((el): el is HTMLElement => !!el);
  if (!rows.length) return () => {};
  g.fromTo(
    rows,
    { y: 20, autoAlpha: 0 },
    {
      y: 0,
      autoAlpha: 1,
      duration: refDur(0.46), // between base 0.35 and slow 0.60
      ease: ease('out'), // power3.out
      stagger: 0.08,
      clearProps: 'transform,opacity,visibility',
    },
  );
  return () => g.killTweensOf(rows);
}

/**
 * Paging between the two types — the reference's `kindGo`.
 *
 * The art slides in from the side it was paged from and the copy lifts under
 * it. The headline is deliberately NOT animated: one word of it changes ("a" /
 * "an"), and re-revealing a sentence for one letter reads as the page having
 * changed rather than the choice.
 */
export function kindSlide(root: HTMLElement | null, direction: 1 | -1): void {
  const g = gsap();
  if (!g || !root || !motionLive()) return;
  const art = root.querySelector<HTMLElement>('[data-kind-art]');
  const body = kindPart(root, 'body');
  if (art) {
    g.fromTo(
      art,
      { x: 34 * direction, autoAlpha: 0, scale: 0.94 },
      {
        x: 0,
        autoAlpha: 1,
        scale: 1,
        duration: refDur(0.45), // between base 0.35 and slow 0.60
        ease: ease('out'), // power3.out
        clearProps: 'opacity,visibility,transform',
      },
    );
  }
  if (body) {
    g.fromTo(
      body,
      { autoAlpha: 0, y: 8 },
      {
        autoAlpha: 1,
        y: 0,
        duration: refDur(0.36), // base 0.35, one hundredth away
        // The reference's own `power2.out`. The token set has `out`
        // (power3.out) and `move` (power2.inOut) and no power2.out, and over
        // an 8px settle the difference is visible.
        ease: 'power2.out',
        clearProps: 'opacity,visibility,transform',
      },
    );
  }
}

/**
 * Changing the answer on the confirm stage — the reference's `rowPick`.
 *
 * The row itself barely moves; the sticker is what answers. The outline and
 * the fill are a CSS transition on the row, exactly as there.
 */
export function kindRowPick(root: HTMLElement | null, index: number): void {
  const g = gsap();
  if (!g || !root || !motionLive()) return;
  const row = root.querySelectorAll<HTMLElement>('[data-kind-row]')[index];
  const art = root.querySelectorAll<HTMLElement>('[data-kind-flip-art]')[index];
  if (row) {
    g.fromTo(
      row,
      { scale: 0.985 },
      {
        scale: 1,
        duration: refDur(0.38), // between base 0.35 and slow 0.60
        ease: 'power2.out', // its own; see `kindSlide`
        clearProps: 'transform',
      },
    );
  }
  if (art) {
    g.fromTo(
      art,
      { scale: 0.9 },
      {
        scale: 1,
        duration: refDur(0.44), // between base 0.35 and slow 0.60
        ease: 'back.out(2)',
        clearProps: 'transform',
      },
    );
  }
}

/**
 * `Select`, phase 1 — the reference's `kindSelect`, up to its commit.
 *
 * The headline, copy and CTA fade out while the chosen sticker SWELLS, and the
 * stage is swapped 0.14s into that swell rather than after it. The reference's
 * own reasoning: "grow, and commit mid-grow — the re-render happens while the
 * eye tracks the swell, so grow and travel read as one continuous move instead
 * of grow-freeze-travel."
 *
 * `commit` is handed the sticker's rect at the moment of the swap, which is the
 * FIRST half of the manual FLIP `kindLand` completes. It runs exactly once —
 * from the timeline, from the reference's own 600ms backstop, or immediately
 * when motion is off, in which case the rect is null and there is no travel.
 * That is the jump-cut DNA §6.6 asks for rather than a second code path.
 */
export function kindSelect(
  root: HTMLElement | null,
  commit: (first: DOMRect | null) => void,
): void {
  const g = gsap();
  const art = root?.querySelector<HTMLElement>('[data-kind-art]') ?? null;
  if (!g || !root || !art || !motionLive()) {
    commit(null);
    return;
  }

  let ran = false;
  const go = () => {
    if (ran) return;
    ran = true;
    const first = art.getBoundingClientRect();
    art.style.willChange = '';
    commit(first);
  };

  const outs = [
    kindPart(root, 'head'),
    kindPart(root, 'body'),
    kindPart(root, 'cta'),
  ].filter((el): el is HTMLElement => !!el);
  g.killTweensOf([art, ...outs]);
  art.style.willChange = 'transform';

  const tl = g.timeline({ defaults: { ease: ease('move') } }); // power2.inOut
  if (outs.length) {
    tl.to(outs, { autoAlpha: 0, y: -10, duration: refDur(0.18) }, 0);
  }
  tl.to(
    art,
    {
      scale: 1.45,
      duration: refDur(0.3), // between quick 0.20 and base 0.35
      ease: 'power2.out', // its own; see `kindSlide`
      force3D: true,
    },
    0,
  );
  tl.add(go, 0.14);
  window.setTimeout(go, 600);
}

/**
 * `Select`, phase 2 — the reference's `kindSelect`, after its commit.
 *
 * A hand-written FLIP rather than GSAP's Flip plugin, because the reference's
 * is hand-written and the two do not produce the same movement: this one
 * inverts the sticker to where it already was and tweens it home through a
 * 1.05 overshoot and a `back.out(2.2)` settle, while `Flip.from` would take it
 * out of flow with `absolute` and land it on a single ease.
 *
 * Two things about it are easy to get wrong and are the reference's own notes:
 *
 *   1. The rects are viewport pixels and GSAP's `x`/`y` are LOCAL pixels.
 *      Inside a stage scaled to ~0.5 the delta has to be divided by the
 *      ancestor scale, or the invert lands short and the sticker jumps.
 *   2. The invert is set NOW, before this frame paints, and the tween plays on
 *      the next one — so the sticker never flashes in its landed spot, and the
 *      first frames of the travel do not drop while React finishes committing.
 *
 * The rest of the stage holds until the sticker has finished travelling: the
 * other row at 0.80, its sticker at 0.84, `Confirm` at 0.95. The chosen row
 * fades in immediately underneath, because the sticker is landing INTO it.
 */
export function kindLand(
  root: HTMLElement | null,
  index: number,
  first: DOMRect | null,
): void {
  const g = gsap();
  if (!g || !root || !motionLive()) return;

  const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-kind-row]'));
  const arts = Array.from(
    root.querySelectorAll<HTMLElement>('[data-kind-flip-art]'),
  );
  const cta = kindPart(root, 'confirm');
  const selRow = rows[index];
  const selArt = arts[index];
  const otherRows = rows.filter((_, i) => i !== index);
  const otherArts = arts.filter((_, i) => i !== index);

  if (selRow) {
    g.fromTo(
      selRow,
      { autoAlpha: 0 },
      {
        autoAlpha: 1,
        duration: refDur(0.24), // between quick 0.20 and base 0.35
        ease: 'power2.out', // its own; see `kindSlide`
        clearProps: 'opacity,visibility',
      },
    );
  }
  if (otherRows.length) {
    g.fromTo(
      otherRows,
      { y: 16, autoAlpha: 0 },
      {
        y: 0,
        autoAlpha: 1,
        duration: refDur(0.3), // between quick 0.20 and base 0.35
        ease: ease('out'), // power3.out
        delay: 0.8,
        stagger: 0.06,
        clearProps: 'transform,opacity,visibility',
      },
    );
  }
  if (otherArts.length) {
    g.fromTo(
      otherArts,
      { scale: 0.72, autoAlpha: 0 },
      {
        scale: 1,
        autoAlpha: 1,
        duration: refDur(0.34), // base 0.35, one hundredth away
        ease: 'back.out(1.7)',
        delay: 0.84,
        clearProps: 'transform,opacity,visibility',
      },
    );
  }
  if (cta) {
    g.fromTo(
      cta,
      { y: 14, autoAlpha: 0 },
      {
        y: 0,
        autoAlpha: 1,
        duration: refDur(0.28), // between quick 0.20 and base 0.35
        ease: ease('out'), // power3.out
        delay: 0.95,
        clearProps: 'transform,opacity,visibility',
      },
    );
  }

  if (!selArt || !first) return;
  const last = selArt.getBoundingClientRect();
  g.killTweensOf(selArt);
  const ps = selArt.offsetWidth ? last.width / selArt.offsetWidth : 1;
  g.set(selArt, {
    x: (first.left + first.width / 2 - (last.left + last.width / 2)) / ps,
    y: (first.top + first.height / 2 - (last.top + last.height / 2)) / ps,
    scale: last.height ? first.height / last.height : 1,
    transformOrigin: '50% 50%',
    autoAlpha: 1,
    force3D: true,
    willChange: 'transform',
  });
  requestAnimationFrame(() => {
    g.to(selArt, {
      keyframes: [
        {
          x: 0,
          y: 0,
          scale: 1.05,
          duration: refDur(0.55), // between base 0.35 and slow 0.60
          ease: ease('move'), // power2.inOut
        },
        {
          scale: 1,
          duration: refDur(0.2), // quick 0.20, exactly
          ease: 'back.out(2.2)',
        },
      ],
      force3D: true,
      onComplete: () => g.set(selArt, { clearProps: 'transform,willChange' }),
    });
  });
}

/**
 * `Confirm` — the reference's `kindConfirmGo`.
 *
 * Its own fade, rather than `pageExit`'s: this screen leaves at 0.28s where
 * every other page leaves at `quick`, and the element that fades is the scaled
 * stage rather than the whole page. `pageExit` is shared by twenty-four routes
 * and re-tuning it here would re-tune all of them.
 *
 * The 520ms backstop is the reference's own and exists for the reason
 * `pageExit`'s does: a tween in a backgrounded tab does not progress, and
 * without it somebody who switched tabs mid-transition comes back to a page
 * that faded and never left. It drives a NAVIGATION and never a record.
 */
export function kindExit(stage: HTMLElement | null, done: () => void): void {
  const g = gsap();
  if (!g || !stage || !motionLive()) {
    done();
    return;
  }
  let ran = false;
  const fallback = window.setTimeout(() => {
    if (ran) return;
    ran = true;
    done();
  }, 520);
  g.to(stage, {
    autoAlpha: 0,
    duration: refDur(0.28), // between quick 0.20 and base 0.35
    ease: ease('exit'), // power2.in
    overwrite: 'auto',
    onComplete: () => {
      if (ran) return;
      ran = true;
      window.clearTimeout(fallback);
      done();
    },
  });
}

/* ── Founder Flow v2 — screen 5, the address ───────────────────────────────
   Rebuilt 2026-08-20 to the supplied reference's own `verifyIntro`. */

/**
 * The relay entrance for a page authored on the reference's fixed stage.
 *
 * `relayIn` is the same motion for a page laid out in CSS pixels: it converts
 * the reference's 150px travel down to ~56 CSS px, because 150 is a value on a
 * 2496px stage rendered at a fraction of its size, and 150 real pixels at 320
 * would be half the screen.
 *
 * A fixed-stage page needs the raw number instead. Its children live INSIDE
 * the scaled stage, so a transform of 150 there is already 150 × the stage's
 * own scale on screen — about 68px at 1440 — which is what the reference
 * actually renders. Converting a second time would relay a quarter of the
 * distance.
 *
 * That is the whole difference, and it is why this is a separate helper rather
 * than a flag on `relayIn`: the two take their travel from different coordinate
 * systems, and a caller that passed the wrong one would get a motion that looks
 * plausible and is not the reference's.
 *
 * The markers are `data-stage-anim`, not `data-anim`, which is what makes
 * `FlowPage`'s own `relayIn` a no-op on these pages rather than something to
 * switch off — the `data-invite` / `data-prob-part` arrangement screens 1–3
 * already use.
 *
 * The reference's own tween, from `verifyIntro`:
 *
 *     g.fromTo(relay, { x: 150 * d, opacity: 0 },
 *       { x: 0, opacity: 1, duration: .62, ease: 'power3.out',
 *         stagger: { each: .085, from: back ? 'end' : 'start' } })
 *
 * `order` is the reference's own fixed list — `pill, head, field, boxes, note,
 * fee, sub, hint, panel, art, art2, cta, edit` — filtered to what is present.
 * It is passed in rather than read from the DOM because the stagger follows
 * THAT order and not document order, and on a page whose markers happen to be
 * written out of sequence the two are different animations.
 */
export function stageRelayIn(
  root: HTMLElement | null,
  direction: 1 | -1,
  order: readonly string[],
): () => void {
  const g = gsap();
  if (!g || !root || !motionLive()) return () => {};

  const relay = order
    .map((name) =>
      root.querySelector<HTMLElement>('[data-stage-anim="' + name + '"]'),
    )
    .filter((el): el is HTMLElement => !!el);
  if (!relay.length) return () => {};

  g.killTweensOf(relay);
  g.fromTo(
    relay,
    { x: 150 * direction, autoAlpha: 0 },
    {
      x: 0,
      autoAlpha: 1,
      // The reference's literal numbers, through `refDur`, on the same
      // `problemIntro` licence recorded above: this file's convention is to
      // round to the nearest §6.1 token, and the brief for these pages is a
      // 1:1 behavioural reproduction. `slow` 0.60 and `stagger.base` 0.08 were
      // what stood here, and against a frame-by-frame capture of the reference
      // the three elements land 20ms and 15ms early — small, but the whole
      // point of a relay is when each piece arrives. 0.62 is inside §6.1's
      // `grand: 0.90` ceiling, and §6.1's phone factor still applies.
      duration: refDur(0.62), // between slow 0.60 and grand 0.90
      ease: ease('out'), // power3.out
      force3D: true,
      stagger: {
        each: refDur(0.085), // its own number; stagger.base 0.08 is the token
        // Back navigation relays from the LAST child, so the element the
        // person is returning toward is the one that arrives first.
        from: direction === -1 ? 'end' : 'start',
      },
      clearProps: 'transform,opacity,visibility',
      overwrite: 'auto',
    },
  );

  // The reference's own `this.later(... clearProps ...)` backstop, and
  // `relayIn`'s stuck sweep: the runtime's 3s force-reveal only registers
  // `[data-reveal]`, and these are staged by an inline `fromTo`. A dropped
  // tween would otherwise leave a blank page with a working keyboard path.
  const sweep = window.setTimeout(() => {
    for (const el of relay) {
      if (Number(getComputedStyle(el).opacity) < 0.9) {
        g.set(el, { clearProps: 'transform,opacity,visibility' });
      }
    }
  }, 3400);

  return () => {
    window.clearTimeout(sweep);
    g.killTweensOf(relay);
  };
}

/** Screen 22's below-floor input beat, copied from `goalNext`. */
export function thresholdFloorPop(input: HTMLElement | null): void {
  const g = gsap();
  if (!g || !input || !motionLive()) return;
  g.killTweensOf(input);
  g.fromTo(
    input,
    { scale: 0.97 },
    {
      scale: 1,
      duration: refDur(0.45),
      ease: 'back.out(2)',
      clearProps: 'transform',
    },
  );
}

/** The reference Help drawer's literal desktop entrance. */
export function referenceDrawerOpen(
  drawer: HTMLElement | null,
  scrim: HTMLElement | null,
): void {
  const g = gsap();
  if (!g || !drawer || !motionLive()) return;
  g.killTweensOf(drawer);
  g.set(drawer, { clearProps: 'transform' });
  if (scrim) {
    g.killTweensOf(scrim);
    g.fromTo(
      scrim,
      { opacity: 0 },
      { opacity: 1, duration: refDur(0.25), clearProps: 'opacity', overwrite: 'auto' },
    );
  }
  const from = phone() ? { yPercent: 100 } : { xPercent: 100 };
  g.fromTo(drawer, from, {
    xPercent: 0,
    yPercent: 0,
    duration: refDur(0.4),
    ease: 'power3.out',
    clearProps: 'transform',
    overwrite: 'auto',
  });
}

/** The reference Help drawer exits before React removes it. */
export function referenceDrawerClose(
  drawer: HTMLElement | null,
  done: () => void,
): void {
  const g = gsap();
  if (!g || !drawer || !motionLive()) {
    done();
    return;
  }
  g.killTweensOf(drawer);
  g.to(drawer, {
    ...(phone() ? { yPercent: 100 } : { xPercent: 100 }),
    duration: refDur(0.28),
    ease: 'power2.in',
    onComplete: done,
  });
}

/**
 * The flourish — `verifyIntro`'s last branch, for a page whose focal panel is a
 * preview or a card.
 *
 * The reference's own comment says what it is for: "pages whose focal panel is
 * a preview or a card: it lands with a scale so the screen has a beat of its
 * own instead of the flat relay". It runs BESIDE the relay rather than inside
 * it — the element is not in `verifyIntro`'s thirteen-name list at all — so a
 * page can have both, and the FAQ screen does: `panel`, `art` and `cta` relay
 * while the preview card scales up underneath the `art` column's own travel.
 *
 * Its literal tween, from `verifyIntro`:
 *
 *     const flo = [...root.querySelectorAll('[data-flourish]')];
 *     if (flo.length) {
 *       g.killTweensOf(flo);
 *       g.fromTo(flo, { scale: .9, opacity: 0, transformOrigin: '50% 50%' },
 *         { scale: 1, opacity: 1, duration: .8, ease: 'back.out(1.3)',
 *           delay: .24, stagger: .12, force3D: true,
 *           clearProps: 'transform,opacity' });
 *     }
 *
 * `back.out(1.3)` overshoots — sampled against the reference at 1600x793 the
 * card peaks at `scale(1.0061)` around 760ms and settles by 1050ms — so the
 * ease is `snap` rather than `out`. §6.1's `snap` is `back.out(1.4)`, which is
 * the nearest token and the one `stageGrowIn`'s sibling already uses; 1.3 and
 * 1.4 differ by about a thousandth of the box at the peak, and a fourth
 * hand-written cubic beside three tokens is the drift this file exists to
 * avoid.
 *
 * The marker is `data-stage-flourish`, not `data-flourish`, for the reason
 * `stageRelayIn` records about its own: `FlowPage`'s `relayIn` must stay a
 * no-op on these pages rather than being something to switch off.
 */
export function stageFlourishIn(root: HTMLElement | null): () => void {
  const g = gsap();
  if (!g || !root || !motionLive()) return () => {};

  const cards = [...root.querySelectorAll<HTMLElement>('[data-stage-flourish]')];
  if (!cards.length) return () => {};

  g.killTweensOf(cards);
  g.fromTo(
    cards,
    { scale: 0.9, autoAlpha: 0, transformOrigin: '50% 50%' },
    {
      scale: 1,
      autoAlpha: 1,
      duration: refDur(0.8), // between slow 0.60 and grand 0.90
      ease: ease('snap'), // back.out(1.4); the reference writes back.out(1.3)
      delay: refDur(0.24), // its own number; quick 0.20 is the nearest token
      stagger: refDur(0.12),
      force3D: true,
      clearProps: 'transform,opacity,visibility',
      overwrite: 'auto',
    },
  );

  // `stageRelayIn`'s stuck sweep, for the same reason: the runtime's own 3s
  // force-reveal only registers `[data-reveal]`, and these are staged by an
  // inline `fromTo`.
  const sweep = window.setTimeout(() => {
    for (const el of cards) {
      if (Number(getComputedStyle(el).opacity) < 0.9) {
        g.set(el, { clearProps: 'transform,opacity,visibility' });
      }
    }
  }, 3400);

  return () => {
    window.clearTimeout(sweep);
    g.killTweensOf(cards);
  };
}

/**
 * Screen 20 — the listing fee's entrance, which is the flow's one title-FIRST
 * page. Rebuilt 1:1 from the reference's `[data-paynow]`, 2026-08-21.
 *
 * `verifyIntro` picks this branch for exactly one screen, by name:
 *
 *     const bigFirst = !back && !growFirst && root.matches('[data-paynow]');
 *     const bigHead  = bigFirst ? root.querySelector('[data-anim="head"]') : null;
 *     if (bigHead) {
 *       const rest = els.filter(e => e !== bigHead);
 *       const go = () => { if(ran)return; ran=true; g.fromTo(rest,{x:150*d,opacity:0},
 *         {x:0,opacity:1,duration:.62,ease:'power3.out',force3D:true,
 *          stagger:{each:.085,from:'start'},clearProps:'transform,opacity'}); };
 *       g.set(rest,{opacity:0});
 *       const r  = bigHead.getBoundingClientRect();
 *       const ps = bigHead.offsetWidth ? r.width/bigHead.offsetWidth : 1;
 *       const dx = (window.innerWidth /2 - (r.left + r.width /2))/ps;
 *       const dy = (window.innerHeight/2 - (r.top  + r.height/2))/ps;
 *       const s  = Math.min(2.4, Math.max(1.3, (window.innerWidth*.82)/Math.max(1,r.width)));
 *       g.fromTo(bigHead,{x:dx,y:dy,scale:s,opacity:0},
 *         {x:0,y:0,scale:1,opacity:1,duration:1.15,ease:'power2.inOut',force3D:true,
 *          transformOrigin:'50% 50%',clearProps:'transform',onComplete:go});
 *       this.later(go,1400);
 *     }
 *
 * So the headline opens large in the middle of the VIEWPORT, travels and
 * shrinks into its real place over 1.15s, and only then do the number, the
 * saving, the discount control and the CTA relay in behind it. Its own comment:
 * "the headline opens big in the middle of the screen, shrinks into its real
 * place, then everything else relays in behind it."
 *
 * ── The three numbers that are read rather than written ────────────────────
 * `ps` is the STAGE's scale, recovered from the ratio of the laid-out width to
 * the offset width — the element sits inside a `scale(0.41)` stage, so a
 * viewport-space delta has to be divided by it before GSAP applies it in the
 * element's own space. `dx`/`dy` centre it on the viewport, not on the stage.
 * `s` is capped at 2.4 and floored at 1.3 so the title is legible at a narrow
 * width and does not run off the edge at a wide one. All three are computed at
 * mount from the real box, which is why nothing here is a magic number.
 *
 * ── 1.15s exceeds §6.1's `grand` and is kept ──────────────────────────────
 * The one-shot landing of a page title, once per arrival, on the same licence
 * `problemIntro` records and `reachIntro`'s `refDur(1)` count already takes.
 * Rounding it to 0.90 makes the travel and the scale finish before the eye has
 * followed them, which is the beat the whole entrance is. §6.1's phone factor
 * still applies, through the same `t()` every other helper uses.
 *
 * ── On BACK it is an ordinary relay, head included ─────────────────────────
 * `bigFirst` is `!back && …`, so on a back navigation the caller uses
 * {@link stageRelayIn} with the head IN the order and `from: 'end'`. Replaying
 * the landing on the way back would re-introduce a page somebody is leaving.
 *
 * `order` is the reference's own `els` sequence out of `verifyIntro`'s fixed
 * list, passed rather than read from the DOM because the 0.085s stagger follows
 * THAT order. The head is filtered out of it here, exactly as `rest` is there.
 */
export function stageBigHeadIn(
  root: HTMLElement | null,
  order: readonly string[],
): () => void {
  const g = gsap();
  if (!g || !root || !motionLive()) return () => {};

  const head = root.querySelector<HTMLElement>('[data-stage-anim="head"]');
  const rest = order
    .map((name) => root.querySelector<HTMLElement>('[data-stage-anim="' + name + '"]'))
    .filter((el): el is HTMLElement => !!el && el !== head);
  if (!head || !rest.length) return () => {};

  let ran = false;
  const go = () => {
    if (ran) return;
    ran = true;
    g.fromTo(
      rest,
      { x: 150, autoAlpha: 0 },
      {
        x: 0,
        autoAlpha: 1,
        duration: refDur(0.62), // between slow 0.60 and grand 0.90
        ease: ease('out'), // power3.out
        force3D: true,
        stagger: { each: refDur(0.085), from: 'start' },
        clearProps: 'transform,opacity,visibility',
        overwrite: 'auto',
      },
    );
  };

  g.killTweensOf(rest);
  g.killTweensOf(head);
  // Measure from the UNTWEENED box. React 19's StrictMode double-invokes an
  // effect in development, and without this the second invocation measures the
  // head mid-flight — 1082px wide instead of 479px — so `s` clamps to its 1.3
  // floor and `dx`/`dy` come out as zero, which is a landing that does not
  // travel. The reference's own function runs once and never meets it; this is
  // the same numbers computed from the same box however many times it runs.
  g.set(head, { clearProps: 'transform' });
  g.set(rest, { autoAlpha: 0 });

  const box = head.getBoundingClientRect();
  const scale = head.offsetWidth ? box.width / head.offsetWidth : 1;
  const dx = (window.innerWidth / 2 - (box.left + box.width / 2)) / (scale || 1);
  const dy = (window.innerHeight / 2 - (box.top + box.height / 2)) / (scale || 1);
  const from = Math.min(2.4, Math.max(1.3, (window.innerWidth * 0.82) / Math.max(1, box.width)));

  g.fromTo(
    head,
    { x: dx, y: dy, scale: from, autoAlpha: 0 },
    {
      x: 0,
      y: 0,
      scale: 1,
      autoAlpha: 1,
      duration: refDur(1.15), // the reference's own; see the note above
      ease: ease('move'), // power2.inOut
      force3D: true,
      transformOrigin: '50% 50%',
      clearProps: 'transform',
      overwrite: 'auto',
      onComplete: go,
    },
  );

  // The reference's own `this.later(go, 1400)`: a dropped `onComplete` would
  // otherwise leave four elements at opacity 0 with a working keyboard path,
  // which is the worst failure this page has because nothing looks broken.
  const late = window.setTimeout(go, 1400);
  // And its `this.later(clearProps, 3400)` — `stageRelayIn`'s stuck sweep, for
  // the same reason: the runtime's 3s force-reveal only registers
  // `[data-reveal]`, and these are staged by an inline `fromTo`.
  const sweep = window.setTimeout(() => {
    for (const el of [head, ...rest]) {
      if (Number(getComputedStyle(el).opacity) < 0.9) {
        g.set(el, { clearProps: 'transform,opacity,visibility' });
      }
    }
  }, 3400);

  return () => {
    window.clearTimeout(late);
    window.clearTimeout(sweep);
    g.killTweensOf([head, ...rest]);
    // A killed tween leaves its last frame on the element; the next run has to
    // measure a real box, and anything that unmounted mid-flight must not be
    // left half-scaled and invisible.
    g.set([head, ...rest], { clearProps: 'transform,opacity,visibility' });
  };
}

/**
 * The pay sheet's entrance — the reference's own `payModalIn`, verbatim:
 *
 *     g.from(el, {y:18, opacity:0, scale:.97, duration:.34,
 *                 ease:'power3.out', clearProps:'transform,opacity'});
 *
 * It belongs to `[data-paypick]`'s card rather than to the fee screen, and it
 * is reused here because the sheet is that card: §13's billing address, tax
 * total and Appendix A.5 have no room in the fee screen's composition, so they
 * open in the reference's own modal vocabulary rather than in one invented for
 * them. `Modal`'s shared `animateModalOpen` is deliberately not used — this is
 * a 1:1 screen and its card has its own tween.
 */
export function paySheetIn(el: HTMLElement | null): void {
  const g = gsap();
  if (!g || !el || !motionLive()) return;
  g.killTweensOf(el);
  // Reset before measuring, for `stageBigHeadIn`'s reason and with a worse
  // symptom: `g.from` takes the element's CURRENT state as its DESTINATION, so
  // under React 19's StrictMode double-invoke the second call found the first
  // call's from-state and animated y18→y18 — a card that sat still for 340ms
  // and then snapped into place. Sampled frame by frame, not noticed by eye.
  g.set(el, { clearProps: 'transform,opacity' });
  g.from(el, {
    y: 18,
    // `opacity`, not `autoAlpha` — the reference's own property, and the
    // difference is load-bearing here rather than stylistic. `autoAlpha` sets
    // `visibility: hidden` for the first frame, and an element that is
    // `visibility: hidden` cannot take focus: the sheet opened with focus
    // still on `<body>`, so a keyboard user was left outside a dialog that
    // claimed `aria-modal`. Found by tracing `document.activeElement`.
    opacity: 0,
    scale: 0.97,
    duration: refDur(0.34), // between quick 0.20 and base 0.35
    ease: ease('out'), // power3.out
    transformOrigin: '50% 50%',
    clearProps: 'transform,opacity',
    overwrite: 'auto',
  });
}

/**
 * Screen 15 — Last look's entrance, which is the flow's one headline-first page.
 *
 * REBUILT 2026-08-20 to the supplied reference's `[data-lastlook]`
 * (`Proovd Founder Flow v2.dc.html`, `kindWide`). `verifyIntro` picks this
 * branch for exactly one screen, by name:
 *
 *     const headFirst = !back && root.matches('[data-lastlook]');
 *     const head  = headFirst ? root.querySelector('[data-anim="head"]') : null;
 *     const relay = head ? els.filter(e => e !== head) : els;
 *     …
 *     } else if (head) {
 *       g.set(head, {opacity: 0});
 *       g.set(relay, {opacity: 0});
 *       this.revealHead(head, this.k(), null, () => this.later(runRelay, 90));
 *
 * So the title opens word by word on its own, and the six things under it
 * relay in 90ms after the reveal is 55% done — while the last word is still
 * landing, which is the reference's own comment for why the call sits at 55%
 * and not at the end.
 *
 * ── The 90ms is a real number and not a rounding ───────────────────────────
 * Sampled frame by frame against the reference at 1320×900: the words start at
 * 31ms, the relay starts at 333ms. The word timeline is 0.38 + 0.026 = 0.406s,
 * 55% of it is 223ms, plus 90 is 313 — one frame before the 333 observed. Both
 * halves have to be here or the beat is wrong in a way a screenshot cannot see.
 *
 * ── On BACK it is an ordinary relay, head included ─────────────────────────
 * `headFirst` is `!back && …`, so `head` is null on a back navigation and
 * `relay` is the whole list — the title relays with everything else, from the
 * END, like every other page. Reproducing the reveal on the way back would
 * re-introduce a page somebody is leaving.
 *
 * `order` is the reference's own `els` sequence for this screen, out of
 * `verifyIntro`'s fixed list, and it is passed rather than read from the DOM
 * because the 0.085s stagger follows THAT order and not document order.
 */
export function lastLookIntro(
  root: HTMLElement | null,
  direction: 1 | -1,
  order: readonly string[],
): () => void {
  const g = gsap();
  if (!g || !root || !motionLive()) return () => {};

  const pick = (name: string) =>
    root.querySelector<HTMLElement>('[data-stage-anim="' + name + '"]');
  const staged = order
    .map(pick)
    .filter((el): el is HTMLElement => !!el);
  if (!staged.length) return () => {};

  const head = direction === 1 ? pick('head') : null;
  const relay = head ? staged.filter((el) => el !== head) : staged;

  g.killTweensOf(staged);

  const runRelay = () => {
    if (!relay.length) return;
    g.fromTo(
      relay,
      { x: 150 * direction, autoAlpha: 0 },
      {
        x: 0,
        autoAlpha: 1,
        duration: refDur(0.62), // between slow 0.60 and grand 0.90
        ease: ease('out'), // power3.out
        force3D: true,
        stagger: {
          each: refDur(0.085), // its own number; stagger.base 0.08 is the token
          from: direction === -1 ? 'end' : 'start',
        },
        clearProps: 'transform,opacity,visibility',
        overwrite: 'auto',
      },
    );
  };

  let handoff = 0;
  let stopHead: () => void = () => {};
  if (head) {
    // Synchronously, before paint: the title and everything under it are
    // hidden in the same frame the page mounts, so nothing can flash at full
    // opacity ahead of its own entrance.
    g.set(head, { autoAlpha: 0 });
    g.set(relay, { autoAlpha: 0 });
    stopHead = revealHead(
      head,
      () => {
        /* the reference passes `null` here: the reveal owns only the title */
      },
      () => {
        handoff = window.setTimeout(runRelay, 90);
      },
    );
  } else {
    runRelay();
  }

  // `relayIn`'s stuck sweep, for a set the runtime cannot see: `holdHidden`
  // registers `[data-reveal]` and these are staged by an inline `set`. A
  // dropped tween would otherwise leave a blank page with a working keyboard
  // path — and on this page that is a Founder looking at nothing while every
  // control still answers the keyboard.
  const sweep = window.setTimeout(() => {
    for (const el of staged) {
      if (Number(getComputedStyle(el).opacity) < 0.9) {
        g.set(el, { clearProps: 'transform,opacity,visibility' });
      }
    }
  }, 3400);

  return () => {
    window.clearTimeout(handoff);
    window.clearTimeout(sweep);
    stopHead();
    g.killTweensOf(staged);
  };
}

/* ── Screen 7 — "Say it instead", and the recording controls ───────────────
   REBUILT 2026-08-20 to the supplied reference's `[data-compet]` screen
   (`Proovd Founder Flow v2.dc.html`, `kindWide`). Both helpers below are the
   reference's own `sayHandoff` and `recIntro`, tween for tween.

   Their durations are the reference's literals rather than the nearest §6.1
   token, on the licence `problemIntro`, `stageRelayIn` and `kindIntro` above
   already carry: the brief for these pages is a 1:1 behavioural reproduction,
   and these two numbers in particular are the beat — 0.24/0.28 is one
   continuous move that reads as the microphone TAKING the row, and rounding
   either to `quick` 0.20 or `base` 0.35 turns it into two separate gestures.
   `refDur` still applies §6.1's phone factor and nothing here approaches
   §6.1's `grand: 0.90` ceiling.

   The markers are `data-say-row` / `data-say-btn` / `data-say-next` /
   `data-rec-row` / `data-wave`, which are the reference's own attribute names,
   and none of them is `data-anim` — so `FlowPage`'s `relayIn` still finds
   nothing on this page and these helpers own it outright.                  */

/**
 * "Say it instead" grows to take the row, then hands off to the recorder.
 *
 * The reference's own comment for it: *one continuous move: Next collapses as
 * the mic takes the row, then a single fade out*. So `Next` loses its width and
 * its opacity while the row's gap closes and the mic button widens to the row's
 * FULL width — all three starting together at 0 — and only once the mic has
 * arrived at that width does it fade, at 0.26s, over 0.12s.
 *
 * `onStart` runs when the timeline ends (0.38s), which is where the reference
 * calls `startDict`. It is the caller's business what that means: there, a
 * simulated transcript begins typing itself; here, a real recorder starts. The
 * animation is identical either way, which is the point of taking a callback
 * rather than knowing.
 *
 * The width is read from `row.offsetWidth` — LAYOUT width, so it is in the
 * stage's own 1660px coordinate system rather than in rendered CSS pixels. That
 * is what makes one number correct at every viewport: the stage scales it.
 *
 * With motion off, `onStart` is called immediately. That is the jump-cut rather
 * than a second code path, and it is also what happens when the reference
 * cannot find GSAP (`if(!g||!row||!btn){ this.startDict(id); return; }`).
 */
export function sayHandoff(root: HTMLElement | null, onStart: () => void): void {
  const g = gsap();
  const row = root?.querySelector<HTMLElement>('[data-say-row]') ?? null;
  const btn = row?.querySelector<HTMLElement>('[data-say-btn]') ?? null;
  if (!g || !row || !btn || !motionLive()) {
    onStart();
    return;
  }

  const next = row.querySelector<HTMLElement>('[data-say-next]');
  const full = row.offsetWidth;
  g.killTweensOf([row, btn, next].filter(Boolean));

  // Every leg is added to the same timeline at an explicit position rather than
  // chained: the shim's `to` returns `unknown`, and the positions are what
  // carry the choreography anyway — three of these start together at 0.
  const tl = g.timeline({ defaults: { ease: ease('move') } }); // power2.inOut
  if (next) tl.to(next, { width: 0, opacity: 0, duration: refDur(0.24) }, 0);
  tl.to(row, { gap: 0, duration: refDur(0.24) }, 0);
  tl.to(btn, { width: full, duration: refDur(0.28) }, 0);
  tl.to(
    btn,
    // `power1.in`, WRITTEN OUT rather than read from a token. §6.1's `exit`
    // is `power2.in`, which is what stood here and what a runtime capture of
    // this timeline reported — but the reference's own line is
    // `.to(btn,{opacity:0,duration:.12,ease:'power1.in'},.26)`, and over 0.12s
    // the difference between a squared and a linear ease-in is the difference
    // between the mic vanishing and the mic leaving. Corrected 2026-08-20
    // against the story screen; the positioning screen shares this helper and
    // takes the same correction.
    { opacity: 0, duration: refDur(0.12), ease: 'power1.in' },
    refDur(0.26),
  );
  tl.add(onStart);
}

/**
 * The recording controls announce themselves, the waveform draws itself up, and
 * then the waveform stays alive for as long as the recording does.
 *
 * The reference's `recIntro` plus the `[data-wave]` leg of its `loops()`, which
 * `startDict` reaches through `rebind()`'s `requestAnimationFrame` on the frame
 * after the entrance — so the two are one behaviour and are written as one here.
 *
 *   1. The three columns rise 14px and fade in 0.05s apart.
 *   2. Every bar scales up from its own base 0.003s apart, outward from the
 *      centre of the row. 72 × 0.003 is a 0.21s sweep that reads as the level
 *      arriving rather than as 72 things animating.
 *   3. From the next frame every bar breathes between `scaleY .28` and `1` on a
 *      0.45s yoyo, phased by `(i % 8) * .09`. The reference's own comment says
 *      why it is modulo rather than cumulative: *"the delay used to accumulate
 *      across all 72 bars, so the far end sat still for seconds — phase it in a
 *      repeating cycle instead: the whole strip is alive at once"*.
 *
 * `transform-origin: bottom` is on the bars in CSS, so a bar grows up from the
 * baseline instead of out from its middle. Without it the sweep reads as a row
 * of dashes appearing, which is a different picture entirely.
 *
 * The loop is indefinite, which everywhere else in this product is the pattern
 * DNA §5.10 and §30 name — and this is the one shape that is not it. It is a
 * live readout of a recording that is running, it is `aria-hidden`, it asks for
 * nothing, and it stops the moment the recording does. The reference's OTHER
 * indefinite loop on this page, the message badge's six-second shake, IS that
 * pattern and is refused (`FOUNDER_FLOW_ABSENCES`).
 *
 * `power2.out` and `power2.inOut` are the reference's own eases here; `out` is
 * `power3.out` and `move` is `power2.inOut`, so the second reads from the token
 * and the first is written literally. Returns a teardown, because an infinite
 * tween that outlives its element is a leak.
 */
export function recIntro(root: HTMLElement | null): () => void {
  const g = gsap();
  if (!g || !root || !motionLive()) return () => {};

  const row = root.querySelector<HTMLElement>('[data-rec-row]');
  if (row) {
    const cols = Array.from(row.children);
    g.killTweensOf(cols);
    g.fromTo(
      cols,
      { y: 14, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: refDur(0.26), // between quick 0.20 and base 0.35
        ease: ease('out'), // power3.out
        stagger: refDur(0.05),
        clearProps: 'transform,opacity',
      },
    );
  }

  const bars = Array.from(root.querySelectorAll<HTMLElement>('[data-wave]'));
  if (!bars.length) {
    return () => {
      if (row) g.killTweensOf(Array.from(row.children));
    };
  }

  g.killTweensOf(bars);
  g.fromTo(
    bars,
    { scaleY: 0 },
    {
      scaleY: 1,
      duration: refDur(0.3), // between quick 0.20 and base 0.35
      ease: 'power2.out', // its own; `out` is power3.out
      stagger: { each: refDur(0.003), from: 'center' },
      // `proovd-motion.js` sets `gsap.defaults({ overwrite: 'auto' })`
      // globally and the reference does not, so without this the two tweens
      // below fight: `from: 'center'` makes the OUTERMOST bars' legs start
      // last, at ~0.21s, by which time their loop is already rendering — and
      // `auto` kills it. Bars 0, 1 and 71 then sat flat at full height over a
      // live microphone while the middle of the strip breathed. Measured, not
      // reasoned: it is invisible to jsdom and to a still screenshot.
      overwrite: false,
      // The reference clears the transform here. It is NOT cleared, and the
      // difference is a defect a frame-by-frame capture found: `from: 'center'`
      // means the OUTERMOST bars finish last, by which time the loop below is
      // already writing their transform — and the clear wipes it, leaving bars
      // 0, 1 and 71 flat over a live microphone while the middle of the strip
      // breathes. There is nothing to clear anyway: the loop owns the property
      // from the next frame, and the whole row unmounts when recording stops.
    },
  );

  // The frame after, exactly as `rebind()` schedules `loops()`. Started here
  // rather than in a second helper because nothing else could start it at the
  // right moment, and a caller that forgot would leave a dead waveform over a
  // live microphone.
  const frame = window.requestAnimationFrame(() => {
    bars.forEach((bar, i) => {
      g.fromTo(
        bar,
        { scaleY: 0.28 },
        {
          scaleY: 1,
          duration: refDur(0.45), // between base 0.35 and slow 0.60
          ease: ease('move'), // power2.inOut
          repeat: -1,
          yoyo: true,
          delay: refDur((i % 8) * 0.09),
          overwrite: false, // the other half of the pair above

        },
      );
    });
  });

  return () => {
    window.cancelAnimationFrame(frame);
    g.killTweensOf(bars);
    if (row) g.killTweensOf(Array.from(row.children));
  };
}

/* ── Founder Flow v2 — the reach orbit ─────────────────────────────────────
   Built 2026-08-20 from the supplied reference's `reachIntro` / `reachLayout`
   / `reachFrame` / `reachPlay` / `reachFinish`, which are reproduced here
   whole rather than approximated.

   ── Why the arithmetic is transcribed and not re-derived ──────────────────
   This is not a CSS animation with a duration to copy. It is a hand-written
   3D layout: two tilted rings of phones, positioned per frame in a perspective
   space whose depth, radius, card size, per-ring speed and per-card opacity
   are all functions of ONE derived `unit` — itself a function of the viewport.
   Change any constant and the composition is a different picture at every
   window size, not a slightly different one at the reference's. So every
   number below is the reference's own, and the two places its own comments
   explain a choice are quoted rather than paraphrased.

   ── The one deliberate departure, and it is `prefers-reduced-motion` ──────
   In the reference the ticker is added BEFORE `reachPlay` checks the media
   query, so a reduced-motion reader gets no count-up and no pop-in and still
   gets a 3D carousel rotating indefinitely. That reads as an oversight rather
   than an intention — `reachFinish()` exists precisely to describe the end
   state, and it is what the no-GSAP branch already uses. Here `reduced()`
   takes that same branch: the orbit is laid out at full size, the number reads
   its target, the CTA is present, and no ticker is ever added. Everything with
   motion enabled — which is the reference viewport, and the screenshot — gets
   the reference's own behaviour frame for frame.

   ── Nothing here counts anything ──────────────────────────────────────────
   `REACH_TARGET` is the reference's own `RTARGET` constant. It is a
   presentation figure the surface labels as such; no record is read, no
   audience is measured, and there is no path from this file to one. */

/** The reference's `RTARGET`. */
export const REACH_TARGET = 10000;

/**
 * The reference's `RRINGS`, verbatim.
 *
 * Two rings, and each is five numbers rather than a name, exactly as there:
 * `t` the ring's tilt in degrees, `y` its yaw, `l` its lift as a percentage of
 * `unit`, `s` the card scale as a percentage, `r` the radius as a percentage.
 * They are percentages because every one is multiplied by `unit`, which is
 * derived from the viewport — that is what makes the composition hold its
 * proportions at any window size instead of only at the authored one.
 */
const REACH_RINGS = [
  { t: 90, y: 0, l: 0, s: 109, r: 131 },
  { t: 83, y: 18, l: 7, s: 122, r: 120 },
] as const;

interface ReachRing {
  R: number;
  ct: number;
  st: number;
  cy: number;
  sy: number;
  lift: number;
  spd: number;
  base: number;
  cap: number;
}

interface ReachCard {
  /** Which ring. `0` is the front ring, which never dims — see the frame loop. */
  ri: number;
  ring: ReachRing;
  /** Angle around the ring at t=0. */
  a: number;
  /** This card's own slight tilt, from the deterministic jitter below. */
  rot: number;
  /** 0 → 1 → 0. Both the scale and the visibility read it. */
  pop: number;
  popped: boolean;
  /** Radius multiplier. The collapse pushes it to 1.24 as the card leaves. */
  rMul: number;
  /** Last written opacity, and last written visibility. `-1` is "never". */
  op: number;
  vis: number;
  /** The count progress at which this card pops. */
  thr: number;
}

/** The reference's `rnd` — cheap deterministic jitter, so each card sits at
 *  its own slight angle and does so identically on every render. */
function reachRnd(i: number): number {
  const s = Math.sin(i * 12.9898 + 7.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * The orbit.
 *
 * `onCta` is called at the moment the reference calls
 * `setState({reachCta:true})` — the surface renders the button and animates it
 * in with `reachCtaIn`, which is the reference's own two-step (its `setState`
 * callback is where the button's `fromTo` lives, because the element does not
 * exist until the render lands).
 *
 * Returns the teardown — `reachStop`, which removes the ticker, kills the
 * timeline and every per-card tween, and drops the resize listener.
 */
export function reachIntro(root: HTMLElement | null, onCta: () => void): () => void {
  if (!root) return () => {};

  const stage = root.querySelector<HTMLElement>('[data-reach-stage]');
  const group = root.querySelector<HTMLElement>('[data-reach-group]');
  const num = root.querySelector<HTMLElement>('[data-reach-num]');
  const head = root.querySelector<HTMLElement>('[data-reach-head]');
  const els = Array.from(root.querySelectorAll<HTMLElement>('[data-rphone]'));
  if (!stage || !group || !els.length) return () => {};

  let cards: ReachCard[] = [];
  let clock = 0;

  const setNum = (v: number) => {
    if (num) num.textContent = v.toLocaleString('en-US');
  };

  /* ── `reachFrame` ───────────────────────────────────────────────────────
     One card, one write. The reference's own economies are kept because they
     are what make forty perspective-transformed elements affordable: the
     opacity is quantised to twentieths so most frames skip the write
     entirely, `visibility` is only touched when it actually flips, and the
     front ring is never dimmed at all. */
  const frame = (dt: number) => {
    if (!cards.length) return;
    clock += dt > 0.05 ? 0.05 : dt || 0;
    const T = clock;
    const DEG = 57.29578;
    const sa = -0.24192; // sin of the fixed -14deg tilt
    const ca = 0.9703; //  cos of the same
    for (let i = 0; i < cards.length; i++) {
      const p = cards[i]!;
      const el = els[i];
      if (!el) continue;
      if (p.pop <= 0.001) {
        if (p.vis !== 0) {
          p.vis = 0;
          el.style.visibility = 'hidden';
        }
        continue;
      }
      if (p.vis !== 1) {
        p.vis = 1;
        el.style.visibility = 'visible';
      }
      const ring = p.ring;
      const th = p.a + ring.spd * T;
      const Rp = ring.R * (p.rMul || 1);
      const x0 = Math.cos(th) * Rp;
      const y0 = Math.sin(th) * Rp;
      const y = y0 * ring.ct - ring.lift;
      const z1 = y0 * ring.st;
      const x = x0 * ring.cy + z1 * ring.sy;
      const z = z1 * ring.cy - x0 * ring.sy;
      const r = Math.sqrt(x * x + y * y + z * z) || 1;
      el.style.transform =
        'translate3d(' +
        x.toFixed(1) +
        'px,' +
        y.toFixed(1) +
        'px,' +
        z.toFixed(1) +
        'px) rotateY(' +
        (Math.atan2(-x, -z) * DEG).toFixed(1) +
        'deg) rotateX(' +
        (Math.asin(y / r) * DEG).toFixed(1) +
        'deg) rotateZ(' +
        p.rot.toFixed(1) +
        'deg) scale(' +
        (ring.base * p.pop).toFixed(3) +
        ')';
      if (p.ri) {
        const zw = y * sa + z * ca;
        const far = zw < 0 ? -zw / ring.R : 0;
        const op = Math.round((1 - 0.34 * (0.6 + 0.4 * far)) * 20) / 20;
        if (p.op !== op) {
          p.op = op;
          el.style.opacity = String(op);
        }
      } else if (p.op !== 1) {
        p.op = 1;
        el.style.opacity = '1';
      }
    }
  };

  /* ── `reachLayout` ──────────────────────────────────────────────────────
     Runs once on arrival and again on every resize. Everything that does not
     change per frame is computed here: the ring trigonometry, the perspective,
     the card box, how many cards each ring can hold, and each card's pop
     threshold. The camera never moves, so the group transform is written here
     too rather than sixty times a second. */
  const layout = () => {
    const vw = stage.clientWidth || 900;
    const vh = stage.clientHeight || 600;
    const narrow = vw <= 700 || vw / vh < 1.1;
    const unit = narrow
      ? Math.min(vh * 0.62, vw * 1.2 * 0.96)
      : Math.min(vh, vw / (924 / 540)) * 0.96;
    const cardW = unit * 0.074;
    const cardH = (cardW * 8.97) / 7.4;
    stage.style.perspective = (1.75 * unit).toFixed(0) + 'px';

    const rings: ReachRing[] = REACH_RINGS.map((d, r) => {
      const R = unit * (0.36 + 0.2 * r + (r ? 0.07 : 0)) * 1.35 * (d.r / 100);
      const tilt = (d.t * Math.PI) / 180;
      const yaw = (d.y * Math.PI) / 180;
      const base = d.s / 100;
      return {
        R,
        ct: Math.cos(tilt),
        st: Math.sin(tilt),
        cy: Math.cos(yaw),
        sy: Math.sin(yaw),
        lift: (unit * d.l) / 100,
        spd: (r % 2 ? -1 : 1) * (0.15 - 0.025 * r),
        base,
        cap: Math.max(4, Math.floor((2 * Math.PI * R) / (cardW * base * 1.02))),
      };
    });

    // Distribute the cards across the rings in proportion to circumference,
    // then push the remainder into whichever ring has the most room. The two
    // guarded loops are the reference's own, counts and all.
    const total = Math.min(narrow ? 26 : 40, els.length);
    const sum = rings.reduce((a, r) => a + r.R, 0);
    const counts = rings.map((r) =>
      Math.min(r.cap, Math.max(4, Math.round((total * r.R) / sum))),
    );
    let diff = total - counts.reduce((a, b) => a + b, 0);
    let guard = 0;
    while (diff > 0 && guard++ < 80) {
      let bi = -1;
      let room = 0;
      counts.forEach((n, i) => {
        const q = rings[i]!.cap - n;
        if (q > room) {
          room = q;
          bi = i;
        }
      });
      if (bi < 0) break;
      counts[bi] = counts[bi]! + 1;
      diff--;
    }
    while (diff < 0 && guard++ < 160) {
      let bi = -1;
      let most = 4;
      counts.forEach((n, i) => {
        if (n > most) {
          most = n;
          bi = i;
        }
      });
      if (bi < 0) break;
      counts[bi] = counts[bi]! - 1;
      diff++;
    }

    // A resize mid-flight must not restart the pop: each card inherits the
    // previous layout's `pop` / `popped` / `rMul` by index, so the orbit
    // re-proportions without the phones flashing back in.
    const prev = cards;
    const next: ReachCard[] = [];
    let i = 0;
    rings.forEach((ring, ri) => {
      const n = counts[ri]!;
      for (let k = 0; k < n; k++) {
        const old = prev[i];
        next.push({
          ri,
          ring,
          a: ri * 0.63 + (k / n) * Math.PI * 2,
          rot: (reachRnd(i + 99) - 0.5) * 10,
          pop: old ? old.pop : 0,
          popped: old ? old.popped : false,
          rMul: old ? old.rMul || 1 : 1,
          op: -1,
          vis: -1,
          thr: 0,
        });
        i++;
      }
    });
    next.forEach((p, k) => {
      p.thr = 1 - Math.pow(1 - (k + 1) / next.length, 1.9);
    });

    const w = cardW.toFixed(1) + 'px';
    const h = cardH.toFixed(1) + 'px';
    const ml = (-cardW / 2).toFixed(1) + 'px';
    const mt = (-cardH / 2).toFixed(1) + 'px';
    for (let j = 0; j < els.length; j++) {
      const on = j < next.length;
      const el = els[j]!;
      el.style.display = on ? '' : 'none';
      if (on) {
        el.style.width = w;
        el.style.height = h;
        el.style.marginLeft = ml;
        el.style.marginTop = mt;
      }
    }
    cards = next;
    group.style.transform =
      'translateY(' + (-unit * 0.03).toFixed(1) + 'px) rotateX(-14deg)';
    frame(0);
  };

  /* ── `reachFinish` — the end state, and the whole of the no-motion path ── */
  const finish = () => {
    for (const p of cards) {
      p.pop = 1;
      p.popped = true;
    }
    setNum(REACH_TARGET);
    frame(0);
    onCta();
  };

  clock = 0;
  layout();
  const onResize = () => layout();
  window.addEventListener('resize', onResize);

  const g = gsap();
  if (!g || !motionLive()) {
    finish();
    return () => window.removeEventListener('resize', onResize);
  }

  /* The centring is NOT in this tween, and that is a departure from the
     reference's own line — forced by where the two files put the transform.

     The reference authors `transform: translate(-50%,-50%)` as an INLINE
     style, so GSAP parses the string, recognises the percentages, and stores
     them as `xPercent`/`yPercent`; re-declaring them in the tween is then a
     harmless overwrite, and its comment explains that dropping them would let
     `clearProps` strip the centring. Here the transform lives in a stylesheet,
     so GSAP has only `getComputedStyle().transform` to read — a MATRIX, in
     pixels — and caches `x: -410px`. Adding `xPercent: -50` on top of that
     centres the headline twice and hangs it a full width to the left of centre.
     It reproduced at 375px and not at 320 or 390, which is the worst shape a
     defect can have: present, and not everywhere somebody looks.

     So `.ff-reach__head` centres with the CSS `translate` PROPERTY instead.
     `translate` and `transform` are separate properties that compose, GSAP
     writes only `transform`, and the rendered result is the reference's to the
     pixel — with the centring now surviving a `clearProps` on `transform`
     rather than depending on it. */
  if (head) {
    g.fromTo(
      head,
      { opacity: 0, y: 18 },
      { opacity: 1, y: 0, duration: refDur(0.34), ease: 'power3.out' },
    );
  }

  const tick = (_time: number, deltaTime: number) => frame(deltaTime / 1000);
  g.ticker.add(tick);

  /* ── `reachPlay` ────────────────────────────────────────────────────────
     One timeline, three beats: the count, the collapse, the CTA. They are one
     timeline rather than three because the second's `'+=0.35'` and the third's
     position are measured from the first — chaining them with callbacks would
     put a frame drop between the last phone leaving and the button arriving. */
  for (const p of cards) {
    g.killTweensOf(p);
    p.pop = 0;
    p.popped = false;
    p.rMul = 1;
  }
  const counter = { v: 0 };
  setNum(0);

  const tl = g.timeline({ delay: 0.12 });

  // The phones are popped BY the count rather than beside it: each card owns a
  // threshold and pops when the number passes it, so the last phone lands on
  // the last digit however long a frame took.
  tl.to(counter, {
    v: REACH_TARGET,
    duration: refDur(1),
    ease: 'power2.out',
    snap: { v: 1 },
    onUpdate: () => {
      const v = Math.round(counter.v);
      setNum(v);
      const prog = v / REACH_TARGET;
      for (let i = 0; i < cards.length; i++) {
        const p = cards[i]!;
        if (!p.popped && prog >= p.thr) {
          p.popped = true;
          g.to(p, { pop: 1, duration: refDur(0.32), ease: 'back.out(1.7)' });
        }
      }
    },
    onComplete: () => setNum(REACH_TARGET),
  });

  // The collapse. `rMul` widens the ring as the cards shrink, so they leave
  // outward rather than falling into the middle of the headline.
  tl.to(
    cards,
    {
      pop: 0,
      rMul: 1.24,
      duration: refDur(0.26),
      ease: 'power2.in',
      stagger: { each: Math.min(0.008, 0.35 / cards.length), from: 'end' },
    },
    '+=0.35',
  );

  tl.call(() => onCta());

  return () => {
    g.ticker.remove(tick);
    tl.kill();
    window.removeEventListener('resize', onResize);
    for (const p of cards) g.killTweensOf(p);
  };
}

/**
 * The CTA's arrival — the reference's `setState` callback, which is where its
 * own `fromTo` lives because the button does not exist until the render lands.
 *
 * Its own comment, kept because the mistake it records is one line away: "the
 * -50% centering already lives in the inline transform: re-declaring it here
 * doubled it and pushed the button a half-width left". So this tweens
 * `yPercent` and `scale` and never `x`.
 */
export function reachCtaIn(el: HTMLElement | null): void {
  const g = gsap();
  if (!el) return;
  if (!g || !motionLive()) {
    el.style.opacity = '1';
    return;
  }
  g.fromTo(
    el,
    { opacity: 0, yPercent: 18, scale: 0.9 },
    {
      opacity: 1,
      yPercent: 0,
      scale: 1,
      duration: refDur(0.36),
      ease: 'back.out(1.7)',
    },
  );
}

/* ── The last look at the problem — `[data-pconfirm]`, 2026-08-20 ──────────
   The reference's `pcToggle`, which is `probToggle`'s twin over a different
   set of markers: this screen's parts are `data-stage-anim`, the same
   attribute `stageRelayIn` reads, so the two helpers below and above cannot
   reach into each other's page.                                            */

/**
 * The read/edit swap on a `[data-stage-anim]` page.
 *
 * `pcToggle`, tween for tween:
 *
 *     gsap.killTweensOf(els); g.set(els,{clearProps:'opacity,transform'});
 *     ... setState ...
 *     g.from(head,{opacity:0,y:on?10:-10,duration:.42,ease:'power3.out',
 *                  clearProps:'opacity,transform'});
 *
 * The clear comes first and is not optional: the entrance leaves a finished
 * `fromTo` on every part, and a `from` stacked on top of one reads its start
 * value out of whatever that tween last wrote. The reference clears head, CTA
 * and the field; clearing every part is the same thing once the relay has
 * ended, and it is what `problemToggle` already does.
 *
 * `y: on ? 10 : -10` is the whole gesture — the headline arrives from below on
 * the way into the editor and from above on the way out, so the direction of
 * travel is legible without the words changing (they do not change here; the
 * reference's `pcHead` is the same sentence in both states).
 *
 * 0.42s sits between §6.1's `base` 0.35 and `slow` 0.60, on the licence every
 * other reference helper in this file carries: the brief for these pages is a
 * 1:1 behavioural reproduction. `refDur` still applies §6.1's phone factor and
 * nothing here approaches its `grand: 0.90` ceiling.
 */
export function stageToggleHead(
  root: HTMLElement | null,
  head: HTMLElement | null,
  entering: boolean,
): () => void {
  const g = gsap();
  if (!g || !root || !motionLive()) return () => {};

  const parts = Array.from(root.querySelectorAll<HTMLElement>('[data-stage-anim]'));
  g.killTweensOf(parts);
  g.set(parts, { clearProps: 'opacity,visibility,transform' });

  if (!head) return () => {};
  g.from(head, {
    autoAlpha: 0,
    y: entering ? 10 : -10,
    duration: refDur(0.42), // between base 0.35 and slow 0.60
    ease: ease('out'), // power3.out
    clearProps: 'opacity,visibility,transform',
  });

  return () => {
    g.killTweensOf(head);
  };
}

/* ── The socials rows (Founder Flow v2, `[data-socials]`, 2026-08-20) ─────── */

/**
 * `addSocial`'s empty-field branch — the reference's own refusal.
 *
 *     if(!v){ const inp=row&&row.querySelector('input');
 *             if(g&&inp)g.fromTo(inp,{x:-7},{x:0,duration:.45,
 *               ease:'elastic.out(1.5,0.4)',clearProps:'transform'});
 *             return; }
 *
 * A nudge rather than a message, and it is the whole of what an empty row gets
 * there: nothing is written and nothing is said. Kept because it is honest —
 * the field is where the answer goes and the field is what moves — and paired
 * here with a live-region sentence the reference has no equivalent of, because
 * a movement is not available to somebody who cannot see it (§28.5).
 *
 * The `-7` is a STAGE pixel: the element sits inside a `[data-page-stage]` that
 * is scaled to the viewport, so the transform is scaled with everything else
 * exactly as it is there. Both `elastic` parameters are its own — 1.5 amplitude
 * and 0.4 period is a single overshoot and a quick settle, and a §6.1 token
 * would be a different movement rather than a rounded one.
 */
export function socialNudge(input: HTMLElement | null): void {
  const g = gsap();
  if (!g || !input || !motionLive()) return;
  g.fromTo(
    input,
    { x: -7 },
    {
      x: 0,
      duration: refDur(0.45), // between base 0.35 and slow 0.60
      ease: 'elastic.out(1.5,0.4)',
      clearProps: 'transform',
      overwrite: 'auto',
    },
  );
}

/**
 * `addSocial`'s success branch — the button's own beat.
 *
 *     const btn=row&&row.querySelector('button');
 *     if(g&&btn)g.fromTo(btn,{scale:.88},{scale:1,duration:.44,
 *       ease:'back.out(2.4)',clearProps:'transform'});
 *
 * It runs BESIDE the colour, not instead of it: the button's own
 * `transition:background .2s ease` carries `#013F17` to `#41ED98` while this
 * carries the scale back from 0.88, so the two land within a fifth of a second
 * of each other and the tick arrives on the first frame of both. `back.out(2.4)`
 * is a harder overshoot than §6.1's `snap`, which is the point — it is the one
 * thing on this screen that says something landed.
 */
export function socialAddPop(button: HTMLElement | null): void {
  const g = gsap();
  if (!g || !button || !motionLive()) return;
  g.fromTo(
    button,
    { scale: 0.88 },
    {
      scale: 1,
      duration: refDur(0.44), // between base 0.35 and slow 0.60
      ease: 'back.out(2.4)',
      transformOrigin: '50% 50%',
      clearProps: 'transform',
      overwrite: 'auto',
    },
  );
}
/* ── Creator flow onboarding — the v11 reference's own relay ─────────────────
 *
 * Shared by screen 1 (the password), screen 2 (you) and screen 7 (the
 * agreement). All three are the same composition — `.obhead` with a lede inside
 * it, `.obbody`, `.ob-inline-action` — and the reference runs one
 * `proovdAnimateMoment` over every step, so one function here is the
 * reference's own arrangement rather than a convenience. The caller passes the
 * data-attribute namespace so the screens keep their own markup.
 *
 * `relayIn` above is this codebase's generalisation of the same reference, and
 * it rounds: 56px of travel where the reference tweens 52, `dur('slow')` (0.60)
 * where the reference runs 0.62, and a 0.08 stagger against the reference's
 * 0.085. Those are imperceptible on their own; what is NOT imperceptible is
 * WHICH elements move. `relayIn` sweeps every `[data-anim]` node in the stage,
 * and the reference moves only the heading block.
 *
 * The reference's `proovdAnimateMoment` picks three nodes:
 *
 *   head    `[data-anim="head"]`  → the `.obhead` block
 *   panel   `[data-anim="panel"], .obbody, …, [style*="max-width"]`
 *   primary the first enabled button whose computed background is the brand
 *
 * `querySelector` with a comma list returns the first match in DOCUMENT ORDER,
 * not the first selector that matches — and the lede `<p>` carries an inline
 * `max-width:34ch`, so it is reached before `.obbody` ever is. `panel` is
 * therefore the LEDE, `.obbody` never animates, and the lede — nested inside
 * the head — rides a compound transform and starts ~104px out rather than 52.
 * Verified in Chrome against the reference rather than inferred: `.obbody`
 * reports `transform: none; opacity: 1` for the whole entry.
 *
 * That is reproduced rather than corrected, because the brief is the reference
 * as it behaves. The one thing not reproduced is the reference's dependence on
 * a computed background colour to find its own CTA; the caller passes the nodes
 * explicitly, so a restyle cannot silently drop the button out of the relay.
 *
 * `primary` is null while the CTA is disabled, which is the state a fresh
 * arrival at the password screen is in — so there the form and the button are
 * simply present and only the heading travels. Screen 2 arrives prefilled, so
 * its CTA is enabled and all three nodes ride the stagger.
 *
 * Screen 7's CTA is never disabled — the reference's `obEnabled` is `step>=6`
 * on that step, unconditionally — so all three nodes ride it there too, and the
 * lede rides the same compound transform because the agreement's lede also
 * carries an inline `max-width` and is also reached before the `.obbody`.
 */
export function creatorMomentIn(
  stage: HTMLElement | null,
  direction: 1 | -1,
  attr: 'pw' | 'you' | 'agree',
): () => void {
  const g = gsap();
  if (!g || !stage || !motionLive()) return () => {};

  // The reference's reduced-motion branch fades the whole moment and returns.
  // `motionLive()` is already false under `prefers-reduced-motion`, so reaching
  // this line means motion is live; the jump-cut is proovd.css's.
  const pick = (name: string) =>
    stage.querySelector<HTMLElement>('[data-' + attr + '="' + name + '"]');

  const head = pick('head');
  const lede = pick('lede');
  const cta = stage.querySelector<HTMLElement>(
    '[data-' + attr + '="cta"]:not([disabled])',
  );

  const els = [head, lede, cta].filter((el): el is HTMLElement => !!el);
  if (!els.length) return () => {};

  g.killTweensOf(els);
  // The timeline is captured before the tween is added: `fromTo` on a timeline
  // returns the timeline at runtime but is typed `unknown` here, and the
  // teardown needs `kill()`.
  const timeline = g.timeline();
  timeline.fromTo(
    els,
    { x: 52 * direction, opacity: 0 },
    {
      x: 0,
      opacity: 1,
      duration: 0.62,
      ease: 'power3.out',
      stagger: { each: 0.085, from: direction === -1 ? 'end' : 'start' },
      force3D: true,
      clearProps: 'transform,opacity',
    },
  );

  return () => {
    timeline.kill();
  };
}

/* ── Founder Flow v2, screen 11 — the brand colours ────────────────────────
 *
 * The reference binds one generic press to every `[data-press]` element in
 * `bind()`:
 *
 *     const s=el.getAttribute('data-press')==='deep'?.78:.94;
 *     el.addEventListener('pointerdown',()=>gsap.to(el,{scale:s,
 *       duration:M.dur.instant,ease:'power2.out'}));
 *     ['pointerup','pointercancel','pointerleave'].forEach(ev=>
 *       el.addEventListener(ev,()=>gsap.to(el,{scale:1,duration:.25,
 *       ease:M.ease.out})));
 *
 * A filled swatch carries `data-press="1"`, so it is the shallow 0.94. The
 * mouseenter/mouseleave half of that same binding is a no-op on a swatch — it
 * has no `data-hover-*` attribute, so its hover object equals its base — and
 * the visible hover is the prototype harness's own `style-hover`
 * (`filter:brightness(.72)`), which is a CSS rule here.
 *
 * Two functions rather than one binder, because in React the element is a
 * child that mounts and unmounts with the record and the handlers are props.
 * `bind()`'s `if(el.__b)return` guard exists to solve exactly the problem props
 * do not have.
 */

/** `pointerdown` — the reference's shallow press. `deep` is its 0.78 variant. */
export function pressDown(el: HTMLElement | null, deep = false): void {
  const g = gsap();
  if (!g || !el || !motionLive()) return;
  g.to(el, {
    scale: deep ? 0.78 : 0.94,
    // The reference does NOT apply its `k()` factor on the way down — only on
    // the hover pair above it — so this is `M.dur.instant` flat.
    duration: window.Proovd?.MOTION.dur.instant ?? 0.12,
    ease: 'power2.out',
    transformOrigin: '50% 50%',
    overwrite: 'auto',
  });
}

/** `pointerup` / `pointercancel` / `pointerleave` — back to rest. */
export function pressUp(el: HTMLElement | null): void {
  const g = gsap();
  if (!g || !el || !motionLive()) return;
  g.to(el, {
    scale: 1,
    duration: refDur(0.25), // between quick 0.20 and base 0.35
    ease: ease('out'),
    transformOrigin: '50% 50%',
    overwrite: 'auto',
  });
}

/** The reference's newly-added logo row: 30ms after render, then one back-out. */
export function fileRowIn(root: HTMLElement | null): void {
  const g = gsap();
  if (!g || !root || !motionLive()) return;
  const rows = root.querySelectorAll<HTMLElement>('[data-brandlogo-file-row]');
  const row = rows[rows.length - 1];
  if (!row) return;
  g.fromTo(
    row,
    { y: -14, autoAlpha: 0, scale: 0.94, transformOrigin: '50% 50%' },
    {
      y: 0,
      autoAlpha: 1,
      scale: 1,
      duration: refDur(0.4),
      ease: 'back.out(1.7)',
      clearProps: 'transform,opacity,visibility',
      overwrite: 'auto',
    },
  );
}

/** The mail badge's exact 0.46s shake followed by the reference's 6s rest. */
export function mailBellLoop(el: HTMLElement | null): () => void {
  const g = gsap();
  if (!g || !el || !motionLive()) return () => {};
  const tl = g.timeline({ repeat: -1, repeatDelay: 6, defaults: { ease: 'power2.out' } });
  tl.to(el, { rotation: -9, duration: refDur(0.07) });
  tl.to(el, { rotation: 8, duration: refDur(0.09) });
  tl.to(el, { rotation: -6, duration: refDur(0.09) });
  tl.to(el, { rotation: 4, duration: refDur(0.09) });
  tl.to(el, { rotation: 0, duration: refDur(0.12), ease: 'power2.inOut' });
  return () => tl.kill();
}

/* ── The brand-voice sheets (Founder Flow v2, `[data-voice]`, 2026-08-21) ──── */

/**
 * `modalIntro` — "the sheet grows out of the chip that opened it, then its own
 * rows come up". The reference's own comment, and its own three tweens:
 *
 *     const r = box.getBoundingClientRect(), o = this._org;
 *     if (o) {
 *       const sx = Math.max(.12, o.width/r.width), sy = Math.max(.12, o.height/r.height);
 *       g.fromTo(box,
 *         {x:(o.left+o.width/2)-(r.left+r.width/2), y:(o.top+o.height/2)-(r.top+r.height/2),
 *          scaleX:sx, scaleY:sy, opacity:0, transformOrigin:'50% 50%'},
 *         {x:0,y:0,scaleX:1,scaleY:1,opacity:1,duration:.46,ease:'power3.out',
 *          clearProps:'transform,opacity'});
 *     } else {
 *       g.fromTo(box,{scale:.9,opacity:0},{scale:1,opacity:1,duration:.36,…});
 *     }
 *     const rows = [...box.querySelector(':scope > div').children];
 *     g.fromTo(rows,{y:16,opacity:0},{y:0,opacity:1,duration:.34,ease:'power3.out',
 *       delay:.16,stagger:.06,clearProps:'transform,opacity'});
 *     g.fromTo(scrim,{backgroundColor:'rgba(1,63,23,0)'},
 *       {backgroundColor:'rgba(1,63,23,.35)',duration:.4,ease:'power2.out'});
 *
 * ── `origin` is the RECT of the control that opened it, captured on click ───
 * `markOrigin(e)` reads `e.currentTarget.getBoundingClientRect()` at the moment
 * of the click, before the sheet exists. Recomputing it afterwards would be
 * reading a chip that a re-render may already have moved, and the whole point of
 * the tween is that the sheet leaves the thing that was pressed. The `.12` floor
 * is its own: a sheet that starts at a hundredth of its size reads as a flash
 * rather than as a growth.
 *
 * ── The scrim tween is on the PARENT, and its ease has no §6.1 token ────────
 * `power2.out` is not one of the six in `MOTION.ease`, and the nearest — `out`,
 * power3.out — is a different curve on the one element whose whole job is to
 * darken evenly. It is written literally, on the same licence every other 1:1
 * screen of this flow ships under.
 *
 * ── There is no exit, and that is the reference's behaviour ─────────────────
 * `voiceReplaceDone` and `voiceAddDone` set state and the sheet is gone on the
 * next frame. Adding a fade out would be inventing a beat.
 */
export function voiceSheetIn(
  box: HTMLElement | null,
  origin: DOMRect | null,
): () => void {
  const g = gsap();
  if (!g || !box || !motionLive()) return () => {};

  const rows = Array.from(
    (box.firstElementChild?.children ?? []) as HTMLCollectionOf<HTMLElement>,
  );
  const scrim = box.parentElement;

  g.killTweensOf(box);
  if (origin && origin.width > 0 && origin.height > 0) {
    // Measure the box as LAID OUT, never as currently transformed.
    //
    // React re-invokes a layout effect immediately after tearing it down on
    // mount under StrictMode, so this runs twice. `killTweensOf` stops the
    // first tween and leaves its inline transform behind — so without this the
    // second run measures a box already scaled to 22.7% x 12% and computes
    // `origin.width / r.width` ≈ 1, `origin.height / r.height` ≈ 0.74 and no
    // offset at all. The sheet then squashes vertically in place instead of
    // growing out of the chip, which is a different animation that still
    // ends in the right place — the kind a screenshot cannot see.
    g.set(box, { clearProps: 'transform' });
    const r = box.getBoundingClientRect();
    g.fromTo(
      box,
      {
        x: origin.left + origin.width / 2 - (r.left + r.width / 2),
        y: origin.top + origin.height / 2 - (r.top + r.height / 2),
        scaleX: Math.max(0.12, origin.width / r.width),
        scaleY: Math.max(0.12, origin.height / r.height),
        opacity: 0,
        transformOrigin: '50% 50%',
      },
      {
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        duration: refDur(0.46), // between base 0.35 and slow 0.60
        ease: ease('out'), // power3.out
        clearProps: 'transform,opacity',
        overwrite: 'auto',
      },
    );
  } else {
    g.fromTo(
      box,
      { scale: 0.9, opacity: 0 },
      {
        scale: 1,
        opacity: 1,
        duration: refDur(0.36), // base 0.35
        ease: ease('out'), // power3.out
        clearProps: 'transform,opacity',
        overwrite: 'auto',
      },
    );
  }

  if (rows.length) {
    g.killTweensOf(rows);
    g.fromTo(
      rows,
      { y: 16, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: refDur(0.34), // base 0.35
        ease: ease('out'), // power3.out
        delay: refDur(0.16),
        stagger: refDur(0.06),
        clearProps: 'transform,opacity',
        overwrite: 'auto',
      },
    );
  }

  if (scrim) {
    g.killTweensOf(scrim);
    g.fromTo(
      scrim,
      { backgroundColor: 'rgba(1,63,23,0)' },
      {
        backgroundColor: 'rgba(1,63,23,.35)',
        duration: refDur(0.4), // between base 0.35 and slow 0.60
        ease: 'power2.out', // its own; §6.1 has no power2.out
        overwrite: 'auto',
      },
    );
  }

  // `relayIn`'s stuck sweep, on a sheet that is staged by an inline `fromTo`:
  // the runtime's 3s force-reveal only registers `[data-reveal]`, and a dropped
  // tween here would leave an invisible dialog with a working keyboard path.
  const sweep = window.setTimeout(() => {
    for (const el of [box, ...rows]) {
      if (Number(getComputedStyle(el).opacity) < 0.9) {
        g.set(el, { clearProps: 'transform,opacity' });
      }
    }
  }, 2400);

  return () => {
    window.clearTimeout(sweep);
    g.killTweensOf([box, ...rows]);
    if (scrim) g.killTweensOf(scrim);
  };
}

/* ── Screen 16, the DOB calendar (Founder Flow v2, `[data-hello]`, 2026-08-21) ─
   `dobToggle`, `dobClose`, `dobPick` and `dobPage`, reproduced tween for
   tween. The one thing that is NOT reproduced is `dobStep`'s day fade: it
   targets `[data-day]`, which appears nowhere in the reference's markup, so
   that tween has never run and stepping a month there is an instant swap. A
   fade added here would be a movement the reference does not make. */

/**
 * The panel grows out of the field.
 *
 *     gsap.set(p,{clearProps:'height,opacity,maxHeight,top'});
 *     p.style.top='0px';
 *     const nat=p.offsetHeight; const to=nat; p.style.maxHeight=to+'px';
 *     gsap.set(rows,{opacity:0});
 *     gsap.fromTo(p,{height:h0,opacity:1},{height:end,duration:.45,
 *       ease:'power3.out', onComplete:()=>gsap.set(p,{clearProps:'height'})});
 *     gsap.to(rows,{opacity:1,duration:.24,stagger:.045,delay:.16});
 *
 * `h0` is the FIELD's `offsetHeight` — an unscaled layout pixel, and the panel
 * lives inside a `scale(2.6)` box, so the two are in different unit spaces.
 * That is the reference's own arithmetic and it is kept: the number decides
 * where the growth starts, and changing it would change the movement.
 *
 * The lift is the second half of the same beat: a panel whose grown height
 * would reach past the fold travels up inside the one movement rather than
 * being repositioned after it.
 */
export function dobPanelOpen(
  panel: HTMLElement | null,
  field: HTMLElement | null,
): () => void {
  const g = gsap();
  if (!g || !panel) return () => {};
  const h0 = field?.offsetHeight ?? 56;
  const rows = Array.from(panel.children);

  if (!motionLive()) {
    g?.set(rows, { clearProps: 'opacity' });
    return () => {};
  }

  g.set(panel, { clearProps: 'height,opacity,maxHeight,top,y' });
  panel.style.top = '0px';
  const natural = panel.offsetHeight;
  panel.style.maxHeight = natural + 'px';

  g.set(rows, { opacity: 0 });
  g.fromTo(
    panel,
    { height: h0, opacity: 1 },
    {
      height: natural,
      duration: refDur(0.45), // between base 0.35 and slow 0.60
      ease: ease('out'), // power3.out
      onComplete: () => g.set(panel, { clearProps: 'height' }),
    },
  );
  g.to(rows, {
    opacity: 1,
    duration: refDur(0.24), // between quick 0.20 and base 0.35
    stagger: 0.045,
    delay: refDur(0.16),
  });

  // The reference's own `later(...)` backstop: a dropped tween must never
  // leave the panel clipped to the field's height with its rows invisible.
  const sweep = window.setTimeout(() => {
    g.set(panel, { clearProps: 'height' });
    g.set(rows, { opacity: 1 });
  }, 900);

  const top = field?.getBoundingClientRect().top ?? 0;
  const over = top + natural - (window.innerHeight - 12);
  let lift = 0;
  if (over > 4) {
    lift = window.setTimeout(() => g.set(panel, { y: -over }), 900);
    g.fromTo(panel, { y: 0 }, { y: -over, duration: refDur(0.45), ease: ease('out') });
  }

  return () => {
    window.clearTimeout(sweep);
    if (lift) window.clearTimeout(lift);
    g.killTweensOf(panel);
    g.killTweensOf(rows);
  };
}

/**
 * The panel shuts back into the field, and `done` is what unmounts it.
 *
 *     gsap.to(p,{height:h0,opacity:0,duration:.24,ease:'power2.in',
 *       onComplete:shut});
 *     this.later(()=>{ if(this.state.dobOpen)shut(); },520);
 *
 * The 520ms fallback is the reference's, and it exists for the same reason
 * `pageExit`'s does: a tween in a backgrounded tab does not progress, and
 * without it the panel would stay open forever. It drives an UNMOUNT and never
 * a status, so an early fire costs a cut-short fade and nothing else.
 */
export function dobPanelClose(
  panel: HTMLElement | null,
  field: HTMLElement | null,
  done: () => void,
): void {
  const g = gsap();
  if (!g || !panel || !motionLive()) {
    done();
    return;
  }
  let ran = false;
  const finish = () => {
    if (ran) return;
    ran = true;
    done();
  };
  const fallback = window.setTimeout(finish, 520);
  g.killTweensOf(panel);
  g.to(panel, {
    height: field?.offsetHeight ?? 56,
    opacity: 0,
    duration: refDur(0.24), // between quick 0.20 and base 0.35
    ease: ease('exit'), // power2.in
    onComplete: () => {
      window.clearTimeout(fallback);
      finish();
    },
  });
}

/**
 * The chosen day pops.
 *
 *     gsap.fromTo(cell,{scale:.72},{scale:1,duration:.34,ease:'back.out(2)'});
 *
 * `back.out(2)` is its own overshoot rather than §6.1's `snap` (`back.out(1.4)`)
 * — a stronger one, and on a 25px cell the difference is the whole gesture.
 */
export function dobCellPop(panel: HTMLElement | null): void {
  const g = gsap();
  if (!g || !panel || !motionLive()) return;
  const cell = panel.querySelector<HTMLElement>('[data-cell][data-sel="1"]');
  if (!cell) return;
  g.fromTo(
    cell,
    { scale: 0.72 },
    {
      scale: 1,
      duration: refDur(0.34), // base 0.35 is the token
      ease: 'back.out(2)',
      clearProps: 'transform',
    },
  );
}

/**
 * A decade page slides its years in.
 *
 *     gsap.from(document.querySelectorAll('[data-year]'),
 *       {x:dir>0?12:-12,opacity:0,duration:.22,stagger:.012,ease:'power2.out'});
 */
export function dobYearsPage(panel: HTMLElement | null, direction: 1 | -1): void {
  const g = gsap();
  if (!g || !panel || !motionLive()) return;
  const years = Array.from(panel.querySelectorAll<HTMLElement>('[data-year]'));
  if (!years.length) return;
  g.from(years, {
    x: direction > 0 ? 12 : -12,
    opacity: 0,
    duration: refDur(0.22), // between quick 0.20 and base 0.35
    stagger: 0.012,
    ease: 'power2.out',
    clearProps: 'transform,opacity',
  });
}

/** `if(box&&window.gsap)gsap.from(box,{opacity:0,duration:.2});` */
export function dobMonthsFade(box: HTMLElement | null): void {
  const g = gsap();
  if (!g || !box || !motionLive()) return;
  g.from(box, { opacity: 0, duration: refDur(0.2), clearProps: 'opacity' }); // quick 0.20
}

/**
 * `dobPlace()` — the month/year swap re-measures the panel in place.
 *
 *     gsap.set(p,{clearProps:'height,maxHeight'});
 *     const nat=p.offsetHeight;
 *     p.style.maxHeight=Math.min(nat,Math.max(320,window.innerHeight-24))+'px';
 *     const over=(fTop+Math.min(...))-(window.innerHeight-12);
 *     gsap.to(p,{y:over>4?-over:0,duration:.28,ease:'power2.out'});
 *
 * Year mode is TALLER than day mode, so without this the cap `dobPanelOpen`
 * set for the day grid survives the swap and clips the year grid — which the
 * browser pass caught as a missing `Clear` control at the foot of the panel.
 *
 * The cap mixes unit spaces exactly as the reference does: `offsetHeight` is
 * the panel's own layout pixel and `window.innerHeight` is a viewport pixel,
 * and the panel is inside a `scale(2.6)` box inside the stage. That is its own
 * arithmetic and it is kept, because it is what decides whether the panel is
 * capped at all — at every ordinary viewport the natural height wins and the
 * panel is simply its content, which is what the reference draws.
 */
export function dobPanelPlace(
  panel: HTMLElement | null,
  field: HTMLElement | null,
): void {
  const g = gsap();
  if (!g || !panel) return;
  g.set(panel, { clearProps: 'height,maxHeight' });
  const natural = panel.offsetHeight;
  const cap = Math.min(natural, Math.max(320, window.innerHeight - 24));
  panel.style.maxHeight = cap + 'px';
  if (!motionLive()) return;

  const top = field?.getBoundingClientRect().top ?? 0;
  const over = top + cap - (window.innerHeight - 12);
  const lift = over > 4 ? -over : 0;
  g.to(panel, {
    y: lift,
    duration: refDur(0.28), // between quick 0.20 and base 0.35
    ease: 'power2.out',
  });
  // The reference's own settle: a dropped tween must not leave the panel
  // half-lifted over the control that opened it.
  window.setTimeout(() => g.set(panel, { y: lift }), 340);
}
