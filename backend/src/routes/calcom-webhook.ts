/**
 * The Cal.com webhook endpoint — Spec §12, §28.3, tech-stack §12.
 *
 * ── Raw body, before any JSON parser ───────────────────────────────────────
 * The signature covers the exact bytes Cal.com sent. `express.json()` would
 * consume the stream and leave only a re-serialised object, whose key order and
 * number formatting are not guaranteed to match — so the verification would
 * pass or fail for reasons unrelated to authenticity. This mounts
 * `express.raw()` on this path only, and `app.ts` still mounts no global JSON
 * parser for the same reason Phase 10's Stripe endpoint will need.
 *
 * ── An unverified body never reaches the domain ────────────────────────────
 * Signature first, parse second, ingest third. A body that fails verification is
 * refused with 401 and nothing is recorded against a campaign: the whole point
 * of the signature is that an unsigned request cannot move a US$2 discount or a
 * high-effort input.
 *
 * ── The response is deliberately uninformative, and always 2xx once verified ─
 * A verified delivery that could not be bound still answers 200. Cal.com retries
 * on a non-2xx, and retrying a payload we have already recorded as unbindable
 * would produce a queue of identical failures rather than the one audit row an
 * Admin needs. The refusal is in the audit log, where support can read it and
 * the caller cannot — the same split §5.5 makes for token rejections.
 *
 * ── Email is sent after the ingest returns ─────────────────────────────────
 * The ingest commits its transitions and reports which of §27.3's four
 * notifications the transition owes. Sending inside would hold a database
 * transaction open across a mail provider (the 08b/08c decision).
 */

import { Router } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import type { Database } from '../db/client.js';
import type { Notifier } from '../notifications/send.js';
import type { AuditWriter } from '../auth/audit.js';
import { CALCOM_SIGNATURE_HEADER, parseVendorEvent, type Scheduler } from '../interviews/calcom.js';
import { ingestVendorEvent } from '../interviews/webhook.js';
import {
  notifyInterview,
  type InterviewNotificationContext,
} from '../interviews/notifications.js';
import { notifyInterviewChanged } from '../notifications/internal-queue.js';

export const CALCOM_WEBHOOK_PATH = '/api/webhooks/calcom';

export interface CalcomWebhookDeps {
  db: Database;
  scheduler: Scheduler;
  notifier: Notifier;
  audit: AuditWriter;
  context: InterviewNotificationContext;
  /** Keys the campaign-reference HMAC. `BETTER_AUTH_SECRET`. */
  referenceSecret: string;
  /**
   * §27.6's internal notice needs a link and an inbox, and
   * `InterviewNotificationContext` carries neither — it is the Founder
   * context, which needs no Admin route. Both optional: without either, the
   * Founder still hears about their own booking and the change stays visible
   * in the workspace, which is where §1.4 requires it to be visible anyway.
   */
  appBaseUrl?: string | undefined;
  internalRecipient?: string | undefined;
  /** Raised only by the integration suite, which drives many deliveries. */
  limit?: number;
}

export function createCalcomWebhookRouter({
  db,
  scheduler,
  notifier,
  audit,
  context,
  referenceSecret,
  appBaseUrl,
  internalRecipient,
  limit,
}: CalcomWebhookDeps): Router {
  const router = Router();

  const limiter = rateLimit({
    windowMs: 60_000,
    limit: limit ?? 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });

  router.post(
    CALCOM_WEBHOOK_PATH,
    limiter,
    // 256 KB. A booking payload is a few kilobytes; anything near this is not
    // one, and an unbounded raw parser on an unauthenticated route is a way to
    // be exhausted by a body nobody will ever read.
    express.raw({ type: '*/*', limit: '256kb' }),
    async (req, res) => {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
      const signature = req.header(CALCOM_SIGNATURE_HEADER) ?? undefined;

      if (!scheduler.verifySignature(rawBody, signature)) {
        // Unconfigured and wrong-signature are the same answer. A deployment
        // with no secret must not be a deployment that accepts anything.
        res.status(401).json({ error: 'signature_invalid' });
        return;
      }

      const event = parseVendorEvent(rawBody);
      if (!event) {
        await audit({
          action: 'interview.webhook_unreadable',
          targetType: 'interview_booking',
          targetId: null,
          internalReason: 'a signed delivery could not be parsed as a booking event',
        });
        res.status(400).json({ error: 'unreadable' });
        return;
      }

      const outcome = await ingestVendorEvent({ db, audit, referenceSecret }, event);

      if (outcome.status === 'applied' && outcome.notify) {
        // §12's four notifications. Dedup is `notification_deliveries`, keyed
        // per moment — see `interviews/notifications.ts`.
        await notifyInterview(db, notifier, context, {
          bookingId: outcome.bookingId,
          kind: outcome.notify,
        });
      }

      if (outcome.status === 'applied' && outcome.eventId && appBaseUrl && internalRecipient) {
        // §27.6's internal counterpart, deduped on the event row (Phase 22b).
        // A reschedule or cancellation moves a US$2 credit and one third of
        // the high-effort classification, so Admin is owed the notice even
        // though the Founder already has theirs.
        await notifyInterviewChanged(
          {
            db,
            notifier,
            context: { ...context, appBaseUrl },
            internalRecipient,
          },
          { eventId: outcome.eventId },
        );
      }

      res.status(200).json({ received: true });
    },
  );

  return router;
}
