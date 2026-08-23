-- Founder-supplied product links.
--
-- Kept separate from campaign_assets because a mutable remote URL is not an
-- object Proovd stored, inspected, or approved. It can be shown to Admin and
-- removed by the Founder without ever counting as verified upload evidence.

CREATE TABLE "campaign_visual_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "url" text NOT NULL,
  "removed_at" timestamp with time zone,
  "removed_by" text,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_visual_links_url_http" CHECK ("url" ~ '^https?://')
);
--> statement-breakpoint

ALTER TABLE "campaign_visual_links"
  ADD CONSTRAINT "campaign_visual_links_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "campaign_visual_links_campaign_idx"
  ON "campaign_visual_links" USING btree ("campaign_id");
--> statement-breakpoint

CREATE UNIQUE INDEX "campaign_visual_links_live_url_idx"
  ON "campaign_visual_links" USING btree ("campaign_id", "url")
  WHERE "removed_at" IS NULL;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON "campaign_visual_links" TO proovd_app;
