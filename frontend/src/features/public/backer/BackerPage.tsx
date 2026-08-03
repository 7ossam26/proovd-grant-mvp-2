/**
 * The Backer magic-link page — Spec §19, §20, §31.8, §33.5.13.
 *
 * The long-lived campaign-scoped surface a Backer reaches from their
 * confirmation email. It leads with the not-charged fact, lists each of this
 * Backer's transactions with the amounts and a status derived from real state
 * (never a predicted outcome, §31.8), and lets them cancel free before close
 * (§20). An unopenable link renders a plain recovery state — no reason, no PII,
 * no account existence (§5.5).
 *
 * Card entry / reward change for the Idea flow reuse the checkout's Stripe field;
 * this surface exposes the read + cancel actions, which need no card.
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router';
import { Button, Section, Measure } from '../../../components/index.js';
import {
  fetchBackerPage,
  cancelReservation,
  type BackerPageData,
  type BackerTransaction,
} from './api.js';

type State =
  | { status: 'loading' }
  | { status: 'invalid' }
  | { status: 'error' }
  | { status: 'ready'; page: BackerPageData };

export function BackerPage() {
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
              <BackerTransactionRow key={t.reservationId} token={token} tx={t} onChange={load} />
            ))}
          </ul>
        )}
      </Measure>
    </Section>
  );
}

function BackerTransactionRow({
  token,
  tx,
  onChange,
}: {
  token: string;
  tx: BackerTransaction;
  onChange: () => Promise<void>;
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
    </li>
  );
}
