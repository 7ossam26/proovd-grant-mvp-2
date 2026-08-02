-- ── Campaign updates ─────────────────────────────────────────────────────────
--
-- Phase 14c (§18, §25.1). The Founder posts updates on a live (or ended)
-- campaign; the public campaign page renders the public ones and the Backer's
-- magic-link page (Phase 15) renders the Backer-only ones.
--
-- Schema instructions that carry through:
--   §18   — "Product: general/public or Backer-only. Idea: general/public,
--           Backer-only, or milestone/progress." milestone_progress is Idea-only
--           and a trigger enforces it. "Material delivery changes show prior and
--           revised commitments together" — a CHECK ties the flag to both.
--   §25.1 — updates are part of the campaign record; the row is append-only, so
--           a published update is what a Backer saw, and a correction is a new
--           update, never a silent rewrite of an old one.

CREATE TYPE "public"."update_audience" AS ENUM ('general_public', 'backer_only', 'milestone_progress');--> statement-breakpoint

CREATE TABLE "campaign_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	-- Who posted it: `founder:<id>` (or `admin:<id>` if Admin ever posts for a Founder).
	"author" text NOT NULL,
	"audience" "update_audience" NOT NULL,
	"title" text,
	"body" text NOT NULL,
	-- Founder-supplied http(s) URLs, validated at post time; the server never fetches them.
	"image_url" text,
	"video_url" text,
	-- §18: local publication time is rendered from this. A dedicated column, not inferred.
	"published_at" timestamp with time zone NOT NULL,
	-- §18: "Material delivery changes show prior and revised commitments together."
	"is_material_delivery_change" boolean DEFAULT false NOT NULL,
	"prior_commitment" text,
	"revised_commitment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_updates_body_present" CHECK (length(btrim("body")) > 0),
	-- A material delivery change carries both commitments; a plain update carries neither.
	CONSTRAINT "campaign_updates_material_pairing"
	  CHECK ("is_material_delivery_change" = ("prior_commitment" IS NOT NULL AND "revised_commitment" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "campaign_updates" ADD CONSTRAINT "campaign_updates_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_updates_campaign_idx" ON "campaign_updates" USING btree ("campaign_id", "published_at");--> statement-breakpoint
CREATE INDEX "campaign_updates_campaign_audience_idx" ON "campaign_updates" USING btree ("campaign_id", "audience");--> statement-breakpoint

-- §18: milestone/progress is an Idea-only audience. The service refuses it too,
-- but the rule is a commercial one, and a rule written only in a route is one the
-- next route forgets — so the database refuses a milestone update on a Product
-- campaign, the same posture the Idea-Campaign fixed-payment prohibition takes.
CREATE OR REPLACE FUNCTION enforce_update_audience_for_type()
RETURNS trigger AS $$
DECLARE
  campaign_type text;
BEGIN
  IF NEW.audience = 'milestone_progress' THEN
    SELECT type::text INTO campaign_type FROM "campaigns" WHERE id = NEW.campaign_id;
    IF campaign_type IS DISTINCT FROM 'pre_build' THEN
      RAISE EXCEPTION 'a milestone/progress update is only allowed on an Idea Campaign (§18)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER campaign_updates_audience_for_type
  BEFORE INSERT ON "campaign_updates"
  FOR EACH ROW EXECUTE FUNCTION enforce_update_audience_for_type();--> statement-breakpoint

-- §25.1 / §25.6: a published update is append-only. A correction is a new update.
GRANT SELECT, INSERT ON "campaign_updates" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "campaign_updates" FROM proovd_app;
