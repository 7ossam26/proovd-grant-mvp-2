/**
 * Money — what has been charged, what is owed, and what is stopping it.
 *
 * ── Not yet populated is never a zero ───────────────────────────────────────
 * Every ledger column in this product defaults to 0, so a naive money panel
 * says "US$0.00" for a campaign whose close batch has not run — indistinguishable
 * from one that captured nothing. `MoneySection` carries `populated` and what it
 * is waiting on, and this pane renders the sentence rather than the number
 * (§16a's rule, which matters more here than anywhere else). There is no branch
 * in this file that turns an absent value into an amount.
 *
 * ── Proovd stores statuses, never the documents behind them ─────────────────
 * §5.3 and §13: the connected account id, the outstanding requirement names,
 * and the capability line are the whole of what is kept. There is no identity
 * document to render, no bank field, and no control that collects one — the
 * absence is what makes the claim true, and the identity row says so where an
 * Admin would otherwise go looking.
 *
 * ── Nothing here moves money ────────────────────────────────────────────────
 * The W-9 request, the payment release, and the Stripe-hosted pages all belong
 * to the surfaces that own those decisions. This pane reads. A control that
 * appeared to release a payment from a person's profile page would be the
 * §1.4 failure on the one subject where being wrong costs somebody money.
 */

import type { FounderWorkspaceDetail } from '../../api.js';
import {
  Actions,
  Block,
  Expandable,
  Group,
  Headline,
  Missing,
  Note,
  ParkedButton,
  Row,
  SecTitle,
} from '../shared.js';

interface MoneyProps {
  detail: FounderWorkspaceDetail;
}

export function Money({ detail }: MoneyProps) {
  const money = detail.money;
  const payments = money.payments;

  return (
    <>
      <SecTitle id="sec-paysetup">Payment setup</SecTitle>
      <Headline>{money.setup.value}</Headline>
      <p>{money.setup.body}</p>
      {money.setup.action ? (
        <Actions>
          <ParkedButton parkedKey="stripeHosted">{money.setup.action}</ParkedButton>
        </Actions>
      ) : null}

      <Group>
        <Row label="Identity check" helper={money.identity.helper}>
          {money.identity.value}
        </Row>
      </Group>

      {money.stripe ? (
        <Expandable label="Stripe details">
          <Group>
            <Row label="Connected account">
              <span className="mono-ellip">{money.stripe.accountId}</span>
            </Row>
            <Row label="Outstanding requirements">{money.stripe.requirements}</Row>
            <Row label="Last provider update">{money.stripe.lastUpdated ?? <Missing />}</Row>
            <Row label="Provider capability">{money.stripe.capability}</Row>
          </Group>
        </Expandable>
      ) : null}

      <SecTitle>Listing fees</SecTitle>
      {money.listings.length === 0 ? (
        <p className="grey">No listing fees yet.</p>
      ) : (
        money.listings.map((listing) => (
          <Block key={listing.campaignId}>
            <p className="camp-block__name">
              <b>{listing.campaignName}</b>
            </p>
            <dl className="money-rows">
              {listing.lines.map((line) => (
                <div
                  key={`${line.label}-${line.amount}`}
                  className={line.sub ? 'money-row money-row--sub' : 'money-row'}
                >
                  <dt>{line.label}</dt>
                  <dd>{line.amount}</dd>
                </div>
              ))}
            </dl>
            <p>
              <b>Status: {listing.status}</b>
            </p>
          </Block>
        ))
      )}

      <SecTitle>Tax form — W-9</SecTitle>
      <p>
        <b>{money.w9.value}</b>
      </p>
      <Note>{money.w9.line}</Note>
      {/*
        The W-9 request and reminder are §22.3 acts, and this workspace does not
        own them. The control still renders, because an Admin needs to know the
        next step exists — and it says it is parked rather than pretending to
        send anything (§1.4). `w9Close` names what the destination IS: the
        close-operations console that owns §22.3's W-9 work, whose screens are
        not rebuilt yet while its services are live.
      */}
      {money.w9.action ? (
        <Actions>
          <ParkedButton parkedKey="w9Close">{money.w9.action}</ParkedButton>
        </Actions>
      ) : null}

      <SecTitle>Founder payments</SecTitle>
      {!payments.populated ? (
        <p className="grey">
          {payments.waitingOn ?? 'Nothing has reached the point of being payable yet.'}
        </p>
      ) : (payments.value ?? []).length === 0 ? (
        <p className="grey">No Founder payments yet.</p>
      ) : (
        (payments.value ?? []).map((payment) => (
          <Block key={`${payment.campaignName}-${payment.label}`}>
            <p className="helper">{payment.campaignName}</p>
            <p className="camp-block__name">
              <b>{payment.amount}</b> <span className="grey">· {payment.label}</span>
            </p>
            <p>
              <b>{payment.status}</b>
            </p>
            <Note>{payment.line}</Note>
          </Block>
        ))
      )}

      <SecTitle>Payment blockers</SecTitle>
      {money.blockers.length === 0 ? (
        <p className="grey">
          <b>Nothing is blocked.</b>
        </p>
      ) : (
        money.blockers.map((blocker) => (
          <div className="att-box" key={`${blocker.reason}-${blocker.state}`}>
            <p>
              <b>
                {blocker.amount ? `${blocker.amount} ` : ''}
                {blocker.state}
              </b>
            </p>
            <Group>
              <Row label="Reason">{blocker.reason}</Row>
              <Row label="Owner">{blocker.owner}</Row>
              <Row label="Action">{blocker.action}</Row>
              {blocker.nextReview ? (
                <Row label="Next review">{blocker.nextReview}</Row>
              ) : null}
            </Group>
          </div>
        ))
      )}

      {money.pricing ? (
        <>
          <SecTitle>Creator pricing eligibility</SecTitle>
          <p>
            <b>{money.pricing.value}</b>
          </p>
          {money.pricing.reasons ? (
            <ul className="plain-list">
              {money.pricing.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          {money.pricing.note ? <Note>{money.pricing.note}</Note> : null}
        </>
      ) : null}
    </>
  );
}
