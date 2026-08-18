/**
 * What is left of the campaign workspace — Spec §12, §13, §24.6.
 *
 * ── Its five §12 steps moved out, and that is the whole change ──────────────
 * Founder Flow v2 Session D (2026-08-18) rebuilt Visuals, Branding, Interview,
 * Story and Socials as five full-bleed pages under
 * `/campaigns/:campaignId/setup/*`, with Last look as the review over all eight
 * answers. Keeping a second set of controls over the same five items here would
 * be two places to answer one question — the same reasoning that deleted
 * `DraftLanding` in Session B and the interim vetting surface in Session C.
 *
 * ── What stays is Session E's, and it stays until Session E takes it ────────
 * Payout onboarding (§13's four states) and the listing fee (§24.6, Appendix
 * A.5) are the reference's screens 25 and 20. They belong to the next session
 * and they are the only reason this address still renders anything: deleting
 * them now would remove the only path a Founder has to pay, and rebuilding them
 * here first would be building Session E's screens in Session D's session. Last
 * look's `All good` points here for exactly as long as that is true.
 *
 * The fee panel parses cents only to format them. There is no `$35 − $2 × n` in
 * this file and none anywhere under `frontend/src/surfaces/`.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { founderFlowPath } from '@proovd/shared';
import { Button, Measure, Section, StatePanel, NO_ACTION } from '../../components/index.js';
import { PageLoading } from '../../features/public/states.js';
import { FeePreview, HighEffortPanel } from './FeePreview.js';
import { ListingPayment } from './ListingPayment.js';
import { PayoutOnboarding, type PayoutState } from '../payouts/PayoutOnboarding.js';
import { fetchPayouts, requestOnboardingLink } from '../payouts/api.js';
import { fetchWorkspace, FounderRequestError, type WorkspaceState } from './api.js';

/**
 * §13's onboarding.
 *
 * Read on mount rather than folded into the workspace response: the account
 * belongs to the *person* and is reused across their campaigns (§11's rule,
 * which applies to a Founder with two campaigns as much as to a Creator), so it
 * is not a property of this campaign's workspace.
 */
function FounderPayouts() {
  const [payouts, setPayouts] = useState<PayoutState | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPayouts('founder')
      .then((result) => {
        if (!cancelled) setPayouts(result.payouts);
      })
      .catch(() => {
        // A Founder who cannot read their payout state can still work on their
        // campaign. An error card where a status belongs would stop the page
        // being about what it is about.
        if (!cancelled) setPayouts(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const start = useCallback(async () => {
    const link = await requestOnboardingLink('founder');
    window.location.assign(link.url);
  }, []);

  if (!payouts) return null;
  return <PayoutOnboarding payouts={payouts} role="founder" onStart={start} />;
}

export function CampaignWorkspace() {
  const { campaignId = '' } = useParams();
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWorkspace(campaignId)
      .then(({ workspace }) => {
        if (!cancelled) setState(workspace);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure(
          error instanceof FounderRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'We could not load your campaign.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (failure) {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="We could not open your campaign"
            whatHappened={failure}
            next="Reload the page. If it keeps happening, contact support and we will look."
            owner="Proovd"
            nextUpdate="As soon as you tell us"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: '/support' }}
          />
        </Measure>
      </Section>
    );
  }

  if (!state) return <PageLoading />;

  return (
    <Section>
      <Measure>
        <header className="workspace__head">
          <h1 className="page-title">Your listing fee and payouts</h1>
          <p className="lede">
            What it costs to list your campaign, and where the money you raise goes.
          </p>
        </header>

        {state.listingPaid ? (
          <StatePanel
            state="Your listing fee is paid"
            whatHappened="The savings you earned were applied to what you paid. Changing an answer now does not change that amount."
            next="Carry on building your campaign page."
            owner="Proovd"
            nextUpdate="No further update needed"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: '/support' }}
          />
        ) : (
          <p className="fine">
            Your five optional answers are what lower this.{' '}
            <a href={founderFlowPath('last-look', campaignId)}>Go back to Last look</a> to change
            any of them.
          </p>
        )}

        <FeePreview fee={state.fee} />
        <HighEffortPanel highEffort={state.highEffort} />
        {/* §13: Stripe-hosted onboarding happens "before listing-fee payment",
            and the Founder reaches it from here. `PayoutOnboarding` renders
            whichever of §13's four states is true — including the restricted
            one, which deliberately offers no path to payment. */}
        <FounderPayouts />
        {/* §13 / §24.6 (Phase 11): the itemised fee, Appendix A.5's consent with
            its resolved total, and the one payment action — or, after payment,
            the §24.6 record and §31.6's cancellation decision. It renders no way
            to pay while onboarding is incomplete or restricted. */}
        <ListingPayment campaignId={campaignId} />
      </Measure>
    </Section>
  );
}
