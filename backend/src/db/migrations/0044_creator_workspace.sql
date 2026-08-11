-- The Creator (Affiliate) Admin workspace — Spec §8, §25.6, §25.8, §26.1,
-- §26.7, §29.
--
-- Two things the workspace needs that no table held. Everything else it renders
-- already exists somewhere and is READ, not copied: the person is
-- `affiliate_prospects`, the account is `affiliate_signup_profiles` + `"user"`,
-- the relationship is `campaign_affiliate_associations`, the terms are
-- `proposal_versions` + `association_compensation_agreements`, the link is
-- `tracking_links`, the money is `creator_earnings` + `affiliate_transfers` +
-- `creator_payment_allocations`, and the enforcement is
-- `affiliate_enforcement_actions`. A workspace that duplicated any of those
-- onto an Affiliate row would be a second source of truth for a number
-- somebody is paid.
--
-- ═══ A recorded deviation, stated where it lives ════════════════════════════
--
-- §29 records Creator enforcement per ASSOCIATION, and `enforcement/standing.ts`
-- has said since Phase 20b that an account-level Creator ban would be §1 rule 6.
-- On 2026-08-11 the supplied Creator-workspace reference asked for account-level
-- suspend/restore by product direction, exactly as the Founders reference asked
-- for `founder_access_actions` (migration 0040). The same answer was given, and
-- the two tables are deliberately identical in shape.
--
-- What the decision did NOT include: a ban. §22.7's one-strike permanent
-- sanction is a FOUNDER record with four defined triggers; the Spec states no
-- Creator equivalent. So `action` admits exactly two values, there is no
-- `affiliate_ghost_bans`, and nothing here can express a permanent sanction.
--
-- ═══ 1. Person-level access actions ═════════════════════════════════════════
--
-- Append-only, and the current state is the latest row. A stored
-- `account_status` column would be a flag that a failed write can strand out of
-- step with the reason that justified it — and §25.6 wants the reason, the
-- actor, and the before/after preserved anyway, which is a history table with
-- extra steps. So there is no status column anywhere.
--
-- `next_review_at` is here because §27.1 asks a waiting person "when's the next
-- update" and a suspension is the most consequential waiting state a Creator
-- can be in. It is a promise, not a schedule: nothing sweeps it, and no job
-- reads this table (§30).
CREATE TABLE "affiliate_access_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "prospect_id" uuid NOT NULL REFERENCES "affiliate_prospects"("id") ON DELETE RESTRICT,
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
  -- promises made to a suspended Creator, so both are recorded rather than
  -- implied by whoever happens to open the case.
  "review_owner" text,
  "next_review_at" timestamp with time zone,
  "actor" text NOT NULL,
  "mfa_context" text,
  "reauth_context" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
--
-- Two values, and the absence of a third is the guarantee. There is no `ban`
-- here and nowhere to add one without editing this constraint, which is exactly
-- how visible that decision should be.
ALTER TABLE "affiliate_access_actions" ADD CONSTRAINT "affiliate_access_actions_action" CHECK (
  "action" IN ('suspend', 'restore')
);--> statement-breakpoint
ALTER TABLE "affiliate_access_actions" ADD CONSTRAINT "affiliate_access_actions_reason_is_stated" CHECK (
  btrim("reason") <> ''
);--> statement-breakpoint
ALTER TABLE "affiliate_access_actions" ADD CONSTRAINT "affiliate_access_actions_actor_is_named" CHECK (
  btrim("actor") <> ''
);--> statement-breakpoint
-- A restore ends a review; carrying an owner and a next date past the end would
-- leave a promise nothing will honour (§1.4).
ALTER TABLE "affiliate_access_actions" ADD CONSTRAINT "affiliate_access_actions_restore_closes_review" CHECK (
  "action" <> 'restore' OR ("review_owner" IS NULL AND "next_review_at" IS NULL)
);--> statement-breakpoint
--
CREATE INDEX "affiliate_access_actions_prospect_idx"
  ON "affiliate_access_actions" ("prospect_id", "occurred_at" DESC);--> statement-breakpoint
-- The standing gate reads by account id on every /api/creator request, so the
-- lookup it makes is the one that gets its own index.
CREATE INDEX "affiliate_access_actions_user_idx"
  ON "affiliate_access_actions" ("user_id", "occurred_at" DESC);--> statement-breakpoint
--
COMMENT ON TABLE "affiliate_access_actions" IS
  'Append-only person-level Affiliate access decisions (§26.7, §25.6). Current state is the latest row; there is deliberately no status column and no ban. Distinct from affiliate_enforcement_actions, which is association-scoped.';--> statement-breakpoint
--
-- ═══ 2. Account deletion requests ═══════════════════════════════════════════
--
-- §25.8 keeps Affiliate account, tax, and status records for account life + 7
-- years, and campaign, payment, support, and audit records outlive the account
-- regardless. So the honest shape is a REQUEST that Proovd records and reviews
-- — not a deletion the product performs.
--
-- What is deliberately absent is the point: no `deleted_at`, no
-- `purge_scheduled_at`, no `approved` state, and no route that erases anything.
CREATE TABLE "affiliate_deletion_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "prospect_id" uuid NOT NULL REFERENCES "affiliate_prospects"("id") ON DELETE RESTRICT,
  "user_id" text REFERENCES "user"("id") ON DELETE RESTRICT,
  -- What the Affiliate actually asked for, in their words where we have them.
  "request_detail" text NOT NULL,
  -- How it reached us — a support case, an email, a call. Recorded because a
  -- deletion request with no provenance is one nobody can verify was made.
  "received_via" text NOT NULL,
  "requested_at" timestamp with time zone NOT NULL,
  "recorded_by" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
--
ALTER TABLE "affiliate_deletion_requests" ADD CONSTRAINT "affiliate_deletion_requests_detail_is_stated" CHECK (
  btrim("request_detail") <> '' AND btrim("received_via") <> '' AND btrim("recorded_by") <> ''
);--> statement-breakpoint
CREATE INDEX "affiliate_deletion_requests_prospect_idx"
  ON "affiliate_deletion_requests" ("prospect_id", "requested_at" DESC);--> statement-breakpoint
--
COMMENT ON TABLE "affiliate_deletion_requests" IS
  'An Affiliate asked Proovd to close their account (§25.8). Insert-only. Records the ask and its provenance; deletes nothing and has no approval state — retention rules outlive the account.';--> statement-breakpoint
--
-- Reviews are append-only rows against the request, not an editable decision on
-- it. The reference offers exactly one action — acknowledge, keep under review —
-- and that is what §25.8 permits.
CREATE TABLE "affiliate_deletion_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL REFERENCES "affiliate_deletion_requests"("id") ON DELETE RESTRICT,
  "note" text NOT NULL,
  "actor" text NOT NULL,
  "mfa_context" text,
  "reauth_context" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
--
ALTER TABLE "affiliate_deletion_reviews" ADD CONSTRAINT "affiliate_deletion_reviews_note_is_stated" CHECK (
  btrim("note") <> '' AND btrim("actor") <> ''
);--> statement-breakpoint
CREATE INDEX "affiliate_deletion_reviews_request_idx"
  ON "affiliate_deletion_reviews" ("request_id", "occurred_at" DESC);--> statement-breakpoint
--
-- ═══ 3. Grants ══════════════════════════════════════════════════════════════
--
-- All three are insert-only in the 0005 idiom: the app may write a row and read
-- it back, and may never rewrite or remove one. A suspension reason an Admin
-- can edit afterwards is not the §25.6 record it claims to be, and a deletion
-- request the product can delete is a joke that writes itself.
GRANT SELECT, INSERT ON "affiliate_access_actions" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "affiliate_deletion_requests" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "affiliate_deletion_reviews" TO proovd_app;
