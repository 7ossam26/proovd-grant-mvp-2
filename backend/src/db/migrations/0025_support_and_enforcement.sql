-- ── Support operations, suspension/kill, and the human relationship touch ────
--
-- Phase 16b (§26.7, §26.8, §27.8, §29.7, §33.9.10, §33.9.11). The case-and-action
-- half of Phase 16: what Admin *does*, as distinct from 16a's read-and-reconcile
-- surfaces.
--
-- Four tables, and one that is deliberately absent:
--
--   `support_cases`                 §27.8's stable reference, topic, owner, and
--                                   business-day response due time.
--   `support_case_messages`         the thread. Append-only, and every row
--                                   declares whether it is customer-facing —
--                                   §33.9.11's rule is about which column a raw
--                                   provider code may be read out of.
--   `support_case_handoffs`         §26.8's four required facts on owner change.
--   `campaign_enforcement_actions`  §26.7's suspend/kill decision, with its
--                                   reason category AND free text.
--   `relationship_touches`          §26.8's first-cohort one-offs.
--
--   **No `timeline_events` table.** §26.8 says the timeline "composes existing
--   events", and the phase trap says a second event store that drifts from the
--   first is worse than no timeline. The timeline is a read across the tables
--   above plus everything Phases 03–16a already write. There is no writer.
--
-- Schema instructions that carry through:
--   §27.8  — the response due time is a *business-day* deadline, so §29.6
--            applies: it is stored with the calendar version that produced it
--            and a trigger refuses to move it. A support promise already made to
--            a person is exactly what §29.6 protects.
--   §26.7  — reason category AND free text. A category alone is a
--            classification nobody can review; free text alone is a decision
--            nobody can count. Both NOT NULL, both CHECKed non-blank.
--   §26.8  — a relationship touch is a one-off. UNIQUE per campaign and kind,
--            insert-only, and there is no schedule, recurrence, or template
--            column anywhere on it (§30: no automated engagement).
--   §23.5  — a successful SetupIntent stays historical even after a kill closes
--            the reservation. Nothing here writes to `setup_intent_id`.

CREATE TYPE "public"."support_case_status" AS ENUM ('open', 'awaiting_founder', 'awaiting_customer', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."support_message_direction" AS ENUM ('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."enforcement_action" AS ENUM ('suspend', 'kill');--> statement-breakpoint
CREATE TYPE "public"."enforcement_phase" AS ENUM ('pre_capture', 'post_capture');--> statement-breakpoint

-- ── support_cases (§26.7, §27.8) ────────────────────────────────────────────
CREATE TABLE "support_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

	-- §27.8: "Support submission returns case ID". A stable, quotable reference
	-- the customer reads in Appendix B.8 — not the UUID, which nobody can read
	-- back over a phone call.
	"reference" text NOT NULL,

	"topic" text NOT NULL,
	"owner" text NOT NULL,
	"status" "support_case_status" DEFAULT 'open' NOT NULL,

	-- Who asked. A Backer has no account (§5.4), so the case anchors to the
	-- pseudonymous per-campaign identity; a Founder or Creator anchors to a user.
	"requester_kind" text NOT NULL,
	"backer_identity_id" uuid,
	"requester_user_id" text,
	"requester_email" text NOT NULL,

	-- §26.8: the case preserves all context, so a user is never asked to repeat
	-- campaign, reservation, or charge facts the system already holds.
	"campaign_id" uuid,
	"reservation_id" uuid,
	"association_id" uuid,

	-- §27.8's one-business-day promise, computed once from the committed
	-- calendar and stored with its version (§29.6).
	"human_response_due_at" timestamp with time zone NOT NULL,
	"calendar_version" text NOT NULL,

	-- §27.8: "Even without resolution, send an update at the promised
	-- checkpoint." This is that checkpoint, and it moves as promises are made.
	"next_promised_update_at" timestamp with time zone,

	-- §27.8's 48-hour Founder follow-up. Set only while the Founder owes the
	-- response — a case Proovd owns has no Founder to follow up with.
	"founder_followup_due_at" timestamp with time zone,

	"last_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,

	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id");--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_reservation_fk"
  FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id");--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "campaign_affiliate_associations"("id");--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_backer_fk"
  FOREIGN KEY ("backer_identity_id") REFERENCES "backer_identities"("id");--> statement-breakpoint

CREATE UNIQUE INDEX "support_cases_reference_idx" ON "support_cases" ("reference");--> statement-breakpoint

ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_owner_known"
  CHECK ("owner" IN ('proovd_support', 'founder_coordinated'));--> statement-breakpoint

ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_requester_known"
  CHECK ("requester_kind" IN ('backer', 'founder', 'creator'));--> statement-breakpoint

-- A Backer case names the pseudonymous identity; an account-holder case names a
-- user. Neither may be anonymous, because §26.8's timeline is per-subject and a
-- case attached to nobody appears on nobody's timeline.
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_requester_identified" CHECK (
  ("requester_kind" = 'backer' AND "backer_identity_id" IS NOT NULL)
  OR ("requester_kind" <> 'backer' AND "requester_user_id" IS NOT NULL)
);--> statement-breakpoint

ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_reference_present"
  CHECK (btrim("reference") <> '');--> statement-breakpoint

CREATE INDEX "support_cases_queue_idx"
  ON "support_cases" ("status", "human_response_due_at");--> statement-breakpoint
CREATE INDEX "support_cases_campaign_idx" ON "support_cases" ("campaign_id", "created_at");--> statement-breakpoint
CREATE INDEX "support_cases_reservation_idx" ON "support_cases" ("reservation_id");--> statement-breakpoint
CREATE INDEX "support_cases_association_idx" ON "support_cases" ("association_id");--> statement-breakpoint

-- §29.6, applied to a support promise: the due time is computed once from the
-- committed calendar and cannot be silently moved afterwards. The follow-up and
-- next-promise timestamps DO move — those are commitments Admin makes and
-- re-makes as a case proceeds — but the one-business-day response promise the
-- customer was given at submission is fixed.
CREATE OR REPLACE FUNCTION enforce_support_due_immutability()
RETURNS trigger AS $$
BEGIN
  IF NEW.human_response_due_at IS DISTINCT FROM OLD.human_response_due_at
     OR NEW.calendar_version IS DISTINCT FROM OLD.calendar_version
     OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'a support case reference and its response deadline are fixed at submission (§27.8, §29.6)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER support_case_due_immutability
  BEFORE UPDATE ON "support_cases"
  FOR EACH ROW EXECUTE FUNCTION enforce_support_due_immutability();--> statement-breakpoint

-- ── support_case_messages (§26.8, §33.9.11) ─────────────────────────────────
-- Append-only. `customer_facing` is the column §33.9.11 is really about: a raw
-- provider or fraud code may exist on an internal note and may never exist on a
-- message a customer reads. The service refuses the second (the pattern list
-- lives in one place and must not be duplicated into a CHECK); this table makes
-- the distinction storable so an investigation can tell them apart.
CREATE TABLE "support_case_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"direction" "support_message_direction" NOT NULL,
	"customer_facing" boolean NOT NULL,
	"body" text NOT NULL,
	-- Which editable template it started from, when it started from one (§26.8).
	"template_key" text,
	"author" text NOT NULL,
	"notification_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "support_case_messages" ADD CONSTRAINT "support_case_messages_case_fk"
  FOREIGN KEY ("case_id") REFERENCES "support_cases"("id");--> statement-breakpoint

ALTER TABLE "support_case_messages" ADD CONSTRAINT "support_case_messages_body_present"
  CHECK (btrim("body") <> '');--> statement-breakpoint

-- An inbound message is the customer writing to Proovd; it is customer-facing by
-- definition. An internal note is always outbound.
ALTER TABLE "support_case_messages" ADD CONSTRAINT "support_case_messages_inbound_is_customer_facing"
  CHECK ("direction" <> 'inbound' OR "customer_facing");--> statement-breakpoint

CREATE INDEX "support_case_messages_case_idx"
  ON "support_case_messages" ("case_id", "occurred_at");--> statement-breakpoint

-- ── support_case_handoffs (§26.8) ───────────────────────────────────────────
-- "When a case changes Admin owner, require a handoff note containing verified
-- facts, current owner, the next customer promise, and the statements that must
-- remain consistent."
--
-- Four NOT NULL, non-blank columns. Three of four is the failure §26.8 was
-- written to prevent — the missing one is usually what stops the new owner
-- contradicting what the customer was already told.
CREATE TABLE "support_case_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,

	"from_owner_actor" text NOT NULL,
	"to_owner_actor" text NOT NULL,

	"verified_facts" text NOT NULL,
	"current_owner" text NOT NULL,
	"next_customer_promise" text NOT NULL,
	"statements_to_keep_consistent" text NOT NULL,

	"recorded_by" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "support_case_handoffs" ADD CONSTRAINT "support_case_handoffs_case_fk"
  FOREIGN KEY ("case_id") REFERENCES "support_cases"("id");--> statement-breakpoint

ALTER TABLE "support_case_handoffs" ADD CONSTRAINT "support_case_handoffs_all_four_present" CHECK (
  btrim("verified_facts") <> ''
  AND btrim("current_owner") <> ''
  AND btrim("next_customer_promise") <> ''
  AND btrim("statements_to_keep_consistent") <> ''
);--> statement-breakpoint

CREATE INDEX "support_case_handoffs_case_idx"
  ON "support_case_handoffs" ("case_id", "occurred_at");--> statement-breakpoint

-- ── campaign_enforcement_actions (§26.7, §29.7) ─────────────────────────────
CREATE TABLE "campaign_enforcement_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,

	"action" "enforcement_action" NOT NULL,
	"phase" "enforcement_phase" NOT NULL,

	-- §26.7: reason category + free text. Both, always.
	"reason_category" text NOT NULL,
	"reason_detail" text NOT NULL,

	-- §25.6 keeps the customer-facing explanation in its own column. §18's
	-- ended-state contract forbids one generic `Campaign ended` message, so this
	-- is what the preserved page actually says.
	"customer_explanation" text NOT NULL,

	"prior_campaign_status" text NOT NULL,
	"new_campaign_status" text NOT NULL,

	-- Which §26.7 pre-capture effects actually ran, and what each one touched.
	"effects_applied" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"reservations_closed" integer NOT NULL DEFAULT 0,
	"payment_methods_detached" integer NOT NULL DEFAULT 0,

	"actor" text NOT NULL,
	"mfa_context" text NOT NULL,
	"reauth_context" text NOT NULL,
	"evidence_links" jsonb,

	"idempotency_key" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "campaign_enforcement_actions" ADD CONSTRAINT "campaign_enforcement_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id");--> statement-breakpoint

ALTER TABLE "campaign_enforcement_actions" ADD CONSTRAINT "campaign_enforcement_reason_category_known"
  CHECK ("reason_category" IN (
    'aup_violation', 'fraud', 'founder_request', 'provider_risk',
    'deceptive_marketing', 'manipulation', 'sanctions_regulatory', 'other_reviewed'
  ));--> statement-breakpoint

-- §26.7's own sentence, as a constraint: a category with no free text is a
-- classification nobody can review.
ALTER TABLE "campaign_enforcement_actions" ADD CONSTRAINT "campaign_enforcement_detail_present"
  CHECK (btrim("reason_detail") <> '');--> statement-breakpoint

ALTER TABLE "campaign_enforcement_actions" ADD CONSTRAINT "campaign_enforcement_explanation_present"
  CHECK (btrim("customer_explanation") <> '');--> statement-breakpoint

CREATE UNIQUE INDEX "campaign_enforcement_idempotency_idx"
  ON "campaign_enforcement_actions" ("idempotency_key");--> statement-breakpoint
CREATE INDEX "campaign_enforcement_campaign_idx"
  ON "campaign_enforcement_actions" ("campaign_id", "occurred_at");--> statement-breakpoint

-- ── relationship_touches (§26.8) ────────────────────────────────────────────
-- "For the first cohort, Admin may log one-time human relationship touches…
-- these are personal service events, not automated engagement spam."
--
-- One row per campaign per kind, insert-only. There is no `scheduled_for`, no
-- `recurrence`, no `template_id`, and no job anywhere that creates one — §30
-- forbids automated engagement, and the moment a touch could be scheduled it
-- would have stopped being a personal service event. The absence is the
-- enforcement, and a test asserts the columns do not exist.
CREATE TABLE "relationship_touches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"kind" text NOT NULL,
	-- What was actually said or done. §1.3: manual work counts when recorded.
	"note" text NOT NULL,
	"recorded_by" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "relationship_touches" ADD CONSTRAINT "relationship_touches_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id");--> statement-breakpoint

ALTER TABLE "relationship_touches" ADD CONSTRAINT "relationship_touches_kind_known"
  CHECK ("kind" IN (
    'campaign_introduction', 'launch_eve_check', 'mid_campaign_welcome',
    'close_thank_you', 'post_campaign_debrief'
  ));--> statement-breakpoint

ALTER TABLE "relationship_touches" ADD CONSTRAINT "relationship_touches_note_present"
  CHECK (btrim("note") <> '');--> statement-breakpoint

-- One-time, per campaign, per kind. A second "mid-campaign welcome" is a
-- sequence, and §26.8 says these must never become one.
CREATE UNIQUE INDEX "relationship_touches_once_idx"
  ON "relationship_touches" ("campaign_id", "kind");--> statement-breakpoint

-- ── Grants ─────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON "support_cases" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "support_cases" FROM proovd_app;--> statement-breakpoint

-- The thread is append-only apart from `notification_id`, which is confirmed
-- after the provider call — the §7 invitation-send shape, for the same reason: a
-- row written before the send is a state ("recorded, not confirmed"), and a
-- message body a later statement could edit is not evidence of what was said.
GRANT SELECT, INSERT ON "support_case_messages" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("notification_id") ON "support_case_messages" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "support_case_messages" FROM proovd_app;--> statement-breakpoint

GRANT SELECT, INSERT ON "support_case_handoffs" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "support_case_handoffs" FROM proovd_app;--> statement-breakpoint

GRANT SELECT, INSERT ON "campaign_enforcement_actions" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "campaign_enforcement_actions" FROM proovd_app;--> statement-breakpoint

GRANT SELECT, INSERT ON "relationship_touches" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "relationship_touches" FROM proovd_app;
