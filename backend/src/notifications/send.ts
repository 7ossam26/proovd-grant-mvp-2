/**
 * Transactional email — Spec §27.2, §28.3.
 *
 * Every message Proovd sends goes through here, and here is where §27.2's last
 * rule is enforced: "Duplicate webhook/job delivery cannot create duplicate
 * email."
 *
 * ── The dedup key is claimed before the send, not after ─────────────────────
 * `notification_deliveries` is unique on (event, target, entity). This inserts
 * that row FIRST, with `ON CONFLICT DO NOTHING`. If the insert returns nothing,
 * some other attempt already owns this delivery and this one stops without
 * sending. Claiming after the send would leave a window in which two workers
 * both send and then both discover they were duplicates — which is exactly the
 * failure the constraint exists to prevent, moved one line later.
 *
 * The cost of claiming first is the opposite window: a claim that lands and
 * then a send that fails leaves a row with `delivered_at` still NULL. That is
 * not a silent loss — it is the "we tried and it did not confirm" state, it is
 * visible in Admin, and it is honest. A retry is a new send with a new entity
 * id, which is a new key and therefore a real second attempt rather than a
 * duplicate of the first.
 *
 * ── Choosing the entity id ──────────────────────────────────────────────────
 * The caller picks it, and the choice is load-bearing. For a Founder
 * invitation the entity is the *send*, not the draft: §7 requires resend to
 * work, and keying on the draft would make the second invitation a duplicate of
 * the first and silently swallow it. Key on the thing that may legitimately
 * happen twice, at the granularity at which it may happen twice.
 *
 * ── §27.2's other rules, and where they live ────────────────────────────────
 *  - not opt-out-able            → there is no unsubscribe path in this module
 *  - specific subject            → the caller supplies it; the template builds
 *                                  it from the campaign or product name
 *  - at most one primary action  → a template concern, asserted by test
 *  - plain-text support route    → every template ships a `text` part
 *  - stable reference            → `reference`, rendered in both parts
 */

import { eq, and, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { notificationDeliveries } from '../db/schema/integrity.js';
import type { NotificationEventKey } from './events.js';

/** What a transport has to be able to do. Resend is one implementation. */
export interface EmailTransport {
  send(message: OutgoingEmail): Promise<{ providerId: string }>;
}

export interface OutgoingEmail {
  to: string;
  from: string;
  replyTo?: string | undefined;
  subject: string;
  html: string;
  /** §27.2: a plain-text part carrying the support route and the reference. */
  text: string;
}

export interface SendRequest extends OutgoingEmail {
  eventKey: NotificationEventKey;
  /** The thing that may legitimately happen twice. See the note above. */
  entityType: string;
  entityId: string;
}

export type SendOutcome =
  | { status: 'sent'; notificationId: string; deliveryId: string }
  /** A delivery for this (event, target, entity) already exists. Not an error. */
  | { status: 'duplicate' }
  /** A template is rejected before claim, or the claimed provider send fails. */
  | { status: 'failed'; deliveryId?: string; reason: string };

export interface NotifierDeps {
  db: Database;
  transport: EmailTransport;
  /** §25.6. Every send and every refusal is recorded. */
  audit: (event: {
    action: string;
    targetType: string;
    targetId: string;
    internalReason: string;
    newValue?: unknown;
    actorId?: string | null;
  }) => Promise<void>;
}

/** Product copy rule: no outbound email may contain an em dash in any part. */
export function removeEmailEmDashes(value: string): string {
  return value
    .replaceAll('\u2014', ',')
    .replace(/&mdash;|&#8212;|&#x2014;/gi, ',');
}

/** Bracket and moustache variables that must never reach an email provider. */
const UNRESOLVED_EMAIL_VARIABLE = /\[[A-Z][A-Z0-9 _/-]{2,}\]|\{\{\s*[^{}]+?\s*\}\}/g;

export function unresolvedEmailVariables(
  message: Pick<OutgoingEmail, 'subject' | 'html' | 'text'>,
): string[] {
  const found = new Set<string>();
  for (const part of [message.subject, message.html, message.text]) {
    for (const match of part.matchAll(UNRESOLVED_EMAIL_VARIABLE)) found.add(match[0]);
  }
  return [...found].sort();
}

export function createNotifier({ db, transport, audit }: NotifierDeps) {
  async function send(request: SendRequest): Promise<SendOutcome> {
    const unresolved = unresolvedEmailVariables(request);
    if (unresolved.length > 0) {
      const reason = `Email contains unresolved variables: ${unresolved.join(', ')}`;
      await audit({
        action: 'notification.template_rejected',
        targetType: request.entityType,
        targetId: request.entityId,
        internalReason: `${request.eventKey} was not claimed or sent: ${reason}`,
      });
      return { status: 'failed', reason };
    }

    const claimed = await db
      .insert(notificationDeliveries)
      .values({
        eventKey: request.eventKey,
        target: request.to,
        entityType: request.entityType,
        entityId: request.entityId,
      })
      .onConflictDoNothing()
      .returning({ id: notificationDeliveries.id });

    const delivery = claimed[0];
    if (!delivery) {
      // §27.2/§28.3: a duplicate may update audit. It may never send a second
      // message, and it is not an error the caller should retry.
      await audit({
        action: 'notification.duplicate_suppressed',
        targetType: request.entityType,
        targetId: request.entityId,
        internalReason: `${request.eventKey} already delivered to this target for this entity`,
      });
      return { status: 'duplicate' };
    }

    let providerId: string;
    try {
      ({ providerId } = await transport.send({
        to: request.to,
        from: request.from,
        replyTo: request.replyTo,
        subject: removeEmailEmDashes(request.subject),
        html: removeEmailEmDashes(request.html),
        text: removeEmailEmDashes(request.text),
      }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await audit({
        action: 'notification.send_failed',
        targetType: request.entityType,
        targetId: request.entityId,
        internalReason: `${request.eventKey} claimed but the provider refused: ${reason}`,
      });
      return { status: 'failed', deliveryId: delivery.id, reason };
    }

    await db
      .update(notificationDeliveries)
      .set({ notificationId: providerId, deliveredAt: sql`now()` })
      .where(eq(notificationDeliveries.id, delivery.id));

    await audit({
      action: 'notification.sent',
      targetType: request.entityType,
      targetId: request.entityId,
      internalReason: `${request.eventKey} delivered`,
      newValue: { eventKey: request.eventKey, notificationId: providerId },
    });

    return { status: 'sent', notificationId: providerId, deliveryId: delivery.id };
  }

  /** Has this exact delivery already happened? Used by Admin to explain state. */
  async function findDelivery(
    eventKey: NotificationEventKey,
    target: string,
    entityType: string,
    entityId: string,
  ) {
    const [row] = await db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.eventKey, eventKey),
          eq(notificationDeliveries.target, target),
          eq(notificationDeliveries.entityType, entityType),
          eq(notificationDeliveries.entityId, entityId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  return { send, findDelivery };
}

export type Notifier = ReturnType<typeof createNotifier>;
