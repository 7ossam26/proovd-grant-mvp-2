/**
 * The full-bleed page primitive — Creator Flow v2, Session B, 2026-08-19.
 *
 * `FlowPage`'s shape and its reasons, applied to the second full-bleed sequence
 * in the product. It is a separate component rather than a shared one: the two
 * flows read different registers, sit under different auth regimes, and the
 * Founder's carries a `param` that is sometimes a draft token and sometimes a
 * campaign id, while this one is a token or nothing at all. One component
 * taking both registers as props would be a component whose every branch is
 * "which flow is this" — and the first divergence either flow needed would
 * reintroduce the branch anyway.
 *
 * ── Outside three shells, on purpose ────────────────────────────────────────
 * Not `PublicLayout`: its header offers a nav bar of things to browse, and a
 * Creator arrives here through a private invitation link rather than by
 * browsing. Not the Admin shell: §26 licenses density there and nowhere else.
 * And outside every guard, because an invitation token is not a session — the
 * token is the credential, `requireAffiliateInvitationToken` checks it on every
 * call, and the browser is not the boundary (`lib/session.ts`).
 *
 * ── One address per page ────────────────────────────────────────────────────
 * DNA §5.12 wants position to survive interruption, and nine screens held in
 * one stateful component is nine positions a reload destroys. Every page is its
 * own top-level route and `CREATOR_FLOW_PAGES` is the one list of them.
 *
 * What deliberately does NOT survive a reload is the password — see `draft.ts`.
 * Position surviving and a credential not surviving are both correct, and the
 * screen that needs it asks again rather than sending anybody backwards.
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
  CREATOR_FLOW_EARLIER_STAGE_CLOSED,
  CREATOR_FLOW_HELP_SUBHEAD,
  CREATOR_FLOW_HELP_TITLE,
  CREATOR_FLOW_PAGES,
  creatorFlowIndex,
  creatorFlowPath,
  creatorFlowReachableFrom,
} from '@proovd/shared';
import { Button } from '../../components/Button.js';
import { Drawer } from '../../components/Drawer.js';
import { pageExit, relayIn } from '../../components/anim.js';
import { useProovdMotion } from '../../motion/MotionProvider.js';

/**
 * Which way the next page's relay runs.
 *
 * Module-scoped rather than routed, for `FlowPage`'s reason: the direction is a
 * fact about the TRANSITION and not about either page. The page being entered
 * cannot know where somebody came from, and putting it in the URL would make
 * two addresses for one screen. A fresh load leaves it forward.
 */
let pendingDirection: 1 | -1 = 1;

interface CreatorFlowNav {
  /** Fade this page out, then go. `direction` drives the next page's relay. */
  leave: (to: string, direction?: 1 | -1) => void;
  /** The same, addressed by flow page id. */
  leaveToPage: (pageId: string, direction?: 1 | -1) => void;
  /** This page's own route parameter — an invitation token, so far. */
  param: string;
}

const CreatorFlowNavContext = createContext<CreatorFlowNav | null>(null);

export function useCreatorFlowNav(): CreatorFlowNav {
  const nav = useContext(CreatorFlowNavContext);
  if (!nav) throw new Error('useCreatorFlowNav must be used inside a CreatorFlowPage');
  return nav;
}

interface CreatorFlowPageProps {
  /** An id from `CREATOR_FLOW_PAGES`. The help drawer marks it current. */
  pageId: string;
  /** The value for this page's own route parameter. */
  param: string;
  /** The quiet line beside Help. Absent renders nothing rather than a gap. */
  meta?: ReactNode;
  /**
   * Render without the top bar and without the stage's own padding.
   *
   * Exactly one page uses it — the invitation, whose splash is a full-bleed
   * overlay and whose headline is the first thing in the viewport. Help is
   * still reachable there, from the page's own control, so §27.1's sixth
   * question is answered on every screen including this one.
   */
  bare?: boolean;
  children: ReactNode;
}

export function CreatorFlowPage({
  pageId,
  param,
  meta,
  bare,
  children,
}: CreatorFlowPageProps) {
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
      leave(creatorFlowPath(nextId, param), direction),
    [leave, param],
  );

  return (
    <CreatorFlowNavContext.Provider value={{ leave, leaveToPage, param }}>
      <main className={bare ? 'crf crf--bare' : 'crf'} data-flow-page={pageId}>
        <div className="crf__stage" ref={stageRef}>
          {bare ? null : (
            <div className="crf__top">
              {/* Not a link. An invitation address is not a site, and the way
                  out of a half-finished form should not be the brand. */}
              <span className="wordmark crf__mark">Proovd</span>
              <div className="crf__top-right">
                {meta ? <span className="crf__meta">{meta}</span> : null}
                <CreatorHelpDrawer
                  pageId={pageId}
                  param={param}
                  trigger={
                    <Button tier="secondary" small className="crf__help">
                      Help
                    </Button>
                  }
                />
              </div>
            </div>
          )}

          <div className="crf__body">{children}</div>
        </div>
      </main>
    </CreatorFlowNavContext.Provider>
  );
}

/**
 * The help control, for a page that renders no top bar.
 *
 * Screen 0 was its one caller until 2026-08-20, when that screen was rebuilt
 * 1:1 from the v11 reference — whose invitation screen is a name, a sentence
 * and one control, with an empty 60px band where a meta row would sit. It is
 * kept exported because the drawer belongs beside the bar rather than inside
 * it, and the next bare page needs the same thing.
 */
export function CreatorFlowHelp({ pageId, param }: { pageId: string; param: string }) {
  return (
    <CreatorHelpDrawer
      pageId={pageId}
      param={param}
      trigger={
        <Button tier="tertiary" small className="crf__help">
          Help
        </Button>
      }
    />
  );
}

/**
 * The help drawer — §27.1's sixth question, answered once for the whole flow.
 *
 * One card per page already passed, the current one first and marked, each a
 * title and a one-line explanation, and tapping one goes there. Nothing is lost
 * by opening it: the flow's position is the URL and every profile answer is
 * saved as it is typed.
 *
 * It lists what is behind and never what is ahead. A drawer listing the pages
 * to come would be a progress bar with reading attached, and it would offer
 * jumps to addresses that refuse.
 *
 * ── From inside the app, none of this is reachable (Session D) ──────────────
 * `completeAffiliateSignup` CLAIMS the invitation token, so every stage-1
 * address stops resolving the moment the account exists.
 * `creatorFlowReachableFrom` decides that from the two pages' own parameters
 * rather than from a stage number, so it stays right when the app's pages land.
 * An unreachable card keeps its reading — the half worth having — and renders
 * the reason where the control would be (§1.4) rather than offering a jump to
 * the unusable-link page.
 */
function CreatorHelpDrawer({
  pageId,
  param,
  trigger,
}: {
  pageId: string;
  param: string;
  trigger: ReactElement;
}) {
  const navigate = useNavigate();
  const index = creatorFlowIndex(pageId);
  const visible = index < 0 ? [] : CREATOR_FLOW_PAGES.slice(0, index + 1).reverse();

  return (
    <Drawer
      trigger={trigger}
      title={CREATOR_FLOW_HELP_TITLE}
      eyebrow={CREATOR_FLOW_HELP_SUBHEAD}
    >
      <p className="crf-help__sub">{CREATOR_FLOW_HELP_SUBHEAD}</p>
      <ul className="crf-help__list">
        {visible.map((page) => {
          const current = page.id === pageId;
          const reachable = current || creatorFlowReachableFrom(pageId, page.id);

          if (!reachable) {
            return (
              <li key={page.id}>
                <div className="crf-help__card is-closed">
                  <span className="crf-help__title">{page.title}</span>
                  <span className="crf-help__state">Done</span>
                  <span className="crf-help__body">{page.help}</span>
                  <span className="crf-help__closed">{CREATOR_FLOW_EARLIER_STAGE_CLOSED}</span>
                </div>
              </li>
            );
          }

          return (
            <li key={page.id}>
              <button
                type="button"
                className={current ? 'crf-help__card is-current' : 'crf-help__card'}
                aria-current={current ? 'page' : undefined}
                onClick={() => {
                  if (current) return;
                  // A jump backwards out of an overlay: the drawer closes with
                  // the route change, and the relay on the destination runs
                  // backwards because that is the direction of travel.
                  pendingDirection = -1;
                  void navigate(creatorFlowPath(page.id, param));
                }}
              >
                <span className="crf-help__title">{page.title}</span>
                <span className="crf-help__state">{current ? 'This page' : 'Done'}</span>
                <span className="crf-help__body">{page.help}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Drawer>
  );
}
