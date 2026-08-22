-- Admin Founder panel — the reference's eleven stages, 2026-08-22.
--
-- Every column and table here exists because a control in
-- `ProovdAdminFounder.html` needs somewhere to write. Nothing is speculative:
-- each one is traceable to a named field in the captured reference.
--
-- ── What this migration deliberately does NOT do ───────────────────────────
--  * It does not widen `proposal_party`. §14.2 makes compensation bilateral and
--    `admin-decisions.ts` records that the absent accept-route IS the
--    enforcement. The Admin offer below is a SEPARATE record that the Founder
--    still accepts through the existing route — it never becomes a proposal
--    version, so no acceptance is ever attributed to an Admin.
--  * It does not add a `campaigns.type` unlock. §33.1.7's trigger stands; a
--    wrong type still archives and restarts.
--  * It does not add an editable column for a derived aggregate (backers,
--    reserved, clicks, posts). Those stay composed — §33.8.13.
--  * It does not touch `listing_fee_calculations.subtotal_cents`. The
--    reference's `$29` is seed noise that disagrees with its own `−$10`; the
--    calculated value is what renders.

-- ── Invite prefills (§7). All nullable, all anonymisable by the §25.8 sweep ──
ALTER TABLE "campaign_drafts"
  ADD COLUMN "prefill_views_count" integer,
  ADD COLUMN "prefill_affiliate_matches" integer,
  ADD COLUMN "prefill_affiliate_type" text,
  ADD COLUMN "prefill_brand_voice_1" text,
  ADD COLUMN "prefill_brand_voice_2" text;
--> statement-breakpoint
ALTER TABLE "campaign_drafts"
  ADD CONSTRAINT "campaign_drafts_prefill_views_nonneg"
  CHECK ("prefill_views_count" IS NULL OR "prefill_views_count" >= 0);
--> statement-breakpoint
ALTER TABLE "campaign_drafts"
  ADD CONSTRAINT "campaign_drafts_prefill_matches_nonneg"
  CHECK ("prefill_affiliate_matches" IS NULL OR "prefill_affiliate_matches" >= 0);
--> statement-breakpoint
-- The reference's OWN nine-value taxonomy. Deliberately NOT `affiliate_subtype`
-- (seven values): the reference splits newsletter/blog and student/network, and
-- reusing that enum would silently rename two of its options.
ALTER TABLE "campaign_drafts"
  ADD CONSTRAINT "campaign_drafts_prefill_affiliate_type_known"
  CHECK ("prefill_affiliate_type" IS NULL OR "prefill_affiliate_type" IN (
    'social_media_creator','newsletter_operator','blog_operator','podcast_host',
    'community_owner','course_instructor','student_affiliate',
    'network_distributor','niche_marketer'
  ));
--> statement-breakpoint

-- ── Invitation delivery facts the Invite stage renders ──────────────────────
ALTER TABLE "campaign_invitation_sends"
  ADD COLUMN "opened_at" timestamptz,
  ADD COLUMN "accepted_at" timestamptz;
--> statement-breakpoint

-- ── Founder identity ───────────────────────────────────────────────────────
-- `username` is Admin prefill, shown read-only to the Founder. No UNIQUE index:
-- nothing in the Spec makes it an identifier, and inventing uniqueness would be
-- inventing a rule. Add one when a product decision says it is public.
ALTER TABLE "founder_prospects"
  ADD COLUMN "username" text,
  ADD COLUMN "last_active_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "founder_claim_profiles"
  ADD COLUMN "username" text,
  ADD COLUMN "username_supplier" "field_supplier",
  ADD COLUMN "username_prefilled" text,
  ADD COLUMN "username_edited_at" timestamptz;
--> statement-breakpoint
-- The instant the six-digit code was accepted. NOT named `*_verified_*` on a
-- phone column — §33.1.8 scans the tree to keep phone unverifiable, and this is
-- an EMAIL fact.
ALTER TABLE "founder_claim_profiles"
  ADD COLUMN "email_code_verified_at" timestamptz;
--> statement-breakpoint

-- ── The workflow ratchet ───────────────────────────────────────────────────
-- `campaigns.status` moves BACKWARD (`changes_required` after `pending_review`;
-- `capture_retry_window` after `closed_pending_capture`), so index-of-current is
-- not a high-water mark. The reference's stage menu unlocks on the furthest
-- stage EVER reached, which is this column and nothing else.
ALTER TABLE "campaigns"
  ADD COLUMN "workflow_stage_reached" text NOT NULL DEFAULT 'invite';
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD CONSTRAINT "campaigns_workflow_stage_reached_known"
  CHECK ("workflow_stage_reached" IN (
    'invite','onboarding','review','fee','matching','setup',
    'launch','live','ended','delivery','complete'
  ));
--> statement-breakpoint

-- A ratchet is a trigger, not a service rule: a service that advanced it is one
-- a careless UPDATE bypasses, and a stage that could move backward would relock
-- a screen somebody has already used.
CREATE OR REPLACE FUNCTION "campaign_workflow_stage_ratchet"() RETURNS trigger AS $$
DECLARE
  ord text[] := ARRAY['invite','onboarding','review','fee','matching','setup',
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
CREATE TRIGGER "campaigns_workflow_stage_ratchet"
  BEFORE UPDATE ON "campaigns"
  FOR EACH ROW EXECUTE FUNCTION "campaign_workflow_stage_ratchet"();
--> statement-breakpoint

-- ── Campaign build versions (Campaign setup + Ready to launch) ─────────────
-- `material_changes.new_version` counts MATERIAL changes only, so a non-material
-- edit does not bump it — which is not what "Draft campaign version" means.
ALTER TABLE "campaign_build"
  ADD COLUMN "draft_version" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "approved_campaign_snapshots"
  ADD COLUMN "published_version" integer;
--> statement-breakpoint

-- ── Internal notes (record-tools "Notes") ──────────────────────────────────
-- Insert-only. `founder_prospects.admin_notes` is ONE mutable column with no
-- author and no timestamp; a note stream is a different record.
CREATE TABLE "founder_internal_notes" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "prospect_id" uuid NOT NULL REFERENCES "founder_prospects"("id") ON DELETE CASCADE,
  "body"        text NOT NULL,
  "author"      text NOT NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "founder_internal_notes_prospect_idx"
  ON "founder_internal_notes" ("prospect_id", "created_at" DESC);
--> statement-breakpoint

-- ── Admin offer (Matching) ─────────────────────────────────────────────────
-- The reference lets Admin set a percentage and publish it to the Founder
-- dashboard. §14.2 keeps acceptance bilateral, so this is a RECORDED OFFER and
-- not a proposal version: the Founder still accepts through the existing route,
-- and no acceptance is ever attributed to an Admin.
--
-- Basis points, not percent: the reference's control is `step=0.1`, and every
-- percent column in the money tree is an integer. 3250 = 32.5%.
CREATE TABLE "association_admin_offers" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "association_id"     uuid NOT NULL REFERENCES "campaign_affiliate_associations"("id") ON DELETE CASCADE,
  "campaign_id"        uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "offer_basis_points" integer NOT NULL,
  "offered_by"         text NOT NULL,
  "internal_reason"    text NOT NULL,
  "offered_at"         timestamptz NOT NULL DEFAULT now(),
  "superseded_at"      timestamptz,
  "withdrawn_at"       timestamptz,
  "withdrawn_reason"   text,
  CONSTRAINT "association_admin_offers_bp_range"
    CHECK ("offer_basis_points" BETWEEN 10 AND 5000),
  CONSTRAINT "association_admin_offers_withdrawn_has_reason"
    CHECK ("withdrawn_at" IS NULL OR "withdrawn_reason" IS NOT NULL)
);
--> statement-breakpoint
-- One live offer per association. A revision supersedes; it never UPDATEs.
CREATE UNIQUE INDEX "association_admin_offers_one_live"
  ON "association_admin_offers" ("association_id")
  WHERE "superseded_at" IS NULL AND "withdrawn_at" IS NULL;
--> statement-breakpoint

-- ── Final campaign send (Matching) ─────────────────────────────────────────
CREATE TABLE "association_final_campaign_sends" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "association_id"  uuid NOT NULL REFERENCES "campaign_affiliate_associations"("id") ON DELETE CASCADE,
  "campaign_id"     uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "sent_at"         timestamptz NOT NULL DEFAULT now(),
  "sent_by"         text NOT NULL,
  "opened_at"       timestamptz,
  "notification_id" text
);
--> statement-breakpoint
CREATE INDEX "association_final_campaign_sends_assoc_idx"
  ON "association_final_campaign_sends" ("association_id", "sent_at" DESC);
--> statement-breakpoint

-- ── Application review (stage 3) ───────────────────────────────────────────
-- §9 defines no application-review lifecycle state, and `campaigns.status`
-- cannot carry one: `pending_review`/`changes_required`/`approved` already
-- belong to the §15 BUILD review, which is a different decision later in the
-- flow. So the decision gets its own record, and `campaigns.status` is untouched.
CREATE TABLE "campaign_application_reviews" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaign_id"           uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "round"                 integer NOT NULL,
  "outcome"               text NOT NULL DEFAULT 'waiting',
  "reviewer"              text,
  "decided_at"            timestamptz,
  "internal_reason"       text,
  "customer_explanation"  text,
  "opened_at"             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "campaign_application_reviews_outcome_known"
    CHECK ("outcome" IN (
      'waiting','in_review','needs_information','changes_requested',
      'resubmitted','approved','rejected'
    )),
  CONSTRAINT "campaign_application_reviews_decided_has_reviewer"
    CHECK ("decided_at" IS NULL OR "reviewer" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_application_reviews_round"
  ON "campaign_application_reviews" ("campaign_id", "round");
--> statement-breakpoint

-- One open change request per field per round. `field_key` is register-
-- constrained at the route, never free text — an override of something that
-- does not exist would look complete while pointing at nothing.
CREATE TABLE "campaign_application_change_requests" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "review_id"    uuid NOT NULL REFERENCES "campaign_application_reviews"("id") ON DELETE CASCADE,
  "campaign_id"  uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "field_key"    text NOT NULL,
  "reason"       text NOT NULL,
  "requested_by" text NOT NULL,
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at"  timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_application_change_requests_one_open"
  ON "campaign_application_change_requests" ("review_id", "field_key")
  WHERE "resolved_at" IS NULL;
--> statement-breakpoint

-- ── Admin content edits (Campaign setup + Ready to launch) ─────────────────
-- The 23 `Edit` rows and the 138 `Admin can edit` fields all land here as an
-- append-only trail beside the audit row. `field_key` comes from a register.
CREATE TABLE "campaign_admin_field_edits" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaign_id"     uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "field_key"       text NOT NULL,
  "prior_value"     text,
  "new_value"       text,
  "internal_reason" text NOT NULL,
  "materiality"     text,
  "actor"           text NOT NULL,
  "edited_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "campaign_admin_field_edits_materiality_known"
    CHECK ("materiality" IS NULL OR "materiality" IN ('non_material','material_to_creator_terms'))
);
--> statement-breakpoint
CREATE INDEX "campaign_admin_field_edits_campaign_idx"
  ON "campaign_admin_field_edits" ("campaign_id", "edited_at" DESC);
--> statement-breakpoint

-- ── Insert-only grants ─────────────────────────────────────────────────────
-- The same posture every other history table in this tree carries: a correction
-- is a new row, never an edit of the old one.
REVOKE UPDATE, DELETE ON "founder_internal_notes" FROM "proovd_app";
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "campaign_admin_field_edits" FROM "proovd_app";
--> statement-breakpoint
-- The offer table needs its two lifecycle columns to move, and nothing else.
REVOKE UPDATE ON "association_admin_offers" FROM "proovd_app";
--> statement-breakpoint
GRANT UPDATE ("superseded_at", "withdrawn_at", "withdrawn_reason")
  ON "association_admin_offers" TO "proovd_app";
--> statement-breakpoint
REVOKE UPDATE ON "association_final_campaign_sends" FROM "proovd_app";
--> statement-breakpoint
GRANT UPDATE ("opened_at", "notification_id")
  ON "association_final_campaign_sends" TO "proovd_app";
