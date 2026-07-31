/**
 * The campaign page — Spec §18's fourteen-item content order and the
 * campaign-type difference table.
 *
 * The sections below are in §18's numbered order, deliberately and literally,
 * because Phase 14 renders approved live campaigns through this same structure
 * and inherits whatever order is set here. `sample-campaigns.test.tsx` asserts
 * the document order of the headings, so a later reshuffle fails the suite
 * rather than quietly dropping item 8 below the fold.
 *
 * ── No payment field, anywhere ─────────────────────────────────────────────
 * §18: "Neither accepts real card data." §34 gates live mode on proving it.
 * The phase brief is blunt about the distinction that matters: "disabled" is
 * not the same as absent. There is no Stripe Elements mount, no SetupIntent, no
 * card input, and no form element in this file. The pre-order control is an
 * inert button that names what it would do and explains why it does not.
 *
 * The Appendix A.6 banner renders above everything and is not dismissible.
 */

import { Link as RouterLink } from 'react-router';
import { formatUsd } from '@proovd/shared';
import {
  Accordion,
  Button,
  Card,
  GridAuto,
  Measure,
  Mode,
  Progress,
  Section,
  Stat,
  Tag,
} from '../../../components/index.js';
import { EmptyPanel, supportMailto } from '../states.js';
import { SUPPORT_EMAIL } from '../site.js';
import { formatLocalInstant, formatUtcInstant, formatCalendarDate } from './format.js';
import {
  SAMPLE_BANNER,
  chargeRule,
  consentPreview,
  expandedMorBlock,
} from './consent.js';
import { findReward, type CampaignView } from './types.js';

const MODEL_LABEL: Record<CampaignView['model'], string> = {
  idea: 'Idea Campaign',
  product: 'Product Campaign',
};

/** §27.1 — local time primary, canonical UTC secondary. */
function When({ instant }: { instant: Date }) {
  return (
    <time dateTime={instant.toISOString()}>
      {formatLocalInstant(instant)}{' '}
      <span className="utc">({formatUtcInstant(instant)})</span>
    </time>
  );
}

function SampleBanner() {
  return (
    <div className="sample-banner" role="note">
      <span className="sample-banner__text">{SAMPLE_BANNER}</span>
    </div>
  );
}

function ConsentPreviewBlock({ campaign }: { campaign: CampaignView }) {
  const consent = consentPreview(campaign);
  return (
    <div className="consent">
      <p>{consent.intro}</p>
      <dl className="consent__amounts">
        {consent.amounts.map((amount) => (
          <div className="consent__amount" key={amount.label}>
            <dt>{amount.label}</dt>
            <dd>{amount.value}</dd>
          </div>
        ))}
      </dl>
      <p>{consent.leadIn}</p>
      <ul className="consent__bullets">
        {consent.bullets.map((bullet) => (
          <li key={bullet.slice(0, 48)}>{bullet}</li>
        ))}
      </ul>
      <p>{consent.agreement}</p>
      <ul className="consent__checks">
        {consent.checkboxes.map((checkbox) => (
          <li key={checkbox.text.slice(0, 48)}>
            <span className="consent__box" aria-hidden="true" />
            <span>
              <em>
                {checkbox.required
                  ? '(required; unchecked by default)'
                  : '(optional; unchecked by default)'}
              </em>{' '}
              {checkbox.text}
            </span>
          </li>
        ))}
      </ul>
      <p className="consent__action">
        <span className="consent__action-label">{consent.actionLabel}</span>
      </p>
    </div>
  );
}

export function CampaignPage({ campaign }: { campaign: CampaignView }) {
  const featured = findReward(campaign, campaign.featuredRewardSku);
  const consent = consentPreview(campaign);

  return (
    <>
      {campaign.isSample ? <SampleBanner /> : null}

      {/* 1. Campaign title */}
      <Section breathe>
        <Measure>
          <Tag variant="live">{MODEL_LABEL[campaign.model]}</Tag>
          <h1>{campaign.title}</h1>
          <p className="lede">{campaign.tagline}</p>
        </Measure>
        {campaign.momentum ? (
          <GridAuto track="12rem">
            <Stat
              variant="white"
              brandValue
              value={campaign.momentum.uniqueBackers}
              sub="Unique Backers — sample data"
            />
            <Stat
              variant="white"
              value={campaign.momentum.unitsReserved}
              sub="Units reserved — sample data"
            />
          </GridAuto>
        ) : null}
      </Section>

      {/* 2. Founder identity */}
      <Section aria-labelledby="campaign-founder">
        <Measure>
          <h2 className="h2" id="campaign-founder">
            Who you are buying from
          </h2>
          <dl className="kv">
            <div className="kv__row">
              <dt>Legal name</dt>
              <dd>{campaign.founder.legalName}</dd>
            </div>
            <div className="kv__row">
              <dt>Selling as</dt>
              <dd>{campaign.founder.entity}</dd>
            </div>
            <div className="kv__row">
              <dt>Country</dt>
              <dd>{campaign.founder.country}</dd>
            </div>
          </dl>
          <p>{campaign.founder.profile}</p>
        </Measure>
      </Section>

      {/* 3. Reward packages */}
      <Mode kind="light">
        <Section aria-labelledby="campaign-rewards">
          <h2 className="h2" id="campaign-rewards">
            Reward packages
          </h2>
          <p>
            Prices are shown before sales tax. Sales tax is calculated at
            checkout for your billing address and added on top.
          </p>
          <div className="reward-list">
            {campaign.rewards.map((reward) => (
              <Card key={reward.sku} className="reward">
                <h3 className="reward__title">{reward.title}</h3>
                <p className="reward__price">
                  {formatUsd(reward.priceCents)}{' '}
                  <span className="reward__pretax">before sales tax</span>
                </p>
                <ul className="reward__contents">
                  {reward.contents.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <dl className="kv kv--tight">
                  <div className="kv__row">
                    <dt>{campaign.model === 'idea' ? 'Delivery window' : 'Delivery'}</dt>
                    <dd>{reward.delivery}</dd>
                  </div>
                  <div className="kv__row">
                    <dt>How it reaches you</dt>
                    <dd>{reward.fulfillment}</dd>
                  </div>
                  <div className="kv__row">
                    <dt>Package</dt>
                    <dd>{reward.sku}</dd>
                  </div>
                </dl>
              </Card>
            ))}
          </div>
        </Section>
      </Mode>

      {/* 4. Campaign-type badge paired with its plain charge rule */}
      <Section aria-labelledby="campaign-charge-rule">
        <Measure>
          <h2 className="h2" id="campaign-charge-rule">
            When your card is charged
          </h2>
          <p>
            <Tag variant="live">{MODEL_LABEL[campaign.model]}</Tag>
          </p>
          <p className="lede">{chargeRule(campaign)}.</p>
          {campaign.model === 'idea' ? (
            <p>
              Your card is saved when you pre-order and nothing is taken that
              day. If this campaign reaches its order threshold at the close
              date, the exact total you authorized is charged then. If it does
              not, no charge is created and your saved card loses future-charge
              eligibility for this campaign.
            </p>
          ) : (
            <p>
              Your card is saved when you pre-order and nothing is taken that
              day. The exact total you authorized is charged on the close date.
              There is no threshold on a Product Campaign.
            </p>
          )}
        </Measure>
      </Section>

      {/* 5. Open and close, viewer local time with UTC available */}
      <Section aria-labelledby="campaign-dates">
        <Measure>
          <h2 className="h2" id="campaign-dates">
            Opens and closes
          </h2>
          <dl className="kv">
            <div className="kv__row">
              <dt>Opens</dt>
              <dd>
                <When instant={campaign.opensAt} />
              </dd>
            </div>
            <div className="kv__row">
              <dt>Closes</dt>
              <dd>
                <When instant={campaign.closesAt} />
              </dd>
            </div>
          </dl>
        </Measure>
      </Section>

      {/* 6. Idea threshold row — Idea Campaigns only (§18 difference table) */}
      {campaign.model === 'idea' && campaign.orderThreshold !== null ? (
        <Mode kind="light">
          <Section aria-labelledby="campaign-threshold">
            <Measure>
              <h2 className="h2" id="campaign-threshold">
                Order threshold
              </h2>
              <p>
                This campaign charges only if{' '}
                <strong>{campaign.orderThreshold} unique Backers</strong> hold an
                active pre-order at the close date. A cancelled pre-order does
                not count.
              </p>
              <Progress
                label="Progress toward the order threshold"
                value={(campaign.thresholdProgress ?? 0) / campaign.orderThreshold}
                valueText={`${campaign.thresholdProgress ?? 0} of ${
                  campaign.orderThreshold
                } unique Backers`}
              />
              <p>
                {campaign.thresholdProgress ?? 0} of {campaign.orderThreshold}{' '}
                unique Backers — sample data.
              </p>
            </Measure>
          </Section>
        </Mode>
      ) : null}

      {/* 7. Refund and fulfillment */}
      <Section aria-labelledby="campaign-refunds">
        <Measure>
          <h2 className="h2" id="campaign-refunds">
            Refunds and delivery
          </h2>
          <ul className="doc-list">
            {campaign.refundSummary.map((item) => (
              <li key={item.slice(0, 40)}>{item}</li>
            ))}
          </ul>
          <p>
            <RouterLink to="/refunds">Proovd Refund Policy</RouterLink> ·{' '}
            <RouterLink to="/fulfillment">Proovd Fulfillment Policy</RouterLink>
          </p>

          {campaign.founderRefundPolicy ? (
            <div id="founder-refund-policy">
              <h3>{campaign.founderRefundPolicy.title}</h3>
              <p>
                Version {campaign.founderRefundPolicy.version}, effective{' '}
                {formatCalendarDate(campaign.founderRefundPolicy.effectiveDate)}.
                This is the version preserved with your pre-order; it cannot be
                changed after you agree to it.
              </p>
              <ul className="doc-list">
                {campaign.founderRefundPolicy.summary.map((item) => (
                  <li key={item.slice(0, 40)}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Measure>
      </Section>

      {/* 8. Always-visible Founder/MoR disclosure, with expandable explanation */}
      <Mode kind="dark">
        <Section aria-labelledby="campaign-mor">
          <Measure>
            <h2 className="h2" id="campaign-mor">
              Who is selling this
            </h2>
            <p className="lede">
              Sold by {campaign.founder.legalName} of {campaign.founder.entity},{' '}
              {campaign.founder.country}. Proovd is the platform, not the seller.
            </p>
            <Accordion
              items={[
                {
                  value: 'mor',
                  head: 'How this works',
                  body: (
                    <>
                      {expandedMorBlock(campaign).map((paragraph) => (
                        <p key={paragraph.slice(0, 40)}>{paragraph}</p>
                      ))}
                    </>
                  ),
                },
              ]}
            />
          </Measure>
        </Section>
      </Mode>

      {/* 9. Pre-order action, with §18's compact summary beside it */}
      <Section aria-labelledby="campaign-preorder">
        <Measure>
          <h2 className="h2" id="campaign-preorder">
            Reserve a pre-order
          </h2>
          <ul className="compact-summary">
            <li>Card saved today — nothing is charged</li>
            <li>{chargeRule(campaign)}</li>
            <li>
              {campaign.model === 'idea' ? 'Delivery window' : 'Delivery'} for{' '}
              {featured.title}: {featured.delivery}
            </li>
          </ul>
          <p>
            {featured.title} — {formatUsd(featured.priceCents)} before sales tax.
            Sales tax is added at checkout and the exact total is shown before
            you authorize anything.
          </p>
          <Button tier="primary" disabled aria-describedby="campaign-preorder-note">
            Reserve a pre-order
          </Button>
          <p id="campaign-preorder-note">
            <strong>
              This is a sample campaign, so there is nothing to reserve.
            </strong>{' '}
            No card field is shown on this page and none is loaded behind it — no
            payment information of any kind is collected here.
          </p>

          <h3>What you would agree to</h3>
          <p>
            This is the consent text a Backer reads on a real{' '}
            {MODEL_LABEL[campaign.model]}, reproduced in full with this
            sample&rsquo;s figures. The amounts below are sample data.
          </p>
          {/* Open by default. DNA §5.12 stages dense text one gesture below,
              but §34's condition is that the samples *prove* no-charge-today
              consent — a proof nobody has to click for. */}
          <Accordion
            defaultValue="consent"
            items={[
              {
                value: 'consent',
                head: `The ${MODEL_LABEL[campaign.model]} consent, in full`,
                body: <ConsentPreviewBlock campaign={campaign} />,
              },
            ]}
          />
          <p className="consent__appendix">
            Reproduced from Proovd&rsquo;s canonical consent text (Appendix{' '}
            {consent.appendix}).
          </p>
        </Measure>
      </Section>

      {/* 10. Story / launch narrative */}
      <Mode kind="light">
        <Section aria-labelledby="campaign-story">
          <Measure>
            <h2 className="h2" id="campaign-story">
              The story
            </h2>
            {campaign.story.map((section) => (
              <div key={section.heading}>
                <h3>{section.heading}</h3>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph.slice(0, 40)}>{paragraph}</p>
                ))}
              </div>
            ))}
          </Measure>
        </Section>
      </Mode>

      {/* 11. FAQ */}
      <Section aria-labelledby="campaign-faq">
        <Measure>
          <h2 className="h2" id="campaign-faq">
            Questions people ask
          </h2>
          <Accordion
            defaultValue={campaign.faq[0]?.question ?? ''}
            items={campaign.faq.map((entry) => ({
              value: entry.question,
              head: entry.question,
              body: <p>{entry.answer}</p>,
            }))}
          />
        </Measure>
      </Section>

      {/* 12. Updates */}
      <Section aria-labelledby="campaign-updates">
        <Measure>
          <h2 className="h2" id="campaign-updates">
            Updates
          </h2>
          <EmptyPanel
            state="No updates have been posted yet"
            whatHappened="Updates appear here once the campaign is live. This sample has none."
            next="On a real campaign, the Founder posts progress here and Backers are emailed. Material delivery changes show the previous and the revised commitment together."
            reference={`${campaign.title} — sample campaign`}
            helpSubject="Question about a campaign update"
          />
        </Measure>
      </Section>

      {/* 13. Comments */}
      <Section aria-labelledby="campaign-comments">
        <Measure>
          <h2 className="h2" id="campaign-comments">
            Comments
          </h2>
          <p>
            On a real campaign, only a Backer signed in through the link in their
            confirmation email can post, and comments show a Backer number or a
            chosen display name — never an email address. New comments close when
            the campaign does.
          </p>
          <EmptyPanel
            state="No comments on this sample"
            whatHappened="Nobody can post on a sample campaign, because a sample has no Backers."
            next="Open a live campaign to see the real thread."
            reference={`${campaign.title} — sample campaign`}
            helpSubject="Question about campaign comments"
          />
        </Measure>
      </Section>

      {/* 14. Legal and support */}
      <Section aria-labelledby="campaign-support">
        <Measure>
          <h2 className="h2" id="campaign-support">
            Support for this campaign
          </h2>
          <p>
            Questions about the product, the delivery, or a refund go to{' '}
            {campaign.founder.legalName} through Proovd support: we acknowledge
            immediately, a person replies within one business day, and we follow
            up if the Founder has not responded within 48 hours.
          </p>
          <p>
            Questions about the Proovd platform itself go to{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
          <p>
            Expected statement descriptor:{' '}
            <strong>{campaign.statementDescriptor}</strong>
          </p>
          <Button tier="secondary" href={supportMailto(`Question about ${campaign.title}`)}>
            Email us about this campaign
          </Button>
        </Measure>
      </Section>
    </>
  );
}
