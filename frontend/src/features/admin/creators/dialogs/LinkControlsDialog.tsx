/**
 * Pausing and reactivating one Creator's tracking link — §17, §18, §29.5.
 *
 * ── A paused link is not a paused Creator ───────────────────────────────────
 * The dialog says so, because the two are one gesture apart and only one of
 * them is enforcement. Pausing the link stops new attribution; ending the
 * partnership is a §29 action with five customer-facing statement fields and a
 * five-business-day appeal window, and it lives on the controls surface.
 *
 * ── The link's identity never moves ─────────────────────────────────────────
 * §18 decides every click against `activated_at`, so a pause writes only the
 * three pause columns. Moving activation would silently re-decide clicks that
 * are already in the ledger with the reason each one earned nothing.
 */

import { ConfirmDialog, type DialogSpec } from '../../founders/dialogs/index.js';
import {
  setLinkPaused,
  type CreatorRelationshipDetail,
  type RelationshipLink,
} from '../api.js';

export function LinkControlsDialog({
  prospectId,
  associationId,
  link,
  trigger,
  onClose,
  onDone,
}: {
  prospectId: string;
  associationId: string;
  link: RelationshipLink;
  trigger: HTMLElement | null;
  onClose: () => void;
  onDone: (detail: CreatorRelationshipDetail) => void;
}) {
  const paused = link.state === 'paused';

  const spec: DialogSpec = paused
    ? {
        kicker: 'Affiliate link',
        title: 'Reactivate the Affiliate link',
        body: (
          <>
            <p>
              New clicks become attributable again from the moment this is recorded. Clicks
              that arrived while it was paused stay in the ledger with the reason they earned
              nothing — reactivating does not re-decide them.
            </p>
            {link.pausedReason ? (
              <p className="helper">Paused because: {link.pausedReason}</p>
            ) : null}
          </>
        ),
        fields: [],
        primary: 'Reactivate the link',
        secondary: 'Cancel',
      }
    : {
        kicker: 'Affiliate link',
        title: 'Pause the Affiliate link',
        body: (
          <>
            <p>
              New clicks stop being attributable from the moment this is recorded. The link
              keeps its identity and its activation instant, so nothing already in the ledger
              changes.
            </p>
            <p className="helper">
              This is not enforcement. Ending the partnership is a §29 action with its own
              record, its customer-facing statement, and an appeal window.
            </p>
          </>
        ),
        fields: [
          {
            id: 'reason',
            label: 'Why the link is being paused',
            required: true,
            textarea: true,
            hint: 'Stored with the decision. The Creator may be told it.',
          },
        ],
        primary: 'Pause the link',
        secondary: 'Cancel',
      };

  return (
    <ConfirmDialog
      spec={spec}
      trigger={trigger}
      onClose={onClose}
      onSubmit={async (values) => {
        const detail = await setLinkPaused(prospectId, associationId, {
          action: paused ? 'reactivate' : 'pause',
          reason: values['reason'] ?? null,
        });
        onDone(detail);
      }}
    />
  );
}
