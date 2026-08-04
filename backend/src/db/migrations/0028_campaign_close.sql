-- Phase 18a — the §21 close batch, capture attempts, and the reservation
-- capture facts (§21, §24.2, §25.2, §33.7.5, §33.7.7, §33.7.12).
--
-- Hand-written guarantees below the tables:
--   * the Idea threshold decision is immutable once made (§33.7.5 — "fixed at
--     close"; payment failures never reverse it, and neither can an UPDATE);
--   * the one retry window is fixed: deadline = first failure + the stored
--     §6 hours, pinned by CHECK, immutable once set (§21 step 8, §29.6);
--   * a capture attempt's identity — reservation, number, idempotency key,
--     amount — is immutable, so a retry is the SAME attempt at the provider
--     and can never become a second charge (§33.7.7);
--   * a succeeded attempt outcome cannot be rewritten (§25.6).

CREATE TABLE "campaign_close_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "campaign_type" campaign_type NOT NULL,
  "close_at" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'in_progress' NOT NULL,
  "threshold_required" integer,
  "unique_active_backers" integer,
  "threshold_met" boolean,
  "threshold_decided_at" timestamp with time zone,
  "locked_reservation_count" integer,
  "no_charge_reservation_count" integer,
  "retry_window_hours" integer NOT NULL,
  "first_failure_at" timestamp with time zone,
  "retry_deadline_at" timestamp with time zone,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "actor" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "close_batches_status" CHECK (
    "status" IN ('in_progress', 'waiting_dedup_resolution', 'complete')
  ),
  -- §21 step 8: ONE fixed window from the FIRST close-batch failure, using the
  -- §6 hours in force when the batch started. The arithmetic is a CHECK so no
  -- service bug can quietly promise a different deadline (§29.6, §33.3.7's shape).
  CONSTRAINT "close_batches_retry_window" CHECK (
    "retry_deadline_at" IS NULL
    OR (
      "first_failure_at" IS NOT NULL
      AND "retry_deadline_at" = "first_failure_at" + make_interval(hours => "retry_window_hours")
    )
  ),
  -- A decided threshold carries all three facts; a Product batch carries none.
  CONSTRAINT "close_batches_threshold_complete" CHECK (
    ("threshold_decided_at" IS NULL AND "threshold_met" IS NULL)
    OR (
      "threshold_decided_at" IS NOT NULL
      AND "threshold_met" IS NOT NULL
      AND "unique_active_backers" IS NOT NULL
      AND "threshold_required" IS NOT NULL
    )
  ),
  CONSTRAINT "close_batches_positive_window" CHECK ("retry_window_hours" >= 1)
);--> statement-breakpoint

CREATE TABLE "reservation_capture_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reservation_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "attempt_number" integer NOT NULL,
  "idempotency_key" text NOT NULL,
  "amount_cents" bigint NOT NULL,
  "payment_intent_id" text,
  "charge_id" text,
  "outcome" text,
  "failure_code" text,
  "failure_message" text,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  CONSTRAINT "capture_attempts_number" CHECK ("attempt_number" >= 1),
  CONSTRAINT "capture_attempts_amount" CHECK ("amount_cents" >= 0),
  CONSTRAINT "capture_attempts_outcome" CHECK (
    "outcome" IS NULL
    OR "outcome" IN ('succeeded', 'card_declined', 'insufficient_funds', 'requires_action', 'provider_error')
  )
);--> statement-breakpoint

-- §21/§25.2: the reservation's capture facts. `capture_reason` is internal
-- vocabulary (§25.6) — the §33.7.8 kind or `tax_calculation_unusable`.
ALTER TABLE "reservations" ADD COLUMN "payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "charge_id" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "captured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "capture_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "capture_reason" text;--> statement-breakpoint

-- ── Foreign keys ────────────────────────────────────────────────────────────
ALTER TABLE "campaign_close_batches" ADD CONSTRAINT "campaign_close_batches_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_capture_attempts" ADD CONSTRAINT "capture_attempts_reservation_fk"
  FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_capture_attempts" ADD CONSTRAINT "capture_attempts_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "campaign_close_batches_campaign_idx" ON "campaign_close_batches" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_close_batches_status_idx" ON "campaign_close_batches" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "capture_attempts_reservation_attempt_idx" ON "reservation_capture_attempts" USING btree ("reservation_id", "attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "capture_attempts_key_idx" ON "reservation_capture_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "capture_attempts_campaign_idx" ON "reservation_capture_attempts" USING btree ("campaign_id");--> statement-breakpoint

-- ── §33.7.5: the threshold decision is fixed at close ───────────────────────
-- The batch identity and anchors never move; the decision, once made, never
-- changes; the one retry window, once anchored, never moves; a completed batch
-- is history. "Only the state at close counts" is this trigger.
CREATE OR REPLACE FUNCTION enforce_close_batch_immutable()
RETURNS trigger AS $$
BEGIN
  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.campaign_type IS DISTINCT FROM OLD.campaign_type
     OR NEW.close_at IS DISTINCT FROM OLD.close_at
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.retry_window_hours IS DISTINCT FROM OLD.retry_window_hours THEN
    RAISE EXCEPTION 'a close batch''s identity and anchors are immutable (§21)';
  END IF;
  IF OLD.threshold_decided_at IS NOT NULL AND (
       NEW.threshold_met IS DISTINCT FROM OLD.threshold_met
       OR NEW.unique_active_backers IS DISTINCT FROM OLD.unique_active_backers
       OR NEW.threshold_required IS DISTINCT FROM OLD.threshold_required
       OR NEW.threshold_decided_at IS DISTINCT FROM OLD.threshold_decided_at
     ) THEN
    RAISE EXCEPTION 'the Idea threshold decision is fixed at close (§33.7.5)';
  END IF;
  IF OLD.first_failure_at IS NOT NULL AND (
       NEW.first_failure_at IS DISTINCT FROM OLD.first_failure_at
       OR NEW.retry_deadline_at IS DISTINCT FROM OLD.retry_deadline_at
     ) THEN
    RAISE EXCEPTION 'the one retry window is fixed at the first close-batch failure (§21)';
  END IF;
  IF OLD.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'a completed close batch is history (§25.6)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER campaign_close_batches_immutable
  BEFORE UPDATE ON "campaign_close_batches"
  FOR EACH ROW EXECUTE FUNCTION enforce_close_batch_immutable();--> statement-breakpoint

-- ── §33.7.7: an attempt's identity is immutable ─────────────────────────────
-- The stable key and exact amount are what make a retried call the SAME charge
-- at the provider. A succeeded outcome is a fact about money and never rewrites.
CREATE OR REPLACE FUNCTION enforce_capture_attempt_immutable()
RETURNS trigger AS $$
BEGIN
  IF NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION 'a capture attempt''s identity, key, and amount are immutable (§33.7.7)';
  END IF;
  IF OLD.outcome = 'succeeded' AND NEW.outcome IS DISTINCT FROM OLD.outcome THEN
    RAISE EXCEPTION 'a succeeded capture attempt is history (§25.6)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER reservation_capture_attempts_immutable
  BEFORE UPDATE ON "reservation_capture_attempts"
  FOR EACH ROW EXECUTE FUNCTION enforce_capture_attempt_immutable();--> statement-breakpoint

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Both records are operational history: updatable while in flight, never deleted.
GRANT SELECT, INSERT, UPDATE ON "campaign_close_batches" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "campaign_close_batches" FROM proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "reservation_capture_attempts" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "reservation_capture_attempts" FROM proovd_app;
