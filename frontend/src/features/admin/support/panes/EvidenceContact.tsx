/**
 * The Evidence & contact tab — §26.8, §24.11, §30.
 *
 * What the case is evidenced by, and who was coordinated with outside the
 * customer thread.
 *
 * ── Evidence is a reference, and the surface says so ────────────────────────
 * There is no file control anywhere on this pane. §12's object storage is Track
 * A4 and unconfigured, so an upload would either fail or silently drop the
 * file; §1.4's two honest options are to hide the control or to name what it
 * is, and `EVIDENCE_IS_A_REFERENCE` is on screen above the list rather than
 * being discovered by an Admin who tried.
 *
 * ── Contacting a party is not a second customer thread ──────────────────────
 * The case stays the central record. Each contact carries what was asked, when
 * an answer is expected, and — once it arrives — what came back. The expected
 * date is a date somebody CHECKS: nothing sweeps it and nothing chases it,
 * because §30 forbids automated engagement sequences and having nowhere to put
 * a schedule is what keeps one from appearing.
 */

import { EVIDENCE_IS_A_REFERENCE } from '@proovd/shared';
import { Button } from '../../../../components/index.js';
import { CaseSection, formatInstant } from '../shared.js';
import { useDialogTrigger, type PaneProps } from '../SupportCase.js';
import {
  ContactDialog,
  ContactOutcomeDialog,
  EvidenceDialog,
  SectionHistoryDialog,
} from '../dialogs/index.js';
import { useState } from 'react';
import type { SupportContactRow } from '../api.js';

export function EvidenceContact({ detail, onChanged }: PaneProps) {
  const evidence = useDialogTrigger();
  const contact = useDialogTrigger();
  const evidenceHistory = useDialogTrigger();
  const contactHistory = useDialogTrigger();
  const [outcomeFor, setOutcomeFor] = useState<{
    contact: SupportContactRow;
    trigger: HTMLElement;
  } | null>(null);

  return (
    <>
      <CaseSection
        title="Evidence"
        lede={
          detail.evidence.length > 0
            ? 'Everything attached to this case, and which record each piece came from.'
            : 'Nothing has been attached to this case yet.'
        }
        actions={
          <>
            <Button tier="secondary" onClick={evidence.open}>
              Add evidence
            </Button>
            <Button tier="tertiary" onClick={evidenceHistory.open}>
              View evidence history
            </Button>
          </>
        }
      >
        <p className="helper sup-note">{EVIDENCE_IS_A_REFERENCE}</p>

        {detail.evidence.length > 0 ? (
          <ul className="sup-items">
            {detail.evidence.map((item) => (
              <li key={item.id} className="sup-item">
                <div>
                  <b>{item.description}</b>
                  <p className="helper">
                    {item.kindLabel} · added by {item.addedBy} ·{' '}
                    {formatInstant(item.occurredAt)}
                  </p>
                  <p className="helper">
                    {item.linkedReference
                      ? `${item.linkedLabel} · ${item.linkedReference}`
                      : item.linkedLabel}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </CaseSection>

      <CaseSection
        title="Parties contacted"
        lede={
          detail.contacts.length > 0
            ? 'Coordination Proovd did outside the customer thread. This case stays the central record.'
            : 'Nobody outside the customer thread has been contacted about this case.'
        }
        actions={
          <>
            {detail.contactableParties.length > 0 ? (
              <Button tier="secondary" onClick={contact.open}>
                Record a contact
              </Button>
            ) : null}
            <Button tier="tertiary" onClick={contactHistory.open}>
              View contact history
            </Button>
          </>
        }
      >
        {detail.contacts.length > 0 ? (
          <ul className="sup-items">
            {detail.contacts.map((item) => (
              <li key={item.id} className="sup-item">
                <div>
                  <b>{item.partyLabel}</b>
                  <p className="helper">
                    {formatInstant(item.occurredAt)} · recorded by {item.recordedBy}
                  </p>
                  <p className="sup-item__body">{item.message}</p>
                  <p className="helper">
                    {item.expectedResponseAt
                      ? `Expected back: ${formatInstant(item.expectedResponseAt)}`
                      : 'No expected response time recorded'}
                    {' · '}
                    {item.outcome ? `Outcome: ${item.outcome}` : 'No response recorded yet'}
                  </p>
                </div>
                {/*
                  The control disappears once an outcome exists, because the
                  record is write-once: offering an edit that the service and a
                  trigger both refuse would be a button that cannot work (§1.4).
                */}
                {!item.outcome ? (
                  <Button
                    tier="tertiary"
                    small
                    onClick={(event) =>
                      setOutcomeFor({ contact: item, trigger: event.currentTarget })
                    }
                  >
                    Record what they said
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CaseSection>

      {evidence.trigger ? (
        <EvidenceDialog
          detail={detail}
          trigger={evidence.trigger}
          onClose={evidence.close}
          onDone={onChanged}
        />
      ) : null}
      {contact.trigger ? (
        <ContactDialog
          detail={detail}
          trigger={contact.trigger}
          onClose={contact.close}
          onDone={onChanged}
        />
      ) : null}
      {outcomeFor ? (
        <ContactOutcomeDialog
          detail={detail}
          contact={outcomeFor.contact}
          trigger={outcomeFor.trigger}
          onClose={() => setOutcomeFor(null)}
          onDone={onChanged}
        />
      ) : null}
      {evidenceHistory.trigger ? (
        <SectionHistoryDialog
          section="evidence"
          label="Evidence"
          entries={detail.history}
          trigger={evidenceHistory.trigger}
          onClose={evidenceHistory.close}
        />
      ) : null}
      {contactHistory.trigger ? (
        <SectionHistoryDialog
          section="contact"
          label="Contact"
          entries={detail.history}
          trigger={contactHistory.trigger}
          onClose={contactHistory.close}
        />
      ) : null}
    </>
  );
}
