-- Phase 24 — the live-mode readiness gate.
-- Spec §34, §6, §2.2, §25.6, Appendix C.
--
-- The last migration in the plan, and it stores no money, no personal data,
-- and no campaign content. What it stores is why somebody decided a real
-- person's card could be charged.
--
-- Everything here is insert-only, which is the whole design. §34's language is
-- "recorded as complete" and §1.3's is that manual work counts only when the
-- app records it — so a verification is an event a named person made at a
-- time, with evidence and findings. The most recent row per condition is the
-- current answer, and withdrawing one is a new row saying so. A gate whose
-- justification can be edited afterwards is a gate whose justification is
-- worth nothing at the moment it matters.

-- ── §34's eleven conditions ─────────────────────────────────────────────────
CREATE TABLE "live_mode_condition_verifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "condition_key" text NOT NULL,
  "status" text NOT NULL,
  "verified_by" text NOT NULL,
  "verified_at" timestamptz NOT NULL DEFAULT now(),
  "findings" text NOT NULL,
  "evidence_reference" text
);--> statement-breakpoint

-- Only the NINE conditions that need a filed answer can have a row at all —
-- the three the acceptance suite decides and the six a person does.
--
-- The other two — the eight policy documents being published, and the
-- environment separating test keys from live ones — are re-decided on every
-- read. Storing an answer for either would let an attestation outlive the fact
-- it describes: somebody signs off that the policies are published, a document
-- is later revised to `draft` for a correction, and the gate still reads the
-- signature. There is no row shape for that, rather than a service that
-- remembers not to write one.
ALTER TABLE "live_mode_condition_verifications"
  ADD CONSTRAINT "live_mode_condition_key_needs_a_filed_answer" CHECK (
    "condition_key" IN (
      'payment_architecture',
      'transfer_capability',
      'tax_configuration',
      'test_cards_and_idempotency',
      'samples_collect_nothing',
      'admin_security',
      'p0_pass',
      'human_reconciliation',
      'pilot_owners'
    )
  );--> statement-breakpoint

ALTER TABLE "live_mode_condition_verifications"
  ADD CONSTRAINT "live_mode_condition_status" CHECK (
    "status" IN ('satisfied', 'not_satisfied')
  );--> statement-breakpoint

-- "Checked" is not a note. §34's first trap is a condition marked satisfied by
-- inference, and in a filled row that reads exactly like a blank finding.
ALTER TABLE "live_mode_condition_verifications"
  ADD CONSTRAINT "live_mode_condition_findings_present" CHECK (
    btrim("findings") <> ''
  );--> statement-breakpoint

-- A satisfied condition must point at its evidence. §34 asks for conditions
-- "verified with recorded evidence and a named verifier"; a satisfied row with
-- no evidence is the checklist the trap says a gate is not. A `not_satisfied`
-- row needs none — recording that something is NOT done is not a claim.
ALTER TABLE "live_mode_condition_verifications"
  ADD CONSTRAINT "live_mode_condition_evidence_when_satisfied" CHECK (
    "status" <> 'satisfied'
    OR ("evidence_reference" IS NOT NULL AND btrim("evidence_reference") <> '')
  );--> statement-breakpoint

CREATE INDEX "live_mode_condition_verifications_key_idx"
  ON "live_mode_condition_verifications" ("condition_key", "verified_at");--> statement-breakpoint

-- ── The pilot enablement ────────────────────────────────────────────────────
CREATE TABLE "pilot_campaign_enablements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id"),
  "enabled_by" text NOT NULL,
  "enabled_at" timestamptz NOT NULL DEFAULT now(),
  "gate_snapshot" text NOT NULL,
  "rollback_triggers" text NOT NULL,
  "rollback_decision_maker" text NOT NULL,
  "rollback_mechanism" text NOT NULL,
  "rollback_in_flight_reservations" text NOT NULL,
  "rollback_party_communication" text NOT NULL,
  "rolled_back_at" timestamptz,
  "rolled_back_by" text,
  "rollback_reason" text
);--> statement-breakpoint

-- §6: "the first live enablement is limited to one named pilot campaign".
--
-- A unique index over a constant, partial on the not-rolled-back rows. There
-- is at most ONE live enablement in the whole system at any moment — not one
-- per campaign, not one per Founder — so a second pilot is refused by the
-- database rather than by a service that counted first. Rolling one back frees
-- the slot, which is exactly the sequence §34 describes.
CREATE UNIQUE INDEX "pilot_campaign_enablements_one_live"
  ON "pilot_campaign_enablements" ((true))
  WHERE "rolled_back_at" IS NULL;--> statement-breakpoint

CREATE INDEX "pilot_campaign_enablements_campaign_idx"
  ON "pilot_campaign_enablements" ("campaign_id");--> statement-breakpoint

-- The five rollback-plan facts, each present. "Written before cutover, not
-- after a problem" has exactly one enforceable form: the enablement row cannot
-- exist without the plan.
ALTER TABLE "pilot_campaign_enablements"
  ADD CONSTRAINT "pilot_enablement_rollback_plan_complete" CHECK (
    btrim("rollback_triggers") <> ''
    AND btrim("rollback_decision_maker") <> ''
    AND btrim("rollback_mechanism") <> ''
    AND btrim("rollback_in_flight_reservations") <> ''
    AND btrim("rollback_party_communication") <> ''
  );--> statement-breakpoint

ALTER TABLE "pilot_campaign_enablements"
  ADD CONSTRAINT "pilot_enablement_gate_snapshot_present" CHECK (
    btrim("gate_snapshot") <> ''
  );--> statement-breakpoint

-- A rollback is three facts or none. A rolled-back row with no reason and no
-- actor is live money stopped by somebody nobody can ask about it (§25.6).
ALTER TABLE "pilot_campaign_enablements"
  ADD CONSTRAINT "pilot_enablement_rollback_complete" CHECK (
    ("rolled_back_at" IS NULL AND "rolled_back_by" IS NULL AND "rollback_reason" IS NULL)
    OR (
      "rolled_back_at" IS NOT NULL
      AND "rolled_back_by" IS NOT NULL AND btrim("rolled_back_by") <> ''
      AND "rollback_reason" IS NOT NULL AND btrim("rollback_reason") <> ''
    )
  );--> statement-breakpoint

-- Immutable apart from the rollback, and the rollback is write-once.
--
-- The enablement is the record of the decision that opened live money; every
-- fact in it — which campaign, who enabled it, what the gate said at the time,
-- and what the plan was — is the justification, and a justification that can
-- be edited after the fact is not one. The rollback columns move exactly once,
-- from NULL to a value: an "un-rollback" is a new enablement, with a new gate
-- snapshot, because the reason live money stopped is not something to erase.
CREATE OR REPLACE FUNCTION enforce_pilot_enablement_immutability()
RETURNS trigger AS $$
BEGIN
  IF NEW."campaign_id" IS DISTINCT FROM OLD."campaign_id"
     OR NEW."enabled_by" IS DISTINCT FROM OLD."enabled_by"
     OR NEW."enabled_at" IS DISTINCT FROM OLD."enabled_at"
     OR NEW."gate_snapshot" IS DISTINCT FROM OLD."gate_snapshot"
     OR NEW."rollback_triggers" IS DISTINCT FROM OLD."rollback_triggers"
     OR NEW."rollback_decision_maker" IS DISTINCT FROM OLD."rollback_decision_maker"
     OR NEW."rollback_mechanism" IS DISTINCT FROM OLD."rollback_mechanism"
     OR NEW."rollback_in_flight_reservations" IS DISTINCT FROM OLD."rollback_in_flight_reservations"
     OR NEW."rollback_party_communication" IS DISTINCT FROM OLD."rollback_party_communication"
  THEN
    RAISE EXCEPTION
      'A pilot enablement records why live money was opened and cannot be edited (§34, §25.6). Roll it back and record a new one.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."rolled_back_at" IS NOT NULL
     AND (NEW."rolled_back_at" IS DISTINCT FROM OLD."rolled_back_at"
          OR NEW."rolled_back_by" IS DISTINCT FROM OLD."rolled_back_by"
          OR NEW."rollback_reason" IS DISTINCT FROM OLD."rollback_reason")
  THEN
    RAISE EXCEPTION
      'A rollback is recorded once. Re-enabling live mode is a new enablement with its own gate snapshot (§34).'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER pilot_enablement_immutability
  BEFORE UPDATE ON "pilot_campaign_enablements"
  FOR EACH ROW EXECUTE FUNCTION enforce_pilot_enablement_immutability();--> statement-breakpoint

-- ── The two named owners ────────────────────────────────────────────────────
CREATE TABLE "pilot_campaign_owners" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "enablement_id" uuid NOT NULL REFERENCES "pilot_campaign_enablements"("id"),
  "role" text NOT NULL,
  "name" text NOT NULL,
  "contact" text NOT NULL,
  "acknowledged_by" text NOT NULL,
  "superseded_at" timestamptz
);--> statement-breakpoint

ALTER TABLE "pilot_campaign_owners"
  ADD CONSTRAINT "pilot_owner_role" CHECK ("role" IN ('monitoring', 'rollback'));--> statement-breakpoint

-- §34: "Named owners means named people", reachable, "who know they hold it".
-- Three facts, three non-blank columns. Whether the name is a person rather
-- than a rota is condition 11's recorded judgement — a database cannot tell a
-- surname from a team alias, and a check that pretended to would refuse real
-- names and teach people to work around it.
ALTER TABLE "pilot_campaign_owners"
  ADD CONSTRAINT "pilot_owner_facts_present" CHECK (
    btrim("name") <> ''
    AND btrim("contact") <> ''
    AND btrim("acknowledged_by") <> ''
  );--> statement-breakpoint

-- One live owner per role. A handover is a new row and the old one survives —
-- the 0005 `campaign_invitation_sends` arrangement, with UPDATE granted on
-- exactly the one column that retires a row and nothing else. Who was on the
-- hook when something happened is not a fact to overwrite.
CREATE UNIQUE INDEX "pilot_campaign_owners_role_idx"
  ON "pilot_campaign_owners" ("enablement_id", "role")
  WHERE "superseded_at" IS NULL;--> statement-breakpoint

-- ── The three pre-first-reservation confirmations ───────────────────────────
CREATE TABLE "pilot_preflight_confirmations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "enablement_id" uuid NOT NULL REFERENCES "pilot_campaign_enablements"("id"),
  "check_key" text NOT NULL,
  "confirmed_by" text NOT NULL,
  "confirmed_at" timestamptz NOT NULL DEFAULT now(),
  "findings" text NOT NULL
);--> statement-breakpoint

ALTER TABLE "pilot_preflight_confirmations"
  ADD CONSTRAINT "pilot_preflight_check_key" CHECK (
    "check_key" IN (
      'descriptor_on_statement',
      'live_webhook_delivery',
      'monitoring_owner_sees_risk'
    )
  );--> statement-breakpoint

ALTER TABLE "pilot_preflight_confirmations"
  ADD CONSTRAINT "pilot_preflight_findings_present" CHECK (btrim("findings") <> '');--> statement-breakpoint

CREATE UNIQUE INDEX "pilot_preflight_confirmations_check_idx"
  ON "pilot_preflight_confirmations" ("enablement_id", "check_key");--> statement-breakpoint

-- ── Appendix C — the recorded walks ─────────────────────────────────────────
CREATE TABLE "appendix_c_walkthroughs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor" text NOT NULL,
  "step_key" text NOT NULL,
  "result" text NOT NULL,
  "walked_by" text NOT NULL,
  "walked_at" timestamptz NOT NULL DEFAULT now(),
  "findings" text NOT NULL,
  "undocumented_knowledge_required" text
);--> statement-breakpoint

ALTER TABLE "appendix_c_walkthroughs"
  ADD CONSTRAINT "appendix_c_actor" CHECK (
    "actor" IN ('admin', 'founder', 'creator', 'backer')
  );--> statement-breakpoint

ALTER TABLE "appendix_c_walkthroughs"
  ADD CONSTRAINT "appendix_c_result" CHECK ("result" IN ('passed', 'failed'));--> statement-breakpoint

ALTER TABLE "appendix_c_walkthroughs"
  ADD CONSTRAINT "appendix_c_findings_present" CHECK (btrim("findings") <> '');--> statement-breakpoint

-- Appendix C's condition is not "the walker got through". It is "without
-- undocumented operator knowledge" — so a walk that only succeeded because the
-- walker already knew a trick is a FAILED walk with a passing feeling, and the
-- constraint is what stops it being recorded as a pass. Naming the knowledge
-- and marking it passed is unrepresentable.
ALTER TABLE "appendix_c_walkthroughs"
  ADD CONSTRAINT "appendix_c_undocumented_knowledge_fails" CHECK (
    "undocumented_knowledge_required" IS NULL
    OR (btrim("undocumented_knowledge_required") <> '' AND "result" = 'failed')
  );--> statement-breakpoint

CREATE INDEX "appendix_c_walkthroughs_step_idx"
  ON "appendix_c_walkthroughs" ("actor", "step_key", "walked_at");--> statement-breakpoint

-- ── Grants: insert-only, with two columns granted by name ───────────────────
GRANT SELECT, INSERT ON "live_mode_condition_verifications" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "pilot_campaign_enablements" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "pilot_campaign_owners" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "pilot_preflight_confirmations" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "appendix_c_walkthroughs" TO proovd_app;--> statement-breakpoint

-- The rollback, and the owner handover. Everything else on both tables is
-- outside the grant, so the immutability trigger above is a second answer to a
-- statement the role cannot write in the first place.
GRANT UPDATE ("rolled_back_at", "rolled_back_by", "rollback_reason")
  ON "pilot_campaign_enablements" TO proovd_app;--> statement-breakpoint

GRANT UPDATE ("superseded_at") ON "pilot_campaign_owners" TO proovd_app;
