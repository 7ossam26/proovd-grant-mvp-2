/**
 * The operations an Admin performs against one campaign relationship — §14.2,
 * §16, §22.8, §24.7, §31.5.
 *
 * Six forms in one file, because they share a subject and a shape: each is a
 * short spec, each posts to a route that already owns its rules, and each ends
 * in a re-read rather than a local patch.
 *
 * ── None of them grants anything ────────────────────────────────────────────
 * `evaluate` re-derives §16 readiness from the thirteen live facts and cannot
 * mark an item complete. `confirm-deliverables` records ONE Admin-owned item
 * and the derivation decides the rest. `reject` is §14.2's only Admin move on a
 * proposal — Admin may observe, mediate, and reject, and may never accept for
 * either party. `assignCompletion` refuses a completion whose findings are
 * short, naming which criterion.
 *
 * ── Two are one-way, and the copy says so before the press ──────────────────
 * Revoking kit access is irreversible at the database (§31.5: an access grant
 * nobody consciously made is what the exception cannot survive), and a §22.8
 * status is corrected by a NEW decision rather than an edit.
 */

import { useEffect, useState } from 'react';
import { SALES_ARE_NOT_A_COMPLETION_REQUIREMENT } from '@proovd/shared';
import { Button } from '../../../../components/index.js';
import {
  ConfirmDialog,
  DialogShell,
  type DialogSpec,
} from '../../founders/dialogs/index.js';
import {
  assignCompletion,
  confirmDeliverables,
  evaluateReadiness,
  fetchCompletion,
  fetchKitAccessLog,
  fetchRelationship,
  recordCreatorFailure,
  rejectProposalVersion,
  resolveCreatorReplacement,
  revealPreparing,
  revokeKitAccess,
  setFundingDeadline,
  type CompletionFindings,
  type CreatorRelationshipDetail,
} from '../api.js';

export type RelationshipOp =
  | 'reject_version'
  | 'confirm_deliverables'
  | 'evaluate'
  | 'funding_deadline'
  | 'revoke_kit'
  | 'reveal'
  | 'completion'
  | 'creator_failure'
  | 'resolve_replacement'
  | 'access_log';

export function RelationshipOpsDialog({
  op,
  prospectId,
  associationId,
  campaignId,
  campaignName,
  versionId,
  trigger,
  onClose,
  onDone,
}: {
  op: RelationshipOp;
  prospectId: string;
  associationId: string;
  campaignId: string;
  campaignName: string;
  versionId?: string;
  trigger: HTMLElement | null;
  onClose: () => void;
  onDone: (detail: CreatorRelationshipDetail) => void;
}) {
  /* The two reads that have to arrive before their form can offer anything. */
  const [completion, setCompletion] = useState<CompletionFindings | null>(null);
  const [accessLog, setAccessLog] = useState<
    { id: string; section: string; affiliateUserId: string | null; occurredAt: string }[] | null
  >(null);

  useEffect(() => {
    let live = true;
    if (op === 'completion') {
      void fetchCompletion(associationId)
        .then((value) => live && setCompletion(value))
        .catch(() => live && setCompletion({ findings: [], current: null }));
    }
    if (op === 'access_log') {
      void fetchKitAccessLog(associationId)
        .then(({ access }) => live && setAccessLog(access))
        .catch(() => live && setAccessLog([]));
    }
    return () => {
      live = false;
    };
  }, [op, associationId]);

  const finish = async () => onDone(await fetchRelationship(prospectId, associationId));

  /* ── The access log is a read, so it is a panel rather than a form ─────── */
  if (op === 'access_log') {
    return (
      <DialogShell
        kicker={`${campaignName} · §31.5`}
        title="Campaign kit access log"
        description="Every read of the kit, in order. §31.5 permits the pre-view only while it stays logged, and this is the log."
        trigger={trigger}
        onClose={onClose}
      >
        {(close) => (
          <>
            {accessLog === null ? (
              <p className="grey">Reading the access log.</p>
            ) : accessLog.length === 0 ? (
              <p className="grey">
                The kit has not been opened. A reveal grants access; it does not read it.
              </p>
            ) : (
              <ul className="cr-reviews">
                {accessLog.map((entry) => (
                  <li key={entry.id}>
                    <p>{entry.section.replace(/_/g, ' ')}</p>
                    <p className="helper">
                      {entry.affiliateUserId ?? 'Unknown account'} · {entry.occurredAt}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p className="helper">
              The log records that a read happened and which section — never any of the
              Founder&rsquo;s material. Copying content into it would put a second copy
              somewhere no revocation could reach.
            </p>
            <div className="case-actions">
              <Button tier="secondary" onClick={close}>
                Close
              </Button>
            </div>
          </>
        )}
      </DialogShell>
    );
  }

  if (op === 'completion' && completion === null) {
    return (
      <DialogShell
        kicker={`${campaignName} · §22.8`}
        title="Successful completion"
        description="Reading the five criteria from the record."
        trigger={trigger}
        onClose={onClose}
      >
        {(close) => (
          <div className="case-actions">
            <Button tier="secondary" onClick={close}>
              Close
            </Button>
          </div>
        )}
      </DialogShell>
    );
  }

  const spec = specFor(op, { campaignName, completion });

  return (
    <ConfirmDialog
      spec={spec}
      trigger={trigger}
      onClose={onClose}
      onSubmit={async (values) => {
        switch (op) {
          case 'reject_version':
            await rejectProposalVersion(versionId!, {
              internalReason: values['internalReason'] ?? '',
              customerExplanation: values['customerExplanation'] ?? '',
            });
            break;
          case 'confirm_deliverables':
            await confirmDeliverables(campaignId, associationId, {
              confirmed: values['confirmed'] !== 'No',
            });
            break;
          case 'evaluate':
            await evaluateReadiness(campaignId, associationId);
            break;
          case 'funding_deadline':
            await setFundingDeadline(campaignId, associationId, {
              deadlineAt: values['deadlineAt'] ?? '',
            });
            break;
          case 'revoke_kit':
            await revokeKitAccess(associationId, { reason: values['reason'] ?? '' });
            break;
          case 'reveal':
            await revealPreparing(campaignId);
            break;
          case 'creator_failure':
            await recordCreatorFailure(campaignId, {
              failedAssociationId: associationId,
              replacementDesignation: values['replacementDesignation'] ?? '',
            });
            break;
          case 'resolve_replacement':
            await resolveCreatorReplacement(campaignId, {
              ...(values['resolutionNote'] ? { resolutionNote: values['resolutionNote'] } : {}),
            });
            break;
          case 'completion':
            await assignCompletion(associationId, {
              status:
                values['status'] === 'completion_disqualified'
                  ? 'completion_disqualified'
                  : 'successfully_completed',
              evidenceNote: values['evidenceNote'] ?? null,
              ...(values['status'] === 'completion_disqualified'
                ? { disqualifyingReason: values['disqualifyingReason'] ?? '' }
                : {}),
            });
            break;
        }
        await finish();
      }}
    />
  );
}

/* ── The forms ──────────────────────────────────────────────────────────────*/

function specFor(
  op: Exclude<RelationshipOp, 'access_log'>,
  context: { campaignName: string; completion: CompletionFindings | null },
): DialogSpec {
  const kicker = context.campaignName;

  switch (op) {
    case 'reject_version':
      return {
        kicker: `${kicker} · §14.2`,
        title: 'Reject this proposal version',
        body: (
          <>
            <p>
              Admin may reject a version that violates policy. Admin cannot accept for either
              party — the locked agreement is the exact version both of them accepted.
            </p>
            <p className="helper">
              A rejected version is terminal: there is no path from it back to locked. A new
              version is a new proposal.
            </p>
          </>
        ),
        fields: [
          {
            id: 'internalReason',
            label: 'Internal reason',
            required: true,
            textarea: true,
            hint: 'Not shown to either party.',
          },
          {
            id: 'customerExplanation',
            label: 'What both parties are told',
            required: true,
            textarea: true,
            hint: '§25.6 keeps the two apart, and this half never carries a provider or fraud code.',
          },
        ],
        primary: 'Reject the version',
        secondary: 'Cancel',
      };

    case 'confirm_deliverables':
      return {
        kicker: `${kicker} · §16`,
        title: 'Confirm required posts and deliverables',
        body: (
          <p>
            One of §16&rsquo;s thirteen items, and the only one this form touches. The other
            twelve are derived from the records that hold them, and readiness re-derives
            after this is recorded.
          </p>
        ),
        fields: [
          {
            id: 'confirmed',
            label: 'Confirmed',
            required: true,
            select: true,
            options: ['Yes', 'No'],
          },
        ],
        primary: 'Record the confirmation',
        secondary: 'Cancel',
      };

    case 'evaluate':
      return {
        kicker: `${kicker} · §16`,
        title: 'Re-derive readiness',
        body: (
          <>
            <p>
              Reads the thirteen §16 facts again and moves the relationship between ready and
              readiness-blocked accordingly.
            </p>
            <p className="helper">
              It grants nothing. Readiness is complete or it is not, and no control anywhere
              can mark an item done by hand.
            </p>
          </>
        ),
        fields: [],
        primary: 'Re-derive it',
        secondary: 'Cancel',
      };

    case 'funding_deadline':
      return {
        kicker: `${kicker} · §16, §24.7`,
        title: 'Set the funding deadline',
        body: (
          <>
            <p>
              The date by which the Founder must fund the fixed Creator payment for this
              relationship.
            </p>
            <p className="helper">
              Missing it cancels the relationship and closes the allocation. A funded
              allocation is never a lapse.
            </p>
          </>
        ),
        fields: [
          {
            id: 'deadlineAt',
            label: 'Deadline',
            required: true,
            inputType: 'date',
            hint: '§6 fixes no value for this — it is an Admin decision, recorded.',
          },
        ],
        primary: 'Set the deadline',
        secondary: 'Cancel',
      };

    case 'revoke_kit':
      return {
        kicker: `${kicker} · §31.5`,
        title: 'Revoke Campaign kit access',
        body: (
          <>
            <p>
              The Creator loses access to the Founder&rsquo;s unreleased material. Every read
              already recorded stays in the log.
            </p>
            <p className="helper">
              One-way at the database. Re-granting is deliberately not built — an access
              grant nobody consciously made is what §31.5&rsquo;s exception cannot survive.
            </p>
          </>
        ),
        fields: [
          { id: 'reason', label: 'Why access is being revoked', required: true, textarea: true },
        ],
        primary: 'Revoke access',
        secondary: 'Cancel',
      };

    case 'reveal':
      return {
        kicker: `${kicker} · §10`,
        title: 'Reveal the preparing campaign',
        body: (
          <>
            <p>
              Re-runs §10&rsquo;s handoff for every Creator on this campaign who is waiting for
              it. Safe to run again: the reveal is idempotent three ways, so nobody gets a
              second visibility event or a second email.
            </p>
            <p className="helper">
              A Creator whose kit access was revoked is skipped and named in the audit —
              revocation was a conscious withdrawal, and a reveal is not consent to reverse it.
            </p>
          </>
        ),
        fields: [],
        primary: 'Run the reveal',
        secondary: 'Cancel',
      };

    case 'creator_failure':
      return {
        kicker: `${kicker} · §29.6`,
        title: 'Record a required-Creator failure',
        body: (
          <>
            <p>
              Records that this required launch Creator did not post, and opens the
              replacement window: three US business days on the committed holiday calendar,
              stored with the version that produced it.
            </p>
            <p className="helper">
              The window is non-resettable. Recording this twice returns the first record
              unchanged rather than moving the deadline — and if it lapses, every funded
              fixed Creator payment is returned and the full listing fee is refunded.
            </p>
          </>
        ),
        fields: [
          {
            id: 'replacementDesignation',
            label: 'The replacement plan',
            required: true,
            textarea: true,
            hint: 'Who is being approached, or how the roster will be made whole. Recorded on the failure.',
          },
        ],
        primary: 'Record the failure',
        secondary: 'Cancel',
      };

    case 'resolve_replacement':
      return {
        kicker: `${kicker} · §29.6`,
        title: 'Mark the replacement ready',
        body: (
          <p>
            The replacement Creator is ready, so the campaign returns to Creator prep and the
            window closes. Recorded against the campaign&rsquo;s one failure record.
          </p>
        ),
        fields: [{ id: 'resolutionNote', label: 'Resolution note', textarea: true }],
        primary: 'Mark it resolved',
        secondary: 'Cancel',
      };

    case 'completion': {
      const findings = context.completion?.findings ?? [];
      const unmet = findings.filter((finding) => !finding.met);
      return {
        kicker: `${kicker} · §22.8`,
        title: 'Record the completion decision',
        body: (
          <>
            <p>
              The five criteria are READ from the record, never asserted here. A completion
              whose findings are short is refused, naming which criterion.
            </p>
            {findings.length === 0 ? (
              <p className="helper">No findings could be read for this relationship.</p>
            ) : (
              <ul className="cr-reviews">
                {findings.map((finding) => (
                  <li key={finding.key}>
                    <p>
                      {finding.met ? '✓ ' : '· '}
                      {finding.detail}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {unmet.length > 0 ? (
              <p className="helper">
                {unmet.length} of {findings.length} criteria are not met, so a completion will
                be refused.
              </p>
            ) : null}
            {/* §22.8's own rule, where somebody would otherwise supply one. */}
            <p className="helper">{SALES_ARE_NOT_A_COMPLETION_REQUIREMENT}</p>
          </>
        ),
        fields: [
          {
            id: 'status',
            label: 'Decision',
            required: true,
            select: true,
            options: [
              { value: 'successfully_completed', label: 'Successfully completed' },
              { value: 'completion_disqualified', label: 'Disqualified' },
            ],
          },
          { id: 'evidenceNote', label: 'Evidence note', textarea: true },
          {
            id: 'disqualifyingReason',
            label: 'Disqualifying reason',
            textarea: true,
            hint: 'Required on a disqualification, and refused on a completion — a completion carries no reason.',
          },
        ],
        primary: 'Record the decision',
        secondary: 'Cancel',
      };
    }
  }
}
