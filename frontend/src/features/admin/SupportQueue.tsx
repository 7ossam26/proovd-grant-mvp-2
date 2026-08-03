/**
 * Admin — §27.8's daily support queue and the §26.7 case.
 *
 * ── Overdue, not just due ───────────────────────────────────────────────────
 * The phase trap: "The daily queue must show overdue, not just due. An SLA
 * nobody can see breached is an SLA that gets breached." So overdue is its own
 * count at the top, overdue rows sort first and carry a badge, and there is no
 * filter that hides them. A queue you can clear by looking away is not a queue.
 *
 * ── Three clocks, because §27.8 makes three promises ────────────────────────
 * The one-business-day human response, the next promised update, and the
 * 48-hour Founder follow-up. A case can be fine on one and late on another, so
 * each gets its own badge rather than one rolled-up "late".
 *
 * ── The reply box is a draft, never a send button on a template ─────────────
 * §26.8 asks for editable templates that preserve context. Loading one fills the
 * textarea and shows which facts came from the record; sending is a separate
 * deliberate act on text the Admin actually composed. A one-click send would
 * answer a person with a machine (§1.4).
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { SUPPORT_TOPIC_LABELS, SUPPORT_OWNER_LABELS, HANDOFF_NOTE_PROMPTS } from '@proovd/shared';
import { Button, Card, Field, Input, Tag, Textarea } from '../../components/index.js';
import {
  fetchSupportQueue,
  fetchCase,
  fetchTemplateDraft,
  addCaseMessage,
  transferCase,
  AdminRequestError,
  type SupportQueueState,
  type CaseDetailState,
} from './api.js';

const when = (iso: string | null) => (iso ? `${iso.replace('T', ' ').slice(0, 16)} UTC` : '—');
const label = (topic: string) =>
  SUPPORT_TOPIC_LABELS[topic as keyof typeof SUPPORT_TOPIC_LABELS] ?? topic;

export function SupportQueuePage() {
  const [params, setParams] = useSearchParams();
  const openCaseId = params.get('case') ?? '';

  const [queue, setQueue] = useState<
    { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: SupportQueueState }
  >({ status: 'loading' });

  const loadQueue = useCallback(async () => {
    setQueue({ status: 'loading' });
    try {
      setQueue({ status: 'ready', data: await fetchSupportQueue() });
    } catch (error) {
      setQueue({
        status: 'error',
        message:
          error instanceof AdminRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'The queue could not be read.',
      });
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  return (
    <section className="admin-workspace">
      <header className="ops-block">
        <h1>Support queue</h1>
        <p className="field-hint">
          Responses and promises due today, and everything already late. §27.8 commits Proovd to one
          business day, Monday–Friday, excluding U.S. federal holidays.
        </p>
      </header>

      {queue.status === 'loading' && <Card>Reading the queue…</Card>}

      {queue.status === 'error' && (
        <Card>
          <h2>The queue could not be read</h2>
          <p>{queue.message}</p>
          <p className="field-hint">Nothing was changed.</p>
        </Card>
      )}

      {queue.status === 'ready' && (
        <>
          <Card>
            <div className="ops-stats">
              <div>
                <span className="ops-stat__label">Due</span>
                <strong className="ops-stat__value">{queue.data.dueCount}</strong>
              </div>
              <div>
                <span className="ops-stat__label">Overdue</span>
                <strong className="ops-stat__value">{queue.data.overdueCount}</strong>
              </div>
            </div>
            <p className="field-hint">
              An overdue case stays in this queue until it is answered. There is no way to hide one.
            </p>
          </Card>

          {queue.data.entries.length === 0 ? (
            <Card>
              <h2>Nothing due</h2>
              <p>No response or promise is due in the next day, and nothing is overdue.</p>
            </Card>
          ) : (
            <Card>
              <div className="admin-table-scroll">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Case</th>
                      <th scope="col">Topic</th>
                      <th scope="col">Owner</th>
                      <th scope="col">Response due</th>
                      <th scope="col">Next promise</th>
                      <th scope="col">Founder follow-up</th>
                      <th scope="col">Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.data.entries.map((entry) => (
                      <tr key={entry.caseId}>
                        <td>
                          <code>{entry.reference}</code>
                        </td>
                        <td>{label(entry.topic)}</td>
                        <td>
                          {SUPPORT_OWNER_LABELS[entry.owner as keyof typeof SUPPORT_OWNER_LABELS] ??
                            entry.owner}
                        </td>
                        <td>
                          {when(entry.humanResponseDueAt)}{' '}
                          {entry.responseOverdue && <Tag variant="live">Overdue</Tag>}
                        </td>
                        <td>
                          {when(entry.nextPromisedUpdateAt)}{' '}
                          {entry.promiseOverdue && <Tag variant="live">Overdue</Tag>}
                        </td>
                        <td>
                          {when(entry.founderFollowupDueAt)}{' '}
                          {entry.founderFollowupOverdue && <Tag variant="live">Overdue</Tag>}
                        </td>
                        <td>
                          <Button
                            tier="tertiary"
                            small
                            onClick={() => setParams({ case: entry.caseId })}
                          >
                            Open
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {openCaseId && <CasePanel caseId={openCaseId} onChanged={() => void loadQueue()} />}
    </section>
  );
}

function CasePanel({ caseId, onChanged }: { caseId: string; onChanged: () => void }) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: CaseDetailState }
  >({ status: 'loading' });

  const [draft, setDraft] = useState('');
  const [templateKey, setTemplateKey] = useState('');
  const [preserved, setPreserved] = useState<Record<string, string>>({});
  const [customerFacing, setCustomerFacing] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', data: await fetchCase(caseId) });
    } catch (error) {
      setState({
        status: 'error',
        message:
          error instanceof AdminRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'That case could not be read.',
      });
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === 'loading') return <Card>Reading the case…</Card>;
  if (state.status === 'error')
    return (
      <Card>
        <h2>That case could not be read</h2>
        <p>{state.message}</p>
      </Card>
    );

  const c = state.data;

  const loadTemplate = async (key: string) => {
    setNotice(null);
    try {
      const rendered = await fetchTemplateDraft(caseId, key);
      setDraft(rendered.draft);
      setTemplateKey(key);
      setPreserved(rendered.preservedFacts);
    } catch {
      setNotice('That template could not be loaded.');
    }
  };

  const send = async () => {
    setNotice(null);
    try {
      await addCaseMessage(caseId, {
        direction: 'outbound',
        customerFacing,
        body: draft,
        ...(templateKey ? { templateKey } : {}),
      });
      setDraft('');
      setTemplateKey('');
      setPreserved({});
      await load();
      onChanged();
    } catch (error) {
      setNotice(
        error instanceof AdminRequestError
          ? (error.detail.whatHappened ?? error.detail.title)
          : 'That message was not added.',
      );
    }
  };

  return (
    <>
      <Card>
        <div className="ops-head">
          <h2>
            Case <code>{c.reference}</code>
          </h2>
          <div className="ops-tags">
            <Tag>{label(c.topic)}</Tag>
            <Tag>{SUPPORT_OWNER_LABELS[c.owner as keyof typeof SUPPORT_OWNER_LABELS] ?? c.owner}</Tag>
            <Tag variant={c.status === 'resolved' ? 'mint' : 'sage'}>{c.status}</Tag>
          </div>
        </div>

        {/* §26.8: every fact the system already holds, so nobody is asked to
            repeat it and nobody retypes an amount into a reply. */}
        <dl className="kv">
          <div className="kv__row">
            <dt>Response due</dt>
            <dd>{when(c.humanResponseDueAt)}</dd>
          </div>
          {c.nextPromisedUpdateAt && (
            <div className="kv__row">
              <dt>Next promised update</dt>
              <dd>{when(c.nextPromisedUpdateAt)}</dd>
            </div>
          )}
          {c.founderFollowupDueAt && (
            <div className="kv__row">
              <dt>Founder follow-up due</dt>
              <dd>{when(c.founderFollowupDueAt)}</dd>
            </div>
          )}
          <div className="kv__row">
            <dt>Requester</dt>
            <dd>{c.requesterEmail}</dd>
          </div>
          {c.campaign && (
            <div className="kv__row">
              <dt>Campaign</dt>
              <dd>
                {c.campaign.title ?? c.campaign.id} ({c.campaign.status})
              </dd>
            </div>
          )}
          {c.reservation && (
            <>
              <div className="kv__row">
                <dt>Reward</dt>
                <dd>{c.reservation.rewardTitle ?? '—'}</dd>
              </div>
              <div className="kv__row">
                <dt>Authorized total</dt>
                <dd>
                  {c.reservation.totalAuthorizedCents
                    ? `US$${(Number(c.reservation.totalAuthorizedCents) / 100).toFixed(2)}`
                    : '—'}
                </dd>
              </div>
              <div className="kv__row">
                <dt>Statement descriptor</dt>
                <dd>{c.reservation.statementDescriptor ?? '—'}</dd>
              </div>
            </>
          )}
        </dl>
      </Card>

      <Card>
        <h3>Thread</h3>
        <ul className="ops-thread">
          {c.messages.map((m) => (
            <li key={m.id}>
              <div className="ops-tags">
                <Tag variant={m.direction === 'inbound' ? 'sage' : 'moss'}>{m.direction}</Tag>
                {!m.customerFacing && <Tag>Internal note</Tag>}
                <span className="field-hint">
                  {when(m.occurredAt)} · {m.author}
                </span>
              </div>
              <p className="ops-thread__body">{m.body}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h3>Reply</h3>
        <p className="field-hint">
          Start from a template if one fits, then edit it. Templates are starting points — nothing
          here sends itself.
        </p>

        <div className="claim__actions">
          {c.templates.map((t) => (
            <Button key={t.key} tier="tertiary" small onClick={() => void loadTemplate(t.key)}>
              {t.label}
            </Button>
          ))}
        </div>

        {Object.keys(preserved).length > 0 && (
          <p className="field-hint">
            Facts filled in from the record: {Object.entries(preserved).map(([k, v]) => `${k}=${v}`).join(' · ')}
          </p>
        )}

        <Field label="Message">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={10} />
        </Field>

        <label className="ops-check">
          <input
            type="checkbox"
            checked={customerFacing}
            onChange={(e) => setCustomerFacing(e.target.checked)}
          />{' '}
          The customer reads this
        </label>
        <p className="field-hint">
          Uncheck for an internal note. A provider or fraud code may appear on an internal note and
          never on a message a customer reads (§26.8, §33.9.11) — the server refuses the second.
        </p>

        {notice && (
          <p className="field-error" role="alert">
            {notice}
          </p>
        )}

        <div className="claim__actions">
          <Button disabled={!draft.trim()} onClick={() => void send()}>
            Add to case
          </Button>
        </div>
      </Card>

      <HandoffPanel caseId={caseId} onDone={() => void load()} />

      {c.handoffs.length > 0 && (
        <Card>
          <h3>Handoffs</h3>
          {c.handoffs.map((hf) => (
            <dl className="kv" key={hf.id}>
              <div className="kv__row">
                <dt>Verified facts</dt>
                <dd>{hf.verifiedFacts}</dd>
              </div>
              <div className="kv__row">
                <dt>Owner</dt>
                <dd>{hf.currentOwner}</dd>
              </div>
              <div className="kv__row">
                <dt>Next customer promise</dt>
                <dd>{hf.nextCustomerPromise}</dd>
              </div>
              <div className="kv__row">
                <dt>Keep consistent</dt>
                <dd>{hf.statementsToKeepConsistent}</dd>
              </div>
              <div className="kv__row">
                <dt>Recorded</dt>
                <dd>{when(hf.occurredAt)}</dd>
              </div>
            </dl>
          ))}
        </Card>
      )}
    </>
  );
}

/** §26.8: all four facts, or the case does not move. */
function HandoffPanel({ caseId, onDone }: { caseId: string; onDone: () => void }) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [toOwner, setToOwner] = useState('founder_coordinated');
  const [notice, setNotice] = useState<string | null>(null);

  const set = (k: string) => (v: string) => setFields((c) => ({ ...c, [k]: v }));

  const submit = async () => {
    setNotice(null);
    try {
      await transferCase(caseId, {
        toOwner,
        verifiedFacts: fields['verified_facts'] ?? '',
        currentOwner: fields['current_owner'] ?? '',
        nextCustomerPromise: fields['next_customer_promise'] ?? '',
        statementsToKeepConsistent: fields['statements_to_keep_consistent'] ?? '',
      });
      setFields({});
      setNotice('Handoff recorded and the case has moved.');
      onDone();
    } catch (error) {
      setNotice(
        error instanceof AdminRequestError
          ? (error.detail.whatHappened ?? error.detail.title)
          : 'The case did not move.',
      );
    }
  };

  return (
    <Card>
      <h3>Change owner</h3>
      <p className="field-hint">
        §26.8 requires a handoff note before the case can move. All four, or it stays where it is —
        the missing one is usually what stops the new owner contradicting what was already said.
      </p>

      <Field label="New owner">
        <Input value={toOwner} onChange={(e) => setToOwner(e.target.value)} />
      </Field>

      {Object.entries(HANDOFF_NOTE_PROMPTS).map(([key, prompt]) => (
        <Field key={key} label={key.replaceAll('_', ' ')} hint={prompt}>
          <Textarea value={fields[key] ?? ''} onChange={(e) => set(key)(e.target.value)} rows={3} />
        </Field>
      ))}

      {notice && <p className="field-hint">{notice}</p>}

      <div className="claim__actions">
        <Button tier="secondary" onClick={() => void submit()}>
          Record handoff and move the case
        </Button>
      </div>
    </Card>
  );
}
