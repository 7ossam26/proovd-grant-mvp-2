/**
 * The Founder's campaigns — Spec §1.1, §3.1, §23.1, DNA §5.12, §5.14.
 *
 * The address a Founder lands on after signing in. Until this existed, every
 * Founder surface in the product was `/campaigns/:campaignId/…` — so a session
 * was only useful to somebody who already had the campaign id in their
 * browser history. A signed-in Founder with a clean browser had a valid account
 * and nowhere to go.
 *
 * ── One destination per campaign, chosen by its own state ──────────────────
 * DNA §5.14 stages complexity rather than deleting it, and DNA §5.1 allows one
 * question per moment. Nine links per campaign is a wall; one link that opens
 * the surface the campaign is actually at is the Act. Every other surface for
 * that campaign is reachable from the one that opens — this page is wayfinding,
 * not a second navigation system.
 *
 * `DESTINATION` is exhaustive over `CampaignStatus` by type, so a state added
 * to §23.1 fails to compile here rather than quietly falling through to a
 * default that sends somebody to the wrong surface.
 *
 * ── No status word is rendered ─────────────────────────────────────────────
 * §3.1: `pre_build`, `pre_launch`, and the internal lifecycle names must never
 * reach a Founder. Rather than inventing a customer-facing label for each of
 * §23.1's twenty-seven states — copy the Spec does not state, which §1 rule 6
 * forbids — each row says what the Founder can DO. The destination label is
 * the state, in the only vocabulary that is already agreed.
 *
 * ── Not a dashboard ────────────────────────────────────────────────────────
 * §26 licenses dashboard density in Admin and nowhere else. No counts, no
 * money, no progress bars, no badges: those live on §20's campaign home, which
 * is one of the destinations below.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import type { CampaignStatus } from '@proovd/shared';
import {
  Button,
  Card,
  Measure,
  Section,
  StatePanel,
} from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import { AccountRequestError, signOut } from '../auth/api.js';

interface FounderCampaign {
  campaignId: string;
  status: CampaignStatus;
  type: 'pre_build' | 'pre_launch';
  listingPaid: boolean;
  highEffort: boolean;
}

/**
 * Where each §23.1 state opens, and the label that names it (§33.11.4: a
 * control names its actual destination, never "Continue").
 *
 * The pre-account states are present because the type demands they be — a
 * Founder cannot be signed in while their campaign is `invited_draft`, and
 * pointing them at the workspace is the harmless answer rather than a branch
 * nobody can reach.
 */
const DESTINATION: Record<CampaignStatus, { path: string; label: string }> = {
  // Before the campaign is built. Founder Flow v2 Session D put the five §12
  // answers on their own pages with Last look as the review over all eight, so
  // the account-claimed state opens THAT — that is where the work is at that
  // point. Session E gave the two money states a page each, and they open the
  // one they are named after: §23.1 orders them the same way the flow does,
  // stripe_onboarding_pending before listing_fee_pending, because
  // `beginListingCheckout` refuses without a complete `founder_seller`.
  //
  // The two pre-account states are present because the type demands they be —
  // a Founder cannot be signed in while their campaign is `invited_draft`.
  invited_draft: { path: 'setup/review', label: 'Open your campaign answers' },
  vetting_submitted: { path: 'setup/review', label: 'Open your campaign answers' },
  account_claimed: { path: 'setup/review', label: 'Open your campaign answers' },
  stripe_onboarding_pending: { path: 'setup/payouts', label: 'Finish setting up payouts' },
  listing_fee_pending: { path: 'setup/fee', label: 'Pay your listing fee' },

  // Building the page and answering review.
  affiliate_response_and_build: { path: 'build', label: 'Build the campaign page' },
  pending_review: { path: 'build', label: 'See the campaign in review' },
  changes_required: { path: 'build', label: 'Make the changes review asked for' },

  // Approved and getting creators ready for the coordinated launch.
  approved: { path: 'creator-readiness', label: 'Check creator readiness' },
  creator_prep: { path: 'creator-readiness', label: 'Check creator readiness' },
  creator_replacement: { path: 'creator-readiness', label: 'Check creator readiness' },

  // Running.
  live: { path: 'home', label: 'Open the campaign home' },

  // Closing, charging, and everything the results surface reports on.
  closed_pending_capture: { path: 'results', label: 'See the campaign results' },
  capture_retry_window: { path: 'results', label: 'See the campaign results' },
  closed_reconciling: { path: 'results', label: 'See the campaign results' },
  captured_pending_w9: { path: 'results', label: 'See the campaign results' },
  single_payment_released: { path: 'results', label: 'See the campaign results' },
  first_payment_released: { path: 'results', label: 'See the campaign results' },
  remaining_payment_released: { path: 'results', label: 'See the campaign results' },
  refunded_no_creator: { path: 'results', label: 'See the campaign results' },
  ended_no_charge: { path: 'results', label: 'See the campaign results' },

  // Delivering what was promised.
  day_14_review: { path: 'fulfillment', label: 'Open fulfillment and delivery' },
  fulfilled: { path: 'fulfillment', label: 'Open fulfillment and delivery' },
  closed_resolved: { path: 'fulfillment', label: 'Open fulfillment and delivery' },

  // Stopped. The results surface carries the recorded explanation (§26.7,
  // §29.7) — there is nothing to build, promote, or deliver from here.
  suspended: { path: 'results', label: 'See what happened to this campaign' },
  killed: { path: 'results', label: 'See what happened to this campaign' },
  banned_founder: { path: 'results', label: 'See what happened to this campaign' },
};

/** §3.1's customer-facing campaign model names. Never the internal ones. */
const MODEL_LABEL: Record<FounderCampaign['type'], string> = {
  pre_build: 'Idea Campaign',
  pre_launch: 'Product Campaign',
};

type View =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'failed'; title: string; whatHappened: string; next: string }
  | { status: 'ready'; campaigns: FounderCampaign[] };

export function FounderCampaigns() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>({ status: 'loading' });

  const load = useCallback(async () => {
    setView({ status: 'loading' });
    try {
      const response = await fetch('/api/founder/campaigns', { credentials: 'include' });
      // Only an authentication answer is a signed-out answer. Treating every
      // failure as one asks somebody to retype a password that cannot help
      // when the server is simply unavailable (§1.4) — `CreatorCampaigns`
      // records the same reasoning.
      if (response.status === 401 || response.status === 403) {
        setView({ status: 'signed_out' });
        return;
      }
      if (!response.ok) {
        setView({
          status: 'failed',
          title: 'Proovd could not load your campaigns',
          whatHappened: `The server answered ${response.status}. Nothing about your campaigns changed.`,
          next: 'Try again. If it keeps failing, contact support and we will look at it.',
        });
        return;
      }
      const body = (await response.json()) as { campaigns: FounderCampaign[] };
      setView({ status: 'ready', campaigns: body.campaigns });
    } catch (caught) {
      const detail = caught instanceof AccountRequestError ? caught.detail : null;
      setView({
        status: 'failed',
        title: 'Proovd could not be reached',
        whatHappened:
          detail?.whatHappened ??
          'The request did not complete, so nothing about your campaigns was read or changed.',
        next: detail?.next ?? 'Check your connection and try again.',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (view.status === 'loading') {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="Loading your campaigns"
            whatHappened="Proovd is reading the campaigns your account is on."
            next="They appear as soon as that comes back."
            owner="Proovd"
            nextUpdate="Within a few seconds"
            action="No action needed"
            reference="Your campaigns"
          />
        </Measure>
      </Section>
    );
  }

  if (view.status === 'signed_out') {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="Please sign in"
            whatHappened="Your session has ended, so Proovd cannot show your campaigns."
            next="Sign in again. Nothing changed while you were signed out."
            owner="You"
            nextUpdate="When you sign in"
            action={
              <Button tier="primary" onClick={() => navigate('/signin')}>
                Sign in to Proovd
              </Button>
            }
            reference="Your campaigns"
            ring
          />
        </Measure>
      </Section>
    );
  }

  if (view.status === 'failed') {
    return (
      <Section>
        <Measure>
          <StatePanel
            state={view.title}
            whatHappened={view.whatHappened}
            next={view.next}
            owner="Proovd"
            nextUpdate="When you try again"
            action={
              <Button tier="primary" onClick={() => void load()}>
                Try loading your campaigns again
              </Button>
            }
            reference="Your campaigns"
            getHelp={{ href: supportMailto('I cannot load my campaigns') }}
            ring
          />
        </Measure>
      </Section>
    );
  }

  return (
    <Section>
      <div className="auth-shell">
        <div className="auth-shell__head">
          <h1>Your campaigns</h1>
          <p className="auth__lede">
            Every campaign your account is on. Open one to pick up where it is.
          </p>
        </div>

        {view.campaigns.length === 0 ? (
          <StatePanel
            state="No campaign is open on your account yet"
            whatHappened="Your account exists, and no campaign has been started on it. Campaigns are opened by invitation, one at a time."
            next="If you were expecting one, the invitation email carries the link that starts it."
            owner="Proovd"
            nextUpdate="When your invitation arrives"
            action="No action needed"
            reference="Your campaigns"
            getHelp={{ href: supportMailto('I was expecting a campaign on my account') }}
          />
        ) : (
          <ul className="campaign-list">
            {view.campaigns.map((campaign) => {
              const destination = DESTINATION[campaign.status];
              return (
                <li key={campaign.campaignId}>
                  <Card>
                    <div className="campaign-list__row">
                      <div className="campaign-list__what">
                        <h2>{MODEL_LABEL[campaign.type]}</h2>
                        {/* The id is the Founder's own reference for support
                            (§27.1's sixth question), not decoration. */}
                        <p className="campaign-list__ref">
                          Reference {campaign.campaignId}
                        </p>
                      </div>
                      <Button
                        tier="primary"
                        href={`/campaigns/${encodeURIComponent(campaign.campaignId)}/${destination.path}`}
                      >
                        {destination.label}
                      </Button>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        <div className="auth__aside">
          <p>
            <RouterLink to="/settings/notifications">Notification settings</RouterLink>
          </p>
          <p>
            <Button
              tier="tertiary"
              onClick={() => void signOut().then(() => navigate('/signin'))}
            >
              Sign out
            </Button>
          </p>
        </div>
      </div>
    </Section>
  );
}
