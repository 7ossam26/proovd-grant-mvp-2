/**
 * The Founder's fulfillment surface — Spec §22.4, §22.5, §22.6, DNA §5.14
 * (Phase 21a).
 *
 * Glance is the four §22.5 obligations with their real state; Act is the one
 * thing actually outstanding; Explore holds the commitment history and the Day
 * 14 checklist.
 *
 * ── The original commitment is displayed, always ───────────────────────────
 * The commitment list renders sequence 1 first and labels it as the original.
 * A Founder who has moved the date twice can still see what they promised, and
 * so can anyone reading over their shoulder — which is the point of §22.5's
 * fourth obligation and what §33.10.2 tests on the server.
 *
 * ── The change path is stated, never chosen ────────────────────────────────
 * §22.6's two paths are a property of the campaign, so the surface renders
 * which one applies and what it requires. There is no control that picks a
 * path and no way to notify Backers first on the approval path: the form posts
 * to the request route, and the revision route refuses without an approval.
 *
 * ── Nothing here computes ──────────────────────────────────────────────────
 * Every state, deadline, and blocker comes from `readFulfillmentStatus` and
 * `readDay14Checklist` — the same two resolvers the Admin surface renders — so
 * the cadence cannot say one thing here and another in the Admin queue.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, Link } from 'react-router';
import { Button, Field, Input, Section, Tag, Textarea } from '../../components/index.js';
import {
  fetchFulfillment,
  fetchDay14,
  recordOriginalCommitment,
  setDeliveryMechanism,
  recordDelivery,
  requestDeliveryChange,
  applyDeliveryRevision,
  submitDay14Evidence,
  FounderRequestError,
  type FulfillmentStatusView,
  type Day14ChecklistView,
} from './api.js';

const STATE_TAG: Record<string, 'mint' | 'sage' | 'live' | 'default'> = {
  met: 'mint',
  due: 'sage',
  overdue: 'live',
  not_applicable: 'default',
};

const STATE_WORD: Record<string, string> = {
  met: 'Done',
  due: 'Due',
  overdue: 'Overdue',
  not_applicable: 'Not applicable',
};

function utcDay(iso: string | null): string {
  if (!iso) return '—';
  return `${iso.slice(0, 10)} (UTC)`;
}

export function Fulfillment() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [status, setStatus] = useState<FulfillmentStatusView | null>(null);
  const [day14, setDay14] = useState<Day14ChecklistView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load(): Promise<void> {
    if (!campaignId) return;
    try {
      const [fulfillment, checklist] = await Promise.all([
        fetchFulfillment(campaignId),
        fetchDay14(campaignId).catch(() => null),
      ]);
      setStatus(fulfillment);
      setDay14(checklist);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof FounderRequestError
          ? (caught.detail.whatHappened ??
            'This page could not be loaded, so nothing on it is current.')
          : 'This page could not be loaded, so nothing on it is current.',
      );
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  async function run(work: () => Promise<unknown>, done: string): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await work();
      setNotice(done);
      await load();
    } catch (caught) {
      setError(
        caught instanceof FounderRequestError
          ? (caught.detail.whatHappened ??
            'That did not complete, so nothing was changed.')
          : 'That did not complete, so nothing was changed.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (error && !status) {
    return (
      <main className="page">
        <Section title="Fulfillment">
          <p className="text-body">{error}</p>
        </Section>
      </main>
    );
  }
  if (!status || !campaignId) {
    return (
      <main className="page">
        <Section title="Fulfillment">
          <p className="text-body">Loading your fulfillment record…</p>
        </Section>
      </main>
    );
  }

  const original = status.commitments.find((c) => c.isOriginal) ?? null;
  const outstanding = status.obligations.filter(
    (o) => o.state === 'overdue' || o.state === 'due',
  );

  return (
    <main className="page">
      <header className="page__header">
        <h1 className="text-display">Fulfillment</h1>
        <p className="text-body">
          What you owe your Backers after the charge, and where each obligation stands.
        </p>
        <p className="text-caption">
          <Link to={`/campaigns/${campaignId}/results`}>Campaign results</Link>
        </p>
      </header>

      {notice ? <p className="text-body">{notice}</p> : null}
      {error ? <p className="text-body">{error}</p> : null}

      {/* ── Glance: the four §22.5 obligations ──────────────────────────── */}
      <Section title="Your obligations">
        <ul className="stack">
          {status.obligations.map((obligation) => (
            <li key={obligation.key} className="stack__row">
              <Tag variant={STATE_TAG[obligation.state] ?? 'default'}>
                {STATE_WORD[obligation.state] ?? obligation.state}
              </Tag>
              <div>
                <p className="text-body">{obligation.label}</p>
                <p className="text-caption">{obligation.detail}</p>
                {obligation.dueAt ? (
                  <p className="text-caption">Due {utcDay(obligation.dueAt)}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {outstanding.length === 0 ? (
          <p className="text-caption">
            Nothing is outstanding. Keep posting an update at least every 30 days until you
            deliver.
          </p>
        ) : null}
      </Section>

      {/* ── The delivery commitment, original first ─────────────────────── */}
      <Section title="Delivery commitment">
        {status.commitments.length === 0 ? (
          <form
            className="stack"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(
                () =>
                  recordOriginalCommitment(campaignId, {
                    deliveryMonth: String(form.get('deliveryMonth') ?? ''),
                    commitmentText: String(form.get('commitmentText') ?? ''),
                  }),
                'Your original delivery commitment is recorded. It is preserved from here on: a change adds a revision beside it, and never writes over it.',
              );
            }}
          >
            <p className="text-body">
              Record what you promised your Backers. This is preserved permanently — every later
              change is added beside it, never over it.
            </p>
            <Field label="Delivery month" hint="The month you disclosed, as YYYY-MM.">
              <Input name="deliveryMonth" required placeholder="2026-12" pattern="\d{4}-\d{2}" />
            </Field>
            <Field label="What you promised" hint="In your own words, as the Backer read it.">
              <Textarea
                name="commitmentText"
                required
                defaultValue={status.disclosedCommitmentSuggestion ?? ''}
              />
            </Field>
            <Button type="submit" disabled={busy}>
              Record the original commitment
            </Button>
          </form>
        ) : (
          <ol className="stack">
            {status.commitments.map((commitment) => (
              <li key={commitment.sequence} className="stack__row">
                <Tag variant={commitment.isOriginal ? 'default' : 'sage'}>
                  {commitment.isOriginal ? 'Original' : `Revision ${commitment.sequence - 1}`}
                </Tag>
                <div>
                  <p className="text-body">{commitment.commitmentText}</p>
                  <p className="text-caption">Month: {commitment.deliveryMonth}</p>
                  {commitment.reason ? (
                    <p className="text-caption">Reason: {commitment.reason}</p>
                  ) : null}
                  <p className="text-caption">
                    {commitment.notifiedBackersAt
                      ? `Backers told ${utcDay(commitment.notifiedBackersAt)}`
                      : commitment.isOriginal
                        ? 'Disclosed on the campaign page.'
                        : 'Not yet published to Backers.'}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* ── §22.6's two paths, stated ───────────────────────────────────── */}
      {original ? (
        <Section title="Changing the delivery date">
          <p className="text-body">
            {status.changePath === 'admin_preapproval'
              ? 'Your remaining payment has not been released, so Proovd reviews a date change before your Backers are told. We answer within five business days.'
              : 'Your remaining payment has been released, so you do not need Proovd approval — but you must tell your Backers before the month you originally promised has passed. Refund, support, and enforcement rules still apply.'}
          </p>

          {status.pendingChangeRequest ? (
            <p className="text-body">
              A change to {status.pendingChangeRequest.proposedDeliveryMonth} is with Proovd. We
              will answer by {utcDay(status.pendingChangeRequest.reviewDueAt)}. Your Backers have
              not been told yet — that happens once the change is approved.
            </p>
          ) : (
            <form
              className="stack"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const body = {
                  proposedDeliveryMonth: String(form.get('proposedDeliveryMonth') ?? ''),
                  reason: String(form.get('reason') ?? ''),
                  unchangedObligations: String(form.get('unchangedObligations') ?? ''),
                  nextUpdateDate: String(form.get('nextUpdateDate') ?? ''),
                  supportRefundRoute: String(form.get('supportRefundRoute') ?? ''),
                };
                if (status.changePath === 'admin_preapproval') {
                  void run(
                    () => requestDeliveryChange(campaignId, body),
                    'Your change is with Proovd. Your Backers have not been told — that happens once it is approved.',
                  );
                } else {
                  void run(
                    () =>
                      applyDeliveryRevision(campaignId, {
                        ...body,
                        commitmentText: String(form.get('commitmentText') ?? ''),
                      }),
                    'Your Backers have been told. Your original commitment is still on record beside the revision.',
                  );
                }
              }}
            >
              <Field label="New delivery month" hint="As YYYY-MM.">
                <Input
                  name="proposedDeliveryMonth"
                  required
                  placeholder="2027-03"
                  pattern="\d{4}-\d{2}"
                />
              </Field>
              {status.changePath === 'notice_before_original_month' ? (
                <Field label="What you are now promising" hint="In your own words.">
                  <Textarea name="commitmentText" required />
                </Field>
              ) : null}
              {/* §22.6's four remaining required fields, each named. */}
              <Field label="Reason" hint="What actually changed. Backers read this.">
                <Textarea name="reason" required />
              </Field>
              <Field
                label="What is unchanged"
                hint="Say what still stands — reward contents, price, refund policy."
              >
                <Textarea name="unchangedObligations" required />
              </Field>
              <Field label="Next update date" hint="When you will next post, as YYYY-MM-DD.">
                <Input name="nextUpdateDate" required pattern="\d{4}-\d{2}-\d{2}" />
              </Field>
              <Field label="Support and refund route" hint="How a Backer reaches you about this.">
                <Textarea name="supportRefundRoute" required />
              </Field>
              <Button type="submit" disabled={busy}>
                {status.changePath === 'admin_preapproval'
                  ? 'Send to Proovd for review'
                  : 'Tell my Backers'}
              </Button>
            </form>
          )}
        </Section>
      ) : null}

      {/* ── Delivery ────────────────────────────────────────────────────── */}
      <Section title="Delivering">
        {status.deliveredAt ? (
          <p className="text-body">
            Delivered {utcDay(status.deliveredAt)} by {status.mechanismLabel}. Every charged Backer
            who was still due fulfillment was told, with your access instructions and the delivery
            you originally promised.
          </p>
        ) : (
          <form
            className="stack"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(
                () =>
                  setDeliveryMechanism(campaignId, {
                    mechanism: String(form.get('mechanism') ?? ''),
                    accessInstructions: String(form.get('accessInstructions') ?? ''),
                  }),
                'Saved. When access is actually live, record the delivery and we will tell your Backers.',
              );
            }}
          >
            <Field label="How Backers get access">
              <select
                name="mechanism"
                required
                className="input"
                defaultValue={status.mechanism ?? ''}
              >
                <option value="" disabled>
                  Choose one
                </option>
                {status.mechanisms.map((mechanism) => (
                  <option key={mechanism.key} value={mechanism.key}>
                    {mechanism.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Access instructions"
              hint="Exactly what a Backer does. This is repeated in the email they receive."
            >
              <Textarea
                name="accessInstructions"
                required
                defaultValue={status.accessInstructions ?? ''}
              />
            </Field>
            <Button type="submit" tier="secondary" disabled={busy}>
              Save access details
            </Button>
          </form>
        )}

        {!status.deliveredAt && status.mechanism && original ? (
          <div className="stack">
            <p className="text-body">
              When access is live, record the delivery. Every charged Backer still due fulfillment
              receives your access instructions, the delivery you originally promised, your support
              route, and how to reach Proovd.
            </p>
            <Button
              disabled={busy}
              onClick={() =>
                void run(
                  () => recordDelivery(campaignId),
                  'Delivery recorded and your Backers have been told.',
                )
              }
            >
              Record delivery and notify Backers
            </Button>
          </div>
        ) : null}
      </Section>

      {/* ── Explore: the Day 14 checklist ───────────────────────────────── */}
      {day14 && day14.reviewOpen ? (
        <Section title="Day 14 Progress Check">
          <p className="text-body">
            Proovd reviews every campaign at Day 14.{' '}
            {day14.enforcementOnly
              ? 'Your campaign has no remaining payment, so this review is about delivery and communication only.'
              : 'A review that does not pass blocks your unreleased remaining payment.'}{' '}
            A decision is due {utcDay(day14.decisionDueAt)}.
          </p>

          {day14.outcome !== 'pending' ? (
            <p className="text-body">
              Recorded outcome: {day14.outcome === 'pass' ? 'passed' : 'did not pass'}. We emailed
              you the reasons and what happens next.
            </p>
          ) : null}

          {day14.clarifications.filter((c) => !c.respondedAt).length > 0 ? (
            <ul className="stack">
              {day14.clarifications
                .filter((c) => !c.respondedAt)
                .map((clarification) => (
                  <li key={clarification.id}>
                    <Tag variant={clarification.overdue ? 'live' : 'sage'}>
                      {clarification.overdue ? 'Overdue' : 'Awaiting your answer'}
                    </Tag>
                    <p className="text-body">{clarification.question}</p>
                    <p className="text-caption">
                      Answer by {utcDay(clarification.dueAt)}. Not answering within five business
                      days is one of the things that fails this review.
                    </p>
                  </li>
                ))}
            </ul>
          ) : null}

          {day14.outcome === 'pending' ? (
            <form
              className="stack"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const items = day14.items
                  .map((item) => ({
                    itemKey: item.key,
                    detail: String(form.get(item.key) ?? '').trim(),
                  }))
                  .filter((item) => item.detail.length > 0);
                void run(
                  () => submitDay14Evidence(campaignId, items),
                  'Submitted. Your receipt lists everything you sent and when we will decide.',
                );
              }}
            >
              {day14.items.map((item) => (
                <Field
                  key={item.key}
                  label={item.required ? item.label : `${item.label} (optional)`}
                  hint={`For example: ${item.example}`}
                >
                  <Textarea name={item.key} required={item.required} />
                </Field>
              ))}
              <Button type="submit" disabled={busy}>
                Send this evidence
              </Button>
            </form>
          ) : null}

          {day14.submissions.length > 0 ? (
            <div className="stack">
              <h3 className="text-title">What you have sent</h3>
              {day14.submissions.map((submission) => (
                <div key={submission.id} className="stack">
                  <p className="text-body">
                    Reference {submission.reference} — sent {utcDay(submission.submittedAt)},
                    decision due {utcDay(submission.decisionDueAt)}.
                  </p>
                  <ul>
                    {submission.items.map((item) => (
                      <li key={item.itemKey} className="text-caption">
                        {item.label}: {item.detail}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
        </Section>
      ) : null}
    </main>
  );
}
