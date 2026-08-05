/**
 * The §27.6 internal queue notices — Spec §27.6, §26.8 (Phase 22b).
 *
 * Five moments that put work in front of an Admin, and until now the only thing
 * that said so was a queue somebody had to think to open:
 *
 *   internal_invitation_claimed          a new account exists (§10, §11)
 *   internal_interview_changed           a booking moved or was cancelled (§12)
 *   internal_proposal_awaiting_response  someone owes an answer inside the
 *                                        72-hour §14.6 window
 *   internal_post_verification_due       a first post is waiting on a decision
 *                                        whose three outcomes pause a Creator
 *   internal_support_sla_breach          §27.8's published promise has lapsed
 *
 * ── Internal, so §3.1 does not bind and §3.2 still does ────────────────────
 * `renderInternalNotice` is the right template for all five: an Admin notice
 * naming `reservation` is naming the table they are about to open, which §3.1
 * scopes to customer-facing copy. §3.2's honesty vocabulary binds regardless,
 * because an internal habit of writing `escrow` is exactly how it leaks.
 *
 * ── Every one is deduped on the record that recurs ────────────────────────
 * A claim happens once per draft/association; an interview change is one
 * booking-event row; a counter-proposal is a NEW version and a genuinely new
 * "someone owes an answer"; a resubmitted post is a new submission row; and an
 * SLA breach keys on the deadline instant, because a case has three clocks and
 * the promised-update one legitimately moves forward.
 */

import type { Database } from '../db/client.js';
import type { Notifier } from './send.js';
import {
  INTERNAL_INVITATION_CLAIMED,
  type NotificationEventKey,
} from './events.js';
import { renderInternalNotice, type NoticeFact } from './templates/plain.js';

export interface OperationalNotifyDeps {
  db: Database;
  notifier?: Notifier | undefined;
  context?: { appBaseUrl: string; supportEmail: string; fromAddress: string } | undefined;
  /** §27.6's staffed inbox. Unset → none of these send. */
  internalRecipient?: string | undefined;
}

async function notifyInternal(
  deps: OperationalNotifyDeps,
  input: {
    eventKey: NotificationEventKey;
    entityType: string;
    entityId: string;
    subject: string;
    headline: string;
    facts: NoticeFact[];
    paragraphs?: string[];
    action: { label: string; url: string };
    reference: string;
  },
): Promise<void> {
  if (!deps.notifier || !deps.context || !deps.internalRecipient) return;
  const notice = await renderInternalNotice({
    subject: input.subject,
    headline: input.headline,
    facts: input.facts,
    ...(input.paragraphs ? { paragraphs: input.paragraphs } : {}),
    action: input.action,
    reference: input.reference,
    supportEmail: deps.context.supportEmail,
  });
  await deps.notifier.send({
    eventKey: input.eventKey,
    entityType: input.entityType,
    entityId: input.entityId,
    to: deps.internalRecipient,
    from: deps.context.fromAddress,
    ...notice,
  });
}

/** §27.6 "Invitation claimed / new account". Both roles, one key, two entities. */
export async function notifyInvitationClaimed(
  deps: OperationalNotifyDeps,
  input: {
    role: 'founder' | 'creator';
    /** The draft (Founder) or the association (Creator) — one claim each. */
    entityId: string;
    entityType: 'campaign_draft' | 'affiliate_association';
    displayName: string;
  },
): Promise<void> {
  await notifyInternal(deps, {
    eventKey: INTERNAL_INVITATION_CLAIMED,
    entityType: input.entityType,
    // Two entity TYPES under one key so a draft id and an association id can
    // never collide, even in the unlikely event the uuids matched.
    entityId: input.entityId,
    subject: `New ${input.role === 'founder' ? 'Founder' : 'Creator'} account — ${input.displayName}`,
    headline: `A ${input.role === 'founder' ? 'Founder' : 'Creator'} claimed their invitation`,
    facts: [
      { label: 'Who', value: input.displayName },
      { label: 'Role', value: input.role === 'founder' ? 'Founder' : 'Creator' },
      { label: 'Record', value: input.entityId },
    ],
    paragraphs: [
      'The claim is idempotent and already recorded. Nothing here needs doing unless the account looks wrong.',
    ],
    action: {
      label: 'Open the admin surface',
      url: `${deps.context?.appBaseUrl ?? ''}/admin/${input.role === 'founder' ? 'founders' : 'creators'}`,
    },
    reference: input.entityId,
  });
}
