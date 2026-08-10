/**
 * The one edit dialog every changeable field on a Founder record opens.
 *
 * ── Four bodies, and the register decides which ─────────────────────────────
 * §25.6 wants the why behind a change to somebody's data, and §26.2 wants
 * auto-filled surfaces to follow the profile. Those pull in opposite
 * directions for a prospect nobody has claimed yet — demanding a paragraph to
 * fix a typo in Proovd's own prep teaches Admins to type "correction" into
 * every box, which is a worse record than an honest blank. `editDialogBody`
 * and `editReasonRequired` in `@proovd/shared` hold that decision; this file
 * asks them rather than restating the rule, so the dialog and the route that
 * enforces it can never disagree.
 *
 * ── The prior value is never sent ───────────────────────────────────────────
 * Only the new value, the reason, and the evidence leave here. §33.12.4's rule
 * is that the before is read from the stored row inside the transaction that
 * changes it — a caller that supplies both halves can supply a flattering
 * pair — so there is deliberately no field here for what it used to say.
 */

import { editDialogBody, editReasonRequired, founderFieldByKey } from '@proovd/shared';
import type { DialogField, DialogSpec } from './ConfirmDialog.js';
import { NOT_PROVIDED } from '../shared.js';

/** The three ids the workspace reads back out of the submitted values. */
export const FIELD_EDIT_VALUE = 'm-value';
export const FIELD_EDIT_REASON = 'm-reason';
export const FIELD_EDIT_EVIDENCE = 'm-evidence';

export interface FieldEditTarget {
  /** A `FOUNDER_EDITABLE_FIELDS` key. */
  key: string;
  label: string;
  value: string | null;
  helper?: string | null;
}

export interface FieldEditContext {
  kicker: string;
  preferredName: string;
  /** Once somebody owns the account, a correction changes their data. */
  accountClaimed: boolean;
  /** A delivered invitation keeps its wording whatever happens here. */
  invitationSent: boolean;
}

export function fieldEditSpec(
  target: FieldEditTarget,
  context: FieldEditContext,
): DialogSpec {
  const registered = founderFieldByKey(target.key);
  const group = registered?.group ?? 'profile';
  const needReason = editReasonRequired(group, context.accountClaimed);
  const current = target.value && target.value !== NOT_PROVIDED ? target.value : '';

  const fields: DialogField[] = [
    {
      id: FIELD_EDIT_VALUE,
      label: 'New value',
      required: true,
      value: current,
      textarea: registered?.input === 'textarea',
      select: registered?.input === 'select',
      options: registered?.options,
      hint: target.helper ?? registered?.helper,
    },
    {
      id: FIELD_EDIT_REASON,
      label: needReason
        ? 'Why are you changing this information?'
        : 'Why are you changing this? (optional)',
      required: needReason,
      textarea: true,
      placeholder: 'Recorded in the audit log',
    },
  ];

  if (needReason) {
    fields.push({
      id: FIELD_EDIT_EVIDENCE,
      label: 'Evidence (case, document, link)',
      placeholder: 'SUP-…',
    });
  }

  return {
    kicker: context.kicker,
    title: `Edit — ${target.label}`,
    body: (
      <p>
        {editDialogBody(
          group,
          context.accountClaimed,
          context.invitationSent,
          context.preferredName,
        )}
      </p>
    ),
    fields,
    primary: 'Save change',
  };
}
