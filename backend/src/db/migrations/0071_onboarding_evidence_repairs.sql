-- Small logos are valid brand assets. Earlier verification applied the visual
-- 320px floor to logos and incorrectly rejected them as placeholders.
UPDATE "campaign_assets"
SET
  "state" = 'stored',
  "rejection" = NULL,
  "verified_at" = COALESCE("verified_at", now()),
  "approved_at" = COALESCE("approved_at", now()),
  "approved_by" = COALESCE("approved_by", "created_by"),
  "updated_at" = now()
WHERE "purpose" = 'logo'
  AND "state" = 'rejected'
  AND "rejection" = 'file_placeholder'
  AND COALESCE("width", 0) >= 1
  AND COALESCE("height", 0) >= 1;

-- Successful existing uploads should match the new upload behavior: attached
-- by the Founder unless they explicitly opt out afterward.
UPDATE "campaign_assets"
SET
  "approved_at" = COALESCE("approved_at", now()),
  "approved_by" = COALESCE("approved_by", "created_by"),
  "updated_at" = now()
WHERE "state" = 'stored'
  AND "removed_at" IS NULL
  AND "approved_at" IS NULL;

-- Normalize already-saved social addresses typed without a scheme. Their
-- remote probe result is kept as diagnostics; completion no longer depends on
-- a third-party site allowing a server-side HEAD request.
UPDATE "campaign_social_profiles"
SET
  "url" = 'https://' || "url",
  "updated_at" = now()
WHERE "removed_at" IS NULL
  AND "url" !~* '^[a-z][a-z0-9+.-]*:';
