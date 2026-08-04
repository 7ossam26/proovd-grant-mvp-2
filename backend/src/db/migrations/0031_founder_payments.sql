-- Phase 19b — the Founder W-9, the payment schedule, and early remaining
-- release (§22.3, §24.5, §23.3, §33.8.9–§33.8.13).
--
-- What the database itself guarantees here, because a service rule is a rule
-- the next route forgets:
--
--   * a Founder payment row can only exist pointing at a VERIFIED W-9 record
--     for its own campaign — §33.8.9 at the level a hand-written INSERT cannot
--     bypass;
--   * one payment per (campaign, kind) — §33.8.10's "no second object" is a
--     unique index — and the kind is CHECK-pinned to the register;
--   * an Idea campaign can only hold a `single_payment` and a Product campaign
--     only `first_payment`/`remaining_payment`, enforced by trigger against
--     the type the §9 lock froze;
--   * the remaining payment is the EXACT remainder after a RELEASED first
--     payment on the same eligible share — first + remaining = share to the
--     cent (§33.8.11), enforced by trigger against the sibling row;
--   * `due_at` is CHECK-pinned to the stored close anchor + the scheduled day
--     (§29.6's shape from 0028) and immutable afterwards;
--   * a released payment is immutable, and the only legal move is
--     eligible → released;
--   * an early-released remaining payment must carry its evidence record, and
--     evidence/requests/W-9 events are insert-only (§25.6);
--   * no free-text field can take a value shaped like a US taxpayer
--     identification number — the 0015 CHECK, applied to the W-9 record
--     (§11: never duplicate the sensitive data the provider keeps).
--
-- There is deliberately NO provider-object column on founder_payments: under
-- the approved direct-charge configuration the captured funds settle to the
-- Founder's own connected account (§24.1), so the §22.3 release is Proovd's
-- recorded decision that the share is theirs to treat as released — a ledger
-- act with no platform-side money movement, exactly like 19a's §24.4 unearned
-- return. If the approved production model later collects the platform-side
-- fee, the release gains its provider leg without this contract changing.

-- ── founder_w9_records (§22.3) ──────────────────────────────────────────────
CREATE TABLE "founder_w9_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "status" text DEFAULT 'requested' NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "requested_by" text NOT NULL,
  "submitted_at" timestamp with time zone,
  -- WHERE the received form is kept (the secure store reference) — never the
  -- form's contents and never a tax identification number.
  "submitted_reference" text,
  "verified_at" timestamp with time zone,
  "verified_by" text,
  "verification_note" text,
  "return_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "founder_w9_status" CHECK ("status" IN ('requested', 'submitted', 'verified')),
  CONSTRAINT "founder_w9_requested_by" CHECK (btrim("requested_by") <> ''),
  -- §22.3: "submitted" is a recorded receipt, not a checkbox (§1.3).
  CONSTRAINT "founder_w9_submitted_complete" CHECK (
    "status" <> 'submitted' OR ("submitted_at" IS NOT NULL AND btrim(COALESCE("submitted_reference", '')) <> '')
  ),
  CONSTRAINT "founder_w9_verified_complete" CHECK (
    "status" <> 'verified' OR (
      "verified_at" IS NOT NULL AND btrim(COALESCE("verified_by", '')) <> '' AND "submitted_at" IS NOT NULL
    )
  ),
  -- §11: never duplicate the sensitive data the provider keeps. A value shaped
  -- like an SSN or EIN in a free-text field is a paste, not an answer (0015).
  CONSTRAINT "founder_w9_no_tin" CHECK (
    COALESCE("submitted_reference", '') !~ '\m[0-9]{3}-[0-9]{2}-[0-9]{4}\M'
    AND COALESCE("submitted_reference", '') !~ '\m[0-9]{2}-[0-9]{7}\M'
    AND COALESCE("verification_note", '') !~ '\m[0-9]{3}-[0-9]{2}-[0-9]{4}\M'
    AND COALESCE("verification_note", '') !~ '\m[0-9]{2}-[0-9]{7}\M'
    AND COALESCE("return_reason", '') !~ '\m[0-9]{3}-[0-9]{2}-[0-9]{4}\M'
    AND COALESCE("return_reason", '') !~ '\m[0-9]{2}-[0-9]{7}\M'
  )
);--> statement-breakpoint

-- ── founder_w9_events (§23: every transition is append-only history) ────────
CREATE TABLE "founder_w9_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "w9_record_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "actor" text NOT NULL,
  "reason" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- ── early_release_evidence (§22.3, §33.8.11) ────────────────────────────────
-- Four separate proofs, each with its evidence detail — the §31.7
-- seller-tax-readiness shape, because a single flag would let three-quarters
-- read as done. Insert-only: a corrected record is a NEW row and the latest
-- complete row wins, the reconciliation-item pattern.
CREATE TABLE "early_release_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "delivery_available" boolean NOT NULL,
  "delivery_available_detail" text NOT NULL,
  "communication_sent" boolean NOT NULL,
  "communication_sent_detail" text NOT NULL,
  "tax_payment_complete" boolean NOT NULL,
  "tax_payment_complete_detail" text NOT NULL,
  "no_immediate_risk" boolean NOT NULL,
  "no_immediate_risk_detail" text NOT NULL,
  "recorded_by" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- Every answer needs its evidence — a bare boolean is internal readiness,
  -- which §22.3 says is insufficient.
  CONSTRAINT "early_release_evidence_details" CHECK (
    btrim("delivery_available_detail") <> ''
    AND btrim("communication_sent_detail") <> ''
    AND btrim("tax_payment_complete_detail") <> ''
    AND btrim("no_immediate_risk_detail") <> ''
    AND btrim("recorded_by") <> ''
  )
);--> statement-breakpoint

-- ── early_release_requests (§22.3, the §6 setting's "each request") ─────────
CREATE TABLE "early_release_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "requested_by" text NOT NULL,
  "message" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "decided_by" text,
  "decided_at" timestamp with time zone,
  "decision_reason" text,
  "evidence_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "early_release_requests_status" CHECK ("status" IN ('pending', 'approved', 'declined')),
  CONSTRAINT "early_release_requests_message" CHECK (btrim("message") <> ''),
  -- A decision names who, when, and why — or it has not happened.
  CONSTRAINT "early_release_requests_decided" CHECK (
    ("status" = 'pending') = ("decided_at" IS NULL)
    AND ("status" = 'pending' OR (btrim(COALESCE("decided_by", '')) <> '' AND btrim(COALESCE("decision_reason", '')) <> ''))
  ),
  -- §22.3: an approval exists only on recorded evidence.
  CONSTRAINT "early_release_requests_approved_evidence" CHECK (
    "status" <> 'approved' OR "evidence_id" IS NOT NULL
  )
);--> statement-breakpoint

-- ── founder_payments (§22.3, §23.3, §33.8.10, §33.8.11) ─────────────────────
CREATE TABLE "founder_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "status" text DEFAULT 'eligible' NOT NULL,
  -- §33.8.9: NOT NULL — a payment with no W-9 record behind it has no row
  -- shape, and the trigger below requires the record VERIFIED.
  "w9_record_id" uuid NOT NULL,
  "eligible_share_cents" bigint NOT NULL,
  "percent" integer NOT NULL,
  "amount_cents" bigint NOT NULL,
  "currency" char(3) DEFAULT 'USD' NOT NULL,
  -- §21's anchor, copied here so the CHECK can pin due_at to it (0028's shape).
  "campaign_close_at" timestamp with time zone NOT NULL,
  "scheduled_day" integer NOT NULL,
  "due_at" timestamp with time zone NOT NULL,
  "released_early" boolean DEFAULT false NOT NULL,
  "early_evidence_id" uuid,
  -- §22.3 Idea: "after retry, W-9, payment/risk checks, and Admin approval" —
  -- the recorded checks and the named approver.
  "payment_checks_note" text,
  "approved_by" text,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "released_at" timestamp with time zone,
  "released_by" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "founder_payments_kind" CHECK (
    "kind" IN ('single_payment', 'first_payment', 'remaining_payment')
  ),
  CONSTRAINT "founder_payments_status" CHECK ("status" IN ('eligible', 'released')),
  CONSTRAINT "founder_payments_amounts" CHECK (
    "eligible_share_cents" >= 0 AND "amount_cents" >= 0 AND "amount_cents" <= "eligible_share_cents"
  ),
  CONSTRAINT "founder_payments_percent" CHECK ("percent" > 0 AND "percent" <= 100),
  CONSTRAINT "founder_payments_scheduled_day" CHECK ("scheduled_day" >= 0),
  -- §29.6's shape from 0028: the due instant is pinned to the anchor + the
  -- day that was in force, and the trigger refuses to move either. Hours, not
  -- days, for 0028's reason: interval-day arithmetic follows the session
  -- timezone across DST and this anchor must not.
  CONSTRAINT "founder_payments_due_anchor" CHECK (
    "due_at" = "campaign_close_at" + make_interval(hours => "scheduled_day" * 24)
  ),
  -- The percentage arithmetic is pinned for the percent kinds; the remaining
  -- payment is the exact remainder, validated by trigger against its sibling.
  CONSTRAINT "founder_payments_percent_arithmetic" CHECK (
    "kind" = 'remaining_payment' OR "amount_cents" = ("eligible_share_cents" * "percent") / 100
  ),
  CONSTRAINT "founder_payments_released_complete" CHECK (
    (("status" = 'released') = ("released_at" IS NOT NULL))
    AND ("status" <> 'released' OR btrim(COALESCE("released_by", '')) <> '')
  ),
  -- §22.3 Idea: the single payment needs the recorded checks and approval.
  CONSTRAINT "founder_payments_single_approval" CHECK (
    "kind" <> 'single_payment' OR (
      btrim(COALESCE("payment_checks_note", '')) <> '' AND btrim(COALESCE("approved_by", '')) <> ''
    )
  ),
  -- §33.8.11: an early release exists only on the remaining payment, with its
  -- evidence record attached.
  CONSTRAINT "founder_payments_early_shape" CHECK (
    "released_early" = false OR ("kind" = 'remaining_payment' AND "early_evidence_id" IS NOT NULL)
  )
);--> statement-breakpoint

-- ── Foreign keys ────────────────────────────────────────────────────────────
ALTER TABLE "founder_w9_records" ADD CONSTRAINT "founder_w9_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_w9_events" ADD CONSTRAINT "founder_w9_events_record_fk"
  FOREIGN KEY ("w9_record_id") REFERENCES "public"."founder_w9_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_w9_events" ADD CONSTRAINT "founder_w9_events_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "early_release_evidence" ADD CONSTRAINT "early_release_evidence_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "early_release_requests" ADD CONSTRAINT "early_release_requests_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "early_release_requests" ADD CONSTRAINT "early_release_requests_evidence_fk"
  FOREIGN KEY ("evidence_id") REFERENCES "public"."early_release_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_payments" ADD CONSTRAINT "founder_payments_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_payments" ADD CONSTRAINT "founder_payments_w9_fk"
  FOREIGN KEY ("w9_record_id") REFERENCES "public"."founder_w9_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_payments" ADD CONSTRAINT "founder_payments_evidence_fk"
  FOREIGN KEY ("early_evidence_id") REFERENCES "public"."early_release_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- One W-9 record per campaign — the request is idempotent by this index.
CREATE UNIQUE INDEX "founder_w9_campaign_idx" ON "founder_w9_records" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "founder_w9_events_record_idx" ON "founder_w9_events" USING btree ("w9_record_id", "occurred_at");--> statement-breakpoint
CREATE INDEX "early_release_evidence_campaign_idx" ON "early_release_evidence" USING btree ("campaign_id", "recorded_at");--> statement-breakpoint
CREATE INDEX "early_release_requests_campaign_idx" ON "early_release_requests" USING btree ("campaign_id", "created_at");--> statement-breakpoint
-- One request at a time: a second ask while one waits is a duplicate, not a
-- new decision (the §31.6 cancellation shape).
CREATE UNIQUE INDEX "early_release_requests_one_pending_idx" ON "early_release_requests" USING btree ("campaign_id") WHERE "status" = 'pending';--> statement-breakpoint
-- §33.8.10: one payment object per (campaign, kind), ever.
CREATE UNIQUE INDEX "founder_payments_campaign_kind_idx" ON "founder_payments" USING btree ("campaign_id", "kind");--> statement-breakpoint
CREATE INDEX "founder_payments_campaign_idx" ON "founder_payments" USING btree ("campaign_id", "status");--> statement-breakpoint

-- ── Triggers ────────────────────────────────────────────────────────────────

-- The W-9 machine: requested → submitted → verified, with the recorded
-- resubmission edge submitted → requested. `verified` is terminal and a
-- verified row is immutable — payments were made on its basis, so a later
-- problem is an enforcement act with its own record, never an edit here.
CREATE OR REPLACE FUNCTION enforce_founder_w9_transitions()
RETURNS trigger AS $$
BEGIN
  IF NEW."campaign_id" IS DISTINCT FROM OLD."campaign_id"
     OR NEW."requested_at" IS DISTINCT FROM OLD."requested_at"
     OR NEW."requested_by" IS DISTINCT FROM OLD."requested_by" THEN
    RAISE EXCEPTION 'founder_w9_records identity is immutable (§22.3)';
  END IF;
  IF OLD."status" = 'verified' THEN
    RAISE EXCEPTION 'a verified W-9 record is immutable — a later problem is its own recorded act (§22.3, §25.6)';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NOT (
      (OLD."status" = 'requested' AND NEW."status" = 'submitted')
      OR (OLD."status" = 'submitted' AND NEW."status" IN ('verified', 'requested'))
    ) THEN
      RAISE EXCEPTION 'illegal W-9 transition % -> % (§22.3)', OLD."status", NEW."status";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "founder_w9_transitions"
  BEFORE UPDATE ON "founder_w9_records"
  FOR EACH ROW EXECUTE FUNCTION enforce_founder_w9_transitions();--> statement-breakpoint

CREATE OR REPLACE FUNCTION refuse_founder_w9_event_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'founder_w9_events is append-only (§23, §25.6)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "founder_w9_events_append_only"
  BEFORE UPDATE OR DELETE ON "founder_w9_events"
  FOR EACH ROW EXECUTE FUNCTION refuse_founder_w9_event_change();--> statement-breakpoint

CREATE OR REPLACE FUNCTION refuse_early_release_evidence_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'early_release_evidence is insert-only — a correction is a new row (§25.6)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "early_release_evidence_append_only"
  BEFORE UPDATE OR DELETE ON "early_release_evidence"
  FOR EACH ROW EXECUTE FUNCTION refuse_early_release_evidence_change();--> statement-breakpoint

-- A decided request is immutable; the only legal move is pending → decided.
CREATE OR REPLACE FUNCTION enforce_early_release_request_transitions()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'pending' THEN
    RAISE EXCEPTION 'a decided early-release request is immutable (§25.6)';
  END IF;
  IF NEW."campaign_id" IS DISTINCT FROM OLD."campaign_id"
     OR NEW."requested_by" IS DISTINCT FROM OLD."requested_by"
     OR NEW."message" IS DISTINCT FROM OLD."message"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'early_release_requests identity is immutable (§25.6)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "early_release_requests_transitions"
  BEFORE UPDATE ON "early_release_requests"
  FOR EACH ROW EXECUTE FUNCTION enforce_early_release_request_transitions();--> statement-breakpoint

-- The payment's shape at birth: the kind matches the §9-locked campaign type,
-- the W-9 behind it is VERIFIED for this campaign (§33.8.9), and a remaining
-- payment is the exact remainder after a RELEASED first payment on the same
-- eligible share (§33.8.11). Time gates (Day 3/Day 14) are the service's,
-- which takes an injected clock — a trigger reading now() would disagree with
-- every test that moves time rather than the anchor (18b's rule).
CREATE OR REPLACE FUNCTION enforce_founder_payment_shape()
RETURNS trigger AS $$
DECLARE
  v_type text;
  v_w9_status text;
  v_w9_campaign uuid;
  v_first_status text;
  v_first_share bigint;
  v_first_amount bigint;
BEGIN
  SELECT "type"::text INTO v_type FROM "campaigns" WHERE "id" = NEW."campaign_id";
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'founder_payments needs a type-locked campaign (§9, §22.3)';
  END IF;
  IF v_type = 'pre_build' AND NEW."kind" <> 'single_payment' THEN
    RAISE EXCEPTION 'an Idea campaign has exactly one single payment — no % (§22.3, §33.8.10)', NEW."kind";
  END IF;
  IF v_type = 'pre_launch' AND NEW."kind" = 'single_payment' THEN
    RAISE EXCEPTION 'a Product campaign pays 40%%/60%%, never a single payment (§22.3)';
  END IF;

  SELECT "status", "campaign_id" INTO v_w9_status, v_w9_campaign
    FROM "founder_w9_records" WHERE "id" = NEW."w9_record_id";
  IF v_w9_campaign IS DISTINCT FROM NEW."campaign_id" THEN
    RAISE EXCEPTION 'founder_payments must cite its own campaign''s W-9 record (§22.3)';
  END IF;
  IF v_w9_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'a missing or unverified W-9 blocks every Founder payment (§22.3, §33.8.9)';
  END IF;

  IF NEW."kind" = 'remaining_payment' THEN
    SELECT "status", "eligible_share_cents", "amount_cents"
      INTO v_first_status, v_first_share, v_first_amount
      FROM "founder_payments"
      WHERE "campaign_id" = NEW."campaign_id" AND "kind" = 'first_payment';
    IF NOT FOUND OR v_first_status <> 'released' THEN
      RAISE EXCEPTION 'the remaining payment follows a RELEASED first payment (§22.3)';
    END IF;
    IF v_first_share IS DISTINCT FROM NEW."eligible_share_cents" THEN
      RAISE EXCEPTION 'the remaining payment must use the first payment''s eligible share (§22.3)';
    END IF;
    IF NEW."amount_cents" IS DISTINCT FROM NEW."eligible_share_cents" - v_first_amount THEN
      RAISE EXCEPTION 'the remaining payment is the exact remainder: share minus first (§22.3, §33.8.11)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "founder_payments_shape"
  BEFORE INSERT ON "founder_payments"
  FOR EACH ROW EXECUTE FUNCTION enforce_founder_payment_shape();--> statement-breakpoint

-- A released payment is done, forever; everything identity-shaped is
-- immutable from birth; the one legal move is eligible → released.
CREATE OR REPLACE FUNCTION enforce_founder_payment_transitions()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'released' THEN
    RAISE EXCEPTION 'a released Founder payment is immutable (§22.3, §33.8.10)';
  END IF;
  IF NEW."campaign_id" IS DISTINCT FROM OLD."campaign_id"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."w9_record_id" IS DISTINCT FROM OLD."w9_record_id"
     OR NEW."eligible_share_cents" IS DISTINCT FROM OLD."eligible_share_cents"
     OR NEW."percent" IS DISTINCT FROM OLD."percent"
     OR NEW."amount_cents" IS DISTINCT FROM OLD."amount_cents"
     OR NEW."campaign_close_at" IS DISTINCT FROM OLD."campaign_close_at"
     OR NEW."scheduled_day" IS DISTINCT FROM OLD."scheduled_day"
     OR NEW."due_at" IS DISTINCT FROM OLD."due_at"
     OR NEW."released_early" IS DISTINCT FROM OLD."released_early"
     OR NEW."early_evidence_id" IS DISTINCT FROM OLD."early_evidence_id"
     OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'founder_payments identity and amounts are immutable — a different amount is a different payment (§22.3)';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (OLD."status" = 'eligible' AND NEW."status" = 'released') THEN
    RAISE EXCEPTION 'illegal Founder payment transition % -> % (§22.3)', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "founder_payments_transitions"
  BEFORE UPDATE ON "founder_payments"
  FOR EACH ROW EXECUTE FUNCTION enforce_founder_payment_transitions();--> statement-breakpoint

CREATE OR REPLACE FUNCTION refuse_founder_payment_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'founder_payments rows are never deleted (§25.6)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "founder_payments_no_delete"
  BEFORE DELETE ON "founder_payments"
  FOR EACH ROW EXECUTE FUNCTION refuse_founder_payment_delete();--> statement-breakpoint

-- ── Grants ──────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON "founder_w9_records" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "founder_w9_records" FROM proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "founder_w9_events" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "founder_w9_events" FROM proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "early_release_evidence" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "early_release_evidence" FROM proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "early_release_requests" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "early_release_requests" FROM proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "founder_payments" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "founder_payments" FROM proovd_app;
