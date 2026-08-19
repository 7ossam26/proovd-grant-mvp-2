/**
 * Screen 8 — you are in — Creator Flow v2, Session C, 2026-08-19.
 *
 * The last screen of the walk, the first one behind a session, and the home of
 * §33.2.3's named waiting state and §11's second primary action.
 *
 * ── Why it is not on the invitation token, and why that is a FIX ────────────
 * `completeAffiliateSignup` calls `tokens.claimAffiliateInvitation`, which sets
 * both `claimed_at` and `revoked_at`. From the instant the account exists,
 * every `/creator-invitation/:token` address answers the one rejection —
 * `affiliate-signup.test.ts` drives exactly that and asserts
 * `TOKEN_REJECTION_STATUS` on a repeat claim.
 *
 * Phase 08b's `CreatorSignup` re-read the invitation after a successful claim
 * and rendered its waiting state from `profile.claimedAt`. That read 401s in
 * production, so a Creator who had just created their account was shown the
 * unusable-link page — and the frontend suite never saw it, because it stubbed
 * a claimed profile rather than driving a real claim. The waiting state has
 * been unreachable since it was written.
 *
 * Session A anticipated the shape of the answer when it typed `param` as
 * `'token' | 'none'` and wrote `CREATOR_FLOW_EARLIER_STAGE_CLOSED`: the pages
 * after the claim are account-level and carry no id at all.
 *
 * ── It reads what a signed-in Creator can read ──────────────────────────────
 * `/api/creator/campaigns` and the payout state. Not the invitation payload —
 * there is no token left to send. The campaign this account was created for is
 * the one the invitation named, and §33.2.1 is what guarantees there is exactly
 * one of it.
 *
 * ── No manufactured next step ───────────────────────────────────────────────
 * §11: the waiting state says `No action needed`, and §10 makes `Review
 * campaign` reachable only once there is something to read. Where there is
 * nothing to do this offers nothing (DNA §5.4) — the payout handoff is the one
 * action, and it is the one §11 names.
 */

import { useEffect, useState } from 'react';
import {
  CREATOR_DONE_ACCOUNT_MADE,
  CREATOR_DONE_HEAD,
  CREATOR_PROOVD_OWNS_THE_WAIT,
} from '@proovd/shared';
import { Button, Measure, NO_ACTION, Section, StatePanel, Tag } from '../../components/index.js';
import { SurfaceLoading, supportMailto } from '../../features/public/states.js';
import { fetchCreatorCampaigns, type CreatorCampaign } from '../creator/api.js';
import { PayoutOnboarding, type PayoutState } from '../payouts/PayoutOnboarding.js';
import { fetchPayouts, requestOnboardingLink } from '../payouts/api.js';

export function DoneStep() {
  const [campaigns, setCampaigns] = useState<CreatorCampaign[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCreatorCampaigns()
      .then((result) => {
        if (!cancelled) setCampaigns(result.campaigns);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    // The account exists — this page is behind `requireRole('affiliate')`, so
    // reaching it at all proves the session. What failed is one read.
    return (
      <Measure>
        <StatePanel
          state="We could not load your campaign just now"
          whatHappened="Your account is set up and you are signed in. The list of what it is joined to did not come back."
          next="Reload the page. Nothing about your account depends on this read."
          owner="Proovd"
          nextUpdate="As soon as you reload"
          action={
            <Button tier="primary" href="/creator/campaigns">
              Go to your campaigns
            </Button>
          }
          reference="Creator account"
          getHelp={{ href: supportMailto('Creator account') }}
          ring
        />
      </Measure>
    );
  }

  if (!campaigns) {
    return <SurfaceLoading subject="your account" reference="Creator account" />;
  }

  const campaign = campaigns[0];
  const reviewable = campaign?.reviewAvailable === true;

  return (
    <Measure>
      <Section>
        <Tag variant="mint">Signed up</Tag>
        <h1>{CREATOR_DONE_HEAD}</h1>
        <p>{CREATOR_DONE_ACCOUNT_MADE}</p>
      </Section>

      {/* §33.2.3. Six questions, which is why it is a `StatePanel` — the
          component that cannot render without answering all of them. */}
      {reviewable ? (
        <StatePanel
          state="Your campaign is ready to read"
          whatHappened={`${campaign?.productName ?? 'The campaign'} is prepared, and there is something for you to look at.`}
          next="Open it when you have a moment. Nothing is decided by reading it."
          owner="You"
          nextUpdate="Whenever you open it"
          action={
            <Button
              tier="primary"
              href={`/creator/campaigns/${encodeURIComponent(campaign?.associationId ?? '')}`}
            >
              Review campaign
            </Button>
          }
          reference="Creator account"
          getHelp={{ href: supportMailto('Creator account') }}
        />
      ) : (
        <StatePanel
          state="Waiting for the Founder"
          whatHappened={`The Founder is still finishing their setup, so there is nothing about ${campaign?.productName ?? 'the campaign'} for you to review yet.`}
          next={CREATOR_PROOVD_OWNS_THE_WAIT}
          owner="Proovd"
          // `next` already carries the promise to write. Repeating it here
          // would answer two of §27.1's questions with one sentence and leave
          // the reader unsure which was which.
          nextUpdate="When the campaign is ready for you to read"
          action={NO_ACTION}
          reference="Creator account"
          getHelp={{ href: supportMailto('Creator account') }}
        />
      )}

      <PayoutPanel />
    </Measure>
  );
}

/**
 * §11's second primary action: `Finish payout setup`.
 *
 * A handoff, never a form. §11: it "opens the Stripe-controlled
 * connected-account onboarding required for identity, tax, bank, transfer
 * capability, and payout" — and there is no route in this product that would
 * take a bank or tax field, which is what actually makes that true.
 *
 * The account belongs to the PERSON (§11's reuse across campaigns), so the
 * state is read from the payout endpoint rather than from one campaign's view
 * of it.
 */
function PayoutPanel() {
  const [payouts, setPayouts] = useState<PayoutState | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPayouts('creator')
      .then((result) => {
        if (!cancelled) setPayouts(result.payouts);
      })
      .catch(() => {
        // A Creator who cannot read their payout state has still signed up.
        // The state above already says what is happening; an error where a
        // status belongs would say something worse and less true.
        if (!cancelled) setPayouts(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function start() {
    const link = await requestOnboardingLink('creator');
    window.location.assign(link.url);
  }

  if (!payouts) return null;

  return (
    <>
      <PayoutOnboarding payouts={payouts} role="creator" onStart={start} />
      <div className="claim__actions">
        <Button tier="tertiary" href="/creator/campaigns">
          Go to your campaigns
        </Button>
      </div>
    </>
  );
}
