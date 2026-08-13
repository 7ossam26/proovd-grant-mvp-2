/**
 * The Conversation tab — §26.8, §33.9.11.
 *
 * The thread on the left, the requester's context on the right.
 *
 * ── An internal note is visibly not a message ───────────────────────────────
 * §33.9.11 is a rule about what may be in a note versus a reply, and a thread
 * that rendered the two alike is one where an Admin reads a note aloud on a
 * call believing it was sent. So a note carries its own treatment AND the
 * sentence saying what it is — colour is never the only signal (§33.11).
 *
 * ── The context panel is the promise §26.8 makes ────────────────────────────
 * "Users are never asked to repeat already-known campaign / pre-order / charge
 * facts." Everything in it is read from a record the case already points at,
 * shaped by the server for the requester it belongs to — which is an
 * authorization question (§11 keeps a Founder from seeing a Creator's contact
 * details), not a rendering one.
 *
 * ── On a narrow viewport the context goes BELOW the thread ──────────────────
 * Not behind a toggle: it is the facts an Admin answers from, and putting them
 * one gesture away on the smallest screen is where a reply gets written from
 * memory. The order is thread-then-context because the message is what they
 * came to read (§33.11, DNA §5.14).
 */

import { Button } from '../../../../components/index.js';
import { cn } from '../../../../components/cn.js';
import { CaseSection, RecordLink, formatInstant } from '../shared.js';
import { useDialogTrigger, type PaneProps } from '../SupportCase.js';
import { ContactDialog, NoteDialog, ReplyDialog } from '../dialogs/index.js';

export function Conversation({ detail, onChanged }: PaneProps) {
  const reply = useDialogTrigger();
  const note = useDialogTrigger();
  const contact = useDialogTrigger();

  const closed = Boolean(detail.nextResponse.closedAt);

  return (
    <div className="sup-split">
      <div className="sup-split__main">
        <CaseSection
          title="Conversation"
          lede="Customer messages and Admin replies in order. Internal notes are interleaved for context and are never sent."
          actions={
            <>
              {/*
                A closed case offers no reply. Reopening is the recorded act that
                makes one possible — §26.8 keeps the record intact, and a reply
                on a closed case would extend a conversation nobody reopened.
              */}
              {!closed ? (
                <Button tier="primary" onClick={reply.open}>
                  Reply to {detail.header.requesterName}
                </Button>
              ) : null}
              <Button tier="secondary" onClick={note.open}>
                Add internal note
              </Button>
              {detail.contactableParties.length > 0 ? (
                <Button tier="tertiary" onClick={contact.open}>
                  Record a contact
                </Button>
              ) : null}
            </>
          }
        >
          <ol className="sup-thread">
            {detail.thread.map((message) => (
              <li
                key={message.id}
                className={cn('sup-msg', message.kind === 'note' && 'sup-msg--note')}
              >
                <div className="sup-msg__head">
                  {message.kind === 'note' ? (
                    <span className="sup-internal-tag">
                      Internal · not shown to the customer
                    </span>
                  ) : null}
                  <b>{message.author}</b>
                  {message.counterparty ? (
                    <span className="grey">→ {message.counterparty}</span>
                  ) : null}
                  <time dateTime={message.occurredAt} className="grey">
                    {formatInstant(message.occurredAt)}
                  </time>
                </div>
                {/*
                  `pre-wrap`, because a reply is written with paragraphs and
                  collapsing them turns a considered message into a wall.
                */}
                <p className="sup-msg__body">{message.body}</p>
                {message.delivery || message.templateKey ? (
                  <p className="sup-msg__meta">
                    {message.delivery}
                    {message.delivery && message.templateKey ? ' · ' : ''}
                    {message.templateKey ? `started from the ${message.templateKey} template` : ''}
                    {message.kind === 'out' ? ' · a sent message cannot be edited' : ''}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>

          {detail.thread.length === 0 ? (
            <p className="grey">
              Nothing has been recorded on this case yet — not even the message that opened it.
            </p>
          ) : null}
        </CaseSection>
      </div>

      <aside className="sup-split__side">
        <CaseSection title={detail.context.heading}>
          <dl className="sup-facts">
            {detail.context.fields.map((field) => (
              <div key={field.label}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>

          {detail.context.links.length > 0 ? (
            <div className="sup-links">
              {detail.context.links.map((link) => (
                <RecordLink key={link.label} link={link} />
              ))}
            </div>
          ) : null}

          {detail.internalReason ? (
            <div className="sup-internal-note">
              <p className="kicker">Internal reason</p>
              <p className="helper">{detail.internalReason}</p>
            </div>
          ) : null}
        </CaseSection>
      </aside>

      {reply.trigger ? (
        <ReplyDialog
          detail={detail}
          trigger={reply.trigger}
          onClose={reply.close}
          onDone={onChanged}
        />
      ) : null}
      {note.trigger ? (
        <NoteDialog
          detail={detail}
          trigger={note.trigger}
          onClose={note.close}
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
    </div>
  );
}
