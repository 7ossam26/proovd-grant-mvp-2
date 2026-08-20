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
    kill: () => unknown;
  };
  killTweensOf: (t: unknown) => unknown;
};

/** GSAP Flip, vendored at `public/vendor/gsap/Flip.min.js` and on window. */
type FlipPlugin = {
  getState: (t: unknown, v?: Record<string, unknown>) => unknown;
  from: (state: unknown, v: Record<string, unknown>) => unknown;
};

function flip(): FlipPlugin | null {
  return (window as unknown as { Flip?: FlipPlugin }).Flip ?? null;
}

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
 * The page exit, with the README's 520ms fallback.
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
  const fallback = window.setTimeout(() => {
    if (ran) return;
    ran = true;
    done();
  }, 520);
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
 * Campaign type, phase 1: the chosen sticker swells while the rest fades.
 *
 * The reference scales the sticker to 1.55 over 0.26s `power2.out` while the
 * headline, copy and CTA fade out (`opacity 0, y −10`, 0.18s). `done` runs when
 * the swell finishes and is what swaps the stage — so with motion off the swap
 * is immediate and the FLIP that follows is a no-op, which is the jump-cut DNA
 * §6.6 asks for rather than a second code path.
 */
export function swellChoice(
  sticker: HTMLElement | null,
  fading: Element[],
  done: () => void,
): void {
  const g = gsap();
  if (!g || !sticker || !motionLive()) {
    done();
    return;
  }
  if (fading.length) {
    g.to(fading, { autoAlpha: 0, y: -10, duration: dur('instant'), ease: ease('exit') });
  }
  g.to(sticker, {
    scale: 1.55,
    duration: dur('quick'), // 0.20 stands in for the reference's 0.26
    ease: ease('out'),
    onComplete: done,
  });
}

/**
 * Campaign type, phase 2: the sticker flips from where it was into its row.
 *
 * Two calls, either side of a React state change. `captureFlip` runs before the
 * stage swaps and `flipHome` in the layout effect after — which is the
 * reference's "invert is set synchronously before paint; the tween starts on
 * the next frame", expressed in React's own ordering rather than reproduced by
 * hand.
 *
 * The pick stage's sticker and the confirm row's sticker are different DOM
 * nodes, so they are matched by `data-flip-id` rather than by identity. Without
 * that the state captured before the swap describes an element that no longer
 * exists and Flip animates nothing.
 *
 * Returns null — and `flipHome` runs `done` immediately — whenever Flip is
 * absent or motion is off, so the caller never waits on a tween that will not
 * happen.
 */
export function captureFlip(selector: string): unknown | null {
  const F = flip();
  if (!F || !motionLive()) return null;
  return F.getState(selector);
}

export function flipHome(state: unknown, done?: () => void): void {
  const F = flip();
  if (!F || !state || !motionLive()) {
    done?.();
    return;
  }
  F.from(state, {
    duration: dur('slow'), // 0.60 stands in for the reference's 0.52
    ease: ease('move'), // power2.inOut for the reference's power3.inOut
    absolute: true,
    onComplete: done,
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
