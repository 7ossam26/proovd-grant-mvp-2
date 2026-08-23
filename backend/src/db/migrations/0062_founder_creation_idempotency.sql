-- Idempotency for Admin's one-click create-and-invite operation — 2026-08-23.
--
-- The key names the Admin intent, not the person. A browser retry after a lost
-- response resumes the same draft and cannot create a second Founder record.
-- The older create-only route leaves it NULL and keeps its existing semantics.

ALTER TABLE "founder_prospects"
  ADD COLUMN "creation_request_key" text;
--> statement-breakpoint

CREATE UNIQUE INDEX "founder_prospects_creation_request_key_idx"
  ON "founder_prospects" ("creation_request_key")
  WHERE "creation_request_key" IS NOT NULL;
