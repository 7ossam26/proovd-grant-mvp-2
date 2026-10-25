import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { campaigns } from './domain.js';

/** A field-specific ask, independent of either application or campaign review. */
export const campaignSetupChangeRequests = pgTable('campaign_setup_change_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id),
  requestKey: uuid('request_key').notNull(),
  fieldKey: text('field_key').notNull(),
  fieldLabel: text('field_label').notNull(),
  reason: text('reason').notNull(),
  deepLink: text('deep_link').notNull(),
  requestedBy: text('requested_by').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  // A committed pending claim is deliberately not retried after an uncertain
  // provider outcome. Only a recorded failure permits a fresh attempt identity.
  deliveryStatus: text('delivery_status').notNull().default('not_attempted'),
  deliveryAttemptId: uuid('delivery_attempt_id'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
}, (t) => ({
  requestKeyIdx: uniqueIndex('campaign_setup_change_requests_key_idx').on(t.campaignId, t.requestKey),
  campaignIdx: index('campaign_setup_change_requests_campaign_idx').on(t.campaignId, t.requestedAt),
}));

export type CampaignSetupChangeRequest = typeof campaignSetupChangeRequests.$inferSelect;
