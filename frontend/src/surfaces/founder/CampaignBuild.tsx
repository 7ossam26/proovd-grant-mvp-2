/**
 * The Founder's parallel campaign build — Spec §14.4, §15, §33.3.10, §33.4.1.
 *
 * ── One decision at a time (§14.4) ──────────────────────────────────────────
 * The build is a set of fields the Founder fills at their own pace; each
 * autosaves on blur and the server re-derives completeness. Campaign type is
 * read-only — there is no control to change it here.
 *
 * ── Review readiness is the server's answer, rendered ───────────────────────
 * `review_ready` is derived from both tracks (§23.2, §33.3.10); the surface
 * shows what still blocks it and enables Submit only when the server says
 * ready. Nothing here computes readiness — the same rule the workspace follows
 * for the fee.
 *
 * ── Changes-required feedback is grouped and deep-linked (§33.4.1) ──────────
 * When a review returns changes, the Required-before-resubmission and
 * Optional-improvements groups render with the owner, the due expectation, and
 * a deep link into the affected content. The draft is untouched.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { FEEDBACK_GROUP_LABELS } from '@proovd/shared';
import {
  Button,
  Card,
  Field,
  Input,
  Measure,
  NO_ACTION,
  Section,
  StatePanel,
  Tag,
} from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import {
  fetchBuild,
  saveBuild,
  saveRewardPackage,
  submitForReview,
  fetchLatestReview,
  FounderRequestError,
  type BuildState,
  type BuildFields,
  type LatestReview,
} from './api.js';

const READINESS_FIELD_LABELS: Record<string, string> = {
  title: 'Campaign title',
  founderDisplayName: 'Your display name',
  founderCountry: 'Country',
  founderProfileUrl: 'Profile link',
  opensAt: 'Open date/time',
  closesAt: 'Close date/time',
  brandPerception: 'Brand perception',
  brandVoice: 'Brand voice',
  heroPreference: 'Hero preference',
  publicStory: 'Public story',
  orderThreshold: 'Order threshold',
  deliveryWindow: 'Delivery window',
  earlyProductDisclaimer: 'Early-product disclaimer',
  risksAndChallenges: 'Risks and challenges',
  internalTargetCents: 'Internal momentum target',
  rewardPackages: 'At least one reward package',
  refundPolicy: 'Refund policy',
};

export function CampaignBuild() {
  const { campaignId = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; build: BuildState; review: LatestReview | null }
  >({ status: 'loading' });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [build, { review }] = await Promise.all([
        fetchBuild(campaignId),
        fetchLatestReview(campaignId),
      ]);
      setState({ status: 'ready', build, review });
    } catch (caught) {
      setState({
        status: 'error',
        message:
          caught instanceof FounderRequestError
            ? (caught.detail.whatHappened ?? 'The build could not be opened.')
            : 'The build could not be opened.',
      });
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = async (patch: Partial<BuildFields>) => {
    setSaving(true);
    try {
      await saveBuild(campaignId, patch);
      await load();
    } catch {
      // A refusal (e.g. not editable after submission) reloads to show truth.
      await load();
    } finally {
      setSaving(false);
    }
  };

  if (state.status === 'loading') {
    return (
      <Measure>
        <StatePanel
          state="Loading your campaign build"
          whatHappened="Proovd is fetching what you have built so far."
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
          state="The build is not available"
          whatHappened={state.message}
          next="Reload to try again."
          owner="Proovd"
          nextUpdate="When you contact us"
          action={NO_ACTION}
          reference={campaignId}
          getHelp={{ href: supportMailto(`Campaign build — ${campaignId}`) }}
          ring
        />
      </Measure>
    );
  }

  const { build, review } = state;
  const b = build.build;
  const editable =
    build.campaignStatus === 'affiliate_response_and_build' ||
    build.campaignStatus === 'changes_required';

  const submit = async () => {
    setSubmitError(null);
    try {
      await submitForReview(campaignId);
      await load();
    } catch (caught) {
      setSubmitError(
        caught instanceof FounderRequestError
          ? (caught.detail.whatHappened ?? 'Not ready to submit.')
          : 'Not ready to submit.',
      );
    }
  };

  return (
    <Measure>
      <Section>
        <h1>Build your campaign</h1>
        <p>
          This runs alongside your Creator roster. Fill it in at your own pace — each field saves on
          its own, and Proovd works out when you are ready to submit.
        </p>
        <p className="field-hint">
          Build status: <strong>{build.buildStatus.replace('_', ' ')}</strong>. Your campaign type
          is fixed and cannot be changed here.
        </p>
      </Section>

      {/* §33.4.1: changes-required feedback, grouped and deep-linked. */}
      {review && review.outcome === 'changes_required' ? (
        <ChangesRequired review={review} />
      ) : null}

      {/* Review-readiness summary (§33.3.10). */}
      <Card>
        <h2>Ready to submit?</h2>
        <dl className="kv">
          <Row label="Your build">{build.reviewReadiness.buildStatus.replace('_', ' ')}</Row>
          <Row label="Your Creator roster">
            {build.reviewReadiness.rosterStatus.replace('_', ' ')}
          </Row>
        </dl>
        {build.missing.length > 0 ? (
          <>
            <p className="field-hint">Still needed in your build:</p>
            <ul>
              {build.missing.map((key) => (
                <li key={key}>{READINESS_FIELD_LABELS[key] ?? key}</li>
              ))}
            </ul>
          </>
        ) : null}
        {submitError ? <p className="field-error" role="alert">{submitError}</p> : null}
        <div className="claim__actions">
          <Button
            tier="primary"
            disabled={!build.reviewReadiness.reviewReady || !editable}
            onClick={() => void submit()}
          >
            Submit for review
          </Button>
          <Button tier="secondary" onClick={() => void navigate(`/campaigns/${campaignId}/preview`)}>
            Preview as a Backer will see it
          </Button>
          <Button tier="tertiary" onClick={() => void navigate(`/campaigns/${campaignId}/roster`)}>
            Your Creator roster
          </Button>
        </div>
        {!editable ? (
          <p className="field-hint">
            This campaign is in review. Changes now go through your reviewer — a material change
            needs Creator reacceptance before it goes live.
          </p>
        ) : null}
      </Card>

      {/* The §14.4 shared ingredients. Autosave on blur. */}
      <Card>
        <h2>The essentials</h2>
        <TextField label="Campaign title" value={b?.title ?? ''} disabled={!editable} onSave={(v) => persist({ title: v })} />
        <TextField label="Your display name" value={b?.founderDisplayName ?? ''} disabled={!editable} onSave={(v) => persist({ founderDisplayName: v })} />
        <TextField label="Country" value={b?.founderCountry ?? ''} disabled={!editable} onSave={(v) => persist({ founderCountry: v })} />
        <TextField label="Profile link" value={b?.founderProfileUrl ?? ''} disabled={!editable} onSave={(v) => persist({ founderProfileUrl: v })} />
        <TextField label="Opens at (UTC ISO)" value={b?.opensAt ?? ''} disabled={!editable} onSave={(v) => persist({ opensAt: v || null })} />
        <TextField label="Closes at (UTC ISO)" value={b?.closesAt ?? ''} disabled={!editable} onSave={(v) => persist({ closesAt: v || null })} />
        <TextField label="Hero preference" value={b?.heroPreference ?? ''} disabled={!editable} onSave={(v) => persist({ heroPreference: v })} />
      </Card>

      <Card>
        <h2>Brand and story</h2>
        <TextField label="Brand perception" value={b?.brandPerception ?? ''} disabled={!editable} onSave={(v) => persist({ brandPerception: v })} />
        <TextField label="Brand voice" value={b?.brandVoice ?? ''} disabled={!editable} onSave={(v) => persist({ brandVoice: v })} />
        <TextField label="Required wording (optional)" value={b?.requiredWording ?? ''} disabled={!editable} onSave={(v) => persist({ requiredWording: v })} />
        <TextField label="Prohibited claims (optional)" value={b?.prohibitedClaims ?? ''} disabled={!editable} onSave={(v) => persist({ prohibitedClaims: v })} />
        <TextField label="Public story" value={b?.publicStory ?? ''} disabled={!editable} onSave={(v) => persist({ publicStory: v })} />
      </Card>

      {/* Reward packages (§14.4). */}
      <RewardPackages campaignId={campaignId} build={build} editable={editable} onChanged={load} />

      <p className="field-hint">{saving ? 'Saving…' : 'All changes saved.'}</p>
    </Measure>
  );
}

/* ── Changes-required feedback (§33.4.1) ───────────────────────────────────── */

function ChangesRequired({ review }: { review: LatestReview }) {
  return (
    <Card>
      <Tag variant="sage">Changes requested</Tag>
      <h2>Your reviewer asked for changes</h2>
      <dl className="kv">
        <Row label="Reviewer">{review.reviewer ?? 'Proovd review'}</Row>
        <Row label="Next update">{review.nextUpdateExpectation ?? 'When you resubmit'}</Row>
      </dl>
      {review.required.length > 0 ? (
        <>
          <h3>{FEEDBACK_GROUP_LABELS.required}</h3>
          {review.required.map((f, i) => (
            <FeedbackItem key={i} item={f} />
          ))}
        </>
      ) : null}
      {review.optional.length > 0 ? (
        <>
          <h3>{FEEDBACK_GROUP_LABELS.optional}</h3>
          {review.optional.map((f, i) => (
            <FeedbackItem key={i} item={f} />
          ))}
        </>
      ) : null}
      <p className="field-hint">
        Everything you built is still here. Make the changes and submit again.
      </p>
    </Card>
  );
}

function FeedbackItem({ item }: { item: LatestReview['required'][number] }) {
  return (
    <div className="kv__row">
      <dt>
        {/* §33.4.1: deep-link to the affected content. */}
        <a href={item.deepLink}>{item.area}</a>
        {item.enforcementInvolved ? ' — enforcement involved' : ''}
      </dt>
      <dd>
        {item.body}
        <br />
        <span className="field-hint">
          Owner: {item.owner}
          {item.dueExpectation ? ` · Due: ${item.dueExpectation}` : ''}
        </span>
      </dd>
    </div>
  );
}

/* ── Reward packages ───────────────────────────────────────────────────────── */

function RewardPackages({
  campaignId,
  build,
  editable,
  onChanged,
}: {
  campaignId: string;
  build: BuildState;
  editable: boolean;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState({
    sku: '',
    title: '',
    priceDollars: '',
    contents: '',
    fulfillmentCommitment: '',
    delivery: '',
  });
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setError(null);
    const dollars = Number(draft.priceDollars);
    if (!draft.sku || !draft.title || !Number.isFinite(dollars) || dollars <= 0) {
      setError('A reward needs an SKU, a title, and a positive price.');
      return;
    }
    try {
      await saveRewardPackage(campaignId, {
        sku: draft.sku,
        title: draft.title,
        priceCents: String(Math.round(dollars * 100)),
        contents: draft.contents,
        fulfillmentCommitment: draft.fulfillmentCommitment,
        delivery: draft.delivery,
      });
      setDraft({ sku: '', title: '', priceDollars: '', contents: '', fulfillmentCommitment: '', delivery: '' });
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof FounderRequestError
          ? (caught.detail.whatHappened ?? 'That reward was not saved.')
          : 'That reward was not saved.',
      );
    }
  };

  return (
    <Card>
      <h2>Reward packages</h2>
      {build.rewardPackages.length === 0 ? (
        <p className="field-hint">No reward packages yet. Every campaign needs at least one.</p>
      ) : (
        <dl className="kv">
          {build.rewardPackages.map((r) => (
            <Row key={r.id} label={r.title}>
              US${(Number(r.priceCents) / 100).toFixed(2)} · {r.delivery} · SKU {r.sku}
            </Row>
          ))}
        </dl>
      )}
      {editable ? (
        <>
          <h3>Add a reward</h3>
          <Field label="SKU / tier">
            <Input value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} />
          </Field>
          <Field label="Title">
            <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="Price (US$, pre-tax)">
            <Input inputMode="decimal" value={draft.priceDollars} onChange={(e) => setDraft({ ...draft, priceDollars: e.target.value })} />
          </Field>
          <Field label="Exact contents">
            <Input value={draft.contents} onChange={(e) => setDraft({ ...draft, contents: e.target.value })} />
          </Field>
          <Field label="Fulfillment commitment">
            <Input value={draft.fulfillmentCommitment} onChange={(e) => setDraft({ ...draft, fulfillmentCommitment: e.target.value })} />
          </Field>
          <Field label="Delivery month/year or window">
            <Input value={draft.delivery} onChange={(e) => setDraft({ ...draft, delivery: e.target.value })} />
          </Field>
          {error ? <p className="field-error" role="alert">{error}</p> : null}
          <Button tier="secondary" onClick={() => void add()}>
            Add reward package
          </Button>
        </>
      ) : null}
    </Card>
  );
}

/* ── A field that autosaves on blur ────────────────────────────────────────── */

function TextField({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => {
    setLocal(value);
  }, [value]);
  return (
    <Field label={label}>
      <Input
        value={local}
        disabled={disabled}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          if (local !== value) onSave(local);
        }}
      />
    </Field>
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
