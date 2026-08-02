-- ── The optional fixed Creator payment as a separate stream — §16, §24.7 ──────
--
-- Phase 13. A fourth money stream: an optional fixed Creator payment, requested
-- by the Creator, accepted by both parties through one proposal version, funded
-- in full by the Founder before any work begins (§16). It is separate from
-- Backer charges, sales tax, Proovd's 5%, and percentage compensation, and no
-- percentage applies to it (§24.7).
--
-- Two schema instructions carry through:
--   §16  — funding statuses are `not_requested → payment_pending → funded →
--          paid`, with `payment_failed` and `returned` as branches. Funded is
--          NOT paid; whether the Creator earned it is §22.1's outcome (Phase 19).
--   §24.7 — the stream "never changes Backer totals, 5%, Creator percentage
--          base, sales tax, threshold, or cap." No column here can hold Backer
--          or Connect-campaign money; §33 asserts the absence in information_schema.
--
-- Never a §3.2-forbidden holding-account word, and never the split-payout
-- vocabulary — in a table name, a column name, a value, or a comment (§16, §3.1).

CREATE TYPE "public"."creator_payment_status" AS ENUM ('not_requested', 'payment_pending', 'funded', 'payment_failed', 'returned', 'paid');--> statement-breakpoint
CREATE TYPE "public"."funding_attempt_status" AS ENUM ('succeeded', 'failed');--> statement-breakpoint

-- ── creator_payment_allocations (§16, §24.7) ─────────────────────────────────
-- One allocation per association whose mutually accepted version carried a fixed
-- payment. The exact accepted amount, the §16 funding state, the
-- Admin-configured funding deadline, and the §24.7 return/completion/Transfer
-- fields Phase 19 fills.

CREATE TABLE "creator_payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	-- §24.7: the mutually accepted proposal version. A fixed payment only ever
	-- arrives through a version, so this is NOT NULL — a standard-terms agreement
	-- carries no fixed amount.
	"proposal_version_id" uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"status" "creator_payment_status" DEFAULT 'payment_pending' NOT NULL,
	"mode" "stripe_mode" NOT NULL,
	-- §16/§24.7: the EXACT accepted amount, integer cents. Immutable by trigger.
	"amount_cents" bigint NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	-- §24.7: "tax/accounting treatment." A recorded classification, never a
	-- computed tax line (§24.7 excludes sales tax from the stream).
	"tax_treatment" text NOT NULL,
	-- §16: "the Admin-configured funding deadline." §6 fixes no value, so this is
	-- null until a person records it.
	"funding_deadline_at" timestamp with time zone,
	"funding_deadline_set_by" text,
	"funding_deadline_set_at" timestamp with time zone,
	"funded_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"canceled_by" text,
	"canceled_reason" text,
	-- §24.7's return eligibility (Phase 19 fills these).
	"return_eligible" boolean,
	"return_amount_cents" bigint,
	"return_reason" text,
	"return_object_id" text,
	-- §24.7's completion eligibility/evidence and Transfer/payout record (Phase 19).
	"completion_eligible" boolean,
	"completion_evidence" jsonb,
	"transfer_object_id" text,
	"payout_object_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creator_payment_allocations" ADD CONSTRAINT "creator_payment_allocations_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_payment_allocations" ADD CONSTRAINT "creator_payment_allocations_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_payment_allocations" ADD CONSTRAINT "creator_payment_allocations_version_fk"
  FOREIGN KEY ("proposal_version_id") REFERENCES "public"."proposal_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_payment_allocations" ADD CONSTRAINT "creator_payment_allocations_agreement_fk"
  FOREIGN KEY ("agreement_id") REFERENCES "public"."association_compensation_agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- §16: "Create ONE campaign-and-Creator allocation." One per association, ever.
CREATE UNIQUE INDEX "creator_payment_allocations_association_idx" ON "creator_payment_allocations" USING btree ("association_id");--> statement-breakpoint
CREATE INDEX "creator_payment_allocations_campaign_idx" ON "creator_payment_allocations" USING btree ("campaign_id", "status");--> statement-breakpoint
-- §16/§24.7: the accepted amount is a positive figure; partial funding is
-- rejected, so a funded/paid allocation must carry the funding moment.
ALTER TABLE "creator_payment_allocations" ADD CONSTRAINT "creator_payment_allocations_amount_positive"
  CHECK ("amount_cents" > 0);--> statement-breakpoint
ALTER TABLE "creator_payment_allocations" ADD CONSTRAINT "creator_payment_allocations_funded_pair"
  CHECK ("status" NOT IN ('funded', 'paid') OR "funded_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "creator_payment_allocations" ADD CONSTRAINT "creator_payment_allocations_deadline_pair"
  CHECK (("funding_deadline_at" IS NULL) = ("funding_deadline_set_by" IS NULL));--> statement-breakpoint
ALTER TABLE "creator_payment_allocations" ADD CONSTRAINT "creator_payment_allocations_canceled_pair"
  CHECK (("canceled_at" IS NULL) = ("canceled_by" IS NULL));--> statement-breakpoint
-- The allocation's identity and its secured amount are immutable; a funding
-- moment, once recorded, cannot be cleared (partial funding cannot be walked
-- back into "not funded" to fund again). §29.6's rule, applied to money.
CREATE OR REPLACE FUNCTION enforce_creator_payment_allocation()
RETURNS trigger AS $$
BEGIN
  IF NEW.association_id IS DISTINCT FROM OLD.association_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.proposal_version_id IS DISTINCT FROM OLD.proposal_version_id
     OR NEW.agreement_id IS DISTINCT FROM OLD.agreement_id
     OR NEW.mode IS DISTINCT FROM OLD.mode
     OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a Creator payment allocation''s identity and amount are immutable (§16, §24.7)';
  END IF;
  IF OLD.funded_at IS NOT NULL AND NEW.funded_at IS DISTINCT FROM OLD.funded_at THEN
    RAISE EXCEPTION 'a recorded funding moment cannot be changed or cleared (§16)';
  END IF;
  IF OLD.canceled_at IS NOT NULL AND NEW.canceled_at IS DISTINCT FROM OLD.canceled_at THEN
    RAISE EXCEPTION 'a recorded funding-lapse cancellation cannot be reversed (§16)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER creator_payment_allocation_guard
  BEFORE UPDATE ON "creator_payment_allocations"
  FOR EACH ROW EXECUTE FUNCTION enforce_creator_payment_allocation();--> statement-breakpoint
-- A fixed Creator payment is Product-only (§14.3): a trigger refuses to attach
-- an allocation to an Idea Campaign, so even a hand-written INSERT that slipped
-- past the service cannot. §16's trap: an Idea allocation means Phase 12's
-- validation failed, and this makes that impossible rather than merely unlikely.
CREATE OR REPLACE FUNCTION enforce_creator_payment_product_only()
RETURNS trigger AS $$
DECLARE
  campaign_type text;
BEGIN
  SELECT c."type"::text INTO campaign_type FROM "campaigns" c WHERE c."id" = NEW.campaign_id;
  IF campaign_type = 'pre_build' THEN
    RAISE EXCEPTION 'a fixed Creator payment is prohibited on an Idea Campaign (§14.3, §16)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER creator_payment_product_only
  BEFORE INSERT ON "creator_payment_allocations"
  FOR EACH ROW EXECUTE FUNCTION enforce_creator_payment_product_only();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "creator_payment_allocations" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "creator_payment_allocations" FROM proovd_app;--> statement-breakpoint

-- ── creator_payment_funding_attempts (§24.7, §33.4.3) ────────────────────────
-- Append-only. One row per completed funding charge attempt. The Checkout
-- session id is unique, so a replayed webhook under a fresh event id records no
-- second attempt and no second charge.

CREATE TABLE "creator_payment_funding_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"allocation_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"association_id" uuid NOT NULL,
	"mode" "stripe_mode" NOT NULL,
	"checkout_session_id" text NOT NULL,
	"payment_intent_id" text,
	"charge_id" text,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"descriptor" text DEFAULT 'PROOVD CREATOR PAY' NOT NULL,
	"fee_cents" bigint,
	"status" "funding_attempt_status" NOT NULL,
	"idempotency_key" text NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"provider_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "creator_payment_funding_attempts" ADD CONSTRAINT "creator_payment_funding_attempts_allocation_fk"
  FOREIGN KEY ("allocation_id") REFERENCES "public"."creator_payment_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_payment_funding_attempts" ADD CONSTRAINT "creator_payment_funding_attempts_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_payment_funding_attempts" ADD CONSTRAINT "creator_payment_funding_attempts_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- One attempt per Checkout session: a duplicate delivery records nothing new.
CREATE UNIQUE INDEX "creator_payment_funding_attempts_session_idx" ON "creator_payment_funding_attempts" USING btree ("checkout_session_id");--> statement-breakpoint
CREATE INDEX "creator_payment_funding_attempts_allocation_idx" ON "creator_payment_funding_attempts" USING btree ("allocation_id", "created_at");--> statement-breakpoint
-- §24.7 fixes the descriptor for this stream, distinct from `PROOVD LISTING`.
ALTER TABLE "creator_payment_funding_attempts" ADD CONSTRAINT "creator_payment_funding_attempts_descriptor"
  CHECK ("descriptor" = 'PROOVD CREATOR PAY');--> statement-breakpoint
ALTER TABLE "creator_payment_funding_attempts" ADD CONSTRAINT "creator_payment_funding_attempts_amount_positive"
  CHECK ("amount_cents" > 0);--> statement-breakpoint
GRANT SELECT, INSERT ON "creator_payment_funding_attempts" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "creator_payment_funding_attempts" FROM proovd_app;
