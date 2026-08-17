/**
 * The Content & Compliance tab — Posts · Deliverables · Agreements &
 * Disclosures · Risk & Compliance. Spec §17, §18, §20, §22.4 idiom, §26.7,
 * §29.6. Session C of the Affiliate rebuild.
 *
 * Posts absorbs the old RelContent pane verbatim; Deliverables is gap 1 (the
 * 0048 records, finally written); the availability line is gap 2 (the check
 * against the AGREED term, composed server-side and shown read-only); Risk &
 * Compliance carries gap 7's case intake. The disclosure facts render the §20
 * register's own obligation sentences — the product's real recorded rule —
 * never the reference's invented one-liner.
 */

import { useState } from 'react';
import {
  AVAILABILITY_TERM_IS_AGREED,
  CREATOR_OBLIGATIONS,
  DELIVERABLE_RESTATES_AGREEMENT,
  FIRST_POST_RELEASES_ZERO,
  RED_FLAGS_LABEL,
} from '@proovd/shared';
import { Button } from '../../../../components/index.js';
import { useToast } from '../../../../motion/MotionProvider.js';
import {
  decideDeliverable,
  recordDeliverable,
  recordDeliverableEvidence,
  verifyContentAvailability,
  AdminRequestError,
  type CreatorRelationshipDetail,
  type CreatorWorkspaceDetail,
  type DeliverableView,
} from '../api.js';
import { Group, Note, Section } from '../shared.js';
import { ConfirmDialog, type DialogSpec } from '../../founders/dialogs/ConfirmDialog.js';
import type { RelationshipOp } from '../dialogs/RelationshipOpsDialog.js';
import { CaseIntakeDialog } from './SupportSections.js';

export interface ContentSectionProps {
  sectionKey: string;
  detail: CreatorWorkspaceDetail;
  rel: CreatorRelationshipDetail;
  onOp: (op: RelationshipOp, trigger: HTMLElement | null, versionId?: string) => void;
  onRel: (next: CreatorRelationshipDetail) => void;
  onDone: (next: CreatorWorkspaceDetail) => void;
  navigate: (to: string) => void;
}

export function ContentTabSection(props: ContentSectionProps) {
  switch (props.sectionKey) {
    case 'posts':
      return <PostsSection {...props} />;
    case 'deliverables':
      return <DeliverablesSection {...props} />;
    case 'disclosures':
      return <DisclosuresSection {...props} />;
    case 'risk':
      return <RiskSection {...props} />;
    default:
      return null;
  }
}

/* ── Posts — the RelContent pane, absorbed ──────────────────────────────────*/

function PostsSection({ detail, rel, onOp, navigate }: ContentSectionProps) {
  const submission = rel.content.submission;
  const prospectId = detail.header.prospectId;
  const review = () =>
    navigate(`/admin/creators/${prospectId}/relationships/${rel.associationId}/review`);

  return (
    <div className="cr-stack">
      {submission ? (
        <section className={`cr-post cr-post--${submission.status}`} aria-label="Submitted public post">
          <p className="kicker">Public post · version {submission.version}</p>
          <h2>{submission.statusLabel}</h2>
          <a className="cr-post__url" href={submission.url} target="_blank" rel="noreferrer" data-press>
            {submission.url}
          </a>
          <small>
            {submission.submittedAt ?? 'Submission time not recorded'}
            {submission.verifiedAt ? ` · verified ${submission.verifiedAt}` : ''}
          </small>
          {submission.status === 'submitted' ? (
            <div className="cr-post__actions">
              <Button onClick={review}>Review submitted post</Button>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="cr-task cr-task--waiting">
          <div>
            <h2>No public post submitted</h2>
            <p>Work cannot begin until §16 readiness is cleared and the tracking link is active.</p>
          </div>
        </section>
      )}

      {submission?.correctionDetail ? (
        <Section eyebrow="Correction requested" title="What the Creator was asked to change">
          <p>{submission.correctionDetail}</p>
          {submission.correctionDueAt ? <Note>Correction due {submission.correctionDueAt}.</Note> : null}
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
          {submission.verifiedBy ? <Note>Recorded by {submission.verifiedBy}.</Note> : null}
          <Note>{FIRST_POST_RELEASES_ZERO}</Note>
        </Section>
      ) : null}

      {rel.content.history.length > 1 ? (
        <Section eyebrow="Submission history" title={`${rel.content.history.length} versions`}>
          <div className="cr-versions">
            {rel.content.history.map((entry) => (
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

      {rel.content.launchFailure.required || rel.content.launchFailure.failure ? (
        <Section
          eyebrow="§29.6 · Required for launch"
          title={
            rel.content.launchFailure.failure
              ? rel.content.launchFailure.failure.status === 'replacement_pending'
                ? 'Replacement window open'
                : rel.content.launchFailure.failure.status.replace(/_/g, ' ')
              : 'Required launch Creator'
          }
          actions={
            rel.content.launchFailure.failure === null ? (
              <Button tier="tertiary" small onClick={(event) => onOp('creator_failure', event.currentTarget)}>
                Record a failure to post
              </Button>
            ) : rel.content.launchFailure.failure.status === 'replacement_pending' ? (
              <Button tier="secondary" small onClick={(event) => onOp('resolve_replacement', event.currentTarget)}>
                Mark the replacement ready
              </Button>
            ) : null
          }
        >
          {rel.content.launchFailure.failure ? (
            <>
              <Group>
                <div className="frow">
                  <dt>Replacement due</dt>
                  <dd>
                    {rel.content.launchFailure.failure.dueAt ?? (
                      <span className="grey">Not recorded</span>
                    )}
                    <p className="helper">
                      Three US business days on calendar{' '}
                      {rel.content.launchFailure.failure.calendarVersion}, stored with the
                      version that produced it. The window is non-resettable — a retry returns
                      the same deadline rather than moving it.
                    </p>
                  </dd>
                </div>
                <div className="frow frow--wide">
                  <dt>Replacement plan</dt>
                  <dd>{rel.content.launchFailure.failure.replacementDesignation}</dd>
                </div>
                <div className="frow">
                  <dt>Recorded</dt>
                  <dd>
                    {rel.content.launchFailure.failure.recordedAt ?? (
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
    </div>
  );
}

/* ── Deliverables — gap 1, the 0048 records written at last ─────────────────*/

type DeliverableDialog =
  | { kind: 'record'; trigger: HTMLElement | null }
  | { kind: 'evidence'; deliverable: DeliverableView; trigger: HTMLElement | null }
  | { kind: 'decide'; deliverable: DeliverableView; trigger: HTMLElement | null }
  | { kind: 'availability'; trigger: HTMLElement | null };

function DeliverablesSection({ detail, rel, onRel }: ContentSectionProps) {
  const toast = useToast();
  const [dialog, setDialog] = useState<DeliverableDialog | null>(null);
  const prospectId = detail.header.prospectId;
  const { deliverables, availability } = rel;

  async function run(work: Promise<CreatorRelationshipDetail>, done: string) {
    try {
      onRel(await work);
      toast(done);
      setDialog(null);
    } catch (error) {
      throw error instanceof AdminRequestError
        ? new Error(error.detail.whatHappened ?? error.detail.title)
        : error;
    }
  }

  const decideSpec = (deliverable: DeliverableView): DialogSpec => ({
    kicker: `${rel.band.campaignName} · §22.4 idiom`,
    title: 'Review deliverable evidence',
    body: (
      <>
        <strong>{deliverable.title}</strong> — {deliverable.stateLabel}
        {deliverable.latestEvidence ? (
          <p className="helper">
            Latest receipt: {deliverable.latestEvidence.reference}
            {deliverable.latestEvidence.submittedAt
              ? ` · ${deliverable.latestEvidence.submittedAt}`
              : ''}
          </p>
        ) : (
          <p className="helper">No evidence receipt has been recorded yet.</p>
        )}
      </>
    ),
    fields: [
      {
        id: 'outcome',
        label: 'Decision',
        required: true,
        select: true,
        options: [
          { value: 'verified', label: 'Verify the deliverable' },
          { value: 'more_evidence_needed', label: 'Request more deliverable evidence' },
          { value: 'waived', label: 'Record a Founder/Admin waiver' },
        ],
      },
      {
        id: 'findings',
        label: 'Findings',
        required: true,
        textarea: true,
        hint: 'What was looked at and what it showed. Required on every outcome.',
      },
      {
        id: 'waiverRecordedBy',
        label: 'Waiver recorded by',
        hint: 'Only on a waiver — the named person, because a waived work item with no name is a decision nobody made. Refused on the other outcomes.',
      },
      {
        id: 'waiverReason',
        label: 'Waiver reason',
        textarea: true,
        hint: 'Only on a waiver.',
      },
    ],
    primary: 'Record the decision',
    secondary: 'Cancel',
  });

  return (
    <div className="cr-stack">
      <Section
        eyebrow="Deliverables"
        title={`${deliverables.resolved} of ${deliverables.items.length} resolved`}
        actions={
          deliverables.canRecord ? (
            <Button
              tier="secondary"
              small
              onClick={(event) => setDialog({ kind: 'record', trigger: event.currentTarget })}
            >
              Record agreed deliverable
            </Button>
          ) : null
        }
      >
        {deliverables.items.length === 0 ? (
          <p className="grey">
            {deliverables.canRecord
              ? 'No agreed work item has been recorded yet. Each one restates the accepted agreement.'
              : 'No accepted agreement exists on this relationship yet, so there is nothing for a deliverable to restate.'}
          </p>
        ) : (
          <div className="cr-dlist">
            {deliverables.items.map((item) => (
              <article className="cr-drow" key={item.id}>
                <span className="cr-drow__main">
                  <strong>{item.title}</strong>
                  <small>
                    {item.stateLabel} · restates {item.source}
                  </small>
                  {item.latestEvidence ? (
                    <small>
                      Latest receipt: {item.latestEvidence.reference}
                      {item.latestEvidence.submittedAt
                        ? ` · ${item.latestEvidence.submittedAt}`
                        : ''}
                    </small>
                  ) : null}
                  {item.latestDecision?.outcome === 'waived' ? (
                    <small>
                      Waived by {item.latestDecision.waiverRecordedBy} ·{' '}
                      {item.latestDecision.waiverReason}
                    </small>
                  ) : null}
                </span>
                <span className="cr-drow__acts">
                  <Button
                    tier="tertiary"
                    small
                    onClick={(event) =>
                      setDialog({ kind: 'evidence', deliverable: item, trigger: event.currentTarget })
                    }
                  >
                    Record evidence receipt
                  </Button>
                  <Button
                    tier="secondary"
                    small
                    onClick={(event) =>
                      setDialog({ kind: 'decide', deliverable: item, trigger: event.currentTarget })
                    }
                  >
                    Review deliverable evidence
                  </Button>
                </span>
              </article>
            ))}
          </div>
        )}
        <Note>{DELIVERABLE_RESTATES_AGREEMENT}</Note>
      </Section>

      {/* ── Gap 2 — the availability line ─────────────────────────────────── */}
      <Section
        eyebrow="Availability"
        title={
          availability.latest
            ? availability.latest.available
              ? 'Availability period verified'
              : 'Checked · content not available'
            : 'Availability period not verified'
        }
        actions={
          <Button
            tier="secondary"
            small
            onClick={(event) => setDialog({ kind: 'availability', trigger: event.currentTarget })}
          >
            Verify content availability
          </Button>
        }
      >
        <Group>
          <div className="frow frow--wide">
            <dt>Agreed campaign availability period</dt>
            <dd>
              {availability.term}
              <p className="helper">{availability.termSource}</p>
            </dd>
          </div>
          {availability.latest ? (
            <>
              <div className="frow">
                <dt>Latest check</dt>
                <dd>
                  {availability.latest.available ? 'Available' : 'Not available'}
                  {availability.latest.verifiedAt ? ` · ${availability.latest.verifiedAt}` : ''}
                </dd>
              </div>
              <div className="frow frow--wide">
                <dt>What was checked</dt>
                <dd>{availability.latest.detail}</dd>
              </div>
            </>
          ) : null}
        </Group>
        <Note>{AVAILABILITY_TERM_IS_AGREED}</Note>
      </Section>

      {dialog?.kind === 'record' ? (
        <ConfirmDialog
          trigger={dialog.trigger}
          spec={{
            kicker: `${rel.band.campaignName} · §22.4 idiom`,
            title: 'Record agreed deliverable',
            body: (
              <>
                The source is computed from the accepted agreement — this one will restate{' '}
                <strong>{deliverables.sourceLabel}</strong>.
              </>
            ),
            fields: [
              {
                id: 'title',
                label: 'The agreed work item',
                required: true,
                hint: 'As the accepted agreement states it — for example “Launch post on the approved channel”.',
              },
            ],
            primary: 'Record the deliverable',
            secondary: 'Cancel',
          }}
          onClose={() => setDialog(null)}
          onSubmit={(values) =>
            run(
              recordDeliverable(prospectId, rel.associationId, { title: values['title'] ?? '' }),
              'Deliverable recorded',
            )
          }
        />
      ) : null}

      {dialog?.kind === 'evidence' ? (
        <ConfirmDialog
          trigger={dialog.trigger}
          spec={{
            kicker: `${rel.band.campaignName} · §22.4 idiom`,
            title: 'Record evidence receipt',
            body: (
              <>
                What was supplied against <strong>{dialog.deliverable.title}</strong>. A
                resubmission is a new receipt and the earlier one survives.
              </>
            ),
            fields: [
              {
                id: 'reference',
                label: 'Public URL or description',
                required: true,
                hint: 'A file goes on the evidence-pictures record; this receipt points at what was supplied.',
              },
              { id: 'note', label: 'Note', textarea: true },
            ],
            primary: 'Record the receipt',
            secondary: 'Cancel',
          }}
          onClose={() => setDialog(null)}
          onSubmit={(values) =>
            run(
              recordDeliverableEvidence(prospectId, rel.associationId, dialog.deliverable.id, {
                reference: values['reference'] ?? '',
                note: values['note'] || null,
              }),
              'Evidence receipt recorded',
            )
          }
        />
      ) : null}

      {dialog?.kind === 'decide' ? (
        <ConfirmDialog
          trigger={dialog.trigger}
          spec={decideSpec(dialog.deliverable)}
          onClose={() => setDialog(null)}
          onSubmit={(values) =>
            run(
              decideDeliverable(prospectId, rel.associationId, dialog.deliverable.id, {
                outcome: values['outcome'] ?? '',
                findings: values['findings'] ?? '',
                waiverRecordedBy: values['waiverRecordedBy'] || null,
                waiverReason: values['waiverReason'] || null,
              }),
              'Decision recorded',
            )
          }
        />
      ) : null}

      {dialog?.kind === 'availability' ? (
        <ConfirmDialog
          trigger={dialog.trigger}
          spec={{
            kicker: `${rel.band.campaignName} · §22.1`,
            title: 'Verify content availability',
            body: (
              <>
                Checked against the agreed term, stored verbatim on the record:
                <p className="helper">{availability.term}</p>
              </>
            ),
            fields: [
              {
                id: 'available',
                label: 'Is the content available?',
                required: true,
                select: true,
                options: [
                  { value: 'yes', label: 'Available against the agreed term' },
                  { value: 'no', label: 'Not available' },
                ],
              },
              {
                id: 'detail',
                label: 'Evidence or check note',
                required: true,
                textarea: true,
                placeholder: 'Public URLs checked against the accepted availability term.',
              },
            ],
            primary: 'Record the check',
            secondary: 'Cancel',
          }}
          onClose={() => setDialog(null)}
          onSubmit={(values) =>
            run(
              verifyContentAvailability(prospectId, rel.associationId, {
                available: values['available'] === 'yes',
                detail: values['detail'] ?? '',
              }),
              'Availability check recorded',
            )
          }
        />
      ) : null}
    </div>
  );
}

/* ── Agreements & Disclosures — the recorded rule, not an invented text ─────*/

function DisclosuresSection({ detail, rel }: ContentSectionProps) {
  const perCampaign = detail.profile.agreements.perCampaign.find(
    (row) => row.associationId === rel.associationId,
  );
  const disclosure = CREATOR_OBLIGATIONS.find((entry) => entry.key === 'disclosure');
  const availability = CREATOR_OBLIGATIONS.find((entry) => entry.key === 'content_availability');

  return (
    <div className="cr-stack">
      <Section eyebrow="Disclosure & agreement control" title="Exact campaign version">
        <Group>
          <div className="frow">
            <dt>Per-campaign IP / confidentiality</dt>
            <dd>{perCampaign?.state ?? 'Not started'}</dd>
          </div>
          <div className="frow">
            <dt>Current post</dt>
            <dd>{rel.content.submission?.statusLabel ?? 'No public post submitted'}</dd>
          </div>
          <div className="frow frow--wide">
            <dt>Disclosure obligation</dt>
            {/* §20's own recorded sentence — the rule the Creator accepted,
                which is what a disclosure fact can truthfully render. */}
            <dd>{disclosure?.statement}</dd>
          </div>
          <div className="frow frow--wide">
            <dt>Availability obligation</dt>
            <dd>{availability?.statement}</dd>
          </div>
        </Group>
        <Note>
          The Campaign kit grants no work permission and creates no commercial terms —
          compensation, required work, dates, availability, tracking, and disclosure
          acceptance all live on their own records (§31.5).
        </Note>
      </Section>
    </div>
  );
}

/* ── Risk & Compliance — the person's open cases, and gap 7's intake ────────*/

function RiskSection({ detail, rel, onDone }: ContentSectionProps) {
  const [caseTrigger, setCaseTrigger] = useState<HTMLElement | null>(null);
  const openCases = detail.standing.cases.filter((entry) => entry.open);
  const adminBlock = detail.profile.blocks.find((block) => block.provenance === 'admin');
  const conflicts = adminBlock?.fields.find((field) => field.key === 'conflicts');
  const redFlags = adminBlock?.fields.find((field) => field.key === 'sanctions');

  return (
    <div className="cr-stack">
      {openCases.length > 0 ? (
        <section className="cr-task">
          <div>
            <p className="kicker">Open risk &amp; compliance</p>
            <h2>
              {openCases.length} open case{openCases.length === 1 ? '' : 's'}
            </h2>
            <p>{openCases.map((entry) => entry.subject ?? entry.reference).join(' · ')}</p>
          </div>
        </section>
      ) : (
        <section className="cr-task cr-task--waiting">
          <div>
            <h2>No open compliance case</h2>
            <p>Post, campaign, and account evidence remain available in History.</p>
          </div>
        </section>
      )}

      <Section
        eyebrow="Relationship risk"
        title={rel.band.campaignName}
        actions={
          <Button tier="secondary" small onClick={(event) => setCaseTrigger(event.currentTarget)}>
            Record a support case
          </Button>
        }
      >
        <Group>
          <div className="frow">
            <dt>Account access</dt>
            <dd>{detail.header.account}</dd>
          </div>
          <div className="frow">
            <dt>Link state</dt>
            <dd>{rel.overview.link?.label ?? 'No Affiliate link yet'}</dd>
          </div>
          <div className="frow">
            <dt>Conflicts</dt>
            <dd>{conflicts?.value ?? <span className="grey">None recorded</span>}</dd>
          </div>
          <div className="frow">
            <dt>{RED_FLAGS_LABEL}</dt>
            <dd>{redFlags?.value ?? <span className="grey">None recorded</span>}</dd>
          </div>
        </Group>
      </Section>

      {caseTrigger ? (
        <CaseIntakeDialog
          detail={detail}
          associationId={rel.associationId}
          trigger={caseTrigger}
          onClose={() => setCaseTrigger(null)}
          onDone={(next) => {
            onDone(next);
            setCaseTrigger(null);
          }}
        />
      ) : null}
    </div>
  );
}
