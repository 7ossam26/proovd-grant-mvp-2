/**
 * The Founder preview — Spec §15, §18, §33.4.
 *
 * §15: the Founder sees "the complete public campaign exactly as a Backer
 * will, including … Checkout drawer preview with correct campaign-specific
 * consent, subtotal/tax/total examples." So this assembles the same
 * `CampaignView` the public campaign page renders from and reuses the exact
 * A.3/A.4 `consentPreview` — the Backer-facing consent, verbatim.
 *
 * ── It collects no payment information ──────────────────────────────────────
 * §18/§34's rule for samples, applied to the preview: there is no card input,
 * no Stripe Elements mount, and no submit path anywhere on this surface. The
 * checkout drawer is a preview and says so, and the amounts are labelled as an
 * example (there is no Backer and no billing address to tax against).
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { formatUsd } from '@proovd/shared';
import { Button, Card, Measure, NO_ACTION, Section, StatePanel, Tag } from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import { consentPreview } from '../../features/public/campaign/consent.js';
import type { CampaignView } from '../../features/public/campaign/types.js';
import { fetchPreview, FounderRequestError, type CampaignPreview as Preview } from './api.js';

/** Assembles the public `CampaignView` from the build preview projection. */
function toCampaignView(p: Preview): CampaignView | null {
  if (!p.opensAt || !p.closesAt || p.rewards.length === 0 || !p.featuredRewardSku) return null;
  const example = p.example;
  if (!example) return null;
  return {
    slug: 'preview',
    model: p.model,
    title: p.title,
    tagline: p.tagline,
    founder: {
      legalName: p.founder.legalName,
      entity: p.founder.entity,
      country: p.founder.country,
      profile: p.founder.profile,
    },
    opensAt: new Date(p.opensAt),
    closesAt: new Date(p.closesAt),
    rewards: p.rewards.map((r) => ({
      sku: r.sku,
      title: r.title,
      priceCents: BigInt(r.priceCents),
      contents: r.contents,
      delivery: r.delivery,
      fulfillment: r.fulfillment,
    })),
    featuredRewardSku: p.featuredRewardSku,
    sampleSalesTaxCents: BigInt(example.salesTaxCents),
    orderThreshold: p.orderThreshold,
    thresholdProgress: p.model === 'idea' ? 0 : null,
    momentum: p.model === 'product' ? { uniqueBackers: 0, unitsReserved: 0 } : null,
    statementDescriptor: p.statementDescriptor,
    story: p.story ? [{ heading: 'The story', paragraphs: p.story.split('\n\n') }] : [],
    faq: p.faq,
    refundSummary: [],
    founderRefundPolicy:
      p.model === 'product' && p.founderRefundPolicy?.title
        ? {
            title: p.founderRefundPolicy.title,
            version: p.founderRefundPolicy.version ?? '',
            effectiveDate: p.founderRefundPolicy.effectiveDate ?? '2026-01-01',
            anchor: '#refund-policy',
            summary: p.founderRefundPolicy.text ? [p.founderRefundPolicy.text] : [],
          }
        : null,
    commentsEnabled: false,
    isSample: false,
  };
}

export function CampaignPreview() {
  const { campaignId = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; preview: Preview }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { preview } = await fetchPreview(campaignId);
        if (cancelled) return;
        if (!preview) {
          setState({ status: 'error', message: 'There is nothing to preview yet. Build your campaign first.' });
          return;
        }
        setState({ status: 'ready', preview });
      } catch (caught) {
        if (cancelled) return;
        setState({
          status: 'error',
          message:
            caught instanceof FounderRequestError
              ? (caught.detail.whatHappened ?? 'The preview could not be loaded.')
              : 'The preview could not be loaded.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (state.status === 'loading') {
    return (
      <Measure>
        <StatePanel
          state="Building your preview"
          whatHappened="Proovd is assembling your campaign as a Backer will see it."
          next="It appears in a moment."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action={NO_ACTION}
          reference={campaignId}
        />
      </Measure>
    );
  }

  if (state.status === 'error') {
    return (
      <Measure>
        <StatePanel
          state="Nothing to preview yet"
          whatHappened={state.message}
          next="Go back to the build and add the essentials."
          owner="Proovd"
          nextUpdate="When your build is further along"
          action={
            <Button tier="secondary" onClick={() => void navigate(`/campaigns/${campaignId}/build`)}>
              Back to the build
            </Button>
          }
          reference={campaignId}
          getHelp={{ href: supportMailto(`Preview — ${campaignId}`) }}
        />
      </Measure>
    );
  }

  const p = state.preview;
  const view = toCampaignView(p);
  const consent = view ? safeConsent(view) : null;

  return (
    <Measure>
      <Section>
        <Tag variant="mint">Preview</Tag>
        <h1>{p.title}</h1>
        {p.tagline ? <p>{p.tagline}</p> : null}
        <p className="field-hint">
          This is how your campaign will look to a Backer. It collects no payment information — the
          amounts below are an example.
        </p>
      </Section>

      <Card>
        <h2>{p.model === 'idea' ? 'Idea Campaign' : 'Product Campaign'}</h2>
        <dl className="kv">
          <Row label="By">{p.founder.legalName} ({p.founder.entity})</Row>
          {p.orderThreshold !== null ? <Row label="Order threshold">{p.orderThreshold}</Row> : null}
          {p.opensAt ? <Row label="Opens">{p.opensAt.replace('T', ' ').slice(0, 16)} UTC</Row> : null}
          {p.closesAt ? <Row label="Closes">{p.closesAt.replace('T', ' ').slice(0, 16)} UTC</Row> : null}
        </dl>
      </Card>

      {p.rewards.length > 0 ? (
        <Card>
          <h2>Rewards</h2>
          {/* §33.11.2: the rows are `dt`/`dd`, so they need the `dl` around
              them — without it each reward is an orphaned term. */}
          <dl className="kv">
            {p.rewards.map((r) => (
              <div className="kv__row" key={r.sku}>
                <dt>
                  {r.title} — {formatUsd(BigInt(r.priceCents))}
                </dt>
                <dd>
                  {r.contents.join(', ')} · Delivery {r.delivery}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : null}

      {p.story ? (
        <Card>
          <h2>The story</h2>
          <p>{p.story}</p>
        </Card>
      ) : null}

      {/* The checkout drawer preview — consent and example amounts, no card. */}
      <Card>
        <h2>Checkout preview</h2>
        {consent ? (
          <>
            <p>{consent.intro}</p>
            <dl className="kv">
              {consent.amounts.map((a) => (
                <Row key={a.label} label={a.label}>
                  {a.value}
                </Row>
              ))}
            </dl>
            <p className="field-hint">{consent.leadIn}</p>
            <ul>
              {consent.bullets.map((bullet, i) => (
                <li key={i}>{bullet}</li>
              ))}
            </ul>
            <p>{consent.agreement}</p>
            {/* §33.4: the action is disabled and mounts no payment field. */}
            <Button tier="primary" disabled>
              {consent.actionLabel} (preview only — no payment collected)
            </Button>
          </>
        ) : (
          <p className="field-hint">
            Add your dates, at least one reward, and (for a Product Campaign) your refund policy to
            preview the checkout consent.
          </p>
        )}
      </Card>

      <Button tier="tertiary" onClick={() => void navigate(`/campaigns/${campaignId}/build`)}>
        Back to the build
      </Button>
    </Measure>
  );
}

function safeConsent(view: CampaignView) {
  try {
    return consentPreview(view);
  } catch {
    return null;
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="kv__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
