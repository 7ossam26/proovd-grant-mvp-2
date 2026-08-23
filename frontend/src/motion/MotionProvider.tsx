/**
 * React integration for the Proovd motion runtime.
 *
 * ── The problem this file exists to solve ────────────────────────────────────
 * `proovd-motion.js` exposes `init(root)`, which walks the DOM with
 * querySelectorAll and attaches listeners to the nodes it finds at that
 * instant. React replaces DOM nodes on re-render, so those listeners are
 * attached to detached nodes and stop firing. Nothing throws. There is no
 * console error. The product simply animates less and less as it grows, and
 * the regression is invisible in code review.
 *
 * The rule: any subtree that renders data-attribute bindings must call
 * `useProovdMotion` with the dependencies that cause it to re-render. Anything
 * driven by React state uses the imperative API instead.
 *
 * ── StrictMode ───────────────────────────────────────────────────────────────
 * React 19 StrictMode double-invokes effects in development. Without
 * `gsap.context()` scoping and cleanup, every animation binds twice and press
 * handlers fire twice. `useGsapScope` handles this; use it for any hand-written
 * GSAP, and prefer the runtime's kit recipes over hand-written GSAP entirely
 * (DNA §6.5).
 *
 * ── What this file must never do ────────────────────────────────────────────
 * Import gsap from npm. Import proovd-motion.js. Reimplement any motion in CSS
 * transitions or the Web Animations API. Suppress the fail-loud notice. All
 * four are forbidden by DNA §6/§6.6/§6.7.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { useLocation } from 'react-router';
import type { ProovdAPI } from './proovd-motion';

/* ── Runtime access ───────────────────────────────────────────────────────── */

const RuntimeContext = createContext<ProovdAPI | null>(null);

/**
 * The motion runtime, or null if proovd-motion.js has not executed.
 *
 * Always null-check. A null runtime is a real production state: DNA §6.6
 * requires the product to stay fully usable with motion off, and proovd.css
 * ships `html.no-motion` jump-cut fallbacks for exactly that case.
 */
export function useProovdRuntime(): ProovdAPI | null {
  return useContext(RuntimeContext);
}

/**
 * Non-null runtime for call sites that only run inside an effect, where the
 * runtime is known to have loaded. Still returns null if GSAP genuinely failed
 * — the name means "assert the provider is above me", not "assert GSAP works".
 */
export function useProovdRuntimeOrThrow(): ProovdAPI | null {
  const rt = useContext(RuntimeContext);
  if (rt === undefined) {
    throw new Error('useProovdRuntime must be called inside <MotionProvider>');
  }
  return rt;
}

/* ── Provider ─────────────────────────────────────────────────────────────── */

interface MotionProviderProps {
  children: ReactNode;
  /**
   * Re-run `init()` on every route change. Default true. Route-level
   * components that manage their own binding can opt out.
   */
  initOnNavigate?: boolean;
}

/**
 * Mount once at the app root, inside the router.
 *
 * Responsibilities:
 *  1. Publish the runtime through context.
 *  2. Re-run a global `init()` after each navigation, once the new route's DOM
 *     has committed.
 *  3. Log a fail-loud console error if the runtime never arrived — the script
 *     tag is missing or 404ing, which is a deploy bug, not a user-facing state
 *     to swallow.
 */
export function MotionProvider({
  children,
  initOnNavigate = true,
}: MotionProviderProps) {
  const runtime = typeof window !== 'undefined' ? window.Proovd ?? null : null;
  const location = useLocation();

  // Deploy-time guard. If the script tag is wrong, proovd-motion.js never runs,
  // so its own fail-loud error never fires either. Cover that gap here.
  useEffect(() => {
    if (runtime) return;
    // eslint-disable-next-line no-console
    console.error(
      '[proovd] window.Proovd is undefined. proovd-motion.js did not execute — ' +
        'check the <script src="/proovd-motion.js"> tag and the /vendor/gsap/ paths.',
    );
  }, [runtime]);

  // useLayoutEffect so bindings attach before paint — otherwise the first
  // hover or press after a navigation is dead.
  useLayoutEffect(() => {
    if (!runtime || !initOnNavigate) return;
    runtime.init();
  }, [runtime, initOnNavigate, location.pathname]);

  return (
    <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>
  );
}

/* ── The re-binding hook ──────────────────────────────────────────────────── */

/**
 * Re-binds declarative motion (`data-reveal`, `data-hover`, `data-press`,
 * `data-scroll`, `data-progress`, `data-count-to`, `data-grid`,
 * `data-accordion`, `data-tabs`, `data-splash`) within `ref` whenever `deps`
 * change.
 *
 * Use this in every component that renders those attributes on content which
 * can change — lists, conditional branches, anything fed by TanStack Query.
 *
 * ```tsx
 * const ref = useRef<HTMLDivElement>(null);
 * const { data: creators } = useQuery(rosterQuery(campaignId));
 * useProovdMotion(ref, [creators]);
 *
 * return (
 *   <div ref={ref}>
 *     {creators?.map(c => (
 *       <article key={c.id} data-reveal="scale-in" className="card">…</article>
 *     ))}
 *   </div>
 * );
 * ```
 *
 * Static content that never re-renders is already covered by the provider's
 * navigation-level init and does not need this hook.
 */
export function useProovdMotion(
  ref: RefObject<HTMLElement | null>,
  deps: readonly unknown[] = [],
): void {
  const runtime = useProovdRuntime();

  useLayoutEffect(() => {
    const root = ref.current;
    if (!runtime || !root) return;
    runtime.init(root);
    // Intentionally no cleanup: the runtime binds to nodes React is about to
    // discard, and re-init on the replacement subtree is the correction. Adding
    // a teardown here would fight React's own node lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, ref, ...deps]);
}

/* ── StrictMode-safe GSAP scope ───────────────────────────────────────────── */

/**
 * Wraps hand-written GSAP in a `gsap.context()` scoped to `ref`, reverted on
 * unmount and between StrictMode's double-invoked effects.
 *
 * Reach for a kit recipe from `window.Proovd` first (DNA §6.5); use this only
 * when no recipe fits, and record the reason.
 *
 * ```tsx
 * useGsapScope(ref, (gsap) => {
 *   gsap.from('.stat', { y: 16, autoAlpha: 0, stagger: 0.08 });
 * }, [value]);
 * ```
 */
export function useGsapScope(
  ref: RefObject<HTMLElement | null>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: (gsap: any, root: HTMLElement) => void,
  deps: readonly unknown[] = [],
): void {
  const buildRef = useRef(build);
  buildRef.current = build;

  useLayoutEffect(() => {
    const root = ref.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gsap = (window as any).gsap;
    if (!root || !gsap) return;

    const ctx = gsap.context(() => buildRef.current(gsap, root), root);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps]);
}

/* ── Imperative helpers ───────────────────────────────────────────────────── */

/**
 * Toast bound to the runtime, safe to call when motion failed (the runtime
 * still renders the toast, it just skips the entrance tween).
 *
 * Every consequential action needs an immediate on-screen confirmation AND a
 * durable record (Spec §27.1). A toast satisfies the first half only — it is
 * never a substitute for the email or product-history entry.
 */
export function useToast() {
  const runtime = useProovdRuntime();
  return useCallback(
    (msg: string, opts?: Parameters<ProovdAPI['toast']>[1]) => {
      runtime?.toast(msg, opts);
    },
    [runtime],
  );
}

/**
 * Button → progress → done morph for submits that take real time.
 *
 * The morph resolves after the done-state settles, so awaiting it gives you a
 * natural point to navigate or show closure (DNA §5.4).
 *
 * ```tsx
 * const withProgress = useButtonProgress();
 * const ref = useRef<HTMLButtonElement>(null);
 *
 * <button ref={ref} className="btn btn--primary"
 *   onClick={() => withProgress(ref, () => submit.mutateAsync(values))}>
 *   Authorize pre-order
 * </button>
 * ```
 */
export function useButtonProgress() {
  const runtime = useProovdRuntime();
  return useCallback(
    async (
      ref: RefObject<HTMLElement | null>,
      work: () => Promise<unknown>,
    ): Promise<void> => {
      const btn = ref.current as ProgressButton | null;
      if (!runtime || !btn) {
        await work();
        return;
      }
      /*
       * The runtime takes the PROMISE, not the callback.
       *
       * `buttonProgress` decides what to wait on with `typeof work.then ===
       * 'function'` and substitutes a 1.2-second timer for anything that is
       * not thenable — so handing it the function played the entire morph,
       * finished on a tick, and never called the work. Every submit behind
       * this hook looked like it had succeeded and sent nothing.
       *
       * The jsdom suites cannot see it: `window.Proovd` is never defined
       * there, so the tests take the fallback above, which does call it.
       */
      if (btn.__pvBusy) return;
      await runtime.buttonProgress(btn, work());
    },
    [runtime],
  );
}

/**
 * The runtime marks the element while a morph is in flight and drops a second
 * `buttonProgress` call until it clears. That guard is read before the work
 * starts, above: a request whose result the morph would throw away is worse
 * than no request.
 */
interface ProgressButton extends HTMLElement {
  __pvBusy?: boolean;
}

/**
 * Rolls a number through its values instead of blinking to the new one
 * (DNA §6.5). Use for every changing stat — the Founder Glance count, roster
 * counts, remaining-step counters.
 *
 * Pass the *rendered* element and the new value; the runtime reads the current
 * value from textContent, so render the number as text.
 */
export function useNumberRoll(
  ref: RefObject<HTMLElement | null>,
  value: number | string | null | undefined,
): void {
  const runtime = useProovdRuntime();
  const first = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!runtime || !el || value == null) return;
    // Don't roll on first paint — there is no previous value to travel from.
    if (first.current) {
      first.current = false;
      return;
    }
    runtime.numberRoll(el, value);
  }, [runtime, ref, value]);
}
