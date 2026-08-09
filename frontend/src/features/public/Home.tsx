/**
 * The platform home — Spec §18's homepage trust content, plus Appendix A.1.
 *
 * §18 fixes what this page must communicate, and every item has a home here:
 * vetted-Founder crowdfunding software (hero), both campaign models (Two ways
 * to run a campaign), manual Founder/campaign/Creator review (What we check),
 * the digital-only launch scope (What we check), cards saved now and charged
 * only under the disclosed trigger (What happens to your card), Founder as
 * seller and merchant of record (both of those), Stripe Connect under the
 * actual approved configuration (trust strip, conditional — see
 * `trust-strip.ts`), role-based calls to action for Founders and Creators, and
 * support and policy links (footer).
 *
 * Language is the §3.2 replacement table throughout: an Idea Campaign has an
 * order threshold, never a goal; a charge is conditional on that threshold,
 * never all-or-nothing; a Backer reserves a pre-order, never pledges; and
 * money is never described as held anywhere.
 */

import { Link as RouterLink } from 'react-router';
import { Button, Card, Mode, Measure, Reveal, Section, Tag } from '../../components/index.js';
import { TrustStrip } from './TrustStrip.js';
import { supportMailto } from './states.js';

export function Home() {
  return (
    <>
      <Section breathe>
        <Reveal kind="headline" as="h1" className="hero">
          Prove people want it before you build it.
        </Reveal>
        <Measure>
          <p className="lede">
            Proovd is crowdfunding software for vetted founders. Founders apply
            through Proovd onboarding and are reviewed by a person before a
            campaign goes live. Backers reserve a pre-order and save a card;
            the card is charged later, only under the rule the campaign
            discloses up front.
          </p>
          <div className="cta-row">
            <Button tier="primary" href="/campaign/sample-pre-build">
              See a sample campaign
            </Button>
            <Button tier="secondary" href="/how-payments-work">
              Read how payments work
            </Button>
          </div>
        </Measure>
      </Section>

      <Mode kind="light">
        <Section>
          <h2 className="h2">Two ways to run a campaign</h2>
          <div className="cols">
            <Card>
              <Tag variant="live">Idea Campaign</Tag>
              <h3>Validate the idea first</h3>
              <p>
                The founder publishes an order threshold: the number of unique
                Backers with active pre-orders needed by the close date. If the
                campaign reaches it, saved cards are charged. If it does not,
                no card is charged at all — the charge is conditional on the
                order threshold, and the threshold is published on the page from
                the first day.
              </p>
              <p>
                Every reward package states a delivery window, and the campaign
                says plainly that the product is early and may be delayed.
              </p>
            </Card>
            <Card>
              <Tag variant="live">Product Campaign</Tag>
              <h3>A founding-member launch</h3>
              <p>
                For a live or near-launch product. There is no threshold: every
                active pre-order is charged on the disclosed close date. Each
                reward package states the delivery month and year the founder
                has committed to.
              </p>
              <p>
                Backers can cancel free at any time before the close date, from
                the link in their confirmation email.
              </p>
            </Card>
          </div>
        </Section>
      </Mode>

      <Section>
        <h2 className="h2">What happens to your card</h2>
        <ol className="steps">
          <li>
            <h3>You save a card. Nothing is charged today.</h3>
            <p>
              You choose one reward package, confirm you are 18 or over and
              billing from the United States, and authorize a single future
              charge for an exact amount shown to you before you agree —
              reward subtotal, sales tax, and total, stated separately.
            </p>
          </li>
          <li>
            <h3>The charge happens only at the disclosed trigger.</h3>
            <p>
              An Idea Campaign charges only if it meets its order threshold at
              the close date. A Product Campaign charges on the close date. If
              the trigger is not met, no charge is made and the saved card loses
              future-charge eligibility for that campaign.
            </p>
          </li>
          <li>
            <h3>The founder is the seller, and the merchant of record.</h3>
            <p>
              Every campaign transaction is a purchase from the founder, not
              from Proovd. The founder is responsible for the reward, delivery,
              product support, and refunds. Proovd is the software platform the
              campaign runs on, and the merchant of record only for the separate
              listing fee a founder pays us. Charges are processed through
              Stripe Connect in the approved account context.
            </p>
          </li>
        </ol>
        <Measure>
          <p>
            <RouterLink to="/how-payments-work">
              How payments work, in full
            </RouterLink>
          </p>
        </Measure>
      </Section>

      <Mode kind="dark">
        <Section>
          <h2 className="h2">What we check before a campaign goes live</h2>
          <ul className="checks">
            <li>
              <strong>The founder.</strong> Founders join by invitation and are
              reviewed by a person — identity, product, and claims — before an
              account is issued.
            </li>
            <li>
              <strong>The campaign.</strong> A member of our team reads every
              campaign page, every reward package, and every delivery date
              before it can be published.
            </li>
            <li>
              <strong>Every Creator.</strong> Creators are hand-recruited for
              one specific campaign and verified before they are given a link.
            </li>
            <li>
              <strong>The category.</strong> Rewards are digital only at launch.
              Physical goods and mixed digital-and-physical rewards are rejected,
              and our Acceptable Use Policy mirrors Stripe&rsquo;s Prohibited and
              Restricted Businesses list.
            </li>
            <li>
              <strong>Who can take part.</strong> Founders, Creators, and Backers
              are in the United States and 18 or over. Prices are in US dollars.
            </li>
          </ul>
          <p>
            <RouterLink to="/safety">Read our full safety controls</RouterLink>
          </p>
        </Section>
      </Mode>

      <Section>
        <h2 className="h2">Which one are you?</h2>
        <div className="cols">
          <Card white>
            <h3>You have a product to prove</h3>
            <p>
              Founders come to Proovd by invitation, one campaign at a time. If
              you want to be considered, tell us what you are building and who
              it is for — a person reads it and replies within one business day.
            </p>
            <Button tier="primary" href={supportMailto('Founder invitation enquiry')}>
              Ask for a Founder invitation
            </Button>
          </Card>
          <Card white>
            <h3>You have an audience</h3>
            <p>
              Creators are invited to a specific campaign, with the compensation
              and the deliverables agreed in writing before any work starts. Tell
              us about your audience and the categories you cover.
            </p>
            <Button tier="secondary" href={supportMailto('Creator partnership enquiry')}>
              Ask about promoting a campaign
            </Button>
          </Card>
        </div>
        {/* Both cards above are for people who do not have an account yet.
            Everyone who already does arrives here too, and §5 gives them no
            other way in — the header link is the shortcut, this is the one
            that reads in the flow of the page. */}
        <Measure>
          <p>
            Already have a Proovd account?{' '}
            <RouterLink to="/signin">Sign in to your account</RouterLink>.
          </p>
        </Measure>
      </Section>

      <Mode kind="light">
        <Section>
          <TrustStrip />
        </Section>
      </Mode>
    </>
  );
}
