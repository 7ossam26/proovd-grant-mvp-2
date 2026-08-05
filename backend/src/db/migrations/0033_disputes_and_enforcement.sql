-- Phase 20b — disputes, enforcement records, and the Backer escalation
-- (§24.11, §26.7, §29, §33.9.6–§33.9.9, §33.9.12).
--
-- What the database itself guarantees here:
--
--   * a dispute's 24-hour Admin task is CHECK-pinned to the dispute's own
--     opening instant (§24.11) and immutable by trigger — a retry cannot move
--     a deadline already promised (§29.6's rule, applied internally);
--   * a dispute's §24.8 classification is write-once and must be a
--     `case_kind = 'dispute'` allocation classifying the SAME reservation —
--     the dispute reuses 20a's register, never a second one;
--   * the ingest itself cannot claw anything back: nothing in this file
--     touches `creator_earnings`, and the §24.8 matrix CHECK from 0032 still
--     ceilings what an unrelated-dispute classification may record (§33.9.6);
--   * a §29.4 affiliate enforcement action has no row shape without all five
--     customer-statement fields — "policy violation" alone cannot be stored —
--     and a terminate/remove must record its §29.5 validity;
--   * an appeal decision is write-once ("Admin appeal decision is final");
--   * §29.1's certification is two CHECKed-true booleans — an uncertified
--     self-pre-order disclosure has no representable row;
--   * a §29.8 reacceptance requirement can only cite a PUBLISHED policy
--     version — blocking every Founder on a text nobody can read would be the
--     account-claim bug reintroduced at scale;
--   * every record here is evidence, so every table is insert-only except the
--     two whose lifecycle §24.11/§29.4 name (dispute status, appeal decision),
--     and those guard their identity columns by trigger.

-- ── payment_disputes (§24.11) ───────────────────────────────────────────────
CREATE TABLE "payment_disputes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "reservation_id" uuid NOT NULL,
  "mode" text NOT NULL,
  "provider_dispute_id" text NOT NULL,
  "charge_id" text,
  "payment_intent_id" text,
  "amount_cents" bigint NOT NULL,
  "currency" text DEFAULT 'usd' NOT NULL,
  -- The provider's reason code. Internal only (§25.6, §33.9.11).
  "reason_code" text,
  "status" text NOT NULL,
  -- The provider's own evidence submission deadline, where it sent one.
  "provider_evidence_due_by" timestamp with time zone,
  "opened_at" timestamp with time zone NOT NULL,
  -- §24.11: "create an Admin task due within 24 hours."
  "task_due_at" timestamp with time zone NOT NULL,
  -- The §24.8 classification, when an Admin records it. Write-once; the
  -- shape trigger below requires case_kind='dispute' on the same reservation.
  "allocation_id" uuid,
  "closed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payment_disputes_mode" CHECK ("mode" IN ('test', 'live')),
  CONSTRAINT "payment_disputes_amount" CHECK ("amount_cents" > 0),
  CONSTRAINT "payment_disputes_status" CHECK (
    "status" IN (
      'warning_needs_response', 'warning_under_review', 'warning_closed',
      'needs_response', 'under_review', 'won', 'lost'
    )
  ),
  -- The 24-hour task is a fact of the opening instant, not a habit.
  CONSTRAINT "payment_disputes_task_due" CHECK (
    "task_due_at" = "opened_at" + interval '24 hours'
  )
);--> statement-breakpoint

-- ── payment_dispute_events: the provider lifecycle, append-only ─────────────
CREATE TABLE "payment_dispute_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "dispute_id" uuid NOT NULL,
  "provider_event_id" text,
  "from_status" text,
  "to_status" text NOT NULL,
  "note" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- ── payment_dispute_evidence: the assembled §24.11 packet, recorded ─────────
-- §26.7 "Assemble dispute evidence" is an Admin act, and §1.3 makes manual
-- work valid only when the app records it. The packet is composed from
-- existing records; this stores WHAT was assembled, by whom, when. A
-- re-assembly is a new row; the latest row is what was sent.
CREATE TABLE "payment_dispute_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "dispute_id" uuid NOT NULL,
  "packet" jsonb NOT NULL,
  -- All §24.11 REQUIRED items present at assembly time (the service refuses
  -- to record an incomplete packet, but the stored answer is still a fact).
  "complete" boolean NOT NULL,
  "missing" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "assembled_by" text NOT NULL,
  "assembled_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payment_dispute_evidence_actor" CHECK (btrim("assembled_by") <> '')
);--> statement-breakpoint

-- ── affiliate_enforcement_actions (§29.4, §29.5) ────────────────────────────
CREATE TABLE "affiliate_enforcement_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "association_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "action_kind" text NOT NULL,
  "reason_category" text NOT NULL,
  -- §29.4: "Internal reason remains separate." Never rendered to the Creator.
  "internal_reason" text NOT NULL,
  -- The five typed fields of the customer-facing statement (§29.4). The sixth
  -- element — the appeal deadline — is computed, below.
  "evidence_and_behavior" text NOT NULL,
  "rule_violated" text NOT NULL,
  "immediate_effect" text NOT NULL,
  "correction_path" text NOT NULL,
  "human_route" text NOT NULL,
  -- Five business days on the committed calendar, stored with its version.
  "appeal_due_at" timestamp with time zone NOT NULL,
  "calendar_version" text NOT NULL,
  -- §29.5: required exactly when the action ends an active partnership.
  "termination_validity" text,
  "prior_association_status" text NOT NULL,
  "new_association_status" text NOT NULL,
  "actor" text NOT NULL,
  "mfa_context" text NOT NULL,
  "reauth_context" text NOT NULL,
  "evidence_links" jsonb,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "affiliate_enforcement_action_kind" CHECK (
    "action_kind" IN ('warn', 'pause', 'terminate', 'demote', 'restrict_bidding', 'remove', 'refer_case')
  ),
  CONSTRAINT "affiliate_enforcement_reason" CHECK (
    "reason_category" IN (
      'aup_breach', 'fraud', 'metric_manipulation', 'deceptive_promotion',
      'host_rule_violation', 'regulatory_provider_risk', 'repeated_invalid_termination'
    )
  ),
  CONSTRAINT "affiliate_enforcement_internal_reason" CHECK (btrim("internal_reason") <> ''),
  CONSTRAINT "affiliate_enforcement_evidence" CHECK (btrim("evidence_and_behavior") <> ''),
  CONSTRAINT "affiliate_enforcement_rule" CHECK (btrim("rule_violated") <> ''),
  CONSTRAINT "affiliate_enforcement_effect" CHECK (btrim("immediate_effect") <> ''),
  CONSTRAINT "affiliate_enforcement_correction" CHECK (btrim("correction_path") <> ''),
  CONSTRAINT "affiliate_enforcement_human_route" CHECK (btrim("human_route") <> ''),
  CONSTRAINT "affiliate_enforcement_termination_validity" CHECK (
    ("action_kind" IN ('terminate', 'remove')) = ("termination_validity" IS NOT NULL)
  ),
  CONSTRAINT "affiliate_enforcement_validity_known" CHECK (
    "termination_validity" IS NULL OR "termination_validity" IN (
      'valid_founder_material_breach', 'valid_proovd_suspension',
      'valid_documented_emergency', 'valid_admin_accepted', 'invalid'
    )
  )
);--> statement-breakpoint

-- ── affiliate_enforcement_appeals (§29.4) ───────────────────────────────────
CREATE TABLE "affiliate_enforcement_appeals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "action_id" uuid NOT NULL,
  "grounds" text NOT NULL,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- Write-once by trigger: "Admin appeal decision is final."
  "decision" text,
  "decision_note" text,
  "decided_by" text,
  "decided_at" timestamp with time zone,
  CONSTRAINT "affiliate_appeal_grounds" CHECK (btrim("grounds") <> ''),
  CONSTRAINT "affiliate_appeal_decision_known" CHECK (
    "decision" IS NULL OR "decision" IN ('upheld', 'overturned')
  ),
  -- Decision, decider, and time land together or not at all.
  CONSTRAINT "affiliate_appeal_decision_complete" CHECK (
    ("decision" IS NULL) = ("decided_by" IS NULL)
    AND ("decision" IS NULL) = ("decided_at" IS NULL)
  )
);--> statement-breakpoint

-- ── affiliate_conflict_disclosures (§29.2) ──────────────────────────────────
CREATE TABLE "affiliate_conflict_disclosures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "association_id" uuid NOT NULL,
  "relationship_kind" text NOT NULL,
  "detail" text NOT NULL,
  -- Who stated it (the Creator through support, or Admin from review).
  "disclosed_by" text NOT NULL,
  "recorded_by" text NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "affiliate_conflict_kind" CHECK (
    "relationship_kind" IN (
      'business', 'family', 'financial', 'investor', 'advisor', 'contractor',
      'employee', 'backer', 'founder', 'other_affiliate', 'competitor'
    )
  ),
  CONSTRAINT "affiliate_conflict_detail" CHECK (btrim("detail") <> ''),
  CONSTRAINT "affiliate_conflict_disclosed_by" CHECK (btrim("disclosed_by") <> '')
);--> statement-breakpoint

-- ── affiliate_self_preorder_disclosures (§29.1) ─────────────────────────────
-- §29.1's permission is three recorded facts; the two certifications are
-- CHECKed true, so an uncertified disclosure has no representable row. The
-- "earns no commission, bonus, or thank-you" consequence executes in the
-- service: a linked reservation attributed to this Creator's own link has its
-- stored attribution excluded before finalization can count it.
CREATE TABLE "affiliate_self_preorder_disclosures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "association_id" uuid NOT NULL,
  "reservation_id" uuid,
  "intent_note" text NOT NULL,
  "self_funded_certified" boolean NOT NULL,
  "identity_disclosed" boolean NOT NULL,
  "recorded_by" text NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "self_preorder_intent" CHECK (btrim("intent_note") <> ''),
  CONSTRAINT "self_preorder_funded" CHECK ("self_funded_certified"),
  CONSTRAINT "self_preorder_identity" CHECK ("identity_disclosed")
);--> statement-breakpoint

-- ── policy_reacceptance_requirements (§29.8) ────────────────────────────────
CREATE TABLE "policy_reacceptance_requirements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "policy_version_id" uuid NOT NULL,
  -- Denormalised for readability, exactly as policy_consents does.
  "policy_slug" text NOT NULL,
  "required_version" text NOT NULL,
  "audience" text NOT NULL,
  -- Why the update is material — §15's rule: materiality is a recorded
  -- Admin judgement, never guessed.
  "reason" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "policy_reacceptance_audience" CHECK ("audience" IN ('founder', 'affiliate')),
  CONSTRAINT "policy_reacceptance_reason" CHECK (btrim("reason") <> '')
);--> statement-breakpoint

-- ── support_case_escalations (§29.10) ───────────────────────────────────────
CREATE TABLE "support_case_escalations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "reason" text NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "support_escalation_kind" CHECK (
    "kind" IN ('no_response_14_days', 'not_resolved')
  ),
  CONSTRAINT "support_escalation_reason" CHECK (btrim("reason") <> '')
);--> statement-breakpoint

-- ── Foreign keys ────────────────────────────────────────────────────────────
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_reservation_fk"
  FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_allocation_fk"
  FOREIGN KEY ("allocation_id") REFERENCES "public"."refund_cause_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_dispute_events" ADD CONSTRAINT "payment_dispute_events_dispute_fk"
  FOREIGN KEY ("dispute_id") REFERENCES "public"."payment_disputes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_dispute_evidence" ADD CONSTRAINT "payment_dispute_evidence_dispute_fk"
  FOREIGN KEY ("dispute_id") REFERENCES "public"."payment_disputes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_enforcement_actions" ADD CONSTRAINT "affiliate_enforcement_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_enforcement_actions" ADD CONSTRAINT "affiliate_enforcement_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_enforcement_appeals" ADD CONSTRAINT "affiliate_appeals_action_fk"
  FOREIGN KEY ("action_id") REFERENCES "public"."affiliate_enforcement_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_conflict_disclosures" ADD CONSTRAINT "affiliate_conflicts_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_self_preorder_disclosures" ADD CONSTRAINT "self_preorder_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_self_preorder_disclosures" ADD CONSTRAINT "self_preorder_reservation_fk"
  FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_reacceptance_requirements" ADD CONSTRAINT "policy_reacceptance_version_fk"
  FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_case_escalations" ADD CONSTRAINT "support_escalations_case_fk"
  FOREIGN KEY ("case_id") REFERENCES "public"."support_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- One domain record per provider dispute, per mode (§32.4's identity shape).
CREATE UNIQUE INDEX "payment_disputes_provider_idx" ON "payment_disputes" USING btree ("mode", "provider_dispute_id");--> statement-breakpoint
CREATE INDEX "payment_disputes_campaign_idx" ON "payment_disputes" USING btree ("campaign_id", "status");--> statement-breakpoint
CREATE INDEX "payment_disputes_reservation_idx" ON "payment_disputes" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "payment_disputes_task_idx" ON "payment_disputes" USING btree ("task_due_at");--> statement-breakpoint
CREATE INDEX "payment_dispute_events_dispute_idx" ON "payment_dispute_events" USING btree ("dispute_id", "occurred_at");--> statement-breakpoint
CREATE INDEX "payment_dispute_evidence_dispute_idx" ON "payment_dispute_evidence" USING btree ("dispute_id", "assembled_at");--> statement-breakpoint
CREATE INDEX "affiliate_enforcement_association_idx" ON "affiliate_enforcement_actions" USING btree ("association_id", "occurred_at");--> statement-breakpoint
CREATE INDEX "affiliate_enforcement_campaign_idx" ON "affiliate_enforcement_actions" USING btree ("campaign_id", "occurred_at");--> statement-breakpoint
-- §29.4 names one appeal window per action; a second appeal of the same
-- action is the same appeal.
CREATE UNIQUE INDEX "affiliate_appeals_action_idx" ON "affiliate_enforcement_appeals" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "affiliate_conflicts_association_idx" ON "affiliate_conflict_disclosures" USING btree ("association_id");--> statement-breakpoint
CREATE INDEX "self_preorder_association_idx" ON "affiliate_self_preorder_disclosures" USING btree ("association_id");--> statement-breakpoint
-- One disclosure per (association, reservation): a second disclosure of the
-- same purchase is the same disclosure.
CREATE UNIQUE INDEX "self_preorder_reservation_idx" ON "affiliate_self_preorder_disclosures" USING btree ("association_id", "reservation_id") WHERE "reservation_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_reacceptance_dedup_idx" ON "policy_reacceptance_requirements" USING btree ("policy_slug", "audience", "required_version");--> statement-breakpoint
-- §29.10: one escalation per case — escalating twice is the same escalation.
CREATE UNIQUE INDEX "support_escalations_case_idx" ON "support_case_escalations" USING btree ("case_id");--> statement-breakpoint

-- ── Triggers ────────────────────────────────────────────────────────────────

-- A dispute's identity and its 24-hour task are facts of its arrival; the
-- provider lifecycle may move, the classification lands once.
CREATE OR REPLACE FUNCTION enforce_payment_dispute_transitions()
RETURNS trigger AS $$
BEGIN
  IF NEW."provider_dispute_id" IS DISTINCT FROM OLD."provider_dispute_id"
     OR NEW."mode" IS DISTINCT FROM OLD."mode"
     OR NEW."reservation_id" IS DISTINCT FROM OLD."reservation_id"
     OR NEW."campaign_id" IS DISTINCT FROM OLD."campaign_id"
     OR NEW."amount_cents" IS DISTINCT FROM OLD."amount_cents"
     OR NEW."opened_at" IS DISTINCT FROM OLD."opened_at"
     OR NEW."task_due_at" IS DISTINCT FROM OLD."task_due_at"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'payment_disputes identity and its 24-hour task are immutable (§24.11)';
  END IF;
  IF OLD."allocation_id" IS NOT NULL
     AND NEW."allocation_id" IS DISTINCT FROM OLD."allocation_id" THEN
    RAISE EXCEPTION 'a dispute''s §24.8 classification is write-once — a revised judgement is a new allocation (§24.8)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "payment_disputes_transitions"
  BEFORE UPDATE ON "payment_disputes"
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_dispute_transitions();--> statement-breakpoint

-- The classification must be a dispute-kind allocation of the same reservation.
CREATE OR REPLACE FUNCTION enforce_payment_dispute_allocation()
RETURNS trigger AS $$
DECLARE
  v_reservation uuid;
  v_kind text;
BEGIN
  IF NEW."allocation_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "reservation_id", "case_kind" INTO v_reservation, v_kind
    FROM "refund_cause_allocations" WHERE "id" = NEW."allocation_id";
  IF v_reservation IS DISTINCT FROM NEW."reservation_id" THEN
    RAISE EXCEPTION 'a dispute''s cause allocation must classify its own reservation (§24.8)';
  END IF;
  IF v_kind IS DISTINCT FROM 'dispute' THEN
    RAISE EXCEPTION 'a dispute cites a dispute-kind allocation (§24.8)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "payment_disputes_allocation_shape"
  BEFORE INSERT OR UPDATE OF "allocation_id" ON "payment_disputes"
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_dispute_allocation();--> statement-breakpoint

CREATE OR REPLACE FUNCTION refuse_payment_dispute_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payment_disputes rows are history and are never deleted (§25.6)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "payment_disputes_no_delete"
  BEFORE DELETE ON "payment_disputes"
  FOR EACH ROW EXECUTE FUNCTION refuse_payment_dispute_delete();--> statement-breakpoint

CREATE OR REPLACE FUNCTION refuse_dispute_record_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'dispute events and evidence are insert-only (§24.11, §25.6)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "payment_dispute_events_append_only"
  BEFORE UPDATE OR DELETE ON "payment_dispute_events"
  FOR EACH ROW EXECUTE FUNCTION refuse_dispute_record_change();--> statement-breakpoint

CREATE TRIGGER "payment_dispute_evidence_append_only"
  BEFORE UPDATE OR DELETE ON "payment_dispute_evidence"
  FOR EACH ROW EXECUTE FUNCTION refuse_dispute_record_change();--> statement-breakpoint

-- §29.4: the enforcement record is evidence.
CREATE OR REPLACE FUNCTION refuse_affiliate_enforcement_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'affiliate_enforcement_actions is insert-only — a revised action is a new record (§29.4, §25.6)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "affiliate_enforcement_append_only"
  BEFORE UPDATE OR DELETE ON "affiliate_enforcement_actions"
  FOR EACH ROW EXECUTE FUNCTION refuse_affiliate_enforcement_change();--> statement-breakpoint

-- The appeal's submission is immutable; the decision lands exactly once.
CREATE OR REPLACE FUNCTION enforce_affiliate_appeal_transitions()
RETURNS trigger AS $$
BEGIN
  IF NEW."action_id" IS DISTINCT FROM OLD."action_id"
     OR NEW."grounds" IS DISTINCT FROM OLD."grounds"
     OR NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at" THEN
    RAISE EXCEPTION 'an appeal''s submission is immutable (§29.4)';
  END IF;
  IF OLD."decision" IS NOT NULL THEN
    RAISE EXCEPTION 'the appeal decision is final (§29.4)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "affiliate_appeals_transitions"
  BEFORE UPDATE ON "affiliate_enforcement_appeals"
  FOR EACH ROW EXECUTE FUNCTION enforce_affiliate_appeal_transitions();--> statement-breakpoint

CREATE OR REPLACE FUNCTION refuse_affiliate_appeal_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'appeals are history and are never deleted (§29.4, §25.6)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "affiliate_appeals_no_delete"
  BEFORE DELETE ON "affiliate_enforcement_appeals"
  FOR EACH ROW EXECUTE FUNCTION refuse_affiliate_appeal_delete();--> statement-breakpoint

-- §29.1/§29.2/§29.8/§29.10 records are insert-only.
CREATE OR REPLACE FUNCTION refuse_enforcement_disclosure_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'disclosure and requirement records are insert-only (§29, §25.6)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "affiliate_conflicts_append_only"
  BEFORE UPDATE OR DELETE ON "affiliate_conflict_disclosures"
  FOR EACH ROW EXECUTE FUNCTION refuse_enforcement_disclosure_change();--> statement-breakpoint

CREATE TRIGGER "self_preorder_append_only"
  BEFORE UPDATE OR DELETE ON "affiliate_self_preorder_disclosures"
  FOR EACH ROW EXECUTE FUNCTION refuse_enforcement_disclosure_change();--> statement-breakpoint

CREATE TRIGGER "policy_reacceptance_append_only"
  BEFORE UPDATE OR DELETE ON "policy_reacceptance_requirements"
  FOR EACH ROW EXECUTE FUNCTION refuse_enforcement_disclosure_change();--> statement-breakpoint

CREATE TRIGGER "support_escalations_append_only"
  BEFORE UPDATE OR DELETE ON "support_case_escalations"
  FOR EACH ROW EXECUTE FUNCTION refuse_enforcement_disclosure_change();--> statement-breakpoint

-- §29.8: a requirement may cite only a published version — the same rule a
-- consent obeys (§34 condition 4's shape). Suspending every Founder on a
-- draft nobody can read is not a reacceptance flow.
CREATE OR REPLACE FUNCTION enforce_reacceptance_published()
RETURNS trigger AS $$
DECLARE
  v_status text;
  v_slug text;
  v_version text;
BEGIN
  SELECT "status", "slug", "version" INTO v_status, v_slug, v_version
    FROM "policy_versions" WHERE "id" = NEW."policy_version_id";
  IF v_status IS DISTINCT FROM 'published' THEN
    RAISE EXCEPTION 'a reacceptance requirement may cite only a published policy version (§29.8, §31.4)';
  END IF;
  IF v_slug IS DISTINCT FROM NEW."policy_slug" OR v_version IS DISTINCT FROM NEW."required_version" THEN
    RAISE EXCEPTION 'the denormalised slug/version must match the cited policy version (§29.8)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "policy_reacceptance_published"
  BEFORE INSERT ON "policy_reacceptance_requirements"
  FOR EACH ROW EXECUTE FUNCTION enforce_reacceptance_published();--> statement-breakpoint

-- ── Grants ──────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON "payment_disputes" TO "proovd_app";--> statement-breakpoint
REVOKE DELETE ON "payment_disputes" FROM "proovd_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "payment_dispute_events" TO "proovd_app";--> statement-breakpoint
REVOKE UPDATE, DELETE ON "payment_dispute_events" FROM "proovd_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "payment_dispute_evidence" TO "proovd_app";--> statement-breakpoint
REVOKE UPDATE, DELETE ON "payment_dispute_evidence" FROM "proovd_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "affiliate_enforcement_actions" TO "proovd_app";--> statement-breakpoint
REVOKE UPDATE, DELETE ON "affiliate_enforcement_actions" FROM "proovd_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "affiliate_enforcement_appeals" TO "proovd_app";--> statement-breakpoint
REVOKE DELETE ON "affiliate_enforcement_appeals" FROM "proovd_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "affiliate_conflict_disclosures" TO "proovd_app";--> statement-breakpoint
REVOKE UPDATE, DELETE ON "affiliate_conflict_disclosures" FROM "proovd_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "affiliate_self_preorder_disclosures" TO "proovd_app";--> statement-breakpoint
REVOKE UPDATE, DELETE ON "affiliate_self_preorder_disclosures" FROM "proovd_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "policy_reacceptance_requirements" TO "proovd_app";--> statement-breakpoint
REVOKE UPDATE, DELETE ON "policy_reacceptance_requirements" FROM "proovd_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "support_case_escalations" TO "proovd_app";--> statement-breakpoint
REVOKE UPDATE, DELETE ON "support_case_escalations" FROM "proovd_app";
