ALTER TABLE "campaign_drafts"
  ADD COLUMN "prefill_affiliate_types" text[];
--> statement-breakpoint

-- Existing one-type prefills represented every saved match as that type.
UPDATE "campaign_drafts"
SET "prefill_affiliate_types" = array_fill(
  "prefill_affiliate_type",
  ARRAY["prefill_affiliate_matches"]
)
WHERE "prefill_affiliate_type" IS NOT NULL
  AND "prefill_affiliate_matches" IS NOT NULL
  AND "prefill_affiliate_matches" > 0;
--> statement-breakpoint

ALTER TABLE "campaign_drafts"
  ADD CONSTRAINT "campaign_drafts_prefill_affiliate_types_known"
  CHECK (
    "prefill_affiliate_types" IS NULL
    OR "prefill_affiliate_types" <@ ARRAY[
      'social_media_creator','newsletter_operator','blog_operator','podcast_host',
      'community_owner','course_instructor','student_affiliate',
      'network_distributor','niche_marketer'
    ]::text[]
  );
