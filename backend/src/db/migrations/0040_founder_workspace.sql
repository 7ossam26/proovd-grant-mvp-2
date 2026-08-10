-- The Founder Admin workspace — Spec §7, §22.7, §25.6, §25.8, §26.1, §29.
--
-- Three things the workspace needs that no table held. Everything else it
-- renders already exists somewhere and is read, not copied: the account is
-- `founder_claim_profiles` + `"user"`, the ban is `founder_ghost_bans`, the
-- money is `founder_payments`/`founder_w9_records`/`listing_fee_payments`, and
-- the campaign is `campaigns` + `campaign_build`. A workspace that duplicated
-- any of those onto a Founder row would be a second source of truth for a
-- number somebody is paid.
--
-- ═══ 1. Per-invitation overrides ════════════════════════════════════════════
--
-- §7 has Admin compose a message to a specific person; §26.2 has user data
-- auto-populate. Both hold at once: the profile is the source, ONE invitation
-- may say something else, and the difference is labelled rather than flattened.
--
-- The obvious implementation — let Admin edit the prospect and call it an
-- override — is wrong in a way that only shows up later: it silently rewrites
-- the Founder's own record to fix a typo in one email, and every other surface
-- that auto-fills from the profile changes with it. So the override lives on
-- the DRAFT (one invitation), the profile stays on `founder_prospects`, and
-- NULL means "no override" rather than "empty".
--
-- These are content columns about a real person, so `enforce_draft_anonymisation`
-- has to learn them — see §3 below. 0039 is the worked precedent.
ALTER TABLE "campaign_drafts" ADD COLUMN "override_recipient_name" text;--> statement-breakpoint
ALTER TABLE "campaign_drafts" ADD COLUMN "override_recipient_email" text;--> statement-breakpoint
ALTER TABLE "campaign_drafts" ADD COLUMN "override_recipient_phone" text;--> statement-breakpoint
ALTER TABLE "campaign_drafts" ADD COLUMN "override_product" text;--> statement-breakpoint
ALTER TABLE "campaign_drafts" ADD COLUMN "override_website" text;--> statement-breakpoint
--
COMMENT ON COLUMN "campaign_drafts"."override_recipient_name" IS
  'Per-invitation override of founder_prospects.legal_name (§7). NULL = auto-fill from the profile. Never written back to the profile.';--> statement-breakpoint
COMMENT ON COLUMN "campaign_drafts"."override_recipient_email" IS
  'Per-invitation override of founder_prospects.email (§7). NULL = auto-fill from the profile.';--> statement-breakpoint
COMMENT ON COLUMN "campaign_drafts"."override_recipient_phone" IS
  'Per-invitation override of founder_prospects.phone (§7). NULL = auto-fill from the profile.';--> statement-breakpoint
COMMENT ON COLUMN "campaign_drafts"."override_product" IS
  'Per-invitation override of founder_prospects.product_name (§7). NULL = auto-fill from the profile.';--> statement-breakpoint
COMMENT ON COLUMN "campaign_drafts"."override_website" IS
  'Per-invitation override of founder_prospects.product_url (§7). NULL = auto-fill from the profile.';--> statement-breakpoint
--
-- An override that is only whitespace is not an override — it is an Admin who
-- cleared the box and meant "go back to the profile". Storing it would render
-- an invitation addressed to nobody, and the §7 preview gate would pass because
-- the value is technically present. Refuse the shape at the database so no
-- future route has to remember.
ALTER TABLE "campaign_drafts" ADD CONSTRAINT "campaign_drafts_overrides_are_not_blank" CHECK (
  ("override_recipient_name"  IS NULL OR btrim("override_recipient_name")  <> '') AND
  ("override_recipient_email" IS NULL OR btrim("override_recipient_email") <> '') AND
  ("override_recipient_phone" IS NULL OR btrim("override_recipient_phone") <> '') AND
  ("override_product"         IS NULL OR btrim("override_product")         <> '') AND
  ("override_website"         IS NULL OR btrim("override_website")         <> '')
);--> statement-breakpoint
--
-- ═══ 2. Person-level access actions ═════════════════════════════════════════
--
-- §26.7's suspend/kill is CAMPAIGN-scoped and stays that way — it closes
-- reservations, detaches cards, and moves `campaigns.status`. The workspace
-- needs something the product did not have: suspending a PERSON's Founder
-- access, independent of any one campaign, and restoring it when the review
-- ends.
--
-- Append-only, and the current state is the latest row. A stored
-- `account_status` column would be a flag that a failed write can strand out of
-- step with the reason that justified it — and §25.6 wants the reason, the
-- actor, and the before/after preserved anyway, which is a history table with
-- extra steps. So there is no status column anywhere; `deriveAccountState`
-- reads this table, `founder_ghost_bans`, and the claim.
--
-- `next_review_at` is here because §27.1 asks a waiting person "when's the next
-- update" and a suspension is the most consequential waiting state a Founder
-- can be in. It is a promise, not a schedule: nothing sweeps it, and no job
-- reads this table (§30).
CREATE TABLE "founder_access_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "prospect_id" uuid NOT NULL REFERENCES "founder_prospects"("id") ON DELETE RESTRICT,
  -- The account this concerns, when one exists. A suspension before the claim
  -- is possible (the invitation is live and we want it to stop working), so
  -- this is nullable rather than the key.
  "user_id" text REFERENCES "user"("id") ON DELETE RESTRICT,
  "action" text NOT NULL,
  -- §26.7's own rule, reapplied: a category alone is a classification nobody
  -- can review, free text alone is a decision nobody can count.
  "reason" text NOT NULL,
  "evidence" text,
  -- Who is carrying the review, and when the person hears next. Both are
  -- promises made to a suspended Founder, so both are recorded rather than
  -- implied by whoever happens to open the case.
  "review_owner" text,
  "next_review_at" timestamp with time zone,
  "actor" text NOT NULL,
  "mfa_context" text,
  "reauth_context" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
--
ALTER TABLE "founder_access_actions" ADD CONSTRAINT "founder_access_actions_action" CHECK (
  "action" IN ('suspend', 'restore')
);--> statement-breakpoint
ALTER TABLE "founder_access_actions" ADD CONSTRAINT "founder_access_actions_reason_is_stated" CHECK (
  btrim("reason") <> ''
);--> statement-breakpoint
ALTER TABLE "founder_access_actions" ADD CONSTRAINT "founder_access_actions_actor_is_named" CHECK (
  btrim("actor") <> ''
);--> statement-breakpoint
-- A restore ends a review; carrying an owner and a next date past the end would
-- leave a promise nothing will honour (§1.4).
ALTER TABLE "founder_access_actions" ADD CONSTRAINT "founder_access_actions_restore_closes_review" CHECK (
  "action" <> 'restore' OR ("review_owner" IS NULL AND "next_review_at" IS NULL)
);--> statement-breakpoint
--
CREATE INDEX "founder_access_actions_prospect_idx"
  ON "founder_access_actions" ("prospect_id", "occurred_at" DESC);--> statement-breakpoint
--
COMMENT ON TABLE "founder_access_actions" IS
  'Append-only person-level Founder access decisions (§26.7, §25.6). Current state is the latest row; there is deliberately no status column. Distinct from campaign_enforcement_actions, which is campaign-scoped.';--> statement-breakpoint
--
-- ═══ 3. Account deletion requests ═══════════════════════════════════════════
--
-- §25.8 keeps Founder account data for account life + 7 years, and campaign,
-- payment, tax, support, and audit records outlive the account regardless. So
-- the honest shape is a REQUEST that Proovd records and reviews — not a
-- deletion the product performs.
--
-- What is deliberately absent is the point: no `deleted_at`, no
-- `purge_scheduled_at`, no `approved` state, and no route that erases anything.
-- The only automated erasure in the product is the §25.8 sweep over UNCLAIMED
-- drafts, and it is not reachable from here. A column named `approved` would be
-- the first step toward a "delete everything" action §25.8 does not permit.
CREATE TABLE "founder_deletion_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "prospect_id" uuid NOT NULL REFERENCES "founder_prospects"("id") ON DELETE RESTRICT,
  "user_id" text REFERENCES "user"("id") ON DELETE RESTRICT,
  -- What the Founder actually asked for, in their words where we have them.
  "request_detail" text NOT NULL,
  -- How it reached us — a support case, an email, a call. Recorded because a
  -- deletion request with no provenance is one nobody can verify was made.
  "received_via" text NOT NULL,
  "requested_at" timestamp with time zone NOT NULL,
  "recorded_by" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
--
ALTER TABLE "founder_deletion_requests" ADD CONSTRAINT "founder_deletion_requests_detail_is_stated" CHECK (
  btrim("request_detail") <> '' AND btrim("received_via") <> '' AND btrim("recorded_by") <> ''
);--> statement-breakpoint
CREATE INDEX "founder_deletion_requests_prospect_idx"
  ON "founder_deletion_requests" ("prospect_id", "requested_at" DESC);--> statement-breakpoint
--
COMMENT ON TABLE "founder_deletion_requests" IS
  'A Founder asked Proovd to close their account (§25.8). Insert-only. Records the ask and its provenance; deletes nothing and has no approval state — retention rules outlive the account.';--> statement-breakpoint
--
-- Reviews are append-only rows against the request, not an editable decision on
-- it. The reference offers exactly one action — acknowledge, keep under review —
-- and that is what §25.8 permits: the retention obligations do not end because
-- somebody clicked a button.
CREATE TABLE "founder_deletion_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL REFERENCES "founder_deletion_requests"("id") ON DELETE RESTRICT,
  "note" text NOT NULL,
  "actor" text NOT NULL,
  "mfa_context" text,
  "reauth_context" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
--
ALTER TABLE "founder_deletion_reviews" ADD CONSTRAINT "founder_deletion_reviews_note_is_stated" CHECK (
  btrim("note") <> '' AND btrim("actor") <> ''
);--> statement-breakpoint
CREATE INDEX "founder_deletion_reviews_request_idx"
  ON "founder_deletion_reviews" ("request_id", "occurred_at" DESC);--> statement-breakpoint
--
-- ═══ 4. The anonymisation trigger learns the override columns ═══════════════
--
-- 0005 made draft anonymisation irreversible by refusing to write content back.
-- The five override columns are content about a person — a name, an email, a
-- phone number — so a trigger that does not know them is a hole in exactly that
-- guarantee: the sweep nulls them and a later UPDATE could restore the email of
-- someone who asked to be forgotten. 0039 did this for `last_contact_at`.
CREATE OR REPLACE FUNCTION enforce_draft_anonymisation() RETURNS trigger AS $fn$
BEGIN
  IF OLD."anonymised_at" IS NOT NULL THEN
    IF NEW."anonymised_at" IS DISTINCT FROM OLD."anonymised_at" THEN
      RAISE EXCEPTION 'anonymisation is irreversible; anonymised_at is append-only'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."what_we_understood" IS NOT NULL
    OR NEW."why_invited"        IS NOT NULL
    OR NEW."override_recipient_name"  IS NOT NULL
    OR NEW."override_recipient_email" IS NOT NULL
    OR NEW."override_recipient_phone" IS NOT NULL
    OR NEW."override_product"         IS NOT NULL
    OR NEW."override_website"         IS NOT NULL
    THEN
      RAISE EXCEPTION 'this draft has been anonymised; its content cannot be restored'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW."updated_at" := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint
--
-- ═══ 5. Grants ══════════════════════════════════════════════════════════════
--
-- Both new tables are insert-only in the 0005 idiom: the app may write a row
-- and read it back, and may never rewrite or remove one. A suspension reason an
-- Admin can edit afterwards is not the §25.6 record it claims to be, and a
-- deletion request the product can delete is a joke that writes itself.
GRANT SELECT, INSERT ON "founder_access_actions" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "founder_deletion_requests" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "founder_deletion_reviews" TO proovd_app;--> statement-breakpoint
--
-- `campaign_drafts` already carries SELECT, INSERT, UPDATE from 0005, which the
-- new override columns inherit — an override is meant to be changed and reset,
-- and the §25.8 sweep needs to null them. DELETE stays revoked there.
