/**
 * Screen 17 — §10's relevance signal — Founder Flow v2, Session C.
 *
 * ── It sits here because §10's first sentence puts it here ──────────────────
 * "Immediately after valid vetting and before account creation, payment, or
 * Stripe onboarding, show the number of creators who may be relevant." The
 * reference draws it at 17, after the account details and before the fee; it
 * moves EARLIER, to directly after the last answer. The reconciliation records
 * that as move 3, with the reading it refuses: putting it after the fee on the
 * grounds that Creators have by then actually accepted describes a different
 * screen — §14's roster, whose acceptances are real bilateral decisions and
 * most of which §11 forbids showing a Founder at all.
 *
 * ── Zero and unrecorded are the same screen, and that is the rule ───────────
 * §10: "For the pre-screened invited cohort, the result must not be zero; a
 * zero result routes to Admin before the Founder proceeds." So the server
 * collapses both into `with_admin` BEFORE anything is serialized — there is no
 * field in the payload that could tell them apart and no branch here that could
 * render one — and this screen shows the same waiting state for each. `basis`
 * never leaves Admin.
 *
 * ── It does not gate anything ───────────────────────────────────────────────
 * §10 orders the result before account creation and says nothing about blocking
 * one. `completeClaim` has no `creator_signal_pending` refusal, and this screen
 * offers the way forward in both states. A Founder whose result is unrecorded
 * proceeds; Admin sees the gap on their own workspace.
 *
 * ── `3 Creators`, not `3 Affiliates` ────────────────────────────────────────
 * The reference's hero is the largest type in the whole flow and it reads
 * `3 Affiliates`. §3.1 makes `affiliate` customer-facing-banned with
 * replacement **Creator**, and a Founder is a customer. The Admin *record*
 * vocabulary stays `Affiliate` — settled 2026-08-11 — because §3.1's risk is an
 * internal name reaching a customer, and this one reaches one.
 *
 * Two other things the reference draws are refused and recorded in
 * `FOUNDER_FLOW_ABSENCES`: the sub-line `In your category are ready to promote
 * this`, which claims people who have agreed to nothing are ready to promote
 * something, and the category breakdown, which no record holds.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { POSSIBLE_CREATOR_RESULT_DISCLOSURES, founderFlowPath } from '@proovd/shared';
import { Button, StatePanel } from '../../components/index.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { fetchCreatorSignal, type CreatorSignal } from '../draft/api.js';
import { FlowPage, useFlowNav } from './FlowPage.js';

export function MatchStep() {
  const { token = '' } = useParams();
  const [signal, setSignal] = useState<CreatorSignal | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCreatorSignal(token)
      .then((next) => {
        if (!cancelled) setSignal(next);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (unavailable) return <LinkUnavailable />;
  if (!signal) {
    return <SurfaceLoading subject="your Creator match" reference="Your invitation link" />;
  }

  return (
    <FlowPage pageId="match" token={token} badge>
      <Body token={token} signal={signal} />
    </FlowPage>
  );
}

function Body({ token, signal }: { token: string; signal: CreatorSignal }) {
  const { leave } = useFlowNav();

  return (
    <div className="ff-match">
      {signal.status === 'available' && signal.count !== null ? (
        <>
          {/* The reference's own exception: the lockup grows in rather than
              relaying across. `relayIn` partitions on this exact value. */}
          <h1 className="ff-match__head" data-anim="grow">
            {signal.count} {signal.count === 1 ? 'Creator' : 'Creators'}
          </h1>
          <p className="ff-match__lede" data-anim="sub">
            in your category may be a fit for what you just described.
          </p>
        </>
      ) : (
        <>
          <h1 className="ff-match__head" data-anim="head">
            We are working on your match
          </h1>
          <div data-anim="sub">
            <StatePanel
              state="Your answers are with us"
              whatHappened="You have submitted your answers and your campaign path is locked. We are still going through which Creators might be a fit."
              next="You can carry on now — nothing here holds anything up."
              owner="Proovd"
              nextUpdate="We email you when there is something to say"
              action="No action needed"
              reference="Your invitation link"
            />
          </div>
        </>
      )}

      {/*
        §10's six sentences, in full and in order. They are not summarised and
        not editable: every one is a limit on what the number means, and copy
        that implies a roster is the failure the list exists to prevent.
      */}
      <section className="ff-match__limits" data-anim="field">
        <h2>What this number is, and what it is not</h2>
        <ul className="doc-list">
          {POSSIBLE_CREATOR_RESULT_DISCLOSURES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <div className="ff-nav" data-anim="cta">
        <Button tier="tertiary" onClick={() => leave(founderFlowPath('positioning', token), -1)}>
          Back to Your positioning
        </Button>
        <Button
          tier="primary"
          onClick={() => leave(`/draft/${encodeURIComponent(token)}/claim`, 1)}
        >
          Set up your account
        </Button>
      </div>
    </div>
  );
}
