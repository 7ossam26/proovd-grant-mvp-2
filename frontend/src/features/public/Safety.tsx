/**
 * `/safety` — Spec §18, §2.1, §2.2, §2.3, §4.1, §29, §31.7.
 *
 * Everything claimed here is a control that exists. §1.4 forbids presenting a
 * manual step as automation, so the manual ones are described as what they are:
 * a person reads it. §4.1 is explicit that duplicate-Backer copy "promises
 * reasonable deduplication and review, never perfect identity prevention", and
 * that sentence is written that way on purpose.
 */

import { Link as RouterLink } from 'react-router';
import { Measure, Mode, Section, Stat, GridAuto } from '../../components/index.js';
import { SUPPORT_EMAIL } from './site.js';

export function Safety() {
  return (
    <>
      <Section breathe>
        <Measure>
          <p className="kicker">Safety</p>
          <h1>Every founder, campaign, and Creator is reviewed by a person.</h1>
          <p className="lede">
            Proovd is deliberately small and deliberately manual. Nothing here is
            an automated score presented as a safety check — where a human makes
            the decision, we say so.
          </p>
        </Measure>
      </Section>

      <Section>
        <GridAuto track="14rem">
          <Stat variant="mint" value="Invitation only" sub="No public signup exists for any role" />
          <Stat variant="white" brandValue value="Digital only" sub="Physical and mixed rewards are rejected" />
          <Stat variant="dark" value="US, 18+" sub="Founders, Creators, and Backers alike" />
          <Stat variant="white" value="US$50,000" sub="Cap on active pre-orders per campaign, before tax" />
        </GridAuto>
      </Section>

      <Mode kind="light">
        <Section>
          <Measure>
            <h2 className="h2">Before a campaign is published</h2>
            <p>
              <strong>Founder review.</strong> Founders are invited, not
              self-registered. A person reviews the founder, the product, and the
              claims being made before an account is issued, and the campaign
              type is locked at that point.
            </p>
            <p>
              <strong>Campaign review.</strong> A member of our team reads the
              full campaign page, every reward package, every price, and every
              delivery date. Claims that are not supported by evidence are
              removed before publication, not flagged afterwards.
            </p>
            <p>
              <strong>Creator review.</strong> Creators are recruited for one
              named campaign. Identity, audience, and channel are checked, terms
              are agreed in writing, and their first post is verified by a person
              before the partnership counts as active.
            </p>
            <p>
              <strong>Category limits.</strong> Rewards are digital only. Our
              Acceptable Use Policy mirrors Stripe&rsquo;s Prohibited and
              Restricted Businesses list, and regulated categories — medical,
              financial, legal, investment, brokerage, crypto, gambling, weapons,
              and quasi-cash among them — are rejected.
            </p>
          </Measure>
        </Section>
      </Mode>

      <Section>
        <Measure>
          <h2 className="h2">While a campaign is live</h2>
          <p>
            <strong>Fraud screening.</strong> Every payment attempt is screened by
            Stripe Radar, and unusual click or conversion patterns are surfaced to
            our team for review before the close date.
          </p>
          <p>
            <strong>Duplicate pre-orders on an Idea Campaign.</strong> An Idea
            Campaign&rsquo;s threshold counts unique Backers, so we deduplicate
            using signals we actually hold and route suspected duplicates to a
            person before close. This is reasonable deduplication and human
            review — it is not, and we do not claim it to be, perfect identity
            verification.
          </p>
          <p>
            <strong>Creators cannot pre-order their own campaign.</strong> Self
            pre-ordering is prohibited, detected, and treated as cause.
          </p>
          <p>
            <strong>A capped campaign stops accepting pre-orders.</strong> The
            aggregate pre-tax value of active pre-orders on a campaign is capped
            at US$50,000. A transaction that would exceed the cap is rejected
            outright — never partly accepted.
          </p>
        </Measure>
      </Section>

      <Mode kind="dark">
        <Section>
          <Measure>
            <h2 className="h2">What we do not do</h2>
            <ul className="checks">
              <li>
                Nothing sold on Proovd is a stake in a company, a financial
                product, or a promise of a return. A reward package is a
                product.
              </li>
              <li>
                We do not run charity fundraising, political fundraising, or
                sweepstakes.
              </li>
              <li>
                We do not show fake scarcity, invented popularity, or live viewer
                counts, and we do not use a countdown to blur the difference
                between a saved card and a charge.
              </li>
              <li>
                We do not present an automated decision as a human one, or a
                support bot as a person.
              </li>
              <li>We do not publish leaderboards or founder ratings.</li>
            </ul>
          </Measure>
        </Section>
      </Mode>

      <Section>
        <Measure>
          <h2 className="h2">Report a campaign, or ask us something</h2>
          <p>
            Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with the
            campaign address and what you saw. You get an immediate
            acknowledgement and a reply from a person within one business day,
            Monday to Friday, excluding U.S. federal holidays.
          </p>
          <p>
            The rules a founder agrees to are in the{' '}
            <RouterLink to="/aup">Founder Acceptable Use Policy</RouterLink>, and
            the rules a Creator agrees to are in the{' '}
            <RouterLink to="/affiliate-aup">
              Creator Acceptable Use Policy
            </RouterLink>
            .
          </p>
        </Measure>
      </Section>
    </>
  );
}
