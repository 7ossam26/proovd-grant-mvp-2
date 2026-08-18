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
 * ── Position survives, twenty-six times ─────────────────────────────────────
 * Every page is its own top-level route, outside every layout and guard, and
 * `FOUNDER_FLOW_PAGES` is the one list of them. DNA §5.12 requires position to
 * survive interruption and a URL is the cheapest durable position there is; a
 * twenty-six-step sequence held in one component's state is twenty-six
 * positions a reload destroys.
 *
 * ── The exit runs before the route changes ──────────────────────────────────
 * `leave` fades the outgoing page and navigates in the tween's callback, with
 * the README's 520ms fallback inside `pageExit` so a backgrounded tab cannot
 * strand somebody on a page that faded and never left. With motion off it
 * navigates immediately, which is the jump-cut rather than a second path.
 */

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';
import {
  FOUNDER_FLOW_HELP_SUBHEAD,
  FOUNDER_FLOW_HELP_TITLE,
  FOUNDER_FLOW_PAGES,
  founderFlowIndex,
  founderFlowPath,
} from '@proovd/shared';
import { Button } from '../../components/Button.js';
import { Drawer } from '../../components/Drawer.js';
import { pageExit, relayIn } from '../../components/anim.js';
import { useProovdMotion } from '../../motion/MotionProvider.js';

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

interface FlowNav {
  /** Fade this page out, then go. `direction` drives the next page's relay. */
  leave: (to: string, direction?: 1 | -1) => void;
  /** The same, addressed by flow page id. */
  leaveToPage: (pageId: string, direction?: 1 | -1) => void;
  token: string;
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
  token: string;
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

export function FlowPage({ pageId, token, meta, badge, children }: FlowPageProps) {
  const navigate = useNavigate();
  const stageRef = useRef<HTMLDivElement>(null);

  // Content under `data-*` motion attributes changes with the page, so the
  // runtime has to be re-bound (DNA §6). Skipping this is how animations die
  // silently as a surface grows.
  useProovdMotion(stageRef, [pageId]);

  useLayoutEffect(() => {
    const direction = pendingDirection;
    pendingDirection = 1;
    return relayIn(stageRef.current, direction);
  }, [pageId]);

  const leave = useCallback(
    (to: string, direction: 1 | -1 = 1) => {
      pendingDirection = direction;
      pageExit(stageRef.current, () => {
        void navigate(to);
      });
    },
    [navigate],
  );

  const leaveToPage = useCallback(
    (nextId: string, direction: 1 | -1 = 1) =>
      leave(founderFlowPath(nextId, token), direction),
    [leave, token],
  );

  return (
    <FlowNavContext.Provider value={{ leave, leaveToPage, token }}>
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
                token={token}
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
                token={token}
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

/**
 * The help drawer — §27.1's sixth question, answered for the whole flow.
 *
 * *How do I get help without losing context* is normally answered per surface,
 * and per surface it costs a support route on every one of twenty-six pages.
 * Here it is structural: one card per page already passed, the current one
 * first and marked, each a title and a one-line explanation, and tapping one
 * goes there. Nothing is lost by opening it, because the flow's position is the
 * URL and every answer is already saved.
 *
 * It lists what is behind and never what is ahead. A drawer that listed the
 * pages to come would be a progress bar with reading attached, and it would
 * offer to jump to addresses that refuse.
 */
function HelpDrawer({
  pageId,
  token,
  trigger,
}: {
  pageId: string;
  token: string;
  trigger: ReactElement;
}) {
  const navigate = useNavigate();
  const index = founderFlowIndex(pageId);
  const visible = index < 0 ? [] : FOUNDER_FLOW_PAGES.slice(0, index + 1).reverse();

  return (
    <Drawer
      trigger={trigger}
      title={FOUNDER_FLOW_HELP_TITLE}
      eyebrow={FOUNDER_FLOW_HELP_SUBHEAD}
    >
      <p className="ff-help__sub">{FOUNDER_FLOW_HELP_SUBHEAD}</p>
      <ul className="ff-help__list">
        {visible.map((page) => {
          const current = page.id === pageId;
          return (
            <li key={page.id}>
              <button
                type="button"
                className={current ? 'ff-help__card is-current' : 'ff-help__card'}
                aria-current={current ? 'page' : undefined}
                onClick={() => {
                  if (current) return;
                  // A jump backwards out of an overlay: the drawer closes with
                  // the route change, and the relay on the destination runs
                  // backwards because that is the direction of travel.
                  pendingDirection = -1;
                  void navigate(founderFlowPath(page.id, token));
                }}
              >
                <span className="ff-help__title">{page.title}</span>
                <span className="ff-help__state">{current ? 'This page' : 'Done'}</span>
                <span className="ff-help__body">{page.help}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Drawer>
  );
}
