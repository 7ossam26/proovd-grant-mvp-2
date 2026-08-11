/**
 * Edit the Admin-researched channel record — §8, §5.3, §25.6.
 *
 * ── Only Admin-authored values ──────────────────────────────────────────────
 * The reference states it as a notice and it is a real boundary: the fields
 * here are the ones Proovd researched and wrote. What the Affiliate confirmed
 * at signup, and what Stripe reports, are not editable from this form and are
 * not in it.
 *
 * ── A key absent from the request writes nothing ────────────────────────────
 * §9's autosave rule, applied to a form: the PATCH carries only the fields the
 * Admin actually changed, so saving the audience size cannot blank an internal
 * note somebody recorded on another visit. The route implements the same
 * distinction (`'key' in body ? … : undefined`).
 *
 * ── The tier is free text, and stays free text ──────────────────────────────
 * §8 makes the internal quality tier assessment data explicitly — not a
 * commission floor. There is no ranked list to choose from here, because a
 * ranked list is a value somebody can sort by, and the first phase that wanted
 * a default percentage would find one sitting there.
 */

import {
  FOUNDER_NEVER_SEES_THIS,
  QUALITY_TIER_HELPER,
} from '@proovd/shared';
import { ConfirmDialog, type DialogField, type DialogSpec } from '../../founders/dialogs/index.js';
import {
  fetchCreator,
  updateAffiliateProspect,
  type CreatorWorkspaceDetail,
  type ProfileField,
} from '../api.js';

/**
 * Which rendered field maps onto which PATCH key.
 *
 * A register rather than a name convention: the surface's field keys are
 * chosen for reading and the route's are §8's own column names, and a mapping
 * that guessed between them would silently drop whichever one it guessed wrong.
 * A field with no entry here is not editable, which is how `Researched
 * username` and `Channel subtype` stay read-only — §11 lets the Affiliate
 * correct the handle, and the subtype decides which evidence was recorded
 * against it, so flipping it would silently invalidate a verification.
 */
const EDITABLE: Record<string, { patchKey: string; textarea?: boolean; hint?: string }> = {
  niche: { patchKey: 'audienceNiche' },
  tier: { patchKey: 'qualityTier', hint: QUALITY_TIER_HELPER },
  source: { patchKey: 'recruitmentSource' },
  audienceSize: { patchKey: 'audienceSize', hint: 'Followers, subscribers, members, enrolled students — the unit differs by subtype, so it is text.' },
  bio: { patchKey: 'adminBio', textarea: true },
  demographics: { patchKey: 'audienceDemographics', textarea: true },
  permission: { patchKey: 'permissionBasis', textarea: true },
  sponsored: { patchKey: 'priorSponsoredContent', textarea: true },
  fit: { patchKey: 'campaignFit', textarea: true },
  conflicts: { patchKey: 'conflictNotes', textarea: true },
  sanctions: { patchKey: 'sanctionsNotes', textarea: true },
  notes: { patchKey: 'internalComments', textarea: true },
};

export function ResearchDialog({
  prospectId,
  associationId,
  fields,
  trigger,
  onClose,
  onDone,
}: {
  prospectId: string;
  associationId: string;
  fields: ProfileField[];
  trigger: HTMLElement | null;
  onClose: () => void;
  onDone: (detail: CreatorWorkspaceDetail) => void;
}) {
  const editable = fields.filter((field) => EDITABLE[field.key]);

  const dialogFields: DialogField[] = editable.map((field) => {
    const entry = EDITABLE[field.key]!;
    return {
      id: field.key,
      label: field.label,
      ...(entry.textarea ? { textarea: true } : {}),
      ...(field.value !== null ? { value: field.value } : {}),
      ...(entry.hint ? { hint: entry.hint } : {}),
    };
  });

  const spec: DialogSpec = {
    kicker: 'Admin researched / authored',
    title: 'Edit audience research',
    body: (
      <>
        <p>
          Admin-researched and Admin-authored values only. What the Affiliate confirmed and
          what Stripe reports are unchanged by this form.
        </p>
        <p className="helper">{FOUNDER_NEVER_SEES_THIS}</p>
      </>
    ),
    fields: dialogFields,
    primary: 'Save the research record',
    secondary: 'Cancel',
  };

  return (
    <ConfirmDialog
      spec={spec}
      trigger={trigger}
      onClose={onClose}
      onSubmit={async (values) => {
        const patch: Record<string, string | null> = {};
        for (const field of editable) {
          const entry = EDITABLE[field.key]!;
          const next = values[field.key] ?? '';
          const current = field.value ?? '';
          // Only what actually changed. A key absent from the body writes
          // nothing; a key present with an empty string clears the column.
          if (next !== current) patch[entry.patchKey] = next.trim() === '' ? null : next;
        }
        if (Object.keys(patch).length > 0) {
          await updateAffiliateProspect(associationId, patch);
        }
        onDone(await fetchCreator(prospectId));
      }}
    />
  );
}
