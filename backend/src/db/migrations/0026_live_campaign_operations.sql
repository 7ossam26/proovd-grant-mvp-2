-- ── Live campaign operations: the observed campaign ─────────────────────────
--
-- Phase 17a (§20, §33.6.6–§33.6.11). The Founder's chronological campaign home
-- and the event substrate underneath it. Five tables, and several deliberate
-- absences.
--
--   `founder_campaign_last_seen`   §20's last-visit anchor. One row per campaign
--                                  per viewer. Advanced ONLY by an acknowledged
--                                  delivery — never by rendering.
--   `campaign_home_deliveries`     the receipt that makes "successfully
--                                  delivered" a fact rather than an assumption.
--                                  §33.6.6 is the whole reason this table exists.
--   `campaign_threshold_crossings` §20's per-crossing event. Append-only, and a
--                                  trigger enforces that directions alternate —
--                                  which is "deduplicated by state transition"
--                                  expressed as a database guarantee.
--   `campaign_milestones`          §20's four one-time milestones. One row per
--                                  campaign per kind, insert-only apart from the
--                                  acknowledgement that moves it to history.
--   `act_rank_corrections`         §20's "prior rank, reason, actor, and time"
--                                  for every correction, dismissal,
--                                  reclassification, and documented safety
--                                  override. Insert-only. Feeds §31.9's
--                                  next-action correction rate.
--
--   **No counters table.** §20 asks that new pre-orders, cancellations, and net
--   change be stored separately. They already are: `reservation_status_history`
--   is append-only and holds one row per transition, which is the strongest form
--   of "separately" available. A second set of counters would be the §26.8
--   timeline mistake in a different phase — a store that drifts from the record
--   it summarises is worse than no store, and a drifting count is one a Founder
--   would act on. The counts are composed on read and §33.6.9 asserts the
--   identity holds.
--
--   **No schedule column anywhere.** §33.6.11 forbids a generic scheduled
--   check-in email. Nothing here carries a `send_at`, `next_nudge_at`, or
--   `cadence`, and no job in this phase sends mail on a timer — every message
--   Phase 17a can produce is behind a real state transition (§20: "Notify only
--   for real actions or consequences").

-- ── founder_campaign_last_seen (§20 Glance, §33.6.6) ────────────────────────
CREATE TABLE "founder_campaign_last_seen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,

	-- Per viewer, not per campaign. Two people on one campaign have two
	-- last-visit positions, and merging them would silently consume one person's
	-- delta when the other opened the page.
	"viewer_user_id" text NOT NULL,

	-- The active pre-order count as of the delivery that was acknowledged, and
	-- when that delivery was rendered. Both move together or neither moves.
	"last_seen_count" integer NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,

	-- Which receipt advanced it. Makes the advance auditable back to the exact
	-- render the Founder actually received.
	"last_delivery_id" uuid,

	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "founder_campaign_last_seen" ADD CONSTRAINT "founder_campaign_last_seen_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id");--> statement-breakpoint

ALTER TABLE "founder_campaign_last_seen" ADD CONSTRAINT "founder_campaign_last_seen_count_non_negative"
  CHECK ("last_seen_count" >= 0);--> statement-breakpoint

CREATE UNIQUE INDEX "founder_campaign_last_seen_viewer_idx"
  ON "founder_campaign_last_seen" ("campaign_id", "viewer_user_id");--> statement-breakpoint

-- §20: last-seen only ever moves forward. A delivery acknowledged out of order —
-- a stale tab finishing its render after a newer one — must not rewind the
-- position and hand the Founder a delta they have already read.
CREATE OR REPLACE FUNCTION enforce_last_seen_monotonic()
RETURNS trigger AS $$
BEGIN
  IF NEW.last_seen_at < OLD.last_seen_at THEN
    RAISE EXCEPTION 'a last-seen position only moves forward (§20)';
  END IF;
  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.viewer_user_id IS DISTINCT FROM OLD.viewer_user_id
  THEN
    RAISE EXCEPTION 'a last-seen row cannot change campaign or viewer (§20)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER founder_campaign_last_seen_monotonic
  BEFORE UPDATE ON "founder_campaign_last_seen"
  FOR EACH ROW EXECUTE FUNCTION enforce_last_seen_monotonic();--> statement-breakpoint

-- ── campaign_home_deliveries (§20, §33.6.6) ─────────────────────────────────
-- §20: "Store/update `last_seen_count` and `last_seen_at` only after the rendered
-- state is successfully delivered."
--
-- "Successfully delivered" is not something a server can assert about its own
-- response — the connection can drop after the last byte leaves. So the read
-- issues a receipt carrying exactly what it rendered, and the surface
-- acknowledges it once the render succeeded. A failed render never acknowledges,
-- the receipt stays open, and the delta survives to be read again. That is the
-- whole of §33.6.6, and it is why advancing is a separate write from reading.
CREATE TABLE "campaign_home_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"viewer_user_id" text NOT NULL,

	-- What this render actually showed. The acknowledgement advances last-seen to
	-- THESE values, not to whatever the counts are when the ack arrives — a delta
	-- the Founder never saw must not be consumed by their acknowledging one they
	-- did.
	"rendered_active_count" integer NOT NULL,
	"rendered_at" timestamp with time zone DEFAULT now() NOT NULL,

	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "campaign_home_deliveries" ADD CONSTRAINT "campaign_home_deliveries_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id");--> statement-breakpoint

ALTER TABLE "campaign_home_deliveries" ADD CONSTRAINT "campaign_home_deliveries_count_non_negative"
  CHECK ("rendered_active_count" >= 0);--> statement-breakpoint

CREATE INDEX "campaign_home_deliveries_viewer_idx"
  ON "campaign_home_deliveries" ("campaign_id", "viewer_user_id", "rendered_at");--> statement-breakpoint

ALTER TABLE "founder_campaign_last_seen" ADD CONSTRAINT "founder_campaign_last_seen_delivery_fk"
  FOREIGN KEY ("last_delivery_id") REFERENCES "campaign_home_deliveries"("id");--> statement-breakpoint

-- An acknowledgement happens once. A receipt that could be re-acknowledged is a
-- receipt a retry loop could use to consume a second delta.
CREATE OR REPLACE FUNCTION enforce_delivery_ack_once()
RETURNS trigger AS $$
BEGIN
  IF OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at THEN
    RAISE EXCEPTION 'a campaign home delivery is acknowledged once (§20, §33.6.6)';
  END IF;
  IF NEW.rendered_active_count IS DISTINCT FROM OLD.rendered_active_count
     OR NEW.rendered_at IS DISTINCT FROM OLD.rendered_at
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.viewer_user_id IS DISTINCT FROM OLD.viewer_user_id
  THEN
    RAISE EXCEPTION 'a campaign home delivery records what was rendered and cannot be rewritten (§20)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER campaign_home_delivery_ack_once
  BEFORE UPDATE ON "campaign_home_deliveries"
  FOR EACH ROW EXECUTE FUNCTION enforce_delivery_ack_once();--> statement-breakpoint

-- ── campaign_threshold_crossings (§20, §33.6.10) ────────────────────────────
-- §20: "Crossing an Idea threshold emits `threshold reached`; falling below emits
-- `threshold lost`. Each crossing is its own event and notification, deduplicated
-- by state transition."
--
-- Deduplicated by transition means the guarantee is about *alternation*, not
-- about a time window and not about a count. The trigger below refuses a second
-- `reached` with no `lost` between them, and refuses a `lost` on a campaign that
-- never reached — so the service's evaluation can run on every pre-order and
-- every cancellation, and the database is what makes running it twice safe.
CREATE TABLE "campaign_threshold_crossings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,

	"direction" text NOT NULL,

	-- The facts the crossing was decided on, stored with it. The threshold is
	-- copied rather than read back later because a campaign's threshold is fixed
	-- at close (§21) and a crossing is a statement about the threshold in force
	-- when it happened.
	"unique_active_backers" integer NOT NULL,
	"threshold" integer NOT NULL,

	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,

	-- §27.3/§27.6: the Founder notice and the internal one. NULL until confirmed,
	-- which is the honest "recorded, not confirmed delivered" state §7 established.
	"founder_notification_id" text,
	"internal_notification_id" text
);--> statement-breakpoint

ALTER TABLE "campaign_threshold_crossings" ADD CONSTRAINT "campaign_threshold_crossings_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id");--> statement-breakpoint

ALTER TABLE "campaign_threshold_crossings" ADD CONSTRAINT "campaign_threshold_crossings_direction_known"
  CHECK ("direction" IN ('reached', 'lost'));--> statement-breakpoint

ALTER TABLE "campaign_threshold_crossings" ADD CONSTRAINT "campaign_threshold_crossings_threshold_positive"
  CHECK ("threshold" >= 1 AND "unique_active_backers" >= 0);--> statement-breakpoint

-- The crossing must agree with the counts it was decided on. A `reached` row
-- whose backer count is below its own threshold would be a crossing that never
-- happened, and it would notify someone.
ALTER TABLE "campaign_threshold_crossings" ADD CONSTRAINT "campaign_threshold_crossings_consistent" CHECK (
  ("direction" = 'reached' AND "unique_active_backers" >= "threshold")
  OR ("direction" = 'lost' AND "unique_active_backers" < "threshold")
);--> statement-breakpoint

CREATE INDEX "campaign_threshold_crossings_campaign_idx"
  ON "campaign_threshold_crossings" ("campaign_id", "occurred_at");--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_threshold_crossing_alternates()
RETURNS trigger AS $$
DECLARE
  previous text;
BEGIN
  SELECT "direction" INTO previous
  FROM "campaign_threshold_crossings"
  WHERE "campaign_id" = NEW."campaign_id"
  ORDER BY "occurred_at" DESC, "id" DESC
  LIMIT 1;

  IF previous IS NULL AND NEW."direction" = 'lost' THEN
    RAISE EXCEPTION 'a campaign cannot lose a threshold it never reached (§20)';
  END IF;

  IF previous = NEW."direction" THEN
    RAISE EXCEPTION 'threshold crossings alternate — % is already the current state (§20, §33.6.10)', NEW."direction";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER campaign_threshold_crossing_alternates
  BEFORE INSERT ON "campaign_threshold_crossings"
  FOR EACH ROW EXECUTE FUNCTION enforce_threshold_crossing_alternates();--> statement-breakpoint

-- ── campaign_milestones (§20) ───────────────────────────────────────────────
-- §20: "First pre-order, halfway, threshold met, and campaign ended may appear
-- once as a milestone then move to history." Once is a unique index; moving to
-- history is the acknowledgement, which is the only column the app may update.
CREATE TABLE "campaign_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,

	-- Moved to history. Until then it is Act rank 5's optional milestone update.
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text
);--> statement-breakpoint

ALTER TABLE "campaign_milestones" ADD CONSTRAINT "campaign_milestones_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id");--> statement-breakpoint

ALTER TABLE "campaign_milestones" ADD CONSTRAINT "campaign_milestones_kind_known"
  CHECK ("kind" IN ('first_preorder', 'halfway', 'threshold_met', 'campaign_ended'));--> statement-breakpoint

CREATE UNIQUE INDEX "campaign_milestones_kind_idx"
  ON "campaign_milestones" ("campaign_id", "kind");--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_milestone_history_one_way()
RETURNS trigger AS $$
BEGIN
  IF NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."campaign_id" IS DISTINCT FROM OLD."campaign_id"
     OR NEW."occurred_at" IS DISTINCT FROM OLD."occurred_at"
  THEN
    RAISE EXCEPTION 'a milestone records what happened and cannot be rewritten (§20)';
  END IF;
  IF OLD."acknowledged_at" IS NOT NULL AND NEW."acknowledged_at" IS NULL THEN
    RAISE EXCEPTION 'a milestone moved to history does not come back (§20)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER campaign_milestone_history_one_way
  BEFORE UPDATE ON "campaign_milestones"
  FOR EACH ROW EXECUTE FUNCTION enforce_milestone_history_one_way();--> statement-breakpoint

-- ── act_rank_corrections (§20, §31.9) ───────────────────────────────────────
-- §20: "Store every later correction/dismissal/reclassification of the ranked
-- action with prior rank, reason, actor, and time."
--
-- All four are NOT NULL and the reason is CHECKed non-blank, because §31.9 counts
-- these as the next-action correction rate — one of the four Founder scoreboard
-- metrics — and a correction with no reason is a number with no explanation
-- behind it. Insert-only: a correction rate computed over an editable table is a
-- metric that can be improved without improving anything.
--
-- The documented safety override of §20's ranking is a row here too, with kind
-- `safety_override`. It is the same shape — prior rank, reason, actor, time — and
-- giving it its own table would leave two places to look for why the Founder was
-- shown what they were shown.
CREATE TABLE "act_rank_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,

	"action_kind" text NOT NULL,
	"correction_kind" text NOT NULL,

	"prior_rank" integer NOT NULL,
	-- NULL on a dismissal: it was not re-ranked, it was withdrawn.
	"new_rank" integer,

	"reason" text NOT NULL,
	"actor" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,

	-- What was on screen when it was corrected. The record it pointed at, so a
	-- later review can see whether the action was real and merely mis-ranked.
	"source_table" text,
	"source_id" text,

	-- A safety override applies until it is withdrawn; everything else is a
	-- one-time record of a judgement.
	"withdrawn_at" timestamp with time zone
);--> statement-breakpoint

ALTER TABLE "act_rank_corrections" ADD CONSTRAINT "act_rank_corrections_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id");--> statement-breakpoint

ALTER TABLE "act_rank_corrections" ADD CONSTRAINT "act_rank_corrections_action_known"
  CHECK ("action_kind" IN (
    'safety_compliance_blocker',
    'delivery_refund_date_review',
    'unanswered_backer_question',
    'required_campaign_update',
    'optional_milestone_update'
  ));--> statement-breakpoint

ALTER TABLE "act_rank_corrections" ADD CONSTRAINT "act_rank_corrections_kind_known"
  CHECK ("correction_kind" IN ('correction', 'dismissal', 'reclassification', 'safety_override'));--> statement-breakpoint

ALTER TABLE "act_rank_corrections" ADD CONSTRAINT "act_rank_corrections_reason_present"
  CHECK (btrim("reason") <> '' AND btrim("actor") <> '');--> statement-breakpoint

ALTER TABLE "act_rank_corrections" ADD CONSTRAINT "act_rank_corrections_ranks_valid"
  CHECK ("prior_rank" BETWEEN 1 AND 5 AND ("new_rank" IS NULL OR "new_rank" BETWEEN 1 AND 5));--> statement-breakpoint

-- A dismissal has no new rank; a reclassification must state one, or it has not
-- reclassified anything.
ALTER TABLE "act_rank_corrections" ADD CONSTRAINT "act_rank_corrections_new_rank_shape" CHECK (
  ("correction_kind" = 'dismissal' AND "new_rank" IS NULL)
  OR ("correction_kind" = 'reclassification' AND "new_rank" IS NOT NULL)
  OR "correction_kind" IN ('correction', 'safety_override')
);--> statement-breakpoint

CREATE INDEX "act_rank_corrections_campaign_idx"
  ON "act_rank_corrections" ("campaign_id", "occurred_at");--> statement-breakpoint

-- Only one safety override may be in force for a campaign at a time. Two would
-- make "which one changed the ranking" unanswerable from the record.
CREATE UNIQUE INDEX "act_rank_corrections_one_live_override_idx"
  ON "act_rank_corrections" ("campaign_id")
  WHERE "correction_kind" = 'safety_override' AND "withdrawn_at" IS NULL;--> statement-breakpoint

-- ── Grants ──────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON "founder_campaign_last_seen" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "founder_campaign_last_seen" FROM proovd_app;--> statement-breakpoint

-- The receipt itself is a record of what was rendered; only the acknowledgement
-- may be written after the fact, and the trigger allows it exactly once.
GRANT SELECT, INSERT ON "campaign_home_deliveries" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("acknowledged_at") ON "campaign_home_deliveries" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "campaign_home_deliveries" FROM proovd_app;--> statement-breakpoint

-- A crossing happened. The notification ids are confirmed afterwards; nothing
-- else about it may move, and it may never be removed — §33.6.10 reconciles the
-- notifications against these rows.
GRANT SELECT, INSERT ON "campaign_threshold_crossings" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("founder_notification_id", "internal_notification_id")
  ON "campaign_threshold_crossings" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "campaign_threshold_crossings" FROM proovd_app;--> statement-breakpoint

GRANT SELECT, INSERT ON "campaign_milestones" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("acknowledged_at", "acknowledged_by") ON "campaign_milestones" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "campaign_milestones" FROM proovd_app;--> statement-breakpoint

-- §31.9 counts these. Insert-only, apart from withdrawing a safety override —
-- which is itself a recorded act, not an edit of the original judgement.
GRANT SELECT, INSERT ON "act_rank_corrections" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("withdrawn_at") ON "act_rank_corrections" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "act_rank_corrections" FROM proovd_app;
