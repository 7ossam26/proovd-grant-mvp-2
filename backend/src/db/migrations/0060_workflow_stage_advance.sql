-- The workflow ratchet's writer — 2026-08-22.
--
-- 0059 added `campaigns.workflow_stage_reached` and the trigger that refuses a
-- BACKWARD move. It deliberately added nothing that moves it FORWARD, because
-- advancing belongs with the transitions that cause it.
--
-- Doing that in each router would mean eleven call sites, every one of which is
-- a place somebody forgets. The high-water mark is a pure function of the
-- lifecycle status, so it belongs where the status changes — which is one
-- statement, in the database, for every writer that exists or ever will.
--
-- This is the same reasoning `record_claim_profile_edits` and the other history
-- triggers in this tree already carry: a service that writes the derived row is
-- one a careless `db.update()` bypasses.
--
-- The four exit statuses (`refunded_no_creator`, `suspended`, `killed`,
-- `banned_founder`) map to NO stage and leave the mark where it stands. They are
-- exits from the workflow, not positions in it — advancing on one would tell the
-- panel a campaign had reached a stage it never saw.

CREATE OR REPLACE FUNCTION "campaign_workflow_stage_for_status"(status text)
RETURNS text AS $$
BEGIN
  RETURN CASE status
    WHEN 'invited_draft'               THEN 'invite'
    WHEN 'vetting_submitted'           THEN 'onboarding'
    WHEN 'account_claimed'             THEN 'onboarding'
    WHEN 'stripe_onboarding_pending'   THEN 'onboarding'
    WHEN 'listing_fee_pending'         THEN 'fee'
    WHEN 'affiliate_response_and_build' THEN 'matching'
    WHEN 'pending_review'              THEN 'setup'
    WHEN 'changes_required'            THEN 'setup'
    WHEN 'approved'                    THEN 'launch'
    WHEN 'creator_prep'                THEN 'launch'
    WHEN 'creator_replacement'         THEN 'launch'
    WHEN 'live'                        THEN 'live'
    WHEN 'closed_pending_capture'      THEN 'ended'
    WHEN 'capture_retry_window'        THEN 'ended'
    WHEN 'closed_reconciling'          THEN 'ended'
    WHEN 'ended_no_charge'             THEN 'ended'
    WHEN 'captured_pending_w9'         THEN 'delivery'
    WHEN 'single_payment_released'     THEN 'delivery'
    WHEN 'first_payment_released'      THEN 'delivery'
    WHEN 'day_14_review'               THEN 'delivery'
    WHEN 'remaining_payment_released'  THEN 'delivery'
    WHEN 'fulfilled'                   THEN 'complete'
    WHEN 'closed_resolved'             THEN 'complete'
    -- `review` has no lifecycle status: §9 defines none, and 0059 gives the
    -- application decision its own record rather than overloading the enum.
    -- The four exit statuses fall through here too.
    ELSE NULL
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "campaign_workflow_stage_advance"() RETURNS trigger AS $$
DECLARE
  ord text[] := ARRAY['invite','onboarding','review','fee','matching','setup',
                      'launch','live','ended','delivery','complete'];
  target text;
BEGIN
  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NEW;
  END IF;

  target := "campaign_workflow_stage_for_status"(NEW."status"::text);
  IF target IS NULL THEN
    RETURN NEW;
  END IF;

  -- Forward only. The 0059 ratchet would raise on a lower value anyway; this
  -- keeps an ordinary backward status move (changes_required after
  -- pending_review) from tripping it at all.
  IF array_position(ord, target) > array_position(ord, NEW."workflow_stage_reached") THEN
    NEW."workflow_stage_reached" := target;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- BEFORE, and before the 0059 ratchet fires on the same row: this sets the new
-- value rather than validating one, so it must run first.
CREATE TRIGGER "campaigns_workflow_stage_advance"
  BEFORE UPDATE ON "campaigns"
  FOR EACH ROW EXECUTE FUNCTION "campaign_workflow_stage_advance"();
--> statement-breakpoint

-- Backfill: every existing campaign gets the mark its current status implies.
-- The ratchet refuses a lower value, so this is disabled around the write —
-- a campaign sent back to `changes_required` would otherwise be refused here.
ALTER TABLE "campaigns" DISABLE TRIGGER "campaigns_workflow_stage_ratchet";
--> statement-breakpoint
UPDATE "campaigns"
   SET "workflow_stage_reached" =
       COALESCE("campaign_workflow_stage_for_status"("status"::text), "workflow_stage_reached");
--> statement-breakpoint
ALTER TABLE "campaigns" ENABLE TRIGGER "campaigns_workflow_stage_ratchet";
