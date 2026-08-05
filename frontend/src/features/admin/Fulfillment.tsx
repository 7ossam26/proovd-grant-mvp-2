/**
 * Admin fulfillment operations — Spec §22.4, §22.7, §26 (Phase 21a).
 *
 * Two queues on one page because they are the same conversation at two stages:
 * the Day 14 Progress Check, and the small number of campaigns whose stored
 * facts meet a §22.7 ban trigger.
 *
 * ── Overdue leads ──────────────────────────────────────────────────────────
 * 16b's rule: a deadline nobody can see breached is a deadline that gets
 * breached. The server sorts overdue first and this renders that order.
 *
 * ── The ban form cannot invent a trigger ───────────────────────────────────
 * The trigger control offers only triggers the server reported as MET for that
 * campaign, and the server refuses anything else by name regardless — the
 * control is a convenience, not the guarantee (§33.10.4). §22.7's five recorded
 * facts are five separate required fields, and the permanence sentence is
 * rendered from the server's own constant so the Admin reads what the Founder
 * will be told.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Button, Field, Section, Tag, Textarea } from '../../components/index.js';
import {
  fetchDay14Queue,
  fetchGhostBanCandidates,
  decideDay14,
  requestDay14Clarification,
  recordGhostBan,
  AdminRequestError,
  type Day14QueueState,
  type GhostBanQueueState,
} from './api.js';

function utcDay(iso: string | null): string {
  if (!iso) return '—';
  return `${iso.slice(0, 10)} (UTC)`;
}

export function AdminFulfillmentPage() {
  const [day14, setDay14] = useState<Day14QueueState | null>(null);
  const [bans, setBans] = useState<GhostBanQueueState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openDecision, setOpenDecision] = useState<string | null>(null);
  const [openBan, setOpenBan] = useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      const [queue, candidates] = await Promise.all([
        fetchDay14Queue(),
        fetchGhostBanCandidates(),
      ]);
      setDay14(queue);
      setBans(candidates);
    } catch (caught) {
      setMessage(
        caught instanceof AdminRequestError
          ? (caught.detail.whatHappened ?? 'These queues could not be loaded.')
          : 'These queues could not be loaded, so nothing shown here is current.',
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function run(work: () => Promise<unknown>, done: string): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      setMessage(done);
      setOpenDecision(null);
      setOpenBan(null);
      await load();
    } catch (caught) {
      setMessage(
        caught instanceof AdminRequestError
          ? (caught.detail.whatHappened ?? 'That did not complete, so nothing was changed.')
          : 'That did not complete, so nothing was changed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-page">
      <header>
        <h1 className="text-display">Fulfillment</h1>
        <p className="text-body">
          The Day 14 Progress Check for every campaign that captured a charge, and the campaigns
          whose records meet a §22.7 ban trigger.
        </p>
      </header>

      {message ? <p className="text-body">{message}</p> : null}

      {/* ── The Day 14 queue ────────────────────────────────────────────── */}
      <Section title="Day 14 Progress Check">
        {!day14 ? (
          <p className="text-body">Loading…</p>
        ) : day14.queue.length === 0 ? (
          <p className="text-body">No Day 14 review is open.</p>
        ) : (
          <ul className="stack">
            {day14.queue.map((row) => (
              <li key={row.reviewId} className="stack__row">
                <div>
                  <p className="text-body">
                    <Tag variant={row.overdue ? 'live' : 'sage'}>
                      {row.overdue ? 'Overdue' : 'Due'}
                    </Tag>{' '}
                    {row.campaignTitle ?? row.campaignId}
                  </p>
                  <p className="text-caption">
                    {row.campaignType === 'pre_launch'
                      ? 'Product Campaign — a failure blocks the unreleased remaining payment.'
                      : 'Idea Campaign — enforcement only; there is no unreleased payment to block.'}
                  </p>
                  <p className="text-caption">
                    Decision due {utcDay(row.dueAt)} · {row.submissionCount} evidence submission(s)
                    {row.latestSubmissionAt ? `, latest ${utcDay(row.latestSubmissionAt)}` : ''}
                  </p>
                  <p className="text-caption">
                    {row.daysSinceLastUpdate === null
                      ? 'No update has ever been posted.'
                      : `Last update ${row.daysSinceLastUpdate} day(s) ago.`}
                    {row.noSubstantiveUpdateInSevenDays
                      ? ' No substantive update in the prior seven days.'
                      : ''}
                    {row.overdueClarifications > 0
                      ? ` ${row.overdueClarifications} clarification(s) past their five-business-day window.`
                      : ''}
                  </p>

                  <Button
                    tier="secondary"
                    onClick={() =>
                      setOpenDecision(openDecision === row.campaignId ? null : row.campaignId)
                    }
                  >
                    {openDecision === row.campaignId ? 'Close' : 'Record the decision'}
                  </Button>

                  {openDecision === row.campaignId ? (
                    <>
                      <form
                        className="stack"
                        onSubmit={(event: FormEvent<HTMLFormElement>) => {
                          event.preventDefault();
                          const form = new FormData(event.currentTarget);
                          const outcome = String(form.get('outcome')) as 'pass' | 'fail';
                          void run(
                            () =>
                              decideDay14(row.campaignId, {
                                outcome,
                                adequateProgressEvidence: form.get('progress') === 'on',
                                requiredCommunication: form.get('communication') === 'on',
                                failureReasons: day14.failureReasons
                                  .map((r) => r.key)
                                  .filter((key) => form.get(`reason:${key}`) === 'on'),
                                internalReason: String(form.get('internalReason') ?? ''),
                                customerExplanation: String(form.get('customerExplanation') ?? ''),
                              }),
                            'Decision recorded and the Founder has been told.',
                          );
                        }}
                      >
                        <Field label="Outcome">
                          <select name="outcome" required className="input" defaultValue="">
                            <option value="" disabled>
                              Choose
                            </option>
                            <option value="pass">Pass</option>
                            <option value="fail">Fail</option>
                          </select>
                        </Field>
                        {/* §22.4's pass condition, as two separate findings. A
                            pass with either false is refused by the server. */}
                        <label className="text-body">
                          <input type="checkbox" name="progress" /> Adequate progress or delivery
                          evidence
                        </label>
                        <label className="text-body">
                          <input type="checkbox" name="communication" /> Required communication
                        </label>

                        <fieldset>
                          <legend className="text-caption">
                            Failure reasons — a failure names at least one
                          </legend>
                          {day14.failureReasons.map((reason) => (
                            <label key={reason.key} className="text-body">
                              <input type="checkbox" name={`reason:${reason.key}`} /> {reason.label}
                            </label>
                          ))}
                        </fieldset>

                        <Field label="Internal reason" hint="Not shown to the Founder (§25.6).">
                          <Textarea name="internalReason" required />
                        </Field>
                        <Field
                          label="What the Founder is told"
                          hint="Name the actual behaviour and evidence. A raw provider or fraud code is refused (§29.4)."
                        >
                          <Textarea name="customerExplanation" required />
                        </Field>
                        <Button type="submit" disabled={busy}>
                          Record decision
                        </Button>
                      </form>

                      <form
                        className="stack"
                        onSubmit={(event: FormEvent<HTMLFormElement>) => {
                          event.preventDefault();
                          const form = new FormData(event.currentTarget);
                          void run(
                            () =>
                              requestDay14Clarification(
                                row.campaignId,
                                String(form.get('question') ?? ''),
                              ),
                            'Clarification requested. The Founder has five business days.',
                          );
                        }}
                      >
                        <Field
                          label="Ask the Founder something first"
                          hint="Five business days on the committed calendar. Not answering is one of §22.4's failure reasons."
                        >
                          <Textarea name="question" required />
                        </Field>
                        <Button type="submit" tier="secondary" disabled={busy}>
                          Request clarification
                        </Button>
                      </form>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── The §22.7 ban candidates ────────────────────────────────────── */}
      <Section title="One-strike ghost ban">
        {!bans ? (
          <p className="text-body">Loading…</p>
        ) : (
          <>
            <p className="text-body">{bans.permanentSentence}</p>
            <p className="text-caption">
              Only these four triggers exist:{' '}
              {bans.triggers.map((t) => t.label).join(' · ')}. A campaign appears here only when its
              stored records already meet one, and the server refuses a ban on any trigger that is
              not met.
            </p>

            {bans.candidates.length === 0 ? (
              <p className="text-body">No campaign currently meets a ban trigger.</p>
            ) : (
              <ul className="stack">
                {bans.candidates.map((candidate) => (
                  <li key={candidate.campaignId} className="stack__row">
                    <div>
                      <p className="text-body">
                        {candidate.alreadyBanned ? <Tag variant="live">Already banned</Tag> : null}{' '}
                        {candidate.campaignTitle ?? candidate.campaignId}
                      </p>
                      <ul>
                        {candidate.labels.map((label) => (
                          <li key={label} className="text-caption">
                            {label}
                          </li>
                        ))}
                      </ul>

                      {candidate.alreadyBanned ? null : (
                        <>
                          <Button
                            tier="secondary"
                            onClick={() =>
                              setOpenBan(openBan === candidate.campaignId ? null : candidate.campaignId)
                            }
                          >
                            {openBan === candidate.campaignId ? 'Close' : 'Record a permanent ban'}
                          </Button>

                          {openBan === candidate.campaignId ? (
                            <form
                              className="stack"
                              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                                event.preventDefault();
                                const form = new FormData(event.currentTarget);
                                void run(
                                  () =>
                                    recordGhostBan(candidate.campaignId, {
                                      trigger: String(form.get('trigger') ?? ''),
                                      evidence: String(form.get('evidence') ?? ''),
                                      notice: String(form.get('notice') ?? ''),
                                      paymentRecoveryStatus: String(
                                        form.get('paymentRecoveryStatus') ?? '',
                                      ),
                                      enforcementDecision: String(
                                        form.get('enforcementDecision') ?? '',
                                      ),
                                      internalReason: String(form.get('internalReason') ?? ''),
                                    }),
                                  'The permanent ban is recorded. It cannot be lifted.',
                                );
                              }}
                            >
                              <Field label="Trigger" hint="Only a trigger this campaign already meets.">
                                <select name="trigger" required className="input" defaultValue="">
                                  <option value="" disabled>
                                    Choose
                                  </option>
                                  {candidate.triggersMet.map((key) => (
                                    <option key={key} value={key}>
                                      {bans.triggers.find((t) => t.key === key)?.label ?? key}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              {/* §22.7's five recorded facts, each its own field. */}
                              <Field label="Evidence">
                                <Textarea name="evidence" required />
                              </Field>
                              <Field
                                label="Notice given to the Founder"
                                hint="Names the actual behaviour and evidence. A raw provider or fraud code is refused (§29.4)."
                              >
                                <Textarea name="notice" required />
                              </Field>
                              <Field label="Payment and recovery status">
                                <Textarea name="paymentRecoveryStatus" required />
                              </Field>
                              <Field label="Enforcement decision">
                                <Textarea name="enforcementDecision" required />
                              </Field>
                              <Field label="Internal reason" hint="Not shown to the Founder (§25.6).">
                                <Textarea name="internalReason" required />
                              </Field>
                              <Button type="submit" disabled={busy}>
                                Record permanent ban
                              </Button>
                            </form>
                          ) : null}
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
