/**
 * The Campaigns tab — Relationships · Opportunities & Negotiations ·
 * Readiness & Active · Completion & Work Again. Spec §14.2, §14.3, §16, §17,
 * §22.8, §22.9, §24.7, §31.5. Session C of the Affiliate rebuild
 * (docs/phases/admin-affiliate-rebuild.md).
 *
 * Everything here renders from the ONE relationship read (`?rel=` selects it),
 * absorbing the old relationship page's Overview and Agreement panes verbatim
 * where the reference kept their content. What the reference adds and the Spec
 * permits is built (the mediation note, the availability fact, the work-again
 * record); what it adds and the Spec forbids renders the refusal sentence from
 * `AFFILIATE_OPERATIONS_ABSENCES` where the control would have been.
 */

import { useState } from 'react';
import {
  ADMIN_CANNOT_ACCEPT,
  ATTRIBUTION_FOOTNOTE,
  DELIVERABLE_RESTATES_AGREEMENT,
  FIXED_CREATOR_PAYMENT_LABEL,
  FIXED_PAYMENT_FUNDED_IS_NOT_PAID,
  SALES_ARE_NOT_A_COMPLETION_REQUIREMENT,
  affiliateOperationsAbsence,
} from '@proovd/shared';
import { Button, Copylink } from '../../../../components/index.js';
import { cn } from '../../../../components/cn.js';
import { useToast } from '../../../../motion/MotionProvider.js';
import {
  recordMediationNote,
  AdminRequestError,
  type CreatorRelationshipDetail,
  type CreatorWorkspaceDetail,
} from '../api.js';
import { Group, Note, OwnerPill, Section } from '../shared.js';
import { ConfirmDialog } from '../../founders/dialogs/ConfirmDialog.js';
import type { RelationshipOp } from '../dialogs/RelationshipOpsDialog.js';

const FIXED_PAYMENT_CHAIN = [
  'Not requested',
  'Awaiting agreement',
  'Payment pending',
  'Funded',
  'Payment failed',
  'Returned',
  'Paid',
] as const;

export interface CampaignSectionProps {
  sectionKey: string;
  detail: CreatorWorkspaceDetail;
  rel: CreatorRelationshipDetail;
  onSelectRel: (associationId: string) => void;
  onOp: (op: RelationshipOp, trigger: HTMLElement | null, versionId?: string) => void;
  onLinkControls: (trigger: HTMLElement | null) => void;
  onOpenTab: (tab: string, section?: string) => void;
  onRel: (next: CreatorRelationshipDetail) => void;
  navigate: (to: string) => void;
}

export function CampaignTabSection(props: CampaignSectionProps) {
  switch (props.sectionKey) {
    case 'relationships':
      return <RelationshipsSection {...props} />;
    case 'negotiations':
      return <NegotiationsSection {...props} />;
    case 'readiness':
      return <ReadinessSection {...props} />;
    case 'completion':
      return <CompletionSection {...props} />;
    default:
      return null;
  }
}

/* ── Relationships — the card grid and the fact card ────────────────────────*/

function RelationshipsSection({ detail, rel, onSelectRel }: CampaignSectionProps) {
  const { relationships } = detail;
  const active = relationships.filter((r) => r.holdsSlot).length;
  const relationshipEdit = affiliateOperationsAbsence('relationshipEdit');

  return (
    <div className="cr-stack">
      <Section
        eyebrow="Affiliate×Campaign objects"
        title={`${relationships.length} relationship${relationships.length === 1 ? '' : 's'} · ${active} of ${detail.header.slots.limit} active slots`}
      >
        <div className="cr-rel-list">
          {relationships.map((summary) => (
            <button
              key={summary.associationId}
              type="button"
              className={cn(
                'cr-relpick',
                summary.associationId === rel.associationId && 'is-active',
              )}
              onClick={() => onSelectRel(summary.associationId)}
            >
              <span className="cr-rel__main">
                <strong>{summary.campaignName}</strong>
                <small>
                  {[summary.founderName, summary.campaignType].filter(Boolean).join(' · ')}
                </small>
              </span>
              <span className="cr-rel__state">
                <strong>{summary.status}</strong>
                <small>{summary.designation}</small>
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section eyebrow="Selected relationship" title={rel.band.campaignName}>
        <Group>
          <div className="frow">
            <dt>Relationship ID</dt>
            {/* `cr-idval`, not `cr-mono` — the latter is the monogram AVATAR
                square, and only a browser pass tells the two apart. */}
            <dd className="cr-idval">{rel.associationId}</dd>
          </div>
          <div className="frow">
            <dt>Designation</dt>
            <dd>{rel.band.designation}</dd>
          </div>
          <div className="frow">
            <dt>Lifecycle state</dt>
            <dd>{rel.band.status}</dd>
          </div>
          <div className="frow">
            <dt>Current owner</dt>
            <dd>
              <OwnerPill owner={rel.band.owner} />
            </dd>
          </div>
          <div className="frow">
            <dt>Agreement</dt>
            <dd>{rel.agreement.lockState}</dd>
          </div>
          <div className="frow">
            <dt>Tracking link</dt>
            <dd>{rel.overview.link?.label ?? 'No Affiliate link yet'}</dd>
          </div>
          {rel.band.responseDeadlineAt ? (
            <div className="frow">
              <dt>Formal response deadline</dt>
              {/* §14.6's one fixed window — rendered from the stored
                  evaluation, never recomputed here. */}
              <dd>{rel.band.responseDeadlineAt}</dd>
            </div>
          ) : null}
        </Group>
        {/* The reference's "Edit Admin-owned relationship data" — refused, and
            the sentence renders where the control would have been (§1.8). */}
        <Note>{relationshipEdit.sentence}</Note>
      </Section>
    </div>
  );
}

/* ── Opportunities & Negotiations — the RelAgreement pane, absorbed ─────────*/

function NegotiationsSection({ detail, rel, onOp, onRel }: CampaignSectionProps) {
  const toast = useToast();
  const [mediationTrigger, setMediationTrigger] = useState<HTMLElement | null>(null);
  const { agreement } = rel;
  const openVersion = agreement.versions.find(
    (version) => version.state === 'awaiting_founder' || version.state === 'awaiting_creator',
  );

  return (
    <div className="cr-stack">
      {openVersion ? (
        <section className="cr-task cr-task--waiting">
          <div>
            <OwnerPill
              owner={openVersion.state === 'awaiting_founder' ? 'Founder' : 'Affiliate'}
              prefix
            />
            <h2>Proposal version {openVersion.number} waiting</h2>
            <p>The bilateral decision remains with the Founder and the Affiliate.</p>
          </div>
        </section>
      ) : null}

      <section className="cr-terms">
        <p className="kicker">{agreement.lockState}</p>
        <h2>
          {agreement.headlinePercent ? <b>{agreement.headlinePercent}</b> : null}
          <span>{agreement.headlineRest}</span>
        </h2>
        {agreement.bonus ? <p className="cr-terms__bonus">{agreement.bonus}</p> : null}
      </section>

      {agreement.agreement ? (
        <Section eyebrow="Locked terms" title="What both parties accepted">
          <Group>
            <div className="frow">
              <dt>Base</dt>
              <dd>{agreement.agreement.basePercent}%</dd>
            </div>
            <div className="frow">
              <dt>Bid increase</dt>
              <dd>{agreement.agreement.bidIncreasePercent}%</dd>
            </div>
            <div className="frow">
              <dt>Total</dt>
              <dd>
                {agreement.agreement.totalPercent}%
                <p className="helper">
                  Base, bid, and any Creator-specific bonus together never exceed 50% of the
                  attributed captured pre-tax reward subtotal.
                </p>
              </dd>
            </div>
            <div className="frow">
              <dt>Accepted</dt>
              <dd>
                {agreement.agreement.acceptedAt ?? <span className="grey">Not recorded</span>}
              </dd>
            </div>
          </Group>
        </Section>
      ) : null}

      <Section
        eyebrow={FIXED_CREATOR_PAYMENT_LABEL}
        title={agreement.fixedPayment.status}
        aside={
          agreement.fixedPayment.amount ? (
            <span className="cr-count">{agreement.fixedPayment.amount}</span>
          ) : null
        }
      >
        <Group>
          <div className="frow">
            <dt>Rule</dt>
            <dd>{agreement.fixedPayment.rule}</dd>
          </div>
          <div className="frow">
            <dt>Source</dt>
            <dd>{agreement.fixedPayment.source}</dd>
          </div>
          <div className="frow">
            <dt>Funded</dt>
            <dd>{agreement.fixedPayment.fundedAt ?? <span className="grey">Not funded</span>}</dd>
          </div>
          <div className="frow">
            <dt>Funding deadline</dt>
            <dd>
              {agreement.fixedPayment.deadlineAt ?? <span className="grey">No deadline set</span>}
            </dd>
          </div>
        </Group>
        {agreement.fixedPayment.available ? (
          <>
            <ol className="cr-chain" aria-label="Fixed Creator payment states">
              {FIXED_PAYMENT_CHAIN.map((state) => (
                <li
                  key={state}
                  className={state === agreement.fixedPayment.status ? 'is-current' : undefined}
                  {...(state === agreement.fixedPayment.status
                    ? { 'aria-current': 'step' as const }
                    : {})}
                >
                  {state}
                </li>
              ))}
            </ol>
            <Note>{FIXED_PAYMENT_FUNDED_IS_NOT_PAID}</Note>
          </>
        ) : null}
      </Section>

      <Section
        eyebrow="Commercial record"
        title={
          agreement.versions.length === 1
            ? '1 proposal version'
            : `${agreement.versions.length} proposal versions`
        }
      >
        {agreement.versions.length === 0 ? (
          <p className="grey">
            No proposal has been made. Standard terms are accepted without one (§14.2).
          </p>
        ) : (
          <div className="cr-versions">
            {agreement.versions.map((version) => (
              <article className="cr-version" key={version.id}>
                <span className="cr-version__no">v{version.number}</span>
                <span className="cr-version__main">
                  <strong>
                    {version.totalPercent === null
                      ? 'No percentage proposed'
                      : `${version.totalPercent}%`}
                    {version.fixedPaymentCents
                      ? ` · ${version.fixedPaymentCents} fixed Creator payment`
                      : ''}
                  </strong>
                  <small>
                    Proposed by the {version.proposedBy}
                    {version.createdAt ? ` · ${version.createdAt}` : ''}
                  </small>
                </span>
                <span className="cr-version__state">
                  <strong>{version.state.replace(/_/g, ' ')}</strong>
                  <small>
                    Creator {version.affiliateDecision ?? 'no answer'} · Founder{' '}
                    {version.founderDecision ?? 'no answer'}
                  </small>
                </span>
                {version.state === 'awaiting_founder' || version.state === 'awaiting_creator' ? (
                  <Button
                    tier="tertiary"
                    small
                    onClick={(event) => onOp('reject_version', event.currentTarget, version.id)}
                  >
                    Reject for policy
                  </Button>
                ) : null}
              </article>
            ))}
          </div>
        )}
        <Note>
          Every version is preserved exactly as it was proposed. A revision is a new version,
          and only the exact version both parties accepted becomes the locked agreement.
        </Note>
        <Note>{ADMIN_CANNOT_ACCEPT}</Note>
      </Section>

      {/* ── The mediation record (0048) ─────────────────────────────────── */}
      <Section
        eyebrow="Mediation"
        title={
          rel.mediationNotes.length === 0
            ? 'No mediation note recorded'
            : `${rel.mediationNotes.length} mediation note${rel.mediationNotes.length === 1 ? '' : 's'}`
        }
        actions={
          <Button
            tier="secondary"
            small
            onClick={(event) => setMediationTrigger(event.currentTarget)}
          >
            Record proposal mediation note
          </Button>
        }
      >
        {rel.mediationNotes.length === 0 ? (
          <p className="grey">
            What Admin tells the parties during a negotiation is recorded here. The record has
            no acceptance column — there is structurally nothing a note can decide.
          </p>
        ) : (
          <div className="cr-versions">
            {rel.mediationNotes.map((note, index) => (
              <article className="cr-version" key={`${note.createdAt}-${index}`}>
                <span className="cr-version__main">
                  <strong>{note.note}</strong>
                  <small>
                    {note.createdBy}
                    {note.createdAt ? ` · ${note.createdAt}` : ''}
                  </small>
                </span>
              </article>
            ))}
          </div>
        )}
      </Section>

      {mediationTrigger ? (
        <ConfirmDialog
          trigger={mediationTrigger}
          spec={{
            kicker: `${rel.band.campaignName} · §14.2`,
            title: 'Record proposal mediation note',
            body:
              'What Admin told the parties, without becoming a decision. Admin may observe, ' +
              'mediate, and reject a policy violation — and cannot accept for either party.',
            fields: [
              {
                id: 'note',
                label: 'Mediation note',
                required: true,
                textarea: true,
                hint: 'Clarify terms without substituting for bilateral acceptance.',
              },
            ],
            primary: 'Record the note',
            secondary: 'Cancel',
          }}
          onClose={() => setMediationTrigger(null)}
          onSubmit={async (values) => {
            try {
              const next = await recordMediationNote(detail.header.prospectId, rel.associationId, {
                note: values['note'] ?? '',
              });
              onRel(next);
              toast('Mediation note recorded');
              setMediationTrigger(null);
            } catch (error) {
              throw error instanceof AdminRequestError
                ? new Error(error.detail.whatHappened ?? error.detail.title)
                : error;
            }
          }}
        />
      ) : null}
    </div>
  );
}

/* ── Readiness & Active — the RelOverview pane, absorbed ────────────────────*/

function ReadinessSection({
  detail,
  rel,
  onOp,
  onLinkControls,
  onOpenTab,
  navigate,
}: CampaignSectionProps) {
  const { overview } = rel;
  const prospectId = detail.header.prospectId;

  return (
    <div className="cr-stack">
      {rel.overview.tasks.length === 0 ? (
        <p className="cr-caught-up">Nothing needs doing on this relationship right now.</p>
      ) : (
        rel.overview.tasks.map((task, index) => (
          <section
            key={`${task.title}-${index}`}
            className={cn('cr-task', task.kind === 'waiting' && 'cr-task--waiting')}
          >
            <div>
              <OwnerPill owner={task.owner} prefix />
              <h2>{task.title}</h2>
              <p>{task.meta}</p>
            </div>
            {task.action ? (
              <Button
                tier={task.owner === 'Admin' ? undefined : 'secondary'}
                onClick={() => {
                  const to = task.action!.to;
                  if (to === 'review') {
                    navigate(
                      `/admin/creators/${prospectId}/relationships/${rel.associationId}/review`,
                    );
                  } else if (to === 'profile') {
                    onOpenTab('profile', 'verification');
                  } else if (to === 'agreement') {
                    onOpenTab('campaigns', 'negotiations');
                  } else {
                    onOpenTab('performance', 'transfers');
                  }
                }}
              >
                {task.action.label}
              </Button>
            ) : null}
          </section>
        ))
      )}

      {/* ── The tracking link ─────────────────────────────────────────────── */}
      <Section
        eyebrow="Affiliate link"
        title={overview.link?.label ?? 'No Affiliate link yet'}
        actions={
          overview.link ? (
            <Button tier="secondary" small onClick={(event) => onLinkControls(event.currentTarget)}>
              Affiliate link history &amp; controls
            </Button>
          ) : null
        }
      >
        {overview.link ? (
          <>
            <Copylink url={overview.link.url ?? ''} />
            <Group>
              <div className="frow">
                <dt>Activated</dt>
                <dd>
                  {overview.link.activatedAt ?? (
                    <span className="grey">
                      Not activated yet — a click before activation earns nothing
                    </span>
                  )}
                </dd>
              </div>
              {overview.link.pausedAt ? (
                <div className="frow">
                  <dt>Paused</dt>
                  <dd>
                    {overview.link.pausedAt}
                    {overview.link.pausedReason ? (
                      <p className="helper">{overview.link.pausedReason}</p>
                    ) : null}
                  </dd>
                </div>
              ) : null}
              <div className="frow">
                <dt>Safe test link</dt>
                <dd>
                  <span className="fval">{overview.link.testUrl}</span>
                  <p className="helper">
                    Records the click as a test. It sets no attribution cookie and can never
                    replace an existing one.
                  </p>
                </dd>
              </div>
            </Group>
          </>
        ) : (
          <p className="grey">
            A tracking link is minted when the formal terms are accepted, and activated at
            launch (§14.2, §17).
          </p>
        )}
      </Section>

      {/* ── §16's readiness ───────────────────────────────────────────────── */}
      <Section
        eyebrow="Affiliate readiness"
        title={
          overview.readiness
            ? overview.readiness.canBeginWork
              ? 'Cleared to begin work'
              : 'Readiness incomplete'
            : 'Readiness not yet gathered'
        }
        aside={
          overview.readiness ? (
            <span className="cr-count">
              {overview.readiness.complete} of {overview.readiness.applicable}
            </span>
          ) : null
        }
        actions={
          <>
            <Button
              tier="secondary"
              small
              onClick={(event) => onOp('confirm_deliverables', event.currentTarget)}
            >
              Confirm required posts and deliverables
            </Button>
            <Button
              tier="secondary"
              small
              onClick={(event) => onOp('funding_deadline', event.currentTarget)}
            >
              Set the funding deadline
            </Button>
            <Button tier="tertiary" small onClick={(event) => onOp('evaluate', event.currentTarget)}>
              Re-derive readiness
            </Button>
          </>
        }
      >
        {overview.readiness ? (
          <>
            <div className="checklist" role="list">
              {overview.readiness.items.map((item) => (
                <div
                  className="check-line"
                  role="listitem"
                  key={item.key}
                  aria-label={`${item.label} — ${
                    !item.applicable ? 'not applicable' : item.complete ? 'done' : 'not done yet'
                  }`}
                >
                  <span
                    className={cn(
                      'phase__mark',
                      item.complete ? 'phase__mark--done' : 'phase__mark--next',
                    )}
                    aria-hidden="true"
                  >
                    {item.complete ? (
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <polyline points="4 13 10 19 20 6" />
                      </svg>
                    ) : null}
                  </span>
                  <span className={item.complete ? undefined : 'grey'}>
                    {item.label}
                    {!item.applicable ? ' · not applicable' : ''}
                  </span>
                  <span className="cr-owner-note">{item.owner}</span>
                </div>
              ))}
            </div>
            <Note>
              §16 readiness is complete or it is not: twelve of thirteen still blocks.
              Nothing here can be marked complete by hand — every item is derived from the
              record that holds it.
            </Note>
          </>
        ) : (
          <p className="grey">
            The thirteen §16 facts have not been gathered for this relationship yet.
          </p>
        )}
      </Section>

      {/* ── §31.5's Campaign kit, with the Session C visuals read ─────────── */}
      <Section
        eyebrow="Campaign kit"
        title={
          overview.kit.revokedAt
            ? 'Kit access revoked'
            : overview.kit.revealedAt
              ? 'Kit access granted'
              : 'Kit not revealed yet'
        }
        actions={
          <>
            <Button tier="secondary" small onClick={(event) => onOp('access_log', event.currentTarget)}>
              View the access log
            </Button>
            {overview.kit.revealedAt === null ? (
              <Button tier="secondary" small onClick={(event) => onOp('reveal', event.currentTarget)}>
                Reveal the preparing campaign
              </Button>
            ) : null}
            {overview.kit.revealedAt !== null && overview.kit.revokedAt === null ? (
              <Button tier="tertiary" small onClick={(event) => onOp('revoke_kit', event.currentTarget)}>
                Revoke kit access
              </Button>
            ) : null}
          </>
        }
      >
        <Group>
          <div className="frow">
            <dt>Revealed</dt>
            <dd>{overview.kit.revealedAt ?? <span className="grey">Not revealed yet</span>}</dd>
          </div>
          <div className="frow">
            <dt>Access</dt>
            <dd>Private · campaign-scoped · every read logged</dd>
          </div>
          <div className="frow">
            <dt>Reads recorded</dt>
            <dd>
              {overview.kit.accessCount}
              {overview.kit.lastAccessAt ? (
                <p className="helper">Last read {overview.kit.lastAccessAt}</p>
              ) : null}
            </dd>
          </div>
          {overview.kit.revokedAt ? (
            <div className="frow">
              <dt>Revoked</dt>
              <dd>
                {overview.kit.revokedAt}
                {overview.kit.revokedReason ? (
                  <p className="helper">{overview.kit.revokedReason}</p>
                ) : null}
              </dd>
            </div>
          ) : null}
        </Group>
        {/* Gap 6 — the visual kit read. Metadata from the campaign's own asset
            records; the preview absence names Track A4 rather than rendering a
            control that would fail (§1.4). */}
        {rel.kitAssets.files.length === 0 ? (
          <p className="grey">No visual assets are recorded on this campaign yet.</p>
        ) : (
          <div className="cr-versions">
            {rel.kitAssets.files.map((file) => (
              <article className="cr-version" key={file.id}>
                <span className="cr-version__main">
                  <strong>{file.filename ?? file.purpose}</strong>
                  <small>
                    {[
                      file.purpose,
                      file.dimensions,
                      file.approved ? 'Founder-approved' : 'Not approved yet',
                      file.removed ? 'removed' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </span>
                <span className="cr-version__state">
                  <strong>{file.state}</strong>
                </span>
              </article>
            ))}
          </div>
        )}
        {rel.kitAssets.waitingOn ? <Note>{rel.kitAssets.waitingOn}</Note> : null}
        <Note>
          §31.5 permits the pre-view only while it stays private, authenticated, logged,
          campaign-scoped, and revocable. The kit grants no work permission and creates no
          commercial terms.
        </Note>
      </Section>

      <Note>{ATTRIBUTION_FOOTNOTE}</Note>
    </div>
  );
}

/* ── Completion & Work Again ────────────────────────────────────────────────*/

function CompletionSection({ rel, onOp }: CampaignSectionProps) {
  const completion = rel.money.completion;
  const workAgainReissue = affiliateOperationsAbsence('workAgainReissue');
  const availability = rel.availability;

  return (
    <div className="cr-stack">
      <section className="cr-terms">
        <p className="kicker">Completion state</p>
        <h2>
          <span>
            {completion?.outcome
              ? completion.outcome.replace(/_/g, ' ')
              : 'No completion decision yet'}
          </span>
        </h2>
        <p className="cr-terms__bonus">
          {rel.deliverables.resolved} of {rel.deliverables.items.length} deliverables resolved ·
          availability {availability.latest?.available ? 'verified' : 'not verified'}
        </p>
      </section>

      <Section
        eyebrow="Successful completion"
        title="Campaign-specific decision"
        actions={
          <Button tier="secondary" small onClick={(event) => onOp('completion', event.currentTarget)}>
            Review successful completion
          </Button>
        }
      >
        <Group>
          <div className="frow">
            <dt>Post</dt>
            <dd>{rel.content.submission?.statusLabel ?? 'No public post submitted'}</dd>
          </div>
          <div className="frow">
            <dt>Availability</dt>
            <dd>
              {availability.latest
                ? availability.latest.available
                  ? 'Verified'
                  : 'Checked · not available'
                : 'Not verified'}
            </dd>
          </div>
          <div className="frow">
            <dt>Earnings</dt>
            <dd>{rel.money.headline.label}</dd>
          </div>
          <div className="frow">
            <dt>Work again</dt>
            <dd>
              {rel.workAgain[0]
                ? `${rel.workAgain[0].status}${rel.workAgain[0].respondedAt ? ` · ${rel.workAgain[0].respondedAt}` : ''}`
                : 'No request recorded'}
            </dd>
          </div>
        </Group>
        <p className="grey">
          The criteria are read from readiness, post verification, the §22.1 decision,
          enforcement, and the money — never asserted. A completion whose findings are short
          is refused, naming which criterion.
        </p>
        <Note>{SALES_ARE_NOT_A_COMPLETION_REQUIREMENT}</Note>
        <Note>{DELIVERABLE_RESTATES_AGREEMENT}</Note>
      </Section>

      {completion ? (
        <Section eyebrow="Completion" title="The §22.1 decision">
          <Group>
            <div className="frow">
              <dt>Outcome</dt>
              <dd>{completion.outcome?.replace(/_/g, ' ') ?? '—'}</dd>
            </div>
            <div className="frow">
              <dt>Decided</dt>
              <dd>{completion.decidedAt ?? <span className="grey">—</span>}</dd>
            </div>
            <div className="frow frow--wide">
              <dt>Deliverables note</dt>
              <dd>{completion.deliverablesNote ?? <span className="grey">—</span>}</dd>
            </div>
          </Group>
        </Section>
      ) : null}

      <Section
        eyebrow="Work again (§22.9)"
        title={
          rel.workAgain.length === 0
            ? 'No work-again request'
            : `${rel.workAgain.length} recorded request${rel.workAgain.length === 1 ? '' : 's'}`
        }
      >
        {rel.workAgain.length === 0 ? (
          <p className="grey">
            A Founder may ask to work with this Creator again after a successful completion.
            The ask is theirs to make, from their own session.
          </p>
        ) : (
          <div className="cr-versions">
            {rel.workAgain.map((request) => (
              <article className="cr-version" key={request.id}>
                <span className="cr-version__main">
                  <strong>{request.message}</strong>
                  <small>
                    {[request.requestedAt, request.responseNote].filter(Boolean).join(' · ')}
                  </small>
                </span>
                <span className="cr-version__state">
                  <strong>{request.status}</strong>
                  {request.respondedAt ? <small>{request.respondedAt}</small> : null}
                </span>
              </article>
            ))}
          </div>
        )}
        {/* The reference's "Reissue work-again request" — refused (§1.8). */}
        <Note>{workAgainReissue.sentence}</Note>
      </Section>
    </div>
  );
}
