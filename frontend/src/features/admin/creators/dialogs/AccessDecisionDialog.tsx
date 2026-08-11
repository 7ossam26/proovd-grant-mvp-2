/**
 * Suspending or restoring a person's Affiliate access — §26.7, §25.6.
 *
 * ── This is a review, and the copy says so ──────────────────────────────────
 * A recorded deviation, and a narrow one: there is no ban, no permanent value,
 * and no third control. The dialog states what a suspension does — stops them
 * reaching their Creator surfaces on the next call — and what it does not:
 * their relationships, their accepted terms, and anything already earned are
 * untouched.
 *
 * ── §27.1's two promises are required on a suspension ───────────────────────
 * Who owns the review, and when the person hears next. The owner is refused as
 * a blank by the service; the date is optional because a review with no fixed
 * next update is honest, and inventing one would be a promise nothing honours.
 * On a restore both are refused by CHECK — a closed review that still names a
 * next date is the same failure in reverse.
 */

import { CREATOR_SUSPENSION_IS_NOT_A_BAN } from '@proovd/shared';
import { ConfirmDialog, type DialogSpec } from '../../founders/dialogs/index.js';
import { recordAccessDecision, type CreatorWorkspaceDetail } from '../api.js';

export function AccessDecisionDialog({
  prospectId,
  suspended,
  trigger,
  onClose,
  onDone,
}: {
  prospectId: string;
  suspended: boolean;
  trigger: HTMLElement | null;
  onClose: () => void;
  onDone: (detail: CreatorWorkspaceDetail) => void;
}) {
  const spec: DialogSpec = suspended
    ? {
        kicker: 'Account access',
        title: 'Restore Affiliate account',
        body: (
          <>
            <p>
              Access is restored on their next request. The review ends here, so this
              decision carries no owner and no next date.
            </p>
            <p className="helper">{CREATOR_SUSPENSION_IS_NOT_A_BAN}</p>
          </>
        ),
        fields: [
          {
            id: 'reason',
            label: 'Why access is being restored',
            required: true,
            textarea: true,
            hint: 'Stored with the decision. §26.7 asks for the reason on both directions.',
          },
          { id: 'evidence', label: 'Evidence reference', hint: 'A case reference or a link.' },
        ],
        primary: 'Restore access',
        secondary: 'Cancel',
      }
    : {
        kicker: 'Account access',
        title: 'Suspend Affiliate account',
        body: (
          <>
            <p>
              They stop reaching their Creator surfaces on their next request. Their campaign
              relationships, their accepted terms, and anything already earned are unchanged
              — this pauses access, not the record.
            </p>
            <p className="helper">{CREATOR_SUSPENSION_IS_NOT_A_BAN}</p>
          </>
        ),
        fields: [
          {
            id: 'reason',
            label: 'Why access is being suspended',
            required: true,
            textarea: true,
            hint: 'Stored with the decision, and the Affiliate may be told it. Never a provider or fraud code (§29.4).',
          },
          {
            id: 'reviewOwner',
            label: 'Who owns the review',
            required: true,
            hint: '§27.1 asks a suspended person who owns this. A named person, not a team alias.',
          },
          {
            id: 'nextReviewAt',
            label: 'When they hear next',
            inputType: 'date',
            hint: 'Optional. A commitment shown on the surface — nothing sweeps it, and no reminder is sent. Leave blank rather than invent one.',
          },
          { id: 'evidence', label: 'Evidence reference', hint: 'A case reference or a link.' },
        ],
        primary: 'Suspend access',
        secondary: 'Cancel',
      };

  return (
    <ConfirmDialog
      spec={spec}
      trigger={trigger}
      onClose={onClose}
      onSubmit={async (values) => {
        const detail = await recordAccessDecision(prospectId, {
          action: suspended ? 'restore' : 'suspend',
          reason: values['reason'] ?? '',
          evidence: values['evidence'] ?? null,
          // A restore carries neither — the service and the CHECK both refuse
          // an owner or a date on one.
          reviewOwner: suspended ? null : (values['reviewOwner'] ?? null),
          nextReviewAt: suspended ? null : (values['nextReviewAt'] || null),
        });
        onDone(detail);
      }}
    />
  );
}
