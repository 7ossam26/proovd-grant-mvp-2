/**
 * The §17 first-post review — Spec §17, §29.6, §33.4.7.
 *
 * Two steps, because the reference makes them two and the second one is a
 * different act: step one is a decision against seven checks, step two is
 * composing what the Creator has to correct.
 *
 * ── Approve is disabled until all seven pass, and that is not the gate ──────
 * The disabled state is a courtesy — it stops an Admin submitting a decision
 * the record contradicts. `verifyPost` re-decides server-side from the recorded
 * checklist, and its refusal is what an Admin reads (§1.1: a disabled button is
 * not authorization).
 *
 * ── First-post review releases $0 ───────────────────────────────────────────
 * Pinned under the actions, because approving a post is the moment somebody
 * would assume money moves. §33.4.7: the submission record carries no amount,
 * no percentage, and no ledger column — there is nowhere for money to move.
 *
 * ── The outcome decides traffic, never the page ─────────────────────────────
 * A correction or a rejection pauses the LINK and the Creator; it never touches
 * `campaigns.status`. §33.4.8: a rejected post does not unlaunch the campaign,
 * and the absence of any write to the campaign is what enforces it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';
import {
  FIRST_POST_RELEASES_ZERO,
  FIRST_POST_VERIFICATION_CHECKS,
} from '@proovd/shared';
import { Button, Field, StatePanel, Textarea } from '../../../components/index.js';
import { cn } from '../../../components/cn.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import {
  fetchRelationship,
  verifyPost,
  AdminRequestError,
  type CreatorRelationshipDetail,
} from './api.js';
import { Group, Note, Section } from './shared.js';

type Step = 'review' | 'edits';

export function PostReview() {
  const { prospectId = '', associationId = '' } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<CreatorRelationshipDetail | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<Step>('review');
  const [correction, setCorrection] = useState('');
  const [checks, setChecks] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(FIRST_POST_VERIFICATION_CHECKS.map((check) => [check.key, false])),
  );
  const surface = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setDetail(await fetchRelationship(prospectId, associationId));
    } catch (error: unknown) {
      setLoadError(
        error instanceof AdminRequestError
          ? error
          : new AdminRequestError({
              error: 'unreachable',
              status: 0,
              title: 'Proovd could not be reached',
              whatHappened:
                'The submitted post could not be read, and the failure carried no explanation.',
              next: 'Try the read again. Nothing was changed by the attempt.',
            }),
      );
    }
  }, [prospectId, associationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useProovdMotion(surface, [detail, step]);

  const failed = useMemo(
    () => FIRST_POST_VERIFICATION_CHECKS.filter((check) => !checks[check.key]),
    [checks],
  );
  const allPass = failed.length === 0;

  /** The correction prefilled from what did not pass — editable, never sent as-is. */
  useEffect(() => {
    if (step === 'edits' && correction === '') {
      setCorrection(
        failed.map((check) => `· ${check.label}`).join('\n'),
      );
    }
  }, [step, failed, correction]);

  // Takes the submission id rather than closing over it: the record is
  // resolved below, after the loading and no-open-decision states, and a
  // decision addressed to a submission that is not there is not a decision.
  async function decide(
    submissionId: string,
    outcome: 'passed' | 'correction_needed' | 'rejected',
  ) {
    setBusy(true);
    setFailure(null);
    try {
      // The checklist is a record keyed by check, which is the shape
      // `verifyPost` stores and re-decides a pass from. The route refuses a
      // pass whose checklist is short, so the disabled Approve above is a
      // courtesy rather than the gate (§1.1).
      await verifyPost(submissionId, {
        outcome,
        checklist: Object.fromEntries(
          FIRST_POST_VERIFICATION_CHECKS.map((check) => [check.key, Boolean(checks[check.key])]),
        ),
        ...(outcome === 'correction_needed' ? { correctionDetail: correction } : {}),
        ...(outcome === 'rejected' ? { enforcementReason: correction } : {}),
      });
      void navigate(
        `/admin/creators/${prospectId}/relationships/${associationId}?pane=content`,
      );
    } catch (error: unknown) {
      // The server's refusal is what an Admin reads, verbatim.
      setFailure(
        error instanceof AdminRequestError
          ? (error.detail.whatHappened ?? error.detail.title)
          : 'That decision did not complete, and nothing was recorded.',
      );
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <StatePanel
        state={loadError.detail.title}
        whatHappened={
          loadError.detail.whatHappened ??
          'The submitted post could not be read, so there is nothing to review.'
        }
        next={loadError.detail.next ?? 'Try the read again. Nothing was changed by the attempt.'}
        owner="Proovd"
        nextUpdate="When you try again"
        action={
          <Button tier="secondary" onClick={() => void load()}>
            Try the read again
          </Button>
        }
        reference="Admin · Creators"
        ring
      />
    );
  }

  if (!detail) {
    return (
      <StatePanel
        state="Reading the submitted post"
        whatHappened="Proovd is reading the submission, its version history, and the locked campaign terms."
        next="The review appears as soon as that comes back."
        owner="Proovd"
        nextUpdate="Within a few seconds"
        action="No action needed"
        reference="Admin · Creators"
      />
    );
  }

  const submission = detail.content.submission;

  if (!submission || submission.status !== 'submitted') {
    return (
      <StatePanel
        state="There is no post waiting for review"
        whatHappened={
          submission
            ? `The latest submission is recorded as “${submission.statusLabel}”, so there is no open decision.`
            : 'No public post has been submitted for this campaign relationship yet.'
        }
        next="Go back to the relationship to see where it actually stands."
        owner="Proovd"
        nextUpdate="When the Creator submits"
        action={
          <Button
            tier="secondary"
            onClick={() =>
              void navigate(
                `/admin/creators/${prospectId}/relationships/${associationId}?pane=content`,
              )
            }
          >
            Back to the relationship
          </Button>
        }
        reference="Admin · Creators"
      />
    );
  }

  return (
    <div ref={surface}>
      <header className="cr-context">
        <RouterLink
          className="crumb"
          to={`/admin/creators/${prospectId}/relationships/${associationId}?pane=content`}
        >
          ← Back to {detail.band.campaignName}
        </RouterLink>
        <div>
          <p className="kicker">
            {detail.creatorName} · {detail.band.campaignName}
            {step === 'edits' ? ' · Step 2 of 2' : ''}
          </p>
          <h1 className="cr-context__title" data-reveal="headline">
            {step === 'review'
              ? 'Does this public post meet the locked terms?'
              : 'Request post edits'}
          </h1>
        </div>
      </header>

      {failure ? (
        <p className="helper" role="alert">
          {failure}
        </p>
      ) : null}

      {step === 'review' ? (
        <div className="cr-review">
          <div className="cr-review__post">
            <Section eyebrow={`Public post · version ${submission.version}`} title="The submission">
              <a
                className="cr-post__url"
                href={submission.url}
                target="_blank"
                rel="noreferrer"
                data-press
              >
                Open live public post
              </a>
              <p className="helper">{submission.url}</p>
              <Group>
                <div className="frow">
                  <dt>Submitted</dt>
                  <dd>{submission.submittedAt ?? '—'}</dd>
                </div>
                <div className="frow">
                  <dt>Versions</dt>
                  <dd>
                    {detail.content.history.length}
                    <p className="helper">
                      Every corrected version stays in the record; a resubmission is a new one.
                    </p>
                  </dd>
                </div>
              </Group>
            </Section>
          </div>

          <div className="cr-review__decision">
            <Section eyebrow="Locked campaign requirements" title="What this post is checked against">
              <Group>
                <div className="frow">
                  <dt>Campaign</dt>
                  <dd>{detail.band.campaignName}</dd>
                </div>
                <div className="frow">
                  <dt>Type</dt>
                  <dd>{detail.band.campaignType ?? '—'}</dd>
                </div>
                <div className="frow">
                  <dt>Terms</dt>
                  <dd>{detail.agreement.lockState}</dd>
                </div>
              </Group>
            </Section>

            <div
              className="cr-checks"
              role="group"
              aria-label="First-post verification checks"
            >
              {FIRST_POST_VERIFICATION_CHECKS.map((check) => {
                const on = Boolean(checks[check.key]);
                return (
                  <button
                    key={check.key}
                    type="button"
                    className={cn('cr-check', on && 'is-on')}
                    aria-pressed={on}
                    onClick={() => setChecks((current) => ({ ...current, [check.key]: !on }))}
                  >
                    <span className="cr-check__mark" aria-hidden="true">
                      {on ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <polyline points="4 13 10 19 20 6" />
                        </svg>
                      ) : null}
                    </span>
                    {check.label}
                  </button>
                );
              })}
            </div>

            <div className="cr-review__actions">
              <Button disabled={busy || !allPass} onClick={() => void decide(submission.id, 'passed')}>
                Approve submitted post
              </Button>
              <Button tier="secondary" disabled={busy} onClick={() => setStep('edits')}>
                Request post edits
              </Button>
              <Button
                tier="tertiary"
                disabled={busy}
                onClick={() => {
                  setCorrection('');
                  setStep('edits');
                }}
              >
                Reject submitted post
              </Button>
              {!allPass ? (
                <p className="helper">
                  {failed.length} {failed.length === 1 ? 'check has' : 'checks have'} not been
                  marked as passing, so an approval is not offered. The server re-decides from
                  the recorded checklist regardless.
                </p>
              ) : null}
              {/* Pinned: approving a post is the moment money is assumed. */}
              <Note>{FIRST_POST_RELEASES_ZERO}</Note>
            </div>
          </div>
        </div>
      ) : (
        <div className="cr-review">
          <div className="cr-review__post">
            <Section
              eyebrow="Failed checks"
              title={`${failed.length} ${failed.length === 1 ? 'item' : 'items'} to correct`}
            >
              {failed.length === 0 ? (
                <p className="grey">
                  Every check is marked as passing. A correction with nothing to correct is
                  not something to send — go back and mark what did not.
                </p>
              ) : (
                <ul className="cr-failed">
                  {failed.map((check) => (
                    <li key={check.key}>{check.label}</li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <div className="cr-review__decision">
            <Field
              label="Creator-facing correction"
              hint="What they have to change, in words they can act on. Never a provider or fraud code (§29.4)."
            >
              <Textarea
                value={correction}
                rows={8}
                onChange={(event) => setCorrection(event.target.value)}
              />
            </Field>

            <Note>
              The Affiliate link pauses when this is sent. New traffic is not payable until a
              corrected post passes.
            </Note>

            <div className="cr-review__actions">
              <Button
                disabled={busy || correction.trim() === ''}
                onClick={() => void decide(submission.id, 'correction_needed')}
              >
                Send post edit request
              </Button>
              <Button
                tier="tertiary"
                disabled={busy || correction.trim() === ''}
                onClick={() => void decide(submission.id, 'rejected')}
              >
                Reject the post instead
              </Button>
              <Button tier="secondary" disabled={busy} onClick={() => setStep('review')}>
                Back to the checks
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
