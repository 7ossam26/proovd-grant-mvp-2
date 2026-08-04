-- Phase 20a — refunds of campaign charges and §24.8 cause-based allocation
-- (§24.8, §24.9, Appendix B.6, §33.9.2–§33.9.6).
--
-- What the database itself guarantees here, because a service rule is a rule
-- the next route forgets:
--
--   * a refund cannot exist without its cause classification — `allocation_id`
--     is NOT NULL and unique, so §33.9.2's "every refund has a cause" is a
--     column, not a convention;
--   * the §24.8 cause/treatment matrix is a CHECK: a Founder-caused case can
--     never record a finalized-earnings clawback (§33.9.3), a Proovd error can
--     never debit the Affiliate (§33.9.5), an unrelated dispute can never
--     record one either (§33.9.6), and only the Affiliate-caused row reaches
--     `cancel_unpaid_invalid`/`contractual_recovery` — with the INVALID amount
--     required, never the whole balance (§33.9.4);
--   * an Idea-campaign refund must carry one of §24.9's eight exception
--     reasons, and a Product refund must not — there is no enum member for a
--     voluntary/change-of-mind refund, so the prohibition is the type;
--   * the lifecycle is requested → submitted → succeeded/failed with the
--     failed → submitted retry edge, enforced by trigger, history append-only;
--   * a refund can never exceed what was actually captured, cumulatively
--     across every non-failed refund of the same reservation;
--   * allocations are insert-only — the record §24.8 requires is evidence,
--     and evidence a later statement can edit is not evidence (§25.6).
--
-- The refund's provider leg is a Refund on the Founder's connected account —
-- §24.1's direct charge, refunded where it was charged. The listing-fee refund
-- (0016) is a different stream with different rules and stays untouched.

-- ── refund_cause_allocations (§24.8: "Every case stores…") ──────────────────
CREATE TABLE "refund_cause_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "reservation_id" uuid NOT NULL,
  -- 20a records refunds; 20b classifies disputes and Transfer reversals
  -- through the SAME register rather than a second one.
  "case_kind" text NOT NULL,
  "cause" text NOT NULL,
  "proovd_fee_treatment" text NOT NULL,
  "affiliate_treatment" text NOT NULL,
  -- The INVALID portion, for the two treatments that cancel or recover it.
  -- Never the whole balance: §33.9.4's "only invalid earnings" is this column.
  "affiliate_invalid_cents" bigint,
  -- The Admin-recorded share of this case the Founder bears (§24.8). The §22.3
  -- eligible-share formula sums exactly this column — a judgement recorded
  -- with its evidence, never a number the product derives (§1 rule 6).
  "founder_liability_cents" bigint NOT NULL,
  -- How recovery proceeds when money already moved — best-effort, never a
  -- promise that all released funds are recoverable (§24.9).
  "recovery_note" text,
  "evidence" text NOT NULL,
  -- The named mandate when law, Stripe, or the issuer required the outcome.
  "mandate" text,
  "decided_by" text NOT NULL,
  "decided_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "refund_allocations_case_kind" CHECK (
    "case_kind" IN ('refund', 'dispute', 'transfer_reversal')
  ),
  CONSTRAINT "refund_allocations_cause" CHECK (
    "cause" IN (
      'founder_or_product', 'affiliate_fraud_or_breach', 'proovd_or_system_error',
      'backer_dispute_unrelated', 'law_stripe_or_issuer'
    )
  ),
  CONSTRAINT "refund_allocations_fee_treatment" CHECK (
    "proovd_fee_treatment" IN (
      'retained', 'returned_elective', 'returned_required_stripe', 'returned_required_law'
    )
  ),
  CONSTRAINT "refund_allocations_affiliate_treatment" CHECK (
    "affiliate_treatment" IN (
      'not_attributed', 'earnings_remain', 'cancel_unfinalized',
      'cancel_unpaid_invalid', 'contractual_recovery'
    )
  ),
  -- The §24.8 matrix (§33.9.3, §33.9.5, §33.9.6): what each cause may record.
  CONSTRAINT "refund_allocations_cause_matrix" CHECK (
    CASE "cause"
      WHEN 'founder_or_product' THEN
        "affiliate_treatment" IN ('not_attributed', 'earnings_remain', 'cancel_unfinalized')
      WHEN 'proovd_or_system_error' THEN
        "affiliate_treatment" IN ('not_attributed', 'earnings_remain')
      WHEN 'backer_dispute_unrelated' THEN
        "affiliate_treatment" IN ('not_attributed', 'earnings_remain', 'cancel_unfinalized')
      WHEN 'affiliate_fraud_or_breach' THEN
        "affiliate_treatment" IN ('cancel_unfinalized', 'cancel_unpaid_invalid', 'contractual_recovery')
      ELSE true
    END
  ),
  -- §33.9.4: the invalid amount rides exactly the treatments that use it.
  CONSTRAINT "refund_allocations_invalid_amount" CHECK (
    ("affiliate_treatment" IN ('cancel_unpaid_invalid', 'contractual_recovery'))
      = ("affiliate_invalid_cents" IS NOT NULL)
  ),
  CONSTRAINT "refund_allocations_invalid_positive" CHECK (
    "affiliate_invalid_cents" IS NULL OR "affiliate_invalid_cents" > 0
  ),
  CONSTRAINT "refund_allocations_liability" CHECK ("founder_liability_cents" >= 0),
  CONSTRAINT "refund_allocations_evidence" CHECK (btrim("evidence") <> ''),
  CONSTRAINT "refund_allocations_decided_by" CHECK (btrim("decided_by") <> ''),
  CONSTRAINT "refund_allocations_mandate" CHECK (
    "cause" <> 'law_stripe_or_issuer' OR btrim(COALESCE("mandate", '')) <> ''
  )
);--> statement-breakpoint

-- ── reservation_refunds (§33.9.2: the lifecycle) ────────────────────────────
CREATE TABLE "reservation_refunds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- The quotable B.6 `Reference:` — random, so it leaks no refund volume.
  "reference" text NOT NULL,
  "reservation_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "allocation_id" uuid NOT NULL,
  "status" text DEFAULT 'requested' NOT NULL,
  "amount_cents" bigint NOT NULL,
  -- §24.9: an Idea refund exists only for one of the eight exceptions. There
  -- is no member for a change-of-mind refund, which is the prohibition.
  "idea_exception_reason" text,
  -- The charge being refunded and where it lives (§24.1: the Founder's
  -- connected account — refunded where it was charged).
  "payment_intent_id" text NOT NULL,
  "stripe_account_id" text,
  "provider_refund_id" text,
  -- B.6's `Sent to:` — brand and last four where safely available, else the
  -- render-time fallback names the original payment method truthfully.
  "destination" text,
  -- The stable provider key: a retry is the same refund at Stripe (§28.3).
  "idempotency_key" text NOT NULL,
  "requested_by" text NOT NULL,
  "executed_by" text,
  "failure_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "submitted_at" timestamp with time zone,
  "succeeded_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "reservation_refunds_status" CHECK (
    "status" IN ('requested', 'submitted', 'succeeded', 'failed')
  ),
  CONSTRAINT "reservation_refunds_amount" CHECK ("amount_cents" > 0),
  CONSTRAINT "reservation_refunds_exception" CHECK (
    "idea_exception_reason" IS NULL OR "idea_exception_reason" IN (
      'duplicate_charge', 'wrong_amount', 'charge_after_valid_cancellation',
      'unauthorized_transaction', 'material_misrepresentation', 'applicable_non_delivery',
      'campaign_killed_serious_violation', 'required_by_law_or_network'
    )
  ),
  CONSTRAINT "reservation_refunds_requested_by" CHECK (btrim("requested_by") <> ''),
  -- A submitted or succeeded refund has its provider leg and its timestamps.
  CONSTRAINT "reservation_refunds_submitted_complete" CHECK (
    "status" NOT IN ('submitted', 'succeeded')
    OR ("submitted_at" IS NOT NULL AND "provider_refund_id" IS NOT NULL)
  ),
  CONSTRAINT "reservation_refunds_succeeded_complete" CHECK (
    "status" <> 'succeeded' OR "succeeded_at" IS NOT NULL
  ),
  CONSTRAINT "reservation_refunds_failed_complete" CHECK (
    "status" <> 'failed' OR ("failed_at" IS NOT NULL AND btrim(COALESCE("failure_message", '')) <> '')
  )
);--> statement-breakpoint

-- ── reservation_refund_events (§23: every transition is append-only) ────────
CREATE TABLE "reservation_refund_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "refund_id" uuid NOT NULL,
  "reservation_id" uuid NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "actor" text NOT NULL,
  "note" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- ── Foreign keys ────────────────────────────────────────────────────────────
ALTER TABLE "refund_cause_allocations" ADD CONSTRAINT "refund_allocations_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_cause_allocations" ADD CONSTRAINT "refund_allocations_reservation_fk"
  FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_refunds" ADD CONSTRAINT "reservation_refunds_reservation_fk"
  FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_refunds" ADD CONSTRAINT "reservation_refunds_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_refunds" ADD CONSTRAINT "reservation_refunds_allocation_fk"
  FOREIGN KEY ("allocation_id") REFERENCES "public"."refund_cause_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_refund_events" ADD CONSTRAINT "reservation_refund_events_refund_fk"
  FOREIGN KEY ("refund_id") REFERENCES "public"."reservation_refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_refund_events" ADD CONSTRAINT "reservation_refund_events_reservation_fk"
  FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "reservation_refunds_reference_idx" ON "reservation_refunds" USING btree ("reference");--> statement-breakpoint
-- One refund per allocation record: the case and its money move together.
CREATE UNIQUE INDEX "reservation_refunds_allocation_idx" ON "reservation_refunds" USING btree ("allocation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_refunds_key_idx" ON "reservation_refunds" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_refunds_provider_idx" ON "reservation_refunds" USING btree ("provider_refund_id") WHERE "provider_refund_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "reservation_refunds_reservation_idx" ON "reservation_refunds" USING btree ("reservation_id", "created_at");--> statement-breakpoint
CREATE INDEX "reservation_refunds_campaign_idx" ON "reservation_refunds" USING btree ("campaign_id", "status");--> statement-breakpoint
-- The §22.3 adjustments term sums this column by campaign (19b's reader).
CREATE INDEX "refund_allocations_campaign_idx" ON "refund_cause_allocations" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "refund_allocations_reservation_idx" ON "refund_cause_allocations" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "reservation_refund_events_refund_idx" ON "reservation_refund_events" USING btree ("refund_id", "occurred_at");--> statement-breakpoint

-- ── contractual_recovery_records: one per association was 19a's shape ───────
-- §24.8 permits independent cause-based recoveries against the same Creator —
-- a §22.1 disqualification and a later refund-driven recovery are different
-- facts. Idempotency lives at the writers (the conditional earnings-state
-- move), not in a uniqueness the second legitimate record would collide with.
DROP INDEX "recovery_records_association_idx";--> statement-breakpoint
CREATE INDEX "recovery_records_association_idx" ON "contractual_recovery_records" USING btree ("association_id");--> statement-breakpoint

-- ── Triggers ────────────────────────────────────────────────────────────────

-- §24.8's record is evidence, and evidence a later statement can edit is not
-- evidence of anything (§25.6).
CREATE OR REPLACE FUNCTION refuse_refund_allocation_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'refund_cause_allocations is insert-only — a revised allocation is a new record (§24.8, §25.6)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "refund_allocations_append_only"
  BEFORE UPDATE OR DELETE ON "refund_cause_allocations"
  FOR EACH ROW EXECUTE FUNCTION refuse_refund_allocation_change();--> statement-breakpoint

-- The refund's shape at birth: a charge actually captured, an amount that fits
-- inside what remains refundable, the §24.9 exception reason on exactly the
-- Idea model, an allocation that classifies THIS reservation, and the
-- provider leg pointing at the reservation's own PaymentIntent.
CREATE OR REPLACE FUNCTION enforce_reservation_refund_shape()
RETURNS trigger AS $$
DECLARE
  v_status text;
  v_captured bigint;
  v_payment_intent text;
  v_type text;
  v_alloc_reservation uuid;
  v_alloc_kind text;
  v_already bigint;
BEGIN
  SELECT r."status"::text, r."total_captured_cents", r."payment_intent_id", c."type"::text
    INTO v_status, v_captured, v_payment_intent, v_type
    FROM "reservations" r JOIN "campaigns" c ON c."id" = r."campaign_id"
    WHERE r."id" = NEW."reservation_id";
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'reservation_refunds needs an existing reservation';
  END IF;
  IF v_status NOT IN ('captured', 'refunded', 'reversed', 'disputed') THEN
    RAISE EXCEPTION 'nothing was captured on this reservation, so there is nothing to refund (§24.8: before charge requires no refund object)';
  END IF;
  IF NEW."payment_intent_id" IS DISTINCT FROM v_payment_intent THEN
    RAISE EXCEPTION 'a refund names the reservation''s own PaymentIntent (§32.4)';
  END IF;

  SELECT COALESCE(SUM("amount_cents"), 0) INTO v_already
    FROM "reservation_refunds"
    WHERE "reservation_id" = NEW."reservation_id" AND "id" <> NEW."id" AND "status" <> 'failed';
  IF NEW."amount_cents" + v_already > COALESCE(v_captured, 0) THEN
    RAISE EXCEPTION 'refunds cannot exceed the captured total (§24.8)';
  END IF;

  IF v_type = 'pre_build' AND NEW."idea_exception_reason" IS NULL THEN
    RAISE EXCEPTION 'after a valid capture an Idea refund exists only for a §24.9 exception, and the case names which one';
  END IF;
  IF v_type = 'pre_launch' AND NEW."idea_exception_reason" IS NOT NULL THEN
    RAISE EXCEPTION 'a Product refund is governed by the recorded Founder policy, not §24.9''s Idea exceptions (§24.10)';
  END IF;

  SELECT "reservation_id", "case_kind" INTO v_alloc_reservation, v_alloc_kind
    FROM "refund_cause_allocations" WHERE "id" = NEW."allocation_id";
  IF v_alloc_reservation IS DISTINCT FROM NEW."reservation_id" THEN
    RAISE EXCEPTION 'a refund''s cause allocation must classify its own reservation (§24.8)';
  END IF;
  IF v_alloc_kind IS DISTINCT FROM 'refund' THEN
    RAISE EXCEPTION 'a refund cites a refund-kind allocation (§24.8)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "reservation_refunds_shape"
  BEFORE INSERT ON "reservation_refunds"
  FOR EACH ROW EXECUTE FUNCTION enforce_reservation_refund_shape();--> statement-breakpoint

-- requested → submitted/failed, submitted → succeeded/failed, failed →
-- submitted (the retry under the SAME provider key), succeeded terminal —
-- the shared register's map, restated where an UPDATE cannot argue with it.
CREATE OR REPLACE FUNCTION enforce_reservation_refund_transitions()
RETURNS trigger AS $$
BEGIN
  IF NEW."reservation_id" IS DISTINCT FROM OLD."reservation_id"
     OR NEW."campaign_id" IS DISTINCT FROM OLD."campaign_id"
     OR NEW."allocation_id" IS DISTINCT FROM OLD."allocation_id"
     OR NEW."amount_cents" IS DISTINCT FROM OLD."amount_cents"
     OR NEW."reference" IS DISTINCT FROM OLD."reference"
     OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
     OR NEW."idea_exception_reason" IS DISTINCT FROM OLD."idea_exception_reason"
     OR NEW."payment_intent_id" IS DISTINCT FROM OLD."payment_intent_id"
     OR NEW."requested_by" IS DISTINCT FROM OLD."requested_by"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'reservation_refunds identity and amount are immutable — a different amount is a different refund (§24.8)';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NOT (
      (OLD."status" = 'requested' AND NEW."status" IN ('submitted', 'failed'))
      OR (OLD."status" = 'submitted' AND NEW."status" IN ('succeeded', 'failed'))
      OR (OLD."status" = 'failed' AND NEW."status" = 'submitted')
    ) THEN
      RAISE EXCEPTION 'illegal refund transition % -> % (§33.9.2)', OLD."status", NEW."status";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "reservation_refunds_transitions"
  BEFORE UPDATE ON "reservation_refunds"
  FOR EACH ROW EXECUTE FUNCTION enforce_reservation_refund_transitions();--> statement-breakpoint

CREATE OR REPLACE FUNCTION refuse_reservation_refund_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'reservation_refunds rows are never deleted (§25.6)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "reservation_refunds_no_delete"
  BEFORE DELETE ON "reservation_refunds"
  FOR EACH ROW EXECUTE FUNCTION refuse_reservation_refund_delete();--> statement-breakpoint

CREATE OR REPLACE FUNCTION refuse_reservation_refund_event_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'reservation_refund_events is append-only (§23, §25.6)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "reservation_refund_events_append_only"
  BEFORE UPDATE OR DELETE ON "reservation_refund_events"
  FOR EACH ROW EXECUTE FUNCTION refuse_reservation_refund_event_change();--> statement-breakpoint

-- ── Grants ──────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON "refund_cause_allocations" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "refund_cause_allocations" FROM proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "reservation_refunds" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "reservation_refunds" FROM proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "reservation_refund_events" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "reservation_refund_events" FROM proovd_app;
