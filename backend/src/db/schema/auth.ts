/**
 * Better Auth tables — phase 04. The three *account* actors only.
 *
 * Four actors, two mechanisms (§5, tech-stack §5). Admin, Founder, and
 * Affiliate have accounts and live here. Backers have **no account** (§5.4) and
 * are served entirely by `secure_tokens` in `tokens.ts`. Nothing in this file
 * ever describes a Backer.
 *
 * ── Why these tables are hand-declared ──────────────────────────────────────
 * Better Auth can create its own tables, which would make it a second
 * migration authority beside drizzle-kit. Declaring them here keeps one
 * migration path, lets the §25.6 grants and REVOKEs be written in the same SQL
 * as every other table, and lets `drizzle-kit generate` see the whole database.
 *
 * The property names below are Better Auth's field names and must not be
 * renamed — `@better-auth/drizzle-adapter` resolves a field by indexing the
 * table object with them (`schemaModel[fieldName]`). Column names are ours, so
 * they follow the repository's snake_case convention.
 */

import {
  pgTable,
  pgEnum,
  text,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * §5.1/§5.2/§5.3. Three account roles, no hierarchy — every Admin has full
 * functional access in the MVP (§5.1). `affiliate` is the internal name; the
 * customer-facing word is Creator and never comes from this column (§3).
 *
 * There is no `backer` value, and adding one would be wrong: §5.4 makes Backers
 * guest-only.
 */
export const proovdRole = pgEnum('proovd_role', ['admin', 'founder', 'affiliate']);

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),

    /**
     * No default. Every account is created by an Admin-driven or
     * invitation-driven path (§5.1, §5.2, §5.3) — there is no public signup
     * for any role — so the creating code always knows the role and must say
     * so. A default here would silently mint the wrong kind of account.
     */
    role: proovdRole('role').notNull(),

    /**
     * §5.2/§5.3: phone is collected and **explicitly unverified**, and §5.2 is
     * blunt that no SMS OTP exists. `phone_verified` is therefore not a flag
     * that happens to be false — a CHECK constraint in the migration pins it
     * false, so no future code path can quietly mark a phone verified without
     * first building the verification the Spec does not have. §33.1.8.
     */
    phone: text('phone'),
    phoneVerified: boolean('phone_verified').notNull().default(false),

    /** Set by the two-factor plugin. Mandatory for Admin (§5.1, §28.2). */
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex('user_email_idx').on(t.email),
    roleIdx: index('user_role_idx').on(t.role),
  }),
);

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),

    /**
     * §5.1/§28.2 freshness: the reauthentication gate measures age from this
     * column. It is the session's own creation time, not the user's — a
     * long-lived session cannot present itself as recently reauthenticated.
     */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenIdx: uniqueIndex('session_token_idx').on(t.token),
    userIdx: index('session_user_idx').on(t.userId),
  }),
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    /** `credential` for email+password; `google` for Founder OAuth (§5.2). */
    providerId: text('provider_id').notNull(),
    accountId: text('account_id').notNull(),

    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),

    /** Better Auth's own hash. Raw passwords never reach this codebase. */
    password: text('password'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('account_user_idx').on(t.userId),
    providerIdx: uniqueIndex('account_provider_idx').on(t.providerId, t.accountId),
  }),
);

/**
 * Better Auth's short-lived verification values — email-link password reset for
 * Founder, Affiliate, and Admin (§5.5).
 *
 * Backers appear nowhere in this table. §5.5: "Backer has no password reset."
 * Admin resends or reissues a magic link instead, which is a `secure_tokens`
 * operation.
 */
export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    identifierIdx: index('verification_identifier_idx').on(t.identifier),
  }),
);

/**
 * TOTP factors. §5.1 and §28.2 make MFA mandatory for Admin; `requireAdmin`
 * refuses to admit an Admin whose `twoFactorEnabled` is false, so a row here is
 * the precondition for any Admin operational surface.
 *
 * TOTP only. There is no SMS/OTP-by-phone provider configured anywhere
 * (§5.2, §33.1.8).
 */
export const twoFactor = pgTable(
  'two_factor',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    verified: boolean('verified').notNull().default(true),
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('two_factor_user_idx').on(t.userId),
    secretIdx: index('two_factor_secret_idx').on(t.secret),
  }),
);

/**
 * The object Better Auth's drizzle adapter indexes by model name. The keys are
 * Better Auth's model names and must stay exactly as written.
 */
export const betterAuthSchema = { user, session, account, verification, twoFactor };

export type UserRow = typeof user.$inferSelect;
export type SessionRow = typeof session.$inferSelect;
export type ProovdRole = (typeof proovdRole.enumValues)[number];

/**
 * ── Constraints to add in the migration ─────────────────────────────────────
 * drizzle-kit does not generate CHECK constraints; 0002 writes this one by
 * hand and keeps it under review.
 *
 *   ALTER TABLE "user" ADD CONSTRAINT user_phone_never_verified
 *     CHECK ("phone_verified" = false);
 *
 * §5.2: "Phone is collected and explicitly unverified; no SMS OTP exists."
 * Making that a database invariant is what turns §33.1.8 from a code review
 * into a test.
 */
