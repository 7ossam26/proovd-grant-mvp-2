/**
 * The relationship's Content — §17, §18, §22.1.
 *
 * The submitted post and its verification, every earlier version, and §18's
 * traffic. Two things are parked and say so: per-deliverable evidence and the
 * availability verification, neither of which has a record in this product.
 *
 * ── The post is a public URL object ─────────────────────────────────────────
 * §17 verifies a public post, so the URL is the object — shown in full,
 * openable, and never truncated into something an Admin has to trust. Every
 * corrected version stays in the history: §17's resubmission is a new
 * submission, not an edit.
 *
 * ── First-post review releases $0 ───────────────────────────────────────────
 * The pinned sentence sits with the submission, because the one thing an Admin
 * might assume about approving a post is that it pays something.
 */

import {
  ATTRIBUTION_FOOTNOTE,
  FIRST_POST_RELEASES_ZERO,
} from '@proovd/shared';
import { Button } from '../../../../components/index.js';
import type { CreatorRelationshipDetail } from '../api.js';
import { Group, Note, Section } from '../shared.js';
import { useCreatorParked } from '../parked.js';
import type { RelationshipOp } from '../dialogs/RelationshipOpsDialog.js';

export function RelContent({
  detail,
  onReview,
  onOp,
}: {
  detail: CreatorRelationshipDetail;
  onReview: () => void;
  onOp: (op: RelationshipOp, trigger: HTMLElement | null) => void;
}) {
  const parked = useCreatorParked();
  const { content } = detail;
  const submission = content.submission;

  return (
    <div className="cr-stack">
      {submission ? (
        <section
          className={`cr-post cr-post--${submission.status}`}
          aria-label="Submitted public post"
        >
          <div>
            <p className="kicker">Public post · version {submission.version}</p>
            <h3>{submission.statusLabel}</h3>
            <a href={submission.url} target="_blank" rel="noreferrer" data-press>
              {submission.url}
            </a>
            <small>
              {submission.submittedAt ?? 'Submission time not recorded'}
              {submission.verifiedAt ? ` · verified ${submission.verifiedAt}` : ''}
            </small>
          </div>
          <div className="cr-post__actions">
            {submission.status === 'submitted' ? (
              <Button onClick={onReview}>Review submitted post</Button>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="cr-task cr-task--waiting">
          <div>
            <h3>No public post submitted</h3>
            <p>
              Work cannot begin until §16 readiness is cleared and the tracking link is
              active.
            </p>
          </div>
        </section>
      )}

      {submission?.correctionDetail ? (
        <Section eyebrow="Correction requested" title="What the Creator was asked to change">
          <p>{submission.correctionDetail}</p>
          {submission.correctionDueAt ? (
            <Note>Correction due {submission.correctionDueAt}.</Note>
          ) : null}
          {/* §17: a correction pauses the link, and new traffic is not payable
              until a corrected post passes. */}
          <Note>
            The Affiliate link is paused while a correction is outstanding, so new traffic is
            not payable until a corrected post passes.
          </Note>
        </Section>
      ) : null}

      {submission?.checklist ? (
        <Section eyebrow="Verification" title="The seven §17 checks, as recorded">
          <Group>
            {submission.checklist.map((check) => (
              <div className="frow" key={check.id}>
                <dt>{check.label}</dt>
                <dd>{check.passed ? 'Passed' : 'Did not pass'}</dd>
              </div>
            ))}
          </Group>
          {submission.verifiedBy ? (
            <Note>Recorded by {submission.verifiedBy}.</Note>
          ) : null}
          <Note>{FIRST_POST_RELEASES_ZERO}</Note>
        </Section>
      ) : null}

      {content.history.length > 1 ? (
        <Section eyebrow="Submission history" title={`${content.history.length} versions`}>
          <div className="cr-versions">
            {content.history.map((entry) => (
              <article className="cr-version" key={`${entry.version}-${entry.url}`}>
                <span className="cr-version__no">v{entry.version}</span>
                <span className="cr-version__main">
                  <strong>{entry.url}</strong>
                  <small>{entry.submittedAt ?? 'Submission time not recorded'}</small>
                </span>
                <span className="cr-version__state">
                  <strong>{entry.status}</strong>
                </span>
              </article>
            ))}
          </div>
          <Note>Every corrected version stays in the record. A resubmission is a new one.</Note>
        </Section>
      ) : null}

      {/* ── §29.6: the required Creator who did not post ───────────────────── */}
      {content.launchFailure.required || content.launchFailure.failure ? (
        <Section
          eyebrow="§29.6 · Required for launch"
          title={
            content.launchFailure.failure
              ? content.launchFailure.failure.status === 'replacement_pending'
                ? 'Replacement window open'
                : content.launchFailure.failure.status.replace(/_/g, ' ')
              : 'Required launch Creator'
          }
          actions={
            content.launchFailure.failure === null ? (
              /*
                Offered only against a Creator §15 marked required for launch.
                A failure against somebody nobody is waiting on would start a
                replacement clock for a roster that is already whole.
              */
              <Button
                tier="tertiary"
                small
                onClick={(event) => onOp('creator_failure', event.currentTarget)}
              >
                Record a failure to post
              </Button>
            ) : content.launchFailure.failure.status === 'replacement_pending' ? (
              <Button
                tier="secondary"
                small
                onClick={(event) => onOp('resolve_replacement', event.currentTarget)}
              >
                Mark the replacement ready
              </Button>
            ) : null
          }
        >
          {content.launchFailure.failure ? (
            <>
              <Group>
                <div className="frow">
                  <dt>Replacement due</dt>
                  <dd>
                    {content.launchFailure.failure.dueAt ?? (
                      <span className="grey">Not recorded</span>
                    )}
                    <p className="helper">
                      Three US business days on calendar {content.launchFailure.failure.calendarVersion},
                      stored with the version that produced it. The window is non-resettable —
                      a retry returns the same deadline rather than moving it.
                    </p>
                  </dd>
                </div>
                <div className="frow frow--wide">
                  <dt>Replacement plan</dt>
                  <dd>{content.launchFailure.failure.replacementDesignation}</dd>
                </div>
                <div className="frow">
                  <dt>Recorded</dt>
                  <dd>
                    {content.launchFailure.failure.recordedAt ?? (
                      <span className="grey">Not recorded</span>
                    )}
                  </dd>
                </div>
              </Group>
              <Note>
                If the window lapses, every funded fixed Creator payment on the campaign is
                returned and the full listing fee is refunded. Nothing here does that — the
                sweep does, at the deadline.
              </Note>
            </>
          ) : (
            <p className="grey">
              §15 marked this Creator required for launch. Nothing has been recorded against
              them.
            </p>
          )}
        </Section>
      ) : null}

      {/* ── Parked, and honest about why ──────────────────────────────────── */}
      <Section
        eyebrow="Deliverables"
        title="Per-deliverable evidence"
        actions={
          <Button tier="secondary" small {...parked('deliverableEvidence')}>
            Review deliverable evidence
          </Button>
        }
      >
        <p className="grey">
          The product records the first-post submission above and the §22.1 completion
          decision on the Money pane. There is no per-deliverable evidence record between
          them, so there is nothing here to review against.
        </p>
      </Section>

      <Section
        eyebrow="Availability"
        title="Content availability period"
        actions={
          <Button tier="secondary" small {...parked('availability')}>
            Verify content availability
          </Button>
        }
      >
        <p className="grey">
          No availability record exists, and the Spec fixes no availability period to check
          against.
        </p>
      </Section>

      {/* ── §18's traffic ─────────────────────────────────────────────────── */}
      <Section eyebrow="Attribution" title="Traffic and attributed pre-orders">
        {content.performance.populated && content.performance.value ? (
          <>
            <div className="cr-metrics">
              <div>
                <span>Clicks</span>
                <strong>{content.performance.value.clicks}</strong>
              </div>
              <div>
                <span>Attributed pre-orders</span>
                <strong>{content.performance.value.attributedReservations}</strong>
              </div>
              <div>
                <span>Captured attributed Backers</span>
                <strong>{content.performance.value.capturedAttributed}</strong>
              </div>
              <div>
                <span>Conversion</span>
                {/*
                  §16a: a rate over zero clicks is not 0%, it is a rate nobody
                  can compute yet. The em dash is the honest answer.
                */}
                <strong>{content.performance.value.conversion ?? '—'}</strong>
              </div>
              <div>
                <span>Attributed captured pre-tax subtotal</span>
                <strong>{content.performance.value.capturedSubtotal}</strong>
              </div>
              <div>
                <span>Freshness</span>
                <strong>{content.performance.value.freshness}</strong>
              </div>
            </div>
            <Note>{ATTRIBUTION_FOOTNOTE}</Note>
          </>
        ) : (
          /* §16a: not yet populated is not zero. It says what it waits on. */
          <p className="grey">{content.performance.waitingOn}</p>
        )}
      </Section>
    </div>
  );
}
