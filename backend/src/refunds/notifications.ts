/**
 * The §27.5 refund senders — Spec §24.8, §27.2, Appendix B.6 (Phase 20a).
 *
 * One resolver produces the B.6 block (`logic.ts`, drift-tested against
 * shared); this module only decides WHEN each of the three §27.5 keys fires
 * and dedups it per refund row:
 *
 *   → submitted:  `backer_refund_started`
 *   → succeeded:  `backer_refund_completed`
 *   submitted → failed: `backer_refund_failed`
 *
 * A synchronous creation failure (requested → failed) sends nothing — the
 * Backer was never told a refund started, so announcing its failure would be
 * noise about an internal retry (§27.2). Dedup entity is the REFUND row: a
 * duplicate webhook sends nothing (§33.9.12); a second, separately-recorded
 * refund of the same reservation carries its own messages.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { reservations } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import type { ReservationRefund } from '../db/schema/refunds.js';
import type { Notifier } from '../notifications/send.js';
import type { TokenService } from '../auth/token-service.js';
import {
  BACKER_REFUND_STARTED,
  BACKER_REFUND_COMPLETED,
  BACKER_REFUND_FAILED,
} from '../notifications/events.js';
import { renderRefundNotice } from '../notifications/templates/backer-refund.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { formatCents } from '../reservations/restated.js';
import { formatUtcInstant } from '../reservations/consent.js';
import { mintOrReissueMagicLink } from '../reservations/magic-link.js';
import {
  resolveRefundNotice,
  REFUND_DESTINATION_FALLBACK,
  TYPICAL_BANK_TIMING,
} from './logic.js';

export interface RefundNotificationDeps {
  db: Database;
  notifier: Notifier;
  context: LaunchNotificationContext;
  /** Absent → the action links to support instead of the magic-link page. */
  tokens?: TokenService | undefined;
}

const STATUS_EVENT = {
  submitted: { key: BACKER_REFUND_STARTED, word: 'started' },
  succeeded: { key: BACKER_REFUND_COMPLETED, word: 'completed' },
  failed: { key: BACKER_REFUND_FAILED, word: 'failed' },
} as const;

/** Sends the B.6 notice for one refund state, deduped per refund row. */
export async function notifyRefundState(
  deps: RefundNotificationDeps,
  input: { refund: ReservationRefund; status: 'submitted' | 'succeeded' | 'failed' },
): Promise<void> {
  const { refund } = input;

  const [row] = await deps.db
    .select({
      backerEmail: reservations.backerEmail,
      backerIdentityId: reservations.backerIdentityId,
      campaignTitle: campaignBuild.title,
    })
    .from(reservations)
    .leftJoin(campaignBuild, eq(campaignBuild.campaignId, reservations.campaignId))
    .where(eq(reservations.id, refund.reservationId))
    .limit(1);
  if (!row?.backerEmail) return;

  let actionUrl = `mailto:${deps.context.supportEmail}`;
  if (deps.tokens && row.backerIdentityId) {
    try {
      const link = await mintOrReissueMagicLink(
        { db: deps.db, tokenService: deps.tokens, appBaseUrl: deps.context.appBaseUrl },
        { campaignId: refund.campaignId, backerIdentityId: row.backerIdentityId },
      );
      actionUrl = link.url;
    } catch {
      /* the support fallback above stands */
    }
  }

  const startedAt = refund.submittedAt ?? refund.createdAt;
  const notice = resolveRefundNotice({
    amount: formatCents(refund.amountCents),
    destination: refund.destination ?? REFUND_DESTINATION_FALLBACK,
    startedDate: formatUtcInstant(startedAt),
    bankTiming: TYPICAL_BANK_TIMING,
    status: input.status,
    reference: refund.reference,
  });

  const event = STATUS_EVENT[input.status];
  const rendered = await renderRefundNotice({
    statusWord: event.word,
    campaignTitle: row.campaignTitle ?? 'your campaign',
    noticeBody: notice.body,
    action: notice.action,
    actionUrl,
    reference: refund.reference,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: event.key,
    entityType: 'reservation_refund',
    // Once per refund row per state (§27.2, §33.9.12).
    entityId: refund.id,
    to: row.backerEmail,
    from: deps.context.fromAddress,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
}
