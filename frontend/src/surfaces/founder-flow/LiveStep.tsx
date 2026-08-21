/**
 * You're live — the last page of the Founder flow.
 *
 * REBUILT 2026-08-20 from the supplied reference (`Proovd Founder Flow v2.dc.html`,
 * `[data-livepage]` / `kindWide`), walked in a browser rather than read: the
 * markup is a fixed `z-index: 25` green layer holding one 2496x1542 stage, and
 * every number below was measured off it at 1280x800 and at a true 320x800.
 *
 * ── One control, and the reference draws exactly one ────────────────────────
 * `Take me to my dashboard`. What stood here before had two — a second link to
 * the public campaign page — and it is gone rather than kept beside the
 * reference's: DNA §5.6 is one hero per moment, the campaign home this opens
 * carries the public link already, and the reference's own composition is a
 * headline, a line and a button.
 *
 * Its handler in the prototype is `liveDash:()=>{}` — a no-op, because there is
 * nothing after this screen there. Here it is §20's campaign home, which is the
 * surface a live campaign is actually operated from, and the flow ends by
 * handing over to it. The register's own help line for this page says so.
 *
 * ── No chrome, and that is the reference's own decision ─────────────────────
 * This is the only page of the twenty-six that draws no wordmark, no HELP, no
 * message badge and no Back. Back is not an omission — `back()` names this page
 * in the guard that returns early, beside the two other terminal beats:
 *
 *     if(this.isReviewWait()||this.isCampReview()||this.isLivePage())return;
 *
 * `PHASE 56` hides `FlowPage`'s chrome for this page accordingly, and records
 * that §27.1's sixth question is still answered on the two states below that
 * are not the celebration.
 *
 * ── Unreachable without a real launch ───────────────────────────────────────
 * §17's `launchCampaign` is a five-step idempotent sequence: the page goes
 * live, then every ready Creator's tracking link activates. A campaign is live
 * because that ran, and this screen READS `campaigns.status` rather than
 * deciding anything. A campaign that has not reached it is told where it
 * actually is and offered the waiting screen — never a celebration for
 * something that has not happened (§1.4). The reference has no such state
 * because it has no server; that guard is application functionality and
 * survives the rebuild unchanged.
 *
 * ── And nothing here reaches it on a timer ──────────────────────────────────
 * The reference arrives here five seconds after the review screen, having
 * flipped three Creator chips to accepted on the way. There is no `setTimeout`
 * and no `setInterval` in this file.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { Button, StatePanel, NO_ACTION } from '../../components/index.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { stageRelayIn } from '../../components/anim.js';
import { FlowPage, flowDirection, useFlowNav } from './FlowPage.js';
import { fetchBuild, FounderRequestError, type BuildState } from '../founder/api.js';

/* ── The stage ─────────────────────────────────────────────────────────────
   `fitStages()` for a page it treats as ordinary: the stage's own size as the
   divisors and `pageScale` alone. `c` is `live`, which no branch of that
   function names, so none of its multipliers applies. */

const FIT_W = 2496;
const FIT_H = 1542;
/** The prototype's `pageScale` prop default. */
const PAGE_SCALE = 0.78;

function stageScale(): number {
  return Math.min(window.innerWidth / FIT_W, window.innerHeight / FIT_H) * PAGE_SCALE;
}

/**
 * The reference's own relay order for this screen, out of `verifyIntro`'s fixed
 * list `pill, head, field, boxes, note, fee, sub, hint, panel, art, art2, cta,
 * edit`. Passed to `stageRelayIn` rather than read from the DOM, because the
 * 0.085s stagger follows THIS order and not document order — and here the two
 * happen to agree, which is exactly the kind of coincidence that stops being
 * true the first time somebody reorders the markup.
 */
const RELAY = ['head', 'panel', 'cta'] as const;

/**
 * Pitch builds need the complete Founder Flow without a §17 coordinated launch
 * having run. Vite development therefore follows the reference prototype, which
 * arrives at the celebration from the review screen with no server at all. Set
 * `VITE_PITCH_DEMO=false` to restore the launch-record guard locally.
 * Production can never enter this branch.
 *
 * The guard above it is NOT deleted, and that matters: `NotLiveYet` is what a
 * real Founder sees, and §1.4's rule — never a celebration for something that
 * has not happened — still holds everywhere the flag is false.
 */
const PITCH_DEMO = import.meta.env.DEV && import.meta.env.VITE_PITCH_DEMO !== 'false';

/** The reference's own copy, with its own curly apostrophe. Verbatim. */
const HEADLINE = 'You’re Live!';
const LEDE =
  'Your content creators are hard at work, kick back and check your dashboard for backers!';
/*
  The reference's label is `Take me to my dashboard`, and it was that here too
  until 2026-08-20. The password moved to the end of the flow, so this control
  no longer opens the dashboard — it opens the one page between here and it,
  and §33.11.4 requires a control to name where it goes. Changing the label was
  the smaller edit than leaving a button that names the wrong destination.
*/
const CTA_LABEL = 'Set my password and finish';

export function LiveStep() {
  const { campaignId = '' } = useParams();
  const [build, setBuild] = useState<BuildState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBuild(campaignId)
      .then((state) => {
        if (!cancelled) setBuild(state);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure(
          error instanceof FounderRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'We could not read where your campaign stands.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (failure) {
    return (
      <FlowPage pageId="live" param={campaignId}>
        <div className="ff-wait">
          <StatePanel
            state="We could not read where your campaign stands"
            whatHappened={failure}
            next="Reload the page. Nothing about your campaign has changed."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: '/support' }}
            ring
          />
        </div>
      </FlowPage>
    );
  }

  if (!build) return <SurfaceLoading subject="your campaign" reference="Your campaign" />;

  return (
    <FlowPage pageId="live" param={campaignId}>
      {PITCH_DEMO || build.campaignStatus === 'live' ? (
        <LivePage campaignId={campaignId} />
      ) : (
        <NotLiveYet campaignId={campaignId} />
      )}
    </FlowPage>
  );
}

/**
 * The celebration — the reference's `[data-livepage]`, its `kindWide` branch.
 *
 * `isClaimPhone()` returns `false` in the reference, so its `kindPhone` branch
 * is dead code there and this composition is what every viewport gets. Nothing
 * reflows: the stage scales.
 */
function LivePage({ campaignId }: { campaignId: string }) {
  const { leaveToPage } = useFlowNav();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  // Read once, during the first render: `FlowPage` resets the module value in
  // its own layout effect, and a later re-render would read the reset.
  const direction = useRef<1 | -1 | null>(null);
  if (direction.current === null) direction.current = flowDirection();

  // `fitStages`, for this screen. First, so the first paint is already at the
  // right scale — and on resize, because the reference refits there too.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      el.style.transform = `translate(-50%, -50%) scale(${stageScale()})`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // The entrance — `verifyIntro`'s `runRelay`, which is all this screen gets:
  // it has no `[data-anim="grow"]`, no `[data-flourish]`, no cupids, and it is
  // neither `[data-lastlook]` nor `[data-paynow]` nor one of the three
  // image-first pages, so every one of that function's earlier branches is
  // false. Measured off the reference: head at 0ms, panel at ~85ms, cta at
  // ~170ms, each travelling 150px over 0.62s on `power3.out`.
  useLayoutEffect(() => stageRelayIn(root.current, direction.current ?? 1, RELAY), []);

  return (
    <div className="ff-live" ref={root}>
      <div className="ff-live__stage" data-page-stage="1" ref={stage}>
        <div className="ff-live__col">
          <h1 className="ff-live__head" data-stage-anim="head">
            {HEADLINE}
          </h1>

          <p className="ff-live__lede" data-stage-anim="panel">
            {LEDE}
          </p>

          {/* `liveDash` is a no-op in the prototype — there is nothing after
              this screen there. Here it hands over to §20's campaign home,
              through `FlowPage`'s own exit fade. The label names its
              destination, so §33.11.4 needs nothing added to it. */}
          <button
            type="button"
            className="ff-live__cta"
            data-stage-anim="cta"
            onClick={() => leaveToPage('password')}
          >
            {CTA_LABEL}
          </button>
        </div>
      </div>
    </div>
  );
}

/** §17: no launch record, no celebration. */
function NotLiveYet({ campaignId }: { campaignId: string }) {
  const { leaveToPage } = useFlowNav();

  return (
    <div className="ff-wait">
      <h1 className="ff-build__title" data-anim="head">
        Your campaign is not live yet
      </h1>
      <div data-anim="panel">
        <StatePanel
          state="Your campaign has not launched"
          whatHappened="Your page goes public when we run the coordinated launch — the page first, then every Creator’s link. That has not happened yet."
          next="The previous screen says exactly where your campaign is and who has the next step."
          owner="Proovd"
          nextUpdate="We email you the moment it is live"
          action={
            <Button tier="primary" onClick={() => leaveToPage('in-review', -1)}>
              See where your campaign stands
            </Button>
          }
          reference={campaignId}
          getHelp={{ href: '/support' }}
        />
      </div>
    </div>
  );
}
