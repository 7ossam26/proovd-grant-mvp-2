-- Phase 21b — completion, future work, satisfaction, and resolution.
-- Spec §22.8, §22.9, §22.10, §22.11, §31.8, §23.1, §23.4, §25.6, §33.10.5–10.
--
-- The last lifecycle migration. Every table here records a DECISION about
-- facts that already exist, which is why none of them stores an amount, a
-- percentage, or a provider id: §22.8 reads money records rather than moving
-- money, and §22.9's acceptance is explicitly a record that grants nothing.

-- ── §22.8 Creator completion ────────────────────────────────────────────────
-- One status per association, assigned only by Admin, with the five criteria's
-- findings stored as the evidence for the decision (§22.8: "Store status,
-- completion date, Admin, evidence, waivers, and disqualifying reason").
--
-- `criteria_findings` is the evaluated register at decision time, not a live
-- read: §22.8 asks for the evidence the Admin acted on, and a later change to
-- a Creator's records must not silently rewrite why a past decision was made.
CREATE TABLE "creator_completion_statuses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "association_id" uuid NOT NULL REFERENCES "campaign_affiliate_associations"("id"),
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id"),

  "status" text NOT NULL,
  "completed_at" timestamptz NOT NULL DEFAULT now(),

  /* §22.8: the Admin who decided. Never a system actor — the Spec says "Only
     Admin can assign it", so a blank or automated decider is not a decision. */
  "decided_by" text NOT NULL,

  /* The five findings as evaluated, and the Admin's own note. */
  "criteria_findings" jsonb NOT NULL,
  "evidence_note" text NOT NULL,

  /* §22.8: "disqualifying reason". Required for a disqualification and refused
     on a completion — a completion carrying a disqualifying reason is two
     answers in one row. */
  "disqualifying_reason" text,

  /* §22.9: "a later correction to completion status changes eligibility
     without deleting history." A correction supersedes; it never edits. */
  "superseded_at" timestamptz,
  "superseded_by_id" uuid,

  "created_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "completion_status_value" CHECK (
    "status" IN ('successfully_completed', 'completion_disqualified')
  ),
  CONSTRAINT "completion_decided_by_present" CHECK (btrim("decided_by") <> ''),
  CONSTRAINT "completion_evidence_present" CHECK (btrim("evidence_note") <> ''),
  /* §22.8 + §29.4: a disqualification names the actual behaviour; a completion
     has nothing to disqualify and must not carry a reason. */
  CONSTRAINT "completion_reason_matches_status" CHECK (
    ("status" = 'completion_disqualified'
      AND "disqualifying_reason" IS NOT NULL
      AND btrim("disqualifying_reason") <> '')
    OR ("status" = 'successfully_completed' AND "disqualifying_reason" IS NULL)
  ),
  /* The findings are the five-criterion register, stored as an array. */
  CONSTRAINT "completion_findings_is_array" CHECK (jsonb_typeof("criteria_findings") = 'array')
);--> statement-breakpoint

/* One live status per association; a correction supersedes and the superseded
   row survives (§22.9). */
CREATE UNIQUE INDEX "completion_status_one_live_idx"
  ON "creator_completion_statuses" ("association_id")
  WHERE "superseded_at" IS NULL;--> statement-breakpoint

CREATE INDEX "completion_status_campaign_idx"
  ON "creator_completion_statuses" ("campaign_id");--> statement-breakpoint

/* Immutable apart from supersession. A decision that could be edited is not
   evidence of anything (§25.6, the 0024 override reasoning). */
CREATE OR REPLACE FUNCTION enforce_completion_status_immutability()
RETURNS trigger AS $$
BEGIN
  IF OLD."superseded_at" IS NOT NULL THEN
    RAISE EXCEPTION 'a superseded completion status is history and cannot change (§22.9)';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status"
     OR NEW."association_id" IS DISTINCT FROM OLD."association_id"
     OR NEW."campaign_id" IS DISTINCT FROM OLD."campaign_id"
     OR NEW."decided_by" IS DISTINCT FROM OLD."decided_by"
     OR NEW."criteria_findings" IS DISTINCT FROM OLD."criteria_findings"
     OR NEW."evidence_note" IS DISTINCT FROM OLD."evidence_note"
     OR NEW."disqualifying_reason" IS DISTINCT FROM OLD."disqualifying_reason"
     OR NEW."completed_at" IS DISTINCT FROM OLD."completed_at" THEN
    RAISE EXCEPTION 'a completion decision is immutable; record a correction instead (§22.8, §25.6)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "completion_status_immutable"
  BEFORE UPDATE ON "creator_completion_statuses"
  FOR EACH ROW EXECUTE FUNCTION enforce_completion_status_immutability();--> statement-breakpoint

-- ── §22.9 the work-again request ────────────────────────────────────────────
-- Carries no campaign to create, no terms, no percentage, and no amount.
-- §33.10.8: "accept/decline creates no campaign and bypasses no
-- cooldown/readiness", and the strongest form of that is a record with nothing
-- in it that a campaign could be built from.
CREATE TABLE "work_again_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  /* §22.9: "Store original campaign, Founder, Creator, request time, status,
     response, and notifications." */
  "original_campaign_id" uuid NOT NULL REFERENCES "campaigns"("id"),
  "association_id" uuid NOT NULL REFERENCES "campaign_affiliate_associations"("id"),
  "founder_user_id" text NOT NULL,

  "status" text NOT NULL DEFAULT 'requested',
  "message" text NOT NULL,

  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "responded_at" timestamptz,
  "response_note" text,

  /* The completion status this request was made against. §22.9: "a later
     correction to completion status changes eligibility without deleting
     history" — so the request keeps pointing at what made it eligible. */
  "completion_status_id" uuid NOT NULL REFERENCES "creator_completion_statuses"("id"),

  "created_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "work_again_status_value" CHECK (
    "status" IN ('requested', 'accepted', 'declined', 'withdrawn')
  ),
  CONSTRAINT "work_again_message_present" CHECK (btrim("message") <> ''),
  CONSTRAINT "work_again_response_pairing" CHECK (
    ("status" = 'requested' AND "responded_at" IS NULL)
    OR ("status" <> 'requested' AND "responded_at" IS NOT NULL)
  )
);--> statement-breakpoint

/* One open request per (campaign, Creator). A Founder who asks twice while the
   first is unanswered is asking twice, not asking again (§31.6's shape). */
CREATE UNIQUE INDEX "work_again_one_open_idx"
  ON "work_again_requests" ("original_campaign_id", "association_id")
  WHERE "status" = 'requested';--> statement-breakpoint

CREATE INDEX "work_again_association_idx"
  ON "work_again_requests" ("association_id", "requested_at" DESC);--> statement-breakpoint

/* §22.9: eligibility is the completion status, enforced at the database so a
   service bug cannot invite a disqualified Creator. §33.10.7. */
CREATE OR REPLACE FUNCTION enforce_work_again_eligibility()
RETURNS trigger AS $$
DECLARE
  v_status text;
  v_association uuid;
  v_superseded timestamptz;
BEGIN
  SELECT "status", "association_id", "superseded_at"
    INTO v_status, v_association, v_superseded
    FROM "creator_completion_statuses"
   WHERE "id" = NEW."completion_status_id";

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'a work-again request cites a completion status that does not exist (§22.9)';
  END IF;
  IF v_superseded IS NOT NULL THEN
    RAISE EXCEPTION 'a work-again request cannot cite a superseded completion status (§22.9)';
  END IF;
  IF v_status <> 'successfully_completed' THEN
    RAISE EXCEPTION 'only a Creator marked successfully_completed may receive a work-again request (§22.9, §33.10.7)';
  END IF;
  IF v_association <> NEW."association_id" THEN
    RAISE EXCEPTION 'the completion status belongs to a different association (§22.9)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "work_again_eligibility"
  BEFORE INSERT ON "work_again_requests"
  FOR EACH ROW EXECUTE FUNCTION enforce_work_again_eligibility();--> statement-breakpoint

/* A responded request is final. §22.9 gives no path from `declined` back to
   `requested`; a Founder who wants to ask again opens a new request, and the
   Creator's earlier answer survives. */
CREATE OR REPLACE FUNCTION enforce_work_again_finality()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'requested' THEN
    RAISE EXCEPTION 'that request was already answered and cannot change (§22.9)';
  END IF;
  IF NEW."original_campaign_id" IS DISTINCT FROM OLD."original_campaign_id"
     OR NEW."association_id" IS DISTINCT FROM OLD."association_id"
     OR NEW."founder_user_id" IS DISTINCT FROM OLD."founder_user_id"
     OR NEW."completion_status_id" IS DISTINCT FROM OLD."completion_status_id"
     OR NEW."message" IS DISTINCT FROM OLD."message"
     OR NEW."requested_at" IS DISTINCT FROM OLD."requested_at" THEN
    RAISE EXCEPTION 'a work-again request is immutable apart from its response (§22.9)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "work_again_final"
  BEFORE UPDATE ON "work_again_requests"
  FOR EACH ROW EXECUTE FUNCTION enforce_work_again_finality();--> statement-breakpoint

-- ── §22.10 Founder next-campaign readiness ──────────────────────────────────
-- The Admin decision, and ONLY the Admin decision. The cooldown is derived
-- from `campaign_close_at` and has no row here: a stored cooldown date is one
-- that can drift from the anchor, and §29.6's rule about deadlines applies.
CREATE TABLE "founder_next_campaign_readiness" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  /* The campaign whose Founder is being assessed — the previous one. */
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id"),
  "founder_user_id" text NOT NULL,

  "decision" text NOT NULL,
  "decided_by" text NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now(),

  /* §22.10 names "separate Admin-readiness criteria" and fixes no list, so the
     criteria are the Admin's recorded judgement with its basis — never a
     computed score (§31.7's posture). */
  "criteria_note" text NOT NULL,
  "customer_explanation" text NOT NULL,

  "superseded_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "next_readiness_decision_value" CHECK ("decision" IN ('ready', 'not_ready')),
  CONSTRAINT "next_readiness_decided_by_present" CHECK (btrim("decided_by") <> ''),
  CONSTRAINT "next_readiness_criteria_present" CHECK (btrim("criteria_note") <> ''),
  /* §29.4: the Founder is told the actual behaviour, never "policy violation". */
  CONSTRAINT "next_readiness_explanation_present" CHECK (btrim("customer_explanation") <> '')
);--> statement-breakpoint

CREATE UNIQUE INDEX "next_readiness_one_live_idx"
  ON "founder_next_campaign_readiness" ("campaign_id")
  WHERE "superseded_at" IS NULL;--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_next_readiness_immutability()
RETURNS trigger AS $$
BEGIN
  IF OLD."superseded_at" IS NOT NULL THEN
    RAISE EXCEPTION 'a superseded readiness decision is history and cannot change (§25.6)';
  END IF;
  IF NEW."decision" IS DISTINCT FROM OLD."decision"
     OR NEW."campaign_id" IS DISTINCT FROM OLD."campaign_id"
     OR NEW."founder_user_id" IS DISTINCT FROM OLD."founder_user_id"
     OR NEW."decided_by" IS DISTINCT FROM OLD."decided_by"
     OR NEW."criteria_note" IS DISTINCT FROM OLD."criteria_note"
     OR NEW."customer_explanation" IS DISTINCT FROM OLD."customer_explanation" THEN
    RAISE EXCEPTION 'a readiness decision is immutable; record a new one instead (§22.10, §25.6)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "next_readiness_immutable"
  BEFORE UPDATE ON "founder_next_campaign_readiness"
  FOR EACH ROW EXECUTE FUNCTION enforce_next_readiness_immutability();--> statement-breakpoint

-- ── §31.8 Backer satisfaction ───────────────────────────────────────────────
-- One response per reservation, and no consent column of any kind. §31.8:
-- "does not coerce newsletter consent" — the strongest form of that promise is
-- a table with nowhere to put one, which §33.10.10 asserts in
-- `information_schema`.
CREATE TABLE "backer_satisfaction_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "reservation_id" uuid NOT NULL REFERENCES "reservations"("id"),
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id"),
  "backer_identity_id" uuid NOT NULL REFERENCES "backer_identities"("id"),

  "scale" text NOT NULL,
  /* Exactly one of the two answers, matching the scale. */
  "satisfied" boolean,
  "rating" integer,

  /* §31.8: "then optional reason". Nullable, and nothing requires it. */
  "reason" text,

  /* §31.8: "a negative response creates an owned Admin follow-up task". */
  "is_negative" boolean NOT NULL,
  "followup_case_id" uuid REFERENCES "support_cases"("id"),

  "answered_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "satisfaction_scale_value" CHECK ("scale" IN ('binary', 'rating_1_5')),
  CONSTRAINT "satisfaction_answer_matches_scale" CHECK (
    ("scale" = 'binary' AND "satisfied" IS NOT NULL AND "rating" IS NULL)
    OR ("scale" = 'rating_1_5' AND "rating" IS NOT NULL AND "satisfied" IS NULL)
  ),
  CONSTRAINT "satisfaction_rating_range" CHECK (
    "rating" IS NULL OR ("rating" >= 1 AND "rating" <= 5)
  ),
  /* A negative answer must have opened its case; a positive one must not have.
     §31.8's task is a response to a real problem, not a queue of shrugs. */
  CONSTRAINT "satisfaction_followup_matches_negative" CHECK (
    ("is_negative" = true AND "followup_case_id" IS NOT NULL)
    OR ("is_negative" = false AND "followup_case_id" IS NULL)
  )
);--> statement-breakpoint

/* One response per reservation, ever. §30: a person who answered is never
   asked again, and the database is what makes "no second ask" true. */
CREATE UNIQUE INDEX "satisfaction_one_per_reservation_idx"
  ON "backer_satisfaction_responses" ("reservation_id");--> statement-breakpoint

CREATE INDEX "satisfaction_campaign_idx"
  ON "backer_satisfaction_responses" ("campaign_id", "answered_at" DESC);--> statement-breakpoint

/* The answer is immutable; only the optional reason may be added afterwards,
   because §31.8's flow records the click first and asks for the reason second.
   Changing the answer itself would rewrite a fact §31.9 measures. */
CREATE OR REPLACE FUNCTION enforce_satisfaction_answer_immutability()
RETURNS trigger AS $$
BEGIN
  IF NEW."scale" IS DISTINCT FROM OLD."scale"
     OR NEW."satisfied" IS DISTINCT FROM OLD."satisfied"
     OR NEW."rating" IS DISTINCT FROM OLD."rating"
     OR NEW."is_negative" IS DISTINCT FROM OLD."is_negative"
     OR NEW."reservation_id" IS DISTINCT FROM OLD."reservation_id"
     OR NEW."answered_at" IS DISTINCT FROM OLD."answered_at" THEN
    RAISE EXCEPTION 'a satisfaction answer is recorded once; only the optional reason may follow (§31.8)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "satisfaction_answer_immutable"
  BEFORE UPDATE ON "backer_satisfaction_responses"
  FOR EACH ROW EXECUTE FUNCTION enforce_satisfaction_answer_immutability();--> statement-breakpoint

-- ── §22.11 campaign resolution ──────────────────────────────────────────────
-- The resolution record. §22.11 is a conjunction over §21's nine reconciliation
-- items, so this stores WHICH items were verified at the moment of resolution
-- rather than re-deriving it later — the same reasoning as the completion
-- findings above.
CREATE TABLE "campaign_resolutions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id"),

  "resolved_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_by" text NOT NULL,

  /* The §21 items verified when resolution was recorded. */
  "verified_items" jsonb NOT NULL,

  /* §22.11: "Fulfillment may remain active separately until `fulfilled`."
     Recorded as a fact at resolution time so the two states are visibly
     independent rather than merely documented as such. */
  "fulfillment_active" boolean NOT NULL,

  "note" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "resolution_resolved_by_present" CHECK (btrim("resolved_by") <> ''),
  CONSTRAINT "resolution_note_present" CHECK (btrim("note") <> ''),
  CONSTRAINT "resolution_items_is_array" CHECK (jsonb_typeof("verified_items") = 'array')
);--> statement-breakpoint

CREATE UNIQUE INDEX "campaign_resolutions_campaign_idx"
  ON "campaign_resolutions" ("campaign_id");--> statement-breakpoint

-- ── Grants ──────────────────────────────────────────────────────────────────
-- The house pattern: insert what is decided, update only what may legitimately
-- move, and never DELETE a decision.
GRANT SELECT, INSERT ON "creator_completion_statuses" TO "proovd_app";--> statement-breakpoint
GRANT UPDATE ("superseded_at", "superseded_by_id") ON "creator_completion_statuses" TO "proovd_app";--> statement-breakpoint
REVOKE DELETE ON "creator_completion_statuses" FROM "proovd_app";--> statement-breakpoint

GRANT SELECT, INSERT ON "work_again_requests" TO "proovd_app";--> statement-breakpoint
GRANT UPDATE ("status", "responded_at", "response_note") ON "work_again_requests" TO "proovd_app";--> statement-breakpoint
REVOKE DELETE ON "work_again_requests" FROM "proovd_app";--> statement-breakpoint

GRANT SELECT, INSERT ON "founder_next_campaign_readiness" TO "proovd_app";--> statement-breakpoint
GRANT UPDATE ("superseded_at") ON "founder_next_campaign_readiness" TO "proovd_app";--> statement-breakpoint
REVOKE DELETE ON "founder_next_campaign_readiness" FROM "proovd_app";--> statement-breakpoint

GRANT SELECT, INSERT ON "backer_satisfaction_responses" TO "proovd_app";--> statement-breakpoint
GRANT UPDATE ("reason") ON "backer_satisfaction_responses" TO "proovd_app";--> statement-breakpoint
REVOKE DELETE ON "backer_satisfaction_responses" FROM "proovd_app";--> statement-breakpoint

GRANT SELECT, INSERT ON "campaign_resolutions" TO "proovd_app";--> statement-breakpoint
REVOKE UPDATE, DELETE ON "campaign_resolutions" FROM "proovd_app";
