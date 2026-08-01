/**
 * Secure tokens — Founder invitation drafts and Backer magic links.
 *
 * ── Why this is not Better Auth ─────────────────────────────────────────────
 * Better Auth's magic-link plugin creates a user account and a session. Spec
 * §5.4 states Backers are guest-only with no password account, and §19 requires
 * campaign-scoped access: a magic link grants access only to that Backer's view
 * of that campaign and its transactions. An account-based session cannot
 * express that scope, and creating Backer accounts would contradict the spec
 * outright.
 *
 * Better Auth still owns Founder, Affiliate, and Admin. This table owns the two
 * tokenised surfaces that have no account behind them.
 *
 * ── Why one table for both ──────────────────────────────────────────────────
 * Spec §28.1 imposes an identical security contract on Founder draft tokens and
 * Backer magic links: ≥128 bits entropy, raw value only in the delivered URL,
 * one-way hash at rest, version + lineage, constant-time comparison, rate
 * limiting, non-enumerating errors, and immediate revocation of superseded
 * versions on rotation. Two implementations of one contract is two chances to
 * get it wrong.
 *
 * ── Hashing choice ──────────────────────────────────────────────────────────
 * SHA-256, not bcrypt/argon2. Password hashes are deliberately slow because
 * passwords are low-entropy and brute-forceable. These tokens carry 256 bits of
 * CSPRNG entropy, so there is nothing to brute-force, and a slow hash on every
 * magic-link page load would be a self-inflicted denial of service.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';

/**
 * Token scope. Determines which entity columns are populated and which
 * lifetime rule applies.
 *
 *  - `founder_draft`     Spec §7. Scoped to one invited draft. Grants no
 *                        account, Admin, payment, or other-Founder access.
 *                        Content deleted or anonymised 30 calendar days after
 *                        the most recent send.
 *  - `backer_magic_link` Spec §19. Scoped to one Backer identity + one
 *                        campaign. Valid through fulfilment or final
 *                        resolution + 180 days unless revoked or reissued.
 *                        Founder or Affiliate payment never expires it.
 *  - `affiliate_invitation` Spec §8, §11. Scoped to ONE campaign-Affiliate
 *                        association. Grants exactly what §33.2.1 allows: the
 *                        ability to claim that Affiliate's account and that
 *                        association, and nothing else — not another campaign,
 *                        not another Creator, not the Founder's draft.
 */
export const tokenScope = pgEnum('token_scope', [
  'founder_draft',
  'backer_magic_link',
  'affiliate_invitation',
]);

/**
 * Why a token stopped being usable. Stored for audit; never surfaced to the
 * holder, because doing so would let a caller distinguish "revoked" from
 * "never existed" and enumerate valid links (Spec §5.5).
 */
export const tokenRevocationReason = pgEnum('token_revocation_reason', [
  'superseded_by_rotation',
  'claimed',
  'admin_revoked',
  'expired',
  'security_reissue',
  'draft_anonymised',
]);

export const secureTokens = pgTable(
  'secure_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    scope: tokenScope('scope').notNull(),

    /**
     * SHA-256 of the raw token, hex-encoded. The raw value exists only in the
     * delivered URL — never at rest, never in a log line, never in an error
     * message, never in an email body beyond the link itself (Spec §28.1).
     */
    tokenHash: text('token_hash').notNull(),

    /**
     * Monotonic per lineage. Rotation issues version n+1 and immediately
     * revokes every version ≤ n (Spec §7: "Resend rotates the token,
     * invalidates all older versions immediately").
     */
    version: integer('version').notNull().default(1),

    /**
     * Lineage root. The first token in a chain points at itself. Rotations
     * share a root, so revoking a lineage is one predicate.
     */
    lineageId: uuid('lineage_id').notNull(),

    /** Immediate predecessor, for audit reconstruction. */
    supersedesTokenId: uuid('supersedes_token_id'),

    /* ── Scope binding ─────────────────────────────────────────────────────
       Exactly one of these groups is populated, enforced by a CHECK constraint
       in the migration (see the note at the bottom of this file). A token that
       is not bound to a specific entity is a token that grants broad access,
       which is the failure §28.1 exists to prevent. */

    /** `founder_draft` — the invited draft this token opens. */
    campaignDraftId: uuid('campaign_draft_id'),

    /** `backer_magic_link` — the campaign this link is scoped to. */
    campaignId: uuid('campaign_id'),

    /**
     * `backer_magic_link` — the Backer identity. Not a user account; the
     * pseudonymous Backer record that owns the reservations on this campaign.
     */
    backerIdentityId: uuid('backer_identity_id'),

    /**
     * `affiliate_invitation` — the one campaign-Affiliate association this
     * token claims (§8, §11, §33.2.1).
     *
     * The association, not the prospect: a Creator recruited to two campaigns
     * holds two associations and must receive two invitations. Binding to the
     * person instead would make one link claimable against whichever campaign
     * the request named, which is precisely the cross-scope access §33.2.1
     * tests for.
     */
    associationId: uuid('association_id'),

    /* ── Lifecycle ─────────────────────────────────────────────────────────*/

    issuedAt: timestamp('issued_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    /**
     * Absolute expiry. Nullable for magic links, whose lifetime is derived
     * from campaign resolution + 180 days rather than a fixed stamp at issue
     * time (Spec §19) — the retention job sets it once resolution is known.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),

    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: tokenRevocationReason('revoked_reason'),

    /**
     * Set when a draft token is consumed to create an account. Spec §7:
     * claim, expiration, or revocation prevents replay, and two concurrent
     * claims must yield one account and one failed safe response.
     */
    claimedAt: timestamp('claimed_at', { withTimezone: true }),

    /** Failed verification attempts against this hash, for rate limiting. */
    failedAttempts: integer('failed_attempts').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    /**
     * Verification looks up by hash. Unique because a collision would mean two
     * tokens resolving to one row, and because it makes the lookup a single
     * index probe — important when this runs on every magic-link page load.
     */
    hashIdx: uniqueIndex('secure_tokens_hash_idx').on(t.tokenHash),

    /** Rotation and lineage revocation. */
    lineageIdx: index('secure_tokens_lineage_idx').on(t.lineageId, t.version),

    /** Admin: "show me every live link for this campaign". */
    campaignIdx: index('secure_tokens_campaign_idx').on(t.campaignId, t.scope),

    /** The 30-day unclaimed-draft anonymisation sweep. */
    draftIdx: index('secure_tokens_draft_idx').on(t.campaignDraftId),

    /** Admin: the live invitation for one Affiliate association (§8). */
    associationIdx: index('secure_tokens_association_idx').on(t.associationId),
  }),
);

export type SecureToken = typeof secureTokens.$inferSelect;
export type NewSecureToken = typeof secureTokens.$inferInsert;

/**
 * ── Constraints to add in the migration ─────────────────────────────────────
 * drizzle-kit will not generate these from the schema; write them into the
 * generated SQL by hand and keep them under review.
 *
 *   ALTER TABLE secure_tokens ADD CONSTRAINT secure_tokens_scope_binding CHECK (
 *     (scope = 'founder_draft'
 *        AND campaign_draft_id IS NOT NULL
 *        AND campaign_id IS NULL
 *        AND backer_identity_id IS NULL)
 *     OR
 *     (scope = 'backer_magic_link'
 *        AND campaign_draft_id IS NULL
 *        AND campaign_id IS NOT NULL
 *        AND backer_identity_id IS NOT NULL)
 *   );
 *
 *   -- One live token per lineage. Rotation must revoke before it issues.
 *   CREATE UNIQUE INDEX secure_tokens_one_live_per_lineage
 *     ON secure_tokens (lineage_id)
 *     WHERE revoked_at IS NULL AND claimed_at IS NULL;
 *
 * The partial unique index is what makes "two concurrent claims yield one
 * account and one failed safe response" (Spec §33.1.2) a database guarantee
 * rather than an application race.
 */
