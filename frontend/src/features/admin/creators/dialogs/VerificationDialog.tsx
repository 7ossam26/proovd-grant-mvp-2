/**
 * Record the §5.3 verification decision — §8, §5.3.
 *
 * ── Four states, not the reference's three ──────────────────────────────────
 * The prototype had verified / more-evidence-needed / under-review. The product
 * records four, and the fourth (`rejected`) is a decision somebody made that
 * the three-state vocabulary cannot express — collapsing it into "more evidence
 * needed" would tell an Admin to go and collect evidence for a prospect who was
 * turned down.
 *
 * ── The refusal is the server's, and it names what is missing ───────────────
 * `recordVerification` refuses `verified` while anything on the §5.3 list for
 * this subtype is outstanding, and answers with the list. This form does not
 * pre-empt that: the outstanding inputs are shown so the Admin knows before
 * pressing, and the server decides (§1.1 — a disabled button is not
 * authorization).
 */

import { VERIFICATION_IS_HUMAN } from '@proovd/shared';
import { ConfirmDialog, type DialogSpec } from '../../founders/dialogs/index.js';
import {
  fetchCreator,
  recordVerification,
  type CreatorWorkspaceDetail,
  type VerificationBlock,
} from '../api.js';

export function VerificationDialog({
  prospectId,
  associationId,
  verification,
  trigger,
  onClose,
  onDone,
}: {
  prospectId: string;
  associationId: string;
  verification: VerificationBlock;
  trigger: HTMLElement | null;
  onClose: () => void;
  onDone: (detail: CreatorWorkspaceDetail) => void;
}) {
  const spec: DialogSpec = {
    kicker: 'Audience verification',
    title: 'Record verification decision',
    body: (
      <>
        <p>
          The decision is recorded against this campaign relationship with the name of the
          Admin who made it.
        </p>
        {verification.missing.length > 0 ? (
          <p className="helper">
            Still outstanding for this subtype: {verification.missing.join(', ')}. Verified
            is refused while any of them is.
          </p>
        ) : (
          <p className="helper">
            Every §5.3 evidence input for this subtype has been recorded.
          </p>
        )}
        <p className="helper">{VERIFICATION_IS_HUMAN}</p>
      </>
    ),
    fields: [
      {
        id: 'status',
        label: 'Decision',
        required: true,
        select: true,
        options: [
          { value: 'in_review', label: 'Verification under review' },
          { value: 'verified', label: 'Verified' },
          { value: 'rejected', label: 'Verification rejected' },
          { value: 'unverified', label: 'Not verified yet' },
        ],
      },
      {
        id: 'verifiedBy',
        label: 'Recorded by',
        required: true,
        hint: '§1.3: manual work counts only when the app records who did it.',
      },
    ],
    primary: 'Record the decision',
    secondary: 'Cancel',
  };

  return (
    <ConfirmDialog
      spec={spec}
      trigger={trigger}
      onClose={onClose}
      onSubmit={async (values) => {
        await recordVerification(associationId, {
          status: values['status'] ?? 'in_review',
          verifiedBy: values['verifiedBy'] ?? '',
        });
        // The verification route is association-scoped and answers with its own
        // shape, so the workspace is re-read rather than patched — the same
        // rule every mutation on this surface follows.
        onDone(await fetchCreator(prospectId));
      }}
    />
  );
}
