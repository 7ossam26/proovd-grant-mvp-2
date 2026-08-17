/**
 * The Performance & Earnings tab — Performance · Earnings · Transfers &
 * Payouts · Adjustments. Spec §18, §22.1, §24.3, §24.4, §24.7, §24.8, §13.
 * Session C of the Affiliate rebuild.
 *
 * Absorbs the old RelMoney pane and RelContent's performance strip. The money
 * DECISIONS stay where they live: the reference's "Create Affiliate Transfer"
 * and its free-form "Adjust Affiliate earnings" render the refusal sentences
 * from `AFFILIATE_OPERATIONS_ABSENCES` where the controls would have been —
 * the one Transfer is the close queue's, and every adjustment is a §24.8
 * cause-classified case. What IS operable here reads a fact the provider owns
 * (the Stripe re-read) or sends the message §27 already defines (gap 3).
 */

import { useState } from 'react';
import {
  ATTRIBUTION_FOOTNOTE,
  SALES_ARE_NOT_A_COMPLETION_REQUIREMENT,
  affiliateOperationsAbsence,
} from '@proovd/shared';
import { Button } from '../../../../components/index.js';
import { useToast } from '../../../../motion/MotionProvider.js';
import {
  refreshStripeStatus,
  sendCreatorPayoutReminder,
  AdminRequestError,
  type CreatorRelationshipDetail,
  type CreatorWorkspaceDetail,
} from '../api.js';
import { Group, Note, Section } from '../shared.js';
import { ConfirmDialog } from '../../founders/dialogs/ConfirmDialog.js';

const MONEY_CHAIN = [
  'Estimated',
  'Finalized',
  'Approved',
  'Transferred',
  'Paid out',
  'Payout failed',
  'Adjusted',
] as const;

const CHAIN_KEYS: Record<string, string> = {
  estimated: 'Estimated',
  finalized: 'Finalized',
  approved_for_transfer: 'Approved',
  transferred: 'Transferred',
  paid_out: 'Paid out',
  payout_failed: 'Payout failed',
  adjusted: 'Adjusted',
};

export interface PerformanceSectionProps {
  sectionKey: string;
  detail: CreatorWorkspaceDetail;
  rel: CreatorRelationshipDetail;
  onDone: (next: CreatorWorkspaceDetail) => void;
}

export function PerformanceTabSection(props: PerformanceSectionProps) {
  switch (props.sectionKey) {
    case 'performance':
      return <PerformanceSection {...props} />;
    case 'earnings':
      return <EarningsSection {...props} />;
    case 'transfers':
      return <TransfersSection {...props} />;
    case 'adjustments':
      return <AdjustmentsSection {...props} />;
    default:
      return null;
  }
}

/* ── Performance — §18's traffic, and the attribution boundary ──────────────*/

function PerformanceSection({ rel }: PerformanceSectionProps) {
  const performance = rel.content.performance;

  return (
    <div className="cr-stack">
      <Section eyebrow="Traffic" title="Attributed performance">
        {performance.populated && performance.value ? (
          <>
            <div className="cr-metrics">
              <div>
                <span>Clicks</span>
                <strong>{performance.value.clicks}</strong>
              </div>
              <div>
                <span>Attributed pre-orders</span>
                <strong>{performance.value.attributedReservations}</strong>
              </div>
              <div>
                <span>Captured attributed Backers</span>
                <strong>{performance.value.capturedAttributed}</strong>
              </div>
              <div>
                <span>Conversion</span>
                <strong>{performance.value.conversion ?? '—'}</strong>
              </div>
              <div>
                <span>Attributed captured pre-tax subtotal</span>
                <strong>{performance.value.capturedSubtotal}</strong>
              </div>
              <div>
                <span>Freshness</span>
                <strong>{performance.value.freshness}</strong>
              </div>
            </div>
            <Note>{ATTRIBUTION_FOOTNOTE}</Note>
          </>
        ) : (
          <p className="grey">{performance.waitingOn}</p>
        )}
      </Section>

      <Section eyebrow="Attribution boundary" title="Active link forward only">
        <p>
          Pre-activation traffic and mid-campaign prior traffic are never retroactively
          attributed. Organic and Proovd-house traffic remain separate.
        </p>
      </Section>
    </div>
  );
}

/* ── Earnings — the RelMoney earnings grid, absorbed ────────────────────────*/

function EarningsSection({ rel }: PerformanceSectionProps) {
  const { money } = rel;
  const isProduct = rel.band.campaignType === 'Product Campaign';

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
                  <p className="helper">
                    Sales tax is excluded from every Creator percentage, from Proovd&rsquo;s 5%,
                    and from the threshold.
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
                  <p className="helper">
                    Earned plus returned equals the provisional total, to the cent. The
                    provisional amount is a liability and is never Proovd revenue.
                  </p>
                </dd>
              </div>
            </Group>
          </>
        ) : (
          <p className="grey">{money.earnings.waitingOn}</p>
        )}
        {/* The type-conditional base-rate sentence — the §14.3 matrix's rule. */}
        {isProduct ? (
          <Note>
            Product Campaign: 30% base without an accepted fixed Creator payment; 20% base
            when one is accepted. The combined percentage never exceeds 50%.
          </Note>
        ) : (
          <Note>
            Idea Campaign: 30% base; a percentage bid appears only when high-effort is
            locked, and a fixed Creator payment does not exist on this campaign type.
          </Note>
        )}
      </Section>
    </div>
  );
}

/* ── Transfers & Payouts — the chain, the provider strip, gaps 3 and 4 ──────*/

function TransfersSection({ detail, rel, onDone }: PerformanceSectionProps) {
  const toast = useToast();
  const [reminderTrigger, setReminderTrigger] = useState<HTMLElement | null>(null);
  const { money } = rel;
  const current = CHAIN_KEYS[money.headline.status] ?? null;
  const createTransfer = affiliateOperationsAbsence('createTransfer');
  const provider = detail.profile.provider;
  const payoutBlocked = detail.header.payout.state === 'requirements_due';

  return (
    <div className="cr-stack">
      <Section eyebrow="Money lifecycle" title="Transfer is not payout">
        <ol className="cr-chain" aria-label="Affiliate money lifecycle">
          {MONEY_CHAIN.map((state) => (
            <li
              key={state}
              className={state === current ? 'is-current' : undefined}
              {...(state === current ? { 'aria-current': 'step' as const } : {})}
            >
              {state}
            </li>
          ))}
        </ol>
        <Note>
          Each state shows whether money moved, the amount, the reason, the current owner,
          and the next action. Proovd never describes this as a balance held anywhere.
        </Note>
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
                  Finalized commission, earned bonus, and any eligible fixed Creator payment,
                  combined into one Transfer under a stable idempotency key.
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
        {/* The reference's "Create Affiliate Transfer" — refused (§1.8). */}
        <Note>{createTransfer.sentence}</Note>
      </Section>

      <Section
        eyebrow="Stripe supplied · read only"
        title={provider.label}
        actions={
          <>
            <Button
              tier="secondary"
              small
              onClick={async () => {
                try {
                  onDone(await refreshStripeStatus(detail.header.prospectId));
                  toast('Stripe status re-read', {
                    sub: 'The block now shows what the provider reported just now.',
                  });
                } catch (error) {
                  toast('The Stripe status could not be re-read', {
                    sub:
                      error instanceof AdminRequestError
                        ? (error.detail.whatHappened ?? undefined)
                        : undefined,
                  });
                }
              }}
            >
              Refresh Stripe status
            </Button>
            {payoutBlocked ? (
              <Button small onClick={(event) => setReminderTrigger(event.currentTarget)}>
                Send payout reminder
              </Button>
            ) : null}
          </>
        }
      >
        <Group>
          <div className="frow">
            <dt>Payout state</dt>
            <dd>{detail.header.payout.label}</dd>
          </div>
          <div className="frow">
            <dt>Transfer capability</dt>
            <dd>{provider.transferCapability}</dd>
          </div>
          <div className="frow">
            <dt>Requirements</dt>
            <dd>{provider.requirementsLabel}</dd>
          </div>
        </Group>
        <Note>Provider identity and bank facts cannot be edited in Proovd.</Note>
      </Section>

      {reminderTrigger ? (
        <PayoutReminderDialog
          detail={detail}
          trigger={reminderTrigger}
          onClose={() => setReminderTrigger(null)}
          onDone={(next) => {
            onDone(next);
            setReminderTrigger(null);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Gap 3 — the real send, shared with the Overview attention control. One
 * dialog, one route, one §27 key; the outcome rides beside the re-read so a
 * recorded-but-not-sent ask is a state the Admin sees, never infers (§1.4).
 */
export function PayoutReminderDialog({
  detail,
  trigger,
  onClose,
  onDone,
}: {
  detail: CreatorWorkspaceDetail;
  trigger: HTMLElement | null;
  onClose: () => void;
  onDone: (next: CreatorWorkspaceDetail) => void;
}) {
  const toast = useToast();
  return (
    <ConfirmDialog
      trigger={trigger}
      spec={{
        kicker: `${detail.header.name} · §13, §27.4`,
        title: 'Send payout reminder',
        body:
          'Sends the message §27 already defines for an outstanding Stripe requirement — ' +
          'the same notice the state change sends, naming what Stripe still needs. The ask ' +
          'is recorded first, and a deliberate second ask is a second message.',
        fields: [],
        primary: 'Send the reminder',
        secondary: 'Cancel',
      }}
      onClose={onClose}
      onSubmit={async () => {
        try {
          const { detail: next, ask } = await sendCreatorPayoutReminder(detail.header.prospectId);
          toast(
            ask.sent ? 'Payout reminder sent' : 'Recorded — nothing was sent',
            ask.reason ? { sub: ask.reason } : undefined,
          );
          onDone(next);
        } catch (error) {
          throw error instanceof AdminRequestError
            ? new Error(error.detail.whatHappened ?? error.detail.title)
            : error;
        }
      }}
    />
  );
}

/* ── Adjustments — §24.8's records, read-only, with the refusals ────────────*/

function AdjustmentsSection({ rel }: PerformanceSectionProps) {
  const adjustEarnings = affiliateOperationsAbsence('adjustEarnings');
  const fixedOutcome = affiliateOperationsAbsence('fixedOutcome');
  const { money } = rel;
  const isProductWithFixed =
    rel.band.campaignType === 'Product Campaign' &&
    rel.agreement.fixedPayment.status !== 'Not requested' &&
    rel.agreement.fixedPayment.status !== 'Not available';

  return (
    <div className="cr-stack">
      <Section eyebrow="Cause-based correction" title="Adjustments &amp; recovery">
        <Group>
          <div className="frow">
            <dt>Current earnings state</dt>
            <dd>{money.headline.label}</dd>
          </div>
          <div className="frow">
            <dt>Recovery eligibility</dt>
            <dd>Only Affiliate-caused invalidity</dd>
          </div>
          <div className="frow">
            <dt>Original ledger</dt>
            <dd>Preserved</dd>
          </div>
          <div className="frow">
            <dt>Admin requirement</dt>
            <dd>Reason, evidence, prior/new value</dd>
          </div>
        </Group>
        {money.earnings.populated && money.earnings.value ? (
          money.earnings.value.stateHistory.length > 0 ? (
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
          ) : (
            <p className="grey">No earnings state change has been recorded yet.</p>
          )
        ) : (
          <p className="grey">{money.earnings.waitingOn}</p>
        )}
        {/* The reference's free-form "Review or adjust earnings" — refused. */}
        <Note>{adjustEarnings.sentence}</Note>
      </Section>

      {isProductWithFixed ? (
        <Section eyebrow="Fixed Creator payment" title={rel.agreement.fixedPayment.status}>
          {/* The reference's "Decide fixed Creator payment outcome" — refused. */}
          <Note>{fixedOutcome.sentence}</Note>
          <Note>{SALES_ARE_NOT_A_COMPLETION_REQUIREMENT}</Note>
        </Section>
      ) : null}
    </div>
  );
}
