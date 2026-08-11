/**
 * The §29.4 enforcement action, the appeal decision, and §29.1/§29.2's two
 * disclosures — one file, because they are four forms against one relationship.
 *
 * ── The five statement fields are the record, not a formality ───────────────
 * §29 requires a customer-facing enforcement statement to say the evidence and
 * behaviour, the rule, the immediate effect, how to correct it, and the human
 * route. All five are required by the route's schema, by the service, and by a
 * CHECK — a record with no row shape for them cannot exist. The form asks for
 * them separately for the same reason §28.4 forbids bundling a consent: five
 * things in one textarea is one thing.
 *
 * ── The internal reason is a SIXTH field, kept apart ────────────────────────
 * §25.6 keeps internal wording out of customer copy, and §29.4/§33.9.11 refuse
 * a raw provider or fraud code in the customer-facing half. The internal box is
 * where a decline code belongs; the five above are where it must not go, and
 * `containsRawProviderCode` refuses it server-side at the point an Admin can
 * still fix it.
 *
 * ── An appeal decision is final, and the copy says so ───────────────────────
 * §29.4: the decision is write-once. An overturned pause restores the
 * partnership; a terminal removal never revives (§23.4). The dialog states both
 * before the decision is made rather than after.
 */

import { useState } from 'react';
import {
  AFFILIATE_ENFORCEMENT_ACTIONS,
  AFFILIATE_ENFORCEMENT_ACTION_LABELS,
  AFFILIATE_ENFORCEMENT_REASONS,
  AFFILIATE_ENFORCEMENT_REASON_LABELS,
  CONFLICT_RELATIONSHIP_KINDS,
  TERMINATION_VALIDITY,
} from '@proovd/shared';
import { ConfirmDialog, type DialogSpec } from '../../founders/dialogs/index.js';
import {
  decideAppeal,
  fetchCreator,
  recordConflictDisclosure,
  recordEnforcement,
  recordSelfPreorderDisclosure,
  type CreatorWorkspaceDetail,
} from '../api.js';

export type EnforcementDialogKind = 'action' | 'appeal' | 'conflict' | 'self_preorder';

export function EnforcementDialog({
  kind,
  prospectId,
  associationId,
  campaignName,
  appealId,
  trigger,
  onClose,
  onDone,
}: {
  kind: EnforcementDialogKind;
  prospectId: string;
  associationId: string;
  campaignName: string;
  appealId?: string;
  trigger: HTMLElement | null;
  onClose: () => void;
  onDone: (detail: CreatorWorkspaceDetail) => void;
}) {
  /*
   * Termination validity is only asked when the action is a termination.
   * Asking it on a warning would be collecting an answer §29 has no place for,
   * and the schema treats it as nullish for exactly that reason.
   */
  const [actionKind, setActionKind] = useState<string>('warn');

  const spec = SPECS[kind]({ campaignName, actionKind });

  return (
    <ConfirmDialog
      spec={spec}
      trigger={trigger}
      onClose={onClose}
      onSubmit={async (values) => {
        if (kind === 'action') {
          // Kept in sync so the next render offers the validity field when the
          // Admin has chosen a termination.
          setActionKind(values['actionKind'] ?? 'warn');
          await recordEnforcement(associationId, {
            actionKind: values['actionKind'] ?? 'warn',
            reasonCategory: values['reasonCategory'] ?? 'aup_breach',
            internalReason: values['internalReason'] ?? '',
            evidenceAndBehavior: values['evidenceAndBehavior'] ?? '',
            ruleViolated: values['ruleViolated'] ?? '',
            immediateEffect: values['immediateEffect'] ?? '',
            correctionPath: values['correctionPath'] ?? '',
            humanRoute: values['humanRoute'] ?? '',
            terminationValidity:
              values['actionKind'] === 'terminate' ? (values['terminationValidity'] ?? null) : null,
          });
        } else if (kind === 'appeal') {
          await decideAppeal(appealId!, {
            decision: values['decision'] === 'overturned' ? 'overturned' : 'upheld',
            ...(values['note'] ? { note: values['note'] } : {}),
          });
        } else if (kind === 'conflict') {
          await recordConflictDisclosure(associationId, {
            relationshipKind: values['relationshipKind'] ?? 'other_affiliate',
            detail: values['detail'] ?? '',
            disclosedBy: values['disclosedBy'] ?? 'admin',
          });
        } else {
          await recordSelfPreorderDisclosure(associationId, {
            reservationId: values['reservationId'] || null,
            intentNote: values['intentNote'] ?? '',
            // §29.2 requires BOTH certifications, and both are CHECK-pinned
            // true. The controls are separate because §28.4 forbids bundling.
            selfFundedCertified: values['selfFundedCertified'] === 'Yes',
            identityDisclosed: values['identityDisclosed'] === 'Yes',
          });
        }
        onDone(await fetchCreator(prospectId));
      }}
    />
  );
}

/* ── The four forms ─────────────────────────────────────────────────────────*/

const SPECS: Record<
  EnforcementDialogKind,
  (context: { campaignName: string; actionKind: string }) => DialogSpec
> = {
  action: ({ campaignName, actionKind }) => ({
    kicker: `${campaignName} · §29 enforcement`,
    title: 'Record an enforcement action',
    body: (
      <>
        <p>
          Recorded against this campaign relationship, not against the account. The five
          statement fields below are what the Creator is told; the internal reason is not.
        </p>
        <p className="helper">
          An appeal window of five business days opens on the committed holiday calendar,
          stored with the version that produced it.
        </p>
      </>
    ),
    fields: [
      {
        id: 'actionKind',
        label: 'Action',
        required: true,
        select: true,
        options: AFFILIATE_ENFORCEMENT_ACTIONS.map((action) => ({
          value: action,
          label: AFFILIATE_ENFORCEMENT_ACTION_LABELS[action],
        })),
      },
      {
        id: 'reasonCategory',
        label: 'Reason category',
        required: true,
        select: true,
        options: AFFILIATE_ENFORCEMENT_REASONS.map((reason) => ({
          value: reason,
          label: AFFILIATE_ENFORCEMENT_REASON_LABELS[reason],
        })),
      },
      ...(actionKind === 'terminate'
        ? [
            {
              id: 'terminationValidity',
              label: 'Termination validity',
              required: true,
              select: true,
              options: TERMINATION_VALIDITY.map((validity) => ({
                value: validity,
                label: validity.replace(/_/g, ' '),
              })),
            },
          ]
        : []),
      {
        id: 'internalReason',
        label: 'Internal reason',
        required: true,
        textarea: true,
        hint: 'Not shown to the Creator. A provider or fraud code belongs here and nowhere below.',
      },
      {
        id: 'evidenceAndBehavior',
        label: 'What happened — evidence and behaviour',
        required: true,
        textarea: true,
        hint: 'Customer-facing. The actual behaviour and what it was observed in.',
      },
      {
        id: 'ruleViolated',
        label: 'Which rule',
        required: true,
        textarea: true,
        hint: 'Customer-facing.',
      },
      {
        id: 'immediateEffect',
        label: 'Immediate effect',
        required: true,
        textarea: true,
        hint: 'Customer-facing. What changes for them right now.',
      },
      {
        id: 'correctionPath',
        label: 'How to correct it',
        required: true,
        textarea: true,
        hint: 'Customer-facing. §29 requires a correction path even where the action is terminal.',
      },
      {
        id: 'humanRoute',
        label: 'Human route',
        required: true,
        textarea: true,
        hint: 'Customer-facing. How they reach a person, not a form.',
      },
    ],
    primary: 'Record the action',
    secondary: 'Cancel',
  }),

  appeal: ({ campaignName }) => ({
    kicker: `${campaignName} · §29.4 appeal`,
    title: 'Decide the appeal',
    body: (
      <>
        <p>
          The decision is final and write-once. Overturning a pause restores the partnership;
          a terminal removal never revives, whatever the decision says.
        </p>
        <p className="helper">
          The note is recorded with the decision and may be shown to the Creator.
        </p>
      </>
    ),
    fields: [
      {
        id: 'decision',
        label: 'Decision',
        required: true,
        select: true,
        options: [
          { value: 'upheld', label: 'Uphold the enforcement decision' },
          { value: 'overturned', label: 'Overturn the enforcement decision' },
        ],
      },
      { id: 'note', label: 'Decision note', textarea: true },
    ],
    primary: 'Record the decision',
    secondary: 'Cancel',
  }),

  conflict: ({ campaignName }) => ({
    kicker: `${campaignName} · §29.1`,
    title: 'Record a conflict disclosure',
    body: (
      <>
        <p>
          This records what somebody told us. It decides nothing on its own — an enforcement
          action is a separate act with its own statement and appeal window.
        </p>
      </>
    ),
    fields: [
      {
        id: 'relationshipKind',
        label: 'Relationship',
        required: true,
        select: true,
        options: CONFLICT_RELATIONSHIP_KINDS.map((relationship) => ({
          value: relationship,
          label: relationship.replace(/_/g, ' '),
        })),
      },
      { id: 'detail', label: 'What was disclosed', required: true, textarea: true },
      {
        id: 'disclosedBy',
        label: 'Who disclosed it',
        hint: 'The Creator, the Founder, or Proovd. Recorded because it changes what the record means.',
      },
    ],
    primary: 'Record the disclosure',
    secondary: 'Cancel',
  }),

  self_preorder: ({ campaignName }) => ({
    kicker: `${campaignName} · §29.2`,
    title: 'Record a self-pre-order disclosure',
    body: (
      <>
        <p>
          A Creator may pre-order on their own campaign when both certifications hold. The
          reservation&rsquo;s attribution moves to blocked, so it earns no commission — that
          follows from the record rather than from a decision anyone makes here.
        </p>
        <p className="helper">
          Both certifications are required and are stored as true. §28.4 forbids bundling
          them, so they are two answers.
        </p>
      </>
    ),
    fields: [
      {
        id: 'reservationId',
        label: 'Reservation',
        hint: 'The pre-order this concerns, when there is one on record.',
      },
      { id: 'intentNote', label: 'What they said', required: true, textarea: true },
      {
        id: 'selfFundedCertified',
        label: 'Certified self-funded',
        required: true,
        select: true,
        options: ['Yes', 'No'],
      },
      {
        id: 'identityDisclosed',
        label: 'Identity disclosed',
        required: true,
        select: true,
        options: ['Yes', 'No'],
      },
    ],
    primary: 'Record the disclosure',
    secondary: 'Cancel',
  }),
};
