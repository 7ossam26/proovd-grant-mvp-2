-- Persistent, append-only Founder account warnings — 2026-08-23.

CREATE TABLE "founder_account_warnings" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "prospect_id" uuid NOT NULL REFERENCES "founder_prospects"("id") ON DELETE CASCADE,
  "reason"      text NOT NULL,
  "warned_by"   text NOT NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX "founder_account_warnings_prospect_idx"
  ON "founder_account_warnings" ("prospect_id", "created_at" DESC);
--> statement-breakpoint

REVOKE UPDATE, DELETE ON "founder_account_warnings" FROM "proovd_app";
