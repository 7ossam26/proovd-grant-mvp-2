/**
 * Type declarations for the `window.Proovd` motion runtime shipped by
 * `frontend/public/proovd-motion.js`.
 *
 * The runtime is a vendored IIFE loaded via <script src> in index.html. It is
 * deliberately NOT an ES module and must never be `import`ed — see the file
 * header in proovd-motion.js.
 *
 * Without this declaration file every `window.Proovd.*` call is `any`, which
 * removes exactly the review pass TypeScript is here to provide.
 *
 * Signatures below were read from the runtime source, not inferred. If the
 * runtime changes, change this file in the same commit.
 */

/** DNA §6.1 motion tokens. Never invent a duration or ease outside these. */
export interface ProovdMotionTokens {
  dur: {
    /** 0.12 — hover, press, focus response */
    instant: number;
    /** 0.20 — small state changes, colour swaps */
    quick: number;
    /** 0.35 — morphs, selection, most component motion */
    base: number;
    /** 0.60 — drawers, flow steps, large reveals */
    slow: number;
    /** 0.90 — splash, page transitions. Nothing exceeds this. */
    grand: number;
  };
  ease: {
    /** power3.out — default; everything entering or expanding */
    out: string;
    /** power4.out — the one hero entrance of a moment */
    hero: string;
    /** power2.inOut — position changes, flow steps, page transitions */
    move: string;
    /** back.out(1.4) — delight only; spends the delight budget */
    snap: string;
    /** bounce.out — physical delight; progress landings */
    bounce: string;
    /** power2.in — everything leaving. Never slower than its entrance. */
    exit: string;
  };
  stagger: { tight: number; base: number };
  text: { chars: number; words: number; lines: number };
  dist: { enter: number };
}

/** Several runtime functions accept a CSS selector as well as an element. */
export type ProovdTarget = Element | string;

export interface ProovdToastOptions {
  /** Accent treatment per DNA §1. Defaults to yellow. */
  accent?: 'yellow' | 'blue';
  /** Secondary line, rendered in `.toast__sub`. */
  sub?: string;
  /** Hold duration in seconds before the exit tween. Defaults to 1. */
  hold?: number;
}

export interface ProovdPageSlideOptions {
  /**
   * Direction is semantic, not decorative (DNA §6.5):
   * left = forward in a flow, right = back,
   * up = opening/ascending a level, down = dismissing/returning home.
   */
  dir?: 'left' | 'right' | 'up' | 'down';
  /** Uses bounce.out instead of back.out(1.2). Celebration moments only. */
  celebrate?: boolean;
}

export interface ProovdAPI {
  /** DNA §6.1 tokens, exposed so React code never hardcodes a duration. */
  readonly MOTION: ProovdMotionTokens;

  /**
   * True when GSAP failed to load. The runtime has already added
   * `html.no-motion` and logged the fail-loud console error; proovd.css
   * supplies jump-cut fallbacks. Never suppress this in production (DNA §6.6).
   */
  readonly failed: boolean;

  /**
   * Scans `root` for data-attribute bindings and attaches listeners.
   * Call again for any subtree React has re-rendered — see MotionProvider.
   * @param root Defaults to `document`.
   */
  init(root?: ParentNode): void;

  /** Reports a fail-loud failure to the console, once per message per load. */
  notice(msg: string): void;

  /* ── Text (DNA §6.4, §6.5). Splits are reverted automatically. ────────── */
  /** Masked word reveal. The signature Proovd headline entrance. */
  headlineRise(el: Element): void;
  /** Whole-line reveal. For sentence-length text — ledes, statements. */
  lineFlip(el: Element): void;
  /** Words from the left. Kickers, labels, secondary headings. */
  wordSlide(el: Element): void;
  /** One live status word settling. Never body copy, never twice a moment. */
  scramble(el: Element, text?: string): void;
  /** The product speaking one conversational line. Once. */
  typewriter(el: Element, text?: string): void;

  /* ── State ────────────────────────────────────────────────────────────── */
  /** Tweens through values — numbers travel, they don't blink. */
  numberRoll(el: Element, to: number | string): void;
  /** Determinate progress. `pct` is 0–1 and is clamped. */
  progress(el: Element, pct: number): void;
  /** Draws an SVG checkmark via dashoffset. */
  checkDraw(path: SVGPathElement): void;

  /* ── Components ───────────────────────────────────────────────────────── */
  /** Returns the toast element, already appended and self-removing. */
  toast(msg: string, opts?: ProovdToastOptions): HTMLElement;
  drawerOpen(drawer: Element): void;
  drawerClose(drawer: Element): void;
  /** Modals grow from their trigger, never fade in from a centred void. */
  modalOpen(modal: Element, trigger?: Element): void;
  modalClose(modal: Element): void;

  /* ── Page transitions ─────────────────────────────────────────────────── */
  pageSlide(
    incoming: ProovdTarget,
    outgoing?: ProovdTarget | null,
    opts?: ProovdPageSlideOptions,
  ): void;
  /** Two dark panels close, `swap` runs, panels part. Major chapter changes. */
  curtain(swap: () => void): void;
  /** Detail sheets and drill-ins that keep their parent's context beneath. */
  unroll(incoming: ProovdTarget, outgoing?: ProovdTarget | null): void;

  /* ── Delight ──────────────────────────────────────────────────────────── */
  gridAssemble(el: Element): void;
  /**
   * Button → progress → done morph for any submit that takes real time.
   * Resolves when the morph completes. Re-entrant calls are ignored while busy.
   *
   * `work` is the in-flight PROMISE, a number of seconds, or nothing (1.2s) —
   * never the callback that starts the work. The runtime decides with
   * `typeof work.then === 'function'` and silently substitutes the timer for
   * anything else, so a callback passed here plays the whole morph and never
   * runs. This signature said `() => Promise<unknown>` until 2026-08-10 and
   * `useButtonProgress` was written against it; every submit behind that hook
   * animated to a tick and sent nothing.
   */
  buttonProgress(btn: HTMLElement, work?: Promise<unknown> | number): Promise<void>;
  /** Plays once per session. Resolves when the splash has exited. */
  splash(el?: Element): Promise<void>;
  /**
   * Flip-based layout morph. `change` is either a class name to toggle or a
   * function that mutates the DOM into its end state.
   */
  morph(
    target: ProovdTarget,
    change: string | ((el: Element) => void),
    vars?: Record<string, unknown>,
  ): void;
}

declare global {
  interface Window {
    /**
     * Present only after proovd-motion.js has executed. Guard with
     * `useProovdRuntime()` rather than asserting non-null.
     */
    Proovd?: ProovdAPI;
  }
}

export {};
