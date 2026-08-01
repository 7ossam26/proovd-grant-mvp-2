/**
 * Stripe-hosted onboarding, for both roles — Spec §13, §11, §27.1.
 *
 * §13 fixes the four states a person may land on and what each one owes them:
 *
 *   Complete                   confirmed, with what unlocks next
 *   More information required  the EXACT missing requirement, and a resume
 *                              action
 *   Under review               owner, and the next expected update
 *   Restricted or failed       a safe support path, and no misleading ability
 *                              to pay the listing fee
 *
 * One component for the Founder and the Creator. The states are identical and
 * the only differences — what "complete" unlocks, and what an incomplete
 * account blocks — arrive from the server, which is where §24.1 draws the line
 * between a seller and a recipient. Two components would be two places for
 * those sentences to drift.
 *
 * ── There is no form here, and there could not be ──────────────────────────
 * §11 forbids reproducing provider-controlled fields; §5.3 says Proovd stores
 * statuses and IDs and "never full bank details"; §13 forbids storing identity
 * documents. The only control this renders is a link into Stripe. There is no
 * input on this surface and no route behind it that would take one.
 *
 * ── The requirement names are Stripe's, translated ─────────────────────────
 * §13 wants the *exact* missing requirement, not "more information needed".
 * Stripe's names are machine-readable (`individual.verification.document`), so
 * REQUIREMENT_LABELS turns the ones a person actually meets into plain words
 * and anything unrecognised is shown as it came — an untranslated name is
 * useful; a swallowed one is not.
 */

import { useCallback, useState } from 'react';
import { Button, Card, StatePanel, NO_ACTION } from '../../components/index.js';

export interface PayoutState {
  state: 'not_started' | 'more_information_required' | 'under_review' | 'restricted' | 'complete';
  stripeAccountId: string | null;
  missingRequirements: string[];
  pendingVerification: string[];
  disabledReason: string | null;
  canResume: boolean;
  onboardingAvailable: boolean;
  listingFeeEligible: boolean;
  linkActivationBlocked: boolean;
  paymentReceiptBlocked: boolean;
  campaignReviewBlocked: false;
  lastSyncedAt: string | null;
}

export type PayoutRole = 'founder' | 'creator';

/**
 * Stripe's requirement names, in words. Only the ones a person can actually do
 * something about; anything else is rendered as Stripe sent it.
 */
const REQUIREMENT_LABELS: Record<string, string> = {
  'individual.verification.document': 'a photo of your ID',
  'individual.id_number': 'your identity number',
  'individual.ssn_last_4': 'the last four digits of your SSN',
  'individual.address.line1': 'your address',
  'individual.dob.day': 'your date of birth',
  'individual.dob.month': 'your date of birth',
  'individual.dob.year': 'your date of birth',
  'individual.first_name': 'your first name',
  'individual.last_name': 'your last name',
  'individual.email': 'your email address',
  'individual.phone': 'your phone number',
  external_account: 'a bank account to be paid into',
  'business_profile.url': 'a website or profile link',
  'business_profile.mcc': 'what kind of business this is',
  'company.tax_id': 'your business tax id',
  'company.address.line1': 'your business address',
  'tos_acceptance.date': 'accepting Stripe’s terms',
  'tos_acceptance.ip': 'accepting Stripe’s terms',
};

function requirementText(names: string[]): string[] {
  // Deduplicated, because Stripe lists day, month, and year separately and a
  // person reading "your date of birth" three times learns nothing.
  return [...new Set(names.map((name) => REQUIREMENT_LABELS[name] ?? name))];
}

export interface PayoutOnboardingProps {
  payouts: PayoutState;
  role: PayoutRole;
  /** Issues a hosted link and navigates to it. */
  onStart: () => Promise<void>;
}

export function PayoutOnboarding({ payouts, role, onStart }: PayoutOnboardingProps) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const start = useCallback(async () => {
    setBusy(true);
    setFailure(null);
    try {
      await onStart();
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : 'We could not open Stripe. Nothing has changed.',
      );
    } finally {
      setBusy(false);
    }
  }, [onStart]);

  const resume = (
    <Button tier="primary" onClick={() => void start()} disabled={busy}>
      {busy ? 'Opening Stripe…' : payouts.state === 'not_started' ? 'Set up payouts' : 'Finish payout setup'}
    </Button>
  );

  /* §32.2's Connect URLs are unset, or Stripe is not configured. §1.4: say so
     rather than render a control that cannot work. */
  if (!payouts.onboardingAvailable && payouts.state === 'not_started') {
    return (
      <StatePanel
        state="Payout setup is not open yet"
        whatHappened="Getting paid needs a Stripe account in your name, for identity, tax, and bank details. That step is not switched on for this deployment yet."
        next="Proovd never asks for your bank or tax details, and never stores them. When it opens you will set it up with Stripe directly."
        owner="Proovd"
        nextUpdate="We will email you when payout setup opens."
        action={NO_ACTION}
        reference="Payout setup"
      />
    );
  }

  switch (payouts.state) {
    /* §13: "Complete." Confirmed, with what unlocks next. */
    case 'complete':
      return (
        <StatePanel
          state="Your payout setup is finished"
          whatHappened="Stripe has everything it needs from you."
          next={
            role === 'founder'
              ? 'Your campaign can take pre-orders when it goes live, and you can pay your listing fee when you are ready.'
              : 'You can be paid for campaigns you work on. Nothing else is needed from you.'
          }
          owner="You"
          nextUpdate="No further update needed"
          action={NO_ACTION}
          reference="Payout setup"
        />
      );

    /* §13: "More information required, with exact missing requirement and
       resume action." */
    case 'more_information_required':
      return (
        <>
          <StatePanel
            state="Stripe needs a little more from you"
            whatHappened={
              payouts.missingRequirements.length > 0
                ? `Stripe still needs ${requirementText(payouts.missingRequirements).join(', ')}.`
                : 'Stripe has asked for something else before it can finish.'
            }
            next="Carry on where you left off. It opens at Stripe, and Proovd never sees what you enter."
            owner="You"
            nextUpdate="As soon as you finish"
            action={resume}
            reference="Payout setup"
            ring
          />
          {failure ? <p className="field__error">{failure}</p> : null}
        </>
      );

    /* §13: "Under review, with owner and next expected update." */
    case 'under_review':
      return (
        <StatePanel
          state="Stripe is checking your details"
          whatHappened={
            payouts.pendingVerification.length > 0
              ? `Stripe is verifying ${requirementText(payouts.pendingVerification).join(', ')}. There is nothing wrong.`
              : 'Stripe has everything it asked for and is reviewing it. There is nothing wrong.'
          }
          next="Nothing is needed from you while this runs. We will email you the moment it clears."
          owner="Stripe"
          nextUpdate="Usually within a few business days"
          action={NO_ACTION}
          reference="Payout setup"
        />
      );

    /* §13: "Restricted/failed, with safe support path and no misleading ability
       to pay the listing fee." There is deliberately no resume action and no
       payment action anywhere in this branch. */
    case 'restricted':
      return (
        <StatePanel
          state="Stripe cannot continue with this account"
          whatHappened="Stripe has stopped this account from taking payments. This is Stripe's decision, not Proovd's, and we are not told the details."
          next="Contact support and a person here will go through it with you. Do not start again — it would end the same way."
          owner="Proovd"
          nextUpdate="Within one business day of you getting in touch"
          action={NO_ACTION}
          reference="Payout setup"
          getHelp={{ href: '/support' }}
        />
      );

    /* Not started. The one place a first-time action belongs. */
    default:
      return (
        <>
          <Card>
            <h2 className="section-title">
              {role === 'founder' ? 'Set up how you get paid' : 'Finish payout setup'}
            </h2>
            <p className="lede">
              {role === 'founder'
                ? 'Your campaign takes payments through a Stripe account in your name. Stripe collects your identity, tax, and bank details directly.'
                : 'Getting paid needs a Stripe account in your name. Stripe collects your identity, tax, and bank details directly.'}
            </p>
            <p className="fine">
              Proovd never asks for your bank details, tax details, or identity documents, and never
              stores them. We only ever see whether Stripe says you are set up.
            </p>
            {payouts.canResume ? resume : null}
            {failure ? <p className="field__error">{failure}</p> : null}
          </Card>
        </>
      );
  }
}
