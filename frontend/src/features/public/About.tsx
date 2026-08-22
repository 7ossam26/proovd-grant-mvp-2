/**
 * `/about` — Spec §18 (route inventory), §2.1, §2.2, §31.3.
 *
 * §2.1's identity statements are the spine of this page. §1.4 is the constraint
 * on its tone: the MVP is manual behind a polished surface, and this page says
 * so rather than implying a scale that does not exist.
 */

import { Measure, Mode, Section } from '../../components/index.js';
import { LEGAL_ENTITY, SUPPORT_EMAIL } from './site.js';

export function About() {
  return (
    <>
      <Section breathe>
        <Measure>
          <p className="kicker">About Proovd</p>
          <h1>A prototype is not proof. Neither is your group chat.</h1>
          <p className="lede">
            Proovd exists for the moment before you build: when you think people
            want the thing, and you need to find out with money on the line
            rather than compliments.
          </p>
        </Measure>
      </Section>

      <Section>
        <Measure>
          <h2 className="h2">What we are</h2>
          <p>
            {LEGAL_ENTITY} is a Delaware software platform. We make crowdfunding
            software for vetted founders, and we recruit the creators who
            promote each campaign. That is the whole product.
          </p>
          <p>
            On every campaign, the founder is the seller and the merchant of
            record. They own the product, the delivery, the support, the taxes,
            and the refunds. Proovd is the platform, not the seller, and Proovd
            is the merchant of record only for the separate listing fee a founder
            pays us. We are not a reseller and we do not own what is sold on a
            campaign. We are not an investment platform, a charity platform, a
            political fundraiser, or a sweepstakes, and nothing sold on Proovd
            is a stake in a company.
          </p>

          <h2 className="h2">How it actually runs today</h2>
          <p>
            Manually, on purpose. Founder review, campaign review, Creator
            recruitment and verification, first-post checks, deliverable
            completion, payment readiness, refunds, disputes, and every exception
            are decisions a person makes and records. When you read &ldquo;we
            reviewed it&rdquo; on this site, that is what happened.
          </p>
          <p>
            The first cohort is 50 invited founders, one campaign each, and
            roughly 50 hand-picked distribution partners. There is no public
            signup for any role, and there is no waiting list that quietly
            becomes one.
          </p>

          <h2 className="h2">Where we operate</h2>
          <p>
            Founders, Creators, and Backers are in the United States and 18 or
            over. Prices are in US dollars. Rewards are digital only — software,
            apps, courses, downloads, API access, beta enrollment, and similar
            reviewed digital products. Physical goods and mixed
            digital-and-physical rewards are rejected.
          </p>
        </Measure>
      </Section>

      <Mode kind="light">
        <Section>
          <Measure>
            <h2 className="h2">Talk to us</h2>
            <p>
              Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. A
              person replies within one business day, Monday to Friday, excluding
              U.S. federal holidays — that is our actual commitment, and it is at
              the bottom of every page on this site.
            </p>
          </Measure>
        </Section>
      </Mode>
    </>
  );
}
