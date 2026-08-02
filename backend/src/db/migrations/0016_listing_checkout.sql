-- ── The listing-fee stream — Spec §24.6, §13, §14.6, §29.6, §31.6 ───────────
--
-- The first money the product takes, stored as its own stream: the payment the
-- Founder was shown and consented to, the single full refund the §13 promise
-- can produce, and the §31.6 cancellation decision. §33.3.6 requires this money
-- reconcilable entirely separately from Connect campaign money — nothing here
-- references a reservation, an association ledger, or a connected account.
--
-- Three properties live in the database rather than in a service:
--
--   "once"        — the refund table is unique on the payment; a second full
--                   refund cannot be inserted, by anyone, ever (§33.3.8).
--   "never partial" — a BEFORE INSERT trigger compares the refund to the
--                   payment row and refuses anything but the whole total.
--   "the clock never moves" — the two §6 deadlines are computed at payment,
--                   CHECK-pinned to paid_at + the stored window, and the
--                   immutability trigger refuses to touch them (§29.6).

CREATE TYPE "public"."listing_refund_trigger" AS ENUM (
  'zero_eligible_recruits',
  'no_mutual_acceptance',
  'creator_replacement_failed',
  'founder_free_cancellation',
  'admin_discretion'
);--> statement-breakpoint
CREATE TYPE "public"."listing_refund_status" AS ENUM ('initiated', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."cancellation_kind" AS ENUM ('free_window', 'admin_review');--> statement-breakpoint
CREATE TYPE "public"."cancellation_status" AS ENUM ('pending', 'canceled', 'denied');--> statement-breakpoint

-- ── listing_fee_payments (§24.6, §13) ───────────────────────────────────────

CREATE TABLE "listing_fee_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	-- The §12 calculation that was locked and charged.
	"calculation_id" uuid NOT NULL,
	-- §34 condition 5: test and live money are provably never mixed.
	"mode" "stripe_mode" NOT NULL,
	"checkout_session_id" text NOT NULL,
	"payment_intent_id" text,
	"currency" char(3) DEFAULT 'USD' NOT NULL,

	-- §24.6: "Base, each optional discount, promotion, tax, total."
	"base_cents" bigint NOT NULL,
	"discount_cents" bigint NOT NULL,
	"discount_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	-- §24.6 names promotion in the stream. No promotion mechanism exists in the
	-- MVP and §1 rule 6 forbids inventing one, so this records 0 — "no promotion
	-- applied" is a fact, unlike a zero tax, which would be a claim (§1.4).
	"promotion_cents" bigint DEFAULT 0 NOT NULL,
	"subtotal_cents" bigint NOT NULL,
	"tax_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,

	-- The stored Stripe Tax calculation the consented total came from (§32.4).
	"tax_calculation_id" text,

	"descriptor" text DEFAULT 'PROOVD LISTING' NOT NULL,
	"receipt_url" text,

	-- A.5's optional consent — §28.4: its own record, never bundled.
	"newsletter_opt_in" boolean DEFAULT false NOT NULL,
	"newsletter_opt_in_at" timestamp with time zone,

	-- Mirrors campaigns.listing_paid_at (§21: a dedicated anchor, never inferred).
	"paid_at" timestamp with time zone NOT NULL,

	-- The two §6 clocks, computed at payment from the settings in force. The
	-- hour values are stored beside the deadlines so a later settings change is
	-- visibly not retroactive (§29.6).
	"response_window_hours" integer NOT NULL,
	"response_deadline_at" timestamp with time zone NOT NULL,
	"free_cancellation_window_hours" integer NOT NULL,
	"free_cancellation_deadline_at" timestamp with time zone NOT NULL,

	-- The webhook delivery that recorded it, when one did.
	"provider_event_id" text,

	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listing_fee_payments" ADD CONSTRAINT "listing_fee_payments_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_fee_payments" ADD CONSTRAINT "listing_fee_payments_calculation_fk"
  FOREIGN KEY ("calculation_id") REFERENCES "public"."listing_fee_calculations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Retry-safe at the root: a duplicate checkout.session.completed cannot create
-- a second payment for the campaign, and one session cannot pay twice.
CREATE UNIQUE INDEX "listing_fee_payments_campaign_idx" ON "listing_fee_payments" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_fee_payments_session_idx" ON "listing_fee_payments" USING btree ("checkout_session_id");--> statement-breakpoint
CREATE INDEX "listing_fee_payments_deadline_idx" ON "listing_fee_payments" USING btree ("response_deadline_at");--> statement-breakpoint

-- §24.3's discipline on Proovd's own fee: the lines must reconcile, exactly.
ALTER TABLE "listing_fee_payments" ADD CONSTRAINT "listing_fee_payments_arithmetic"
  CHECK (
    "base_cents" >= 0
    AND "discount_cents" >= 0
    AND "promotion_cents" >= 0
    AND "subtotal_cents" >= 0
    AND "tax_cents" >= 0
    AND "subtotal_cents" = "base_cents" - "discount_cents" - "promotion_cents"
    AND "total_cents" = "subtotal_cents" + "tax_cents"
  );--> statement-breakpoint

-- §24.6 fixes the descriptor. A different one would be a different promise on
-- a stranger's card statement.
ALTER TABLE "listing_fee_payments" ADD CONSTRAINT "listing_fee_payments_descriptor"
  CHECK ("descriptor" = 'PROOVD LISTING');--> statement-breakpoint

-- §29.6: the stored deadline IS paid_at plus the stored window. A row that
-- claimed a different pairing would be a deadline nobody can explain.
ALTER TABLE "listing_fee_payments" ADD CONSTRAINT "listing_fee_payments_deadlines"
  CHECK (
    "response_window_hours" > 0
    AND "free_cancellation_window_hours" > 0
    AND "response_deadline_at" = "paid_at" + make_interval(hours => "response_window_hours")
    AND "free_cancellation_deadline_at" = "paid_at" + make_interval(hours => "free_cancellation_window_hours")
  );--> statement-breakpoint

-- What was paid, when, and the clocks it started are recorded, not edited.
-- Only the receipt reference may be filled in after the fact.
CREATE OR REPLACE FUNCTION enforce_listing_payment_immutable()
RETURNS trigger AS $$
BEGIN
  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.calculation_id IS DISTINCT FROM OLD.calculation_id
     OR NEW.mode IS DISTINCT FROM OLD.mode
     OR NEW.checkout_session_id IS DISTINCT FROM OLD.checkout_session_id
     OR NEW.payment_intent_id IS DISTINCT FROM OLD.payment_intent_id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.base_cents IS DISTINCT FROM OLD.base_cents
     OR NEW.discount_cents IS DISTINCT FROM OLD.discount_cents
     OR NEW.discount_lines IS DISTINCT FROM OLD.discount_lines
     OR NEW.promotion_cents IS DISTINCT FROM OLD.promotion_cents
     OR NEW.subtotal_cents IS DISTINCT FROM OLD.subtotal_cents
     OR NEW.tax_cents IS DISTINCT FROM OLD.tax_cents
     OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
     OR NEW.tax_calculation_id IS DISTINCT FROM OLD.tax_calculation_id
     OR NEW.descriptor IS DISTINCT FROM OLD.descriptor
     OR NEW.newsletter_opt_in IS DISTINCT FROM OLD.newsletter_opt_in
     OR NEW.newsletter_opt_in_at IS DISTINCT FROM OLD.newsletter_opt_in_at
     OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
     OR NEW.response_window_hours IS DISTINCT FROM OLD.response_window_hours
     OR NEW.response_deadline_at IS DISTINCT FROM OLD.response_deadline_at
     OR NEW.free_cancellation_window_hours IS DISTINCT FROM OLD.free_cancellation_window_hours
     OR NEW.free_cancellation_deadline_at IS DISTINCT FROM OLD.free_cancellation_deadline_at
     OR NEW.provider_event_id IS DISTINCT FROM OLD.provider_event_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'listing_fee_payments is recorded, not edited: only receipt_url may be filled in';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER listing_payment_immutable
  BEFORE UPDATE ON "listing_fee_payments"
  FOR EACH ROW EXECUTE FUNCTION enforce_listing_payment_immutable();--> statement-breakpoint

GRANT SELECT, INSERT ON "listing_fee_payments" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("receipt_url") ON "listing_fee_payments" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "listing_fee_payments" FROM proovd_app;--> statement-breakpoint

-- ── listing_fee_refunds (§13, §33.3.8) ──────────────────────────────────────

CREATE TABLE "listing_fee_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"trigger" "listing_refund_trigger" NOT NULL,
	"status" "listing_refund_status" DEFAULT 'initiated' NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"subtotal_refunded_cents" bigint NOT NULL,
	"tax_refunded_cents" bigint NOT NULL,
	"total_refunded_cents" bigint NOT NULL,
	-- §24.6: "Refund object and tax reversal/correction."
	"refund_object_id" text,
	-- §25.6: internal reason and customer-facing explanation, separately.
	"actor" text NOT NULL,
	"internal_reason" text NOT NULL,
	"customer_explanation" text NOT NULL,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "listing_fee_refunds" ADD CONSTRAINT "listing_fee_refunds_payment_fk"
  FOREIGN KEY ("payment_id") REFERENCES "public"."listing_fee_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_fee_refunds" ADD CONSTRAINT "listing_fee_refunds_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- §33.3.8's "once", as an index rather than a promise.
CREATE UNIQUE INDEX "listing_fee_refunds_payment_idx" ON "listing_fee_refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "listing_fee_refunds_campaign_idx" ON "listing_fee_refunds" USING btree ("campaign_id");--> statement-breakpoint

ALTER TABLE "listing_fee_refunds" ADD CONSTRAINT "listing_fee_refunds_arithmetic"
  CHECK (
    "subtotal_refunded_cents" >= 0
    AND "tax_refunded_cents" >= 0
    AND "total_refunded_cents" = "subtotal_refunded_cents" + "tax_refunded_cents"
    AND "total_refunded_cents" > 0
  );--> statement-breakpoint

-- §13: the promise is the ENTIRE Checkout charge — subtotal plus its tax
-- reversal or correction. Never partial is checked against the payment row
-- itself, so a service bug cannot under-refund quietly.
CREATE OR REPLACE FUNCTION enforce_listing_refund_full()
RETURNS trigger AS $$
DECLARE
  paid RECORD;
BEGIN
  SELECT subtotal_cents, tax_cents, total_cents, campaign_id
    INTO paid
    FROM listing_fee_payments
    WHERE id = NEW.payment_id;
  IF paid IS NULL THEN
    RAISE EXCEPTION 'listing_fee_refunds must reference a recorded payment';
  END IF;
  IF NEW.campaign_id IS DISTINCT FROM paid.campaign_id THEN
    RAISE EXCEPTION 'listing_fee_refunds campaign must match the payment''s campaign';
  END IF;
  IF NEW.subtotal_refunded_cents IS DISTINCT FROM paid.subtotal_cents
     OR NEW.tax_refunded_cents IS DISTINCT FROM paid.tax_cents
     OR NEW.total_refunded_cents IS DISTINCT FROM paid.total_cents THEN
    RAISE EXCEPTION 'the listing-fee refund is the entire Checkout charge — subtotal plus tax — never partial (§13)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER listing_refund_full
  BEFORE INSERT ON "listing_fee_refunds"
  FOR EACH ROW EXECUTE FUNCTION enforce_listing_refund_full();--> statement-breakpoint

-- The decision is recorded once; only the provider's confirmation may land
-- afterwards. A refund whose amount or trigger could be edited later is not
-- evidence of anything.
CREATE OR REPLACE FUNCTION enforce_listing_refund_immutable()
RETURNS trigger AS $$
BEGIN
  IF NEW.payment_id IS DISTINCT FROM OLD.payment_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.trigger IS DISTINCT FROM OLD.trigger
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.subtotal_refunded_cents IS DISTINCT FROM OLD.subtotal_refunded_cents
     OR NEW.tax_refunded_cents IS DISTINCT FROM OLD.tax_refunded_cents
     OR NEW.total_refunded_cents IS DISTINCT FROM OLD.total_refunded_cents
     OR NEW.actor IS DISTINCT FROM OLD.actor
     OR NEW.internal_reason IS DISTINCT FROM OLD.internal_reason
     OR NEW.customer_explanation IS DISTINCT FROM OLD.customer_explanation
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'listing_fee_refunds is recorded, not edited: only the provider confirmation may change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER listing_refund_immutable
  BEFORE UPDATE ON "listing_fee_refunds"
  FOR EACH ROW EXECUTE FUNCTION enforce_listing_refund_immutable();--> statement-breakpoint

GRANT SELECT, INSERT ON "listing_fee_refunds" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("status", "refund_object_id", "confirmed_at", "failure_message") ON "listing_fee_refunds" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "listing_fee_refunds" FROM proovd_app;--> statement-breakpoint

-- ── campaign_cancellations (§31.6, §33.3.11) ────────────────────────────────

CREATE TABLE "campaign_cancellations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"kind" "cancellation_kind" NOT NULL,
	"status" "cancellation_status" NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"internal_reason" text NOT NULL,
	"customer_explanation" text NOT NULL,
	"refund_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_cancellations" ADD CONSTRAINT "campaign_cancellations_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_cancellations" ADD CONSTRAINT "campaign_cancellations_refund_fk"
  FOREIGN KEY ("refund_id") REFERENCES "public"."listing_fee_refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- One open request per campaign. A second request while one waits is a
-- duplicate, not a new decision.
CREATE UNIQUE INDEX "campaign_cancellations_pending_idx" ON "campaign_cancellations" USING btree ("campaign_id")
  WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "campaign_cancellations_campaign_idx" ON "campaign_cancellations" USING btree ("campaign_id", "requested_at");--> statement-breakpoint

-- A free-window cancellation is born decided; only a pending admin_review row
-- may be decided later, exactly once, and the request itself never changes.
ALTER TABLE "campaign_cancellations" ADD CONSTRAINT "campaign_cancellations_decided_complete"
  CHECK (
    ("status" = 'pending' AND "decided_by" IS NULL AND "decided_at" IS NULL)
    OR ("status" <> 'pending' AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL)
  );--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_cancellation_decision()
RETURNS trigger AS $$
BEGIN
  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.internal_reason IS DISTINCT FROM OLD.internal_reason
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'campaign_cancellations requests are recorded, not edited';
  END IF;
  IF OLD.status <> 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'a decided cancellation cannot be re-decided';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER campaign_cancellations_decision
  BEFORE UPDATE ON "campaign_cancellations"
  FOR EACH ROW EXECUTE FUNCTION enforce_cancellation_decision();--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON "campaign_cancellations" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "campaign_cancellations" FROM proovd_app;
