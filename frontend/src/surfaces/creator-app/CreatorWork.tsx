/**
 * The Creator's work surface — Creator Flow v2, Session F, 2026-08-20.
 *
 * §17's *"After readiness/activation, show:"* is thirteen bullets and this is
 * that list, redrawn to the reference's `work` screen. `CREATOR_WORK_ITEMS`
 * carries the bullets beside the payload field each is answered by, so "every
 * §17 bullet has a field" is a count the suite performs rather than a claim.
 *
 * This replaces `surfaces/creator/CreatorPartnership.tsx` at the same address:
 * §27.3 emails, the Creators workspace, and whatever a Creator bookmarked all
 * point at `/creator/campaigns/:associationId/partnership`, and moving it would
 * have been a rename with no benefit.
 *
 * ── Six of the reference's controls are refused, and each says why ─────────
 * `Withdraw`, the `Base commission` / `Performance bonus` split, `Customize`,
 * `Generate milestone graphic`, `Request a 1-1 meeting`, the Backer survey
 * quotes, and `Best time to post`. Every one is in `CREATOR_FLOW_ABSENCES` with
 * its rule, and the surface renders the sentence WHERE the control would have
 * been — so re-adding one means deleting the sentence that refuses it.
 *
 * ── Four things the reference never drew, which §-required records already had
 * The safe link test (§14.1), the seven §20 obligations, the §29.1 self-pre-order
 * disclosure and the §29.2 conflict disclosure — `CREATOR_FLOW_OMISSIONS`' whole
 * Session F list.
 *
 * ── No arithmetic on an amount ────────────────────────────────────────────
 * `formatUsd` over a stored cents value, and nothing else. §24.4's split is
 * three separate stored numbers and the reference's `earned * 0.8` is browser
 * arithmetic with invented weights.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import {
  CREATOR_TERMINATION_DECIDES_NO_MONEY,
  EARNINGS_ARE_NOT_WITHDRAWN,
  FIRST_POST_IS_SUBMITTED_FOR_VERIFICATION,
  LINK_TEST_EARNS_NOTHING,
  MATERIALS_ARE_NOT_GENERATED,
  TAX_DOCUMENTS_ARE_STRIPES,
  TERMINATION_IS_CLASSIFIED_BY_A_PERSON,
  TERMINATION_REASONS,
  TONE_IS_SHOWN_NEVER_APPLIED,
  VERIFICATION_MOVES_NO_MONEY,
  formatUsd,
} from '@proovd/shared';
import {
  Button,
  Card,
  Choice,
  Copylink,
  Field,
  Input,
  NO_ACTION,
  Option,
  StatePanel,
  Tag,
  Textarea,
} from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import {
  CreatorRequestError,
  discloseConflict,
  discloseOwnPreorder,
  fetchPartnership,
  requestPartnershipEnd,
  submitFirstPost,
  type CreatorPartnership,
} from '../creator/api.js';

function localTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const FIRST_POST_LABELS: Record<string, string> = {
  submitted: 'Submitted — awaiting verification',
  passed: 'Verified',
  correction_needed: 'Correction needed',
  rejected: 'Rejected',
};

/** §29.2's own vocabulary. A closed list, because the record CHECKs it. */
const CONFLICT_KINDS: Array<{ id: string; label: string }> = [
  { id: 'family', label: 'Family' },
  { id: 'employment', label: 'I work for them, or they for me' },
  { id: 'financial_interest', label: 'I have a financial interest in the campaign' },
  { id: 'other', label: 'Something else' },
];

export function CreatorWork() {
  const { associationId = '' } = useParams();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; title: string; message: string }
    | { status: 'ready'; partnership: CreatorPartnership }
  >({ status: 'loading' });
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { partnership } = await fetchPartnership(associationId);
      setState({ status: 'ready', partnership });
    } catch (caught) {
      const detail = caught instanceof CreatorRequestError ? caught.detail : null;
      setState({
        status: 'error',
        title: detail?.title ?? 'This could not be loaded',
        message: detail?.whatHappened ?? 'Your campaign workspace could not be loaded.',
      });
    }
  }, [associationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === 'loading') {
    return (
      <div className="cra-page">
        <StatePanel
          state="Loading your campaign"
          whatHappened="Proovd is gathering your link, your terms, and your latest numbers."
          next="It appears in a moment."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action={NO_ACTION}
          reference={associationId}
        />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="cra-page">
        <StatePanel
          state={state.title}
          whatHappened={state.message}
          next="Open your campaigns to pick one."
          owner="Proovd"
          nextUpdate="No update pending"
          action={
            <Button tier="secondary" href="/creator/campaigns">
              Your campaigns
            </Button>
          }
          reference={associationId}
          getHelp={{ href: supportMailto(`Campaign — ${associationId}`) }}
        />
      </div>
    );
  }

  const p = state.partnership;

  return (
    <div className="cra-page">
      <header className="cra-page__head">
        <Tag variant={p.readiness.ready ? 'mint' : 'live'}>{p.readiness.label}</Tag>
        <h1>{p.product.title}</h1>
        <p className="cra-lede">
          Your campaign with {p.founder.displayName}.{' '}
          {p.product.model === 'idea' ? 'Idea Campaign' : 'Product Campaign'} ·{' '}
          <a href={p.product.publicUrl}>the public page</a>
        </p>
        <p className="cra-fresh">
          These numbers are worked out each time you open this page, not live.{' '}
          <strong>Updated {localTime(p.updatedAt)}</strong>
        </p>
        {notice ? (
          <p role="status" className="cra-notice">
            {notice}
          </p>
        ) : null}
      </header>

      <LinkAndDisclosure partnership={p} />
      <FirstPost partnership={p} onDone={load} onNotice={setNotice} />
      <Performance partnership={p} />
      <Money partnership={p} />
      <BrandAndRewards partnership={p} />
      <Materials partnership={p} />
      <Obligations partnership={p} />
      <Disclosures associationId={p.associationId} onNotice={setNotice} />
      <ManageThePartnership associationId={p.associationId} onNotice={setNotice} />

      <Card>
        <h2>Need help?</h2>
        <p className="cra-help">
          Somebody at Proovd reads every message about a campaign you are on. That is the route for
          anything here — including anything about the Founder.
        </p>
        <Button tier="secondary" href={supportMailto(`Campaign — ${p.product.title}`)}>
          Message Proovd about this campaign
        </Button>
      </Card>
    </div>
  );
}

/* ── §17: the link, the disclosure, and §14.1's safe test ────────────────── */

function LinkAndDisclosure({ partnership: p }: { partnership: CreatorPartnership }) {
  return (
    <Card>
      <h2>Your link and disclosure</h2>
      {p.trackingLink ? (
        <>
          <p className="cra-help">
            {p.trackingLink.active
              ? p.trackingLink.pausedAt
                ? 'Your link is paused while a correction is sorted out. Traffic during the pause earns nothing.'
                : 'Your link is live. Share it, and always include the disclosure below.'
              : 'Your link is not active yet. It goes live when the campaign launches.'}
          </p>
          <Copylink url={p.trackingLink.url} display={p.trackingLink.url} />
          <p className="cra-help">{LINK_TEST_EARNS_NOTHING}</p>
          <Copylink url={p.trackingLink.testUrl} display={p.trackingLink.testUrl} />
          <h3>Required disclosure</h3>
          <p className="disclosure-text">{p.trackingLink.disclosureText}</p>
          <Copylink url={p.trackingLink.disclosureText} display="Copy the disclosure" />
        </>
      ) : (
        <p className="cra-help">Your tracking link appears once your terms are locked.</p>
      )}
      <dl className="kv">
        <Row label="Joined">{localTime(p.joinedAt)}</Row>
        {p.trackingLink?.activatedAt ? (
          <Row label="Link went live">{localTime(p.trackingLink.activatedAt)}</Row>
        ) : null}
        {p.product.closesAt ? <Row label="Campaign ends">{localTime(p.product.closesAt)}</Row> : null}
      </dl>
      {p.midCampaign ? (
        <>
          <h3>You joined part-way through</h3>
          <p>{p.midCampaign.adjustedDeliverables}</p>
          <p className="cra-help">{p.midCampaign.attributionNote}</p>
        </>
      ) : null}
    </Card>
  );
}

/* ── §17 steps 4–5: the post is SUBMITTED, and Admin verifies it ─────────── */

function FirstPost({
  partnership: p,
  onDone,
  onNotice,
}: {
  partnership: CreatorPartnership;
  onDone: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitFirstPost(p.associationId, { postUrl: url.trim() });
      setUrl('');
      onNotice('Your post is with Proovd for verification. We will tell you the outcome.');
      await onDone();
    } catch (caught) {
      const detail = caught instanceof CreatorRequestError ? caught.detail : null;
      setError(detail?.whatHappened ?? 'That could not be submitted.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2>Your first post</h2>
      <dl className="kv">
        <Row label="State">
          {p.firstPost.status
            ? (FIRST_POST_LABELS[p.firstPost.status] ?? p.firstPost.status)
            : 'Not submitted yet'}
        </Row>
        {p.firstPost.submittedAt ? (
          <Row label="Submitted">{localTime(p.firstPost.submittedAt)}</Row>
        ) : null}
        {p.firstPost.correctionDetail ? (
          <Row label="What to correct">{p.firstPost.correctionDetail}</Row>
        ) : null}
      </dl>
      <p className="cra-help">{FIRST_POST_IS_SUBMITTED_FOR_VERIFICATION}</p>
      <p className="cra-help">{VERIFICATION_MOVES_NO_MONEY}</p>
      {p.firstPost.status === 'passed' ? null : (
        <>
          <Field label="Link to your post" hint="The full public URL, starting with https://">
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              inputMode="url"
              placeholder="https://"
            />
          </Field>
          {error ? (
            <p role="alert" className="cra-error">
              {error}
            </p>
          ) : null}
          <Button onClick={() => void submit()} disabled={busy || url.trim().length === 0}>
            Send my post for verification
          </Button>
        </>
      )}
    </Card>
  );
}

/* ── §17/§19: aggregate clicks, attributed pre-orders, conversion ────────── */

function Performance({ partnership: p }: { partnership: CreatorPartnership }) {
  return (
    <Card>
      <h2>How your link is doing</h2>
      <dl className="kv">
        <Row label="Clicks">{p.clicks.total}</Row>
        <Row label="Pre-orders through your link">{p.performance.attributedPreorders}</Row>
        <Row label="Still live">{p.performance.activePreorders}</Row>
        <Row label="Charged">{p.performance.capturedPreorders}</Row>
        <Row label="Conversion">
          {/* §16a: a rate over zero clicks is absent, never `0%`. */}
          {p.performance.conversionRate === null
            ? 'No clicks yet, so there is nothing to work this out from'
            : `${(p.performance.conversionRate * 100).toFixed(1)}%`}
        </Row>
        <Row label="Charged through your link">
          {formatUsd(BigInt(p.performance.capturedSubtotalCents))}
        </Row>
      </dl>
      <p className="cra-help">{p.performance.attributionNote}</p>
      {p.bonus ? (
        <>
          <h3>Your bonus</h3>
          <dl className="kv">
            <Row label="What it adds">+{p.bonus.additionalPercent}%</Row>
            <Row label="What triggers it">
              {p.bonus.triggerUnit === 'attributed_subtotal_cents'
                ? `${formatUsd(BigInt(p.bonus.thresholdValue))} charged through your link`
                : `${p.bonus.thresholdValue} different people pre-ordering through your link`}
            </Row>
            <Row label="Where you are">
              {p.bonus.triggerUnit === 'attributed_subtotal_cents'
                ? formatUsd(BigInt(p.bonus.progressValue))
                : p.bonus.progressValue}
            </Row>
            <Row label="Combined ceiling">{p.bonus.maxCombinedPercent}%</Row>
          </dl>
          <p className="cra-help">{p.bonus.note}</p>
        </>
      ) : null}
    </Card>
  );
}

/* ── §22.1: what you have earned, and why there is nothing to press ──────── */

function Money({ partnership: p }: { partnership: CreatorPartnership }) {
  return (
    <Card>
      <h2>What you have earned</h2>
      {p.compensation ? (
        <dl className="kv">
          <Row label="Your rate">
            {p.compensation.totalPercent}% of what is charged through your link, before tax
          </Row>
          <Row label="Base">{p.compensation.basePercent}%</Row>
          {p.compensation.bidIncreasePercent > 0 ? (
            <Row label="Your increase">+{p.compensation.bidIncreasePercent}%</Row>
          ) : null}
        </dl>
      ) : null}
      {p.earnings.statusBlock ? (
        <pre className="cra-b7">{p.earnings.statusBlock}</pre>
      ) : (
        <StatePanel
          state={p.earnings.label}
          whatHappened={p.earnings.reason}
          next={p.earnings.nextUpdate}
          owner={p.earnings.owner === 'Proovd' ? 'Proovd' : 'Proovd'}
          nextUpdate={p.earnings.nextUpdate}
          action={NO_ACTION}
          reference={p.associationId}
        />
      )}
      {p.fixedPayment.applicable ? (
        <p>
          <strong>Fixed Creator payment:</strong>{' '}
          {formatUsd(BigInt(p.fixedPayment.amountCents ?? '0'))} — {p.fixedPayment.label}
        </p>
      ) : null}
      {/* §22.1: there is no withdrawal, so the sentence stands where the
          reference put the control. */}
      <p className="cra-help">{EARNINGS_ARE_NOT_WITHDRAWN}</p>
      <p className="cra-help">{TAX_DOCUMENTS_ARE_STRIPES}</p>
      <Button tier="secondary" href="/creator/earnings">
        Your earnings across every campaign
      </Button>
    </Card>
  );
}

/* ── §17: brand notes, rewards, prices, delivery dates ───────────────────── */

function BrandAndRewards({ partnership: p }: { partnership: CreatorPartnership }) {
  return (
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
          <h3>What you must not claim</h3>
          <p>{p.brandRules.prohibitedClaims}</p>
        </>
      ) : null}
      {p.brandRules.brandVoice ? (
        <>
          <h3>How the Founder wants it to sound</h3>
          <p>{p.brandRules.brandVoice}</p>
          <p className="cra-help">{TONE_IS_SHOWN_NEVER_APPLIED}</p>
        </>
      ) : null}
      {p.rewards.length > 0 ? (
        <>
          <h3>Rewards and delivery</h3>
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
  );
}

/* ── §31.5's kit material, downloaded and never generated ────────────────── */

function Materials({ partnership: p }: { partnership: CreatorPartnership }) {
  return (
    <Card>
      <h2>The Founder's materials</h2>
      <p className="cra-help">{MATERIALS_ARE_NOT_GENERATED}</p>
      {p.materials.available && p.materials.assets.length > 0 ? (
        <ul className="doc-list">
          {p.materials.assets.map((a) => (
            <li key={a.id}>
              {a.filename ?? a.purpose} · {a.contentType}
            </li>
          ))}
        </ul>
      ) : (
        <p className="cra-help">
          {p.materials.unavailableBecause ??
            'The Founder has not supplied any files for this campaign yet.'}
        </p>
      )}
    </Card>
  );
}

/* ── §20's seven obligations — required, and never drawn by the reference ── */

function Obligations({ partnership: p }: { partnership: CreatorPartnership }) {
  return (
    <Card>
      <h2>What you agreed to do</h2>
      <dl className="kv">
        {p.obligations.map((o) => (
          <Row key={o.key} label={o.statement}>
            {o.enforcement}
          </Row>
        ))}
      </dl>
    </Card>
  );
}

/* ── §29.1 and §29.2 — two records the reference never drew a control for ── */

function Disclosures({
  associationId,
  onNotice,
}: {
  associationId: string;
  onNotice: (message: string) => void;
}) {
  const [selfNote, setSelfNote] = useState('');
  const [selfFunded, setSelfFunded] = useState(false);
  const [identity, setIdentity] = useState(false);
  const [kind, setKind] = useState('');
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fail = (caught: unknown) => {
    const d = caught instanceof CreatorRequestError ? caught.detail : null;
    setError(d?.whatHappened ?? 'That could not be recorded.');
  };

  return (
    <Card>
      <h2>Things you need to tell us</h2>

      <h3>If you pre-order through your own link</h3>
      <p className="cra-help">
        You may. You have to say so, and it earns you no commission — that is what makes it fine.
      </p>
      <Field label="What are you buying, and why">
        <Textarea value={selfNote} onChange={(event) => setSelfNote(event.target.value)} rows={2} />
      </Field>
      {/* §28.4: separate, unchecked controls. Neither implies the other. */}
      <Option
        label="I am paying for this myself, with my own money"
        checked={selfFunded}
        onCheckedChange={setSelfFunded}
      />
      <Option
        label="The Founder knows this pre-order is mine"
        checked={identity}
        onCheckedChange={setIdentity}
      />
      <Button
        tier="secondary"
        disabled={!selfNote.trim() || !selfFunded || !identity}
        onClick={() => {
          void (async () => {
            try {
              await discloseOwnPreorder(associationId, {
                intentNote: selfNote.trim(),
                selfFundedCertified: selfFunded,
                identityDisclosed: identity,
              });
              setSelfNote('');
              setSelfFunded(false);
              setIdentity(false);
              onNotice('Recorded. Thank you for telling us.');
            } catch (caught) {
              fail(caught);
            }
          })();
        }}
      >
        Record my own pre-order
      </Button>

      <h3>If you have a connection to this Founder</h3>
      <p className="cra-help">
        Family, a job, money in the company — anything that would surprise somebody reading your
        post. Telling us is not a problem; not telling us is.
      </p>
      <Choice
        name="conflict-kind"
        label="What kind of connection"
        value={kind}
        onValueChange={setKind}
        entries={CONFLICT_KINDS.map((k) => ({ value: k.id, label: k.label }))}
      />
      <Field label="Tell us about it">
        <Textarea value={detail} onChange={(event) => setDetail(event.target.value)} rows={2} />
      </Field>
      {error ? (
        <p role="alert" className="cra-error">
          {error}
        </p>
      ) : null}
      <Button
        tier="secondary"
        disabled={!kind || !detail.trim()}
        onClick={() => {
          void (async () => {
            try {
              await discloseConflict(associationId, { relationshipKind: kind, detail: detail.trim() });
              setKind('');
              setDetail('');
              onNotice('Recorded. Thank you for telling us.');
            } catch (caught) {
              fail(caught);
            }
          })();
        }}
      >
        Record the connection
      </Button>
    </Card>
  );
}

/* ── §29.5: the ask to end a partnership ─────────────────────────────────── */

function ManageThePartnership({
  associationId,
  onNotice,
}: {
  associationId: string;
  onNotice: (message: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const chosen = TERMINATION_REASONS.find((r) => r.id === reason);

  return (
    <Card>
      <h2>If you need this partnership to end</h2>
      <p className="cra-help">{CREATOR_TERMINATION_DECIDES_NO_MONEY}</p>
      <Choice
        name="end-reason"
        label="Why you are asking"
        value={reason}
        onValueChange={setReason}
        entries={TERMINATION_REASONS.map((r) => ({ value: r.id as string, label: r.label }))}
      />
      {chosen ? <p className="cra-help">{chosen.help}</p> : null}
      <Field label="What happened" hint={TERMINATION_IS_CLASSIFIED_BY_A_PERSON}>
        <Textarea value={detail} onChange={(event) => setDetail(event.target.value)} rows={3} />
      </Field>
      {error ? (
        <p role="alert" className="cra-error">
          {error}
        </p>
      ) : null}
      <Button
        tier="secondary"
        disabled={!reason || !detail.trim()}
        onClick={() => {
          void (async () => {
            try {
              const result = await requestPartnershipEnd(associationId, {
                reasonId: reason,
                detail: detail.trim(),
              });
              setReason('');
              setDetail('');
              onNotice(`Sent. Your reference is ${result.reference}.`);
            } catch (caught) {
              const d = caught instanceof CreatorRequestError ? caught.detail : null;
              setError(d?.whatHappened ?? 'That could not be sent.');
            }
          })();
        }}
      >
        Ask Proovd to end this partnership
      </Button>
    </Card>
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
