/**
 * What each Founder decision says before it is taken.
 *
 * One registry rather than nine forms, for the reason §7's invitation copy is
 * a constant and not a column: a sentence written at the call site is a
 * sentence somebody softens under pressure. These are read once here and
 * rendered by the one dialog, so "what the Admin was told before they pressed
 * it" is a fact about this file rather than about nine components.
 *
 * ── What is deliberately not decided here ───────────────────────────────────
 * Nothing in this file knows whether a decision is *permitted*. `availableActions`
 * on the payload decides which of these an Admin is offered, and the server
 * decides again when the request arrives (§1.1). A registry that also gated
 * would be a second answer to the same question.
 *
 * ── The one deviation from the reference, and why ───────────────────────────
 * The deletion review carries a required note. The reference records a fixed
 * sentence on the Admin's behalf; `founder_deletion_reviews.note` is NOT NULL
 * and the table is append-only, so a fabricated default would put words into a
 * record somebody may later be asked to stand behind (§25.6). Every other
 * title, body, field, and button label is the reference's, including the
 * typographic apostrophes.
 */

import {
  DELETION_NO_BULK_ACTION_NOTE,
  DELETION_RETENTION_NOTE,
  GHOST_BAN_TRIGGER_SUMMARY,
  GHOST_BAN_TRIGGERS,
  GHOST_BAN_TRIGGER_LABELS,
} from '@proovd/shared';
import type { DialogSpec } from './ConfirmDialog.js';

export type ConfirmKey =
  | 'sendinvite'
  | 'newinvite'
  | 'cancelinvite'
  | 'suspend'
  | 'restore'
  | 'ban'
  | 'deletion'
  | 'campapprove'
  | 'campunapprove';

export interface ConfirmContext {
  legalName: string;
  preferredName: string;
  email: string;
  productName: string;
  /** The Founder's own words, where the record has them. */
  deletionDetail: string | null;
}

const AUDIT_PLACEHOLDER = 'One honest sentence — recorded in the audit log';

export function confirmSpec(key: ConfirmKey, ctx: ConfirmContext): DialogSpec {
  const kicker = `${ctx.legalName} · ${ctx.productName}`;
  const who = ctx.preferredName;

  switch (key) {
    case 'sendinvite':
      return {
        kicker,
        title: 'Send invite',
        body: (
          <p>
            The invitation will be sent to {ctx.email}. The exact delivered version is
            preserved even if {who}’s profile changes later.
          </p>
        ),
        fields: [],
        primary: 'Send invite',
      };

    case 'newinvite':
      return {
        kicker,
        title: 'Send a new invite',
        body: (
          <p>
            A new invitation link will be created for {who}. The current invitation link
            will stop working immediately.
          </p>
        ),
        fields: [],
        primary: 'Send new invite',
        secondary: 'Keep current invite',
      };

    case 'cancelinvite':
      return {
        kicker,
        title: 'Cancel invite',
        body: <p>{who} will no longer be able to use the current invitation link.</p>,
        fields: [
          {
            id: 'm-reason',
            label: 'Why are you canceling this invitation?',
            required: true,
            textarea: true,
            placeholder: AUDIT_PLACEHOLDER,
          },
        ],
        primary: 'Cancel invite',
        secondary: 'Keep invite',
      };

    case 'suspend':
      return {
        kicker,
        title: 'Suspend Founder access',
        body: (
          <p>
            {who}’s Founder access or campaign activity will be restricted until Proovd
            restores it.
          </p>
        ),
        fields: [
          {
            id: 'm-reason',
            label: 'Reason for suspension',
            required: true,
            textarea: true,
            placeholder:
              'e.g. Proovd is reviewing a serious discrepancy in the campaign’s delivery claims.',
          },
          {
            id: 'm-evidence',
            label: 'Evidence (attach where relevant)',
            placeholder: 'Case ID, review record…',
          },
        ],
        primary: 'Suspend access',
        secondary: 'Keep access',
      };

    case 'restore':
      return {
        kicker,
        title: 'Restore Founder access',
        body: <p>{who} will regain normal Founder access.</p>,
        fields: [
          {
            id: 'm-reason',
            label: 'Why is access being restored?',
            required: true,
            textarea: true,
            placeholder:
              'e.g. The requested delivery evidence was provided and the review is complete.',
          },
        ],
        primary: 'Restore access',
      };

    case 'ban':
      return {
        kicker,
        title: 'Permanently ban Founder',
        body: (
          <>
            <p>{who} will no longer be eligible to run campaigns on Proovd.</p>
            <p className="helper">{GHOST_BAN_TRIGGER_SUMMARY}</p>
          </>
        ),
        fields: [
          // §22.7 has four defined triggers and no discretionary member, so the
          // control is a closed list rather than a text box. The server refuses
          // a trigger the record does not actually meet, by name — this list
          // says what may be claimed, never that it is true.
          {
            id: 'm-trigger',
            label: 'Which defined trigger does the record meet?',
            required: true,
            select: true,
            options: GHOST_BAN_TRIGGERS.map((value) => ({
              value,
              label: GHOST_BAN_TRIGGER_LABELS[value],
            })),
          },
          {
            id: 'm-reason',
            label: 'Reason',
            required: true,
            textarea: true,
            placeholder:
              'e.g. No required Founder communication for more than 30 consecutive days.',
          },
          {
            id: 'm-evidence',
            label: 'Evidence',
            required: true,
            placeholder: 'e.g. No Founder response between Sep 4 and Oct 7',
          },
          // The remaining two of §22.7's five recorded facts. They are asked for
          // rather than defaulted: a blank the product filled in would be a
          // permanent sanction justified by a record nobody made.
          {
            id: 'm-notice',
            label: 'Notice given to the Founder',
            required: true,
            textarea: true,
            placeholder: 'What this Founder is told, in the words they will read.',
          },
          {
            id: 'm-recovery',
            label: 'Payment recovery status',
            required: true,
            placeholder: 'e.g. First payment released; remaining payment withheld.',
          },
          {
            id: 'm-enforcement',
            label: 'Enforcement decision',
            required: true,
            placeholder: 'e.g. Campaign killed Oct 7; no further campaigns permitted.',
          },
        ],
        reauth: true,
        primary: 'Permanently ban',
        secondary: 'Cancel',
      };

    case 'deletion':
      return {
        kicker,
        title: 'Review account deletion request',
        body: (
          <>
            {ctx.deletionDetail ? <p>{ctx.deletionDetail}</p> : null}
            <p>
              {DELETION_RETENTION_NOTE} {DELETION_NO_BULK_ACTION_NOTE}
            </p>
          </>
        ),
        fields: [
          {
            id: 'm-note',
            label: 'What you concluded',
            required: true,
            textarea: true,
            placeholder: AUDIT_PLACEHOLDER,
            hint: 'Recorded on the request. A review is added, never edited — a later change of mind is its own note.',
          },
        ],
        primary: 'Acknowledge — keep under review',
      };

    case 'campapprove':
      return {
        kicker,
        title: 'Approve for another campaign',
        body: (
          <p>
            This records that {who} has completed the required waiting period and passed
            Proovd’s readiness review.
          </p>
        ),
        // §22.10 is a decision about somebody, so §25.6 wants the criteria that
        // were applied AND what the Founder is told — separately, because the
        // second is the one §29.4 requires to name the actual position rather
        // than paraphrase an internal note.
        fields: [
          {
            id: 'm-criteria',
            label: 'Criteria applied',
            required: true,
            textarea: true,
            placeholder:
              'e.g. Waiting period complete; previous campaign delivered and reconciled; no open enforcement.',
            hint: 'Internal. Recorded on the decision, never shown to the Founder.',
          },
          {
            id: 'm-explanation',
            label: 'What the Founder is told',
            required: true,
            textarea: true,
            placeholder: 'e.g. You are ready to start another campaign whenever you are.',
          },
        ],
        primary: 'Approve for another campaign',
      };

    case 'campunapprove':
      return {
        kicker,
        title: 'Remove next-campaign approval',
        body: <p>The readiness decision returns to “Not reviewed yet.”</p>,
        fields: [
          {
            id: 'm-reason',
            label: 'Why is this approval being removed?',
            required: true,
            textarea: true,
            placeholder:
              'e.g. A newly identified fulfillment issue from the previous campaign requires further review.',
            hint: 'Internal. Recorded on the decision, never shown to the Founder.',
          },
          {
            id: 'm-explanation',
            label: 'What the Founder is told',
            required: true,
            textarea: true,
            placeholder:
              'e.g. Proovd needs to finish reviewing delivery on your last campaign before another one can start.',
          },
        ],
        primary: 'Remove approval',
      };
  }
}
