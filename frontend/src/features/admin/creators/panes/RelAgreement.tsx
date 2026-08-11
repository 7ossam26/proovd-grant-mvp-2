/**
 * The relationship's Agreement — §14.2, §14.3, §24.7.
 *
 * ── Admin observes; Admin never agrees ──────────────────────────────────────
 * §14.2 makes acceptance bilateral, and the reference states the consequence as
 * a sentence on this pane. There is deliberately no accept control here: the
 * only Admin action §14.2 permits is rejecting a version that violates policy,
 * and that route lives with the decisions router. A pane that could accept
 * would make "the exact version both parties accepted" untrue.
 *
 * ── "Fixed Creator payment", and the state chain that says funded is not paid ─────────
 * §24.7's stream is its own money, with no percentage applied to it. The chain
 * is rendered because an Admin reading `Funded` reasonably assumes the Creator
 * has been paid, and the pinned sentence beneath it says otherwise.
 *
 * ── Every version is preserved ──────────────────────────────────────────────
 * §14.2 makes a proposal version immutable and a revision a NEW version. The
 * list is the record, oldest first, with each side's decision beside it.
 */

import {
  ADMIN_CANNOT_ACCEPT,
  FIXED_PAYMENT_FUNDED_IS_NOT_PAID,
  FIXED_CREATOR_PAYMENT_LABEL,
} from '@proovd/shared';
import { Button } from '../../../../components/index.js';
import type { CreatorRelationshipDetail } from '../api.js';
import { Group, Note, Section } from '../shared.js';
import type { RelationshipOp } from '../dialogs/RelationshipOpsDialog.js';

/** §24.7's own state chain, in the reference's order. */
const FIXED_PAYMENT_CHAIN = [
  'Not requested',
  'Awaiting agreement',
  'Payment pending',
  'Funded',
  'Payment failed',
  'Returned',
  'Paid',
];

export function RelAgreement({
  detail,
  onOp,
}: {
  detail: CreatorRelationshipDetail;
  onOp: (
    op: RelationshipOp,
    versionId: string | undefined,
    trigger: HTMLElement | null,
  ) => void;
}) {
  const { agreement } = detail;

  return (
    <div className="cr-stack">
      <section className="cr-terms">
        <p className="kicker">{agreement.lockState}</p>
        <h2>
          {agreement.headlinePercent ? (
            <>
              <b>{agreement.headlinePercent}</b>
              <span>{agreement.headlineRest}</span>
            </>
          ) : (
            <span>{agreement.headlineRest}</span>
          )}
        </h2>
        {agreement.bonus ? <p className="cr-terms__bonus">{agreement.bonus}</p> : null}
      </section>

      {agreement.agreement ? (
        <Section eyebrow="Locked terms" title="What both parties accepted">
          <Group>
            <div className="frow">
              <dt>Base</dt>
              <dd>{agreement.agreement.basePercent}%</dd>
            </div>
            <div className="frow">
              <dt>Bid increase</dt>
              <dd>{agreement.agreement.bidIncreasePercent}%</dd>
            </div>
            <div className="frow">
              <dt>Total</dt>
              <dd>
                {agreement.agreement.totalPercent}%
                {/* §14.3's ceiling, stated where the number is read. */}
                <p className="helper">
                  Base, bid, and any Creator-specific bonus together never exceed 50% of the
                  attributed captured pre-tax reward subtotal.
                </p>
              </dd>
            </div>
            <div className="frow">
              <dt>Accepted</dt>
              <dd>
                {agreement.agreement.acceptedAt ?? (
                  <span className="grey">Not recorded</span>
                )}
              </dd>
            </div>
          </Group>
        </Section>
      ) : null}

      {/* ── §24.7's fixed Creator payment ───────────────────────────────────────────── */}
      <Section
        eyebrow={FIXED_CREATOR_PAYMENT_LABEL}
        title={agreement.fixedPayment.status}
        aside={
          agreement.fixedPayment.amount ? (
            <span className="cr-count">{agreement.fixedPayment.amount}</span>
          ) : null
        }
      >
        <Group>
          <div className="frow">
            <dt>Rule</dt>
            <dd>{agreement.fixedPayment.rule}</dd>
          </div>
          <div className="frow">
            <dt>Source</dt>
            <dd>{agreement.fixedPayment.source}</dd>
          </div>
          <div className="frow">
            <dt>Funded</dt>
            <dd>
              {agreement.fixedPayment.fundedAt ?? <span className="grey">Not funded</span>}
            </dd>
          </div>
          <div className="frow">
            <dt>Funding deadline</dt>
            <dd>
              {agreement.fixedPayment.deadlineAt ?? (
                <span className="grey">No deadline set</span>
              )}
            </dd>
          </div>
        </Group>

        {agreement.fixedPayment.available ? (
          <>
            <ol className="cr-chain" aria-label="Fixed Creator payment states">
              {FIXED_PAYMENT_CHAIN.map((state) => (
                <li
                  key={state}
                  className={state === agreement.fixedPayment.status ? 'is-current' : undefined}
                  aria-current={state === agreement.fixedPayment.status ? 'step' : undefined}
                >
                  {state}
                </li>
              ))}
            </ol>
            {/* The one sentence this pane must never be without. */}
            <Note>{FIXED_PAYMENT_FUNDED_IS_NOT_PAID}</Note>
            <Note>
              No percentage applies to this amount, and it does not affect the Backer total,
              the tax, Proovd&rsquo;s 5%, the threshold, the cap, or the percentage base.
            </Note>
          </>
        ) : null}
      </Section>

      {/* ── The immutable record ──────────────────────────────────────────── */}
      <Section
        eyebrow="Commercial record"
        title={
          agreement.versions.length === 1
            ? '1 proposal version'
            : `${agreement.versions.length} proposal versions`
        }
      >
        {agreement.versions.length === 0 ? (
          <p className="grey">
            No proposal has been made. Standard terms are accepted without one (§14.2).
          </p>
        ) : (
          <div className="cr-versions">
            {agreement.versions.map((version) => (
              <article className="cr-version" key={version.id}>
                <span className="cr-version__no">v{version.number}</span>
                <span className="cr-version__main">
                  <strong>
                    {version.totalPercent === null
                      ? 'No percentage proposed'
                      : `${version.totalPercent}%`}
                    {version.fixedPaymentCents ? ` · ${version.fixedPaymentCents} fixed Creator payment` : ''}
                  </strong>
                  <small>
                    Proposed by the {version.proposedBy}
                    {version.createdAt ? ` · ${version.createdAt}` : ''}
                  </small>
                </span>
                <span className="cr-version__state">
                  <strong>{version.state.replace(/_/g, ' ')}</strong>
                  <small>
                    Creator {version.affiliateDecision ?? 'no answer'} · Founder{' '}
                    {version.founderDecision ?? 'no answer'}
                  </small>
                  {/*
                    §14.2's only Admin move, offered only while the version is
                    genuinely open. There is deliberately no accept control:
                    the locked agreement is the exact version both parties
                    accepted, and a third party accepting would make that false.
                  */}
                  {version.state === 'awaiting_founder' ||
                  version.state === 'awaiting_creator' ? (
                    <Button
                      tier="tertiary"
                      small
                      onClick={(event) =>
                        onOp('reject_version', version.id, event.currentTarget)
                      }
                    >
                      Reject for policy
                    </Button>
                  ) : null}
                </span>
              </article>
            ))}
          </div>
        )}
        <Note>
          Every version is preserved exactly as it was proposed. A revision is a new version,
          and only the exact version both parties accepted becomes the locked agreement.
        </Note>
        {/* §14.2, pinned. Admin may observe, mediate, and reject a policy
            violation — and cannot substitute for bilateral acceptance. */}
        <Note>{ADMIN_CANNOT_ACCEPT}</Note>
      </Section>
    </div>
  );
}
