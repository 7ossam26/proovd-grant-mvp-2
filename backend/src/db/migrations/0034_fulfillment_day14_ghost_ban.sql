-- Phase 21a — fulfillment, delivery-date changes, the Day 14 Progress Check,
-- and the one-strike Founder ghost ban (§22.4–§22.7, §33.10.1–§33.10.4).
--
-- What the database itself guarantees here:
--
--   * the ORIGINAL delivery commitment cannot be rewritten. Commitments are an
--     insert-only sequence unique per (campaign, sequence); sequence 1 is the
--     original, a revision is a new row, and a trigger refuses to move a
--     recorded date, month, reason, or sequence afterwards (§22.5's fourth
--     obligation, §33.10.2);
--   * a revision cannot exist without the path §22.6 requires: a revision on
--     the `admin_preapproval` path must cite an APPROVED change request for
--     the same campaign, so "notify Backers, ask later" has no representable
--     row on a Product campaign before its remaining payment;
--   * the five-business-day §22.6 review deadline is stored with the calendar
--     version that produced it and is immutable — §29.6's rule for promised
--     deadlines, applied here;
--   * a Day 14 decision is write-once, and its outcome and findings cannot
--     disagree: a `pass` with no adequate progress evidence, a `pass` with no
--     required communication, a `pass` carrying failure reasons, and a `fail`
--     carrying none are all CHECK-refused (§22.4's pass condition);
--   * an evidence submission and its items are insert-only — §22.4 calls the
--     receipt "durable", and a receipt the supplier can edit afterwards is not
--     a receipt (§1.3, §25.6);
--   * a ghost ban is ONE row per Founder, permanent, insert-only, with all
--     five §22.7 fields non-blank and a trigger CHECK-tied to its trigger's
--     own evidence — a `failed_day_14` ban cannot exist without a Day 14
--     review that actually failed, and no UPDATE or DELETE can lift one
--     (§22.7, §33.10.4).
--
-- What is deliberately ABSENT: any column that would let a ban be withdrawn,
-- any `other`/`discretionary` trigger value, and any path that writes a
-- delivery commitment without a sequence. §22.7 is one-strike and permanent;
-- §1 rule 6 forbids inventing the lift.

-- ── campaign_fulfillment (§22.5) ────────────────────────────────────────────
-- One row per campaign: the promised mechanism, the access instructions the
-- delivery notice renders, and the three obligation timestamps. The per-Backer
-- delivery state stays on `founder_operational_shares` (Phase 15's row) and the
-- per-Backer message dedups in `notification_deliveries` — no second store.
CREATE TABLE "campaign_fulfillment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  -- §22.5's seven mechanisms. Free text here would make "through the promised
  -- mechanism" unverifiable.
  "mechanism" text,
  "access_instructions" text,
  -- §22.5: "Send campaign-close confirmation within 48 hours." The update that
  -- carried it, and when. The 48-hour deadline is derived from
  -- `campaigns.campaign_close_at` — never stored twice.
  "close_confirmation_update_id" uuid,
  "close_confirmation_sent_at" timestamp with time zone,
  -- §22.5: "Send delivery notification when access is granted."
  "delivered_at" timestamp with time zone,
  "delivered_by" text,
  "delivery_notified_at" timestamp with time zone,
  -- §23.1 `fulfilled`: "Delivery obligations completed". Separate from
  -- `closed_resolved` (§22.11) by construction — that is a different column on
  -- a different record, and Phase 21b writes it.
  "fulfilled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text NOT NULL,
  CONSTRAINT "campaign_fulfillment_mechanism_known" CHECK (
    "mechanism" IS NULL OR "mechanism" IN (
      'login_credentials','download_link','redemption_code','beta_enrollment',
      'api_key','invite_or_access_code','course_book_or_file'
    )
  ),
  CONSTRAINT "campaign_fulfillment_access_instructions_present" CHECK (
    "access_instructions" IS NULL OR btrim("access_instructions") <> ''
  ),
  -- §22.5: delivery happens "through the promised mechanism", and the notice
  -- repeats the access instructions. A delivery with neither is a claim with
  -- nothing behind it (§1.4).
  CONSTRAINT "campaign_fulfillment_delivery_needs_mechanism" CHECK (
    "delivered_at" IS NULL
    OR ("mechanism" IS NOT NULL AND "access_instructions" IS NOT NULL AND "delivered_by" IS NOT NULL)
  ),
  -- Fulfilled implies delivered. §23.1's entry rule is "Delivery obligations
  -- completed", and the delivery is the first of them.
  CONSTRAINT "campaign_fulfillment_fulfilled_needs_delivery" CHECK (
    "fulfilled_at" IS NULL OR "delivered_at" IS NOT NULL
  )
);--> statement-breakpoint

ALTER TABLE "campaign_fulfillment" ADD CONSTRAINT "campaign_fulfillment_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE NO ACTION;--> statement-breakpoint
ALTER TABLE "campaign_fulfillment" ADD CONSTRAINT "campaign_fulfillment_close_update_fk"
  FOREIGN KEY ("close_confirmation_update_id") REFERENCES "campaign_updates"("id") ON DELETE NO ACTION;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_fulfillment_campaign_idx" ON "campaign_fulfillment" ("campaign_id");--> statement-breakpoint

-- ── delivery_change_requests (§22.6) ────────────────────────────────────────
-- The Product-before-remaining-payment path: Admin approval BEFORE Backers are
-- notified, reviewed within five business days. The other path
-- (`notice_before_original_month`) writes no request — it writes a commitment
-- and an update — so this table is the record of the path that needs a desk.
CREATE TABLE "delivery_change_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  -- Derived by `deliveryChangePathFor` and stored so the record says which
  -- rule governed it. Only the approval path may create a request row.
  "path" text NOT NULL,
  "proposed_delivery_month" date NOT NULL,
  "proposed_delivery_date" date,
  -- §22.6's material-update fields the Founder supplies at request time. The
  -- previous and revised dates come from the commitment rows, not from here.
  "reason" text NOT NULL,
  "unchanged_obligations" text NOT NULL,
  "next_update_date" date NOT NULL,
  "support_refund_route" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  -- §22.6: "Admin reviews within five business days." Business days come from
  -- the committed calendar, so the deadline is stored with its version rather
  -- than recomputed (§29.6) — and the trigger below refuses to move either.
  "review_due_at" timestamp with time zone NOT NULL,
  "calendar_version" text NOT NULL,
  -- §22.6: Admin reviews "for bait-and-switch risk and payment impact". Two
  -- separate recorded findings, because they are two separate judgements.
  "bait_and_switch_finding" text,
  "payment_impact_finding" text,
  "decision_internal_reason" text,
  "decision_customer_explanation" text,
  "decided_by" text,
  "decided_at" timestamp with time zone,
  "resulting_commitment_id" uuid,
  "requested_by" text NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "delivery_change_requests_path_known" CHECK (
    "path" IN ('admin_preapproval','notice_before_original_month')
  ),
  -- Only the approval path has a desk. A request row on the notice path would
  -- be a review nobody owes and a delay nobody agreed to.
  CONSTRAINT "delivery_change_requests_path_is_approval" CHECK ("path" = 'admin_preapproval'),
  CONSTRAINT "delivery_change_requests_status_known" CHECK (
    "status" IN ('pending','approved','rejected','withdrawn')
  ),
  CONSTRAINT "delivery_change_requests_month_is_first" CHECK (
    date_part('day', "proposed_delivery_month") = 1
  ),
  CONSTRAINT "delivery_change_requests_fields_present" CHECK (
    btrim("reason") <> ''
    AND btrim("unchanged_obligations") <> ''
    AND btrim("support_refund_route") <> ''
  ),
  -- A decision names who, when, and both §25.6 columns. A rejection with no
  -- customer explanation is a refusal the Founder cannot act on (§29.4).
  CONSTRAINT "delivery_change_requests_decision_complete" CHECK (
    "status" IN ('pending','withdrawn')
    OR (
      "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL
      AND "decision_internal_reason" IS NOT NULL AND btrim("decision_internal_reason") <> ''
      AND "decision_customer_explanation" IS NOT NULL AND btrim("decision_customer_explanation") <> ''
      AND "bait_and_switch_finding" IS NOT NULL AND btrim("bait_and_switch_finding") <> ''
      AND "payment_impact_finding" IS NOT NULL AND btrim("payment_impact_finding") <> ''
    )
  ),
  -- "approved implies a resulting commitment" is enforced by a DEFERRED
  -- constraint trigger below, not by a CHECK. The approval and the commitment
  -- are written in one transaction and each needs the other to exist first —
  -- the request must read `approved` before the authorisation trigger will let
  -- the commitment cite it, and the commitment must exist before its id can be
  -- stored here. A plain CHECK fires per statement and would refuse the
  -- intermediate row; Postgres cannot defer a CHECK, so the rule lives in a
  -- constraint trigger that runs at COMMIT and sees only the final state.
  CONSTRAINT "delivery_change_requests_decided_by_shape" CHECK (
    ("decided_by" IS NULL) = ("decided_at" IS NULL)
  )
);--> statement-breakpoint

ALTER TABLE "delivery_change_requests" ADD CONSTRAINT "delivery_change_requests_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE NO ACTION;--> statement-breakpoint
-- One open ask at a time (§31.6's shape): a second request while one waits is a
-- duplicate, not a new decision.
CREATE UNIQUE INDEX "delivery_change_requests_one_pending_idx"
  ON "delivery_change_requests" ("campaign_id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "delivery_change_requests_due_idx"
  ON "delivery_change_requests" ("status", "review_due_at");--> statement-breakpoint

-- ── delivery_commitments (§22.5, §22.6) ─────────────────────────────────────
-- The insert-only sequence that makes "preserve original and revised delivery
-- dates" structural. Sequence 1 IS the original promise; every surface that
-- says "originally promised" reads it, and no code path can overwrite it
-- because there is no UPDATE grant on the date columns (§33.10.2).
CREATE TABLE "delivery_commitments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  -- The disclosed delivery MONTH — §22.7's third trigger measures against it,
  -- so it is a stored date rather than a phrase inside free text.
  "delivery_month" date NOT NULL,
  -- An exact date where the Founder promised one; the month is the commitment.
  "delivery_date" date,
  -- The public wording as the Backer read it, so the delivery notice can repeat
  -- the original commitment verbatim rather than reconstructing it.
  "commitment_text" text NOT NULL,
  -- §22.6: a revision states its reason. The original has none to state.
  "reason" text,
  "path" text,
  "change_request_id" uuid,
  -- The §18 update that carried the change to Backers, and when.
  "update_id" uuid,
  "notified_backers_at" timestamp with time zone,
  "recorded_by" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "delivery_commitments_sequence_positive" CHECK ("sequence" >= 1),
  CONSTRAINT "delivery_commitments_month_is_first" CHECK (
    date_part('day', "delivery_month") = 1
  ),
  CONSTRAINT "delivery_commitments_text_present" CHECK (btrim("commitment_text") <> ''),
  -- The original carries no reason, no path, and no request; a revision
  -- carries a reason and a path. The asymmetry is the record of which is which.
  CONSTRAINT "delivery_commitments_original_shape" CHECK (
    ("sequence" = 1 AND "reason" IS NULL AND "path" IS NULL AND "change_request_id" IS NULL)
    OR ("sequence" > 1 AND "reason" IS NOT NULL AND btrim("reason") <> '' AND "path" IS NOT NULL)
  ),
  CONSTRAINT "delivery_commitments_path_known" CHECK (
    "path" IS NULL OR "path" IN ('admin_preapproval','notice_before_original_month')
  ),
  -- §22.6's first branch: on the approval path the request is what authorised
  -- the revision, so the revision cannot exist without it.
  CONSTRAINT "delivery_commitments_approval_needs_request" CHECK (
    "path" IS DISTINCT FROM 'admin_preapproval' OR "change_request_id" IS NOT NULL
  ),
  CONSTRAINT "delivery_commitments_exact_date_in_month" CHECK (
    "delivery_date" IS NULL
    OR date_trunc('month', "delivery_date") = date_trunc('month', "delivery_month")
  )
);--> statement-breakpoint

ALTER TABLE "delivery_commitments" ADD CONSTRAINT "delivery_commitments_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE NO ACTION;--> statement-breakpoint
ALTER TABLE "delivery_commitments" ADD CONSTRAINT "delivery_commitments_request_fk"
  FOREIGN KEY ("change_request_id") REFERENCES "delivery_change_requests"("id") ON DELETE NO ACTION;--> statement-breakpoint
ALTER TABLE "delivery_commitments" ADD CONSTRAINT "delivery_commitments_update_fk"
  FOREIGN KEY ("update_id") REFERENCES "campaign_updates"("id") ON DELETE NO ACTION;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_commitments_sequence_idx"
  ON "delivery_commitments" ("campaign_id", "sequence");--> statement-breakpoint

ALTER TABLE "delivery_change_requests" ADD CONSTRAINT "delivery_change_requests_commitment_fk"
  FOREIGN KEY ("resulting_commitment_id") REFERENCES "delivery_commitments"("id")
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

-- ── day_14_reviews (§22.4) ──────────────────────────────────────────────────
CREATE TABLE "day_14_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  -- The Day 14 anchor: `campaign_close_at` + 14 days (§22.4's own number). It
  -- is the decision due time the receipt quotes, so it is stored once.
  "due_at" timestamp with time zone NOT NULL,
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  "outcome" text DEFAULT 'pending' NOT NULL,
  -- §22.4's pass condition, as two recorded Admin findings.
  "adequate_progress_evidence" boolean,
  "required_communication" boolean,
  "failure_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
  -- §25.6: internal wording and customer wording are separate columns, and the
  -- customer one is refused if it carries a raw provider code (§33.9.11).
  "internal_reason" text,
  "customer_explanation" text,
  "consequences" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "decided_by" text,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "day_14_reviews_outcome_known" CHECK ("outcome" IN ('pending','pass','fail')),
  CONSTRAINT "day_14_reviews_reasons_is_array" CHECK (jsonb_typeof("failure_reasons") = 'array'),
  CONSTRAINT "day_14_reviews_consequences_is_array" CHECK (jsonb_typeof("consequences") = 'array'),
  -- A decision names who and when, and both §25.6 columns.
  CONSTRAINT "day_14_reviews_decision_complete" CHECK (
    "outcome" = 'pending'
    OR (
      "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL
      AND "adequate_progress_evidence" IS NOT NULL AND "required_communication" IS NOT NULL
      AND "internal_reason" IS NOT NULL AND btrim("internal_reason") <> ''
      AND "customer_explanation" IS NOT NULL AND btrim("customer_explanation") <> ''
    )
  ),
  -- §22.4: "Pass requires adequate progress/delivery evidence and required
  -- communication." Outcome and findings can never disagree.
  CONSTRAINT "day_14_reviews_pass_requires_both" CHECK (
    "outcome" <> 'pass'
    OR ("adequate_progress_evidence" = true AND "required_communication" = true
        AND jsonb_array_length("failure_reasons") = 0)
  ),
  -- A failure names at least one of §22.4's five reasons. "Failed" alone is
  -- the §29.4 vagueness this file exists to make unstorable.
  CONSTRAINT "day_14_reviews_fail_requires_reason" CHECK (
    "outcome" <> 'fail' OR jsonb_array_length("failure_reasons") > 0
  )
);--> statement-breakpoint

ALTER TABLE "day_14_reviews" ADD CONSTRAINT "day_14_reviews_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE NO ACTION;--> statement-breakpoint
CREATE UNIQUE INDEX "day_14_reviews_campaign_idx" ON "day_14_reviews" ("campaign_id");--> statement-breakpoint
CREATE INDEX "day_14_reviews_due_idx" ON "day_14_reviews" ("outcome", "due_at");--> statement-breakpoint

-- ── day_14_evidence_submissions (§22.4) ─────────────────────────────────────
-- §22.4: "submission creates a durable receipt listing every supplied item and
-- the decision due time." Insert-only, both tables.
CREATE TABLE "day_14_evidence_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "review_id" uuid NOT NULL,
  -- A quotable reference, on 16b's alphabet (no O/0 or I/1) and random rather
  -- than sequential so it leaks no submission volume.
  "reference" text NOT NULL,
  "decision_due_at" timestamp with time zone NOT NULL,
  "submitted_by" text NOT NULL,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "day_14_submissions_reference_present" CHECK (btrim("reference") <> '')
);--> statement-breakpoint

ALTER TABLE "day_14_evidence_submissions" ADD CONSTRAINT "day_14_submissions_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE NO ACTION;--> statement-breakpoint
ALTER TABLE "day_14_evidence_submissions" ADD CONSTRAINT "day_14_submissions_review_fk"
  FOREIGN KEY ("review_id") REFERENCES "day_14_reviews"("id") ON DELETE NO ACTION;--> statement-breakpoint
CREATE UNIQUE INDEX "day_14_submissions_reference_idx"
  ON "day_14_evidence_submissions" ("reference");--> statement-breakpoint
CREATE INDEX "day_14_submissions_review_idx"
  ON "day_14_evidence_submissions" ("review_id", "submitted_at");--> statement-breakpoint

CREATE TABLE "day_14_evidence_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "submission_id" uuid NOT NULL,
  -- The checklist key. CHECK-pinned to the union of the §22.4 register's keys,
  -- so an item nobody was asked for cannot be filed as one that was.
  "item_key" text NOT NULL,
  "detail" text NOT NULL,
  "url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "day_14_items_key_known" CHECK (
    "item_key" IN (
      'progress_evidence','required_communication','delivery_timeline','feature_or_reward_access'
    )
  ),
  CONSTRAINT "day_14_items_detail_present" CHECK (btrim("detail") <> '')
);--> statement-breakpoint

ALTER TABLE "day_14_evidence_items" ADD CONSTRAINT "day_14_items_submission_fk"
  FOREIGN KEY ("submission_id") REFERENCES "day_14_evidence_submissions"("id") ON DELETE NO ACTION;--> statement-breakpoint
CREATE UNIQUE INDEX "day_14_items_submission_key_idx"
  ON "day_14_evidence_items" ("submission_id", "item_key");--> statement-breakpoint

-- ── day_14_clarification_requests (§22.4) ───────────────────────────────────
-- §22.4's third failure reason is "unreachable for Admin clarification within
-- five business days" — a business-day deadline, so §29.6 governs it: computed
-- on the committed calendar, stored with the version, immutable afterwards.
CREATE TABLE "day_14_clarification_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "review_id" uuid NOT NULL,
  "question" text NOT NULL,
  "requested_by" text NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "due_at" timestamp with time zone NOT NULL,
  "calendar_version" text NOT NULL,
  "responded_at" timestamp with time zone,
  "response_note" text,
  CONSTRAINT "day_14_clarifications_question_present" CHECK (btrim("question") <> ''),
  CONSTRAINT "day_14_clarifications_response_shape" CHECK (
    "responded_at" IS NULL OR ("response_note" IS NOT NULL AND btrim("response_note") <> '')
  )
);--> statement-breakpoint

ALTER TABLE "day_14_clarification_requests" ADD CONSTRAINT "day_14_clarifications_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE NO ACTION;--> statement-breakpoint
ALTER TABLE "day_14_clarification_requests" ADD CONSTRAINT "day_14_clarifications_review_fk"
  FOREIGN KEY ("review_id") REFERENCES "day_14_reviews"("id") ON DELETE NO ACTION;--> statement-breakpoint
CREATE INDEX "day_14_clarifications_review_idx"
  ON "day_14_clarification_requests" ("review_id", "due_at");--> statement-breakpoint

-- ── founder_ghost_bans (§22.7) ──────────────────────────────────────────────
-- One-strike and permanent: ONE row per Founder, insert-only, no lift column
-- and no lift path. §22.7's five recorded facts are all NOT NULL and non-blank,
-- and the trigger below refuses a `failed_day_14` ban whose cited review did
-- not actually fail — the evidence for the trigger has to exist as a record,
-- not as a sentence somebody typed (§33.10.4).
CREATE TABLE "founder_ghost_bans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "founder_user_id" text NOT NULL,
  -- The campaign whose facts met the trigger. The ban follows the person; the
  -- campaign is the evidence.
  "campaign_id" uuid NOT NULL,
  "trigger" text NOT NULL,
  -- §22.7's five recorded facts.
  "evidence" text NOT NULL,
  "notice" text NOT NULL,
  "payment_recovery_status" text NOT NULL,
  "enforcement_decision" text NOT NULL,
  -- §25.6 keeps internal wording separate from what the Founder is told.
  "internal_reason" text NOT NULL,
  -- The stored trigger facts as evaluated, so the decision is reproducible.
  "trigger_facts" jsonb NOT NULL,
  "day_14_review_id" uuid,
  "decided_by" text NOT NULL,
  "decided_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "founder_ghost_bans_trigger_known" CHECK (
    "trigger" IN (
      'failed_day_14','silent_30_days_post_payment',
      'product_30_days_past_delivery_month','idea_window_missed_and_no_timeline'
    )
  ),
  CONSTRAINT "founder_ghost_bans_fields_present" CHECK (
    btrim("evidence") <> '' AND btrim("notice") <> ''
    AND btrim("payment_recovery_status") <> '' AND btrim("enforcement_decision") <> ''
    AND btrim("internal_reason") <> '' AND btrim("founder_user_id") <> ''
  ),
  CONSTRAINT "founder_ghost_bans_day14_cited" CHECK (
    "trigger" <> 'failed_day_14' OR "day_14_review_id" IS NOT NULL
  )
);--> statement-breakpoint

ALTER TABLE "founder_ghost_bans" ADD CONSTRAINT "founder_ghost_bans_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE NO ACTION;--> statement-breakpoint
ALTER TABLE "founder_ghost_bans" ADD CONSTRAINT "founder_ghost_bans_review_fk"
  FOREIGN KEY ("day_14_review_id") REFERENCES "day_14_reviews"("id") ON DELETE NO ACTION;--> statement-breakpoint
-- One strike. A second ban for the same Founder is not a second sanction.
CREATE UNIQUE INDEX "founder_ghost_bans_founder_idx" ON "founder_ghost_bans" ("founder_user_id");--> statement-breakpoint
CREATE INDEX "founder_ghost_bans_campaign_idx" ON "founder_ghost_bans" ("campaign_id");--> statement-breakpoint

-- ── Triggers ────────────────────────────────────────────────────────────────

-- A recorded commitment is what a Backer was promised. Only the notification
-- columns may be filled in afterwards; the sequence, dates, wording, reason,
-- path, and authorising request are frozen (§22.5's fourth obligation).
CREATE OR REPLACE FUNCTION enforce_delivery_commitment_immutability()
RETURNS trigger AS $$
BEGIN
  IF NEW."campaign_id" IS DISTINCT FROM OLD."campaign_id"
     OR NEW."sequence" IS DISTINCT FROM OLD."sequence"
     OR NEW."delivery_month" IS DISTINCT FROM OLD."delivery_month"
     OR NEW."delivery_date" IS DISTINCT FROM OLD."delivery_date"
     OR NEW."commitment_text" IS DISTINCT FROM OLD."commitment_text"
     OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."path" IS DISTINCT FROM OLD."path"
     OR NEW."change_request_id" IS DISTINCT FROM OLD."change_request_id"
     OR NEW."recorded_by" IS DISTINCT FROM OLD."recorded_by"
     OR NEW."recorded_at" IS DISTINCT FROM OLD."recorded_at" THEN
    RAISE EXCEPTION 'a delivery commitment is what was promised and never changes; a revision is a new sequence (§22.5, §22.6)';
  END IF;
  IF OLD."notified_backers_at" IS NOT NULL
     AND NEW."notified_backers_at" IS DISTINCT FROM OLD."notified_backers_at" THEN
    RAISE EXCEPTION 'the Backer notification instant is recorded once (§22.6)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "delivery_commitments_immutable"
  BEFORE UPDATE ON "delivery_commitments"
  FOR EACH ROW EXECUTE FUNCTION enforce_delivery_commitment_immutability();--> statement-breakpoint

CREATE OR REPLACE FUNCTION refuse_delivery_commitment_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'delivery commitments are history and are never deleted (§22.5, §25.6)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "delivery_commitments_no_delete"
  BEFORE DELETE ON "delivery_commitments"
  FOR EACH ROW EXECUTE FUNCTION refuse_delivery_commitment_delete();--> statement-breakpoint

-- §22.6's approval path, enforced at the row: a revision that claims Admin
-- preapproval must cite an APPROVED request for its own campaign. Checking
-- this in the service alone would leave the guarantee one careless insert away.
CREATE OR REPLACE FUNCTION enforce_delivery_commitment_authorisation()
RETURNS trigger AS $$
DECLARE
  v_status text;
  v_campaign uuid;
BEGIN
  IF NEW."change_request_id" IS NOT NULL THEN
    SELECT "status", "campaign_id" INTO v_status, v_campaign
      FROM "delivery_change_requests" WHERE "id" = NEW."change_request_id";
    IF v_campaign IS DISTINCT FROM NEW."campaign_id" THEN
      RAISE EXCEPTION 'a delivery revision must cite a change request for its own campaign (§22.6)';
    END IF;
    IF v_status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'a delivery revision on the Admin-approval path requires an approved request before Backers are notified (§22.6)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "delivery_commitments_authorised"
  BEFORE INSERT ON "delivery_commitments"
  FOR EACH ROW EXECUTE FUNCTION enforce_delivery_commitment_authorisation();--> statement-breakpoint

-- The §22.6 review deadline and the request's identity are fixed once written.
CREATE OR REPLACE FUNCTION enforce_delivery_change_request_immutability()
RETURNS trigger AS $$
BEGIN
  IF NEW."campaign_id" IS DISTINCT FROM OLD."campaign_id"
     OR NEW."path" IS DISTINCT FROM OLD."path"
     OR NEW."review_due_at" IS DISTINCT FROM OLD."review_due_at"
     OR NEW."calendar_version" IS DISTINCT FROM OLD."calendar_version"
     OR NEW."proposed_delivery_month" IS DISTINCT FROM OLD."proposed_delivery_month"
     OR NEW."proposed_delivery_date" IS DISTINCT FROM OLD."proposed_delivery_date"
     OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."requested_by" IS DISTINCT FROM OLD."requested_by"
     OR NEW."requested_at" IS DISTINCT FROM OLD."requested_at" THEN
    RAISE EXCEPTION 'a delivery-change request and its five-business-day deadline are fixed when made (§22.6, §29.6)';
  END IF;
  -- A decided request is final, with ONE exception: the approval and the
  -- commitment it produced are written in the same transaction, so the
  -- `resulting_commitment_id` back-reference may be filled in once, from NULL,
  -- and nothing else about the row may move with it.
  IF OLD."status" <> 'pending' THEN
    IF OLD."resulting_commitment_id" IS NULL
       AND NEW."resulting_commitment_id" IS NOT NULL
       AND NEW."status" IS NOT DISTINCT FROM OLD."status"
       AND NEW."decided_by" IS NOT DISTINCT FROM OLD."decided_by"
       AND NEW."decided_at" IS NOT DISTINCT FROM OLD."decided_at"
       AND NEW."decision_customer_explanation" IS NOT DISTINCT FROM OLD."decision_customer_explanation" THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'a decided delivery-change request is final (§22.6, §25.6)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "delivery_change_requests_immutable"
  BEFORE UPDATE ON "delivery_change_requests"
  FOR EACH ROW EXECUTE FUNCTION enforce_delivery_change_request_immutability();--> statement-breakpoint

-- §22.6: an approved request always produced the revision it approved. Deferred
-- to COMMIT because the approval and the commitment are mutually dependent
-- inside one transaction (see the note on the table). "Approved but never
-- filed" is still not a state that can survive a transaction.
-- The row is RE-READ rather than taken from NEW: a deferred AFTER trigger fires
-- at COMMIT but carries the tuple snapshot from when its event was queued, so
-- NEW here is the row as it looked at the approving UPDATE — before the
-- back-reference was filled in. Checking NEW would refuse every legitimate
-- approval. What the constraint is about is the state at commit, so that is
-- what it reads.
CREATE OR REPLACE FUNCTION enforce_delivery_change_approved_has_commitment()
RETURNS trigger AS $$
DECLARE
  v_status text;
  v_commitment uuid;
BEGIN
  SELECT "status", "resulting_commitment_id" INTO v_status, v_commitment
    FROM "delivery_change_requests" WHERE "id" = NEW."id";
  -- Gone by commit (impossible today — DELETE is revoked) is not this rule's
  -- business.
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_status = 'approved' AND v_commitment IS NULL THEN
    RAISE EXCEPTION 'an approved delivery-change request must record the commitment it produced (§22.6)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "delivery_change_requests_approved_has_commitment"
  AFTER INSERT OR UPDATE ON "delivery_change_requests"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_delivery_change_approved_has_commitment();--> statement-breakpoint

-- §22.4's decision is recorded once. `pending → pass|fail` and nothing else;
-- a review that could be re-decided is a review a Founder could relitigate and
-- an Admin could quietly reverse after a payment moved on its basis.
CREATE OR REPLACE FUNCTION enforce_day_14_review_transitions()
RETURNS trigger AS $$
BEGIN
  IF NEW."campaign_id" IS DISTINCT FROM OLD."campaign_id"
     OR NEW."due_at" IS DISTINCT FROM OLD."due_at"
     OR NEW."opened_at" IS DISTINCT FROM OLD."opened_at" THEN
    RAISE EXCEPTION 'a Day 14 review is anchored when opened and its due time never moves (§22.4, §29.6)';
  END IF;
  IF OLD."outcome" <> 'pending' AND NEW."outcome" IS DISTINCT FROM OLD."outcome" THEN
    RAISE EXCEPTION 'a Day 14 decision is recorded once (§22.4, §25.6)';
  END IF;
  IF OLD."outcome" <> 'pending' AND (
       NEW."adequate_progress_evidence" IS DISTINCT FROM OLD."adequate_progress_evidence"
       OR NEW."required_communication" IS DISTINCT FROM OLD."required_communication"
       OR NEW."failure_reasons" IS DISTINCT FROM OLD."failure_reasons"
       OR NEW."customer_explanation" IS DISTINCT FROM OLD."customer_explanation"
       OR NEW."decided_by" IS DISTINCT FROM OLD."decided_by"
       OR NEW."decided_at" IS DISTINCT FROM OLD."decided_at") THEN
    RAISE EXCEPTION 'a recorded Day 14 finding is history and never changes (§22.4, §25.6)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "day_14_reviews_transitions"
  BEFORE UPDATE ON "day_14_reviews"
  FOR EACH ROW EXECUTE FUNCTION enforce_day_14_review_transitions();--> statement-breakpoint

CREATE OR REPLACE FUNCTION refuse_day_14_record_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Day 14 receipts and evidence items are durable and insert-only (§22.4, §1.3)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "day_14_submissions_append_only"
  BEFORE UPDATE OR DELETE ON "day_14_evidence_submissions"
  FOR EACH ROW EXECUTE FUNCTION refuse_day_14_record_change();--> statement-breakpoint

CREATE TRIGGER "day_14_items_append_only"
  BEFORE UPDATE OR DELETE ON "day_14_evidence_items"
  FOR EACH ROW EXECUTE FUNCTION refuse_day_14_record_change();--> statement-breakpoint

CREATE TRIGGER "day_14_reviews_no_delete"
  BEFORE DELETE ON "day_14_reviews"
  FOR EACH ROW EXECUTE FUNCTION refuse_day_14_record_change();--> statement-breakpoint

-- A ghost ban is permanent. Insert-only at the database level, so no support
-- script, no admin route, and no future phase can quietly lift one (§22.7).
CREATE OR REPLACE FUNCTION refuse_ghost_ban_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'the one-strike Founder ban is permanent and its record is insert-only (§22.7)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "founder_ghost_bans_append_only"
  BEFORE UPDATE OR DELETE ON "founder_ghost_bans"
  FOR EACH ROW EXECUTE FUNCTION refuse_ghost_ban_change();--> statement-breakpoint

-- The evidence for the trigger must be a record, not a sentence. A
-- `failed_day_14` ban has to cite a review of its own campaign whose outcome
-- is actually `fail`; the other three triggers are time comparisons the
-- service evaluates through the one shared kernel and stores in `trigger_facts`.
CREATE OR REPLACE FUNCTION enforce_ghost_ban_trigger_evidence()
RETURNS trigger AS $$
DECLARE
  v_outcome text;
  v_campaign uuid;
BEGIN
  IF NEW."trigger" = 'failed_day_14' THEN
    SELECT "outcome", "campaign_id" INTO v_outcome, v_campaign
      FROM "day_14_reviews" WHERE "id" = NEW."day_14_review_id";
    IF v_campaign IS DISTINCT FROM NEW."campaign_id" THEN
      RAISE EXCEPTION 'a failed-Day-14 ban must cite a review of its own campaign (§22.7)';
    END IF;
    IF v_outcome IS DISTINCT FROM 'fail' THEN
      RAISE EXCEPTION 'a failed-Day-14 ban requires a Day 14 review that actually failed (§22.7, §33.10.4)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "founder_ghost_bans_trigger_evidence"
  BEFORE INSERT ON "founder_ghost_bans"
  FOR EACH ROW EXECUTE FUNCTION enforce_ghost_ban_trigger_evidence();--> statement-breakpoint

-- ── Grants ──────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON "campaign_fulfillment" TO "proovd_app";--> statement-breakpoint
REVOKE DELETE ON "campaign_fulfillment" FROM "proovd_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "delivery_change_requests" TO "proovd_app";--> statement-breakpoint
REVOKE DELETE ON "delivery_change_requests" FROM "proovd_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "delivery_commitments" TO "proovd_app";--> statement-breakpoint
REVOKE DELETE ON "delivery_commitments" FROM "proovd_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "day_14_reviews" TO "proovd_app";--> statement-breakpoint
REVOKE DELETE ON "day_14_reviews" FROM "proovd_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "day_14_evidence_submissions" TO "proovd_app";--> statement-breakpoint
REVOKE UPDATE, DELETE ON "day_14_evidence_submissions" FROM "proovd_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "day_14_evidence_items" TO "proovd_app";--> statement-breakpoint
REVOKE UPDATE, DELETE ON "day_14_evidence_items" FROM "proovd_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "day_14_clarification_requests" TO "proovd_app";--> statement-breakpoint
REVOKE DELETE ON "day_14_clarification_requests" FROM "proovd_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "founder_ghost_bans" TO "proovd_app";--> statement-breakpoint
REVOKE UPDATE, DELETE ON "founder_ghost_bans" FROM "proovd_app";
