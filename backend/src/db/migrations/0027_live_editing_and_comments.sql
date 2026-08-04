-- ── Live editing, the comment thread, and mid-campaign Creators ─────────────
--
-- Phase 17b (§20, §15, §18, §2.2, §33.6.12, §33.6.13). The changes people make
-- while a campaign runs, as distinct from 17a's read surfaces.
--
--   `campaign_live_edits`      §20's "directly allowed, **with version
--                              history**". Append-only, one row per direct edit,
--                              carrying prior and new value.
--   `campaign_change_requests` a column-two ask. The Founder cannot apply it;
--                              Admin decides and applies it through Phase 12b's
--                              materiality machine.
--   `campaign_comments`        §18's one general thread plus one per update.
--   `campaign_comment_flags`   §18: "Flagging routes to Admin." No automatic
--                              removal — a flag is a request for a person.
--   `campaign_backer_numbers`  the per-campaign `Backer ###` sequence, so the
--                              displayed number is derived from nothing about
--                              the person.
--
--   **No `materiality` column on `campaign_live_edits`.** A direct edit is not
--   classified — §20 decides by field, and the tier register is what decides.
--   Storing a classification here would create a second, unreviewed materiality
--   judgement beside §15's, made by whoever wrote the route.
--
--   **No moderation queue table and no auto-hide.** §18 gives no automatic
--   moderation and §1 rule 6 forbids inventing one, so a flagged comment stays
--   visible until an Admin decides. Hiding on flag would let one reader remove
--   another's comment.

-- ── campaign_live_edits (§20 column 1) ──────────────────────────────────────
CREATE TABLE "campaign_live_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,

	-- Which register entry authorised this. Stored so a later reviewer can see
	-- the rule that let it through, not merely that it happened.
	"surface" text NOT NULL,
	"field" text NOT NULL,

	-- §20: "with version history". Both halves, always — a history with only the
	-- new value cannot answer what was changed.
	"prior_value" jsonb,
	"new_value" jsonb,

	-- The FAQ row, reward package, or whatever else the edit targeted.
	"target_id" uuid,

	"actor" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "campaign_live_edits" ADD CONSTRAINT "campaign_live_edits_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id");--> statement-breakpoint

ALTER TABLE "campaign_live_edits" ADD CONSTRAINT "campaign_live_edits_surface_known"
  CHECK ("surface" IN ('build', 'faq', 'reward_package', 'reservation', 'agreement', 'campaign'));--> statement-breakpoint

ALTER TABLE "campaign_live_edits" ADD CONSTRAINT "campaign_live_edits_actor_present"
  CHECK (btrim("actor") <> '' AND btrim("field") <> '');--> statement-breakpoint

CREATE INDEX "campaign_live_edits_campaign_idx"
  ON "campaign_live_edits" ("campaign_id", "occurred_at");--> statement-breakpoint

-- ── campaign_change_requests (§20 column 2) ─────────────────────────────────
-- §15: "A Founder cannot publish a material change directly." So a column-two
-- edit is a *request*: the Founder states what they want and why, and Admin
-- decides. Applying it runs through Phase 12b's `recordMaterialChange`, which is
-- what creates the version and the reacceptance tasks — this table is the ask,
-- never the change.
CREATE TABLE "campaign_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,

	"surface" text NOT NULL,
	"field" text NOT NULL,
	"target_id" uuid,

	-- What is stored now, captured when the request was made, and what the
	-- Founder is asking for. The current value is read from the row rather than
	-- supplied — 16a's rule about a caller who can supply both halves.
	"current_value" jsonb,
	"requested_value" jsonb,

	-- §15 records a reason for every classified change; the ask carries one too,
	-- because Admin classifies on it.
	"reason" text NOT NULL,

	"status" text DEFAULT 'open' NOT NULL,

	-- Admin's decision. `material_change_id` points at the §15 record that
	-- actually applied it, so the ask and the change are linked in one direction
	-- and neither is derived from the other.
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"material_change_id" uuid,

	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "campaign_change_requests" ADD CONSTRAINT "campaign_change_requests_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id");--> statement-breakpoint

ALTER TABLE "campaign_change_requests" ADD CONSTRAINT "campaign_change_requests_change_fk"
  FOREIGN KEY ("material_change_id") REFERENCES "material_changes"("id");--> statement-breakpoint

ALTER TABLE "campaign_change_requests" ADD CONSTRAINT "campaign_change_requests_status_known"
  CHECK ("status" IN ('open', 'applied', 'declined'));--> statement-breakpoint

ALTER TABLE "campaign_change_requests" ADD CONSTRAINT "campaign_change_requests_reason_present"
  CHECK (btrim("reason") <> '' AND btrim("requested_by") <> '');--> statement-breakpoint

-- A decided request names who decided it and why. A decision with neither is a
-- change nobody can review (§25.6's shape, applied to an editorial decision).
ALTER TABLE "campaign_change_requests" ADD CONSTRAINT "campaign_change_requests_decision_complete" CHECK (
  ("status" = 'open' AND "decided_by" IS NULL AND "decided_at" IS NULL)
  OR ("status" <> 'open' AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL
      AND "decision_reason" IS NOT NULL AND btrim("decision_reason") <> '')
);--> statement-breakpoint

-- An applied request points at the §15 change that applied it. Without this an
-- "applied" row could exist with no version and no reacceptance behind it, which
-- is exactly the state §33.6.12 is about.
ALTER TABLE "campaign_change_requests" ADD CONSTRAINT "campaign_change_requests_applied_has_change" CHECK (
  "status" <> 'applied' OR "material_change_id" IS NOT NULL
);--> statement-breakpoint

CREATE INDEX "campaign_change_requests_campaign_idx"
  ON "campaign_change_requests" ("campaign_id", "status", "created_at");--> statement-breakpoint

-- One open request per field per target. A second ask for the same field is the
-- Founder changing their mind, not a second decision for Admin to make.
CREATE UNIQUE INDEX "campaign_change_requests_one_open_idx"
  ON "campaign_change_requests" ("campaign_id", "surface", "field", COALESCE("target_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "status" = 'open';--> statement-breakpoint

-- A decided request is history. Reopening it would lose who decided what.
CREATE OR REPLACE FUNCTION enforce_change_request_decided_once()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'open' THEN
    RAISE EXCEPTION 'a change request is decided once (§15, §20)';
  END IF;
  IF NEW."campaign_id" IS DISTINCT FROM OLD."campaign_id"
     OR NEW."field" IS DISTINCT FROM OLD."field"
     OR NEW."surface" IS DISTINCT FROM OLD."surface"
     OR NEW."requested_value" IS DISTINCT FROM OLD."requested_value"
     OR NEW."requested_by" IS DISTINCT FROM OLD."requested_by"
  THEN
    RAISE EXCEPTION 'a change request records what was asked for and cannot be rewritten (§20)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER campaign_change_request_decided_once
  BEFORE UPDATE ON "campaign_change_requests"
  FOR EACH ROW EXECUTE FUNCTION enforce_change_request_decided_once();--> statement-breakpoint

-- ── campaign_backer_numbers (§18) ───────────────────────────────────────────
-- §18: "Display `Backer ###` or a chosen display name, never email local-part by
-- default." The number is a per-campaign sequence assigned on first comment, so
-- it is derived from nothing about the person — a number derived from an id or an
-- address is a handle that leaks whichever value produced it.
CREATE TABLE "campaign_backer_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"backer_identity_id" uuid NOT NULL,
	"backer_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "campaign_backer_numbers" ADD CONSTRAINT "campaign_backer_numbers_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id");--> statement-breakpoint

ALTER TABLE "campaign_backer_numbers" ADD CONSTRAINT "campaign_backer_numbers_identity_fk"
  FOREIGN KEY ("backer_identity_id") REFERENCES "backer_identities"("id");--> statement-breakpoint

ALTER TABLE "campaign_backer_numbers" ADD CONSTRAINT "campaign_backer_numbers_positive"
  CHECK ("backer_number" >= 1);--> statement-breakpoint

CREATE UNIQUE INDEX "campaign_backer_numbers_identity_idx"
  ON "campaign_backer_numbers" ("campaign_id", "backer_identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_backer_numbers_number_idx"
  ON "campaign_backer_numbers" ("campaign_id", "backer_number");--> statement-breakpoint

-- ── campaign_comments (§18) ─────────────────────────────────────────────────
-- One general thread and one per update. `update_id` NULL is the general thread —
-- a per-update thread is a filter, not a different kind of record.
CREATE TABLE "campaign_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"update_id" uuid,

	-- §18: "Only a magic-link-authenticated Backer may post." Not nullable: there
	-- is no anonymous comment and no Founder comment path in §18.
	"backer_identity_id" uuid NOT NULL,

	-- What is displayed. Resolved at post time and stored, so a later display-name
	-- change does not silently rewrite what other people already read.
	"author_display" text NOT NULL,

	"body" text NOT NULL,

	-- §18 gives no automatic moderation; a removal is an Admin act with a reason.
	"visibility" text DEFAULT 'visible' NOT NULL,
	"removed_by" text,
	"removed_at" timestamp with time zone,
	"removed_reason" text,

	"posted_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "campaign_comments" ADD CONSTRAINT "campaign_comments_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id");--> statement-breakpoint
ALTER TABLE "campaign_comments" ADD CONSTRAINT "campaign_comments_update_fk"
  FOREIGN KEY ("update_id") REFERENCES "campaign_updates"("id");--> statement-breakpoint
ALTER TABLE "campaign_comments" ADD CONSTRAINT "campaign_comments_identity_fk"
  FOREIGN KEY ("backer_identity_id") REFERENCES "backer_identities"("id");--> statement-breakpoint

ALTER TABLE "campaign_comments" ADD CONSTRAINT "campaign_comments_body_present"
  CHECK (btrim("body") <> '' AND btrim("author_display") <> '');--> statement-breakpoint

ALTER TABLE "campaign_comments" ADD CONSTRAINT "campaign_comments_visibility_known"
  CHECK ("visibility" IN ('visible', 'removed'));--> statement-breakpoint

-- A removal names who did it and why (§25.6). A comment removed by nobody, for
-- no reason, is indistinguishable from one that was never posted.
ALTER TABLE "campaign_comments" ADD CONSTRAINT "campaign_comments_removal_complete" CHECK (
  "visibility" = 'visible'
  OR ("removed_by" IS NOT NULL AND "removed_at" IS NOT NULL
      AND "removed_reason" IS NOT NULL AND btrim("removed_reason") <> '')
);--> statement-breakpoint

-- §18: the displayed name must never be the Backer's email local part. The
-- service refuses it on the chosen name; this refuses an address outright, at
-- the level no route can bypass.
ALTER TABLE "campaign_comments" ADD CONSTRAINT "campaign_comments_display_not_an_address"
  CHECK ("author_display" NOT LIKE '%@%');--> statement-breakpoint

CREATE INDEX "campaign_comments_thread_idx"
  ON "campaign_comments" ("campaign_id", "update_id", "posted_at");--> statement-breakpoint
CREATE INDEX "campaign_comments_identity_idx"
  ON "campaign_comments" ("backer_identity_id");--> statement-breakpoint

-- A posted comment is what people read. The body and its author are fixed; only
-- the moderation decision may be written afterwards.
CREATE OR REPLACE FUNCTION enforce_comment_immutability()
RETURNS trigger AS $$
BEGIN
  IF NEW."body" IS DISTINCT FROM OLD."body"
     OR NEW."author_display" IS DISTINCT FROM OLD."author_display"
     OR NEW."backer_identity_id" IS DISTINCT FROM OLD."backer_identity_id"
     OR NEW."campaign_id" IS DISTINCT FROM OLD."campaign_id"
     OR NEW."update_id" IS DISTINCT FROM OLD."update_id"
     OR NEW."posted_at" IS DISTINCT FROM OLD."posted_at"
  THEN
    RAISE EXCEPTION 'a posted comment is what people read and cannot be rewritten (§18)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER campaign_comment_immutability
  BEFORE UPDATE ON "campaign_comments"
  FOR EACH ROW EXECUTE FUNCTION enforce_comment_immutability();--> statement-breakpoint

-- ── campaign_comment_flags (§18) ────────────────────────────────────────────
-- §18: "Flagging routes to Admin." One open flag per comment per reporter, so a
-- reader cannot inflate a queue by flagging twice. The comment stays visible.
CREATE TABLE "campaign_comment_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,

	-- Who reported it. A Backer identity, or `founder:<id>` — §18 does not say
	-- only Backers may flag, and a Founder seeing an abusive comment on their own
	-- campaign is the obvious reporter.
	"reported_by" text NOT NULL,
	"reason" text NOT NULL,

	"state" text DEFAULT 'open' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_reason" text,

	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "campaign_comment_flags" ADD CONSTRAINT "campaign_comment_flags_comment_fk"
  FOREIGN KEY ("comment_id") REFERENCES "campaign_comments"("id");--> statement-breakpoint
ALTER TABLE "campaign_comment_flags" ADD CONSTRAINT "campaign_comment_flags_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id");--> statement-breakpoint

ALTER TABLE "campaign_comment_flags" ADD CONSTRAINT "campaign_comment_flags_state_known"
  CHECK ("state" IN ('open', 'upheld', 'dismissed'));--> statement-breakpoint

ALTER TABLE "campaign_comment_flags" ADD CONSTRAINT "campaign_comment_flags_reason_present"
  CHECK (btrim("reason") <> '' AND btrim("reported_by") <> '');--> statement-breakpoint

ALTER TABLE "campaign_comment_flags" ADD CONSTRAINT "campaign_comment_flags_decision_complete" CHECK (
  ("state" = 'open' AND "decided_by" IS NULL)
  OR ("state" <> 'open' AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL
      AND "decision_reason" IS NOT NULL AND btrim("decision_reason") <> '')
);--> statement-breakpoint

CREATE UNIQUE INDEX "campaign_comment_flags_one_open_idx"
  ON "campaign_comment_flags" ("comment_id", "reported_by")
  WHERE "state" = 'open';--> statement-breakpoint

CREATE INDEX "campaign_comment_flags_queue_idx"
  ON "campaign_comment_flags" ("campaign_id", "state", "created_at");--> statement-breakpoint

-- ── Mid-campaign Creator addition (§20, §33.6.13) ───────────────────────────
-- §20: "Show exact remaining time, current Campaign kit, and adjusted reasonable
-- deliverables. Use the same compensation matrix and the campaign's locked
-- high-effort result."
--
-- The association already records `roster_membership = 'mid_campaign'` (§23.4,
-- Phase 03) and the tracking link already records its own `activated_at` (Phase
-- 12a), which is what makes "no retroactive attribution" true without any new
-- column — a click before that Creator's own activation is already recorded
-- `ignored/before_activation` by the 14b ingest. What is missing is the *terms
-- the Creator was shown*, which are computed from the remaining time and must be
-- stored as they were: a Creator who joins with nine days left accepted a
-- nine-day deliverable, and recomputing it later would rewrite what they agreed.
CREATE TABLE "mid_campaign_additions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,

	-- The facts as of the moment the opportunity was opened.
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"campaign_close_at" timestamp with time zone NOT NULL,
	"remaining_hours" integer NOT NULL,

	-- §20: "the campaign's locked high-effort result" — copied, not read later.
	-- The classification locked at listing payment (§12) and a later read could
	-- only differ if something went wrong; storing it makes that visible.
	"high_effort_at_join" boolean,

	-- The adjusted deliverable the Creator was actually shown and accepted.
	"adjusted_deliverables" text NOT NULL,

	"opened_by" text NOT NULL
);--> statement-breakpoint

ALTER TABLE "mid_campaign_additions" ADD CONSTRAINT "mid_campaign_additions_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "campaign_affiliate_associations"("id");--> statement-breakpoint
ALTER TABLE "mid_campaign_additions" ADD CONSTRAINT "mid_campaign_additions_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id");--> statement-breakpoint

ALTER TABLE "mid_campaign_additions" ADD CONSTRAINT "mid_campaign_additions_remaining_positive"
  CHECK ("remaining_hours" > 0);--> statement-breakpoint

ALTER TABLE "mid_campaign_additions" ADD CONSTRAINT "mid_campaign_additions_deliverables_present"
  CHECK (btrim("adjusted_deliverables") <> '');--> statement-breakpoint

-- One addition record per association. A Creator joins a campaign once.
CREATE UNIQUE INDEX "mid_campaign_additions_association_idx"
  ON "mid_campaign_additions" ("association_id");--> statement-breakpoint

CREATE INDEX "mid_campaign_additions_campaign_idx"
  ON "mid_campaign_additions" ("campaign_id", "opened_at");--> statement-breakpoint

-- The terms a Creator was shown are what they accepted. Nothing here moves.
CREATE OR REPLACE FUNCTION enforce_mid_campaign_terms_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'the terms a mid-campaign Creator was shown are what they accepted (§20)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER mid_campaign_additions_immutable
  BEFORE UPDATE ON "mid_campaign_additions"
  FOR EACH ROW EXECUTE FUNCTION enforce_mid_campaign_terms_immutable();--> statement-breakpoint

-- ── Grants ──────────────────────────────────────────────────────────────────

-- §20's version history. Insert-only: a history a later statement could edit is
-- not a history of anything.
GRANT SELECT, INSERT ON "campaign_live_edits" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "campaign_live_edits" FROM proovd_app;--> statement-breakpoint

-- The ask is fixed; the decision is written once, and the trigger allows it once.
GRANT SELECT, INSERT, UPDATE ON "campaign_change_requests" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "campaign_change_requests" FROM proovd_app;--> statement-breakpoint

GRANT SELECT, INSERT ON "campaign_backer_numbers" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "campaign_backer_numbers" FROM proovd_app;--> statement-breakpoint

-- A comment is what people read. Only the moderation columns may be written
-- afterwards, and never removed — §18's ended-state contract keeps the page and
-- its history accessible.
GRANT SELECT, INSERT ON "campaign_comments" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("visibility", "removed_by", "removed_at", "removed_reason")
  ON "campaign_comments" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "campaign_comments" FROM proovd_app;--> statement-breakpoint

GRANT SELECT, INSERT ON "campaign_comment_flags" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("state", "decided_by", "decided_at", "decision_reason")
  ON "campaign_comment_flags" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "campaign_comment_flags" FROM proovd_app;--> statement-breakpoint

GRANT SELECT, INSERT ON "mid_campaign_additions" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "mid_campaign_additions" FROM proovd_app;
