-- ── The attribution contract and discovery timing ───────────────────────────
--
-- Phase 14b (§18, §25.2, §33.6.1–5). A visitor arrives through a Creator's
-- tracking link, the click is recorded, and a first-party cookie carries the
-- winner; from Day 8 the campaign may enter browse/indexable discovery.
--
-- Schema instructions that carry through:
--   §18   — "Links used before activated_at, while paused, or after close cannot
--           create payable attribution." The ledger records WHY each ignored
--           click earned nothing, so §33.6.3 is an auditable fact, not the
--           absence of one.
--   §25.2 — the reservation stores "Attribution source, Creator/link, activation
--           time, clicked-at, replacement history, same-device limitation." The
--           write path onto the reservation is Phase 15's; this ledger and the
--           cookie are what it will read. Nothing here touches a reservation.
--   §14.1 — "A safe link-test action must not contaminate production attribution
--           or conversion metrics." A marked click is recorded ignored/link_test
--           and never sets the cookie or counts.

-- ── tracking_link_clicks: the append-only click ledger ───────────────────────
-- Every arrival through /c/:code, valid or not. The cookie is the per-browser
-- winner §18 describes; this is the durable audit record beside it, and the
-- source of the Creator surface's click/conversion metrics (Phase 14c).

CREATE TABLE "tracking_link_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"tracking_link_id" uuid NOT NULL,
	"association_id" uuid NOT NULL,
	-- The first-party visitor id (pv_vid cookie). Groups the same browser's
	-- clicks; §18's "same browser/device" limitation is this and nothing wider.
	"visitor_id" uuid NOT NULL,
	-- §25.2 "clicked-at" — the domain click instant, not the row insert time.
	"clicked_at" timestamp with time zone NOT NULL,
	"outcome" text NOT NULL,
	"ignored_reason" text,
	"link_test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- A click either becomes the attributed winner on its browser or is ignored.
	CONSTRAINT "tracking_link_clicks_outcome" CHECK ("outcome" IN ('attributed', 'ignored')),
	-- An ignored click carries a reason; an attributed one carries none.
	CONSTRAINT "tracking_link_clicks_reason_pairing"
	  CHECK (("outcome" = 'ignored') = ("ignored_reason" IS NOT NULL)),
	-- The reason vocabulary (§18); mirrored by shared CLICK_IGNORED_REASONS.
	CONSTRAINT "tracking_link_clicks_reason_vocab"
	  CHECK ("ignored_reason" IS NULL OR "ignored_reason" IN
	    ('before_activation', 'paused', 'after_close', 'campaign_not_live', 'link_test')),
	-- §14.1: link_test is true exactly when the click was ignored for the marker;
	-- it can never be an attributed click, and an attributed click is never a test.
	CONSTRAINT "tracking_link_clicks_link_test"
	  CHECK ("link_test" = ("outcome" = 'ignored' AND "ignored_reason" = 'link_test'))
);
--> statement-breakpoint
ALTER TABLE "tracking_link_clicks" ADD CONSTRAINT "tracking_link_clicks_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_link_clicks" ADD CONSTRAINT "tracking_link_clicks_link_fk"
  FOREIGN KEY ("tracking_link_id") REFERENCES "public"."tracking_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_link_clicks" ADD CONSTRAINT "tracking_link_clicks_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Resolution and per-browser history read (campaign, visitor) newest-first.
CREATE INDEX "tracking_link_clicks_visitor_idx"
  ON "tracking_link_clicks" USING btree ("campaign_id", "visitor_id", "clicked_at");--> statement-breakpoint
-- Per-link metrics (Phase 14c) and campaign-level counts.
CREATE INDEX "tracking_link_clicks_link_idx"
  ON "tracking_link_clicks" USING btree ("tracking_link_id");--> statement-breakpoint
CREATE INDEX "tracking_link_clicks_campaign_outcome_idx"
  ON "tracking_link_clicks" USING btree ("campaign_id", "outcome");--> statement-breakpoint
-- §25.6: the click ledger is insert-only. A recorded click is what a later
-- reservation's attribution and a dispute's evidence are reconciled against, so
-- a row a careless UPDATE could rewrite is not evidence of anything.
GRANT SELECT, INSERT ON "tracking_link_clicks" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "tracking_link_clicks" FROM proovd_app;--> statement-breakpoint

-- ── campaigns.discovery_opened_at: the Day 8 browse/index switch ─────────────
-- §18: "Beginning Day 8: campaign may enter Proovd browse/indexable discovery."
-- NULL until the sweep flips it seven days after campaign_live_at; set once, and
-- the switch is a one-time fact that never moves (§33.6.5's spirit — it must not
-- rewrite anything, least of all itself). The sweep sets it conditionally on
-- NULL, and this trigger refuses to change it afterwards.
ALTER TABLE "campaigns" ADD COLUMN "discovery_opened_at" timestamp with time zone;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_discovery_opened_once()
RETURNS trigger AS $$
BEGIN
  IF OLD.discovery_opened_at IS NOT NULL
     AND NEW.discovery_opened_at IS DISTINCT FROM OLD.discovery_opened_at THEN
    RAISE EXCEPTION 'campaign discovery opens once and cannot be moved (§18)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER campaign_discovery_opened_once
  BEFORE UPDATE ON "campaigns"
  FOR EACH ROW EXECUTE FUNCTION enforce_discovery_opened_once();
