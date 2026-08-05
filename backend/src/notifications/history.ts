/**
 * Notification history — Spec §27.7, §27.1, §1.4, DNA §5.2 (Phase 22c).
 *
 * §27.7: "Authenticated Founder/Affiliate/Admin surfaces have notification
 * history." The Backer is absent from that list and has no account (§5), so
 * their record of what was sent is their inbox and the magic-link page.
 *
 * ── It reads `notification_deliveries` and adds no table ────────────────────
 * The deliveries table already records event, recipient, entity, provider id,
 * and whether the provider confirmed. §27.1's requirement that every
 * consequential action leave "a durable email OR product-history record" is
 * satisfied by the row that was written when the email was claimed — the
 * history is a read of it, not a second copy. 0035 adds the one index the
 * dedup index cannot serve, and nothing else.
 *
 * ── No body is stored, and that is the design ──────────────────────────────
 * The history says which message was sent, when, about what, and whether it
 * confirmed. Storing rendered bodies would put a second copy of every personal
 * fact we have ever emailed into a table §25.8 would then have to sweep — to
 * show a person text they already hold in their inbox.
 *
 * ── The label is resolved in the browser, not restated here ─────────────────
 * Every key's human description already lives in the shared registry, which the
 * frontend imports directly through Vite. Restating 123 descriptions in the
 * backend to render them server-side would be a fourth copy to drift; returning
 * the key and letting the surface look it up cannot. This is the same reasoning
 * `contract-logic.ts` uses for deriving the audience from the prefix.
 *
 * ── What makes it a record and not a dashboard ──────────────────────────────
 * There is no unread count, no `last_opened_at`, and nothing here writes
 * anything — the module exports reads only. §20's Act ranking never consults
 * it. Those are the three ways §27.7's prohibition would actually be broken,
 * and the coverage suite asserts each of them.
 */

import { and, desc, eq, like, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { notificationDeliveries } from '../db/schema/integrity.js';
import { historyStateFor, type HistoryAudience, type HistoryDeliveryState } from './digest-logic.js';

export interface HistoryEntry {
  id: string;
  /** The registry key. The surface resolves its description from shared. */
  eventKey: string;
  occurredAt: Date;
  /** §1.4: "sent" and "sent, not confirmed" are different facts. */
  state: HistoryDeliveryState;
  entityType: string;
  entityId: string;
  /** Admin only — who it went to and the provider's id for it. */
  target?: string;
  providerNotificationId?: string | null;
}

export interface HistoryPage {
  entries: HistoryEntry[];
  /** Pass back as `before` for the next page. Null when the list is complete. */
  nextCursor: string | null;
}

/** A page is bounded so the surface cannot become an infinite feed to scroll. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface HistoryQuery {
  audience: HistoryAudience;
  /**
   * The account's email address. Deliveries are addressed to an address, so
   * this is the join — and it is honest about what it means: messages sent to
   * *this address*. Required for founder and affiliate; ignored for admin
   * unless supplied as a filter.
   */
  email?: string | undefined;
  /** ISO instant; returns entries strictly older than this. */
  before?: string | undefined;
  limit?: number | undefined;
  /** Admin filter only. */
  eventKey?: string | undefined;
}

export type HistoryResult =
  | { status: 'ok'; page: HistoryPage }
  | { status: 'email_required' };

export async function readNotificationHistory(
  db: Database,
  query: HistoryQuery,
): Promise<HistoryResult> {
  const isAdmin = query.audience === 'admin';

  if (!isAdmin && !query.email) {
    // A customer history with no address to scope it would be every message the
    // product has ever sent. Refusing is the only safe answer.
    return { status: 'email_required' };
  }

  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const conditions = [];
  if (query.email) {
    conditions.push(eq(notificationDeliveries.target, query.email));
  }
  if (!isAdmin) {
    // The prefix IS the audience (the shared register guarantees it), so this
    // one condition is what keeps `internal_*` notices off a customer surface.
    // A Founder must never read the Admin queue's own messages about them.
    conditions.push(like(notificationDeliveries.eventKey, `${query.audience}_%`));
  } else if (query.eventKey) {
    conditions.push(eq(notificationDeliveries.eventKey, query.eventKey));
  }
  if (query.before) {
    const cursor = new Date(query.before);
    if (!Number.isNaN(cursor.getTime())) {
      conditions.push(lt(notificationDeliveries.createdAt, cursor));
    }
  }

  const rows = await db
    .select()
    .from(notificationDeliveries)
    .where(conditions.length ? and(...conditions) : sql`true`)
    .orderBy(desc(notificationDeliveries.createdAt))
    // One extra row answers "is there another page" without a second count.
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const entries: HistoryEntry[] = page.map((row) => ({
    id: row.id,
    eventKey: row.eventKey,
    occurredAt: row.createdAt,
    state: historyStateFor(row.deliveredAt),
    entityType: row.entityType,
    entityId: row.entityId,
    ...(isAdmin
      ? { target: row.target, providerNotificationId: row.notificationId }
      : {}),
  }));

  const last = page[page.length - 1];
  return {
    status: 'ok',
    page: {
      entries,
      nextCursor: hasMore && last ? last.createdAt.toISOString() : null,
    },
  };
}
