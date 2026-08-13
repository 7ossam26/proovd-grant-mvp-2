/**
 * The Case & ownership tab — §26.7, §26.8, §27.8.
 *
 * Three sections, in the reference's order: who owns it, how it is classified,
 * and what happens next.
 *
 * ── Two kinds of "owner", kept visibly apart ────────────────────────────────
 * §26.7's `owner` is the ORGANISATION accountable for the response — Proovd, or
 * the Founder coordinated by Proovd — and it is what Appendix B.8 told the
 * customer. The assignee is which human is handling it. Collapsing them would
 * either put a person's name in a customer's acknowledgement email or make
 * "reassign to a colleague" look like a change to what the customer was
 * promised, so both are rendered, labelled, and changed by different controls.
 *
 * ── The response deadline is shown with the calendar that produced it ───────
 * §29.6: a business-day deadline is computed once from the committed versioned
 * calendar and stored with its version. Rendering the version beside the date
 * is what makes that checkable by the person relying on it.
 */

import { useCallback, useState } from 'react';
import { Button } from '../../../../components/index.js';
import { assignCase } from '../api.js';
import { CaseChip, CaseSection, Deadline, formatInstant } from '../shared.js';
import { useDialogTrigger, type PaneProps } from '../SupportCase.js';
import {
  AssignDialog,
  ClassifyDialog,
  CloseDialog,
  NextUpdateDialog,
  ReopenDialog,
  ResolveDialog,
  SectionHistoryDialog,
  TriageDialog,
  WaitingDialog,
} from '../dialogs/index.js';

export function CaseOwnership({ detail, onChanged }: PaneProps) {
  const assign = useDialogTrigger();
  const classify = useDialogTrigger();
  const triage = useDialogTrigger();
  const waiting = useDialogTrigger();
  const nextUpdate = useDialogTrigger();
  const resolve = useDialogTrigger();
  const close = useDialogTrigger();
  const reopen = useDialogTrigger();
  const ownershipHistory = useDialogTrigger();
  const classificationHistory = useDialogTrigger();
  const statusHistory = useDialogTrigger();

  const { header, ownership, nextResponse } = detail;
  const unowned = header.open && !ownership.assigneeUserId;
  const closed = Boolean(nextResponse.closedAt);
  const resolved = nextResponse.status === 'resolved';
  const selfOwned = ownership.assignedToYou;

  const [taking, setTaking] = useState(false);

  /**
   * Take the case.
   *
   * Sends no user id at all — the server resolves `assignToSelf` from the
   * session, so this cannot name anybody. A failure is left to the re-read:
   * `onChanged` re-fetches either way, so the surface ends up showing whatever
   * the server actually recorded rather than what the click assumed.
   */
  const assignToMe = useCallback(async () => {
    setTaking(true);
    try {
      await assignCase(header.caseId, { assignToSelf: true });
    } finally {
      setTaking(false);
      onChanged();
    }
  }, [header.caseId, onChanged]);

  return (
    <>
      <CaseSection
        title="Ownership"
        flag={unowned}
        lede={
          unowned
            ? 'This case needs human action and has no assigned Admin.'
            : 'One named Admin owns the next action on this case.'
        }
        actions={
          <>
            {/*
              The reference's one-click affordance, and worth keeping: taking a
              case is the commonest act in a support queue, and making it a
              dialog with a select would put two decisions in front of somebody
              who has made one.

              It carries no `toUserId` — the server resolves `assignToSelf`
              from the SESSION, so this control cannot name anybody. `selfOwned`
              hides it rather than disabling it: a control whose only effect is
              already true is one §1.4 says not to offer.
            */}
            {!selfOwned ? (
              <Button
                tier={unowned ? 'primary' : 'secondary'}
                disabled={taking}
                onClick={() => void assignToMe()}
              >
                {taking ? 'Assigning…' : 'Assign to me'}
              </Button>
            ) : null}
            <Button tier={unowned && selfOwned ? 'primary' : 'tertiary'} onClick={assign.open}>
              {ownership.assigneeUserId ? 'Reassign to another Admin' : 'Assign another Admin'}
            </Button>
            <Button tier="tertiary" onClick={ownershipHistory.open}>
              View ownership history
            </Button>
          </>
        }
      >
        <dl className="sup-facts sup-facts--wide">
          <div>
            <dt>Assigned Admin</dt>
            <dd>
              {ownership.assigneeName ?? <span className="grey">No owner yet</span>}
              {ownership.assignedAt ? (
                <p className="helper">Since {formatInstant(ownership.assignedAt)}</p>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Accountable for the response</dt>
            <dd>
              {ownership.ownerLabel}
              <p className="helper">
                §26.7&rsquo;s owner — this is what the acknowledgement told the customer.
                Changing it is a handoff, with its own four-field note.
              </p>
            </dd>
          </div>
          {ownership.previousAssigneeName ? (
            <div>
              <dt>Previous Admin</dt>
              <dd>{ownership.previousAssigneeName}</dd>
            </div>
          ) : null}
          {ownership.lastAssignmentReason ? (
            <div>
              <dt>Reason for the last change</dt>
              <dd>{ownership.lastAssignmentReason}</dd>
            </div>
          ) : null}
        </dl>

        {ownership.handoffs.length > 0 ? (
          <div className="sup-handoffs">
            <p className="kicker">Handoff notes (§26.8)</p>
            {ownership.handoffs.map((handoff) => (
              <div key={handoff.id} className="sup-handoff">
                <p>
                  <b>{handoff.currentOwner}</b> · {formatInstant(handoff.occurredAt)}
                </p>
                <dl className="sup-facts">
                  <div>
                    <dt>Verified facts</dt>
                    <dd>{handoff.verifiedFacts}</dd>
                  </div>
                  <div>
                    <dt>Next promise to the customer</dt>
                    <dd>{handoff.nextCustomerPromise}</dd>
                  </div>
                  <div>
                    <dt>Statements to keep consistent</dt>
                    <dd>{handoff.statementsToKeepConsistent}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        ) : null}
      </CaseSection>

      <CaseSection
        title="Classification"
        lede="How this case is filed. The topic list is §26.7’s — the same one a customer chooses from."
        actions={
          <>
            <Button tier="secondary" onClick={classify.open}>
              Change classification
            </Button>
            <Button tier="tertiary" onClick={triage.open}>
              Change triage
            </Button>
            <Button tier="tertiary" onClick={classificationHistory.open}>
              View classification history
            </Button>
          </>
        }
      >
        <dl className="sup-facts sup-facts--wide">
          <div>
            <dt>Topic</dt>
            <dd>{header.topicLabel}</dd>
          </div>
          <div>
            <dt>Subcategory</dt>
            <dd>{header.subcategory ?? <span className="grey">Not recorded</span>}</dd>
          </div>
          <div>
            <dt>Triage</dt>
            <dd>
              {header.triageLabel}
              <p className="helper">
                Queue order only. The response promise is one business day on every case.
              </p>
            </dd>
          </div>
          <div>
            <dt>Internal reason</dt>
            <dd>
              {detail.internalReason ?? <span className="grey">Not recorded</span>}
              {detail.internalReason ? (
                <p className="helper">Admin-only. It appears on no customer message.</p>
              ) : null}
            </dd>
          </div>
        </dl>
      </CaseSection>

      <CaseSection
        title="Next response"
        flag={header.open && header.blockedOnProovd && !unowned}
        lede={
          header.open
            ? 'Who owes the next action, and when the customer was promised an update.'
            : 'This case is finished. Nothing is outstanding.'
        }
        actions={
          <>
            {header.open ? (
              <>
                <Button tier="secondary" onClick={waiting.open}>
                  Change who this is waiting on
                </Button>
                <Button tier="tertiary" onClick={nextUpdate.open}>
                  Set next update date
                </Button>
                <Button tier="tertiary" onClick={resolve.open}>
                  Mark resolved
                </Button>
              </>
            ) : null}
            {resolved && !closed ? (
              <Button tier="secondary" onClick={close.open}>
                Close case
              </Button>
            ) : null}
            {resolved ? (
              <Button tier="tertiary" onClick={reopen.open}>
                Reopen case
              </Button>
            ) : null}
            <Button tier="tertiary" onClick={statusHistory.open}>
              View status history
            </Button>
          </>
        }
      >
        {header.open ? (
          <dl className="sup-facts sup-facts--wide">
            <div>
              <dt>Status</dt>
              <dd>
                <CaseChip chip={header.chip} />
              </dd>
            </div>
            <div>
              <dt>Waiting on</dt>
              <dd>{nextResponse.waitingLabel ?? <span className="grey">Nobody</span>}</dd>
            </div>
            <div>
              <dt>What they owe</dt>
              <dd>{header.nextAction}</dd>
            </div>
            <div>
              <dt>Next customer update due</dt>
              <dd>
                <Deadline deadline={nextResponse.nextUpdateDue} absolute />
              </dd>
            </div>
            <div>
              <dt>First-response promise</dt>
              <dd>
                <Deadline deadline={nextResponse.responseDue} absolute />
                <p className="helper">
                  §27.8: one business day, Monday&ndash;Friday, excluding U.S. federal
                  holidays. Computed once on calendar {nextResponse.calendarVersion} and never
                  moved.
                </p>
              </dd>
            </div>
            {nextResponse.founderFollowupDue ? (
              <div>
                <dt>Founder follow-up</dt>
                <dd>
                  <Deadline deadline={nextResponse.founderFollowupDue} absolute />
                  <p className="helper">
                    §27.8&rsquo;s 48 hours. If the Founder has not responded by then, Proovd
                    follows up.
                  </p>
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Last response</dt>
              <dd>
                {nextResponse.lastResponseAt ? (
                  formatInstant(nextResponse.lastResponseAt)
                ) : (
                  <span className="grey">No reply sent yet</span>
                )}
              </dd>
            </div>
          </dl>
        ) : (
          <dl className="sup-facts sup-facts--wide">
            <div>
              <dt>Status</dt>
              <dd>
                <CaseChip chip={header.chip} />
              </dd>
            </div>
            <div>
              <dt>Resolution</dt>
              <dd>{nextResponse.resolution}</dd>
            </div>
            <div>
              <dt>Resolved by</dt>
              <dd>
                {nextResponse.resolvedBy}
                {nextResponse.resolvedAt ? ` · ${formatInstant(nextResponse.resolvedAt)}` : ''}
              </dd>
            </div>
            {nextResponse.closedAt ? (
              <div>
                <dt>Closed</dt>
                <dd>{formatInstant(nextResponse.closedAt)}</dd>
              </div>
            ) : null}
          </dl>
        )}

        {nextResponse.reopens.length > 0 ? (
          <div className="sup-reopens">
            <p className="kicker">Reopen history</p>
            {nextResponse.reopens.map((entry) => (
              <div key={entry.id} className="sup-reopen">
                <p>
                  <b>Reopened by {entry.actor}</b> · {formatInstant(entry.occurredAt)}
                </p>
                <p>{entry.reason}</p>
                {entry.priorResolution ? (
                  <p className="helper">
                    The resolution that did not hold: {entry.priorResolution}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </CaseSection>

      {assign.trigger ? (
        <AssignDialog detail={detail} trigger={assign.trigger} onClose={assign.close} onDone={onChanged} />
      ) : null}
      {classify.trigger ? (
        <ClassifyDialog detail={detail} trigger={classify.trigger} onClose={classify.close} onDone={onChanged} />
      ) : null}
      {triage.trigger ? (
        <TriageDialog detail={detail} trigger={triage.trigger} onClose={triage.close} onDone={onChanged} />
      ) : null}
      {waiting.trigger ? (
        <WaitingDialog detail={detail} trigger={waiting.trigger} onClose={waiting.close} onDone={onChanged} />
      ) : null}
      {nextUpdate.trigger ? (
        <NextUpdateDialog detail={detail} trigger={nextUpdate.trigger} onClose={nextUpdate.close} onDone={onChanged} />
      ) : null}
      {resolve.trigger ? (
        <ResolveDialog detail={detail} trigger={resolve.trigger} onClose={resolve.close} onDone={onChanged} />
      ) : null}
      {close.trigger ? (
        <CloseDialog detail={detail} trigger={close.trigger} onClose={close.close} onDone={onChanged} />
      ) : null}
      {reopen.trigger ? (
        <ReopenDialog detail={detail} trigger={reopen.trigger} onClose={reopen.close} onDone={onChanged} />
      ) : null}

      {ownershipHistory.trigger ? (
        <SectionHistoryDialog
          section="ownership"
          label="Ownership"
          entries={detail.history}
          trigger={ownershipHistory.trigger}
          onClose={ownershipHistory.close}
        />
      ) : null}
      {classificationHistory.trigger ? (
        <SectionHistoryDialog
          section="classification"
          label="Classification"
          entries={detail.history}
          trigger={classificationHistory.trigger}
          onClose={classificationHistory.close}
        />
      ) : null}
      {statusHistory.trigger ? (
        <SectionHistoryDialog
          section="status"
          label="Status"
          entries={detail.history}
          trigger={statusHistory.trigger}
          onClose={statusHistory.close}
        />
      ) : null}
    </>
  );
}
