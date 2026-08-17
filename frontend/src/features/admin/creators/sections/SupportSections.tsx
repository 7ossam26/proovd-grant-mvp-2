/**
 * The Support & Enforcement tab — Support · Relationship Requests ·
 * Enforcement · Appeals. Spec §26.7, §27.8, §29, §24.8, §25.8, §5.5.
 * Session C of the Affiliate rebuild — absorbs the old `/controls` address.
 *
 * ── Gap 7 creates no second queue ────────────────────────────────────────────
 * `CaseIntakeDialog` posts to a route that CALLS `openSupportCase`, so a case
 * born here has the same reference, the same §27.8 business-day promise on the
 * committed calendar, and the same owner every other case has. This surface
 * lists the person's cases and routes to the Support workspace; it resolves
 * nothing.
 *
 * ── The termination request decides no money ─────────────────────────────────
 * The dialog's treatment options are constrained by the chosen §24.8 cause's
 * own register row — the 20a refund-case arrangement, applied to the ask — and
 * `TERMINATION_DECIDES_NO_MONEY` rides the form. Ending the relationship is a
 * §29 action; money is the recorded case path.
 */

import { useState } from 'react';
import {
  AFFILIATE_TREATMENT_LABELS,
  CREATOR_SUSPENSION_IS_NOT_A_BAN,
  REFUND_CAUSES,
  SUPPORT_TOPICS,
  SUPPORT_TOPIC_LABELS,
  TERMINATION_DECIDES_NO_MONEY,
  PASSWORD_RECOVERY_CONSEQUENCE,
  affiliateOperationsAbsence,
  type SupportTopic,
} from '@proovd/shared';
import { Button, Field, StatePanel } from '../../../../components/index.js';
import { useToast } from '../../../../motion/MotionProvider.js';
import {
  decideTerminationRequest,
  openCreatorSupportCase,
  recordTerminationRequest,
  sendPasswordRecovery,
  AdminRequestError,
  type CreatorRelationshipDetail,
  type CreatorRelationshipSummary,
  type CreatorWorkspaceDetail,
} from '../api.js';
import { Group, Note, OwnerPill, Section } from '../shared.js';
import { ConfirmDialog } from '../../founders/dialogs/ConfirmDialog.js';
import { DeletionRequestDialog } from '../dialogs/DeletionRequestDialog.js';
import { AccessDecisionDialog } from '../dialogs/AccessDecisionDialog.js';
import { EnforcementDialog, type EnforcementDialogKind } from '../dialogs/EnforcementDialog.js';

export interface SupportSectionProps {
  sectionKey: string;
  detail: CreatorWorkspaceDetail;
  /** The selected relationship — the Requests and Enforcement campaign zones
      are scoped to it; null when the person has no relationship. */
  selected: CreatorRelationshipSummary | null;
  rel: CreatorRelationshipDetail | null;
  onDone: (next: CreatorWorkspaceDetail) => void;
  onRel: (next: CreatorRelationshipDetail) => void;
  onOpenTab: (tab: string, section?: string) => void;
  navigate: (to: string) => void;
}

export function SupportTabSection(props: SupportSectionProps) {
  switch (props.sectionKey) {
    case 'support':
      return <SupportSection {...props} />;
    case 'requests':
      return <RequestsSection {...props} />;
    case 'enforcement':
      return <EnforcementSection {...props} />;
    case 'appeals':
      return <AppealsSection {...props} />;
    default:
      return null;
  }
}

/* ── The case list every section leads with ─────────────────────────────────*/

function CaseList({
  detail,
  navigate,
  appealsOnly,
}: {
  detail: CreatorWorkspaceDetail;
  navigate: (to: string) => void;
  appealsOnly?: boolean;
}) {
  const open = detail.standing.cases.filter((entry) => entry.open);
  if (open.length === 0) {
    return (
      <section className="cr-task cr-task--waiting">
        <div>
          <h2>
            {appealsOnly
              ? 'No open appeal'
              : detail.header.account === 'Eligible'
                ? 'Account eligible'
                : detail.header.account}
          </h2>
          <p>
            {appealsOnly
              ? 'Prior appeal evidence and decisions remain in History.'
              : detail.header.account === 'Access suspended'
                ? 'Access and active Affiliate links are paused.'
                : 'No open compliance or support case.'}
          </p>
        </div>
      </section>
    );
  }
  return (
    <Section
      eyebrow="Open cases"
      title={`${open.length} open case${open.length === 1 ? '' : 's'}`}
    >
      <div className="cr-versions">
        {open.map((entry) => (
          <article className="cr-version" key={entry.id}>
            <span className="cr-version__main">
              <strong>{entry.subject ?? SUPPORT_TOPIC_LABELS[entry.topic as SupportTopic] ?? entry.topic}</strong>
              <small>
                {entry.reference}
                {entry.openedAt ? ` · opened ${entry.openedAt}` : ''}
              </small>
            </span>
            <Button tier="secondary" small onClick={() => navigate(entry.href)}>
              Open in Support
            </Button>
          </article>
        ))}
      </div>
      <Note>
        Cases are operated from the Support workspace, which owns the §27.8 response clock,
        the owner, and the handoff gate. This record lists and routes.
      </Note>
    </Section>
  );
}

/* ── Support — intake and the safe recovery actions ─────────────────────────*/

function SupportSection({ detail, selected, onDone, navigate }: SupportSectionProps) {
  const toast = useToast();
  const [caseTrigger, setCaseTrigger] = useState<HTMLElement | null>(null);
  const [recoveryTrigger, setRecoveryTrigger] = useState<HTMLElement | null>(null);
  const [deletionTrigger, setDeletionTrigger] = useState<HTMLElement | null>(null);
  const canRecordDeletion = detail.header.availableActions.includes('deletion');

  return (
    <div className="cr-stack">
      <CaseList detail={detail} navigate={navigate} />

      <Section
        eyebrow="Case intake"
        title="Account, payment &amp; campaign support"
        actions={
          <Button tier="secondary" small onClick={(event) => setCaseTrigger(event.currentTarget)}>
            Record a support case
          </Button>
        }
      >
        <p className="grey">
          The case is born in the one §26.7 intake — its reference, its §27.8 business-day
          response promise on the committed calendar, and its owner all come from there.
          There is no second queue.
        </p>
      </Section>

      <Section eyebrow="Account recovery" title="Safe support actions">
        <div className="cr-versions">
          <article className="cr-version">
            <span className="cr-version__main">
              <strong>Send password recovery link</strong>
              <small>Non-enumerating transactional delivery</small>
            </span>
            <Button tier="secondary" small onClick={(event) => setRecoveryTrigger(event.currentTarget)}>
              Send recovery link
            </Button>
          </article>
          <article className="cr-version">
            <span className="cr-version__main">
              <strong>Record deletion request</strong>
              <small>Open obligations and seven-year retention review</small>
            </span>
            {canRecordDeletion ? (
              <Button tier="secondary" small onClick={(event) => setDeletionTrigger(event.currentTarget)}>
                Record the request
              </Button>
            ) : (
              <span className="grey">A request is already under review</span>
            )}
          </article>
        </div>
      </Section>

      {caseTrigger ? (
        <CaseIntakeDialog
          detail={detail}
          associationId={selected?.associationId ?? null}
          trigger={caseTrigger}
          onClose={() => setCaseTrigger(null)}
          onDone={(next) => {
            onDone(next);
            setCaseTrigger(null);
          }}
        />
      ) : null}

      {recoveryTrigger ? (
        <ConfirmDialog
          trigger={recoveryTrigger}
          spec={{
            kicker: `${detail.header.name} · §5.5`,
            title: 'Send password recovery link',
            body:
              'Asks Better Auth for the same reset the person’s own “forgot password” produces ' +
              '— one reset path, refused when nobody has claimed the account.',
            fields: [],
            primary: 'Send the link',
            secondary: 'Cancel',
          }}
          onClose={() => setRecoveryTrigger(null)}
          onSubmit={async () => {
            try {
              onDone(await sendPasswordRecovery(detail.header.prospectId));
              toast('Recovery link sent', { sub: PASSWORD_RECOVERY_CONSEQUENCE });
              setRecoveryTrigger(null);
            } catch (error) {
              throw error instanceof AdminRequestError
                ? new Error(error.detail.whatHappened ?? error.detail.title)
                : error;
            }
          }}
        />
      ) : null}

      {deletionTrigger ? (
        <DeletionRequestDialog
          prospectId={detail.header.prospectId}
          trigger={deletionTrigger}
          onClose={() => setDeletionTrigger(null)}
          onDone={(next) => {
            onDone(next);
            setDeletionTrigger(null);
          }}
        />
      ) : null}
    </div>
  );
}

/* ── Relationship Requests — the termination record, work-again, disclosures ─*/

function RequestsSection({
  detail,
  selected,
  rel,
  onRel,
  onDone: onWorkspace,
  onOpenTab,
}: SupportSectionProps) {
  const toast = useToast();
  const [terminationTrigger, setTerminationTrigger] = useState<HTMLElement | null>(null);
  const [decisionTrigger, setDecisionTrigger] = useState<HTMLElement | null>(null);
  const [disclosure, setDisclosure] = useState<{
    kind: EnforcementDialogKind;
    trigger: HTMLElement | null;
  } | null>(null);

  if (!selected) {
    return (
      <p className="grey">
        No campaign relationship yet, so there is no relationship-scoped request to record.
      </p>
    );
  }
  if (!rel) {
    return (
      <StatePanel
        state="Reading this campaign relationship"
        whatHappened="Proovd is reading the relationship's recorded requests and disclosures."
        next="The section appears as soon as that comes back."
        owner="Proovd"
        nextUpdate="Within a few seconds"
        action="No action needed"
        reference="Admin · Creators"
      />
    );
  }

  const open = rel.terminationRequests.open;

  return (
    <div className="cr-stack">
      <Section
        eyebrow="Affiliate×Campaign"
        title={rel.band.campaignName}
        actions={
          open ? null : (
            <Button tier="secondary" small onClick={(event) => setTerminationTrigger(event.currentTarget)}>
              Record active termination request
            </Button>
          )
        }
      >
        {open ? (
          <>
            <Group>
              <div className="frow frow--wide">
                <dt>Open termination request</dt>
                <dd>{open.reason}</dd>
              </div>
              <div className="frow">
                <dt>Cause</dt>
                <dd>{open.causeLabel}</dd>
              </div>
              <div className="frow">
                <dt>Money treatment</dt>
                <dd>{open.treatmentLabel}</dd>
              </div>
              <div className="frow">
                <dt>Effective</dt>
                <dd>{open.effectiveAt ?? <span className="grey">Not recorded</span>}</dd>
              </div>
              <div className="frow">
                <dt>Received via</dt>
                <dd>
                  {open.receivedVia}
                  {open.requestedAt ? ` · ${open.requestedAt}` : ''}
                </dd>
              </div>
            </Group>
            <Button small onClick={(event) => setDecisionTrigger(event.currentTarget)}>
              Decide the termination request
            </Button>
          </>
        ) : (
          <p className="grey">
            No termination request is open. Recording one preserves the reason, effective
            time, §24.8 cause, and money treatment — and decides nothing.
          </p>
        )}
        <Note>{TERMINATION_DECIDES_NO_MONEY}</Note>
      </Section>

      {rel.terminationRequests.history.length > 0 ? (
        <Section
          eyebrow="Decided requests"
          title={`${rel.terminationRequests.history.length} decided`}
        >
          <div className="cr-versions">
            {rel.terminationRequests.history.map((request) => (
              <article className="cr-version" key={request.id}>
                <span className="cr-version__main">
                  <strong>{request.reason}</strong>
                  <small>
                    {request.causeLabel} · {request.treatmentLabel}
                  </small>
                </span>
                <span className="cr-version__state">
                  <strong>{request.decision}</strong>
                  <small>
                    {request.decisionNote}
                    {request.decidedAt ? ` · ${request.decidedAt}` : ''}
                  </small>
                </span>
              </article>
            ))}
          </div>
        </Section>
      ) : null}

      <Section eyebrow="Other relationship records" title="Recorded asks and disclosures">
        <div className="cr-versions">
          {selected.completion === 'Successfully completed' ? (
            <article className="cr-version">
              <span className="cr-version__main">
                <strong>Review work-again request</strong>
                <small>Founder and Affiliate decide; no campaign is auto-created</small>
              </span>
              <Button tier="secondary" small onClick={() => onOpenTab('campaigns', 'completion')}>
                Open Completion &amp; Work Again
              </Button>
            </article>
          ) : null}
          <article className="cr-version">
            <span className="cr-version__main">
              <strong>Record conflict disclosure</strong>
              <small>§29.1 — what somebody told us. It decides nothing.</small>
            </span>
            <Button
              tier="secondary"
              small
              onClick={(event) => setDisclosure({ kind: 'conflict', trigger: event.currentTarget })}
            >
              Record a conflict
            </Button>
          </article>
          <article className="cr-version">
            <span className="cr-version__main">
              <strong>Record self-pre-order disclosure</strong>
              <small>§29.2 — both certifications required; attribution moves to blocked</small>
            </span>
            <Button
              tier="secondary"
              small
              onClick={(event) =>
                setDisclosure({ kind: 'self_preorder', trigger: event.currentTarget })
              }
            >
              Record a self-pre-order
            </Button>
          </article>
        </div>
      </Section>

      {terminationTrigger ? (
        <TerminationDialog
          detail={detail}
          rel={rel}
          trigger={terminationTrigger}
          onClose={() => setTerminationTrigger(null)}
          onDone={(next) => {
            onRel(next);
            toast('Termination request recorded');
            setTerminationTrigger(null);
          }}
        />
      ) : null}

      {decisionTrigger && open ? (
        <ConfirmDialog
          trigger={decisionTrigger}
          spec={{
            kicker: `${rel.band.campaignName} · §29, §24.8`,
            title: 'Decide the termination request',
            body:
              'Applied or declined — the decision is write-once, and the recorded ask is ' +
              'immutable underneath it. Ending the relationship is a §29 enforcement action; ' +
              'any money movement is the recorded §24.8 case path.',
            fields: [
              {
                id: 'decision',
                label: 'Decision',
                required: true,
                select: true,
                options: [
                  { value: 'applied', label: 'Apply — the acts it asks for will follow' },
                  { value: 'declined', label: 'Decline' },
                ],
              },
              { id: 'note', label: 'Decision note', required: true, textarea: true },
            ],
            primary: 'Record the decision',
            secondary: 'Cancel',
          }}
          onClose={() => setDecisionTrigger(null)}
          onSubmit={async (values) => {
            try {
              const next = await decideTerminationRequest(
                detail.header.prospectId,
                rel.associationId,
                open.id,
                {
                  decision: values['decision'] === 'applied' ? 'applied' : 'declined',
                  note: values['note'] ?? '',
                },
              );
              onRel(next);
              toast('Decision recorded');
              setDecisionTrigger(null);
            } catch (error) {
              throw error instanceof AdminRequestError
                ? new Error(error.detail.whatHappened ?? error.detail.title)
                : error;
            }
          }}
        />
      ) : null}

      {disclosure ? (
        <EnforcementDialog
          kind={disclosure.kind}
          prospectId={detail.header.prospectId}
          associationId={selected.associationId}
          campaignName={selected.campaignName}
          trigger={disclosure.trigger}
          onClose={() => setDisclosure(null)}
          onDone={(next) => {
            // The disclosure dialogs end in a workspace re-read.
            onWorkspace(next);
            setDisclosure(null);
          }}
        />
      ) : null}
    </div>
  );
}

/* ── The termination intake — cause-constrained treatments (0048) ───────────*/

function TerminationDialog({
  detail,
  rel,
  trigger,
  onClose,
  onDone,
}: {
  detail: CreatorWorkspaceDetail;
  rel: CreatorRelationshipDetail;
  trigger: HTMLElement | null;
  onClose: () => void;
  onDone: (next: CreatorRelationshipDetail) => void;
}) {
  /*
   * The cause constrains the treatments — §24.8's own matrix, which the server
   * validates and 0048 CHECKs regardless. ConfirmDialog's fields are a static
   * spec, so the cause is chosen FIRST and the dialog is keyed on it: choosing
   * a different cause re-seeds the treatment options with only what that
   * cause's register row permits. A client courtesy; the refusal an Admin
   * would otherwise meet is the server's, by name.
   */
  const [cause, setCause] = useState(REFUND_CAUSES[0]!.key);
  const causeRow = REFUND_CAUSES.find((row) => row.key === cause)!;

  return (
    <ConfirmDialog
      key={cause}
      trigger={trigger}
      spec={{
        kicker: `${rel.band.campaignName} · §29, §24.8`,
        title: 'Record active termination request',
        body: (
          <>
            <Field label="§24.8 cause">
              <select
                className="input"
                value={cause}
                onChange={(event) => setCause(event.target.value as typeof cause)}
              >
                {REFUND_CAUSES.map((row) => (
                  <option key={row.key} value={row.key}>
                    {row.label}
                  </option>
                ))}
              </select>
            </Field>
            <p className="helper">{causeRow.allocation}</p>
          </>
        ),
        fields: [
          {
            id: 'moneyTreatment',
            label: 'Money treatment',
            required: true,
            select: true,
            options: causeRow.permittedAffiliateTreatments.map((key) => ({
              value: key,
              label: AFFILIATE_TREATMENT_LABELS[key],
            })),
            hint: 'Only what the chosen cause permits — §24.8’s matrix, and 0048’s CHECK.',
          },
          {
            id: 'reason',
            label: 'Why the partnership should end',
            required: true,
            textarea: true,
            hint: 'In the asking party’s words.',
          },
          {
            id: 'effectiveAt',
            label: 'Asked to take effect',
            required: true,
            inputType: 'date',
          },
          {
            id: 'receivedVia',
            label: 'How the ask reached us',
            required: true,
            hint: 'Email, a call, a support case reference — provenance the record can be verified by.',
          },
        ],
        primary: 'Record the request',
        secondary: 'Cancel',
      }}
      onClose={onClose}
      onSubmit={async (values) => {
        try {
          onDone(
            await recordTerminationRequest(detail.header.prospectId, rel.associationId, {
              reason: values['reason'] ?? '',
              effectiveAt: values['effectiveAt'] ?? '',
              cause,
              moneyTreatment: values['moneyTreatment'] ?? '',
              receivedVia: values['receivedVia'] ?? '',
            }),
          );
        } catch (error) {
          throw error instanceof AdminRequestError
            ? new Error(error.detail.whatHappened ?? error.detail.title)
            : error;
        }
      }}
    />
  );
}

/* ── Enforcement — account access, §29 per relationship, the refusals ───────*/

function EnforcementSection({ detail, selected, onDone, onOpenTab }: SupportSectionProps) {
  const [accessTrigger, setAccessTrigger] = useState<HTMLElement | null>(null);
  const [enforcement, setEnforcement] = useState<{
    kind: EnforcementDialogKind;
    associationId: string;
    campaignName: string;
    appealId?: string;
    trigger: HTMLElement | null;
  } | null>(null);
  const suspended = detail.header.account === 'Access suspended';
  const canSuspend = detail.header.availableActions.includes('suspend');
  const canRestore = detail.header.availableActions.includes('restore');
  const tierAccessCombo = affiliateOperationsAbsence('tierAccessCombo');
  const campaignSuspendKill = affiliateOperationsAbsence('campaignSuspendKill');
  const { standing } = detail;

  return (
    <div className="cr-stack">
      <section className={suspended ? 'cr-banner cr-banner--warn' : 'cr-banner'}>
        <div>
          <h2>{suspended ? 'Account access suspended' : 'Account eligible'}</h2>
          <p>
            {suspended
              ? 'This Affiliate cannot reach their Creator surfaces while the review is open. Their campaign relationships, accepted terms, and anything already earned are unchanged.'
              : standing.policyReacceptanceOpen
                ? 'A policy update is outstanding, so their Creator surfaces are blocked until they accept it.'
                : 'No account-level review is open.'}
          </p>
        </div>
        {canSuspend || canRestore ? (
          <Button
            tier={suspended ? undefined : 'secondary'}
            onClick={(event) => setAccessTrigger(event.currentTarget)}
          >
            {suspended ? 'Restore Affiliate account' : 'Suspend Affiliate account'}
          </Button>
        ) : null}
      </section>

      {standing.account.latest ? (
        <Section
          eyebrow="Latest access decision"
          title={standing.account.latest.action === 'suspend' ? 'Suspended' : 'Restored'}
        >
          <Group>
            <div className="frow">
              <dt>Reason</dt>
              <dd>{standing.account.latest.reason}</dd>
            </div>
            {standing.account.latest.reviewOwner ? (
              <div className="frow">
                <dt>Review owner</dt>
                <dd>{standing.account.latest.reviewOwner}</dd>
              </div>
            ) : null}
            {standing.account.latest.nextReviewAt ? (
              <div className="frow">
                <dt>Next update due</dt>
                <dd>
                  {standing.account.latest.nextReviewAt}
                  <p className="helper">
                    A commitment shown to the person, not a job. Nothing sends a reminder.
                  </p>
                </dd>
              </div>
            ) : null}
            <div className="frow">
              <dt>Recorded by</dt>
              <dd>
                {standing.account.latest.actor} · {standing.account.latest.at}
              </dd>
            </div>
          </Group>
        </Section>
      ) : null}

      <Note>{CREATOR_SUSPENSION_IS_NOT_A_BAN}</Note>

      <Section
        eyebrow="Campaign relationships"
        title={
          standing.enforcement.length === 0
            ? 'No enforcement action recorded'
            : `${standing.enforcement.length} enforcement action${standing.enforcement.length === 1 ? '' : 's'}`
        }
      >
        {detail.relationships.length === 0 ? (
          <p className="grey">
            §29’s actions are per relationship, never per account — and there is no campaign
            relationship yet.
          </p>
        ) : (
          <div className="cr-versions">
            {detail.relationships.map((relationship) => (
              <article className="cr-version" key={relationship.associationId}>
                <span className="cr-version__main">
                  <strong>{relationship.campaignName}</strong>
                  <small>{relationship.status}</small>
                </span>
                <span className="cr-drow__acts">
                  <Button
                    tier="secondary"
                    small
                    onClick={(event) =>
                      setEnforcement({
                        kind: 'action',
                        associationId: relationship.associationId,
                        campaignName: relationship.campaignName,
                        trigger: event.currentTarget,
                      })
                    }
                  >
                    Record enforcement action
                  </Button>
                </span>
              </article>
            ))}
          </div>
        )}
        {standing.enforcement.length === 0 ? (
          <p className="grey">
            Nothing has been recorded against any of this Affiliate’s campaign relationships.
            A warning, a pause, a demotion, a bidding restriction, and a termination are all
            §29 actions with the five customer-facing statement fields.
          </p>
        ) : (
          standing.enforcement.map((action) => (
            <Group key={action.id}>
              <div className="frow frow--wide">
                <dt>
                  {action.actionKind.replace(/_/g, ' ')} · {action.campaignName}
                </dt>
                <dd>{action.at}</dd>
              </div>
              <div className="frow frow--wide">
                <dt>What happened</dt>
                <dd>{action.statement.evidenceAndBehavior}</dd>
              </div>
              <div className="frow">
                <dt>Rule</dt>
                <dd>{action.statement.ruleViolated}</dd>
              </div>
              <div className="frow">
                <dt>Immediate effect</dt>
                <dd>{action.statement.immediateEffect}</dd>
              </div>
              <div className="frow">
                <dt>How to correct it</dt>
                <dd>{action.statement.correctionPath}</dd>
              </div>
              <div className="frow">
                <dt>Human route</dt>
                <dd>{action.statement.humanRoute}</dd>
              </div>
              <div className="frow">
                <dt>Appeal due</dt>
                <dd>
                  {action.appealDueAt ?? <span className="grey">Not applicable</span>}
                  <p className="helper">
                    Five business days on the committed holiday calendar, stored with the
                    version that produced it.
                  </p>
                </dd>
              </div>
            </Group>
          ))
        )}
      </Section>

      {/* The reference's combined tier/proposal-access setter, and its
          campaign suspend/kill — both refused, each naming the real path. */}
      <Section eyebrow="Refused controls" title="What this section deliberately does not offer">
        <Note>{tierAccessCombo.sentence}</Note>
        <Note>{campaignSuspendKill.sentence}</Note>
      </Section>

      <Section eyebrow="Policy reacceptance" title="§29.8">
        <p className="grey">
          Requiring current policy reacceptance is audience-wide and lives on Account &amp;
          Payout Setup → Agreements, beside the published versions it may cite.
        </p>
        <Button tier="secondary" small onClick={() => onOpenTab('account', 'agreements')}>
          Open Agreements
        </Button>
      </Section>

      {accessTrigger ? (
        <AccessDecisionDialog
          prospectId={detail.header.prospectId}
          suspended={suspended}
          trigger={accessTrigger}
          onClose={() => setAccessTrigger(null)}
          onDone={(next) => {
            onDone(next);
            setAccessTrigger(null);
          }}
        />
      ) : null}

      {enforcement ? (
        <EnforcementDialog
          kind={enforcement.kind}
          prospectId={detail.header.prospectId}
          associationId={enforcement.associationId}
          campaignName={enforcement.campaignName}
          {...(enforcement.appealId ? { appealId: enforcement.appealId } : {})}
          trigger={enforcement.trigger}
          onClose={() => setEnforcement(null)}
          onDone={(next) => {
            onDone(next);
            setEnforcement(null);
          }}
        />
      ) : null}
    </div>
  );
}

/* ── Appeals — the §29.4 route and the recorded decisions ───────────────────*/

function AppealsSection({ detail, onDone, navigate }: SupportSectionProps) {
  const [appeal, setAppeal] = useState<{
    associationId: string;
    campaignName: string;
    appealId: string;
    trigger: HTMLElement | null;
  } | null>(null);
  const withAppeals = detail.standing.enforcement.filter((action) => action.appeal);
  const undecided = withAppeals.filter((action) => action.appeal && !action.appeal.decision);

  return (
    <div className="cr-stack">
      <CaseList detail={detail} navigate={navigate} appealsOnly />

      <Section eyebrow="Appeal route" title="Evidence, notice &amp; decision">
        <p>
          The Affiliate receives the rule, the evidence basis, the consequence, the
          correction path, the deadline, and a durable appeal route. The original
          enforcement record is never overwritten.
        </p>
        {withAppeals.length === 0 ? (
          <p className="grey">No appeal has been submitted against a recorded action.</p>
        ) : (
          <div className="cr-versions">
            {withAppeals.map((action) => (
              <article className="cr-version" key={action.id}>
                <span className="cr-version__main">
                  <strong>{action.appeal!.grounds}</strong>
                  <small>
                    {action.actionKind.replace(/_/g, ' ')} · {action.campaignName}
                  </small>
                </span>
                <span className="cr-version__state">
                  <strong>
                    {action.appeal!.decision
                      ? `Decided ${action.appeal!.decision}`
                      : 'No decision recorded yet'}
                  </strong>
                  {action.appeal!.decidedAt ? <small>{action.appeal!.decidedAt}</small> : null}
                </span>
                {!action.appeal!.decision ? (
                  <Button
                    tier="secondary"
                    small
                    onClick={(event) =>
                      setAppeal({
                        associationId: action.associationId,
                        campaignName: action.campaignName,
                        appealId: action.appeal!.id,
                        trigger: event.currentTarget,
                      })
                    }
                  >
                    Decide the appeal
                  </Button>
                ) : null}
              </article>
            ))}
          </div>
        )}
        {undecided.length > 0 ? (
          <Note>
            {undecided.length} appeal{undecided.length === 1 ? ' is' : 's are'} waiting on a
            decision. The decision is final and write-once; an overturned pause restores the
            partnership, and a terminal removal never revives.
          </Note>
        ) : null}
      </Section>

      {appeal ? (
        <EnforcementDialog
          kind="appeal"
          prospectId={detail.header.prospectId}
          associationId={appeal.associationId}
          campaignName={appeal.campaignName}
          appealId={appeal.appealId}
          trigger={appeal.trigger}
          onClose={() => setAppeal(null)}
          onDone={(next) => {
            onDone(next);
            setAppeal(null);
          }}
        />
      ) : null}
    </div>
  );
}

/* ── Gap 7 — the case intake dialog, shared with Risk & Compliance ──────────*/

export function CaseIntakeDialog({
  detail,
  associationId,
  trigger,
  onClose,
  onDone,
}: {
  detail: CreatorWorkspaceDetail;
  associationId: string | null;
  trigger: HTMLElement | null;
  onClose: () => void;
  onDone: (next: CreatorWorkspaceDetail) => void;
}) {
  const toast = useToast();
  return (
    <ConfirmDialog
      trigger={trigger}
      spec={{
        kicker: `${detail.header.name} · §26.7, §27.8`,
        title: 'Record a support case',
        body:
          'Opened through the one intake, so the case is born with its reference, its ' +
          'business-day response promise on the committed calendar, and its owner. A ' +
          'conflict, a self-pre-order, a termination ask, or an appeal is its own record on ' +
          'the Relationship Requests and Enforcement sections — not a case type.',
        fields: [
          {
            id: 'topic',
            label: 'Case topic',
            required: true,
            select: true,
            options: SUPPORT_TOPICS.map((topic) => ({
              value: topic,
              label: SUPPORT_TOPIC_LABELS[topic],
            })),
            hint: '§26.7’s ten topics — one list, or the queue counts two different things.',
          },
          {
            id: 'subject',
            label: 'Subject',
            hint: 'The one sentence a person recognises the case by.',
          },
          {
            id: 'subcategory',
            label: 'Finer detail',
            hint: 'Free text under the fixed topic — the Support workspace’s own arrangement.',
          },
          {
            id: 'message',
            label: 'What the Affiliate asked',
            required: true,
            textarea: true,
            hint: 'In their words. Stored as the first inbound message on the case.',
          },
        ],
        primary: 'Record the case',
        secondary: 'Cancel',
      }}
      onClose={onClose}
      onSubmit={async (values) => {
        try {
          const { detail: next, opened } = await openCreatorSupportCase(
            detail.header.prospectId,
            {
              topic: values['topic'] ?? '',
              message: values['message'] ?? '',
              subject: values['subject'] || null,
              subcategory: values['subcategory'] || null,
              associationId,
            },
          );
          onDone(next);
          toast(`Case ${opened.reference} opened`, {
            sub: 'The §27.8 response clock started when it was recorded.',
          });
        } catch (error) {
          throw error instanceof AdminRequestError
            ? new Error(error.detail.whatHappened ?? error.detail.title)
            : error;
        }
      }}
    />
  );
}
