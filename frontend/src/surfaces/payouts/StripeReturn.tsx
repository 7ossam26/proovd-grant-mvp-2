/**
 * Where Stripe sends someone back to — Spec §32.2, §13.
 *
 * §32.2 names two landing points: `STRIPE_CONNECT_RETURN_URL` when onboarding
 * finishes, and `STRIPE_CONNECT_REFRESH_URL` when the link expired or was
 * reused. Both land here, and §13 fixes what has to happen next: "Returning from
 * Stripe always lands on a human-readable status" — never a spinner, never a
 * raw requirements array, and never a blank page while a webhook catches up.
 *
 * ── The state is re-read, not assumed ──────────────────────────────────────
 * Landing back does not mean onboarding succeeded — Stripe returns people who
 * abandoned halfway just as it returns people who finished. So this asks the
 * server, which asks Stripe, and renders whichever of §13's four states is
 * actually true. Assuming success here is how a Founder ends up being told they
 * are set up and then failing at payment.
 *
 * ── A refresh is not an error ──────────────────────────────────────────────
 * An expired or reused link is ordinary. It is recorded as a refresh in §13's
 * history and the person is handed a fresh link, rather than shown a failure
 * for something that is not their fault.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Measure, Section, StatePanel, NO_ACTION } from '../../components/index.js';
import { PageLoading } from '../../features/public/states.js';
import { PayoutOnboarding, type PayoutRole, type PayoutState } from './PayoutOnboarding.js';
import { PayoutRequestError, recordReturn, requestOnboardingLink } from './api.js';

export interface StripeReturnProps {
  /** `returned` for the return URL, `refreshed` for the refresh URL. */
  event: 'returned' | 'refreshed';
}

/**
 * Which role landed.
 *
 * Stripe returns to one URL per deployment, so the role travels in the query
 * string that was put into the link. It decides only which endpoint to read —
 * the server re-derives everything else from the session, so a tampered value
 * shows the wrong panel and grants nothing.
 */
function roleFrom(value: string | null): PayoutRole {
  return value === 'creator' ? 'creator' : 'founder';
}

export function StripeReturn({ event }: StripeReturnProps) {
  const [params] = useSearchParams();
  const role = roleFrom(params.get('role'));

  const [payouts, setPayouts] = useState<PayoutState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    recordReturn(role, event)
      .then((result) => {
        if (!cancelled) setPayouts(result.payouts);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure(
          error instanceof PayoutRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'We could not read your payout setup just now.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [role, event]);

  const start = useCallback(async () => {
    const link = await requestOnboardingLink(role);
    window.location.assign(link.url);
  }, [role]);

  if (failure) {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="We could not check your payout setup"
            whatHappened={failure}
            next="Nothing about your account has changed. Reload the page, or contact support if it keeps happening."
            owner="Proovd"
            nextUpdate="As soon as you tell us"
            action={NO_ACTION}
            reference="Payout setup"
            getHelp={{ href: '/support' }}
          />
        </Measure>
      </Section>
    );
  }

  if (!payouts) return <PageLoading />;

  return (
    <Section>
      <Measure>
        <h1 className="page-title">Payout setup</h1>
        {/* §13's four states, rendered by the one component both roles use. */}
        <PayoutOnboarding payouts={payouts} role={role} onStart={start} />
      </Measure>
    </Section>
  );
}
