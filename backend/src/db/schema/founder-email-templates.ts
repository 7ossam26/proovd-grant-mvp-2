import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Only copy lives here. Provider settings, secure links, and facts are not editable. */
export const founderEmailTemplates = pgTable('founder_email_templates', {
  key: text('key').primaryKey(),
  copy: jsonb('copy').$type<Record<string, string>>().notNull(),
  version: integer('version').notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  changeNote: text('change_note').notNull(),
});
