/**
 * The shell the four build steps share — Session F.
 *
 * Loading, failure, §9's three autosave phrases, and the nav — written once
 * because four copies is four chances to get the autosave vocabulary wrong in
 * one of them, and the wrong one is the step nobody tested. `AnswerPage` does
 * the same job for Session D's five §12 answers.
 *
 * ── The walk is derived, never hardcoded ────────────────────────────────────
 * §14.4 gives a Product campaign no public threshold, so screen 22 is Idea-only
 * and `buildFlowStepsFor` decides which of the four this campaign passes
 * through. A hand-written `voice → threshold → faqs` would send every Product
 * Founder to a page with nothing on it.
 *
 * ── And the four steps do not complete a build ──────────────────────────────
 * Ten shared fields are required plus four for Idea or one for Product; these
 * four cover three of them. So the last step carries `/campaigns/:campaignId/
 * build` — which renders exactly what is left from the server's own `missing`
 * list — beside `BUILD_STEPS_ARE_NOT_THE_WHOLE_BUILD`, because telling somebody
 * their campaign is built while `deriveBuildStatus` says `in_progress` is
 * §1.4's failure with a celebration on it.
 *
 * ── But it is not where the flow ENDS ───────────────────────────────────────
 * That control was the last step's only forward control until 2026-08-20, and
 * it leaves the flow: nothing in the product navigated into `in-review`, so
 * `in-review`, `live` and `password` were an unreachable island and no Founder
 * ever arrived at the screen where they choose a password. The reference's own
 * chain is build → `campreview` → `live`, so the primary continues to
 * `in-review` and the build page stays one control to the left of it.
 */

import type { ReactNode } from 'react';
import { BUILD_STEPS_ARE_NOT_THE_WHOLE_BUILD, buildFlowStepsFor } from '@proovd/shared';
import { Button, StatePanel, NO_ACTION } from '../../components/index.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { describeSaveState } from '../../lib/autosave.js';
import { FlowPage, useFlowNav } from './FlowPage.js';
import type { BuildFlowState } from './useBuild.js';

export function BuildStepPage({
  pageId,
  campaignId,
  build,
  title,
  lede,
  children,
}: {
  pageId: string;
  campaignId: string;
  build: BuildFlowState;
  title: string;
  lede: string;
  children: ReactNode;
}) {
  if (build.failure) {
    return (
      <FlowPage pageId={pageId} param={campaignId}>
        <div className="ff-build">
          <StatePanel
            state="We could not open your campaign page"
            whatHappened={build.failure}
            next="Reload the page. Everything you have already saved is on your campaign."
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

  if (!build.state) {
    return <SurfaceLoading subject="your campaign page" reference="Your campaign" />;
  }

  return (
    <FlowPage pageId={pageId} param={campaignId} badge>
      <div className="ff-build">
        <h1 className="ff-build__title" data-anim="head">
          {title}
        </h1>
        <p className="ff-money__lede" data-anim="sub">
          {lede}
        </p>
        {/* §9's three phrases, from the one place that speaks them
            (`lib/autosave.ts`) — never a fourth wording written here. */}
        <p
          className="ff-build__save"
          role="status"
          aria-live="polite"
          data-state={build.autosave.state.status}
        >
          {describeSaveState(build.autosave.state)}
        </p>
        <div data-anim="panel">{children}</div>
      </div>
    </FlowPage>
  );
}

/**
 * Back and forward for one build step, from the register rather than by hand.
 *
 * The last step carries two forward controls and they go to different places:
 * the campaign build, where the server's own list of what is still missing
 * lives, and `in-review`, which is the next page of the flow.
 */
export function buildStepNav(build: BuildFlowState, stepId: string): ReactNode {
  return <BuildStepNav build={build} stepId={stepId} />;
}

function BuildStepNav({ build, stepId }: { build: BuildFlowState; stepId: string }) {
  const { leave, leaveToPage, param } = useFlowNav();
  const model = build.state?.model ?? 'product';
  const walk = buildFlowStepsFor(model).map((step) => step.id);
  const index = walk.indexOf(stepId as (typeof walk)[number]);

  const previous = index > 0 ? walk[index - 1] : 'fee';
  const next = index >= 0 && index < walk.length - 1 ? walk[index + 1] : null;
  const last = next === null;

  return (
    <>
      {last ? (
        <p className="ff-build__not-done">{BUILD_STEPS_ARE_NOT_THE_WHOLE_BUILD}</p>
      ) : null}
      <div className="ff-nav" data-anim="cta">
        <Button
          tier="tertiary"
          onClick={() => leaveToPage(previous!, -1)}
        >
          {BACK_LABEL[previous!] ?? 'Back'}
        </Button>
        {last ? (
          <>
            {/* Session F's destination, kept — the server's own list of what is
                still missing — but as the SECONDARY control, because it leaves
                the flow and the flow has three pages after this one. */}
            <Button
              tier="secondary"
              onClick={() => leave(`/campaigns/${encodeURIComponent(param)}/build`)}
            >
              See what is left on your campaign
            </Button>
            {/* The reference's own next beat: its last build step goes to
                `campreview`, and from there to `live`. Ours are `in-review`,
                `live` and `password` — and until this edge existed nothing in
                the product navigated into any of the three, so the flow ended
                here and no Founder ever reached the screen where they choose a
                password. `in-review` reads §23.1 rather than deciding it, so a
                campaign that is still `affiliate_response_and_build` is told
                exactly that and offered the build page again. */}
            <Button tier="primary" onClick={() => leaveToPage('payouts')}>
              Set up how you get paid
            </Button>
          </>
        ) : (
          <Button tier="primary" onClick={() => leaveToPage(next)}>
            {FORWARD_LABEL[next] ?? 'Next'}
          </Button>
        )}
      </div>
    </>
  );
}

/** §33.11.4: a control names its destination, never `Next`. */
const FORWARD_LABEL: Record<string, string> = {
  voice: 'On to your brand voice',
  threshold: 'On to your order threshold',
  faqs: 'On to your FAQs',
  rewards: 'On to your Backer rewards',
};

/** The label a back control carries, so it names where it goes too. */
export const BACK_LABEL: Record<string, string> = {
  fee: 'Back to your listing fee',
  'creator-payment': 'Back to how Creators are paid',
  'creator-pay-explainer': 'Back to how Creator preorders work',
  voice: 'Back to your brand voice',
  threshold: 'Back to your order threshold',
  faqs: 'Back to your FAQs',
  rewards: 'Back to your Backer rewards',
};
