/**
 * The Creator active-partnership surface — Spec §18 item 6 (Phase 14c).
 *
 * A live Creator's working dashboard: the Founder and product, their unique
 * tracking link and disclosure text (both with copy confirmation), the brand
 * rules, the rewards, their locked compensation, the fixed-payment and
 * first-post state, their readiness, and their clicks.
 *
 * ── Refresh-based, never real time (§30) ────────────────────────────────────
 * The server stamps `updatedAt`; this renders "Updated [local time]" and says
 * plainly that the metrics are refresh-based. It never claims to be live.
 *
 * The pre-order/conversion/earnings/payout metrics do not exist until Phase 15
 * (reservations) and Phase 19 (money), so they render as a labelled "coming"
 * panel — never a fabricated zero (§1.4).
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { formatUsd } from '@proovd/shared';
import {
  Button,
  Card,
  Copylink,
  Measure,
  NO_ACTION,
  Section,
  StatePanel,
  Tag,
} from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import { fetchPartnership, CreatorRequestError, type CreatorPartnership } from './api.js';

function localTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const FIRST_POST_LABELS: Record<string, string> = {
  submitted: 'Submitted — awaiting verification',
  passed: 'Verified',
  correction_needed: 'Correction needed',
  rejected: 'Rejected',
};

export function CreatorPartnership() {
  const { associationId = '' } = useParams();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; title: string; message: string }
    | { status: 'ready'; partnership: CreatorPartnership }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { partnership } = await fetchPartnership(associationId);
        if (!cancelled) setState({ status: 'ready', partnership });
      } catch (caught) {
        if (cancelled) return;
        const detail = caught instanceof CreatorRequestError ? caught.detail : null;
        setState({
          status: 'error',
          title: detail?.title ?? 'This could not be loaded',
          message: detail?.whatHappened ?? 'Your partnership dashboard could not be loaded.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [associationId]);

  if (state.status === 'loading') {
    return (
      <Measure>
        <StatePanel
          state="Loading your partnership"
          whatHappened="Proovd is gathering your link, your terms, and your latest metrics."
          next="It appears in a moment."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action={NO_ACTION}
          reference={associationId}
        />
      </Measure>
    );
  }

  if (state.status === 'error') {
    return (
      <Measure>
        <StatePanel
          state={state.title}
          whatHappened={state.message}
          next="Open your campaigns to pick a partnership."
          owner="Proovd"
          nextUpdate="No update pending"
          action={
            <Button tier="secondary" href="/creator/campaigns">
              Your campaigns
            </Button>
          }
          reference={associationId}
          getHelp={{ href: supportMailto(`Partnership — ${associationId}`) }}
        />
      </Measure>
    );
  }

  const p = state.partnership;

  return (
    <Measure>
      <Section>
        <Tag variant={p.readiness.ready ? 'mint' : 'live'}>{p.readiness.label}</Tag>
        <h1>{p.product.title}</h1>
        <p className="field-hint">
          Your partnership with {p.founder.displayName}. Metrics here are refresh-based, not live —{' '}
          <strong>Updated {localTime(p.updatedAt)}</strong>.
        </p>
      </Section>

      {/* Tracking link + disclosure (§18: copy confirmation) */}
      <Card>
        <h2>Your link and disclosure</h2>
        {p.trackingLink ? (
          <>
            <p className="field-hint">
              {p.trackingLink.active
                ? p.trackingLink.pausedAt
                  ? 'Your link is paused while a correction is resolved. Traffic during the pause does not earn.'
                  : 'Your link is live. Share it, and always include the disclosure below.'
                : 'Your link is not active yet. It activates when the campaign launches.'}
            </p>
            <Copylink url={p.trackingLink.url} display="Your tracking link" />
            <p className="field-hint">
              Test it safely (this never counts as a click or a sale):
            </p>
            <Copylink url={p.trackingLink.testUrl} display="Safe test link" />
            <h3>Required disclosure</h3>
            <p className="disclosure-text">{p.trackingLink.disclosureText}</p>
            <Copylink url={p.trackingLink.disclosureText} display="Copy the disclosure" />
          </>
        ) : (
          <p className="field-hint">Your tracking link appears once your terms are locked.</p>
        )}
      </Card>

      {/* Readiness, first post, fixed payment */}
      <Card>
        <h2>Where you stand</h2>
        <dl className="kv">
          <Row label="Readiness">{p.readiness.label}</Row>
          <Row label="First post">
            {p.firstPost.status ? (FIRST_POST_LABELS[p.firstPost.status] ?? p.firstPost.status) : 'Not submitted yet'}
          </Row>
          {p.firstPost.correctionDetail ? (
            <Row label="Correction">{p.firstPost.correctionDetail}</Row>
          ) : null}
          <Row label="Joined">{localTime(p.joinedAt)}</Row>
          {p.trackingLink?.activatedAt ? (
            <Row label="Activated">{localTime(p.trackingLink.activatedAt)}</Row>
          ) : null}
          {p.product.closesAt ? <Row label="Campaign ends">{localTime(p.product.closesAt)}</Row> : null}
          {p.rosterMembership === 'mid_campaign' ? (
            <Row label="Joined mid-campaign">
              Your deliverables cover the time remaining from when you joined.
            </Row>
          ) : null}
        </dl>
        {p.fixedPayment.applicable ? (
          <p>
            <strong>Fixed payment:</strong> {formatUsd(BigInt(p.fixedPayment.amountCents ?? '0'))} —{' '}
            {p.fixedPayment.label}
            {p.fixedPayment.fundedAt ? ` (funded ${localTime(p.fixedPayment.fundedAt)})` : ''}.
          </p>
        ) : null}
      </Card>

      {/* Locked compensation */}
      {p.compensation ? (
        <Card>
          <h2>Your compensation</h2>
          <dl className="kv">
            <Row label="Total commission">{p.compensation.totalPercent}% of attributed sales (pre-tax)</Row>
            <Row label="Base">{p.compensation.basePercent}%</Row>
            {p.compensation.bidIncreasePercent > 0 ? (
              <Row label="Your increase">+{p.compensation.bidIncreasePercent}%</Row>
            ) : null}
          </dl>
          <p className="field-hint">These terms are locked and do not change.</p>
        </Card>
      ) : null}

      {/* Clicks (real now) + the deferred pre-order/earnings metrics */}
      <Card>
        <h2>Your metrics</h2>
        <dl className="kv">
          <Row label="Clicks">{p.clicks.total}</Row>
          <Row label="Attributed clicks">{p.clicks.attributed}</Row>
        </dl>
        <StatePanel
          state="Sales and earnings appear once the campaign takes pre-orders"
          whatHappened={p.pending.note}
          next="Keep posting — your attributed pre-orders and earnings will populate here."
          owner="Proovd"
          nextUpdate="As pre-orders come in, and after the campaign closes"
          action={NO_ACTION}
          reference={p.associationId}
        />
        <ul className="doc-list">
          {p.pending.fields.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </Card>

      {/* Brand rules + rewards */}
      <Card>
        <h2>Brand rules and rewards</h2>
        {p.brandRules.requiredWording ? (
          <>
            <h3>Required wording</h3>
            <p>{p.brandRules.requiredWording}</p>
          </>
        ) : null}
        {p.brandRules.prohibitedClaims ? (
          <>
            <h3>Prohibited claims</h3>
            <p>{p.brandRules.prohibitedClaims}</p>
          </>
        ) : null}
        {p.rewards.length > 0 ? (
          <>
            <h3>Rewards</h3>
            <dl className="kv">
              {p.rewards.map((r) => (
                <Row key={r.title} label={r.title}>
                  {formatUsd(BigInt(r.priceCents))} · {r.delivery}
                </Row>
              ))}
            </dl>
          </>
        ) : null}
      </Card>
    </Measure>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="kv__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
