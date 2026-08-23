-- Matching follows Campaign Setup and is immediately before Ready to launch.
-- It remains visible in the Admin workflow, but an empty Creator roster must
-- not block a completed campaign build from entering review.

CREATE OR REPLACE FUNCTION "campaign_workflow_stage_for_status"(status text)
RETURNS text AS $$
BEGIN
  RETURN CASE status
    WHEN 'invited_draft'                THEN 'invite'
    WHEN 'vetting_submitted'            THEN 'onboarding'
    WHEN 'account_claimed'              THEN 'onboarding'
    WHEN 'stripe_onboarding_pending'    THEN 'onboarding'
    WHEN 'listing_fee_pending'          THEN 'fee'
    WHEN 'affiliate_response_and_build' THEN 'setup'
    WHEN 'pending_review'               THEN 'matching'
    WHEN 'changes_required'             THEN 'matching'
    WHEN 'approved'                     THEN 'launch'
    WHEN 'creator_prep'                 THEN 'launch'
    WHEN 'creator_replacement'          THEN 'launch'
    WHEN 'live'                         THEN 'live'
    WHEN 'closed_pending_capture'       THEN 'ended'
    WHEN 'capture_retry_window'         THEN 'ended'
    WHEN 'closed_reconciling'           THEN 'ended'
    WHEN 'ended_no_charge'              THEN 'ended'
    WHEN 'captured_pending_w9'          THEN 'delivery'
    WHEN 'single_payment_released'      THEN 'delivery'
    WHEN 'first_payment_released'       THEN 'delivery'
    WHEN 'day_14_review'                THEN 'delivery'
    WHEN 'remaining_payment_released'   THEN 'delivery'
    WHEN 'fulfilled'                    THEN 'complete'
    WHEN 'closed_resolved'              THEN 'complete'
    ELSE NULL
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "campaign_workflow_stage_ratchet"() RETURNS trigger AS $$
DECLARE
  ord text[] := ARRAY['invite','onboarding','review','fee','setup','matching',
                      'launch','live','ended','delivery','complete'];
  prior_idx int;
  next_idx  int;
BEGIN
  IF NEW."workflow_stage_reached" IS NOT DISTINCT FROM OLD."workflow_stage_reached" THEN
    RETURN NEW;
  END IF;
  prior_idx := array_position(ord, OLD."workflow_stage_reached");
  next_idx  := array_position(ord, NEW."workflow_stage_reached");
  IF next_idx < prior_idx THEN
    RAISE EXCEPTION
      'workflow_stage_reached is a high-water mark and cannot move backward (% -> %)',
      OLD."workflow_stage_reached", NEW."workflow_stage_reached";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "campaign_workflow_stage_advance"() RETURNS trigger AS $$
DECLARE
  ord text[] := ARRAY['invite','onboarding','review','fee','setup','matching',
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

  IF array_position(ord, target) > array_position(ord, NEW."workflow_stage_reached") THEN
    NEW."workflow_stage_reached" := target;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- A record that had reached the old Campaign Setup position must keep access
-- to the same and all earlier screens after the two stages exchange places.
UPDATE "campaigns"
   SET "workflow_stage_reached" = 'matching'
 WHERE "workflow_stage_reached" = 'setup';
--> statement-breakpoint

-- Backfill the new ordering for records that have not already progressed
-- farther. The high-water trigger keeps later stages untouched.
UPDATE "campaigns"
   SET "workflow_stage_reached" =
       "campaign_workflow_stage_for_status"("status"::text)
 WHERE "campaign_workflow_stage_for_status"("status"::text) IS NOT NULL
   AND array_position(
         ARRAY['invite','onboarding','review','fee','setup','matching',
               'launch','live','ended','delivery','complete'],
         "campaign_workflow_stage_for_status"("status"::text)
       ) > array_position(
         ARRAY['invite','onboarding','review','fee','setup','matching',
               'launch','live','ended','delivery','complete'],
         "workflow_stage_reached"
       );
