/**
 * The public campaign page — Spec §18's fourteen mandatory items, rendered in
 * the designed band order of the campaign-page-v2 reference.
 *
 * §18's own sentence licenses the redesign and bounds it: "Every campaign page
 * exposes all of the following; the DNA UX document controls presentation." So
 * the ORDER below is the reference's and the CONTENT is §18's — all fourteen
 * items, none dropped. `public-site.test.tsx` asserts the band order AND that
 * every one of the fourteen anchors is present, so a later reshuffle fails the
 * suite rather than quietly losing item 8 below the fold.
 *
 * ── Where the four items the reference does not draw went ──────────────────
 * The reference has no Founder identity block, no refund summary, no merchant
 * -of-record line, and no comments. Items 2, 7 and 8 are one designed unit —
 * the `.pc-seller` band — placed immediately before the reward cards, because
 * §18 requires the MoR disclosure ABOVE the pre-order action and that band is
 * the last thing a reader passes before the first control that can open
 * checkout. Item 13 is its own band above the footer.
 *
 * ── The h1 is the hero headline, and the title is the line above it ────────
 * §18 item 1 requires the campaign title EXPOSED, not that it be the `h1`.
 * The kicker carries it and the document `<title>` still carries it. When a
 * campaign has written no hero headline the `h1` IS the title and no kicker
 * renders — an empty kicker above a duplicated title is exactly the
 * placeholder §33.11.3 forbids.
 *
 * ── No payment field, anywhere in this file ────────────────────────────────
 * §18: "Neither accepts real card data." §34 gates live mode on proving it.
 * "Disabled" is not "absent": there is no Stripe mount, no `<form>`, and no
 * `<input>` here. The only thing that can reach a card is `CheckoutDrawer`,
 * which renders ONLY for a real live campaign — never for a sample, never for
 * the Founder preview, and never once the campaign has ended.
 *
 * Two controls scroll and two open checkout, which is the reference's own
 * split: the hero CTA and the nav's `Reserve` move the reader to the cards;
 * the selected card's action and the phone dock open the drawer. That is what
 * lets the seller band sit above every control that can reach a card.
 *
 * The Appendix A.6 banner renders above everything and is not dismissible.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { formatUsd, attributionMayEarn, UPDATE_AUDIENCE_LABELS } from '@proovd/shared';
import { Accordion, Button, Dock, Mode, Progress, Section, Tag } from '../../../components/index.js';
import { animateDemoMessage, fillOnScroll, reduced } from '../../../components/anim.js';
import { EmptyPanel, supportMailto } from '../states.js';
import { SUPPORT_EMAIL } from '../site.js';
import { CheckoutDrawer } from '../checkout/CheckoutDrawer.js';
import { formatLocalInstant, formatUtcInstant, formatCalendarDate } from './format.js';
import { SAMPLE_BANNER, chargeRule, consentPreview, expandedMorBlock } from './consent.js';
import {
  findReward,
  type BenefitCard,
  type CampaignUpdate,
  type CampaignView,
  type DemoMoment,
  type EndedKind,
  type RewardPackage,
  type AttributionBanner as AttributionBannerModel,
} from './types.js';

const MODEL_LABEL: Record<CampaignView['model'], string> = {
  idea: 'Idea Campaign',
  product: 'Product Campaign',
};

/** How long the demo rests on a moment before advancing (the reference's own). */
const DEMO_DWELL_MS = 2600;

/** §27.1 — local time primary, canonical UTC secondary. */
function When({ instant }: { instant: Date }) {
  return (
    <time dateTime={instant.toISOString()}>
      {formatLocalInstant(instant)} <span className="utc">({formatUtcInstant(instant)})</span>
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

/**
 * §18/§33.9.9's outcome-specific ended copy. Never one generic "Campaign
 * ended" — and since Phase 20b never one generic kill/suspension either: a
 * threshold miss, a natural close, a pre-charge kill, and a post-charge
 * suspension each state their own why/charged/next.
 */
function endedCopy(kind: EndedKind, campaign: CampaignView): EndedCopy {
  const closed = `Pre-orders closed on ${formatUtcInstant(campaign.closesAt)}.`;
  const noChargeFact =
    'No card was charged — not yours, not anyone’s. Any saved card has lost future-charge eligibility for this campaign.';
  const chargedFact =
    'If you placed a pre-order, your card may have been charged before this decision. ' +
    'Open your backer page — the magic link is in your confirmation email — for your exact charge and refund status. ' +
    'Your card issuer’s dispute rights are unaffected.';
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
    case 'threshold_not_met':
      return {
        title: 'This campaign closed without reaching its order threshold',
        why: 'This Idea Campaign did not reach its order threshold by the close date, so no charge was created.',
        charge: noChargeFact,
        next: 'Nothing further happens, and you were not billed.',
      };
    case 'canceled_before_charge':
      return {
        title: 'This campaign ended before any charge',
        why: 'This campaign was ended before any charge was created.',
        charge: noChargeFact,
        next: 'Nothing further happens, and you were not billed.',
      };
    case 'suspended_before_charge':
      return {
        title: 'This campaign is on hold',
        why: 'Proovd paused this campaign for review before any charge was created. Pre-orders and new comments are closed for now.',
        charge: noChargeFact,
        next: 'Proovd will update Backers as the review concludes. No card will be charged while it is on hold.',
      };
    case 'suspended_after_charge':
      return {
        title: 'This campaign is on hold',
        why: 'Proovd paused this campaign for review after its close. Pre-orders and new comments are closed.',
        charge: chargedFact,
        next: 'Charged pre-orders keep their recorded state while Proovd reviews; any refund follows the recorded refund rules.',
      };
    case 'killed_before_charge':
      return {
        title: 'This campaign has been stopped',
        why: 'Proovd stopped this campaign before any charge was created.',
        charge: noChargeFact,
        next: 'Nothing further happens, and you were not billed.',
      };
    case 'killed_after_charge':
      return {
        title: 'This campaign has been stopped',
        why: 'Proovd stopped this campaign after charges had occurred.',
        charge: chargedFact,
        next: 'Proovd is handling charged pre-orders under the recorded refund and recovery rules — your backer page shows your exact status.',
      };
  }
}

/**
 * §18's ended-state contract: the page stays accessible, new pre-orders and
 * comments are disabled, and the copy states why it ended, whether the viewer
 * was charged, what happens next, and where existing Backers get help. The
 * viewer's own charge status lives on their magic-link backer page (they have
 * no session here), so this states it conditionally and points them there.
 */
function EndedBanner({ kind, campaign }: { kind: EndedKind; campaign: CampaignView }) {
  const copy = endedCopy(kind, campaign);
  return (
    <Mode kind="dark">
      <Section aria-labelledby="campaign-ended">
        <Tag variant="live">Ended</Tag>
        <h2 className="h2" id="campaign-ended">
          {copy.title}
        </h2>
        {campaign.endedExplanation ? (
          <p className="ended-banner__explanation">{campaign.endedExplanation}</p>
        ) : null}
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
          <a href={supportMailto(`Ended campaign — ${campaign.title}`)}>{SUPPORT_EMAIL}</a>, or open
          your backer page from the magic link in your confirmation email. See also the{' '}
          <RouterLink to="/refunds">Refund Policy</RouterLink>.
        </p>
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
        <strong>Pre-orders for this campaign are closed.</strong> See the notice above for what this
        means for you. No card field is shown and no payment is collected here.
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
  // A real, live campaign. The checkout is a separate guided step (§19); until
  // it opens, say plainly that nothing is collected on this page.
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
 * is entered, and shows no example amount a Backer might mistake for theirs.
 */
function PreorderConsent({ campaign, ended }: { campaign: CampaignView; ended: EndedKind | null }) {
  if (campaign.isSample) {
    const consent = consentPreview(campaign);
    return (
      <>
        {/*
          No heading of its own. `Accordion` renders an `h3` head, and the
          `h3` above this is item 9's own "Reserve a pre-order" — so an
          intermediate heading here would sit ABOVE a heading one level
          shallower than itself. The accordion's head already names the
          content, which is what a heading here would have said.
        */}
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

/**
 * Arrow-key navigation across a group of toggle buttons.
 *
 * Focus only — selection stays on Enter/Space, which is what a `aria-pressed`
 * button means. A roving selection would announce a choice the reader had not
 * made yet, and on the reward cards that choice is what the checkout opens
 * against.
 */
function moveFocus(event: React.KeyboardEvent<HTMLElement>, buttons: HTMLButtonElement[]): void {
  const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0 || buttons.length === 0) return;
  event.preventDefault();
  const to =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (at + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length;
  buttons[to]?.focus();
}

/* ── The interactive demo stage ────────────────────────────────────────────
 *
 * New capability, and named as such rather than cited: §14.4 lists thirteen
 * build ingredients and this is not among them. It is presentation of the
 * Founder's own product, in the class §14.4 does name ("Hero preference",
 * "Product visuals and brand assets"), and it carries no commercial rule — no
 * price, no date, no threshold, no eligibility. A campaign with no moments
 * renders no stage at all.
 */
function DemoStage({
  moments,
  wordmark,
  contextLabel,
}: {
  moments: readonly DemoMoment[];
  wordmark: string;
  contextLabel: string | null;
}) {
  const [index, setIndex] = useState(0);
  /**
   * WCAG 2.2.2. The auto-advance stops PERMANENTLY on the first interaction —
   * the moment buttons are that mechanism, so no extra pause control is added,
   * and a person who has taken control never has it taken back.
   */
  const [taken, setTaken] = useState(false);
  const messageRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (taken || reduced() || moments.length < 2) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % moments.length), DEMO_DWELL_MS);
    return () => window.clearInterval(id);
  }, [taken, moments.length]);

  useEffect(() => {
    if (messageRef.current) animateDemoMessage(messageRef.current);
  }, [index]);

  const choose = useCallback((next: number) => {
    setTaken(true);
    setIndex(next);
  }, []);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    moveFocus(event, [...(listRef.current?.querySelectorAll('button') ?? [])]);
  }, []);

  const active = moments[index] ?? moments[0];
  if (!active) return null;

  return (
    <div
      className="pc-demo"
      role="group"
      aria-label={`An interactive example of ${wordmark}, showing moments in a day`}
    >
      {/*
        The reference puts the product's own short wordmark here. We have no
        such field — `campaign.title` is a full descriptive line ("Loopnote —
        voice notes that write your weekly update"), which reads as anything
        but a wordmark — and deriving one by cutting at the first dash would be
        guessing at a name the Founder never gave us. The title is already the
        kicker directly beside this stage, so the context label carries the top
        line alone and the group's accessible name names the campaign.
      */}
      <div className="pc-demo__top">{contextLabel ? <span>{contextLabel}</span> : null}</div>
      {/* No `aria-live`: while the stage is advancing on its own, announcing
          every 2.6s would talk over whatever the reader is doing. The moment
          buttons carry `aria-pressed`, so a chosen moment announces itself. */}
      <div className="pc-demo__message" ref={messageRef}>
        <span className="pc-demo__state">{active.stateWord}</span>
        <p className="pc-demo__headline">{active.headline}</p>
        {active.isAction ? (
          // An illustration of the app's own control, not a control of this
          // page: it names what the app would do and does nothing here, so it
          // is text rather than a button nobody can operate (§1.4).
          <span className="pc-demo__action">{active.actionLabel}</span>
        ) : (
          <span className="pc-demo__signal">
            <i aria-hidden="true" />
            {active.signalText}
          </span>
        )}
      </div>
      <div className="pc-demo__moments" ref={listRef} onKeyDown={onKeyDown}>
        {moments.map((moment, i) => (
          <button
            key={moment.id}
            type="button"
            className={i === index ? 'pc-moment is-active' : 'pc-moment'}
            aria-pressed={i === index}
            onClick={() => choose(i)}
          >
            <span>{moment.timeLabel}</span>
            <strong>{moment.momentLabel}</strong>
            <small>{moment.stateWord}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The three benefit treatments, named by SHAPE rather than by one campaign's
 * copy (§30 lists streaks among the forbidden mechanics, and a variant called
 * `streak` is unusable by the next Founder). Decorative: a card's meaning is
 * its title and its footer word, both of which are real text.
 */
function BenefitVisual({ variant }: { variant: BenefitCard['visualVariant'] }) {
  if (variant === 'bars') {
    return (
      <div className="pc-benefit__bars" aria-hidden="true">
        <span />
        <span />
        <span className="is-active" />
        <span />
      </div>
    );
  }
  if (variant === 'check') {
    return (
      <div className="pc-benefit__check" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="m5 12 4 4L19 6" />
        </svg>
      </div>
    );
  }
  return (
    <div className="pc-benefit__dots" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5, 6].map((n) => (
        <i key={n} className={n === 2 ? 'is-rest' : undefined} />
      ))}
    </div>
  );
}

/** §18 item 12 — one published update, with its audience label and local time. */
function UpdateEntry({ update, featured }: { update: CampaignUpdate; featured?: boolean }) {
  return (
    <article className={featured ? 'update update--featured' : 'update'}>
      <p className="update__meta">
        <span className="update__audience">{UPDATE_AUDIENCE_LABELS[update.audience]}</span>
        <When instant={new Date(update.publishedAt)} />
      </p>
      <div className="update__body">
        {update.title ? <h3 className="update__title">{update.title}</h3> : null}
        {update.isMaterialDeliveryChange && update.priorCommitment && update.revisedCommitment ? (
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
      </div>
      {/* A metric is both halves or neither (0049's CHECK). The label is the
          number's accessible name rather than a caption floating beside it —
          a bare `86%` reads as nothing at all to a screen reader. */}
      {update.metricLabel && update.metricValue ? (
        <p className="update__metric">
          <strong>{update.metricValue}</strong>
          <span>{update.metricLabel}</span>
        </p>
      ) : null}
    </article>
  );
}

/**
 * The reward's remaining line.
 *
 * A null limit renders NOTHING — never the word "unlimited", which would be a
 * scarcity signal invented where the record has none (§30). Zero renders
 * `Sold out`, and the card stays visible (§19).
 */
function remainingLabel(reward: RewardPackage): string | null {
  if (reward.limitedQuantity === null || reward.limitedQuantity === undefined) return null;
  const left = reward.remaining ?? 0;
  return left <= 0 ? 'Sold out' : `${left} left`;
}

export function CampaignPage({
  campaign,
  checkout,
}: {
  campaign: CampaignView;
  /** Present only for a real live campaign (§19). Samples never mount a card. */
  checkout?: { campaignId: string };
}) {
  const ended = campaign.ended ?? null;
  const rewards = campaign.rewards;
  const [selectedSku, setSelectedSku] = useState(campaign.featuredRewardSku);
  const selected = useMemo(
    () =>
      rewards.find((r) => r.sku === selectedSku) ??
      findReward(campaign, campaign.featuredRewardSku),
    [rewards, selectedSku, campaign],
  );

  const panelRef = useRef<HTMLElement>(null);
  const rewardsRef = useRef<HTMLDivElement>(null);

  /* The threshold bar fills from the left the first time it scrolls into view,
     and only the first time — a bar that re-fills on every pass is the
     attention farming §30 forbids. The end value is passed rather than read:
     see `fillOnScroll`, where getting this wrong renders a bar that is always
     full. It is the same ratio the Progress component announces. */
  const thresholdRatio =
    campaign.orderThreshold && campaign.thresholdProgress !== null
      ? campaign.thresholdProgress / campaign.orderThreshold
      : null;
  useEffect(() => {
    const panel = panelRef.current;
    const fill = panel?.querySelector<HTMLElement>('.progress__fill');
    if (!panel || !fill || thresholdRatio === null) return;
    return fillOnScroll(fill, panel, thresholdRatio);
  }, [campaign.slug, thresholdRatio]);

  const onRewardKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    moveFocus(event, [
      ...(rewardsRef.current?.querySelectorAll<HTMLButtonElement>('.pc-reward__choice') ?? []),
    ]);
  }, []);

  const counts = campaign.preorderCounts ?? null;
  const reserved = counts?.uniqueActiveBackers ?? null;
  const moments = campaign.demoMoments ?? [];
  const benefits = campaign.benefitCards ?? [];
  const updates = useMemo(
    () =>
      [...(campaign.updates ?? [])].sort(
        (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
      ),
    [campaign.updates],
  );
  const [latest, ...earlier] = updates;

  const heroHeadline = campaign.heroHeadline?.trim() || null;
  const heroAccent = campaign.heroHeadlineAccent?.trim() || null;
  const pullQuote = campaign.founderPullQuote?.trim() || null;
  const initials = campaign.founder.legalName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

  /** Checkout is reachable only from a real, open, non-sample campaign. */
  const liveCheckout = checkout && !ended && !campaign.isSample ? checkout : null;
  const checkoutReward = {
    sku: selected.sku,
    title: selected.title,
    priceCents: selected.priceCents,
    delivery: selected.delivery,
  };
  const soldOut = (selected.remaining ?? null) === 0;
  const canCheckOut = Boolean(liveCheckout) && !soldOut;

  return (
    <>
      {/* §18 discovery: Days 1–7 are excluded from indexing. React 19 hoists this. */}
      {campaign.indexable === false ? <meta name="robots" content="noindex, nofollow" /> : null}

      {campaign.isSample ? <SampleBanner /> : null}
      {ended ? <EndedBanner kind={ended} campaign={campaign} /> : null}
      {campaign.attribution ? <AttributionArrival attribution={campaign.attribution} /> : null}

      {/* ── HERO — item 1, and the first of the two scroll-only actions ────── */}
      <section className="pc-hero" id="top">
        <div className="pc-hero__copy">
          {heroHeadline ? (
            <>
              <p className="pc-kicker" id="campaign-title">
                <Tag variant="live">{MODEL_LABEL[campaign.model]}</Tag>
                <span>{campaign.title}</span>
              </p>
              <h1 className="pc-hero__h1" id="campaign-hero">
                {heroHeadline}
                {heroAccent ? (
                  <>
                    {' '}
                    <span>{heroAccent}</span>
                  </>
                ) : null}
              </h1>
            </>
          ) : (
            <>
              <p className="pc-kicker">
                <Tag variant="live">{MODEL_LABEL[campaign.model]}</Tag>
              </p>
              <h1 className="pc-hero__h1" id="campaign-title">
                {campaign.title}
              </h1>
            </>
          )}
          {campaign.tagline ? <p className="pc-hero__lede">{campaign.tagline}</p> : null}
          <div className="pc-hero__actions">
            <a className="btn btn--primary pc-hero__cta" href="#campaign-rewards">
              Reserve {selected.title} for {formatUsd(selected.priceCents)}
            </a>
            <span className="pc-hero__today">
              <strong>{formatUsd(0n)}</strong> today
            </span>
          </div>
          {/* §30: a count renders only where a real record produced it. Zero is
              "be the first", never a fabricated or rounded-up number. */}
          {reserved !== null ? (
            <p className="pc-hero__social">
              {reserved > 0 ? (
                <>
                  <span className="pc-avatars" aria-hidden="true">
                    <i>{initials}</i>
                    {reserved > 1 ? <i>+{reserved - 1}</i> : null}
                  </span>
                  <strong>
                    {reserved} {reserved === 1 ? 'person has' : 'people have'} pre-ordered
                  </strong>
                </>
              ) : (
                <strong>Be the first to pre-order</strong>
              )}
            </p>
          ) : null}
        </div>

        {moments.length > 0 ? (
          <DemoStage
            moments={moments}
            wordmark={campaign.title}
            contextLabel={campaign.demoContextLabel ?? null}
          />
        ) : null}
      </section>

      {/* ── BENEFITS — presentation of the Founder's own product ───────────── */}
      {benefits.length > 0 ? (
        <Section className="pc-benefits" wrap={false} aria-labelledby="campaign-benefits">
          <h2 className="pc-display" id="campaign-benefits">
            {campaign.benefitsHeading ?? 'Why it works'}
          </h2>
          <div className="pc-benefit-grid">
            {benefits.map((card) => (
              <article key={card.id} className={`pc-benefit pc-benefit--${card.visualVariant}`}>
                <h3>{card.title}</h3>
                <BenefitVisual variant={card.visualVariant} />
                <strong>{card.footerWord}</strong>
              </article>
            ))}
          </div>
        </Section>
      ) : null}

      {/* ── STORY — item 10 ────────────────────────────────────────────────── */}
      <Section className="pc-story" wrap={false} aria-labelledby="campaign-story">
        <div className="pc-founder-mark">
          <span aria-hidden="true">{initials}</span>
          <p>
            <strong>{campaign.founder.legalName}</strong>
            <small>Founder</small>
          </p>
        </div>
        <h2 className="pc-display" id="campaign-story">
          {pullQuote ?? 'The story'}
        </h2>
        <div className="pc-story__expand">
          <Accordion
            items={[
              {
                value: 'story',
                head: 'Read the full story',
                body: (
                  <div className="pc-story__cols">
                    {campaign.story.map((section) => (
                      <div key={section.heading}>
                        <h3>{section.heading}</h3>
                        {section.paragraphs.map((paragraph) => (
                          <p key={paragraph.slice(0, 40)}>{paragraph}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                ),
              },
            ]}
          />
        </div>
      </Section>

      {/* ── THE CAMPAIGN PANEL — items 4, 5 and 6 ──────────────────────────── */}
      <Mode kind="dark" className="pc-campaign">
        <section className="pc-panel" ref={panelRef} aria-labelledby="campaign-progress">
          <div className="pc-count">
            {/* The eyebrow is `Order threshold`, never the reference's own
                word for it: §3.2 bans that word for an Idea threshold in every
                audience, and its last paragraph binds identifiers too. */}
            <span className="pc-count__eyebrow">
              {campaign.model === 'idea' ? 'Order threshold' : 'Pre-orders so far'}
            </span>
            <h2 className="pc-count__value" id="campaign-progress">
              {reserved ?? 0}
              {campaign.model === 'idea' && campaign.orderThreshold !== null ? (
                <small> of {campaign.orderThreshold}</small>
              ) : null}
            </h2>
            <p>
              {campaign.model === 'idea' && campaign.orderThreshold !== null
                ? reserved !== null && reserved < campaign.orderThreshold
                  ? `${campaign.orderThreshold - reserved} more unique Backers to unlock`
                  : 'The order threshold has been reached'
                : `${counts?.activeCount ?? 0} units reserved`}
            </p>
          </div>

          {/* Item 6 — Idea Campaigns only (§18's difference table). A Product
              Campaign has no public funding gate and draws no bar. */}
          {campaign.model === 'idea' && campaign.orderThreshold !== null ? (
            <div id="campaign-threshold">
              {campaign.thresholdProgress !== null ? (
                <Progress
                  className="pc-track"
                  label="Progress toward the order threshold"
                  value={campaign.thresholdProgress / campaign.orderThreshold}
                  valueText={`${campaign.thresholdProgress} of ${campaign.orderThreshold} unique Backers`}
                />
              ) : null}
              <p className="pc-panel__note">
                This campaign charges only if{' '}
                <strong>{campaign.orderThreshold} unique Backers</strong> hold an active pre-order
                at the close date. A cancelled pre-order does not count.
              </p>
            </div>
          ) : null}

          {/* Item 4 — the campaign-type badge paired with its plain charge rule. */}
          <div className="pc-rule">
            <h3 className="pc-panel__h3" id="campaign-charge-rule">
              When your card is charged
            </h3>
            <p className="pc-panel__lede">
              <Tag variant="live">{MODEL_LABEL[campaign.model]}</Tag> {chargeRule(campaign)}.
            </p>
            <ol className="pc-steps">
              <li>
                <span aria-hidden="true">1</span>
                <strong>Reserve — {formatUsd(0n)} today</strong>
              </li>
              <li>
                <span aria-hidden="true">2</span>
                <strong>
                  {campaign.model === 'idea' && campaign.orderThreshold !== null
                    ? `Reach ${campaign.orderThreshold} unique Backers`
                    : 'Pre-orders close'}
                </strong>
              </li>
              <li>
                <span aria-hidden="true">3</span>
                <strong>Charged once, the exact total you authorized</strong>
              </li>
            </ol>
            {campaign.model === 'idea' ? (
              <p>
                Your card is saved when you pre-order and nothing is taken that day. If this
                campaign reaches its order threshold at the close date, the exact total you
                authorized is charged then. If it does not, no charge is created and your saved card
                loses future-charge eligibility for this campaign.
              </p>
            ) : (
              <p>
                Your card is saved when you pre-order and nothing is taken that day. The exact total
                you authorized is charged on the close date. There is no threshold on a Product
                Campaign.
              </p>
            )}
          </div>

          {/* Item 5 — opens and closes, viewer-local with UTC available. */}
          <div className="pc-dates">
            <h3 className="pc-panel__h3" id="campaign-dates">
              Opens and closes
            </h3>
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
            {/*
              The reference states a bare `Cancel before August 15`. This says
              the same thing without a SECOND copy of the close date: the row
              directly above already carries it local-primary with UTC beside
              it (§27.1), and a restated date is one that can disagree with the
              one it restates.
            */}
            <p className="pc-panel__cancel">
              You can cancel free any time before pre-orders close, and nothing is charged if you
              do.
            </p>
          </div>
        </section>
      </Mode>

      {/* ── THE SELLER BAND — items 2, 7 and 8, above the pre-order action ─── */}
      <Mode kind="dark">
        <Section className="pc-seller" wrap={false} aria-labelledby="campaign-mor">
          <h2 className="h2" id="campaign-mor">
            Who is selling this
          </h2>
          <p className="pc-seller__lede">
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

          <div className="pc-seller__grid">
            <div>
              <h3 id="campaign-founder">Who you are buying from</h3>
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
            </div>

            <div>
              <h3 id="campaign-refunds">Refunds and delivery</h3>
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
                  <h4>{campaign.founderRefundPolicy.title}</h4>
                  <p>
                    Version {campaign.founderRefundPolicy.version}, effective{' '}
                    {formatCalendarDate(campaign.founderRefundPolicy.effectiveDate)}. This is the
                    version preserved with your pre-order; it cannot be changed after you agree to
                    it.
                  </p>
                  <ul className="doc-list">
                    {campaign.founderRefundPolicy.summary.map((item) => (
                      <li key={item.slice(0, 40)}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </Section>
      </Mode>

      {/* ── REWARDS — items 3 and 9 ────────────────────────────────────────── */}
      <Section className="pc-rewards" wrap={false} aria-labelledby="campaign-rewards">
        <h2 className="pc-display" id="campaign-rewards">
          {campaign.rewardsHeading ?? 'Reward packages'}
        </h2>
        <p className="pc-rewards__pretax">
          Prices are shown before sales tax. Sales tax is calculated at checkout for your billing
          address and added on top.
        </p>
        <div
          className="pc-reward-grid"
          role="group"
          aria-label="Choose a reward package"
          ref={rewardsRef}
          onKeyDown={onRewardKeyDown}
        >
          {rewards.map((reward) => {
            const isSelected = reward.sku === selected.sku;
            const left = remainingLabel(reward);
            const out = (reward.remaining ?? null) === 0;
            return (
              <article
                key={reward.sku}
                className={isSelected ? 'pc-reward is-selected' : 'pc-reward'}
              >
                {/* §19: a sold-out reward stays VISIBLE and unavailable, never
                    hidden — a Backer has to be able to see what ran out. */}
                <button
                  type="button"
                  className="pc-reward__choice"
                  aria-pressed={isSelected}
                  disabled={out}
                  onClick={() => setSelectedSku(reward.sku)}
                >
                  <span className="pc-reward__top">
                    {reward.badge ? (
                      <span className="pc-reward__badge">{reward.badge}</span>
                    ) : (
                      <span />
                    )}
                    <span className="pc-reward__mark" aria-hidden="true" />
                  </span>
                  <span className="pc-reward__title">{reward.title}</span>
                  <span className="pc-reward__price">{formatUsd(reward.priceCents)}</span>
                  <span className="pc-reward__pretax">before sales tax</span>
                  <span className="pc-reward__contents">
                    {reward.contents.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </span>
                  <span className="pc-reward__meta">
                    <span>{reward.delivery}</span>
                    {left ? <span>{left}</span> : null}
                  </span>
                </button>
                <dl className="kv kv--tight pc-reward__facts">
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
              </article>
            );
          })}
        </div>

        {/* Item 9 — the pre-order action with §18's compact summary beside it. */}
        <div className="pc-preorder" id="campaign-preorder">
          <h3>Reserve a pre-order</h3>
          <ul className="compact-summary">
            <li>Card saved today — nothing is charged</li>
            <li>{chargeRule(campaign)}</li>
            <li>
              {campaign.model === 'idea' ? 'Delivery window' : 'Delivery'} for {selected.title}:{' '}
              {selected.delivery}
            </li>
          </ul>
          <p>
            {selected.title} — {formatUsd(selected.priceCents)} before sales tax. Sales tax is added
            at checkout and the exact total is shown before you authorize anything.
          </p>
          {liveCheckout && canCheckOut ? (
            // §19: the real pre-order checkout opens in a Drawer. A card field
            // is mounted only here, for a live campaign — never on a sample.
            <CheckoutDrawer
              campaignId={liveCheckout.campaignId}
              reward={checkoutReward}
              model={campaign.model}
              founderLegalName={campaign.founder.legalName}
              triggerLabel={`Reserve ${selected.title}`}
            />
          ) : (
            <Button tier="primary" disabled aria-describedby="campaign-preorder-note">
              {ended
                ? 'Pre-orders are closed'
                : soldOut
                  ? `${selected.title} is sold out`
                  : 'Reserve a pre-order'}
            </Button>
          )}
          <p id="campaign-preorder-note">{preorderNote(campaign, ended)}</p>
          <PreorderConsent campaign={campaign} ended={ended} />
        </div>
      </Section>

      {/* ── UPDATES — item 12 ──────────────────────────────────────────────── */}
      <Section className="pc-build" wrap={false} aria-labelledby="campaign-updates">
        <h2 className="pc-display" id="campaign-updates">
          {campaign.updatesHeading ?? 'Updates'}
        </h2>
        {latest ? (
          <div className="update-list">
            <UpdateEntry update={latest} featured />
            {earlier.length > 0 ? (
              <Accordion
                items={[
                  {
                    value: 'archive',
                    head: `View ${earlier.length} earlier update${earlier.length === 1 ? '' : 's'}`,
                    body: (
                      <div className="update-archive">
                        {earlier.map((update) => (
                          <UpdateEntry key={update.id} update={update} />
                        ))}
                      </div>
                    ),
                  },
                ]}
              />
            ) : null}
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
      </Section>

      {/* ── FAQ — item 11 ──────────────────────────────────────────────────── */}
      <Mode kind="light">
        <Section className="pc-faq" wrap={false} aria-labelledby="campaign-faq">
          <h2 className="pc-display" id="campaign-faq">
            {campaign.faqHeading ?? 'Questions people ask'}
          </h2>
          <div className="pc-faq__list">
            <Accordion
              defaultValue={campaign.faq[0]?.question ?? ''}
              items={campaign.faq.map((entry) => ({
                value: entry.question,
                head: entry.question,
                body: <p>{entry.answer}</p>,
              }))}
            />
          </div>
        </Section>
      </Mode>

      {/* ── COMMENTS — item 13 ─────────────────────────────────────────────── */}
      <Section className="pc-comments" aria-labelledby="campaign-comments">
        <h2 className="h2" id="campaign-comments">
          Comments
        </h2>
        <p>
          Only a Backer signed in through the link in their confirmation email can post, and
          comments show a Backer number or a chosen display name — never an email address. New
          comments close when the campaign does.
        </p>
        <EmptyPanel
          state={
            campaign.isSample ? 'No comments on this sample' : 'The comment thread is not open yet'
          }
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
      </Section>

      {/* ── ITEM 14 — legal and support, as the reference's dark footer band ─
           Two dark bands read as one footer: this one, then `<SiteFooter/>`. */}
      <Mode kind="dark">
        <Section className="pc-foot" wrap={false} aria-labelledby="campaign-support">
          <div className="pc-foot__lead">
            <h2 className="h2" id="campaign-support">
              Support for this campaign
            </h2>
            <p className="pc-foot__platform">
              {campaign.title}
              {campaign.platformLine ? ` · ${campaign.platformLine}` : ''}
            </p>
          </div>
          <div className="pc-foot__body">
            <p>
              Questions about the product, the delivery, or a refund go to{' '}
              {campaign.founder.legalName} through Proovd support: we acknowledge immediately, a
              person replies within one business day, and we follow up if the Founder has not
              responded within 48 hours.
            </p>
            <p>
              Questions about the Proovd platform itself go to{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
            </p>
            <p>
              Expected statement descriptor: <strong>{campaign.statementDescriptor}</strong>
            </p>
            <Button tier="secondary" href={supportMailto(`Question about ${campaign.title}`)}>
              Email us about this campaign
            </Button>
          </div>
        </Section>
      </Mode>

      {/* ── The phone dock — the second of the two controls that open checkout */}
      {liveCheckout && canCheckOut ? (
        <Dock className="pc-dock">
          <div className="pc-dock__what">
            <span>{selected.title}</span>
            <strong>{formatUsd(selected.priceCents)} later</strong>
          </div>
          <CheckoutDrawer
            campaignId={liveCheckout.campaignId}
            reward={checkoutReward}
            model={campaign.model}
            founderLegalName={campaign.founder.legalName}
            triggerLabel="Reserve"
          />
        </Dock>
      ) : null}
    </>
  );
}
