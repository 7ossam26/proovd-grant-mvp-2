/**
 * The Backer magic-link page — Spec §19, §20, §21, §31.8, §33.5.13, §33.7.9.
 *
 * The long-lived campaign-scoped surface a Backer reaches from their
 * confirmation email. It leads with the not-charged fact, lists each of this
 * Backer's transactions with the amounts and a status derived from real state
 * (never a predicted outcome, §31.8), and lets them cancel free before close
 * (§20). An unopenable link renders a plain recovery state — no reason, no PII,
 * no account existence (§5.5).
 *
 * ── The B.5 update-card state (Phase 18b, §33.7.9) ─────────────────────────
 * A failed off-session charge renders Appendix B.5 exactly — the body the
 * email carried, the ONE `Update card` action, the deadline — plus the
 * Stripe-hosted card field (§28.3: card data never touches this DOM). Success
 * reloads the page, where the status derivation shows `Captured` and the
 * failure block is simply gone — the stale failure is removed by the state
 * itself, not by an optimistic hide. `requires_action` renders a customer-
 * action state that names what the bank asked for, never a silent outcome
 * (§21). Every message is neutral and non-shaming, and no provider code ever
 * reaches this surface (§33.9.11).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router';
import { Button, Section, Measure } from '../../../components/index.js';
import { CommentThread } from './CommentThread.js';
import { mountCardElement, stripeConfigured, type StripeCard } from '../checkout/stripe.js';
import {
  fetchBackerPage,
  cancelReservation,
  updateCardAndRetry,
  type BackerPageData,
  type BackerTransaction,
  type UpdateCardResult,
} from './api.js';

type CreatePaymentMethod = (
  billing: Record<string, unknown>,
) => Promise<{ ok: true; paymentMethodId: string } | { ok: false; message: string }>;

type State =
  | { status: 'loading' }
  | { status: 'invalid' }
  | { status: 'error' }
  | { status: 'ready'; page: BackerPageData };

export interface BackerPageProps {
  /** Test seam — defaults to the real Stripe card field. */
  createPaymentMethodFn?: CreatePaymentMethod;
}

export function BackerPage(props: BackerPageProps = {}) {
  const { token = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    const result = await fetchBackerPage(token);
    if (result.ok) setState({ status: 'ready', page: result.page });
    else setState({ status: result.reason === 'invalid' ? 'invalid' : 'error' });
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === 'loading') {
    return (
      <Section>
        <Measure>
          <p>Opening your backer page…</p>
        </Measure>
      </Section>
    );
  }

  if (state.status === 'invalid' || state.status === 'error') {
    // §5.5: one recovery state for every failure, exposing nothing.
    return (
      <Section aria-labelledby="backer-unavailable">
        <Measure>
          <h1 className="h2" id="backer-unavailable">
            We couldn&rsquo;t open this link
          </h1>
          <p>
            This backer link can&rsquo;t be opened. If you have a newer confirmation or reminder
            email, use the link there. Otherwise email{' '}
            <a href="mailto:support@proovd.co">support@proovd.co</a> and we&rsquo;ll help — no
            payment is affected.
          </p>
        </Measure>
      </Section>
    );
  }

  const { page } = state;
  return (
    <Section aria-labelledby="backer-page">
      <Measure>
        <h1 className="h2" id="backer-page">
          {page.campaign?.campaign.title ?? 'Your pre-orders'}
        </h1>
        <p className="checkout__success-lead">{page.notChargedLead}.</p>

        {page.transactions.length === 0 ? (
          <p>You have no pre-orders on this campaign.</p>
        ) : (
          <ul className="backer__transactions">
            {page.transactions.map((t) => (
              <BackerTransactionRow
                key={t.reservationId}
                token={token}
                tx={t}
                onChange={load}
                {...(props.createPaymentMethodFn
                  ? { createPaymentMethodFn: props.createPaymentMethodFn }
                  : {})}
              />
            ))}
          </ul>
        )}

        {/* §18's general thread. It lives here rather than on the public
            campaign page because §18 lets only a magic-link-authenticated
            Backer post, and this is the only place a Backer is authenticated
            at all — a comment box on the public page would be one nobody
            could use. */}
        <CommentThread token={token} heading="Comments on this campaign" />
      </Measure>
    </Section>
  );
}

function BackerTransactionRow({
  token,
  tx,
  onChange,
  createPaymentMethodFn,
}: {
  token: string;
  tx: BackerTransaction;
  onChange: () => Promise<void>;
  createPaymentMethodFn?: CreatePaymentMethod;
}) {
  const [busy, setBusy] = useState(false);

  async function cancel() {
    setBusy(true);
    await cancelReservation(token, tx.reservationId);
    await onChange();
    setBusy(false);
  }

  return (
    <li className="backer__transaction">
      <dl className="checkout__amounts">
        <div>
          <dt>Reward</dt>
          <dd>{tx.rewardTitle}</dd>
        </div>
        <div>
          <dt>Reward subtotal</dt>
          <dd>US${tx.rewardSubtotal}</dd>
        </div>
        <div>
          <dt>Sales tax</dt>
          <dd>US${tx.salesTax}</dd>
        </div>
        <div className="checkout__amounts-total">
          <dt>Total authorized</dt>
          <dd>US${tx.totalAuthorized}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{tx.statusLabel}</dd>
        </div>
        <div>
          <dt>Charged</dt>
          <dd>{tx.chargeOccurred ? 'Yes' : 'US$0 — not charged'}</dd>
        </div>
      </dl>
      {tx.canCancel ? (
        <Button tier="secondary" onClick={cancel} disabled={busy}>
          {busy ? 'Canceling…' : 'Cancel pre-order'}
        </Button>
      ) : null}
      {tx.recovery ? (
        <RecoveryBlock
          token={token}
          tx={tx}
          onChange={onChange}
          {...(createPaymentMethodFn ? { createPaymentMethodFn } : {})}
        />
      ) : null}
    </li>
  );
}

/**
 * Appendix B.5 as a surface: the exact body, the one `Update card` action, and
 * the card field. §27.1's six questions are answered by the body itself (what
 * happened, whether money moved, the deadline) plus the support line below.
 */
function RecoveryBlock({
  token,
  tx,
  onChange,
  createPaymentMethodFn,
}: {
  token: string;
  tx: BackerTransaction;
  onChange: () => Promise<void>;
  createPaymentMethodFn?: CreatePaymentMethod;
}) {
  const recovery = tx.recovery!;
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<UpdateCardResult | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const cardHandle = useRef<StripeCard | null>(null);
  const [cardReady, setCardReady] = useState(false);

  // Card data lives in Stripe's iframe, never here (§28.3). Skipped in tests
  // that inject a payment-method function instead.
  useEffect(() => {
    if (!recovery.available || createPaymentMethodFn) return;
    let cancelled = false;
    void (async () => {
      if (!cardRef.current) return;
      const handle = await mountCardElement(cardRef.current);
      if (cancelled) return;
      cardHandle.current = handle;
      setCardReady(Boolean(handle));
    })();
    return () => {
      cancelled = true;
      cardHandle.current?.element.unmount();
    };
  }, [recovery.available, createPaymentMethodFn]);

  async function submit() {
    const createPm =
      createPaymentMethodFn ??
      (async () => {
        if (!cardHandle.current) {
          return { ok: false as const, message: 'The card field is not available yet.' };
        }
        return cardHandle.current.createPaymentMethod({});
      });

    setBusy(true);
    const pm = await createPm({});
    if (!pm.ok) {
      setBusy(false);
      setOutcome({ status: 'setup_failed', message: pm.message });
      return;
    }
    const result = await updateCardAndRetry(token, tx.reservationId, pm.paymentMethodId);
    setOutcome(result);
    if (result.status === 'captured' || result.status === 'already_captured') {
      // The reload is what removes the stale failure: the row re-derives from
      // the real state, now `captured` (§33.7.9, §31.8).
      await onChange();
    }
    setBusy(false);
  }

  if (!recovery.available) {
    return (
      <div className="backer__recovery" aria-live="polite">
        <p className="backer__recovery-body">{recovery.body}</p>
        <p className="backer__recovery-note">
          The update window ended at {recovery.deadlineUtc}, so the card can no longer be updated
          here. No money has moved. Questions: email{' '}
          <a href="mailto:support@proovd.co">support@proovd.co</a>.
        </p>
      </div>
    );
  }

  if (outcome?.status === 'requires_action') {
    // §21: the customer-action recovery state — never a silent success or a
    // silent failure. The completed confirmation arrives through the payment
    // provider, and reloading shows the derived result.
    return (
      <div className="backer__recovery" aria-live="polite">
        <p className="backer__recovery-body">{outcome.message}</p>
        <Button tier="secondary" onClick={() => void onChange()}>
          I completed the confirmation — refresh this page
        </Button>
        <p className="backer__recovery-note">
          Nothing is charged until your bank confirms. If the confirmation window did not open,
          email <a href="mailto:support@proovd.co">support@proovd.co</a> — your pre-order is
          unchanged.
        </p>
      </div>
    );
  }

  return (
    <div className="backer__recovery" aria-live="polite">
      {/* Appendix B.5, verbatim — the same block the email carried. */}
      <p className="backer__recovery-body">{recovery.body}</p>
      {!createPaymentMethodFn && !stripeConfigured() ? (
        <p className="backer__recovery-note">
          The card field is not available yet. Email{' '}
          <a href="mailto:support@proovd.co">support@proovd.co</a> and we&rsquo;ll help — no money
          has moved.
        </p>
      ) : (
        <>
          {!createPaymentMethodFn ? (
            <div ref={cardRef} className="backer__recovery-card" aria-label="Card details" />
          ) : null}
          <Button
            onClick={submit}
            disabled={busy || (!createPaymentMethodFn && !cardReady)}
          >
            {busy ? 'Updating…' : recovery.action}
          </Button>
        </>
      )}
      {outcome && outcome.status !== 'captured' && outcome.status !== 'already_captured' ? (
        <p className="backer__recovery-note" role="status">
          {outcome.message}
        </p>
      ) : null}
    </div>
  );
}
