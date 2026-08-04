-- Phase 19a — Creator completion, earnings finalization, the one Transfer, and
-- the discretionary thank-you (§22.1, §22.2, §24.4, §33.8).
--
-- What the database itself guarantees here, because a service rule is a rule
-- the next route forgets:
--
--   * the §22.1 outcome and the §22.2 kind are CHECK-pinned to their registers;
--   * a waiver exists only with BOTH the Founder's and Admin's agreement;
--   * the §24.4 identity `earned + returned = provisional` and the §33.8.3
--     identity `total = commission + bonus + fixed` are CHECKs, not assertions
--     in a test somebody can skip;
--   * finalized amounts are immutable, and the B.7 state machine's legal
--     transitions are enforced by trigger — an illegal reversal is impossible,
--     not merely unwritten (§23);
--   * a `created` Transfer row can never change again — §33.8.3's "once";
--   * a `returned` or `paid` allocation is terminal — §33.8.8's "cannot
--     repeat" at the level a hand-written UPDATE cannot bypass;
--   * completion decisions, state history, recovery records, and thank-you
--     records are insert-only (§25.6).

-- ── creator_completion_decisions (§22.1) ────────────────────────────────────
CREATE TABLE "creator_completion_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "association_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "outcome" text NOT NULL,
  "deliverables_note" text NOT NULL,
  "waiver" text,
  "waiver_agreed_by_founder" boolean DEFAULT false NOT NULL,
  "waiver_agreed_by_admin" boolean DEFAULT false NOT NULL,
  "evidence" jsonb,
  "decided_by" text NOT NULL,
  "decided_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- The four §22.1 outcomes, pinned (shared/close COMPLETION_OUTCOMES). The
  -- fifth case — no fixed arrangement — is the absence of an allocation, not a
  -- fifth outcome.
  CONSTRAINT "completion_decisions_outcome" CHECK (
    "outcome" IN ('no_valid_post', 'valid_post_later_incomplete', 'complete_verified', 'disqualified')
  ),
  -- §22.1: a verification with no note is a checkbox, not a record (§1.3).
  CONSTRAINT "completion_decisions_note" CHECK (btrim("deliverables_note") <> ''),
  CONSTRAINT "completion_decisions_actor" CHECK (btrim("decided_by") <> ''),
  -- §22.1: "records any waiver agreed by Founder AND Admin" — a waiver without
  -- both agreements, or agreements without a waiver text, is refused.
  CONSTRAINT "completion_decisions_waiver" CHECK (
    ("waiver" IS NULL AND "waiver_agreed_by_founder" = false AND "waiver_agreed_by_admin" = false)
    OR (btrim("waiver") <> '' AND "waiver_agreed_by_founder" = true AND "waiver_agreed_by_admin" = true)
  )
);--> statement-breakpoint

-- ── creator_earnings (§22.1, §24.4, Appendix B.7) ───────────────────────────
CREATE TABLE "creator_earnings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "association_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "completion_decision_id" uuid NOT NULL,
  "state" text DEFAULT 'finalized' NOT NULL,
  "valid_subtotal_cents" bigint NOT NULL,
  "attributed_unique_backers" integer NOT NULL,
  "locked_total_percent" integer NOT NULL,
  "earned_bonus_percent" integer DEFAULT 0 NOT NULL,
  "earned_percent" integer NOT NULL,
  "commission_cents" bigint NOT NULL,
  "bonus_cents" bigint NOT NULL,
  "eligible_fixed_cents" bigint DEFAULT 0 NOT NULL,
  "provisional_total_cents" bigint NOT NULL,
  "earned_total_cents" bigint NOT NULL,
  "unearned_returned_cents" bigint NOT NULL,
  "finalized_by" text NOT NULL,
  "finalized_at" timestamp with time zone DEFAULT now() NOT NULL,
  "approved_by" text,
  "approved_at" timestamp with time zone,
  "adjusted_reason" text,
  "adjusted_by" text,
  "adjusted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- B.7's seven states minus `estimated`: the row's existence IS finalization.
  CONSTRAINT "creator_earnings_state" CHECK (
    "state" IN ('finalized', 'approved_for_transfer', 'transferred', 'paid_out', 'payout_failed', 'adjusted')
  ),
  CONSTRAINT "creator_earnings_amounts_nonnegative" CHECK (
    "valid_subtotal_cents" >= 0 AND "commission_cents" >= 0 AND "bonus_cents" >= 0
    AND "eligible_fixed_cents" >= 0 AND "provisional_total_cents" >= 0
    AND "earned_total_cents" >= 0 AND "unearned_returned_cents" >= 0
  ),
  -- §22.1/§6: the combined percentage never exceeds 50.
  CONSTRAINT "creator_earnings_percent_ceiling" CHECK (
    "earned_percent" >= 0 AND "earned_percent" <= 50
    AND "locked_total_percent" >= 0 AND "locked_total_percent" <= 50
  ),
  -- §22.1: commission + bonus = the earned total, exactly.
  CONSTRAINT "creator_earnings_earned_sum" CHECK (
    "commission_cents" + "bonus_cents" = "earned_total_cents"
  ),
  -- §24.4: the provisional amount resolves EXACTLY into earned + returned.
  -- The identity the §26.6 panel compares, pinned where no service can miss it.
  CONSTRAINT "creator_earnings_provisional_identity" CHECK (
    "earned_total_cents" + "unearned_returned_cents" = "provisional_total_cents"
  )
);--> statement-breakpoint

-- ── creator_earnings_state_history (§23) ────────────────────────────────────
CREATE TABLE "creator_earnings_state_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "earnings_id" uuid NOT NULL,
  "association_id" uuid NOT NULL,
  "from_state" text,
  "to_state" text NOT NULL,
  "actor" text NOT NULL,
  "reason" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- ── affiliate_transfers (§22.1, §33.8.3, §33.8.4) ───────────────────────────
CREATE TABLE "affiliate_transfers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "association_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "earnings_id" uuid NOT NULL,
  "mode" "stripe_mode" NOT NULL,
  "destination_account_id" text NOT NULL,
  "commission_cents" bigint NOT NULL,
  "bonus_cents" bigint NOT NULL,
  "fixed_cents" bigint NOT NULL,
  "total_cents" bigint NOT NULL,
  "currency" char(3) DEFAULT 'USD' NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" text DEFAULT 'initiated' NOT NULL,
  "provider_transfer_id" text,
  "failure_code" text,
  "failure_message" text,
  "attempt_count" integer DEFAULT 1 NOT NULL,
  "created_by" text NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "confirmed_at" timestamp with time zone,
  "last_failed_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "affiliate_transfers_status" CHECK ("status" IN ('initiated', 'created', 'failed')),
  -- §33.8.3: ONE Transfer combining exactly the three components.
  CONSTRAINT "affiliate_transfers_total" CHECK (
    "commission_cents" >= 0 AND "bonus_cents" >= 0 AND "fixed_cents" >= 0
    AND "total_cents" = "commission_cents" + "bonus_cents" + "fixed_cents"
    AND "total_cents" > 0
  ),
  -- §24.1: the destination is a recipient connected account, nothing else.
  CONSTRAINT "affiliate_transfers_destination" CHECK ("destination_account_id" LIKE 'acct\_%'),
  -- A `created` Transfer carries its provider id; the other states never do.
  CONSTRAINT "affiliate_transfers_provider_id" CHECK (
    ("status" = 'created') = ("provider_transfer_id" IS NOT NULL)
  )
);--> statement-breakpoint

-- ── contractual_recovery_records (§22.1) ────────────────────────────────────
CREATE TABLE "contractual_recovery_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "association_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "earnings_id" uuid NOT NULL,
  "transfer_id" uuid,
  "amount_cents" bigint NOT NULL,
  "reason" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "recovery_records_amount" CHECK ("amount_cents" > 0),
  CONSTRAINT "recovery_records_reason" CHECK (btrim("reason") <> '')
);--> statement-breakpoint

-- ── thank_you_records (§22.2, §33.8.14) ─────────────────────────────────────
-- Deliberately: no reservation column, no campaign-ledger column, no
-- source-transaction column. "Never deducted from Backer charges, Founder
-- share, Creator commission, or fixed allocation" is the absence of any path
-- to them, and the suite asserts the absence in information_schema.
CREATE TABLE "thank_you_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "association_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "amount_cents" bigint,
  "currency" char(3) DEFAULT 'USD' NOT NULL,
  "reason" text NOT NULL,
  "funding_source" text NOT NULL,
  "minimum_work_completed" boolean NOT NULL,
  "click_threshold_met" boolean NOT NULL,
  "brand_aup_compliant" boolean NOT NULL,
  "recipient_account_id" text,
  "approval_reference" text,
  "approved_by" text,
  "tax_treatment" text,
  "mode" "stripe_mode",
  "provider_transfer_id" text,
  "provider_status" text,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "thank_you_kind" CHECK ("kind" IN ('recognition', 'payment')),
  CONSTRAINT "thank_you_reason" CHECK (btrim("reason") <> ''),
  -- §22.2's one permitted funding source, pinned. Not a caller's choice.
  CONSTRAINT "thank_you_funding_source" CHECK ("funding_source" = 'proovd_retained_listing_fee_revenue'),
  -- §22.2: a payment needs the amount, the approved recipient path, the
  -- recorded tax/accounting approval, the tax treatment, and all three
  -- eligibility facts confirmed. A recognition carries none of the money
  -- fields — "Admin may record recognition but cannot promise or send money."
  CONSTRAINT "thank_you_payment_complete" CHECK (
    "kind" <> 'payment' OR (
      "amount_cents" > 0
      AND "recipient_account_id" LIKE 'acct\_%'
      AND btrim(COALESCE("approval_reference", '')) <> ''
      AND btrim(COALESCE("approved_by", '')) <> ''
      AND btrim(COALESCE("tax_treatment", '')) <> ''
      AND "mode" IS NOT NULL
      AND "minimum_work_completed" = true
      AND "click_threshold_met" = true
      AND "brand_aup_compliant" = true
    )
  ),
  CONSTRAINT "thank_you_recognition_no_money" CHECK (
    "kind" <> 'recognition' OR (
      "amount_cents" IS NULL AND "provider_transfer_id" IS NULL AND "recipient_account_id" IS NULL
    )
  )
);--> statement-breakpoint

-- ── Foreign keys ────────────────────────────────────────────────────────────
ALTER TABLE "creator_completion_decisions" ADD CONSTRAINT "completion_decisions_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_completion_decisions" ADD CONSTRAINT "completion_decisions_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_earnings" ADD CONSTRAINT "creator_earnings_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_earnings" ADD CONSTRAINT "creator_earnings_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_earnings" ADD CONSTRAINT "creator_earnings_decision_fk"
  FOREIGN KEY ("completion_decision_id") REFERENCES "public"."creator_completion_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_earnings_state_history" ADD CONSTRAINT "earnings_state_history_earnings_fk"
  FOREIGN KEY ("earnings_id") REFERENCES "public"."creator_earnings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_earnings_state_history" ADD CONSTRAINT "earnings_state_history_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_transfers" ADD CONSTRAINT "affiliate_transfers_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_transfers" ADD CONSTRAINT "affiliate_transfers_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_transfers" ADD CONSTRAINT "affiliate_transfers_earnings_fk"
  FOREIGN KEY ("earnings_id") REFERENCES "public"."creator_earnings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractual_recovery_records" ADD CONSTRAINT "recovery_records_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractual_recovery_records" ADD CONSTRAINT "recovery_records_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractual_recovery_records" ADD CONSTRAINT "recovery_records_earnings_fk"
  FOREIGN KEY ("earnings_id") REFERENCES "public"."creator_earnings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractual_recovery_records" ADD CONSTRAINT "recovery_records_transfer_fk"
  FOREIGN KEY ("transfer_id") REFERENCES "public"."affiliate_transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thank_you_records" ADD CONSTRAINT "thank_you_records_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thank_you_records" ADD CONSTRAINT "thank_you_records_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX "completion_decisions_association_idx" ON "creator_completion_decisions" USING btree ("association_id", "decided_at");--> statement-breakpoint
CREATE INDEX "completion_decisions_campaign_idx" ON "creator_completion_decisions" USING btree ("campaign_id");--> statement-breakpoint
-- One finalization per association, ever — §33.8.2's "once" as an index.
CREATE UNIQUE INDEX "creator_earnings_association_idx" ON "creator_earnings" USING btree ("association_id");--> statement-breakpoint
CREATE INDEX "creator_earnings_campaign_idx" ON "creator_earnings" USING btree ("campaign_id", "state");--> statement-breakpoint
CREATE INDEX "earnings_state_history_earnings_idx" ON "creator_earnings_state_history" USING btree ("earnings_id", "occurred_at");--> statement-breakpoint
-- ONE Transfer per association (§22.1, §33.8.3).
CREATE UNIQUE INDEX "affiliate_transfers_association_idx" ON "affiliate_transfers" USING btree ("association_id");--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_transfers_key_idx" ON "affiliate_transfers" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "affiliate_transfers_campaign_idx" ON "affiliate_transfers" USING btree ("campaign_id", "status");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_records_association_idx" ON "contractual_recovery_records" USING btree ("association_id");--> statement-breakpoint
CREATE INDEX "thank_you_records_association_idx" ON "thank_you_records" USING btree ("association_id");--> statement-breakpoint
CREATE INDEX "thank_you_records_campaign_idx" ON "thank_you_records" USING btree ("campaign_id");--> statement-breakpoint
-- One PAYMENT per association, ever — §33.8.14's "cannot duplicate".
CREATE UNIQUE INDEX "thank_you_one_payment_idx" ON "thank_you_records" USING btree ("association_id") WHERE "kind" = 'payment';--> statement-breakpoint

-- ── Triggers ────────────────────────────────────────────────────────────────

-- Finalized amounts are immutable, and the B.7 state machine's transitions are
-- the only movement the row permits (§22.1, §23). The map here restates
-- shared/close EARNINGS_STATE_TRANSITIONS; the suite drift-tests them.
CREATE OR REPLACE FUNCTION enforce_creator_earnings_transitions()
RETURNS trigger AS $$
BEGIN
  IF NEW."association_id" IS DISTINCT FROM OLD."association_id"
     OR NEW."campaign_id" IS DISTINCT FROM OLD."campaign_id"
     OR NEW."completion_decision_id" IS DISTINCT FROM OLD."completion_decision_id"
     OR NEW."valid_subtotal_cents" IS DISTINCT FROM OLD."valid_subtotal_cents"
     OR NEW."attributed_unique_backers" IS DISTINCT FROM OLD."attributed_unique_backers"
     OR NEW."locked_total_percent" IS DISTINCT FROM OLD."locked_total_percent"
     OR NEW."earned_bonus_percent" IS DISTINCT FROM OLD."earned_bonus_percent"
     OR NEW."earned_percent" IS DISTINCT FROM OLD."earned_percent"
     OR NEW."commission_cents" IS DISTINCT FROM OLD."commission_cents"
     OR NEW."bonus_cents" IS DISTINCT FROM OLD."bonus_cents"
     OR NEW."eligible_fixed_cents" IS DISTINCT FROM OLD."eligible_fixed_cents"
     OR NEW."provisional_total_cents" IS DISTINCT FROM OLD."provisional_total_cents"
     OR NEW."earned_total_cents" IS DISTINCT FROM OLD."earned_total_cents"
     OR NEW."unearned_returned_cents" IS DISTINCT FROM OLD."unearned_returned_cents"
     OR NEW."finalized_by" IS DISTINCT FROM OLD."finalized_by"
     OR NEW."finalized_at" IS DISTINCT FROM OLD."finalized_at" THEN
    RAISE EXCEPTION 'creator_earnings finalized amounts are immutable (§22.1); adjustments are their own recorded act';
  END IF;
  IF NEW."state" IS DISTINCT FROM OLD."state" THEN
    IF NOT (
      (OLD."state" = 'finalized'             AND NEW."state" IN ('approved_for_transfer', 'adjusted'))
      OR (OLD."state" = 'approved_for_transfer' AND NEW."state" IN ('transferred', 'adjusted'))
      OR (OLD."state" = 'transferred'        AND NEW."state" IN ('paid_out', 'payout_failed', 'adjusted'))
      OR (OLD."state" = 'payout_failed'      AND NEW."state" IN ('paid_out', 'adjusted'))
      OR (OLD."state" = 'paid_out'           AND NEW."state" = 'adjusted')
    ) THEN
      RAISE EXCEPTION 'illegal earnings state transition % -> % (Appendix B.7, §22.1)', OLD."state", NEW."state";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "creator_earnings_transitions"
  BEFORE UPDATE ON "creator_earnings"
  FOR EACH ROW EXECUTE FUNCTION enforce_creator_earnings_transitions();--> statement-breakpoint

-- §33.8.3: a `created` Transfer is done, forever. A failed one may be retried
-- (failed → initiated → created) under the SAME idempotency key, which the
-- immutable-key half below pins.
CREATE OR REPLACE FUNCTION enforce_affiliate_transfer_immutability()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'created' THEN
    RAISE EXCEPTION 'a created Transfer is immutable (§22.1, §33.8.3)';
  END IF;
  IF NEW."association_id" IS DISTINCT FROM OLD."association_id"
     OR NEW."campaign_id" IS DISTINCT FROM OLD."campaign_id"
     OR NEW."earnings_id" IS DISTINCT FROM OLD."earnings_id"
     OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
     OR NEW."commission_cents" IS DISTINCT FROM OLD."commission_cents"
     OR NEW."bonus_cents" IS DISTINCT FROM OLD."bonus_cents"
     OR NEW."fixed_cents" IS DISTINCT FROM OLD."fixed_cents"
     OR NEW."total_cents" IS DISTINCT FROM OLD."total_cents" THEN
    RAISE EXCEPTION 'affiliate_transfers identity and amounts are immutable — a different amount is a different Transfer (§33.8.3)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "affiliate_transfers_immutability"
  BEFORE UPDATE ON "affiliate_transfers"
  FOR EACH ROW EXECUTE FUNCTION enforce_affiliate_transfer_immutability();--> statement-breakpoint

-- §33.8.8: a returned or paid allocation cannot repeat. Terminal at the level
-- a support script cannot bypass; the return columns freeze with it.
CREATE OR REPLACE FUNCTION enforce_allocation_terminal_states()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('returned', 'paid') AND (
    NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."return_eligible" IS DISTINCT FROM OLD."return_eligible"
    OR NEW."return_amount_cents" IS DISTINCT FROM OLD."return_amount_cents"
    OR NEW."return_reason" IS DISTINCT FROM OLD."return_reason"
    OR NEW."return_object_id" IS DISTINCT FROM OLD."return_object_id"
    OR NEW."transfer_object_id" IS DISTINCT FROM OLD."transfer_object_id"
  ) THEN
    RAISE EXCEPTION 'a % fixed allocation is terminal and cannot repeat (§22.1, §33.8.8)', OLD."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "creator_payment_allocations_terminal"
  BEFORE UPDATE ON "creator_payment_allocations"
  FOR EACH ROW EXECUTE FUNCTION enforce_allocation_terminal_states();--> statement-breakpoint

-- §23: history is append-only at the level even the table owner cannot
-- bypass — a grant binds the app role, a trigger binds everyone.
CREATE OR REPLACE FUNCTION refuse_earnings_history_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'creator_earnings_state_history is append-only (§23, §25.6)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "earnings_state_history_append_only"
  BEFORE UPDATE OR DELETE ON "creator_earnings_state_history"
  FOR EACH ROW EXECUTE FUNCTION refuse_earnings_history_change();--> statement-breakpoint

-- ── Grants ──────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON "creator_completion_decisions" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "creator_completion_decisions" FROM proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "creator_earnings" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "creator_earnings" FROM proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "creator_earnings_state_history" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "creator_earnings_state_history" FROM proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "affiliate_transfers" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "affiliate_transfers" FROM proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "contractual_recovery_records" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "contractual_recovery_records" FROM proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "thank_you_records" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "thank_you_records" FROM proovd_app;
