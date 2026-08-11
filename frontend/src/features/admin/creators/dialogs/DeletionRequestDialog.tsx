/**
 * Record that an Affiliate asked to close their account — §25.8.
 *
 * ── It records an ASK, and the copy has to say so ───────────────────────────
 * §25.8 keeps account, tax, and status records for account life + 7 years, and
 * campaign, payment, support, and audit records outlive the account regardless
 * of what anybody requests. So there is no "approve", no "delete", and no
 * outcome to choose — the form asks what they said and how it reached us, and
 * the note under it says what will and will not happen. §1.4's failure on the
 * one subject where being wrong is unrecoverable would be a button here that
 * implied otherwise.
 */

import { CREATOR_DELETION_RETENTION_NOTE } from '@proovd/shared';
import { ConfirmDialog, type DialogSpec } from '../../founders/dialogs/index.js';
import { recordDeletionRequest, type CreatorWorkspaceDetail } from '../api.js';

const SPEC: DialogSpec = {
  kicker: 'Account support',
  title: 'Record deletion request',
  body: (
    <>
      <p>
        This records what the Affiliate asked for and where the request came from. Proovd
        deletes nothing here.
      </p>
      <p className="helper">{CREATOR_DELETION_RETENTION_NOTE}</p>
    </>
  ),
  fields: [
    {
      id: 'detail',
      label: 'What they asked for',
      required: true,
      textarea: true,
      hint: 'In their words where you have them.',
    },
    {
      id: 'receivedVia',
      label: 'How it reached us',
      required: true,
      hint: 'A support case reference, an email, a call. A request with no provenance is one nobody can verify was made.',
    },
    {
      id: 'requestedAt',
      label: 'When they asked',
      inputType: 'date',
      hint: 'When the Affiliate asked, which is not when you got round to it. Leave blank to record now.',
    },
  ],
  primary: 'Record the request',
  secondary: 'Cancel',
};

export function DeletionRequestDialog({
  prospectId,
  trigger,
  onClose,
  onDone,
}: {
  prospectId: string;
  trigger: HTMLElement | null;
  onClose: () => void;
  onDone: (detail: CreatorWorkspaceDetail) => void;
}) {
  return (
    <ConfirmDialog
      spec={SPEC}
      trigger={trigger}
      onClose={onClose}
      onSubmit={async (values) => {
        const detail = await recordDeletionRequest(prospectId, {
          detail: values['detail'] ?? '',
          receivedVia: values['receivedVia'] ?? '',
          requestedAt: values['requestedAt'] ? values['requestedAt'] : null,
        });
        onDone(detail);
      }}
    />
  );
}
