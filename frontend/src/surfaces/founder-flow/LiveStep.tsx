/**
 * Screen 26 — your campaign is live — Founder Flow v2, Session F.
 *
 * The last page of the flow, and the only one that celebrates anything.
 *
 * ── Unreachable without a real launch ───────────────────────────────────────
 * §17's `launchCampaign` is a five-step idempotent sequence: the page goes live,
 * then every ready Creator's tracking link activates. A campaign is live because
 * that ran, and this screen reads `campaigns.status` rather than deciding
 * anything. A campaign that has not reached it is told where it actually is and
 * offered the waiting screen — never a celebration for something that has not
 * happened (§1.4).
 *
 * ── And nothing here reaches it on a timer ──────────────────────────────────
 * The reference arrives here five seconds after the review screen, having
 * flipped three Creator chips to accepted on the way. There is no `setTimeout`
 * and no `setInterval` in this file.
 *
 * ── Where it goes next ──────────────────────────────────────────────────────
 * §20's campaign home — Glance, one ranked Act, Explore. That is the surface a
 * live campaign is operated from, and the flow ends by handing over to it.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { LIVE_MEANS_A_LAUNCH_RECORD } from '@proovd/shared';
import { Button, StatePanel, NO_ACTION } from '../../components/index.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { FlowPage, useFlowNav } from './FlowPage.js';
import { fetchBuild, FounderRequestError, type BuildState } from '../founder/api.js';

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
      <Body campaignId={campaignId} status={build.campaignStatus} />
    </FlowPage>
  );
}

function Body({ campaignId, status }: { campaignId: string; status: string }) {
  const { leave, leaveToPage } = useFlowNav();

  /* §17: no launch record, no celebration. */
  if (status !== 'live') {
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

  return (
    <div className="ff-live">
      <h1 className="ff-live__title" data-anim="head">
        You’re live.
      </h1>
      <p className="ff-live__lede" data-anim="sub">
        {LIVE_MEANS_A_LAUNCH_RECORD}
      </p>
      <div className="ff-nav ff-live__nav" data-anim="cta">
        <Button
          tier="tertiary"
          href={`/campaign/${encodeURIComponent(campaignId)}`}
        >
          See your public page
        </Button>
        <Button
          tier="primary"
          onClick={() => leave(`/campaigns/${encodeURIComponent(campaignId)}/home`)}
        >
          Go to your campaign home
        </Button>
      </div>
    </div>
  );
}
