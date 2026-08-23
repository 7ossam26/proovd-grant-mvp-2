-- One usable Founder invitation and one usable email verification code per
-- draft. The older lineage index prevents two live versions of one lineage;
-- these indexes close the concurrent-first-issue gap where two requests could
-- create two different lineages for the same draft.

UPDATE "secure_tokens"
SET "revoked_at" = now(), "revoked_reason" = 'expired'
WHERE "scope" IN ('founder_draft', 'founder_email_code')
  AND "revoked_at" IS NULL
  AND "claimed_at" IS NULL
  AND "expires_at" IS NOT NULL
  AND "expires_at" <= now();--> statement-breakpoint

WITH "ranked_live_tokens" AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "scope", "campaign_draft_id"
      ORDER BY "version" DESC, "issued_at" DESC, "id" DESC
    ) AS "live_rank"
  FROM "secure_tokens"
  WHERE "scope" IN ('founder_draft', 'founder_email_code')
    AND "revoked_at" IS NULL
    AND "claimed_at" IS NULL
)
UPDATE "secure_tokens"
SET "revoked_at" = now(), "revoked_reason" = 'superseded_by_rotation'
WHERE "id" IN (
  SELECT "id" FROM "ranked_live_tokens" WHERE "live_rank" > 1
);--> statement-breakpoint

CREATE UNIQUE INDEX "secure_tokens_one_live_founder_draft_per_draft"
  ON "secure_tokens" ("campaign_draft_id")
  WHERE "scope" = 'founder_draft'
    AND "revoked_at" IS NULL
    AND "claimed_at" IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "secure_tokens_one_live_email_code_per_draft"
  ON "secure_tokens" ("campaign_draft_id")
  WHERE "scope" = 'founder_email_code'
    AND "revoked_at" IS NULL
    AND "claimed_at" IS NULL;
