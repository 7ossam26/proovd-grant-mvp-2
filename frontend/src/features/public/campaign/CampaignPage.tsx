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
import { formatUsd, attributionMayEarn, UPDATE_AUDIENCE_LABELS } from '@proovd/shared';
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
import {
  findReward,
  type CampaignView,
  type CampaignUpdate,
  type EndedKind,
  type AttributionBanner as AttributionBannerModel,
} from './types.js';

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

/**
 * §18: "Creator-link arrival shows `You came through [handle]` and explains that
 * the Creator may earn if the later charge succeeds." The earn line shows only
 * while the attribution can still finalize (provisional/verified) — never for a
 * paused link, which would promise an earning that cannot happen.
 */
function AttributionArrival({ attribution }: { attribution: AttributionBannerModel }) {
  const handle = attribution.handle ?? 'a Creator';
  return (
    <div className="attribution-arrival" role="note">
      <p className="attribution-arrival__lead">
        You came through <strong>{handle}</strong>.
      </p>
      <p className="attribution-arrival__note">
        {attributionMayEarn(attribution.status)
          ? `If you place a pre-order on this browser and your card is later charged, ${handle} may earn a commission — at no extra cost to you. This works on this browser only.`
          : `${handle}'s link is not currently earning on this campaign. Your pre-order and price are unaffected.`}
      </p>
    </div>
  );
}

interface EndedCopy {
  title: string;
  why: string;
  charge: string;
  next: string;
}

/** §18's outcome-specific ended copy. Never one generic "Campaign ended". */
function endedCopy(kind: EndedKind, campaign: CampaignView): EndedCopy {
  const closed = `Pre-orders closed on ${formatUtcInstant(campaign.closesAt)}.`;
  switch (kind) {
    case 'closed':
      return {
        title: 'This campaign has closed',
        why: closed,
        charge:
          'If you placed a pre-order, your saved card was charged the exact total you authorized. ' +
          'Open your backer page — the magic link is in your confirmation email — to see your charge and receipt. ' +
          'If you never pre-ordered, nothing was charged.',
        next: 'The Founder now fulfills the rewards on the delivery dates shown above.',
      };
    case 'no_charge':
      return {
        title: 'This campaign closed without any charge',
        why:
          campaign.model === 'idea'
            ? 'This Idea Campaign did not reach its order threshold by the close date.'
            : 'This campaign was ended before any charge was created.',
        charge:
          'No card was charged — not yours, not anyone’s. Any saved card has lost future-charge eligibility for this campaign.',
        next: 'Nothing further happens, and you were not billed.',
      };
    case 'suspended':
      return {
        title: 'This campaign is on hold',
        why: 'Proovd has paused this campaign while it reviews it. Pre-orders and new comments are closed for now.',
        charge:
          'Whether a charge has occurred depends on where the campaign was in its cycle. ' +
          'Open your backer page, or contact support, to see your exact status.',
        next: 'Proovd will update Backers as the review concludes.',
      };
    case 'killed':
      return {
        title: 'This campaign has been stopped',
        why: 'This campaign was stopped and is no longer running.',
        charge:
          'If you were charged, refund handling follows Proovd’s Refund Policy and the recovery path for a stopped campaign. ' +
          'Open your backer page or contact support to see your exact status.',
        next: 'Proovd is handling any charged pre-orders under the recovery path.',
      };
  }
}

/**
 * §18's ended-state contract: the page stays accessible, new pre-orders and
 * comments are disabled, and the copy states why it ended, whether the viewer
 * was charged, what happens next, and where existing Backers get help. The
 * viewer's own charge status lives on their magic-link backer page (they have no
 * session here), so this states it conditionally and points them there.
 */
function EndedBanner({ kind, campaign }: { kind: EndedKind; campaign: CampaignView }) {
  const copy = endedCopy(kind, campaign);
  return (
    <Mode kind="dark">
      <Section aria-labelledby="campaign-ended">
        <Measure>
          <Tag variant="live">Ended</Tag>
          <h2 className="h2" id="campaign-ended">
            {copy.title}
          </h2>
          <dl className="ended-banner">
            <div className="ended-banner__row">
              <dt>Why it ended</dt>
              <dd>{copy.why}</dd>
            </div>
            <div className="ended-banner__row">
              <dt>Were you charged?</dt>
              <dd>{copy.charge}</dd>
            </div>
            <div className="ended-banner__row">
              <dt>What happens next</dt>
              <dd>{copy.next}</dd>
            </div>
          </dl>
          <p>
            Need help with an existing pre-order? Email{' '}
            <a href={supportMailto(`Ended campaign — ${campaign.title}`)}>{SUPPORT_EMAIL}</a>, or
            open your backer page from the magic link in your confirmation email. See also the{' '}
            <RouterLink to="/refunds">Refund Policy</RouterLink>.
          </p>
        </Measure>
      </Section>
    </Mode>
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

/** The note beside the pre-order action — honest about what this page does (§1.4). */
function preorderNote(campaign: CampaignView, ended: EndedKind | null): React.ReactNode {
  if (ended) {
    return (
      <>
        <strong>Pre-orders for this campaign are closed.</strong> See the notice above for what
        this means for you. No card field is shown and no payment is collected here.
      </>
    );
  }
  if (campaign.isSample) {
    return (
      <>
        <strong>This is a sample campaign, so there is nothing to reserve.</strong> No card field is
        shown on this page and none is loaded behind it — no payment information of any kind is
        collected here.
      </>
    );
  }
  // A real, live campaign. The pre-order checkout is a separate guided step
  // (Phase 15); until then, say plainly that nothing is collected here.
  return (
    <>
      Pre-ordering happens through a secure Stripe checkout as a separate, guided step. No card
      field is shown on this page and no payment information is collected here.
    </>
  );
}

/**
 * Item 9's consent. A sample reproduces the full A.3/A.4 consent with its
 * figures (§34's proof that no card is charged today); a real campaign shows the
 * full consent at checkout with a real tax total, so here it states that the
 * consent — amounts, charge rule, merchant of record — is read before any card
 * is entered, and shows no example amount that a Backer might mistake for theirs.
 */
function PreorderConsent({ campaign, ended }: { campaign: CampaignView; ended: EndedKind | null }) {
  if (campaign.isSample) {
    const consent = consentPreview(campaign);
    return (
      <>
        <h3>What you would agree to</h3>
        <p>
          This is the consent text a Backer reads on a real {MODEL_LABEL[campaign.model]},
          reproduced in full with this sample&rsquo;s figures. The amounts below are sample data.
        </p>
        {/* Open by default. DNA §5.12 stages dense text one gesture below, but
            §34's condition is that the samples *prove* no-charge-today consent —
            a proof nobody has to click for. */}
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
          Reproduced from Proovd&rsquo;s canonical consent text (Appendix {consent.appendix}).
        </p>
      </>
    );
  }
  if (ended) return null;
  return (
    <p>
      Before any card is entered, you read and authorize the full pre-order consent — the exact
      reward subtotal, the sales tax for your billing address, the total you authorize, the charge
      rule, and the merchant of record — at checkout. Nothing on this page is a charge.
    </p>
  );
}

/** §18 item 12 — one published update, with its audience label and local time. */
function UpdateEntry({ update }: { update: CampaignUpdate }) {
  return (
    <article className="update">
      <p className="update__meta">
        <span className="update__audience">{UPDATE_AUDIENCE_LABELS[update.audience]}</span>
        <When instant={new Date(update.publishedAt)} />
      </p>
      {update.title ? <h3 className="update__title">{update.title}</h3> : null}
      {update.isMaterialDeliveryChange &&
      update.priorCommitment &&
      update.revisedCommitment ? (
        <dl className="update__change">
          <div className="update__change-row">
            <dt>Previously</dt>
            <dd>{update.priorCommitment}</dd>
          </div>
          <div className="update__change-row">
            <dt>Now</dt>
            <dd>{update.revisedCommitment}</dd>
          </div>
        </dl>
      ) : null}
      {update.body.split('\n\n').map((paragraph) => (
        <p key={paragraph.slice(0, 40)}>{paragraph}</p>
      ))}
      {update.imageUrl ? (
        <img className="update__image" src={update.imageUrl} alt="" loading="lazy" />
      ) : null}
      {update.videoUrl ? (
        <p>
          <a href={update.videoUrl} target="_blank" rel="noopener noreferrer">
            Watch the video
          </a>
        </p>
      ) : null}
    </article>
  );
}

export function CampaignPage({ campaign }: { campaign: CampaignView }) {
  const featured = findReward(campaign, campaign.featuredRewardSku);
  const ended = campaign.ended ?? null;
  const updates = campaign.updates ?? [];

  return (
    <>
      {/* §18 discovery: Days 1–7 are excluded from indexing. React 19 hoists this. */}
      {campaign.indexable === false ? <meta name="robots" content="noindex, nofollow" /> : null}

      {campaign.isSample ? <SampleBanner /> : null}
      {ended ? <EndedBanner kind={ended} campaign={campaign} /> : null}
      {campaign.attribution ? <AttributionArrival attribution={campaign.attribution} /> : null}

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
              {campaign.thresholdProgress !== null ? (
                <>
                  <Progress
                    label="Progress toward the order threshold"
                    value={campaign.thresholdProgress / campaign.orderThreshold}
                    valueText={`${campaign.thresholdProgress} of ${campaign.orderThreshold} unique Backers`}
                  />
                  <p>
                    {campaign.thresholdProgress} of {campaign.orderThreshold} unique Backers —{' '}
                    {campaign.isSample ? 'sample data' : 'so far'}.
                  </p>
                </>
              ) : (
                <p>Progress toward the threshold appears here as pre-orders come in.</p>
              )}
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
            {ended ? 'Pre-orders are closed' : 'Reserve a pre-order'}
          </Button>
          <p id="campaign-preorder-note">{preorderNote(campaign, ended)}</p>

          <PreorderConsent campaign={campaign} ended={ended} />
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
          {updates.length > 0 ? (
            <div className="update-list">
              {updates.map((update) => (
                <UpdateEntry key={update.id} update={update} />
              ))}
            </div>
          ) : (
            <EmptyPanel
              state="No updates have been posted yet"
              whatHappened={
                campaign.isSample
                  ? 'Updates appear here once the campaign is live. This sample has none.'
                  : "The Founder hasn't posted an update yet. When they do, it appears here and Backers are emailed."
              }
              next="The Founder posts progress here and Backers are emailed. Material delivery changes show the previous and the revised commitment together."
              reference={campaign.isSample ? `${campaign.title} — sample campaign` : campaign.title}
              helpSubject="Question about a campaign update"
            />
          )}
        </Measure>
      </Section>

      {/* 13. Comments */}
      <Section aria-labelledby="campaign-comments">
        <Measure>
          <h2 className="h2" id="campaign-comments">
            Comments
          </h2>
          <p>
            Only a Backer signed in through the link in their confirmation email can post, and
            comments show a Backer number or a chosen display name — never an email address. New
            comments close when the campaign does.
          </p>
          <EmptyPanel
            state={campaign.isSample ? 'No comments on this sample' : 'The comment thread is not open yet'}
            whatHappened={
              campaign.isSample
                ? 'Nobody can post on a sample campaign, because a sample has no Backers.'
                : 'Commenting opens for Backers of this campaign shortly. No comments have been posted yet.'
            }
            next={
              campaign.isSample
                ? 'Open a live campaign to see the real thread.'
                : 'Backers can post from their backer page once commenting opens.'
            }
            reference={campaign.isSample ? `${campaign.title} — sample campaign` : campaign.title}
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
