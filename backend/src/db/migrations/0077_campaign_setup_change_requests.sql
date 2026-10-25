-- Field-level Founder asks do not mutate campaign values or either review.
CREATE TABLE "campaign_setup_change_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id"),
  "request_key" uuid NOT NULL,
  "field_key" text NOT NULL,
  "field_label" text NOT NULL,
  "reason" text NOT NULL CHECK (length(btrim("reason")) BETWEEN 1 AND 20000),
  "deep_link" text NOT NULL,
  "requested_by" text NOT NULL,
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "delivery_status" text NOT NULL DEFAULT 'not_attempted' CHECK (
    "delivery_status" IN ('not_attempted', 'pending', 'sent', 'failed', 'unavailable')
  ),
  "delivery_attempt_id" uuid,
  "delivered_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_setup_change_requests_key_idx"
  ON "campaign_setup_change_requests" ("campaign_id", "request_key");
--> statement-breakpoint
CREATE INDEX "campaign_setup_change_requests_campaign_idx"
  ON "campaign_setup_change_requests" ("campaign_id", "requested_at");
--> statement-breakpoint
GRANT SELECT, INSERT ON "campaign_setup_change_requests" TO "proovd_app";
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "campaign_setup_change_requests" FROM "proovd_app";
--> statement-breakpoint
GRANT UPDATE ("delivery_status", "delivery_attempt_id", "delivered_at")
  ON "campaign_setup_change_requests" TO "proovd_app";
