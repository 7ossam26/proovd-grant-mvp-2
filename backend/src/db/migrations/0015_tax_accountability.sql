-- ── The tax-accountability gate — Spec §11, §24.1, §34 ─────────────────────
--
-- §11: "Connected-account records do not alone decide who must issue US tax
-- forms. Before any live Affiliate payment, the approved tax/accounting
-- configuration must record payer, 1099 filing responsibility, required tax
-- data/form, thresholds, corrections, and reconciliation responsibilities
-- without duplicating sensitive provider-held data."
--
-- Seven facts, seven columns, and a gate that reads them. It blocks Phase 19's
-- Transfers, which is why it is built now rather than then: a gate written in
-- the phase it is meant to stop is a gate written under deadline by someone who
-- wants it open.
--
-- ── Why this is a record and not a boolean ─────────────────────────────────
-- §1.3: manual work is valid only when the app records it, and §34 asks for
-- conditions "recorded as complete" rather than asserted. A single
-- `tax_configured` flag would satisfy a query and answer none of §11's seven
-- questions — and the person who set it would be unfindable.
--
-- ── "Without duplicating sensitive provider-held data" ─────────────────────
-- Stripe holds the TIN, the W-9 itself, and the individual's details. This
-- table holds WHO IS RESPONSIBLE for each of those things. There is no column
-- here that could take a tax identification number, and a CHECK refuses one
-- that looks like a US TIN in any of the free-text fields — the fields exist to
-- name a party and a process, and a value shaped like an SSN or EIN in one of
-- them is a paste, not an answer.

CREATE TABLE "tax_accountability_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

	-- §11: "payer". Which entity is the payer of record for Creator payments.
	"payer" text NOT NULL,
	-- §11: "1099 filing responsibility". Who files, not whether one is due.
	"filing_responsibility" text NOT NULL,
	-- §11: "required tax data/form". Which form, and what has to be collected
	-- before a payment — named, not stored.
	"required_form" text NOT NULL,
	"required_data" text NOT NULL,
	-- §11: "thresholds". The reporting threshold this configuration operates
	-- under, stated by the operator rather than assumed by the code (§1 rule 6).
	"thresholds" text NOT NULL,
	-- §11: "corrections".
	"corrections_process" text NOT NULL,
	-- §11: "reconciliation responsibilities".
	"reconciliation_responsibility" text NOT NULL,

	-- §34's own words: "recorded as complete". A named person, a time, and
	-- where the approval lives.
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evidence_reference" text NOT NULL,

	-- The mode this configuration was approved for. A test-mode configuration
	-- must never satisfy the gate for live payments (§34).
	"mode" "stripe_mode" NOT NULL,

	-- Retired rather than deleted: §25.6's insert-only instinct applied to a
	-- record §34 reads. A superseded configuration explains what was in force
	-- when an earlier payment went out.
	"superseded_at" timestamp with time zone,
	"superseded_by" uuid,

	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- DEFERRABLE, and that is load-bearing. The partial unique index below allows
-- one live configuration per mode, so recording a replacement has to retire the
-- old row BEFORE inserting the new one — and the immutability trigger refuses
-- any later write to a row that is already superseded. That leaves exactly one
-- shape: retire and point at the successor in a single statement, using an id
-- minted before the insert. A deferred constraint is what lets that statement
-- reference a row that arrives moments later in the same transaction. The
-- alternative would be an exception in the immutability trigger, and an
-- exception is how a superseded record becomes editable after all.
ALTER TABLE "tax_accountability_config" ADD CONSTRAINT "tax_accountability_superseded_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."tax_accountability_config"("id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

-- One live configuration per mode. Two would make "which one is in force"
-- a question, and §34 reads this to decide whether money may move.
CREATE UNIQUE INDEX "tax_accountability_live_idx" ON "tax_accountability_config" USING btree ("mode")
  WHERE "superseded_at" IS NULL;--> statement-breakpoint

-- No answer is blank. §11 names seven facts and a record with an empty one
-- answers six.
ALTER TABLE "tax_accountability_config" ADD CONSTRAINT "tax_accountability_complete"
  CHECK (
    length(btrim("payer")) > 0
    AND length(btrim("filing_responsibility")) > 0
    AND length(btrim("required_form")) > 0
    AND length(btrim("required_data")) > 0
    AND length(btrim("thresholds")) > 0
    AND length(btrim("corrections_process")) > 0
    AND length(btrim("reconciliation_responsibility")) > 0
    AND length(btrim("approved_by")) > 0
    AND length(btrim("evidence_reference")) > 0
  );--> statement-breakpoint

-- §11: "without duplicating sensitive provider-held data." These fields name a
-- party and a process. A value shaped like a US taxpayer identification number
-- in one of them is a paste, not an answer — and the paste is the failure this
-- sentence exists to prevent.
ALTER TABLE "tax_accountability_config" ADD CONSTRAINT "tax_accountability_no_tin"
  CHECK (
    "payer" !~ '\m[0-9]{3}-[0-9]{2}-[0-9]{4}\M'
    AND "filing_responsibility" !~ '\m[0-9]{3}-[0-9]{2}-[0-9]{4}\M'
    AND "required_data" !~ '\m[0-9]{3}-[0-9]{2}-[0-9]{4}\M'
    AND "required_data" !~ '\m[0-9]{2}-[0-9]{7}\M'
    AND "thresholds" !~ '\m[0-9]{3}-[0-9]{2}-[0-9]{4}\M'
    AND "reconciliation_responsibility" !~ '\m[0-9]{3}-[0-9]{2}-[0-9]{4}\M'
  );--> statement-breakpoint

-- A superseded row stays exactly as it was. It is the explanation of what was
-- in force when an earlier payment went out, and one a later statement could
-- edit explains nothing.
CREATE OR REPLACE FUNCTION enforce_tax_accountability_immutable()
RETURNS trigger AS $$
BEGIN
  IF OLD.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'tax_accountability_config is superseded and cannot be changed';
  END IF;
  IF NEW.payer IS DISTINCT FROM OLD.payer
     OR NEW.filing_responsibility IS DISTINCT FROM OLD.filing_responsibility
     OR NEW.required_form IS DISTINCT FROM OLD.required_form
     OR NEW.required_data IS DISTINCT FROM OLD.required_data
     OR NEW.thresholds IS DISTINCT FROM OLD.thresholds
     OR NEW.corrections_process IS DISTINCT FROM OLD.corrections_process
     OR NEW.reconciliation_responsibility IS DISTINCT FROM OLD.reconciliation_responsibility
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.mode IS DISTINCT FROM OLD.mode THEN
    RAISE EXCEPTION 'tax_accountability_config is recorded, not edited: supersede it with a new row';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER tax_accountability_immutable
  BEFORE UPDATE ON "tax_accountability_config"
  FOR EACH ROW EXECUTE FUNCTION enforce_tax_accountability_immutable();--> statement-breakpoint

GRANT SELECT, INSERT ON "tax_accountability_config" TO proovd_app;--> statement-breakpoint
-- Only the two supersession columns. Everything else is recorded, not edited.
GRANT UPDATE ("superseded_at", "superseded_by") ON "tax_accountability_config" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "tax_accountability_config" FROM proovd_app;
