-- ════════════════════════════════════════════════════════════════════════════
-- 0054 — the email code's scope binding (Founder Flow v2, Session C)
--
-- The second half of the 0008/0009 dance, third time of asking: 0053 added the
-- `founder_email_code` label and Postgres refuses to USE a label in the
-- transaction that added it, so the CHECK naming it is its own file.
--
-- ── Two scopes bind the same column, and that is correct ────────────────────
-- `founder_email_code` binds `campaign_draft_id`, exactly as `founder_draft`
-- does, because a code belongs to one invited draft and to nothing else. The
-- CHECK is a partition over which columns may be NON-NULL, not over which
-- column is unique to a scope — what it buys here is that a code token can
-- never also carry a campaign, a Backer identity, an association, or a
-- follower, which is the broad-access failure §28.1 exists to prevent. The two
-- scopes are told apart by `verify`'s own `row.scope !== expectedScope`
-- rejection, so a draft link presented at the code route and a code presented
-- at a draft route both fail with the one frozen rejection.
--
-- ── The hash in this row is not the hash in the others ──────────────────────
-- `secure_tokens_hash_idx` is UNIQUE on `token_hash`, and a plain SHA-256 over
-- six digits has 10^6 possible values: two live codes would collide on that
-- index, and the digest itself is a rainbow-table lookup straight back to the
-- code. So a `founder_email_code` row stores an HMAC keyed on
-- `BETTER_AUTH_SECRET` over the draft id, the normalised address and the code,
-- domain-separated by a fixed label — the arrangement
-- `backend/src/interviews/reference.ts` already uses for the Cal.com binding.
-- Two drafts issued the same six digits therefore store different hashes, and
-- a code minted for one draft or one address cannot verify another.
--
-- No column is added, so `enforce_secure_token_immutability()` is unchanged:
-- `scope`, the four binding ids, `token_hash`, `lineage_id` and `version` are
-- already the columns it refuses to move.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "secure_tokens" DROP CONSTRAINT "secure_tokens_scope_binding";--> statement-breakpoint
ALTER TABLE "secure_tokens" ADD CONSTRAINT "secure_tokens_scope_binding" CHECK (
  ("scope" = 'founder_draft'
     AND "campaign_draft_id" IS NOT NULL
     AND "campaign_id" IS NULL
     AND "backer_identity_id" IS NULL
     AND "association_id" IS NULL
     AND "campaign_follower_id" IS NULL)
  OR
  ("scope" = 'backer_magic_link'
     AND "campaign_draft_id" IS NULL
     AND "campaign_id" IS NOT NULL
     AND "backer_identity_id" IS NOT NULL
     AND "association_id" IS NULL
     AND "campaign_follower_id" IS NULL)
  OR
  ("scope" = 'affiliate_invitation'
     AND "campaign_draft_id" IS NULL
     AND "campaign_id" IS NULL
     AND "backer_identity_id" IS NULL
     AND "association_id" IS NOT NULL
     AND "campaign_follower_id" IS NULL)
  OR
  ("scope" = 'campaign_follow'
     AND "campaign_draft_id" IS NULL
     AND "campaign_id" IS NULL
     AND "backer_identity_id" IS NULL
     AND "association_id" IS NULL
     AND "campaign_follower_id" IS NOT NULL)
  OR
  -- The fifth. One invited draft, and nothing else: a code that could also name
  -- a campaign or an association would be a six-digit secret with a wider
  -- reach than the link it was requested from.
  ("scope" = 'founder_email_code'
     AND "campaign_draft_id" IS NOT NULL
     AND "campaign_id" IS NULL
     AND "backer_identity_id" IS NULL
     AND "association_id" IS NULL
     AND "campaign_follower_id" IS NULL)
);
