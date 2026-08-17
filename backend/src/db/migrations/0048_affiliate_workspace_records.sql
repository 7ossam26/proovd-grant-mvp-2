-- The Admin Affiliate rebuild, Session A — a post-Phase-24 change, 2026-08-17.
-- Spec §1.3, §5.3, §8, §12, §14.2, §22.4, §24.8, §25.6, §25.8, §29, §30.
--
-- The supplied reference (docs/design-refrence/Proovd-Affiliate-Admin.html)
-- restructures a workspace whose data almost entirely exists. This migration is
-- the six record families that genuinely do not — and nothing else. Everything
-- else the walked reference shows composes from records already on disk
-- (docs/phases/admin-affiliate-reconciliation.md is the walk).
--
-- What is deliberately ABSENT, and why:
--
--   * No column on `affiliate_prospects` for "proposal access". The reference
--     shows Standard/Restricted with a control to set it; a stored eligibility
--     flag is §1 rule 6 — and it would be the one field a later phase could
--     read to refuse a proposal automatically. The badge is DERIVED from §29's
--     `restrict_bidding`/`demote` enforcement records, which are richer than a
--     boolean and already carry the five customer-facing statement fields.
--   * No change to `quality_tier`. §8 makes the tier assessment data, never a
--     commission floor; the reference's Tier A/B/C dropdown becomes suggestions
--     over the same free-text column, and `affiliate_quality_tier_not_numeric`
--     stands unchanged.
--   * No `affiliate_history` table. §26.8's trap: a second event store that
--     drifts from the first is worse than no timeline. The workspace history
--     stays a composed read.
--   * No schedule-shaped column anywhere — no `remind_at`, no recurrence, no
--     job reads any of these tables (§30). A deliverable deadline the product
--     chased would be a commercial rule §22.1 does not state.
--   * No notification key. A termination request, a mediation note, and an
--     evidence decision are Admin records; §27 defines no message for them,
--     and a send the registry does not know is the §1.4 failure.
--
-- ═══ 1. Verification evidence files (§5.3, §8, §12) ═════════════════════════
--
-- The reference attaches pictures and documents to the §5.3 research record,
-- per category (its own `Xj` register: channel ownership / permission,
-- sponsored-content history, promotion / traffic plan, similar-campaign
-- performance). Today `verification_evidence` is text only.
--
-- The upload mechanics are Phase 09a's, reused whole: presign → browser PUT →
-- the server reads the object back and the BYTES decide the format. So the row
-- follows `campaign_assets`' lifecycle — created `pending` at presign, moved
-- `stored`/`rejected` once the server has inspected the object — and checksum,
-- size, type, and dimensions are what inspection found, never what the browser
-- declared. SVG is excluded there for the reason 09a records: browsers execute
-- it. HEIC is not accepted either, whatever the reference's copy says —
-- browsers cannot render it, and a stored file nobody can review is not
-- evidence (§1.8; the surface copy names what the server actually accepts).
CREATE TABLE "affiliate_evidence_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "prospect_id" uuid NOT NULL REFERENCES "affiliate_prospects"("id") ON DELETE RESTRICT,
  -- The reference's four research categories. A file that belongs to no
  -- category is a file nobody can find when the §24.11 packet needs it.
  "category" text NOT NULL,
  -- Derived from ids and a fresh UUID at presign, never from a filename.
  "storage_key" text NOT NULL,
  "original_filename" text,
  "state" text DEFAULT 'pending' NOT NULL,
  -- What inspection found. NULL until the object has been read back.
  "checksum_sha256" text,
  "byte_size" bigint,
  "content_type" text,
  "width" integer,
  "height" integer,
  "rejection" text,
  "removed_at" timestamp with time zone,
  "removed_by" text,
  "uploaded_by" text NOT NULL,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "affiliate_evidence_files" ADD CONSTRAINT "affiliate_evidence_files_category" CHECK (
  "category" IN ('channel_permission', 'sponsored_history', 'promotion_plan', 'similar_campaign_performance')
);--> statement-breakpoint
ALTER TABLE "affiliate_evidence_files" ADD CONSTRAINT "affiliate_evidence_files_state" CHECK (
  "state" IN ('pending', 'stored', 'rejected')
);--> statement-breakpoint
-- A stored file is one the server actually read: the facts inspection produces
-- are all present or the state is not `stored`.
ALTER TABLE "affiliate_evidence_files" ADD CONSTRAINT "affiliate_evidence_files_stored_is_inspected" CHECK (
  "state" <> 'stored' OR (
    "checksum_sha256" IS NOT NULL AND "byte_size" IS NOT NULL AND "content_type" IS NOT NULL
  )
);--> statement-breakpoint
ALTER TABLE "affiliate_evidence_files" ADD CONSTRAINT "affiliate_evidence_files_size_positive" CHECK (
  "byte_size" IS NULL OR "byte_size" > 0
);--> statement-breakpoint
ALTER TABLE "affiliate_evidence_files" ADD CONSTRAINT "affiliate_evidence_files_removal_pair" CHECK (
  ("removed_at" IS NULL) = ("removed_by" IS NULL)
);--> statement-breakpoint
ALTER TABLE "affiliate_evidence_files" ADD CONSTRAINT "affiliate_evidence_files_uploader_named" CHECK (
  btrim("uploaded_by") <> ''
);--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_evidence_files_storage_key_idx"
  ON "affiliate_evidence_files" ("storage_key");--> statement-breakpoint
-- §12's duplicate rule, rescoped to the person: enforced by the database rather
-- than a SELECT a concurrent request could race past, and scoped to live rows
-- so removing a file and re-uploading it is a correction rather than a refusal.
CREATE UNIQUE INDEX "affiliate_evidence_files_duplicate_idx"
  ON "affiliate_evidence_files" ("prospect_id", "checksum_sha256")
  WHERE "checksum_sha256" IS NOT NULL AND "removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "affiliate_evidence_files_prospect_idx"
  ON "affiliate_evidence_files" ("prospect_id", "category");--> statement-breakpoint
--
-- Repointing a reviewed file at a different object would move an Admin's
-- verification decision onto material nobody looked at. A different file is a
-- different upload — and removal is one-way, because an evidence file that can
-- quietly come back is one whose absence nobody can rely on.
CREATE OR REPLACE FUNCTION enforce_affiliate_evidence_file_immutability()
RETURNS trigger AS $$
BEGIN
  IF NEW.storage_key IS DISTINCT FROM OLD.storage_key THEN
    RAISE EXCEPTION 'affiliate_evidence_files.storage_key cannot be changed; upload a new file instead';
  END IF;
  IF NEW.prospect_id IS DISTINCT FROM OLD.prospect_id THEN
    RAISE EXCEPTION 'affiliate_evidence_files.prospect_id cannot be changed';
  END IF;
  IF NEW.category IS DISTINCT FROM OLD.category THEN
    RAISE EXCEPTION 'affiliate_evidence_files.category cannot be changed; the category was chosen at upload';
  END IF;
  IF OLD.removed_at IS NOT NULL AND NEW.removed_at IS DISTINCT FROM OLD.removed_at THEN
    RAISE EXCEPTION 'affiliate_evidence_files removal cannot be undone; upload the file again instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER affiliate_evidence_files_immutable
  BEFORE UPDATE ON "affiliate_evidence_files"
  FOR EACH ROW EXECUTE FUNCTION enforce_affiliate_evidence_file_immutability();--> statement-breakpoint
--
COMMENT ON TABLE "affiliate_evidence_files" IS
  'Verification evidence files on the §5.3 research record, one row per object, in the campaign_assets lifecycle (pending → stored/rejected; the bytes decide). Storage key and category immutable; removal one-way; duplicates refused per live (prospect, checksum).';--> statement-breakpoint

-- ═══ 2. Per-metric verification decisions (§5.3, §8) ════════════════════════
--
-- The reference decides five audience metrics separately — audience size,
-- engagement rate, audience demographics, channel ownership, newsletter
-- permission basis — where today one `verification_status` covers the whole
-- record. The §22.3 early-release idiom: insert-only, latest per metric wins,
-- and every answer must carry its detail, because "verified" with nothing
-- behind it is the self-assertion §12 refuses in another phase.
--
-- The whole-record `verification_status` stays what it is: the §8 decision the
-- roster and the §16 readiness read. These rows are the finer evidence trail
-- underneath it, never a second answer to the same question — `verified` on
-- the record is still refused while §5.3 evidence is outstanding, and nothing
-- derives the record status from these rows.
CREATE TABLE "affiliate_evidence_verifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "prospect_id" uuid NOT NULL REFERENCES "affiliate_prospects"("id") ON DELETE RESTRICT,
  "metric" text NOT NULL,
  "decision" text NOT NULL,
  -- What was looked at and what it showed — or what is missing and why it is
  -- needed. Required either way.
  "detail" text NOT NULL,
  "decided_by" text NOT NULL,
  "decided_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "affiliate_evidence_verifications" ADD CONSTRAINT "affiliate_evidence_verifications_metric" CHECK (
  "metric" IN ('audience_size', 'engagement_rate', 'audience_demographics', 'channel_ownership', 'newsletter_permission_basis')
);--> statement-breakpoint
ALTER TABLE "affiliate_evidence_verifications" ADD CONSTRAINT "affiliate_evidence_verifications_decision" CHECK (
  "decision" IN ('verified', 'more_evidence_needed')
);--> statement-breakpoint
ALTER TABLE "affiliate_evidence_verifications" ADD CONSTRAINT "affiliate_evidence_verifications_stated" CHECK (
  btrim("detail") <> '' AND btrim("decided_by") <> ''
);--> statement-breakpoint
CREATE INDEX "affiliate_evidence_verifications_prospect_idx"
  ON "affiliate_evidence_verifications" ("prospect_id", "metric", "decided_at" DESC);--> statement-breakpoint
--
COMMENT ON TABLE "affiliate_evidence_verifications" IS
  'Per-metric §5.3 evidence decisions (insert-only, latest per metric wins). The evidence trail beneath the whole-record verification_status, never a second answer to it.';--> statement-breakpoint

-- ═══ 3. Deliverables, their evidence, and their decisions (§22.4 idiom) ═════
--
-- The product records the first-post submission and the §22.1 completion
-- decision, and nothing between: the agreed work items and the evidence each
-- one was verified against had no record. These three tables are the §22.4
-- receipt idiom rescoped to the relationship — insert-only, a resubmission is
-- a NEW record, and the decision stores its findings beside its outcome so the
-- two can never disagree.
--
-- A deliverable RESTATES what the accepted agreement already says; it never
-- invents a work item the Creator did not agree to, which is why `source` is
-- required — it names the agreement record the title came from.
CREATE TABLE "association_deliverables" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "association_id" uuid NOT NULL REFERENCES "campaign_affiliate_associations"("id") ON DELETE RESTRICT,
  "title" text NOT NULL,
  "source" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "association_deliverables" ADD CONSTRAINT "association_deliverables_stated" CHECK (
  btrim("title") <> '' AND btrim("source") <> '' AND btrim("created_by") <> ''
);--> statement-breakpoint
CREATE INDEX "association_deliverables_association_idx"
  ON "association_deliverables" ("association_id", "created_at");--> statement-breakpoint
--
COMMENT ON TABLE "association_deliverables" IS
  'Agreed work items per campaign relationship, restated from the accepted agreement (source names the record). Insert-only.';--> statement-breakpoint
--
CREATE TABLE "association_deliverable_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "deliverable_id" uuid NOT NULL REFERENCES "association_deliverables"("id") ON DELETE RESTRICT,
  -- A public URL or a plain description of what was supplied. Never a file on
  -- this row — files are `affiliate_evidence_files`' problem, and a §12 upload
  -- needs the bucket Track A4 has not provisioned.
  "reference" text NOT NULL,
  "note" text,
  "submitted_by" text NOT NULL,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "association_deliverable_evidence" ADD CONSTRAINT "association_deliverable_evidence_stated" CHECK (
  btrim("reference") <> '' AND btrim("submitted_by") <> ''
);--> statement-breakpoint
CREATE INDEX "association_deliverable_evidence_deliverable_idx"
  ON "association_deliverable_evidence" ("deliverable_id", "submitted_at" DESC);--> statement-breakpoint
--
COMMENT ON TABLE "association_deliverable_evidence" IS
  'Evidence receipts per deliverable (§22.4 idiom). Insert-only; a resubmission is a new row and the earlier one survives.';--> statement-breakpoint
--
-- The decision. `waived` is the Founder/Admin waiver the reference offers, and
-- it is the one outcome that must carry more than findings: who recorded the
-- waiver and why, because a waived work item with no named recorder is a
-- decision nobody made. Outcome and waiver fields are CHECK-tied in both
-- directions — a verified decision cannot smuggle a waiver, and a waiver
-- cannot omit its reason.
CREATE TABLE "association_deliverable_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "deliverable_id" uuid NOT NULL REFERENCES "association_deliverables"("id") ON DELETE RESTRICT,
  -- The evidence receipt this decision read, when it read one. A waiver may
  -- exist precisely because there is no evidence.
  "evidence_id" uuid REFERENCES "association_deliverable_evidence"("id") ON DELETE RESTRICT,
  "outcome" text NOT NULL,
  "findings" text NOT NULL,
  "waiver_recorded_by" text,
  "waiver_reason" text,
  "decided_by" text NOT NULL,
  "decided_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "association_deliverable_decisions" ADD CONSTRAINT "association_deliverable_decisions_outcome" CHECK (
  "outcome" IN ('verified', 'more_evidence_needed', 'waived')
);--> statement-breakpoint
ALTER TABLE "association_deliverable_decisions" ADD CONSTRAINT "association_deliverable_decisions_stated" CHECK (
  btrim("findings") <> '' AND btrim("decided_by") <> ''
);--> statement-breakpoint
ALTER TABLE "association_deliverable_decisions" ADD CONSTRAINT "association_deliverable_decisions_waiver_coherent" CHECK (
  ("outcome" = 'waived' AND "waiver_recorded_by" IS NOT NULL AND btrim("waiver_recorded_by") <> ''
    AND "waiver_reason" IS NOT NULL AND btrim("waiver_reason") <> '')
  OR ("outcome" <> 'waived' AND "waiver_recorded_by" IS NULL AND "waiver_reason" IS NULL)
);--> statement-breakpoint
CREATE INDEX "association_deliverable_decisions_deliverable_idx"
  ON "association_deliverable_decisions" ("deliverable_id", "decided_at" DESC);--> statement-breakpoint
--
COMMENT ON TABLE "association_deliverable_decisions" IS
  'Per-deliverable verification decisions (insert-only, latest wins). A waiver carries its named recorder and reason by CHECK; findings are required on every outcome.';--> statement-breakpoint

-- ═══ 4. Content-availability verification (§22.1, §14.2) ════════════════════
--
-- "Agreed campaign availability period" — the reference's own label, and what
-- dissolves the old parked message's objection: the Spec fixes no availability
-- period, but a term BOTH PARTIES ACCEPTED is not a period this product made
-- up. The verification stores the term it was checked against, verbatim, so
-- the record cannot be re-read into a different answer when the agreement
-- vocabulary changes around it.
CREATE TABLE "association_availability_verifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "association_id" uuid NOT NULL REFERENCES "campaign_affiliate_associations"("id") ON DELETE RESTRICT,
  -- The agreed term, as it read at the moment of the check.
  "term_checked" text NOT NULL,
  "available" boolean NOT NULL,
  "detail" text NOT NULL,
  "verified_by" text NOT NULL,
  "verified_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "association_availability_verifications" ADD CONSTRAINT "association_availability_verifications_stated" CHECK (
  btrim("term_checked") <> '' AND btrim("detail") <> '' AND btrim("verified_by") <> ''
);--> statement-breakpoint
CREATE INDEX "association_availability_verifications_association_idx"
  ON "association_availability_verifications" ("association_id", "verified_at" DESC);--> statement-breakpoint
--
COMMENT ON TABLE "association_availability_verifications" IS
  'Content-availability checks against the agreed term (insert-only, latest wins). Stores the term it verified against, so a later agreement edit cannot rewrite what was checked.';--> statement-breakpoint

-- ═══ 5. Proposal mediation notes (§14.2) ════════════════════════════════════
--
-- Admin mediates and NEVER agrees — `adminRejectVersion` is the only Admin
-- move on a proposal version, and there is no admin-acceptance route anywhere
-- (Phase 12a, asserted by its suite). A mediation note records what Admin told
-- the parties without becoming a decision: there is no acceptance column, no
-- outcome, and nothing here a later phase could read as either side's answer.
CREATE TABLE "proposal_mediation_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "association_id" uuid NOT NULL REFERENCES "campaign_affiliate_associations"("id") ON DELETE RESTRICT,
  "note" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "proposal_mediation_notes" ADD CONSTRAINT "proposal_mediation_notes_stated" CHECK (
  btrim("note") <> '' AND btrim("created_by") <> ''
);--> statement-breakpoint
CREATE INDEX "proposal_mediation_notes_association_idx"
  ON "proposal_mediation_notes" ("association_id", "created_at" DESC);--> statement-breakpoint
--
COMMENT ON TABLE "proposal_mediation_notes" IS
  'What Admin told the parties during a §14.2 negotiation (insert-only). Deliberately no acceptance or outcome column: Admin mediates and never agrees.';--> statement-breakpoint

-- ═══ 6. Active termination requests (§29, §24.8) ════════════════════════════
--
-- One party wants an active partnership to end. The record preserves the ask —
-- reason, effective time, cause, money treatment — and, later, the decision.
-- It DECIDES NO MONEY: the money treatment is the §24.8 classification the
-- eventual case will carry, CHECK-pinned to the cause register's own matrix so
-- a Founder-caused termination cannot record `cancel_unpaid_invalid` here any
-- more than it can in `refund_cause_allocations`. Executing anything is 20a's
-- preview-then-execute path, and ending the relationship is the §23.4 machine
-- through the enforcement routes that already own it — this row is the reason
-- those acts will cite, never a second door into either.
--
-- §31.6's shape: one undecided request per relationship by partial unique
-- index, and a decided one cannot be re-decided (trigger). The request fields
-- are immutable from the moment they are recorded — a decision that can edit
-- the ask it is deciding is deciding something else.
CREATE TABLE "association_termination_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "association_id" uuid NOT NULL REFERENCES "campaign_affiliate_associations"("id") ON DELETE RESTRICT,
  "reason" text NOT NULL,
  "effective_at" timestamp with time zone NOT NULL,
  "cause" text NOT NULL,
  "money_treatment" text NOT NULL,
  -- How the ask reached us — the `affiliate_deletion_requests` idiom. A
  -- termination request with no provenance is one nobody can verify was made.
  "received_via" text NOT NULL,
  "requested_at" timestamp with time zone NOT NULL,
  "recorded_by" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decision" text,
  "decision_note" text,
  "decided_by" text,
  "decided_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "association_termination_requests" ADD CONSTRAINT "association_termination_requests_cause" CHECK (
  "cause" IN ('founder_or_product', 'affiliate_fraud_or_breach', 'proovd_or_system_error', 'backer_dispute_unrelated', 'law_stripe_or_issuer')
);--> statement-breakpoint
-- §24.8's per-cause permitted-treatment matrix, restated from
-- `refund_allocations_cause_matrix` (0032). What is absent from a branch is
-- the guarantee: the strongest treatments are reachable only through the
-- affiliate-caused and mandated causes, here exactly as there.
ALTER TABLE "association_termination_requests" ADD CONSTRAINT "association_termination_requests_cause_matrix" CHECK (
  ("cause" = 'founder_or_product' AND "money_treatment" IN ('not_attributed', 'earnings_remain', 'cancel_unfinalized'))
  OR ("cause" = 'affiliate_fraud_or_breach' AND "money_treatment" IN ('cancel_unfinalized', 'cancel_unpaid_invalid', 'contractual_recovery'))
  OR ("cause" = 'proovd_or_system_error' AND "money_treatment" IN ('not_attributed', 'earnings_remain'))
  OR ("cause" = 'backer_dispute_unrelated' AND "money_treatment" IN ('not_attributed', 'earnings_remain', 'cancel_unfinalized'))
  OR ("cause" = 'law_stripe_or_issuer' AND "money_treatment" IN ('not_attributed', 'earnings_remain', 'cancel_unfinalized', 'cancel_unpaid_invalid', 'contractual_recovery'))
);--> statement-breakpoint
ALTER TABLE "association_termination_requests" ADD CONSTRAINT "association_termination_requests_stated" CHECK (
  btrim("reason") <> '' AND btrim("received_via") <> '' AND btrim("recorded_by") <> ''
);--> statement-breakpoint
ALTER TABLE "association_termination_requests" ADD CONSTRAINT "association_termination_requests_decision" CHECK (
  "decision" IS NULL OR "decision" IN ('applied', 'declined')
);--> statement-breakpoint
-- The decision arrives whole or not at all.
ALTER TABLE "association_termination_requests" ADD CONSTRAINT "association_termination_requests_decision_whole" CHECK (
  ("decision" IS NULL AND "decision_note" IS NULL AND "decided_by" IS NULL AND "decided_at" IS NULL)
  OR ("decision" IS NOT NULL AND "decision_note" IS NOT NULL AND btrim("decision_note") <> ''
    AND "decided_by" IS NOT NULL AND btrim("decided_by") <> '' AND "decided_at" IS NOT NULL)
);--> statement-breakpoint
-- One open ask per relationship. A second while one waits is a duplicate, not
-- a new decision (§31.6's shape).
CREATE UNIQUE INDEX "association_termination_requests_one_open_idx"
  ON "association_termination_requests" ("association_id")
  WHERE "decision" IS NULL;--> statement-breakpoint
CREATE INDEX "association_termination_requests_association_idx"
  ON "association_termination_requests" ("association_id", "requested_at" DESC);--> statement-breakpoint
--
CREATE OR REPLACE FUNCTION enforce_termination_request_immutability()
RETURNS trigger AS $$
BEGIN
  IF OLD.decision IS NOT NULL THEN
    RAISE EXCEPTION 'association_termination_requests: a decided request cannot be changed';
  END IF;
  IF NEW.association_id IS DISTINCT FROM OLD.association_id
    OR NEW.reason IS DISTINCT FROM OLD.reason
    OR NEW.effective_at IS DISTINCT FROM OLD.effective_at
    OR NEW.cause IS DISTINCT FROM OLD.cause
    OR NEW.money_treatment IS DISTINCT FROM OLD.money_treatment
    OR NEW.received_via IS DISTINCT FROM OLD.received_via
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
    OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
    OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at THEN
    RAISE EXCEPTION 'association_termination_requests: the recorded ask is immutable; only the decision columns may be written';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER association_termination_requests_immutable
  BEFORE UPDATE ON "association_termination_requests"
  FOR EACH ROW EXECUTE FUNCTION enforce_termination_request_immutability();--> statement-breakpoint
--
COMMENT ON TABLE "association_termination_requests" IS
  'A recorded ask to end an active partnership (§29), with its §24.8 cause and CHECK-matrixed money treatment. Decides no money and ends nothing itself; one open ask per relationship; the decision is write-once and the ask immutable.';--> statement-breakpoint

-- ═══ 7. Grants ══════════════════════════════════════════════════════════════
--
-- Five of the six families are insert-only in the 0005 idiom. The evidence
-- files carry the `campaign_assets` lifecycle, so they take full UPDATE under
-- the immutability trigger above; the termination request grants UPDATE on
-- exactly the four decision columns, which the trigger makes write-once.
GRANT SELECT, INSERT, UPDATE ON "affiliate_evidence_files" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "affiliate_evidence_verifications" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "association_deliverables" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "association_deliverable_evidence" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "association_deliverable_decisions" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "association_availability_verifications" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "proposal_mediation_notes" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "association_termination_requests" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("decision", "decision_note", "decided_by", "decided_at")
  ON "association_termination_requests" TO proovd_app;
