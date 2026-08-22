/**
 * The full-bleed page primitive — Founder Flow v2, Session B, 2026-08-18.
 *
 * ── What it is, and the two things it is not ────────────────────────────────
 * The reference's defining structural choice: no persistent chrome, no header,
 * no progress bar, no navigation dock. Each page owns its viewport. The only
 * recurring furniture is the wordmark top-left, HELP top-right, and sometimes a
 * message badge bottom-right.
 *
 * It is not `PublicLayout`: that shell exists to give a browsable site its
 * header, footer sitemap and staffed-hours chat, and a Founder reaches these
 * pages through a personal link rather than by browsing. It is not `Flow`
 * either: `Flow` is a step machine INSIDE one page, and this is a sequence OF
 * pages. What it does borrow from `Flow` is the part §33.11.4 grades — a nav
 * control names its destination — and §33.11.2's rule that the thing a person
 * is looking at is a heading.
 *
 * ── Position survives across the flow ───────────────────────────────────────
 * Every page is its own top-level route, outside every layout and guard, and
 * `FOUNDER_FLOW_PAGES` is the one list of them. DNA §5.12 requires position to
 * survive interruption and a URL is the cheapest durable position there is; a
 * a multi-step sequence held in one component's state is a set of positions a
 * reload destroys.
 *
 * ── The exit runs before the route changes ──────────────────────────────────
 * `leave` fades the outgoing page and navigates in the tween's callback, with
 * the reference's 400ms fallback inside `pageExit` so a backgrounded tab cannot
 * strand somebody on a page that faded and never left. With motion off it
 * navigates immediately, which is the jump-cut rather than a second path.
 */

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';
import {
  founderFlowPath,
} from '@proovd/shared';
import { Button } from '../../components/Button.js';
import { pageExit, relayIn } from '../../components/anim.js';
import { useProovdMotion } from '../../motion/MotionProvider.js';
import { HelpDrawer } from './HelpDrawer.js';

export { HelpDrawer } from './HelpDrawer.js';

/**
 * Which way the next page's relay runs.
 *
 * Module-scoped rather than routed state, because the direction is a fact about
 * the transition and not about either page: the page being entered has no way
 * to know where the person came from, and putting it in the URL would make two
 * addresses for one screen. A fresh load leaves it at `1` — the README's "first
 * paint always runs forward".
 */
let pendingDirection: 1 | -1 = 1;
let transitionGuardTimer: number | null = null;

/**
 * Which way THIS page's relay runs, for a page that owns its own entrance.
 *
 * Screens 1–3 and 5 are authored on the reference's fixed stage and stage
 * their own children, so `FlowPage`'s `relayIn` finds nothing to do and the
 * page needs the direction itself. Reading is safe and consuming would not be:
 * `FlowPage` resets `pendingDirection` in its own layout effect, and React runs
 * layout effects bottom-up, so a child's effect sees the incoming value and the
 * parent's reset still happens exactly once.
 *
 * Capture it in a ref on first render rather than calling it again later — on a
 * re-render that is not a mount it has already been reset to forward.
 */
export function flowDirection(): 1 | -1 {
  return pendingDirection;
}
/**
 * A full-viewport screen that does not render `FlowPage` still has to consume
 * a backwards arrival before its next forward navigation. `FlowPage` normally
 * performs this reset in its own layout effect; Match owns the viewport and
 * calls this equivalent after capturing `flowDirection()`.
 */
export function resetFlowDirection(): void {
  pendingDirection = 1;
}

interface FlowNav {
  /** Fade this page out, then go. `direction` drives the next page's relay. */
  leave: (to: string, direction?: 1 | -1, state?: unknown) => void;
  /** The same, addressed by flow page id. */
  leaveToPage: (pageId: string, direction?: 1 | -1, state?: unknown) => void;
  /** Swap routes without an exit tween; the arriving page still relays in. */
  swapToPage: (pageId: string, direction?: 1 | -1, state?: unknown) => void;
  /** This page's own route parameter: a draft token, or a campaign id. */
  param: string;
}

const FlowNavContext = createContext<FlowNav | null>(null);

export function useFlowNav(): FlowNav {
  const nav = useContext(FlowNavContext);
  if (!nav) throw new Error('useFlowNav must be used inside a FlowPage');
  return nav;
}

interface FlowPageProps {
  /** An id from `FOUNDER_FLOW_PAGES`. The help drawer marks it current. */
  pageId: string;
  /** The value for this page's own route parameter. */
  param: string;
  /**
   * The line beside HELP — screen 1's `~3 mins`. Optional because only the
   * invite page has one; a page with nothing to say there renders nothing
   * rather than an empty slot.
   */
  meta?: ReactNode;
  /**
   * The message badge, bottom-right. It opens the same help drawer HELP does.
   *
   * The reference shakes it on a loop every six seconds for as long as the page
   * is open. That is not here: an element that moves indefinitely to draw
   * attention is the pattern DNA §5.10 and §30 name, whatever it opens. The
   * badge enters with the page and is then still.
   */
  badge?: boolean;
  children: ReactNode;
}

export function FlowPage({ pageId, param, meta, badge, children }: FlowPageProps) {
  const navigate = useNavigate();
  const stageRef = useRef<HTMLDivElement>(null);

  // Content under `data-*` motion attributes changes with the page, so the
  // runtime has to be re-bound (DNA §6). Skipping this is how animations die
  // silently as a surface grows.
  useProovdMotion(stageRef, [pageId]);

  useLayoutEffect(() => {
    // A destination may need a read before it can mount its real FlowPage.
    // Clear the transition guard before that page paints, so a fallback
    // StatePanel can never become a visible intermediate Founder screen.
    document.documentElement.classList.remove('ff-transitioning');
    if (transitionGuardTimer !== null) {
      window.clearTimeout(transitionGuardTimer);
      transitionGuardTimer = null;
    }
    const direction = pendingDirection;
    pendingDirection = 1;
    return relayIn(stageRef.current, direction);
  }, [pageId]);

  const leave = useCallback(
    (to: string, direction: 1 | -1 = 1, state?: unknown) => {
      pendingDirection = direction;
      document.documentElement.classList.add('ff-transitioning');
      if (transitionGuardTimer !== null) window.clearTimeout(transitionGuardTimer);
      // If the destination fails before it can mount FlowPage, do not leave
      // its error/loading state hidden forever. This is only a safety escape;
      // normal successful transitions clear it in the destination layout
      // effect before the first visible frame.
      transitionGuardTimer = window.setTimeout(() => {
        document.documentElement.classList.remove('ff-transitioning');
        transitionGuardTimer = null;
      }, 3000);
      // The reference fades the page-owned stage, not its chrome wrapper. The
      // invite and paper screens use these markers so their fixed composition
      // is the exact element that participates in the route handoff.
      const exitStage =
        stageRef.current?.querySelector<HTMLElement>(
          '[data-claim-stage],[data-page-stage]',
        ) ?? stageRef.current;
      pageExit(exitStage, () => {
        void navigate(to, { state });
      });
    },
    [navigate],
  );

  const leaveToPage = useCallback(
    (nextId: string, direction: 1 | -1 = 1, state?: unknown) =>
      leave(founderFlowPath(nextId, param), direction, state),
    [leave, param],
  );

  const swapToPage = useCallback(
    (nextId: string, direction: 1 | -1 = 1, state?: unknown) => {
      pendingDirection = direction;
      void navigate(founderFlowPath(nextId, param), { state });
    },
    [navigate, param],
  );

  return (
    <FlowNavContext.Provider value={{ leave, leaveToPage, swapToPage, param }}>
      <main className="ff" data-flow-page={pageId}>
        <div className="ff__stage" ref={stageRef}>
          <div className="ff__top">
            {/* Not a link. A draft address is not a site, and the way out of a
                Founder's own half-finished form should not be the brand. */}
            <span className="wordmark ff__mark">Proovd</span>
            <div className="ff__top-right">
              {meta ? <span className="ff__meta">{meta}</span> : null}
              <HelpDrawer
                pageId={pageId}
                param={param}
                trigger={
                  <Button tier="secondary" small className="ff__help">
                    Help
                  </Button>
                }
              />
            </div>
          </div>

          <div className="ff__body">{children}</div>

          {badge ? (
            <div className="ff__badge">
              <HelpDrawer
                pageId={pageId}
                param={param}
                trigger={
                  <Button tier="primary" small className="ff__badge-btn">
                    Reading for this step
                  </Button>
                }
              />
            </div>
          ) : null}
        </div>
      </main>
    </FlowNavContext.Provider>
  );
}
