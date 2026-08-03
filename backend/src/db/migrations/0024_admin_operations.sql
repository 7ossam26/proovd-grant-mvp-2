-- ── Admin operations: the ledger's stored facts, the risk gate, and the ──────
-- ── high-impact action contract ──────────────────────────────────────────────
--
-- Phase 16a (§26.5, §26.6, §31.7, §25.6, §25.7, §33.12.4). The §26.5 ledger and
-- the §26.6 money controls are almost entirely *reads* over columns Phases 03,
-- 11, 13, 14, and 15 already wrote — the brief's instruction is to build the
-- surfaces against those columns "so those phases fill rows rather than
-- inventing views". So this migration adds only what has nowhere else to live:
--
--   `campaign_seller_tax_readiness`  §31.7's closing paragraph — four recorded
--                                    facts that gate live tax collection. All
--                                    four or the campaign is not ready.
--   `high_impact_action_previews`    §26.6's "preview of customer-visible
--                                    consequences", made enforceable: the
--                                    preview is issued before the action, frozen
--                                    with the exact payload it describes, and
--                                    consumed by the execution that cites it.
--   `admin_overrides`                §33.12.4's five facts as NOT NULL columns.
--
-- Schema instructions that carry through:
--   §33.12.4 — an override preserves before, after, reason, actor, and time. A
--              NULL prior value is not an override, it is a write with a story
--              attached, so the column is NOT NULL and the service reads the
--              current value itself rather than trusting a supplied one.
--   §25.6    — internal reason and customer-facing explanation are SEPARATE
--              columns. §33.9.11's rule (no raw provider code in customer copy)
--              is enforced in the service, because a regex in a CHECK would be a
--              second copy of a pattern list that must not drift.
--   §26.5    — the cap result is a stored fact on the reservation. It is decided
--              at pre-order against the capacity row and cannot be recomputed
--              later: the cap in force then is not the cap in force now.
--   §1.4     — a reservation that never reached the cap check is `not_evaluated`,
--              never `within_cap`. Absence of a refusal is not a pass.

-- ── §26.5's stored cap result (§2.2) ────────────────────────────────────────
-- Phase 15 enforces the cap with a CHECK and a conditional UPDATE; what it did
-- not do was *record the answer* on the transaction, and §26.5 filters by it.
-- Nullable rather than defaulted, then backfilled: a reservation that already
-- exists was admitted by the Phase 15 gate, so `within_cap` is the true answer
-- for it, while every future row states its own result explicitly.
ALTER TABLE "reservations" ADD COLUMN "cap_result" text;--> statement-breakpoint

UPDATE "reservations" SET "cap_result" = 'within_cap' WHERE "cap_result" IS NULL;--> statement-breakpoint

ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_cap_result_known" CHECK (
    "cap_result" IS NULL
    OR "cap_result" IN ('within_cap', 'rejected_cap_exceeded', 'not_evaluated')
  );--> statement-breakpoint

-- ── campaign_seller_tax_readiness (§31.7) ───────────────────────────────────
-- "Founder seller tax readiness requires head-office location, applicable
-- product tax code, registration, and active provider tax settings before live
-- tax collection."
--
-- Four booleans rather than one — §31.7 names four separate facts, and one
-- combined flag would let three-quarters of the work read as done. Each carries
-- the evidence for itself, because a recorded readiness with no evidence is the
-- §1.3 failure: manual work is valid only when the app records it.
--
-- Superseded rather than edited, on the 10b tax-configuration precedent: a
-- readiness record is the basis on which live tax was collected, so it is
-- history the moment anything relies on it. The partial unique index allows one
-- live record per campaign and the immutability trigger refuses to touch a
-- superseded one.
CREATE TABLE "campaign_seller_tax_readiness" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,

	"head_office_location_recorded" boolean DEFAULT false NOT NULL,
	"head_office_location_detail" text,
	"product_tax_code_recorded" boolean DEFAULT false NOT NULL,
	"product_tax_code_detail" text,
	"registration_recorded" boolean DEFAULT false NOT NULL,
	"registration_detail" text,
	"provider_tax_settings_recorded" boolean DEFAULT false NOT NULL,
	"provider_tax_settings_detail" text,

	-- §34's "recorded as complete": a named person and where the evidence lives.
	"recorded_by" text NOT NULL,
	"evidence_reference" text NOT NULL,

	-- Mode is part of the record's identity: a test-mode readiness never makes a
	-- live campaign ready (§32.2, the `provider_objects` posture).
	"mode" text NOT NULL,

	"superseded_at" timestamp with time zone,
	"superseded_by_id" uuid,

	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "campaign_seller_tax_readiness"
  ADD CONSTRAINT "campaign_seller_tax_readiness_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id");--> statement-breakpoint

-- DEFERRABLE for the same reason 10b's tax configuration and 12a's proposal
-- versions are: supersession retires the old row and points it at a successor
-- minted in the same statement, and the one-live index requires the retirement
-- to land first. The alternative is an exception in the immutability trigger,
-- and an exception is how a superseded record becomes editable after all.
ALTER TABLE "campaign_seller_tax_readiness"
  ADD CONSTRAINT "campaign_seller_tax_readiness_superseded_fk"
  FOREIGN KEY ("superseded_by_id") REFERENCES "campaign_seller_tax_readiness"("id")
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

ALTER TABLE "campaign_seller_tax_readiness"
  ADD CONSTRAINT "campaign_seller_tax_readiness_mode_known"
  CHECK ("mode" IN ('test', 'live'));--> statement-breakpoint

ALTER TABLE "campaign_seller_tax_readiness"
  ADD CONSTRAINT "campaign_seller_tax_readiness_recorded_by_present"
  CHECK (btrim("recorded_by") <> '');--> statement-breakpoint

ALTER TABLE "campaign_seller_tax_readiness"
  ADD CONSTRAINT "campaign_seller_tax_readiness_evidence_present"
  CHECK (btrim("evidence_reference") <> '');--> statement-breakpoint

-- A recorded fact carries its detail. A `true` with no detail is a checkbox, and
-- §31.7 asks for the location, the code, and the registration themselves.
ALTER TABLE "campaign_seller_tax_readiness"
  ADD CONSTRAINT "campaign_seller_tax_readiness_details_accompany_facts" CHECK (
    (NOT "head_office_location_recorded" OR btrim(coalesce("head_office_location_detail", '')) <> '')
    AND (NOT "product_tax_code_recorded" OR btrim(coalesce("product_tax_code_detail", '')) <> '')
    AND (NOT "registration_recorded" OR btrim(coalesce("registration_detail", '')) <> '')
    AND (NOT "provider_tax_settings_recorded" OR btrim(coalesce("provider_tax_settings_detail", '')) <> '')
  );--> statement-breakpoint

CREATE UNIQUE INDEX "campaign_seller_tax_readiness_live_idx"
  ON "campaign_seller_tax_readiness" ("campaign_id", "mode")
  WHERE "superseded_at" IS NULL;--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_seller_tax_readiness_immutability()
RETURNS trigger AS $$
BEGIN
  -- Retiring a live record is the one permitted update, and only in one
  -- direction: it may be superseded once and never un-superseded.
  IF OLD.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'seller tax readiness is superseded and cannot be changed (§31.7)';
  END IF;

  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.mode IS DISTINCT FROM OLD.mode
     OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
     OR NEW.evidence_reference IS DISTINCT FROM OLD.evidence_reference
     OR NEW.head_office_location_recorded IS DISTINCT FROM OLD.head_office_location_recorded
     OR NEW.product_tax_code_recorded IS DISTINCT FROM OLD.product_tax_code_recorded
     OR NEW.registration_recorded IS DISTINCT FROM OLD.registration_recorded
     OR NEW.provider_tax_settings_recorded IS DISTINCT FROM OLD.provider_tax_settings_recorded
  THEN
    RAISE EXCEPTION 'seller tax readiness is recorded, not edited — supersede it instead (§31.7)';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER seller_tax_readiness_immutability
  BEFORE UPDATE ON "campaign_seller_tax_readiness"
  FOR EACH ROW EXECUTE FUNCTION enforce_seller_tax_readiness_immutability();--> statement-breakpoint

-- ── high_impact_action_previews (§26.6) ─────────────────────────────────────
-- "High-impact actions require recent reauthentication, preview of
-- customer-visible consequences, idempotency, and immutable audit."
--
-- Reauthentication is a guard, idempotency is a key, audit is a row — all three
-- had somewhere to live already. The *preview* did not, and a preview that is
-- merely rendered is a preview nothing enforces: the next caller posts straight
-- to the execute route and the requirement evaporates.
--
-- So the preview is a record. It is computed server-side for an exact payload,
-- frozen with a hash of that payload, and the execution must cite it. If the
-- payload changed after the preview was shown, the hash does not match and the
-- action refuses — which is the whole point, because the consequences an Admin
-- read were the consequences of the *old* payload.
CREATE TABLE "high_impact_action_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

	"action_key" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,

	-- The customer-visible consequences, as the lines the Admin actually read.
	"consequences" jsonb NOT NULL,
	-- Hash over the exact action payload these consequences describe.
	"payload_hash" text NOT NULL,

	"issued_by" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,

	-- Consumption is the one granted UPDATE, and it is one-way (trigger below).
	"consumed_at" timestamp with time zone,
	"consumed_by" text,

	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "high_impact_action_previews"
  ADD CONSTRAINT "high_impact_previews_consequences_present"
  CHECK (jsonb_array_length("consequences") > 0);--> statement-breakpoint

-- A preview with no expiry would let an Admin read consequences in the morning
-- and execute against a different world in the afternoon.
ALTER TABLE "high_impact_action_previews"
  ADD CONSTRAINT "high_impact_previews_expires_after_issue"
  CHECK ("expires_at" > "issued_at");--> statement-breakpoint

ALTER TABLE "high_impact_action_previews"
  ADD CONSTRAINT "high_impact_previews_consumption_complete"
  CHECK (("consumed_at" IS NULL) = ("consumed_by" IS NULL));--> statement-breakpoint

CREATE INDEX "high_impact_previews_target_idx"
  ON "high_impact_action_previews" ("target_type", "target_id", "issued_at");--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_high_impact_preview_immutability()
RETURNS trigger AS $$
BEGIN
  IF NEW.action_key IS DISTINCT FROM OLD.action_key
     OR NEW.target_type IS DISTINCT FROM OLD.target_type
     OR NEW.target_id IS DISTINCT FROM OLD.target_id
     OR NEW.consequences IS DISTINCT FROM OLD.consequences
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.issued_by IS DISTINCT FROM OLD.issued_by
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
  THEN
    RAISE EXCEPTION 'a high-impact preview is frozen once issued (§26.6)';
  END IF;

  -- Consumed exactly once: a preview that could be re-consumed is a preview that
  -- authorizes a second execution of the same money movement (§28.3).
  IF OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at THEN
    RAISE EXCEPTION 'a high-impact preview is consumed once (§26.6, §28.3)';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER high_impact_preview_immutability
  BEFORE UPDATE ON "high_impact_action_previews"
  FOR EACH ROW EXECUTE FUNCTION enforce_high_impact_preview_immutability();--> statement-breakpoint

-- ── admin_overrides (§33.12.4, §25.6, §26.2) ────────────────────────────────
-- §33.12.4's five facts as five NOT NULL columns.
--
-- This is not a second audit log. `audit_events` remains the §25.6 record and
-- every override writes one in the same transaction; this table is the *decision*
-- — what was overridden, from what to what, under which preview, by whom — and it
-- exists because §26.2 draws a line the audit log cannot express: "Admin adds
-- only review/decision/evidence/override data." An override is a distinct kind
-- of Admin act, and being able to list every one of them for a campaign without
-- filtering a general event stream by action name is the difference between a
-- reviewable record and a grep.
--
-- Insert-only. An override that could be edited would let the "before" be
-- rewritten after the fact, which is precisely the value §33.12.4 protects.
CREATE TABLE "admin_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

	-- The registered field key (shared OVERRIDABLE_FIELDS). Free text here would
	-- admit an override of something that does not exist.
	"field_key" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,

	-- §33.12.4's five. `prior_value` is NOT NULL because an override with no
	-- before is unauditable — the phase trap's exact words.
	"prior_value" jsonb NOT NULL,
	"new_value" jsonb NOT NULL,
	"internal_reason" text NOT NULL,
	"actor" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,

	-- §25.6 keeps the customer-facing explanation in its own column so internal
	-- vocabulary never doubles as customer copy (§3.1, §33.9.11).
	"customer_explanation" text NOT NULL,

	-- §25.6's security context, established by the guards that let this through.
	"mfa_context" text NOT NULL,
	"reauth_context" text NOT NULL,

	-- §26.6: the preview the Admin read before executing. NOT NULL — an override
	-- executed without one is the requirement not being enforced.
	"preview_id" uuid NOT NULL,

	-- §28.3: the domain key that makes a retry the same override, not a second.
	"idempotency_key" text NOT NULL,

	"evidence_links" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "admin_overrides"
  ADD CONSTRAINT "admin_overrides_preview_fk"
  FOREIGN KEY ("preview_id") REFERENCES "high_impact_action_previews"("id");--> statement-breakpoint

ALTER TABLE "admin_overrides"
  ADD CONSTRAINT "admin_overrides_reason_present"
  CHECK (btrim("internal_reason") <> '');--> statement-breakpoint

ALTER TABLE "admin_overrides"
  ADD CONSTRAINT "admin_overrides_explanation_present"
  CHECK (btrim("customer_explanation") <> '');--> statement-breakpoint

-- The before and the after must actually differ. Recording an "override" that
-- changed nothing would put a decision in the record where none was taken.
ALTER TABLE "admin_overrides"
  ADD CONSTRAINT "admin_overrides_value_changed"
  CHECK ("prior_value" IS DISTINCT FROM "new_value");--> statement-breakpoint

CREATE UNIQUE INDEX "admin_overrides_idempotency_idx"
  ON "admin_overrides" ("idempotency_key");--> statement-breakpoint

CREATE INDEX "admin_overrides_target_idx"
  ON "admin_overrides" ("target_type", "target_id", "occurred_at");--> statement-breakpoint

-- One preview authorizes one override (§28.3). The unique index is the second
-- mechanism behind the trigger's one-way consumption: even if a caller held two
-- concurrent executions citing the same preview, only one row can exist.
CREATE UNIQUE INDEX "admin_overrides_preview_idx"
  ON "admin_overrides" ("preview_id");--> statement-breakpoint

-- ── Grants ─────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON "campaign_seller_tax_readiness" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "campaign_seller_tax_readiness" FROM proovd_app;--> statement-breakpoint

-- INSERT and a narrow UPDATE: the preview is frozen by trigger, and consumption
-- is the only column the application may move.
GRANT SELECT, INSERT ON "high_impact_action_previews" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("consumed_at", "consumed_by") ON "high_impact_action_previews" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "high_impact_action_previews" FROM proovd_app;--> statement-breakpoint

-- Insert-only, like `audit_events`. §33.12.4's "before" is only trustworthy if
-- nothing can rewrite it afterwards, so this is enforced at the database rather
-- than by the service that writes it.
GRANT SELECT, INSERT ON "admin_overrides" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "admin_overrides" FROM proovd_app;
