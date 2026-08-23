/**
 * The Founder's parallel campaign build — Spec §14.4, §15, §33.3.10, §33.4.1.
 *
 * ── One decision at a time (§14.4) ──────────────────────────────────────────
 * The build is a set of fields the Founder fills at their own pace; each
 * autosaves on blur and the server re-derives completeness. Campaign type is
 * read-only — there is no control to change it here.
 *
 * ── Review readiness is the server's answer, rendered ───────────────────────
 * `review_ready` is derived from the campaign build; the surface
 * shows what still blocks it and enables Submit only when the server says
 * ready. Nothing here computes readiness — the same rule the workspace follows
 * for the fee.
 *
 * ── Changes-required feedback is grouped and deep-linked (§33.4.1) ──────────
 * When a review returns changes, the Required-before-resubmission and
 * Optional-improvements groups render with the owner, the due expectation, and
 * a deep link into the affected content. The draft is untouched.
 *
 * ── Every §14.4 ingredient has a box (campaign page v2, 2026-08-18) ─────────
 * Twelve of the twenty-four build columns had no input here at all, and four of
 * those are §14.4-REQUIRED — the order threshold, the delivery window, the
 * early-product disclaimer, and the risks — so `READINESS_FIELD_LABELS` named
 * them under "Still needed in your build" and there was nowhere to type them.
 * An Idea campaign could not reach `campaign_build_status = 'complete'` through
 * this surface at all. That is closed here, in the same session that adds ten
 * more fields, because adding to a form that cannot be finished makes it worse.
 *
 * ── No generate control, anywhere ───────────────────────────────────────────
 * §12: static copy-ready guidance, "not an embedded AI product"; §30 defers AI
 * rewriting by name. There is no model client in this repository and no route
 * that would take one. The words on this page are the Founder's.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { FEEDBACK_GROUP_LABELS } from '@proovd/shared';
import {
  Button,
  Card,
  Choice,
  Field,
  Input,
  Measure,
  NO_ACTION,
  Section,
  StatePanel,
  Tag,
  Textarea,
} from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import {
  fetchBuild,
  saveBuild,
  saveRewardPackage,
  saveFaq,
  removeFaq,
  saveDemoMoment,
  removeDemoMoment,
  saveBenefitCard,
  removeBenefitCard,
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

/**
 * The three benefit-card treatments, named by SHAPE.
 *
 * The reference names its variants after one campaign's copy — `.timing-card`,
 * `.tap-card`, `.streak-card` — and §30 lists streaks among the forbidden
 * mechanics; more practically, a variant named for one Founder's product is
 * unusable by the next. Offered as a closed choice rather than free text
 * because a fourth value renders nothing at all (§1.4).
 */
const VISUAL_VARIANT_CHOICES = [
  { value: 'bars', label: 'Bars', sub: 'Four stacked bars, the third filled.' },
  { value: 'check', label: 'Check', sub: 'A circle with a check inside it.' },
  { value: 'dots', label: 'Dots', sub: 'Seven dots in a row, one outlined.' },
] as const;

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
        <TextField label="Community link (optional)" value={b?.communityUrl ?? ''} disabled={!editable} onSave={(v) => persist({ communityUrl: v })} />
      </Card>

      <Card>
        <h2>Brand and story</h2>
        <TextField label="Brand perception" value={b?.brandPerception ?? ''} disabled={!editable} onSave={(v) => persist({ brandPerception: v })} />
        <TextField label="Brand voice" value={b?.brandVoice ?? ''} disabled={!editable} onSave={(v) => persist({ brandVoice: v })} />
        <TextField label="Required wording (optional)" value={b?.requiredWording ?? ''} disabled={!editable} onSave={(v) => persist({ requiredWording: v })} />
        <TextField label="Prohibited claims (optional)" value={b?.prohibitedClaims ?? ''} disabled={!editable} onSave={(v) => persist({ prohibitedClaims: v })} />
        <LongField label="Public story" value={b?.publicStory ?? ''} disabled={!editable} onSave={(v) => persist({ publicStory: v })} />
      </Card>

      {/*
       * Delivery and risk (§14.4). Required for an Idea Campaign; offered on
       * both, because a Product Campaign shipping a real thing still has a
       * delivery window and still has risks worth stating, and a field a
       * Founder cannot reach is the gap this session exists to close.
       */}
      <Card>
        <h2>Delivery and risk</h2>
        {build.model === 'product' ? (
          <p className="field-hint">
            These are required for an Idea Campaign. On a Product Campaign they are yours to fill
            in if they help a Backer decide.
          </p>
        ) : null}
        <TextField label="Delivery window" value={b?.deliveryWindow ?? ''} disabled={!editable} onSave={(v) => persist({ deliveryWindow: v })} />
        <LongField
          label="Early-product disclaimer"
          hint="What a Backer should expect from an early production run."
          value={b?.earlyProductDisclaimer ?? ''}
          disabled={!editable}
          onSave={(v) => persist({ earlyProductDisclaimer: v })}
        />
        <LongField
          label="Risks and challenges"
          hint="What could delay this, in your own words."
          value={b?.risksAndChallenges ?? ''}
          disabled={!editable}
          onSave={(v) => persist({ risksAndChallenges: v })}
        />
      </Card>

      {/*
       * The one number per campaign type, and the two are not interchangeable.
       * The Idea threshold is public and decides whether anybody is charged; the
       * Product internal target is private and decides nothing. Rendering the
       * wrong one would be inventing a rule the campaign type does not have.
       */}
      {build.model === 'idea' ? (
        <Card>
          <h2>Your order threshold</h2>
          <NumberField
            label="Order threshold (number of pre-orders)"
            hint="How many pre-orders must exist at close for cards to be charged. Below it, nobody is charged."
            value={b?.orderThreshold ?? null}
            disabled={!editable}
            onSave={(v) => persist({ orderThreshold: v })}
          />
        </Card>
      ) : (
        <Card>
          <h2>Your internal target</h2>
          <NumberField
            label="Internal momentum target (whole US$, pre-tax)"
            hint="Yours alone. It is never shown on your public page and it charges nobody. Capped at US$50,000."
            value={b?.internalTargetCents ? Math.round(Number(b.internalTargetCents) / 100) : null}
            disabled={!editable}
            onSave={(v) => persist({ internalTargetCents: v === null ? null : String(v * 100) })}
          />
        </Card>
      )}

      {/*
       * §14.4's refund policy, in either shape it allows: your own operative
       * text, or an immutable snapshot of a policy you publish elsewhere.
       * Required for a Product Campaign; §24.9 gives an Idea Campaign no
       * voluntary refund path at all, so it is offered and not required there.
       */}
      <Card>
        <h2>Your refund policy</h2>
        <p className="field-hint">
          Either write the operative text here, or point at the policy you publish and record which
          version was in force. {build.model === 'product' ? 'One of the two is required.' : null}
        </p>
        <LongField label="Refund policy text" value={b?.refundPolicyText ?? ''} disabled={!editable} onSave={(v) => persist({ refundPolicyText: v })} />
        <TextField label="Policy title" value={b?.refundPolicyTitle ?? ''} disabled={!editable} onSave={(v) => persist({ refundPolicyTitle: v })} />
        <TextField label="Policy link" value={b?.refundPolicySourceUrl ?? ''} disabled={!editable} onSave={(v) => persist({ refundPolicySourceUrl: v })} />
        <TextField label="Policy version" value={b?.refundPolicyVersion ?? ''} disabled={!editable} onSave={(v) => persist({ refundPolicyVersion: v })} />
        <TextField label="Effective date (YYYY-MM-DD)" value={b?.refundPolicyEffectiveDate ?? ''} disabled={!editable} onSave={(v) => persist({ refundPolicyEffectiveDate: v || null })} />
      </Card>

      {/* Reward packages (§14.4). */}
      <RewardPackages campaignId={campaignId} build={build} editable={editable} onChanged={load} />

      <Faqs campaignId={campaignId} build={build} editable={editable} onChanged={load} />

      {/*
       * The page's own copy. None of this is in a `REQUIRED_*` register: a build
       * must not stop completing because a campaign has no marketing headline,
       * and an absent heading renders no section rather than an empty one.
       */}
      <Card>
        <h2>Your page</h2>
        {/*
          This sentence used to end "…never shows an empty heading or a
          placeholder", and §33.11.6's scan flagged the last word. The scan was
          right: it reads the RENDERED text, and it cannot tell a promise not to
          show something from the thing itself — nor should it, because a reader
          cannot either. Reworded rather than exempted.
        */}
        <p className="field-hint">
          All optional. Anything you leave blank simply does not appear — your page never shows an
          empty heading or a stand-in for words you have not written.
        </p>
        <TextField label="Headline" value={b?.heroHeadline ?? ''} disabled={!editable} onSave={(v) => persist({ heroHeadline: v })} />
        <TextField
          label="Headline — the emphasised part"
          hint="Rendered in your accent colour, straight after the headline."
          value={b?.heroHeadlineAccent ?? ''}
          disabled={!editable}
          onSave={(v) => persist({ heroHeadlineAccent: v })}
        />
        <LongField label="Sub-headline" value={b?.heroSubheadline ?? ''} disabled={!editable} onSave={(v) => persist({ heroSubheadline: v })} />
        <LongField
          label="Pull quote"
          hint="One sentence in your own voice, beside your name."
          value={b?.founderPullQuote ?? ''}
          disabled={!editable}
          onSave={(v) => persist({ founderPullQuote: v })}
        />
        <TextField
          label="Footer line"
          hint="What you want the last band of the page to say."
          value={b?.platformLine ?? ''}
          disabled={!editable}
          onSave={(v) => persist({ platformLine: v })}
        />
        <h3>Section headings</h3>
        <TextField label="Benefits heading" value={b?.benefitsHeading ?? ''} disabled={!editable} onSave={(v) => persist({ benefitsHeading: v })} />
        <TextField label="Rewards heading" value={b?.rewardsHeading ?? ''} disabled={!editable} onSave={(v) => persist({ rewardsHeading: v })} />
        <TextField label="Updates heading" value={b?.updatesHeading ?? ''} disabled={!editable} onSave={(v) => persist({ updatesHeading: v })} />
        <TextField label="FAQ heading" value={b?.faqHeading ?? ''} disabled={!editable} onSave={(v) => persist({ faqHeading: v })} />
      </Card>

      <DemoMoments
        campaignId={campaignId}
        build={build}
        editable={editable}
        onChanged={load}
        contextLabel={b?.demoContextLabel ?? ''}
        onContextLabel={(v) => persist({ demoContextLabel: v })}
      />

      <BenefitCards campaignId={campaignId} build={build} editable={editable} onChanged={load} />

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
      {/* §33.11.2: each feedback item is a `dt`/`dd` pair, so the group needs
          its `dl` — otherwise a screen reader reaches a term with nothing
          defining it, on the one surface telling a Founder what to fix. */}
      {review.required.length > 0 ? (
        <>
          <h3>{FEEDBACK_GROUP_LABELS.required}</h3>
          <dl className="kv">
            {review.required.map((f, i) => (
              <FeedbackItem key={i} item={f} />
            ))}
          </dl>
        </>
      ) : null}
      {review.optional.length > 0 ? (
        <>
          <h3>{FEEDBACK_GROUP_LABELS.optional}</h3>
          <dl className="kv">
            {review.optional.map((f, i) => (
              <FeedbackItem key={i} item={f} />
            ))}
          </dl>
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
  const empty = {
    sku: '',
    title: '',
    priceDollars: '',
    contents: '',
    fulfillmentCommitment: '',
    delivery: '',
    badge: '',
    limitedQuantity: '',
  };
  const [draft, setDraft] = useState(empty);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setError(null);
    const dollars = Number(draft.priceDollars);
    if (!draft.sku || !draft.title || !Number.isFinite(dollars) || dollars <= 0) {
      setError('A reward needs an SKU, a title, and a positive price.');
      return;
    }
    const quantityText = draft.limitedQuantity.trim();
    const quantity = quantityText === '' ? null : Number(quantityText);
    if (quantity !== null && (!Number.isInteger(quantity) || quantity < 1)) {
      setError('A limited quantity is a whole number of at least one. Leave it blank for no limit.');
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
        badge: draft.badge.trim() === '' ? null : draft.badge.trim(),
        limitedQuantity: quantity,
      });
      setDraft(empty);
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
              {r.badge ? ` · ${r.badge}` : ''}
              {/* Null is "no limit", and it says so rather than saying "unlimited" —
                  a word §30 would have us imply scarcity with. */}
              {r.limitedQuantity === null ? ' · no limit' : ` · limited to ${r.limitedQuantity}`}
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
          <Field label="Badge (optional)" hint="A short tier label, like “Lowest price”.">
            <Input value={draft.badge} onChange={(e) => setDraft({ ...draft, badge: e.target.value })} />
          </Field>
          <Field
            label="Limited quantity (optional)"
            hint="Leave blank for no limit. Once this many pre-orders exist, the reward stays visible and cannot be chosen."
          >
            <Input
              inputMode="numeric"
              value={draft.limitedQuantity}
              onChange={(e) => setDraft({ ...draft, limitedQuantity: e.target.value })}
            />
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

/* ── FAQs (§14.4) ──────────────────────────────────────────────────────────────
 *
 * `campaign_faqs` was readable from Phase 12b and had no production writer, so
 * this section existed on the Founder's own preview with nothing behind it.
 */

function Faqs({
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
  const [draft, setDraft] = useState({ question: '', answer: '' });
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setError(null);
    if (!draft.question.trim() || !draft.answer.trim()) {
      setError('A question needs an answer. Both are shown on your page.');
      return;
    }
    try {
      await saveFaq(campaignId, {
        question: draft.question,
        answer: draft.answer,
        sortOrder: build.faqs.length,
      });
      setDraft({ question: '', answer: '' });
      onChanged();
    } catch (caught) {
      setError(refusalText(caught, 'That question was not saved.'));
    }
  };

  const remove = async (faqId: string) => {
    setError(null);
    try {
      await removeFaq(campaignId, faqId);
      onChanged();
    } catch (caught) {
      setError(refusalText(caught, 'That question was not removed.'));
    }
  };

  return (
    <Card>
      <h2>Questions people ask</h2>
      {build.faqs.length === 0 ? (
        <p className="field-hint">
          No questions yet. Leave it empty and the section does not appear on your page.
        </p>
      ) : (
        <dl className="kv">
          {build.faqs.map((f) => (
            <Row key={f.id} label={f.question}>
              {f.answer}
              {editable ? (
                <>
                  {' '}
                  <Button tier="tertiary" onClick={() => void remove(f.id)}>
                    Remove “{f.question}”
                  </Button>
                </>
              ) : null}
            </Row>
          ))}
        </dl>
      )}
      {editable ? (
        <>
          <h3>Add a question</h3>
          <Field label="Question">
            <Input
              value={draft.question}
              onChange={(e) => setDraft({ ...draft, question: e.target.value })}
            />
          </Field>
          <Field label="Answer">
            <Textarea
              value={draft.answer}
              onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
            />
          </Field>
          {error ? <p className="field-error" role="alert">{error}</p> : null}
          <Button tier="secondary" onClick={() => void add()}>
            Add question
          </Button>
        </>
      ) : null}
    </Card>
  );
}

/* ── The demo stage ────────────────────────────────────────────────────────────
 *
 * Three moments of the Founder's own product. A moment is a passive signal or
 * one action, never both — the database refuses the other combinations, and the
 * form offers them as a choice rather than as two boxes somebody fills in
 * together.
 */

const DEMO_MOMENT_LIMIT = 3;

function DemoMoments({
  campaignId,
  build,
  editable,
  onChanged,
  contextLabel,
  onContextLabel,
}: {
  campaignId: string;
  build: BuildState;
  editable: boolean;
  onChanged: () => void;
  contextLabel: string;
  onContextLabel: (value: string) => void;
}) {
  const emptyDraft = {
    timeLabel: '',
    momentLabel: '',
    stateWord: '',
    headline: '',
    kind: 'signal' as 'signal' | 'action',
    signalText: '',
    actionLabel: '',
  };
  const [draft, setDraft] = useState(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const full = build.demoMoments.length >= DEMO_MOMENT_LIMIT;

  const add = async () => {
    setError(null);
    if (!draft.timeLabel.trim() || !draft.momentLabel.trim() || !draft.stateWord.trim() || !draft.headline.trim()) {
      setError('A moment needs a time, a label, a state word, and a headline.');
      return;
    }
    const isAction = draft.kind === 'action';
    if (isAction && !draft.actionLabel.trim()) {
      setError('An action moment needs the words on its button.');
      return;
    }
    if (!isAction && !draft.signalText.trim()) {
      setError('A signal moment needs the line it shows.');
      return;
    }
    try {
      await saveDemoMoment(campaignId, {
        timeLabel: draft.timeLabel,
        momentLabel: draft.momentLabel,
        stateWord: draft.stateWord,
        headline: draft.headline,
        signalText: isAction ? null : draft.signalText,
        isAction,
        actionLabel: isAction ? draft.actionLabel : null,
        // No `sortOrder`: the server appends. `(campaign_id, sort_order)` is
        // UNIQUE, and a count is not a free position — remove the first of two
        // moments and the count is 1, which is the row that is still there.
      });
      setDraft(emptyDraft);
      onChanged();
    } catch (caught) {
      setError(refusalText(caught, 'That moment was not saved.'));
    }
  };

  const remove = async (momentId: string) => {
    setError(null);
    try {
      await removeDemoMoment(campaignId, momentId);
      onChanged();
    } catch (caught) {
      setError(refusalText(caught, 'That moment was not removed.'));
    }
  };

  return (
    <Card>
      <h2>The demo</h2>
      <p className="field-hint">
        Up to {DEMO_MOMENT_LIMIT} moments from a day with your product. Add none and the section
        does not appear.
      </p>
      <TextField
        label="What the demo is showing (optional)"
        value={contextLabel}
        disabled={!editable}
        onSave={onContextLabel}
      />
      {build.demoMoments.length > 0 ? (
        <dl className="kv">
          {build.demoMoments.map((m) => (
            <Row key={m.id} label={`${m.timeLabel} · ${m.momentLabel}`}>
              {m.headline} — {m.isAction ? `action: ${m.actionLabel}` : `signal: ${m.signalText}`}
              {editable ? (
                <>
                  {' '}
                  <Button tier="tertiary" onClick={() => void remove(m.id)}>
                    Remove the {m.momentLabel} moment
                  </Button>
                </>
              ) : null}
            </Row>
          ))}
        </dl>
      ) : null}
      {editable && !full ? (
        <>
          <h3>Add a moment</h3>
          <Field label="Time on the clock" hint="Shown as typed — “8:15”. It is copy, not a deadline.">
            <Input value={draft.timeLabel} onChange={(e) => setDraft({ ...draft, timeLabel: e.target.value })} />
          </Field>
          <Field label="Moment label">
            <Input value={draft.momentLabel} onChange={(e) => setDraft({ ...draft, momentLabel: e.target.value })} />
          </Field>
          <Field label="State word">
            <Input value={draft.stateWord} onChange={(e) => setDraft({ ...draft, stateWord: e.target.value })} />
          </Field>
          <Field label="Headline">
            <Input value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} />
          </Field>
          <Choice
            label="Is this moment a signal or an action?"
            entries={[
              { value: 'signal', label: 'A signal', sub: 'Your product tells them something.' },
              { value: 'action', label: 'An action', sub: 'They tap one thing.' },
            ]}
            value={draft.kind}
            onValueChange={(kind) => setDraft({ ...draft, kind })}
          />
          {draft.kind === 'action' ? (
            <Field label="Words on the button">
              <Input value={draft.actionLabel} onChange={(e) => setDraft({ ...draft, actionLabel: e.target.value })} />
            </Field>
          ) : (
            <Field label="The line it shows">
              <Input value={draft.signalText} onChange={(e) => setDraft({ ...draft, signalText: e.target.value })} />
            </Field>
          )}
          {error ? <p className="field-error" role="alert">{error}</p> : null}
          <Button tier="secondary" onClick={() => void add()}>
            Add moment
          </Button>
        </>
      ) : null}
      {editable && full ? (
        <p className="field-hint">
          That is {DEMO_MOMENT_LIMIT} moments — the most the stage shows. Remove one to add another.
        </p>
      ) : null}
      {error && full ? <p className="field-error" role="alert">{error}</p> : null}
    </Card>
  );
}

/* ── Benefit cards ─────────────────────────────────────────────────────────── */

const BENEFIT_CARD_LIMIT = 3;

function BenefitCards({
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
  const emptyDraft = { title: '', footerWord: '', visualVariant: 'bars' as string };
  const [draft, setDraft] = useState(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const full = build.benefitCards.length >= BENEFIT_CARD_LIMIT;

  const add = async () => {
    setError(null);
    if (!draft.title.trim() || !draft.footerWord.trim()) {
      setError('A card needs a title and the one word under it.');
      return;
    }
    try {
      await saveBenefitCard(campaignId, {
        title: draft.title,
        footerWord: draft.footerWord,
        visualVariant: draft.visualVariant,
        // No `sortOrder` — the server appends. See the demo moments above.
      });
      setDraft(emptyDraft);
      onChanged();
    } catch (caught) {
      setError(refusalText(caught, 'That card was not saved.'));
    }
  };

  const remove = async (cardId: string) => {
    setError(null);
    try {
      await removeBenefitCard(campaignId, cardId);
      onChanged();
    } catch (caught) {
      setError(refusalText(caught, 'That card was not removed.'));
    }
  };

  return (
    <Card>
      <h2>Benefits</h2>
      <p className="field-hint">
        Up to {BENEFIT_CARD_LIMIT} cards under your headline. Add none and the section does not
        appear.
      </p>
      {build.benefitCards.length > 0 ? (
        <dl className="kv">
          {build.benefitCards.map((c) => (
            <Row key={c.id} label={c.title}>
              {c.footerWord} · {c.visualVariant}
              {editable ? (
                <>
                  {' '}
                  <Button tier="tertiary" onClick={() => void remove(c.id)}>
                    Remove “{c.title}”
                  </Button>
                </>
              ) : null}
            </Row>
          ))}
        </dl>
      ) : null}
      {editable && !full ? (
        <>
          <h3>Add a card</h3>
          <Field label="Title">
            <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="The word underneath">
            <Input value={draft.footerWord} onChange={(e) => setDraft({ ...draft, footerWord: e.target.value })} />
          </Field>
          <Choice
            label="Which shape sits on the card?"
            entries={VISUAL_VARIANT_CHOICES.map((v) => ({ value: v.value, label: v.label, sub: v.sub }))}
            value={draft.visualVariant as (typeof VISUAL_VARIANT_CHOICES)[number]['value']}
            onValueChange={(visualVariant) => setDraft({ ...draft, visualVariant })}
          />
          {error ? <p className="field-error" role="alert">{error}</p> : null}
          <Button tier="secondary" onClick={() => void add()}>
            Add card
          </Button>
        </>
      ) : null}
      {editable && full ? (
        <p className="field-hint">
          That is {BENEFIT_CARD_LIMIT} cards — the most the row shows. Remove one to add another.
        </p>
      ) : null}
      {error && full ? <p className="field-error" role="alert">{error}</p> : null}
    </Card>
  );
}

/** The one place a refusal becomes something a Founder can read (§1.4). */
function refusalText(caught: unknown, fallback: string): string {
  return caught instanceof FounderRequestError
    ? (caught.detail.whatHappened ?? fallback)
    : fallback;
}

/* ── A field that autosaves on blur ────────────────────────────────────────── */

function TextField({
  label,
  hint,
  value,
  disabled,
  onSave,
}: {
  label: string;
  hint?: string;
  value: string;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => {
    setLocal(value);
  }, [value]);
  return (
    <Field label={label} {...(hint ? { hint } : {})}>
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

/** The same contract as `TextField`, for the fields that are paragraphs. */
function LongField({
  label,
  hint,
  value,
  disabled,
  onSave,
}: {
  label: string;
  hint?: string;
  value: string;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => {
    setLocal(value);
  }, [value]);
  return (
    <Field label={label} {...(hint ? { hint } : {})}>
      <Textarea
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

/**
 * A whole number that autosaves on blur.
 *
 * An unparseable value saves nothing rather than saving zero: §9's rule is that
 * a failed save never clears a valid field, and `0` is a different claim from
 * "I have not decided yet" (§1.4).
 */
function NumberField({
  label,
  hint,
  value,
  disabled,
  onSave,
}: {
  label: string;
  hint?: string;
  value: number | null;
  disabled: boolean;
  onSave: (value: number | null) => void;
}) {
  const asText = value === null ? '' : String(value);
  const [local, setLocal] = useState(asText);
  useEffect(() => {
    setLocal(asText);
  }, [asText]);
  return (
    <Field label={label} {...(hint ? { hint } : {})}>
      <Input
        inputMode="numeric"
        value={local}
        disabled={disabled}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          if (local === asText) return;
          const trimmed = local.trim();
          if (trimmed === '') {
            onSave(null);
            return;
          }
          const parsed = Number(trimmed);
          if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
            setLocal(asText);
            return;
          }
          onSave(parsed);
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
