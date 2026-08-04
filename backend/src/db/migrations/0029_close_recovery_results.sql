-- Phase 18b — the retry window's end, results preparation, and Admin
-- reconciliation (§21, §33.7.9–§33.7.12, §25.6).
--
-- Two tables, both insert-only at the database level:
--
--   * `campaign_results` — §21's Founder-results narrative: strongest signal,
--     weakest signal, leading survey reason, and what the result does and does
--     not prove, each Admin-authored (§1 rule 6 forbids the product generating
--     a causal story) and recorded by a named person (§1.3). One row per
--     campaign; recording it is the act that makes `Results ready` sendable,
--     so the row is history the moment it exists and UPDATE is revoked.
--
--   * `campaign_reconciliations` — §21's Admin reconciliation, one row per
--     verification of one register item. Append-only: a discrepancy that is
--     later resolved gets a new row, and the earlier answer survives (§25.6).
--     The item key is CHECK-pinned to the nine §21 items so a route cannot
--     record a verification of something that does not exist (16a's
--     overridable-field reasoning).
--
-- The numbers in the Founder results are deliberately NOT stored here: they
-- are computed from the reservation ledger, the capture attempts, and the
-- attribution ledger at read time — a snapshot table would be the "second
-- event store that drifts" trap (§26.8), except a Founder would act on the
-- drift.

CREATE TABLE "campaign_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "strongest_signal" text NOT NULL,
  "weakest_signal" text NOT NULL,
  "leading_survey_reason" text NOT NULL,
  "what_this_proves" text NOT NULL,
  "what_this_does_not_prove" text NOT NULL,
  -- §1.3: the named Admin whose review makes the narrative valid.
  "reviewed_by" text NOT NULL,
  "prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- §21: every narrative field is a real sentence, not a placeholder. A blank
  -- "does not prove" would be the honesty requirement quietly dropped.
  CONSTRAINT "campaign_results_not_blank" CHECK (
    btrim("strongest_signal") <> ''
    AND btrim("weakest_signal") <> ''
    AND btrim("leading_survey_reason") <> ''
    AND btrim("what_this_proves") <> ''
    AND btrim("what_this_does_not_prove") <> ''
    AND btrim("reviewed_by") <> ''
  )
);--> statement-breakpoint

CREATE TABLE "campaign_reconciliations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "item_key" text NOT NULL,
  "result" text NOT NULL,
  "note" text NOT NULL,
  "actor" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- The nine §21 items, pinned (shared/close RECONCILIATION_ITEMS).
  CONSTRAINT "campaign_reconciliations_item" CHECK (
    "item_key" IN (
      'batch_completeness',
      'tax_charge_reconciliation',
      'attribution_post_verification',
      'creator_deliverables',
      'creator_bonus_triggers',
      'provisional_vs_earned',
      'unearned_return',
      'founder_share_w9',
      'refund_risk_dispute'
    )
  ),
  CONSTRAINT "campaign_reconciliations_result" CHECK ("result" IN ('verified', 'discrepancy')),
  -- A verification with no note is a checkbox, not a record (§1.3, §25.6).
  CONSTRAINT "campaign_reconciliations_note" CHECK (btrim("note") <> ''),
  CONSTRAINT "campaign_reconciliations_actor" CHECK (btrim("actor") <> '')
);--> statement-breakpoint

-- ── Foreign keys ────────────────────────────────────────────────────────────
ALTER TABLE "campaign_results" ADD CONSTRAINT "campaign_results_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_reconciliations" ADD CONSTRAINT "campaign_reconciliations_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- One results record per campaign, ever — `Results ready` happens once (§21).
CREATE UNIQUE INDEX "campaign_results_campaign_idx" ON "campaign_results" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_reconciliations_campaign_idx" ON "campaign_reconciliations" USING btree ("campaign_id", "item_key", "recorded_at");--> statement-breakpoint

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Both are records of Admin judgement: insert-only, like audit_events (§25.6).
GRANT SELECT, INSERT ON "campaign_results" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "campaign_results" FROM proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "campaign_reconciliations" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "campaign_reconciliations" FROM proovd_app;
