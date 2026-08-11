/**
 * The relationship's Money — §22.1, §24.3, §24.4, §24.7, §13.
 *
 * ── Estimated is not zero ───────────────────────────────────────────────────
 * Before a campaign closes nothing has been captured, so nothing has been
 * earned — and `US$0.00` in a hero would read as "this Creator earned nothing"
 * rather than "this has not happened yet". The pane says which (§16a, §1.4).
 *
 * ── The money decisions live where they already live ────────────────────────
 * Finalizing, approving, and creating the one Transfer are §22.1's services and
 * are driven from the close queue, which owns the ordering and the §11 tax
 * gate. Building a second set of buttons here would be a second path into the
 * one Transfer per association — the exact thing its stable idempotency key
 * exists to prevent. This pane reads the record and links at the decision.
 *
 * ── Tax is stated, not inferred ─────────────────────────────────────────────
 * §24.3 keeps sales tax outside every Creator percentage. The zero on that line
 * is a fact about the base, and it is written down rather than left to be
 * deduced from a number that happens to be right.
 */

import { SALES_ARE_NOT_A_COMPLETION_REQUIREMENT } from '@proovd/shared';
import type { CreatorRelationshipDetail } from '../api.js';
import { Group, Note, Section } from '../shared.js';

/** §22.1's lifecycle, in the reference's order. */
const MONEY_CHAIN = [
  'Estimated',
  'Finalized',
  'Approved',
  'Transferred',
  'Paid out',
  'Payout failed',
  'Adjusted',
];

const CHAIN_KEYS: Record<string, string> = {
  estimated: 'Estimated',
  finalized: 'Finalized',
  approved_for_transfer: 'Approved',
  transferred: 'Transferred',
  paid_out: 'Paid out',
  payout_failed: 'Payout failed',
  adjusted: 'Adjusted',
};

export function RelMoney({ detail }: { detail: CreatorRelationshipDetail }) {
  const { money } = detail;
  const current = CHAIN_KEYS[money.headline.status] ?? null;

  return (
    <div className="cr-stack">
      <section className="cr-money-hero">
        <p className="kicker">{money.headline.label}</p>
        <h2>{money.headline.amount}</h2>
        <p>{money.headline.owner}</p>
        {!money.earnings.populated ? (
          <p className="cr-money-hero__note">
            Nothing has been captured yet, so nothing has been earned. This is not US$0.00
            earned — it is a number §22.1 has not finalized.
          </p>
        ) : null}
      </section>

      <Section eyebrow="Campaign earnings" title={money.headline.label}>
        {money.earnings.populated && money.earnings.value ? (
          <>
            <Group>
              <div className="frow">
                <dt>Attributed captured pre-tax subtotal</dt>
                <dd>{money.earnings.value.validSubtotal}</dd>
              </div>
              <div className="frow">
                <dt>Percentage compensation</dt>
                <dd>
                  {money.earnings.value.commission}
                  <p className="helper">
                    {money.earnings.value.earnedPercent}% earned of{' '}
                    {money.earnings.value.lockedPercent}% locked.
                  </p>
                </dd>
              </div>
              <div className="frow">
                <dt>Creator-specific bonus</dt>
                <dd>{money.earnings.value.bonus}</dd>
              </div>
              <div className="frow">
                <dt>Fixed Creator payment</dt>
                <dd>{money.earnings.value.fixedPayment}</dd>
              </div>
              <div className="frow">
                <dt>Tax in the earnings base</dt>
                <dd>
                  {money.earnings.value.taxInBase}
                  {/* §24.3, written down rather than deduced from a zero. */}
                  <p className="helper">
                    Sales tax is excluded from every Creator percentage, from Proovd&rsquo;s
                    5%, and from the threshold.
                  </p>
                </dd>
              </div>
              <div className="frow">
                <dt>Provisional total</dt>
                <dd>{money.earnings.value.provisionalTotal}</dd>
              </div>
              <div className="frow">
                <dt>Unearned, returned to the Founder</dt>
                <dd>
                  {money.earnings.value.unearnedReturned}
                  {/* §24.4's identity, stated where both halves are visible. */}
                  <p className="helper">
                    Earned plus returned equals the provisional total, to the cent. The
                    provisional amount is a liability and is never Proovd revenue.
                  </p>
                </dd>
              </div>
            </Group>

            <ol className="cr-chain" aria-label="Affiliate money lifecycle">
              {MONEY_CHAIN.map((state) => (
                <li
                  key={state}
                  className={state === current ? 'is-current' : undefined}
                  aria-current={state === current ? 'step' : undefined}
                >
                  {state}
                </li>
              ))}
            </ol>

            {money.earnings.value.stateHistory.length > 0 ? (
              <div className="cr-versions">
                {money.earnings.value.stateHistory.map((move, index) => (
                  <article className="cr-version" key={`${move.at}-${index}`}>
                    <span className="cr-version__main">
                      <strong>{move.to.replace(/_/g, ' ')}</strong>
                      <small>
                        {move.from ? `from ${move.from.replace(/_/g, ' ')} · ` : ''}
                        {move.at}
                      </small>
                    </span>
                    {move.reason ? (
                      <span className="cr-version__state">
                        <small>{move.reason}</small>
                      </span>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          /* §16a: not yet populated is not zero. It says what it waits on. */
          <p className="grey">{money.earnings.waitingOn}</p>
        )}
      </Section>

      <Section eyebrow="Transfer" title="The one campaign Transfer">
        {money.transfer.populated && money.transfer.value ? (
          <Group>
            <div className="frow">
              <dt>Status</dt>
              <dd>{money.transfer.value.status}</dd>
            </div>
            <div className="frow">
              <dt>Total</dt>
              <dd>
                {money.transfer.value.total}
                <p className="helper">
                  Finalized commission, earned bonus, and any eligible fixed Creator payment, combined
                  into one Transfer under a stable idempotency key.
                </p>
              </dd>
            </div>
            <div className="frow">
              <dt>Requested</dt>
              <dd>{money.transfer.value.requestedAt ?? <span className="grey">—</span>}</dd>
            </div>
            <div className="frow">
              <dt>Confirmed</dt>
              <dd>
                {money.transfer.value.confirmedAt ?? (
                  <span className="grey">Not confirmed at the provider yet</span>
                )}
              </dd>
            </div>
            {money.transfer.value.attempts > 1 ? (
              <div className="frow">
                <dt>Attempts</dt>
                <dd>
                  {money.transfer.value.attempts}
                  {/*
                    §32.3: a Transfer creation failure is a synchronous API
                    error, not a webhook. The retry runs under the SAME key, so
                    a second attempt is the same Transfer at the provider.
                  */}
                  <p className="helper">
                    A retry runs under the same idempotency key, so it is the same Transfer at
                    Stripe rather than a second one.
                  </p>
                </dd>
              </div>
            ) : null}
          </Group>
        ) : (
          <p className="grey">{money.transfer.waitingOn}</p>
        )}
        <Note>
          The Creator never requests a withdrawal. Proovd creates the one Transfer once
          earnings are approved and the §11 tax gate is satisfied.
        </Note>
      </Section>

      {money.completion ? (
        <Section eyebrow="Completion" title="The §22.1 decision">
          <Group>
            <div className="frow">
              <dt>Outcome</dt>
              <dd>{money.completion.outcome?.replace(/_/g, ' ') ?? '—'}</dd>
            </div>
            <div className="frow">
              <dt>Decided</dt>
              <dd>{money.completion.decidedAt ?? <span className="grey">—</span>}</dd>
            </div>
            <div className="frow frow--wide">
              <dt>Deliverables note</dt>
              <dd>{money.completion.deliverablesNote ?? <span className="grey">—</span>}</dd>
            </div>
          </Group>
          {/* §22.1, pinned: poor sales are not a completion failure. */}
          <Note>{SALES_ARE_NOT_A_COMPLETION_REQUIREMENT}</Note>
        </Section>
      ) : null}
    </div>
  );
}
