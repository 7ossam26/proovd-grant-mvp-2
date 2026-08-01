-- ── The embedded interview's provider binding — Spec §12, tech-stack §12 ────
--
-- tech-stack §12: "The booking record in our database is the source of truth,
-- populated from Cal.com webhooks." 09a built the record and its lifecycle; this
-- adds the one column that lets a signed webhook be attached to the right
-- campaign, and nothing else. The statuses, the history, the CHECK constraints,
-- and §33.3.3's recalculation are all already there.
--
-- ── Why a reference of our own, when the payload carries metadata ───────────
-- Cal.com lets the embed prefill arbitrary metadata, and the embed is opened by
-- the Founder. So a campaign id in the metadata is a value the *booker* chooses,
-- and trusting it would let one Founder attach a booking — and the US$2 discount
-- and the high-effort input that follow it — to another Founder's campaign. The
-- webhook signature proves the payload came from Cal.com; it proves nothing
-- about who typed what into it.
--
-- `proovd_reference` is what the embed actually carries: an HMAC over the
-- campaign id, computed server-side and handed only to the authenticated
-- Founder of that campaign. The ingest recomputes it, so a forged one does not
-- verify. The attendee's email is then checked against that campaign's Founder
-- independently, so two facts have to agree before a booking binds.
--
-- Not unique: the reference identifies the CAMPAIGN, and a campaign whose first
-- interview was canceled books a second one under the same reference. What is
-- unique — one live booking per campaign — was already enforced in 0012.

ALTER TABLE "founder_interview_bookings" ADD COLUMN "proovd_reference" text;--> statement-breakpoint
CREATE INDEX "founder_interview_bookings_reference_idx" ON "founder_interview_bookings" USING btree ("proovd_reference");--> statement-breakpoint

-- The reference records which campaign's embed produced this booking, so it
-- cannot be repointed at another. Same reasoning as `campaign_assets.storage_key`
-- (0012): the binding is the security property, and one that can be edited is
-- not a binding.
CREATE OR REPLACE FUNCTION enforce_booking_reference_immutable()
RETURNS trigger AS $$
BEGIN
  IF OLD.proovd_reference IS NOT NULL
     AND NEW.proovd_reference IS DISTINCT FROM OLD.proovd_reference THEN
    RAISE EXCEPTION 'founder_interview_bookings.proovd_reference cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER founder_interview_bookings_reference_immutable
  BEFORE UPDATE ON "founder_interview_bookings"
  FOR EACH ROW EXECUTE FUNCTION enforce_booking_reference_immutable();--> statement-breakpoint

-- ── provider_events already exists and already does this job ───────────────
-- Phase 03 built it with `provider` defaulting to 'stripe' and a unique index on
-- (provider, provider_event_id). Cal.com deliveries insert with
-- provider = 'calcom', so a redelivered webhook is skipped by the same pivot
-- that will skip a redelivered Stripe event. No second table, and no second
-- idempotency mechanism to keep in step with the first.
--
-- One column is added: the provider's id for the thing the event is about, so
-- an Admin chasing a missed delivery can find it in the provider without a
-- second lookup table.
ALTER TABLE "provider_events" ADD COLUMN "subject_id" text;--> statement-breakpoint
CREATE INDEX "provider_events_subject_idx" ON "provider_events" USING btree ("provider","subject_id");
