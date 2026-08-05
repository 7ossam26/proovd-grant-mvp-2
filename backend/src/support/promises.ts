/**
 * §27.8's promises, kept — Spec §27.8, §27.6, §26.7 (Phase 22b).
 *
 * 16b computed and stored all three of §27.8's clocks and 16a's queue showed
 * them, but nothing ran on a schedule, so the two messages §27 names for them
 * had no sender: §27.6's "support SLA breach" and §27.5's follow-up at the
 * promised checkpoint. `readSupportQueue` already derives every breach; this is
 * the tick that reads it and sends.
 *
 * ── "Even without resolution, send an update at the promised checkpoint" ────
 * §27.8's own sentence, and it is the one that needed a job rather than a call
 * site: the promise is made when an Admin replies and comes due hours or days
 * later, with nothing happening in between. That is precisely the shape a
 * sweep exists for, and precisely NOT the shape §33.6.11 forbids — the message
 * is owed because a person promised it, not because a timer elapsed.
 *
 * ── The dedup entities are different, and both are the promise ──────────────
 * A case has three clocks and they move independently. §27.6's breach notice
 * keys on `(case, clock, the deadline instant that lapsed)`, so a case that
 * breaches its response deadline and later breaches a promised update produces
 * two notices, while a sweep running hourly against one unmoved deadline
 * produces one. §27.5's follow-up keys on the promised INSTANT alone: a second
 * promise is a second commitment and is owed its own update, and re-running the
 * tick against the same promise is not.
 *
 * ── A follow-up that says nothing is still owed ─────────────────────────────
 * §27.8 asks for an update at the checkpoint, not a resolution, and the honest
 * message when there is no news is that there is no news. The alternative —
 * staying quiet until there is something to say — is what the sentence exists
 * to forbid, because the person waiting cannot tell silence from being
 * forgotten (§27.1's six questions).
 */

import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { supportCases } from '../db/schema/support.js';
import type { Notifier } from '../notifications/send.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import {
  BACKER_SUPPORT_FOLLOWUP,
  INTERNAL_SUPPORT_SLA_BREACH,
} from '../notifications/events.js';
import { renderPlainNotice, renderInternalNotice } from '../notifications/templates/plain.js';
import { SUPPORT_TOPIC_LABELS, SUPPORT_OWNER_LABELS } from './logic.js';
import { readSupportQueue, type QueueEntry } from './cases.js';

export interface SupportPromiseDeps {
  db: Database;
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
  /** §27.6's inbox. Without it the breach notice has nowhere to go. */
  internalRecipient?: string | undefined;
}

/** The three §27.8 clocks, named so the dedup entity can say which lapsed. */
export type SupportClock = 'human_response' | 'promised_update' | 'founder_followup';

const CLOCK_LABELS: Record<SupportClock, string> = {
  human_response: 'Human response',
  promised_update: 'Promised update',
  founder_followup: 'Founder follow-up',
};

/*
 * The queue types these as `string` because they come back from the database.
 * §3.1 is why the fallback is the stored value rather than a guess: an
 * unrecognised topic reaching a customer surface is an internal name leaking,
 * and it is better to see it than to have it silently relabelled.
 */
function topicLabel(topic: string): string {
  return (SUPPORT_TOPIC_LABELS as Record<string, string>)[topic] ?? topic;
}

function ownerLabel(owner: string): string {
  return (SUPPORT_OWNER_LABELS as Record<string, string>)[owner] ?? owner;
}

/**
 * Renders a deadline for a person rather than a machine.
 *
 * §27.1: "deadline emails spell out timezone." `toISOString()` renders `Z`,
 * which is canonical and spells nothing out to someone reading it at 22:00 in
 * Denver — 22a's coverage suite refuses a bare ISO instant for exactly this.
 */
function utcDeadline(instant: Date): string {
  return `${instant.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

/* ── §27.6: the breach ────────────────────────────────────────────────────── */

/**
 * Which of a case's clocks have lapsed, with the instant each lapsed at.
 *
 * Reads the queue's own derivations rather than recomputing them: 16b's queue
 * is what an Admin looks at, and a notice that disagreed with the screen would
 * be worse than no notice.
 */
export function breachedClocks(entry: QueueEntry): Array<{ clock: SupportClock; at: string }> {
  const breaches: Array<{ clock: SupportClock; at: string }> = [];
  if (entry.responseOverdue) {
    breaches.push({ clock: 'human_response', at: entry.humanResponseDueAt });
  }
  if (entry.promiseOverdue && entry.nextPromisedUpdateAt) {
    breaches.push({ clock: 'promised_update', at: entry.nextPromisedUpdateAt });
  }
  if (entry.founderFollowupOverdue && entry.founderFollowupDueAt) {
    breaches.push({ clock: 'founder_followup', at: entry.founderFollowupDueAt });
  }
  return breaches;
}

async function notifyBreach(
  deps: SupportPromiseDeps,
  entry: QueueEntry,
  breach: { clock: SupportClock; at: string },
): Promise<boolean> {
  if (!deps.notifier || !deps.context || !deps.internalRecipient) return false;

  const notice = await renderInternalNotice({
    subject: `Support SLA breached — ${entry.reference} (${CLOCK_LABELS[breach.clock]})`,
    headline: `${CLOCK_LABELS[breach.clock]} is past due on ${entry.reference}.`,
    facts: [
      { label: 'Case', value: entry.reference },
      { label: 'Topic', value: topicLabel(entry.topic) },
      { label: 'Owner', value: ownerLabel(entry.owner) },
      { label: 'Clock', value: CLOCK_LABELS[breach.clock] },
      { label: 'Was due', value: utcDeadline(new Date(breach.at)) },
      { label: 'Case status', value: entry.status },
    ],
    paragraphs: [
      '§27.8 publishes this promise, so a breach is a commitment the product has already made and not kept. The queue has the full context.',
    ],
    action: { label: 'Open the support queue', url: `${deps.context.appBaseUrl}/admin/support` },
    reference: entry.reference,
    supportEmail: deps.context.supportEmail,
  });

  const outcome = await deps.notifier.send({
    eventKey: INTERNAL_SUPPORT_SLA_BREACH,
    entityType: 'support_case_clock',
    // (case, clock, the instant that lapsed). A deadline that has not moved
    // breaches once however often the sweep runs; a NEW promise that lapses is
    // a new failure and is owed its own notice.
    entityId: `${entry.caseId}:${breach.clock}:${breach.at}`,
    to: deps.internalRecipient,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
  return outcome.status === 'sent';
}

/* ── §27.8: the promised checkpoint ───────────────────────────────────────── */

/**
 * `delivered` covers both a fresh send and a dedup hit: either way the person
 * has the update, which is what decides whether the promise is discharged.
 */
type FollowupOutcome = 'delivered' | 'sent' | 'not_sent';

async function notifyFollowup(
  deps: SupportPromiseDeps,
  entry: QueueEntry,
): Promise<FollowupOutcome> {
  if (!deps.notifier || !deps.context) return 'not_sent';
  if (!entry.nextPromisedUpdateAt) return 'not_sent';

  const notice = await renderPlainNotice({
    subject: `An update on your support request — ${entry.reference}`,
    headline: 'We said we would check in today, so we are.',
    facts: [
      { label: 'Your case', value: entry.reference },
      { label: 'What it is about', value: topicLabel(entry.topic) },
      { label: 'Who owns it', value: ownerLabel(entry.owner) },
      { label: 'Where it stands', value: 'Still open — we have not closed it' },
      {
        label: 'What you can do now',
        value: 'Reply to this email with anything new. You do not need to repeat what you already told us.',
      },
    ],
    paragraphs: [
      // §27.8's own sentence, honoured literally. Saying "no news" is the
      // point: silence and being forgotten look identical from the outside.
      'We promised you an update by now and we do not have a resolution yet. Your case is still open and still owned by a person, and nothing you sent has been lost.',
    ],
    reference: entry.reference,
    supportEmail: deps.context.supportEmail,
  });

  const outcome = await deps.notifier.send({
    eventKey: BACKER_SUPPORT_FOLLOWUP,
    entityType: 'support_case_promise',
    // The promised INSTANT. A case that gets a second promise gets a second
    // follow-up; a sweep re-running against the same promise sends nothing.
    entityId: `${entry.caseId}:${entry.nextPromisedUpdateAt}`,
    to: entry.requesterEmail,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });

  if (outcome.status === 'sent') return 'sent';
  if (outcome.status === 'duplicate') return 'delivered';
  // A provider refusal leaves the claim unconfirmed and the promise standing —
  // the next tick retries under the same entity. Discharging it here would
  // drop a commitment on the strength of a failed send.
  return 'not_sent';
}

/* ── The tick ─────────────────────────────────────────────────────────────── */

export interface SupportPromiseResult {
  considered: number;
  breachesNotified: number;
  followupsSent: number;
}

/**
 * Every open case whose promise has lapsed, told to the person who owns it and
 * the person waiting on it.
 *
 * Safe to run twice: both messages dedup on the deadline instant, so a second
 * pass over unmoved clocks sends nothing.
 */
export async function sweepSupportPromises(
  deps: SupportPromiseDeps,
  now: Date = new Date(),
): Promise<SupportPromiseResult> {
  // horizonHours: 0 — only what has actually lapsed. The queue's default
  // horizon shows an Admin what is *coming*, which is right for a screen and
  // wrong for a message: emailing a breach before it happens is the pressure
  // §30 forbids, wearing an operational hat.
  const queue = await readSupportQueue(deps.db, { now, horizonHours: 0 });

  const result: SupportPromiseResult = {
    considered: queue.entries.length,
    breachesNotified: 0,
    followupsSent: 0,
  };

  for (const entry of queue.entries) {
    for (const breach of breachedClocks(entry)) {
      if (await notifyBreach(deps, entry, breach)) result.breachesNotified += 1;
    }

    // The follow-up is owed at the promised checkpoint, whether or not anyone
    // has replied — that is what makes it a promise rather than a queue item.
    if (!entry.promiseOverdue) continue;

    const followup = await notifyFollowup(deps, entry);
    if (followup === 'sent') result.followupsSent += 1;
    if (followup === 'not_sent') continue;

    /*
     * The promise is discharged only once the update is actually out, and the
     * next Admin reply sets the next one. Clearing unconditionally would be the
     * quiet failure: with no notifier configured nothing sends, and the queue
     * would stop showing a promise nobody kept. Leaving it set instead keeps
     * the Admin badge honest and lets the next tick retry — the send dedups on
     * the instant, so a retry costs nothing.
     *
     * Conditional on the instant, so a reply that made a NEW promise between
     * the read and this write is not erased by a stale one.
     */
    await deps.db
      .update(supportCases)
      .set({ nextPromisedUpdateAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(supportCases.id, entry.caseId),
          eq(supportCases.nextPromisedUpdateAt, new Date(entry.nextPromisedUpdateAt!)),
        ),
      );
  }

  return result;
}
