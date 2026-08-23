-- Founder Flow sessions use the same campaign_draft_id binding column as the
-- initial invite and email code, but have an independent lifecycle and lineage.

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
  ("scope" IN ('founder_email_code', 'founder_flow_session')
     AND "campaign_draft_id" IS NOT NULL
     AND "campaign_id" IS NULL
     AND "backer_identity_id" IS NULL
     AND "association_id" IS NULL
     AND "campaign_follower_id" IS NULL)
);--> statement-breakpoint

CREATE UNIQUE INDEX "secure_tokens_one_live_founder_flow_session_per_draft"
  ON "secure_tokens" ("campaign_draft_id")
  WHERE "scope" = 'founder_flow_session'
    AND "revoked_at" IS NULL
    AND "claimed_at" IS NULL;
