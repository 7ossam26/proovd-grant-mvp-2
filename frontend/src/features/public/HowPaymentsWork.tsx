/**
 * `/how-payments-work` — Spec §18 (public route inventory and homepage trust
 * content), §2.1, §3.2, §3.3, §24.
 *
 * §2.1 governs every sentence here: the Founder is the seller and merchant of
 * record, Proovd is merchant of record only for the listing fee, campaign
 * payments run on Stripe Connect under the configuration actually confirmed for
 * the account, and money is never described as escrowed, held in trust, held in
 * custody, or held in a Proovd account. §3.2 governs the vocabulary — a Backer
 * reserves a pre-order, an Idea Campaign has an order threshold, and a charge is
 * conditional on that threshold.
 *
 * The Stripe approval status is stated the same way here as in the trust strip:
 * outstanding, in the future tense, with the consequence spelled out. §2.1 —
 * "no UI may claim approval before it exists" — is not limited to the homepage.
 */

import { Link as RouterLink } from 'react-router';
import { Accordion, Measure, Mode, Section } from '../../components/index.js';
import { STRIPE_CONNECTED_ACCOUNT_AGREEMENT, SUPPORT_EMAIL } from './site.js';

export function HowPaymentsWork() {
  return (
    <>
      <Section breathe>
        <Measure>
          <p className="kicker">How payments work</p>
          <h1>Your card is saved now and charged later, under one rule the campaign tells you first.</h1>
          <p className="lede">
            Every campaign on Proovd states, before you agree to anything, the
            exact amount, the exact trigger, and the exact date. Nothing on this
            page is a general description of crowdfunding — it is what this
            platform does.
          </p>
        </Measure>
      </Section>

      <Section>
        <Measure>
          <h2 className="h2">Who you are buying from</h2>
          <p>
            The founder running the campaign is the seller and the merchant of
            record for every transaction on it. They own the product, the
            delivery, the product support, the taxes, and the refunds. Proovd LLC
            is the software platform the campaign runs on. Proovd is not a
            reseller, and does not take title to anything sold on a campaign.
          </p>
          <p>
            There is one exception, and it does not involve you: Proovd is the
            merchant of record for the separate listing fee a founder pays us
            before their campaign goes live. That charge is between the founder
            and Proovd.
          </p>

          <h2 className="h2">What happens, in order</h2>
          <ol className="steps">
            <li>
              <h3>You choose one reward package.</h3>
              <p>
                Reward prices are shown before sales tax. Sales tax is
                calculated at checkout for your billing address and added on
                top.
              </p>
            </li>
            <li>
              <h3>You see the exact total before you agree.</h3>
              <p>
                Reward subtotal, sales tax, and the total you are authorizing
                are shown separately, along with the campaign&rsquo;s charge
                trigger, the close date in your local time with UTC alongside,
                the delivery month or window, and the statement descriptor to
                expect.
              </p>
            </li>
            <li>
              <h3>Your card is saved. It is not charged today.</h3>
              <p>
                Card details go straight to Stripe; they never reach a Proovd
                server. What you are authorizing is a single future charge for
                exactly the total shown to you.
              </p>
            </li>
            <li>
              <h3>The charge happens only if the disclosed trigger is met.</h3>
              <p>
                On an Idea Campaign, that is the order threshold being met at the
                close date. On a Product Campaign, it is the close date itself.
                If an Idea Campaign does not reach its threshold, no charge is
                created at all and your saved card loses future-charge
                eligibility for that campaign.
              </p>
            </li>
            <li>
              <h3>You can cancel free until the close date.</h3>
              <p>
                Every confirmation email contains a link to your Backer page.
                Cancelling before the close date costs nothing and stops any
                future charge.
              </p>
            </li>
          </ol>
        </Measure>
      </Section>

      <Mode kind="light">
        <Section>
          <Measure>
            <h2 className="h2">Where Stripe fits</h2>
            <p>
              Campaign charges are processed by Stripe through Stripe Connect, in
              the account context approved for the campaign, with the founder as
              the merchant of record. Proovd does not process card details
              itself.
            </p>
            <p>
              Proovd does not yet have the Stripe Connect production
              configuration this platform requires. Until that approval is in
              place, no campaign on Proovd collects live card details and no
              campaign charge is processed. Founders who take payments
              through Stripe Connect are also bound by the{' '}
              <a
                href={STRIPE_CONNECTED_ACCOUNT_AGREEMENT}
                target="_blank"
                rel="noopener noreferrer"
              >
                Stripe Connected Account Agreement
                <span className="pv-sr"> (opens in a new tab)</span>
              </a>
              .
            </p>
          </Measure>
        </Section>
      </Mode>

      <Section>
        <Measure>
          <h2 className="h2">What Proovd charges, and to whom</h2>
          <Accordion
            defaultValue="platform-fee"
            items={[
              {
                value: 'platform-fee',
                head: 'The 5% campaign fee — paid by the founder',
                body: (
                  <>
                    <p>
                      Proovd takes 5% of the reward subtotal on each successful
                      campaign charge. Sales tax is excluded from that
                      calculation. It comes out of what the founder receives; it
                      is not added to what you pay.
                    </p>
                  </>
                ),
              },
              {
                value: 'listing-fee',
                head: 'The listing fee — paid by the founder, before launch',
                body: (
                  <>
                    <p>
                      A founder pays Proovd a one-time listing fee to publish a
                      campaign. It is a separate transaction with Proovd as the
                      merchant of record, and it shows on a founder&rsquo;s
                      statement as <strong>PROOVD LISTING</strong>. It is refunded
                      in the cases set out in the{' '}
                      <RouterLink to="/refunds">Refund Policy</RouterLink>.
                    </p>
                  </>
                ),
              },
              {
                value: 'creators',
                head: 'Creator compensation — agreed per campaign',
                body: (
                  <>
                    <p>
                      Creators are hand-recruited for one campaign and their
                      compensation is locked in writing before they start. It is
                      calculated from the reward subtotal of the pre-orders they
                      are validly attributed with — again excluding sales tax —
                      and it comes out of the campaign, not out of your price.
                    </p>
                    <p>
                      A Creator earns only after a charge succeeds and the work
                      is verified. Nothing about a Creator link changes what you
                      pay.
                    </p>
                  </>
                ),
              },
              {
                value: 'stripe-fees',
                head: 'Stripe processing fees',
                body: (
                  <p>
                    Stripe&rsquo;s processing fees are borne by the founder&rsquo;s
                    connected account and are shown separately in their
                    reconciliation. They are never folded into sales tax or into
                    Creator compensation.
                  </p>
                ),
              },
            ]}
          />
        </Measure>
      </Section>

      <Mode kind="dark">
        <Section>
          <Measure>
            <h2 className="h2">If something goes wrong</h2>
            <p>
              <strong>Your card is declined at close.</strong> You are emailed a
              plain-language outcome, whether any money moved, the amounts, and a
              retry deadline in your local time with UTC alongside — plus one
              action: update the card from your Backer page. If the deadline
              passes, the pre-order is dropped and you are not charged.
            </p>
            <p>
              <strong>You do not recognise a charge.</strong> Check the statement
              descriptor against your confirmation email, then email{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. A person
              replies within one business day.
            </p>
            <p>
              <strong>The reward is late, or not what was described.</strong>{' '}
              Product questions go to the founder through Proovd support, and we
              follow up if you have not heard back within 48 hours. What you are
              entitled to is in the{' '}
              <RouterLink to="/refunds">Refund Policy</RouterLink> and the{' '}
              <RouterLink to="/fulfillment">Fulfillment Policy</RouterLink>.
            </p>
          </Measure>
        </Section>
      </Mode>
    </>
  );
}
