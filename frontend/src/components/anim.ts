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
  };
};

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
