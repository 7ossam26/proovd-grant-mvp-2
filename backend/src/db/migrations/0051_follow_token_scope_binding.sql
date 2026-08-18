-- ════════════════════════════════════════════════════════════════════════════
-- 0051 — the follow token's scope binding (campaign-page-v2, Session C)
--
-- This is the second half of the 0008/0009 dance, verbatim: 0050 added the
-- `campaign_follow` enum label and the `campaign_follower_id` column, and
-- Postgres refuses to USE an enum label in the transaction that added it. The
-- migrator runs one transaction per file, so the CHECK that names the label
-- has to be its own file.
--
-- The DROP + re-ADD must also add `AND "campaign_follower_id" IS NULL` to the
-- three EXISTING branches — exactly as 0009 did when it added the Affiliate
-- invitation. Without it a `founder_draft` token could carry a follower id
-- alongside its draft id, which is the broad-access failure §28.1 exists to
-- prevent and the reason this CHECK is a partition rather than a list.
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
  -- The fourth. Bound to ONE follow row and nothing else: not a campaign, not
  -- a Backer identity, not an association. Two lineages share this scope —
  -- the confirm link, which is claimed on use, and the unfollow link, which is
  -- never claimed (a claimed token fails `verify`) and is revoked only when
  -- the follow ends.
  ("scope" = 'campaign_follow'
     AND "campaign_draft_id" IS NULL
     AND "campaign_id" IS NULL
     AND "backer_identity_id" IS NULL
     AND "association_id" IS NULL
     AND "campaign_follower_id" IS NOT NULL)
);
