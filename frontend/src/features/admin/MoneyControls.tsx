/**
 * Admin — the §26.6 money controls.
 *
 * Nine reconciliation lines, read against the Phase 03 ledger columns. Most fill
 * in Phases 18–19; the surface exists now so those phases fill rows rather than
 * inventing views.
 *
 * ── The rule that decides how this renders ──────────────────────────────────
 * A line with no data says **not yet populated** and names what it is waiting
 * for. It does not print US$0.00. Every ledger column defaults to zero, so a
 * naïve render would say "Proovd's 5%: US$0.00" for a campaign whose close batch
 * has simply not run — indistinguishable from a campaign that captured nothing,
 * and only one of those is a fact. §1.4 forbids implying an answer the system
 * does not have.
 *
 * ── §22.3's vocabulary ──────────────────────────────────────────────────────
 * Money is `eligible`, `blocked` with the named requirement, or `released`.
 * Never `held` — Proovd does not hold anyone's money, Stripe settles to the
 * Founder's own account, and a surface that said otherwise would be describing
 * an arrangement that does not exist (§3.2).
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { formatUsd, MONEY_CONTROL_LINES } from '@proovd/shared';
import { Card, Tag } from '../../components/index.js';
import { fetchMoneyControls, AdminRequestError, type MoneyPanelState } from './api.js';

const usd = (cents: string) => formatUsd(BigInt(cents));

const AMOUNT_LABELS: Record<string, string> = {
  subtotalCents: 'Subtotal (pre-tax)',
  taxCents: 'Sales tax',
  totalCents: 'Total',
  proovdFeeCents: "Proovd's 5%",
  grossCents: 'Gross share',
  stripeFeeCents: 'Stripe fee',
  netCents: 'Net payable',
  provisionalCents: 'Provisional maximum',
  earnedCents: 'Earned',
  unearnedReturnedCents: 'Unearned, returned',
  allocatedCents: 'Allocated',
  fundedCents: 'Funded',
  objectCount: 'Provider objects',
};

export function MoneyControlsPage() {
  const [params] = useSearchParams();
  const campaignId = params.get('campaign') ?? '';
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; panel: MoneyPanelState }
  >({ status: 'idle' });

  const load = useCallback(async (id: string) => {
    if (!id) {
      setState({ status: 'idle' });
      return;
    }
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', panel: await fetchMoneyControls(id) });
    } catch (error) {
      setState({
        status: 'error',
        message:
          error instanceof AdminRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'The money controls could not be read.',
      });
    }
  }, []);

  useEffect(() => {
    void load(campaignId);
  }, [campaignId, load]);

  if (state.status === 'idle') {
    return (
      <section className="admin-workspace">
        <h1>Money controls</h1>
        <Card>
          <h2>Choose a campaign</h2>
          <p>
            Money reconciles per campaign. Add <code>?campaign=&lt;id&gt;</code> to this address, or
            open it from the ledger.
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section className="admin-workspace">
      <header className="ops-block">
        <h1>Money controls</h1>
        <p className="field-hint">
          The nine §26.6 reconciliations. Amounts are integer cents, computed once by the §24.3
          waterfall and read here — never recomputed on this screen.
        </p>
      </header>

      {state.status === 'loading' && <Card>Reading the ledger…</Card>}

      {state.status === 'error' && (
        <Card>
          <h2>Money controls could not be read</h2>
          <p>{state.message}</p>
          <p className="field-hint">Nothing was changed.</p>
        </Card>
      )}

      {state.status === 'ready' && (
        <>
          <Card>
            <div className="ops-stats">
              <div>
                <span className="ops-stat__label">Campaign status</span>
                <strong className="ops-stat__value">{state.panel.campaignStatus}</strong>
              </div>
              <div>
                <span className="ops-stat__label">Creator liability balances</span>
                <strong className="ops-stat__value">
                  {state.panel.provisionalReconciles === null
                    ? 'Nothing provisional yet'
                    : state.panel.provisionalReconciles
                      ? 'Balanced'
                      : 'Does not balance'}
                </strong>
              </div>
              <div>
                <span className="ops-stat__label">Tax excluded from fees (§24.3)</span>
                <strong className="ops-stat__value">
                  {state.panel.taxExcludedFromFees === null
                    ? 'Not yet captured'
                    : state.panel.taxExcludedFromFees
                      ? 'Confirmed'
                      : 'Mismatch — reconcile'}
                </strong>
              </div>
            </div>
          </Card>

          {state.panel.lines.map((line) => {
            const definition = MONEY_CONTROL_LINES.find((l) => l.key === line.key);
            return (
              <Card key={line.key}>
                <div className="ops-head">
                  <h2>{definition?.label ?? line.key}</h2>
                  <Tag>{definition?.specRef ?? '§26.6'}</Tag>
                </div>

                {line.populated ? (
                  <dl className="kv">
                    {Object.entries(line.amounts).map(([key, value]) => (
                      <div key={key}>
                        <dt>{AMOUNT_LABELS[key] ?? key}</dt>
                        <dd>{key === 'objectCount' ? value : usd(value)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  /* §1.4: not yet populated is not zero. The line says what it is
                     waiting for rather than printing an amount nobody computed. */
                  <div className="ops-block">
                    <p>
                      <strong>Not yet populated.</strong>
                    </p>
                    <p className="field-hint">{line.awaiting}</p>
                  </div>
                )}

                <p className="field-hint">{definition?.reconciles}</p>
              </Card>
            );
          })}
        </>
      )}
    </section>
  );
}
