/**
 * Every decision the Support workspace opens in a panel.
 *
 * All but one are a `DialogSpec` handed to the Founders workspace's
 * `ConfirmDialog` — the same panel, the same motion, the same required-field
 * behaviour, and the same rule that the SERVER's refusal is what gets rendered.
 * The reference gives each modal a lede saying what it does and a consequence
 * saying what happens on confirm; that pairing is preserved because it is a
 * deliberate decision in the reference, not decoration — §1.1 requires a person
 * to know what a control will do before they press it.
 *
 * ── The one that is not a spec ──────────────────────────────────────────────
 * Replying needs a template picker that REWRITES the message box, and a
 * `DialogSpec` carries static fields. So `ReplyDialog` uses `DialogShell`
 * directly. It is also the panel where §26.8's "editable" matters most: the
 * draft arrives filled with the case's own facts and is fully editable
 * afterwards, and there is no route anywhere that sends a template unedited.
 *
 * ── Nothing here refuses on the server's behalf ─────────────────────────────
 * A blank required field is caught locally only so the Admin is not made to
 * wait for a round trip to be told. Every real rule — the §33.9.11 provider-code
 * refusal, whether a case may be closed, whether an assignee is an Admin — is
 * decided server-side and its answer is what appears (§1.1).
 */

import { useCallback, useRef, useState } from 'react';
import {
  CONTACT_IS_RECORDED_NOT_SENT,
  EVIDENCE_IS_A_REFERENCE,
  SUPPORT_TOPICS,
  SUPPORT_TOPIC_LABELS,
  SUPPORT_EVIDENCE_KINDS,
  SUPPORT_EVIDENCE_LABELS,
  SUPPORT_LINKED_RECORD_KINDS,
  SUPPORT_LINKED_RECORD_LABELS,
  SUPPORT_TRIAGE_LABELS,
  SUPPORT_TRIAGE_LEVELS,
  SUPPORT_WAITING_LABELS,
  SUPPORT_WAITING_PARTIES,
  TRIAGE_NEVER_CHANGES_THE_PROMISE,
  type SupportEvidenceKind,
  type SupportLinkedRecordKind,
  type SupportTriageLevel,
  type SupportWaitingParty,
} from '@proovd/shared';
import { Dialog } from 'radix-ui';
import {
  Button,
  Field,
  Input,
  Textarea,
  useButtonProgress,
} from '../../../../components/index.js';
import {
  ConfirmDialog,
  DialogShell,
  type DialogSpec,
  type DialogValues,
} from '../../founders/dialogs/index.js';
import { AdminRequestError } from '../../api.js';
import { Consequence, formatInstant } from '../shared.js';
import * as api from '../api.js';
import type {
  SupportCaseDetail,
  SupportContactRow,
  SupportHistoryEntry,
  SupportTemplateOption,
} from '../api.js';

interface Common {
  detail: SupportCaseDetail;
  trigger: HTMLElement | null;
  onClose: () => void;
  onDone: () => void;
}

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in LOCAL time; ISO is UTC. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** Back the other way. An empty box is `null` — absence, not epoch zero. */
function toIso(local: string): string | null {
  if (!local.trim()) return null;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/* ── Reply ──────────────────────────────────────────────────────────────────*/

/**
 * The message the customer reads.
 *
 * §26.8: templates are a starting point that preserve context. The draft comes
 * back from the server rendered against this case's own records, together with
 * the facts that filled it — so the Admin can see what came from the record
 * rather than reading a paragraph and hoping. Choosing a template REPLACES the
 * box, which is why the control warns before overwriting typed text.
 */
export function ReplyDialog({ detail, trigger, onClose, onDone }: Common) {
  const [body, setBody] = useState('');
  const [templateKey, setTemplateKey] = useState('');
  const [facts, setFacts] = useState<Record<string, string> | null>(null);
  const [promised, setPromised] = useState(
    toLocalInput(detail.nextResponse.nextUpdateDue?.at ?? null),
  );
  const [failure, setFailure] = useState<string | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const withProgress = useButtonProgress();

  const pick = useCallback(
    async (key: string) => {
      setTemplateKey(key);
      if (!key) {
        setFacts(null);
        return;
      }
      try {
        const rendered = await api.fetchTemplate(detail.header.caseId, key);
        setBody(rendered.draft);
        setFacts(rendered.preservedFacts);
      } catch {
        setFailure('That template could not be loaded. Write the reply yourself — nothing has been sent.');
      }
    },
    [detail.header.caseId],
  );

  async function submit(close: () => void) {
    setFailure(null);
    if (!body.trim()) {
      setFailure('Write the message before sending it.');
      return;
    }
    const outcome: { refusal: string | null } = { refusal: null };
    await withProgress(primaryRef, async () => {
      try {
        await api.addMessage(detail.header.caseId, {
          customerFacing: true,
          body: body.trim(),
          templateKey: templateKey || null,
          nextPromisedUpdateAt: toIso(promised),
        });
      } catch (error) {
        outcome.refusal =
          error instanceof AdminRequestError
            ? [error.detail.title, error.detail.whatHappened, error.detail.next]
                .filter(Boolean)
                .join(' ')
            : 'Nothing was sent, and it is not certain why. Reload the case before trying again.';
      }
    });
    if (outcome.refusal) {
      setFailure(outcome.refusal);
      return;
    }
    onDone();
    close();
  }

  return (
    <DialogShell
      kicker={`${detail.header.reference} · ${detail.header.requesterName}`}
      title={`Reply to ${detail.header.requesterName}`}
      description={
        <>
          <p className="helper">
            The customer sees exactly this text. Templates are a starting point and stay
            fully editable.
          </p>
          <Consequence>
            The reply is recorded on the case and sent to {detail.header.requesterEmail}. Once
            sent it cannot be edited — a correction is a new message.
          </Consequence>
        </>
      }
      trigger={trigger}
      onClose={onClose}
    >
      {(close) => (
        <>
          <Field
            id="sup-tpl"
            label="Start from a template"
            hint="Optional. Choosing one replaces whatever is in the box below."
          >
            <select
              className="input"
              value={templateKey}
              onChange={(event) => void pick(event.target.value)}
            >
              <option value="">Write from scratch</option>
              {detail.templates.map((template: SupportTemplateOption) => (
                <option key={template.key} value={template.key}>
                  {template.label} ({template.specRef})
                </option>
              ))}
            </select>
          </Field>

          {facts ? (
            <div className="sup-facts-note">
              <p className="helper">
                <b>Filled from this case:</b>{' '}
                {Object.entries(facts)
                  .map(([key, value]) => `${key} = ${value}`)
                  .join(' · ')}
              </p>
            </div>
          ) : null}

          <Field id="sup-body" label="Message to the customer">
            <Textarea
              rows={9}
              placeholder="Write the reply the customer will read."
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </Field>

          <Field
            id="sup-promised"
            label="Next customer update due"
            hint="Optional. §27.8: an update goes out at this checkpoint even if the case is not resolved."
          >
            <Input
              type="datetime-local"
              value={promised}
              onChange={(event) => setPromised(event.target.value)}
            />
          </Field>

          {failure ? (
            <p className="field-error" role="alert">
              {failure}
            </p>
          ) : null}

          <div className="case-actions">
            <button
              ref={primaryRef}
              type="button"
              className="btn btn--primary"
              onClick={() => void submit(close)}
            >
              <span className="btn__label">Send reply</span>
            </button>
            <Dialog.Close asChild>
              <Button tier="tertiary">Back</Button>
            </Dialog.Close>
          </div>
        </>
      )}
    </DialogShell>
  );
}

/* ── Spec-driven panels ─────────────────────────────────────────────────────*/

/**
 * The panel every spec-driven decision renders in.
 *
 * Not a hook despite the name shape — it calls none — so it is safe to invoke
 * from a branch. It exists so the re-read after a successful write happens in
 * ONE place: a panel that forgot to call `onDone` would leave the case showing
 * the state it had before the decision, which is the disagreement between the
 * surface and the record that every read-after-write in this workspace avoids.
 */
function specDialog(
  spec: DialogSpec,
  submit: (values: DialogValues) => Promise<void>,
  { trigger, onClose, onDone }: Omit<Common, 'detail'>,
) {
  return (
    <ConfirmDialog
      spec={spec}
      trigger={trigger}
      onClose={onClose}
      onSubmit={async (values) => {
        await submit(values);
        onDone();
      }}
    />
  );
}

/** Internal notes never reach the customer, and may carry a provider code. */
export function NoteDialog({ detail, ...rest }: Common) {
  return specDialog(
    {
      kicker: detail.header.reference,
      title: 'Add internal note',
      body: (
        <>
          <p className="helper">
            Internal notes stay on the case for Admin only. They are never shown to the
            customer and are never sent.
          </p>
          <Consequence>
            The note is recorded against this case with your name and the time. §26.8 permits
            raw provider and fraud codes here — this is the one place they belong.
          </Consequence>
        </>
      ),
      fields: [
        {
          id: 'body',
          label: 'Note',
          required: true,
          textarea: true,
          placeholder: 'Investigation, provider detail, handoff context, risk, or the next step.',
        },
      ],
      primary: 'Save internal note',
      secondary: 'Back',
    },
    async (values) => {
      await api.addMessage(detail.header.caseId, {
        customerFacing: false,
        body: values['body'] ?? '',
      });
    },
    rest,
  );
}

export function AssignDialog({ detail, ...rest }: Common) {
  const current = detail.ownership.assigneeUserId;
  return specDialog(
    {
      kicker: detail.header.reference,
      title: current ? 'Reassign this case' : 'Assign an owner',
      body: (
        <>
          <p className="helper">
            Every case that needs human action needs one named Admin. Until it has one, nobody
            owes the customer a response.
          </p>
          <Consequence>
            The change is recorded with the previous owner, your reason, and the time. The
            accountable party the customer was told about — {detail.ownership.ownerLabel} — is a
            separate fact and does not move.
          </Consequence>
        </>
      ),
      fields: [
        {
          id: 'toUserId',
          label: 'Owner',
          select: true,
          required: true,
          value: current ?? detail.assignableAdmins[0]?.userId ?? '',
          options: detail.assignableAdmins.map((admin) => ({
            value: admin.userId,
            label: admin.name,
          })),
        },
        {
          id: 'reason',
          label: 'Reason',
          placeholder: 'Why this owner — e.g. Devon owns provider escalations this week.',
          hint: 'Optional, and worth writing: it is what the next person reads.',
        },
      ],
      primary: 'Save owner',
      secondary: 'Back',
    },
    async (values) => {
      await api.assignCase(detail.header.caseId, {
        toUserId: values['toUserId'] ?? '',
        reason: values['reason'] || null,
      });
    },
    rest,
  );
}

/**
 * §26.7's ten topics — not the reference's thirteen.
 *
 * A case opened by a Backer through §29.9 and one opened here must be
 * classifiable on ONE list, or the queue is counting two different things.
 */
export function ClassifyDialog({ detail, ...rest }: Common) {
  return specDialog(
    {
      kicker: detail.header.reference,
      title: 'Change classification',
      body: (
        <>
          <p className="helper">
            The topic list is §26.7&rsquo;s — the same one a Backer chooses from when they ask
            for help. The subcategory is free text for the distinction the topic does not draw.
          </p>
          <Consequence>
            The change is recorded on the case history with the previous classification. The
            internal reason is Admin-only and appears on no customer message.
          </Consequence>
        </>
      ),
      fields: [
        {
          id: 'topic',
          label: 'Topic',
          select: true,
          required: true,
          value: detail.header.topic,
          options: SUPPORT_TOPIC_OPTIONS,
        },
        {
          id: 'subcategory',
          label: 'Subcategory',
          value: detail.header.subcategory ?? '',
          placeholder: 'e.g. Link not attributing',
          hint: 'Optional.',
        },
        {
          id: 'internalReason',
          label: 'Internal reason',
          textarea: true,
          value: detail.internalReason ?? '',
          hint: 'Optional, Admin-only. A provider or fraud code is permitted here (§26.8).',
        },
      ],
      primary: 'Save classification',
      secondary: 'Back',
    },
    async (values) => {
      await api.classifyCase(detail.header.caseId, {
        topic: (values['topic'] ?? detail.header.topic) as typeof detail.header.topic,
        subcategory: values['subcategory'] || null,
        internalReason: values['internalReason'] || null,
      });
    },
    rest,
  );
}

/**
 * Triage.
 *
 * The pinned sentence sits WITH the control rather than under it, because the
 * reference's own modal says triage "drives response expectations" and an Admin
 * who believes that will tell a customer their case is faster.
 */
export function TriageDialog({ detail, ...rest }: Common) {
  return specDialog(
    {
      kicker: detail.header.reference,
      title: 'Change triage level',
      body: (
        <>
          <p className="helper">{TRIAGE_NEVER_CHANGES_THE_PROMISE}</p>
          <Consequence>
            The change is recorded on the case history. The response deadline —{' '}
            {detail.nextResponse.responseDue
              ? formatInstant(detail.nextResponse.responseDue.at)
              : 'already met'}{' '}
            — is not affected.
          </Consequence>
        </>
      ),
      fields: [
        {
          id: 'triage',
          label: 'Triage level',
          select: true,
          required: true,
          value: detail.header.triage,
          options: SUPPORT_TRIAGE_LEVELS.map((level) => ({
            value: level,
            label: SUPPORT_TRIAGE_LABELS[level],
          })),
        },
      ],
      primary: 'Save triage level',
      secondary: 'Back',
    },
    async (values) => {
      await api.setTriage(
        detail.header.caseId,
        (values['triage'] ?? 'normal') as SupportTriageLevel,
      );
    },
    rest,
  );
}

/** §27.1's "who owns it" and "what next", recorded as one act. */
export function WaitingDialog({ detail, ...rest }: Common) {
  return specDialog(
    {
      kicker: detail.header.reference,
      title: 'Change who this is waiting on',
      body: (
        <>
          <p className="helper">
            Name the exact party and what they owe. A case is never simply blocked.
          </p>
          <Consequence>
            The waiting party and the next action are recorded on the case history. Waiting on
            the Founder as the accountable party also starts §27.8&rsquo;s 48-hour follow-up.
          </Consequence>
        </>
      ),
      fields: [
        {
          id: 'waitingOn',
          label: 'Waiting on',
          select: true,
          required: true,
          value: detail.nextResponse.waitingOn ?? 'proovd',
          options: SUPPORT_WAITING_PARTIES.map((party) => ({
            value: party,
            label: SUPPORT_WAITING_LABELS[party],
          })),
        },
        {
          id: 'nextAction',
          label: 'What that party owes',
          required: true,
          textarea: true,
          value: detail.nextResponse.nextAction ?? '',
          placeholder:
            'e.g. The Founder must confirm delivery access for this Backer’s pre-order.',
        },
        {
          id: 'nextPromisedUpdateAt',
          label: 'Next customer update due',
          inputType: 'datetime-local',
          value: toLocalInput(detail.nextResponse.nextUpdateDue?.at ?? null),
          hint: 'Optional. §27.8: an update goes out at this checkpoint even without resolution.',
        },
      ],
      primary: 'Save',
      secondary: 'Back',
    },
    async (values) => {
      await api.setWaiting(detail.header.caseId, {
        waitingOn: (values['waitingOn'] ?? 'proovd') as SupportWaitingParty,
        nextAction: values['nextAction'] ?? '',
        nextPromisedUpdateAt: toIso(values['nextPromisedUpdateAt'] ?? ''),
      });
    },
    rest,
  );
}

export function NextUpdateDialog({ detail, ...rest }: Common) {
  return specDialog(
    {
      kicker: detail.header.reference,
      title: 'Set next update date',
      body: (
        <>
          <p className="helper">
            This is the time the customer was promised an update, whatever the outcome.
          </p>
          <Consequence>
            The promise is recorded and shown on the queue row. Nothing sends it — an Admin
            sends the update, and §27.8&rsquo;s sweep is what notices it lapsing.
          </Consequence>
        </>
      ),
      fields: [
        {
          id: 'at',
          label: 'Next customer update due',
          required: true,
          inputType: 'datetime-local',
          value: toLocalInput(detail.nextResponse.nextUpdateDue?.at ?? null),
        },
      ],
      primary: 'Save update date',
      secondary: 'Back',
    },
    async (values) => {
      const iso = toIso(values['at'] ?? '');
      if (!iso) throw new Error('invalid date');
      await api.setNextUpdate(detail.header.caseId, iso);
    },
    rest,
  );
}

export function ResolveDialog({ detail, ...rest }: Common) {
  return specDialog(
    {
      kicker: detail.header.reference,
      title: 'Mark resolved',
      body: (
        <>
          <p className="helper">
            Record what actually fixed the issue, in words the customer could read.
          </p>
          <Consequence>
            The case moves to Resolved. The conversation, evidence, and history stay intact and
            nothing is deleted. A raw provider or fraud code is refused here — this text is
            written to be readable by the customer (§33.9.11).
          </Consequence>
        </>
      ),
      fields: [
        {
          id: 'resolution',
          label: 'Resolution',
          required: true,
          textarea: true,
          placeholder:
            'e.g. The tracking link was regenerated and activated. No earlier traffic was re-attributed.',
        },
        {
          id: 'operationalNote',
          label: 'Related operational action',
          placeholder: 'Any action taken outside this case.',
          hint: 'Optional, Admin-only.',
        },
      ],
      primary: 'Mark resolved',
      secondary: 'Back',
    },
    async (values) => {
      await api.resolveCase(detail.header.caseId, {
        resolution: values['resolution'] ?? '',
        operationalNote: values['operationalNote'] || null,
      });
    },
    rest,
  );
}

export function CloseDialog({ detail, ...rest }: Common) {
  return specDialog(
    {
      kicker: detail.header.reference,
      title: 'Close case',
      body: (
        <>
          <p className="helper">Closing keeps the whole case on the record.</p>
          <Consequence>
            Nothing is deleted. Every message, note, and piece of evidence stays readable, and
            the case can be reopened — which records why.
          </Consequence>
        </>
      ),
      fields: [],
      primary: 'Close case',
      secondary: 'Back',
    },
    async () => {
      await api.closeCase(detail.header.caseId);
    },
    rest,
  );
}

export function ReopenDialog({ detail, ...rest }: Common) {
  return specDialog(
    {
      kicker: detail.header.reference,
      title: 'Reopen case',
      body: (
        <>
          <p className="helper">
            Use this when the same issue returns. The existing conversation and resolution stay
            intact.
          </p>
          <Consequence>
            The case returns to Open, waiting on Proovd. No new case is created and no history
            is replaced — the resolution that did not hold is preserved on the reopen record.
          </Consequence>
        </>
      ),
      fields: [
        {
          id: 'reason',
          label: 'Reason',
          required: true,
          textarea: true,
          placeholder: 'Why this case is being reopened.',
        },
      ],
      primary: 'Reopen case',
      secondary: 'Back',
    },
    async (values) => {
      await api.reopenCase(detail.header.caseId, values['reason'] ?? '');
    },
    rest,
  );
}

export function EvidenceDialog({ detail, ...rest }: Common) {
  return specDialog(
    {
      kicker: detail.header.reference,
      title: 'Add evidence',
      body: (
        <>
          <p className="helper">{EVIDENCE_IS_A_REFERENCE}</p>
          <Consequence>
            The evidence is recorded with its type, the record it points at, and who added it.
            It becomes part of the case, and of the §24.11 packet if this ever becomes a
            dispute.
          </Consequence>
        </>
      ),
      fields: [
        {
          id: 'kind',
          label: 'Evidence type',
          select: true,
          required: true,
          value: 'screenshot',
          options: SUPPORT_EVIDENCE_KINDS.map((kind) => ({
            value: kind,
            label: SUPPORT_EVIDENCE_LABELS[kind],
          })),
        },
        {
          id: 'description',
          label: 'Description',
          required: true,
          textarea: true,
          placeholder: 'What this evidence shows.',
        },
        {
          id: 'linkedKind',
          label: 'Kind of linked record',
          select: true,
          value: 'none',
          options: SUPPORT_LINKED_RECORD_KINDS.map((kind) => ({
            value: kind,
            label: SUPPORT_LINKED_RECORD_LABELS[kind],
          })),
        },
        {
          id: 'linkedReference',
          label: 'Linked record',
          placeholder: 'The reference for that record.',
          hint: 'Required once a kind other than “No linked record” is chosen.',
        },
      ],
      primary: 'Add evidence',
      secondary: 'Back',
    },
    async (values) => {
      await api.addEvidence(detail.header.caseId, {
        kind: (values['kind'] ?? 'other') as SupportEvidenceKind,
        description: values['description'] ?? '',
        linkedKind: (values['linkedKind'] ?? 'none') as SupportLinkedRecordKind,
        linkedReference: values['linkedReference'] || null,
      });
    },
    rest,
  );
}

/**
 * Coordination outside the customer thread.
 *
 * The consequence line is the pinned `CONTACT_IS_RECORDED_NOT_SENT`, because
 * the reference's own version claims a message goes out and §27 defines no key
 * for one. §1.4: presenting a manual step truthfully is the whole rule.
 */
export function ContactDialog({ detail, ...rest }: Common) {
  const parties = detail.contactableParties;
  return specDialog(
    {
      kicker: detail.header.reference,
      title: 'Record a contact',
      body: (
        <>
          <p className="helper">
            This case stays the central record. What you asked for and when you expect an
            answer are recorded here.
          </p>
          <Consequence>{CONTACT_IS_RECORDED_NOT_SENT}</Consequence>
        </>
      ),
      fields: [
        {
          id: 'partyKind',
          label: 'Who you contacted',
          select: true,
          required: true,
          value: parties[0]?.kind ?? 'founder',
          options: parties.map((party) => ({
            value: party.kind,
            label: `${party.label} (${party.kind})`,
          })),
        },
        {
          id: 'partyLabel',
          label: 'Their name',
          required: true,
          value: parties[0]?.label ?? '',
        },
        {
          id: 'message',
          label: 'What you asked for',
          required: true,
          textarea: true,
          placeholder: 'What you need from them, and by when.',
        },
        {
          id: 'expectedResponseAt',
          label: 'Expected response by',
          inputType: 'datetime-local',
          hint: 'Optional. A date you check — nothing chases it (§30).',
        },
      ],
      primary: 'Record contact',
      secondary: 'Back',
    },
    async (values) => {
      await api.recordContact(detail.header.caseId, {
        partyKind: (values['partyKind'] ?? 'founder') as (typeof parties)[number]['kind'],
        partyLabel: values['partyLabel'] ?? '',
        message: values['message'] ?? '',
        expectedResponseAt: toIso(values['expectedResponseAt'] ?? ''),
      });
    },
    rest,
  );
}

export function ContactOutcomeDialog({
  detail,
  contact,
  ...rest
}: Common & { contact: SupportContactRow }) {
  return specDialog(
    {
      kicker: detail.header.reference,
      title: `Record what ${contact.partyLabel} said`,
      body: (
        <>
          <p className="helper">
            What came back from the contact you recorded on{' '}
            {new Date(contact.occurredAt).toLocaleDateString()}.
          </p>
          <Consequence>
            Written once. §25.6&rsquo;s posture is that a correction is a new record — if this
            turns out to be wrong, record another contact rather than revising this one.
          </Consequence>
        </>
      ),
      fields: [
        {
          id: 'outcome',
          label: 'Outcome',
          required: true,
          textarea: true,
          placeholder: 'What they said, or that they did not respond.',
        },
      ],
      primary: 'Record outcome',
      secondary: 'Back',
    },
    async (values) => {
      await api.recordContactOutcome(
        detail.header.caseId,
        contact.id,
        values['outcome'] ?? '',
      );
    },
    rest,
  );
}

/* ── Read-only panels ───────────────────────────────────────────────────────*/

/**
 * One section's recorded events.
 *
 * Read-only, and it says so: §26.8 makes the history immutable, and a panel
 * with a confirm button on an immutable record would imply otherwise.
 */
export function SectionHistoryDialog({
  section,
  label,
  entries,
  trigger,
  onClose,
}: {
  section: SupportHistoryEntry['section'];
  label: string;
  entries: SupportHistoryEntry[];
  trigger: HTMLElement | null;
  onClose: () => void;
}) {
  const shown = entries.filter((entry) => entry.section === section);
  return (
    <DialogShell
      kicker="Case history"
      title={`${label} history`}
      description={
        <p className="helper">
          Recorded events for this part of the case. Nothing here is editable or removable.
        </p>
      }
      trigger={trigger}
      onClose={onClose}
    >
      {(close) => (
        <>
          {shown.length === 0 ? (
            <p className="grey">Nothing has been recorded for this section yet.</p>
          ) : (
            <ol className="sup-timeline">
              {shown.map((entry, index) => (
                <li key={`${entry.occurredAt}-${index}`}>
                  <time dateTime={entry.occurredAt}>{formatInstant(entry.occurredAt)}</time>
                  <div>
                    <b>{entry.title}</b>
                    {entry.detail ? <p>{entry.detail}</p> : null}
                    <p className="helper">
                      {entry.actor ? `${entry.actor} · ` : ''}from {entry.source}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="case-actions">
            <Button tier="tertiary" onClick={close}>
              Close
            </Button>
          </div>
        </>
      )}
    </DialogShell>
  );
}

/* ── Creating a case ────────────────────────────────────────────────────────*/

/**
 * Opening a case by hand, for an issue that reached Proovd off the normal path.
 *
 * It posts to §26.7's own `POST /support/cases`, which mints the quotable
 * reference, computes §27.8's business-day deadline from the committed
 * calendar, and renders Appendix B.8 — so a hand-opened case carries exactly
 * the same promise as one a Backer opened themselves.
 */
export function CreateCaseDialog({
  trigger,
  onClose,
  onDone,
}: {
  trigger: HTMLElement | null;
  onClose: () => void;
  onDone: (caseId: string) => void;
}) {
  return (
    <ConfirmDialog
      spec={{
        kicker: 'Support',
        title: 'Create case',
        body: (
          <>
            <p className="helper">
              Use this when an issue reaches Proovd outside the normal support path.
            </p>
            <Consequence>
              A new case enters the queue with no assigned Admin. It is given a quotable
              reference and a one-business-day response deadline immediately, and the requester
              receives Appendix B.8&rsquo;s acknowledgement — so assign an owner before anyone
              is promised anything more.
            </Consequence>
          </>
        ),
        fields: [
          {
            id: 'subject',
            label: 'Subject',
            required: true,
            placeholder: 'What the problem actually is.',
          },
          {
            id: 'requesterKind',
            label: 'Who reported it',
            select: true,
            required: true,
            value: 'founder',
            options: [
              { value: 'founder', label: 'Founder' },
              { value: 'creator', label: 'Creator' },
            ],
            hint: 'A Backer case is opened from their own pre-order page, which is where their identity is (§5.4).',
          },
          {
            id: 'requesterEmail',
            label: 'Their email',
            required: true,
            inputType: 'email',
          },
          {
            id: 'requesterUserId',
            label: 'Their account id',
            required: true,
            hint: 'An account-holder case names the account it belongs to.',
          },
          {
            id: 'topic',
            label: 'Topic',
            select: true,
            required: true,
            value: 'other',
            options: SUPPORT_TOPIC_OPTIONS,
          },
          {
            id: 'owner',
            label: 'Accountable for the response',
            select: true,
            required: true,
            value: 'proovd_support',
            options: [
              { value: 'proovd_support', label: 'Proovd support' },
              { value: 'founder_coordinated', label: 'Founder, coordinated by Proovd' },
            ],
          },
          {
            id: 'campaignId',
            label: 'Related campaign id',
            hint: 'Optional. Attaching it is what carries the campaign facts onto the case.',
          },
          {
            id: 'message',
            label: 'What they reported',
            required: true,
            textarea: true,
            placeholder: 'In their words where possible.',
          },
        ],
        primary: 'Create case',
        secondary: 'Cancel',
      }}
      trigger={trigger}
      onClose={onClose}
      onSubmit={async (values) => {
        const created = await api.createCase({
          topic: (values['topic'] ?? 'other') as never,
          owner: (values['owner'] ?? 'proovd_support') as never,
          requesterKind: (values['requesterKind'] ?? 'founder') as 'founder' | 'creator',
          requesterEmail: values['requesterEmail'] ?? '',
          requesterUserId: values['requesterUserId'] ?? '',
          ...(values['campaignId'] ? { campaignId: values['campaignId'] } : {}),
          message: values['message'] ?? '',
        });
        // The subject is a separate act because `openSupportCase` is shared with
        // §29.9's Backer path, where there is no subject to give.
        if (values['subject']) {
          await api.setSubject(created.caseId, values['subject']);
        }
        onDone(created.caseId);
      }}
    />
  );
}

/* ── §26.7's ten topics, as select options ─────────────────────────────────*/

/**
 * Derived from the shared register rather than retyped.
 *
 * The list and its labels are §26.7's, and `SUPPORT_TOPIC_LABELS` is the copy
 * the Appendix B.8 acknowledgement renders from — so a hardcoded array here
 * would be a second list that drifts from the one the customer's email uses.
 */
const SUPPORT_TOPIC_OPTIONS = SUPPORT_TOPICS.map((topic) => ({
  value: topic,
  label: SUPPORT_TOPIC_LABELS[topic],
}));
