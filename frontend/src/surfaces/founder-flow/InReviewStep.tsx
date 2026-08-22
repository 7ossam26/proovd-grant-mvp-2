/**
 * Screen 19/26a — your campaign in review — Founder Flow v2, Session F.
 *
 * A genuine waiting state, answering §27.1's six questions, and the one screen
 * in this flow where the reference is most confidently wrong.
 *
 * ── Nothing here advances on a clock ────────────────────────────────────────
 * The reference auto-advances after five seconds and flips three Creator chips
 * to accepted at 1.5s and 3s on the way. What actually stands between a
 * submitted campaign and a live one is §15's Admin review with its immutable
 * approved snapshot, §14.2's bilateral Creator decisions inside a 72-hour
 * window, §16's thirteen-item readiness checklist, and §17's five-step
 * coordinated launch. **None of them is a wait**, and the chips flipping are
 * real people accepting real terms. There is no `setTimeout` and no
 * `setInterval` in this file, and a source scan asserts it.
 *
 * ── The chips are the recorded states ───────────────────────────────────────
 * `/api/founder/campaigns/:id/roster` is §14.5's projection — seven columns, no
 * email, no legal name, no internal status word (§11, §3.1). A Creator nobody
 * has heard from renders as waiting with the reason, rather than animating into
 * an acceptance that has not happened.
 *
 * ── And it does not review a person ─────────────────────────────────────────
 * The reference draws a second screen, `Application in review`, about the
 * Founder. §15 approves a CAMPAIGN. There is no record of a Founder being under
 * review, so there is no screen for one.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import {
  NOTHING_HERE_IS_A_TIMER,
  ROSTER_CHIPS_ARE_RECORDED,
  founderDashboardPath,
} from '@proovd/shared';
import { Button, StatePanel, Tag, NO_ACTION } from '../../components/index.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { FlowPage, useFlowNav } from './FlowPage.js';
import { fetchBuild, fetchRoster, FounderRequestError } from '../founder/api.js';
import type { BuildState, RosterView } from '../founder/api.js';

/** §23.1's lifecycle, in the only vocabulary a Founder has agreed to (§3.1). */
const WHERE_IT_STANDS: Record<string, { state: string; what: string; next: string; owner: 'You' | 'Proovd' }> = {
  affiliate_response_and_build: {
    state: 'Your campaign is still yours to finish',
    what: 'It has not been submitted for review yet, so nothing is waiting on us.',
    next: 'Finish your campaign page and send it for review.',
    owner: 'You',
  },
  pending_review: {
    state: 'Your campaign is with our review team',
    what: 'A person here is reading it end to end — the page, the rewards, and what you have promised.',
    next: 'Nothing is needed from you. We email you when the review is done.',
    owner: 'Proovd',
  },
  changes_required: {
    state: 'Our review asked for some changes',
    what: 'The review came back with specific things to change before your campaign can be approved.',
    next: 'Open your campaign page — each item says what to change and where.',
    owner: 'You',
  },
  approved: {
    state: 'Your campaign is approved',
    what: 'The page is signed off. Your Creators are getting ready to post, and the campaign goes live at the time we agreed with you.',
    next: 'Nothing is needed from you. We email you the moment it is live.',
    owner: 'Proovd',
  },
  creator_prep: {
    state: 'Your Creators are getting ready',
    what: 'Everyone on your roster is finishing what they need before launch — that is the last step before your page goes public.',
    next: 'Nothing is needed from you. We email you the moment it is live.',
    owner: 'Proovd',
  },
  creator_replacement: {
    state: 'We are replacing a Creator',
    what: 'A Creator your campaign was counting on could not continue, so we are finding a replacement.',
    next: 'Nothing is needed from you. We email you either way.',
    owner: 'Proovd',
  },
};

export function InReviewStep() {
  const { campaignId = '' } = useParams();
  const [build, setBuild] = useState<BuildState | null>(null);
  const [roster, setRoster] = useState<RosterView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchBuild(campaignId), fetchRoster(campaignId).catch(() => null)])
      .then(([buildState, rosterResult]) => {
        if (cancelled) return;
        setBuild(buildState);
        setRoster(rosterResult?.roster ?? null);
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
      <FlowPage pageId="in-review" param={campaignId}>
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
    <FlowPage pageId="in-review" param={campaignId} badge>
      <Body campaignId={campaignId} build={build} roster={roster} />
    </FlowPage>
  );
}

function Body({
  campaignId,
  build,
  roster,
}: {
  campaignId: string;
  build: BuildState;
  roster: RosterView | null;
}) {
  const { leave } = useFlowNav();
  const status = build.campaignStatus;
  const stage = WHERE_IT_STANDS[status];
  const live = status === 'live';

  // §17: a campaign is live because a launch record exists. This page does not
  // decide that — it reads the lifecycle and hands to the dashboard when the
  // lifecycle already says so.
  if (live) {
    return (
      <div className="ff-wait">
        <h1 className="ff-build__title" data-anim="head">
          Your campaign is live
        </h1>
        <div className="ff-nav" data-anim="cta">
          <Button tier="primary" onClick={() => leave(founderDashboardPath(campaignId), 1)}>
            See your campaign
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="ff-wait">
      <h1 className="ff-build__title" data-anim="head">
        Where your campaign stands
      </h1>

      <div data-anim="panel">
        <StatePanel
          state={stage?.state ?? 'Your campaign is with us'}
          whatHappened={
            stage?.what ??
            'Your campaign is at a stage we do not have a plain description for yet. Support can tell you exactly where it is.'
          }
          next={stage?.next ?? 'Contact support and a person here will go through it with you.'}
          owner={stage?.owner ?? 'Proovd'}
          nextUpdate="We email you when it changes"
          action={
            status === 'changes_required' || status === 'affiliate_response_and_build' ? (
              <Button
                tier="primary"
                onClick={() => leave(`/campaigns/${encodeURIComponent(campaignId)}/build`)}
              >
                Open your campaign page
              </Button>
            ) : (
              NO_ACTION
            )
          }
          reference={campaignId}
          getHelp={{ href: '/support' }}
        />
      </div>

      {/* Pinned. Somebody who has been told a screen updates itself will sit on
          it; §27.1's "when is the next update" is the email, not this tab. */}
      <p className="ff-wait__pinned" data-anim="note">
        {NOTHING_HERE_IS_A_TIMER}
      </p>

      {roster && roster.creators.length > 0 ? (
        <div className="ff-wait__roster" data-anim="field">
          <h2 className="ff-money__sub">Your Creators</h2>
          <p className="ff-money__foot">{ROSTER_CHIPS_ARE_RECORDED}</p>
          <ul className="ff-wait__chips">
            {roster.creators.map((creator) => (
              <li className="ff-wait__chip" key={creator.associationId}>
                <span className="ff-wait__handle">{creator.handle ?? 'A Creator'}</span>
                {/* `mint` for the affirmative one. `moss` is a mid-green fill
                    with pale text, so it read QUIETER than the states that have
                    not happened yet — backwards on the one screen where a
                    Founder is looking for who has said yes. */}
                <Tag variant={creator.statusLabel === 'Accepted' ? 'mint' : 'default'}>
                  {creator.statusLabel}
                </Tag>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
