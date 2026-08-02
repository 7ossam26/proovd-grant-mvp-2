-- ── Formal Affiliate decisions — Spec §14.2, §14.3, §14.6, §23.4, §25.4 ──────
--
-- The three decisions, the immutable proposal versions, the locked compensation
-- agreement, the inactive tracking link, the Creator-specific bonus, and the
-- §14.6 deadline evaluation record.
--
-- The correctness core of Phase 12 lives HERE, not in a service: two parties
-- responding concurrently to different versions must resolve to exactly one
-- locked version or none — never two (§33.2.9, §33.2.10). Three database
-- mechanisms carry that:
--
--   one open version   — a partial unique index allows at most ONE version per
--                        association in an awaiting state, so a counter must
--                        supersede before it can exist;
--   one locked version — a partial unique index allows at most ONE locked
--                        version per association, ever, by anyone;
--   legal edges only   — a trigger refuses any state change that is not
--                        awaiting → {locked, declined, superseded,
--                        expired_no_acceptance, rejected_by_admin}, so a stale
--                        acceptance of a superseded version matches nothing.

CREATE TYPE "public"."proposal_party" AS ENUM ('affiliate', 'founder');--> statement-breakpoint
-- §14.2: "A Founder revision creates a new immutable version with
-- `awaiting_creator`"; §14.6 names `expired_no_acceptance`. `rejected_by_admin`
-- is §14.2's "Admin may … reject policy-violating terms" — a rejection, never a
-- substitute for either party's acceptance (there is no admin path to 'locked').
CREATE TYPE "public"."proposal_version_state" AS ENUM (
  'awaiting_founder',
  'awaiting_creator',
  'locked',
  'declined',
  'superseded',
  'expired_no_acceptance',
  'rejected_by_admin'
);--> statement-breakpoint
-- §14.2: "Store … both decisions/times." The proposing party's decision is
-- 'proposed': authoring a version is that side's explicit agreement to its
-- exact values, recorded as what it was rather than relabeled 'accepted'.
CREATE TYPE "public"."party_decision" AS ENUM ('proposed', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."compensation_source" AS ENUM ('standard_terms', 'proposal_version');--> statement-breakpoint
-- §14.3: the two lawful trigger units. Mirrors shared `BonusTriggerUnit`.
CREATE TYPE "public"."bonus_trigger_unit" AS ENUM (
  'attributed_subtotal_cents',
  'unique_attributed_backers'
);--> statement-breakpoint
CREATE TYPE "public"."deadline_outcome" AS ENUM (
  'continues',
  'failed_zero_eligible_recruits',
  'failed_no_mutual_acceptance'
);--> statement-breakpoint

-- ── §25.4's response facts on the association ────────────────────────────────

-- "Formal activation, response, joined-at": the activation stamp (set once by
-- the payment's effect 4) and the decline record (§14.2: "Store decision time
-- and optional reason"). Acceptance times live on the agreement row.
ALTER TABLE "campaign_affiliate_associations" ADD COLUMN "formal_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_affiliate_associations" ADD COLUMN "declined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_affiliate_associations" ADD COLUMN "decline_reason" text;--> statement-breakpoint

-- ── proposal_versions (§14.2, §33.2.9, §33.2.10) ─────────────────────────────

CREATE TABLE "proposal_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"proposed_by" "proposal_party" NOT NULL,

	-- §14.2's two proposable values. The bid is the proposed TOTAL percentage
	-- (base + increase), matching shared `validateProposal`. At least one must
	-- be present — a version proposing nothing is not a proposal.
	"bid_total_percent" integer,
	"fixed_payment_request_cents" bigint,

	"state" "proposal_version_state" NOT NULL,

	-- §14.2: "Store values, proposing party, created time, both decisions/times,
	-- superseded version, and final version."
	"affiliate_decision" "party_decision",
	"affiliate_decided_at" timestamp with time zone,
	"founder_decision" "party_decision",
	"founder_decided_at" timestamp with time zone,

	"superseded_by_version_id" uuid,
	"locked_at" timestamp with time zone,

	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- DEFERRABLE for the same reason the 10b tax-configuration FK is: the one-open
-- index requires the old version to stop being open BEFORE the counter can
-- exist, so a counter retires the old row pointing at an id minted before the
-- insert, and the reference resolves at commit. The alternative was an
-- exception in the one-open index, and an exception is how two versions come
-- to be awaiting after all.
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_superseded_fk"
  FOREIGN KEY ("superseded_by_version_id") REFERENCES "public"."proposal_versions"("id") ON DELETE no action ON UPDATE no action
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

CREATE UNIQUE INDEX "proposal_versions_number_idx" ON "proposal_versions" USING btree ("association_id", "version_number");--> statement-breakpoint
CREATE INDEX "proposal_versions_campaign_idx" ON "proposal_versions" USING btree ("campaign_id", "state");--> statement-breakpoint

-- §33.2.9/§33.2.10, as indexes rather than promises: at most one version per
-- association may be awaiting a response, and at most one may ever lock.
CREATE UNIQUE INDEX "proposal_versions_one_open" ON "proposal_versions" USING btree ("association_id")
  WHERE "state" IN ('awaiting_founder', 'awaiting_creator');--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_versions_one_locked" ON "proposal_versions" USING btree ("association_id")
  WHERE "state" = 'locked';--> statement-breakpoint

ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_number_positive"
  CHECK ("version_number" >= 1);--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_values_present"
  CHECK ("bid_total_percent" IS NOT NULL OR "fixed_payment_request_cents" IS NOT NULL);--> statement-breakpoint
-- §14.3's ceiling on the proposed total, restated where no service can miss it.
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_bid_range"
  CHECK ("bid_total_percent" IS NULL OR ("bid_total_percent" > 0 AND "bid_total_percent" <= 50));--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_fixed_positive"
  CHECK ("fixed_payment_request_cents" IS NULL OR "fixed_payment_request_cents" > 0);--> statement-breakpoint
-- The proposing party's decision is 'proposed', stamped at creation.
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_proposer_decision"
  CHECK (
    ("proposed_by" = 'affiliate' AND "affiliate_decision" = 'proposed' AND "affiliate_decided_at" IS NOT NULL)
    OR ("proposed_by" = 'founder' AND "founder_decision" = 'proposed' AND "founder_decided_at" IS NOT NULL)
  );--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_decisions_timed"
  CHECK (
    (("affiliate_decision" IS NULL) = ("affiliate_decided_at" IS NULL))
    AND (("founder_decision" IS NULL) = ("founder_decided_at" IS NULL))
  );--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_locked_complete"
  CHECK (("state" = 'locked') = ("locked_at" IS NOT NULL));--> statement-breakpoint
-- §14.2: "Only the exact version explicitly accepted by both sides locks." A
-- locked row must carry the counterparty's explicit 'accepted'.
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_locked_bilateral"
  CHECK (
    "state" <> 'locked'
    OR ("proposed_by" = 'affiliate' AND "founder_decision" = 'accepted')
    OR ("proposed_by" = 'founder' AND "affiliate_decision" = 'accepted')
  );--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_superseded_complete"
  CHECK (("state" = 'superseded') = ("superseded_by_version_id" IS NOT NULL));--> statement-breakpoint

-- The insert-time rules a service could forget: the version belongs to the
-- association's own campaign, and §14.3's "fixed Creator payment is prohibited
-- on an Idea Campaign" holds even for a hand-written INSERT (§33.2.8).
CREATE OR REPLACE FUNCTION enforce_proposal_version_insert()
RETURNS trigger AS $$
DECLARE
  assoc_campaign uuid;
  ctype campaign_type;
BEGIN
  SELECT a.campaign_id, c.type INTO assoc_campaign, ctype
    FROM campaign_affiliate_associations a
    JOIN campaigns c ON c.id = a.campaign_id
    WHERE a.id = NEW.association_id;
  IF assoc_campaign IS NULL THEN
    RAISE EXCEPTION 'proposal_versions must reference an existing association';
  END IF;
  IF NEW.campaign_id IS DISTINCT FROM assoc_campaign THEN
    RAISE EXCEPTION 'proposal_versions campaign must match the association''s campaign';
  END IF;
  IF NEW.fixed_payment_request_cents IS NOT NULL AND ctype = 'pre_build' THEN
    RAISE EXCEPTION 'a fixed Creator payment is prohibited on an Idea Campaign (§14.3)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER proposal_version_insert
  BEFORE INSERT ON "proposal_versions"
  FOR EACH ROW EXECUTE FUNCTION enforce_proposal_version_insert();--> statement-breakpoint

-- Every version is immutable in its values; only its resolution may move, once,
-- along a legal edge. A terminal version never changes again, which is what
-- makes a stale or repeated response fall through to "matched nothing".
CREATE OR REPLACE FUNCTION enforce_proposal_version_transitions()
RETURNS trigger AS $$
BEGIN
  IF NEW.association_id IS DISTINCT FROM OLD.association_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by
     OR NEW.bid_total_percent IS DISTINCT FROM OLD.bid_total_percent
     OR NEW.fixed_payment_request_cents IS DISTINCT FROM OLD.fixed_payment_request_cents
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a proposal version is immutable; a revision is a NEW version (§14.2)';
  END IF;
  IF OLD.state NOT IN ('awaiting_founder', 'awaiting_creator') THEN
    IF ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
      RAISE EXCEPTION 'a resolved proposal version (%) never changes again (§14.2)', OLD.state;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state
     AND NEW.state NOT IN ('locked', 'declined', 'superseded', 'expired_no_acceptance', 'rejected_by_admin') THEN
    RAISE EXCEPTION 'illegal proposal version transition % → %', OLD.state, NEW.state;
  END IF;
  IF OLD.affiliate_decision IS NOT NULL AND NEW.affiliate_decision IS DISTINCT FROM OLD.affiliate_decision THEN
    RAISE EXCEPTION 'a recorded decision never changes (§14.2)';
  END IF;
  IF OLD.founder_decision IS NOT NULL AND NEW.founder_decision IS DISTINCT FROM OLD.founder_decision THEN
    RAISE EXCEPTION 'a recorded decision never changes (§14.2)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER proposal_version_transitions
  BEFORE UPDATE ON "proposal_versions"
  FOR EACH ROW EXECUTE FUNCTION enforce_proposal_version_transitions();--> statement-breakpoint

GRANT SELECT, INSERT ON "proposal_versions" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("state", "affiliate_decision", "affiliate_decided_at", "founder_decision", "founder_decided_at", "superseded_by_version_id", "locked_at") ON "proposal_versions" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "proposal_versions" FROM proovd_app;--> statement-breakpoint

-- ── association_compensation_agreements (§14.2: "Compensation locks") ────────

CREATE TABLE "association_compensation_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"source" "compensation_source" NOT NULL,
	"proposal_version_id" uuid,

	"base_percent" integer NOT NULL,
	"bid_increase_percent" integer DEFAULT 0 NOT NULL,
	"total_percent" integer NOT NULL,
	"fixed_payment_cents" bigint,

	-- Both sides' agreement times. Standard terms are the campaign's standing
	-- offer, so a standard acceptance carries only the Affiliate's time; a
	-- proposal-version lock carries both.
	"affiliate_accepted_at" timestamp with time zone NOT NULL,
	"founder_accepted_at" timestamp with time zone,

	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "association_compensation_agreements" ADD CONSTRAINT "compensation_agreements_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "association_compensation_agreements" ADD CONSTRAINT "compensation_agreements_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "association_compensation_agreements" ADD CONSTRAINT "compensation_agreements_version_fk"
  FOREIGN KEY ("proposal_version_id") REFERENCES "public"."proposal_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- One locked compensation per association, ever. The second backstop behind
-- the one-locked-version index: even a service that never touched
-- proposal_versions cannot record two agreements for one Creator.
CREATE UNIQUE INDEX "compensation_agreements_association_idx" ON "association_compensation_agreements" USING btree ("association_id");--> statement-breakpoint
CREATE INDEX "compensation_agreements_campaign_idx" ON "association_compensation_agreements" USING btree ("campaign_id");--> statement-breakpoint

ALTER TABLE "association_compensation_agreements" ADD CONSTRAINT "compensation_agreements_source_version"
  CHECK (("source" = 'proposal_version') = ("proposal_version_id" IS NOT NULL));--> statement-breakpoint
-- §14.3's arithmetic and ceiling: total IS base + bid, and never above 50.
ALTER TABLE "association_compensation_agreements" ADD CONSTRAINT "compensation_agreements_arithmetic"
  CHECK (
    "base_percent" > 0
    AND "bid_increase_percent" >= 0
    AND "total_percent" = "base_percent" + "bid_increase_percent"
    AND "total_percent" <= 50
  );--> statement-breakpoint
ALTER TABLE "association_compensation_agreements" ADD CONSTRAINT "compensation_agreements_fixed_positive"
  CHECK ("fixed_payment_cents" IS NULL OR "fixed_payment_cents" > 0);--> statement-breakpoint
ALTER TABLE "association_compensation_agreements" ADD CONSTRAINT "compensation_agreements_bilateral"
  CHECK ("source" = 'standard_terms' OR "founder_accepted_at" IS NOT NULL);--> statement-breakpoint

-- §14.3 again, and §33.2.10: an agreement citing a version may cite only a
-- LOCKED version of this same association, and an Idea Campaign can hold no
-- fixed payment.
CREATE OR REPLACE FUNCTION enforce_compensation_agreement_insert()
RETURNS trigger AS $$
DECLARE
  assoc_campaign uuid;
  ctype campaign_type;
  vstate proposal_version_state;
  vassoc uuid;
BEGIN
  SELECT a.campaign_id, c.type INTO assoc_campaign, ctype
    FROM campaign_affiliate_associations a
    JOIN campaigns c ON c.id = a.campaign_id
    WHERE a.id = NEW.association_id;
  IF assoc_campaign IS NULL THEN
    RAISE EXCEPTION 'association_compensation_agreements must reference an existing association';
  END IF;
  IF NEW.campaign_id IS DISTINCT FROM assoc_campaign THEN
    RAISE EXCEPTION 'agreement campaign must match the association''s campaign';
  END IF;
  IF NEW.fixed_payment_cents IS NOT NULL AND ctype = 'pre_build' THEN
    RAISE EXCEPTION 'a fixed Creator payment is prohibited on an Idea Campaign (§14.3)';
  END IF;
  IF NEW.proposal_version_id IS NOT NULL THEN
    SELECT state, association_id INTO vstate, vassoc
      FROM proposal_versions WHERE id = NEW.proposal_version_id;
    IF vstate IS DISTINCT FROM 'locked' OR vassoc IS DISTINCT FROM NEW.association_id THEN
      RAISE EXCEPTION 'an agreement may cite only a locked version of its own association (§14.2, §33.2.10)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER compensation_agreement_insert
  BEFORE INSERT ON "association_compensation_agreements"
  FOR EACH ROW EXECUTE FUNCTION enforce_compensation_agreement_insert();--> statement-breakpoint

-- "Compensation locks for the campaign" — recorded, never edited. Later terms
-- are 12b's materiality machinery: a NEW version and explicit reacceptance.
CREATE OR REPLACE FUNCTION enforce_compensation_agreement_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'a locked compensation agreement never changes; a new terms version requires explicit reacceptance (§14.2, §15)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER compensation_agreement_immutable
  BEFORE UPDATE ON "association_compensation_agreements"
  FOR EACH ROW EXECUTE FUNCTION enforce_compensation_agreement_immutable();--> statement-breakpoint

GRANT SELECT, INSERT ON "association_compensation_agreements" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "association_compensation_agreements" FROM proovd_app;--> statement-breakpoint

-- ── association_acceptance_confirmations (§14.2's four requirements) ─────────

-- The Creator-side record standard acceptance requires: compensation terms,
-- the per-campaign §31.5 agreement instance (a policy consent citing a
-- PUBLISHED version — the 0003 trigger enforces that), FTC disclosure
-- acknowledgment, and the campaign terms/AUP state accepted under. §28.4: four
-- separate facts from four separate controls, never one flag.
CREATE TABLE "association_acceptance_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"compensation_terms_confirmed_at" timestamp with time zone NOT NULL,
	"ip_agreement_consent_id" uuid NOT NULL,
	"ftc_disclosure_acknowledged_at" timestamp with time zone NOT NULL,
	"terms_aup_state" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "association_acceptance_confirmations" ADD CONSTRAINT "acceptance_confirmations_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "association_acceptance_confirmations" ADD CONSTRAINT "acceptance_confirmations_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "association_acceptance_confirmations" ADD CONSTRAINT "acceptance_confirmations_consent_fk"
  FOREIGN KEY ("ip_agreement_consent_id") REFERENCES "public"."policy_consents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- §31.5: ONE agreement instance per campaign-Affiliate association.
CREATE UNIQUE INDEX "acceptance_confirmations_association_idx" ON "association_acceptance_confirmations" USING btree ("association_id");--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_acceptance_confirmation_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'acceptance confirmations are recorded, not edited (§25.6)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER acceptance_confirmation_immutable
  BEFORE UPDATE ON "association_acceptance_confirmations"
  FOR EACH ROW EXECUTE FUNCTION enforce_acceptance_confirmation_immutable();--> statement-breakpoint

GRANT SELECT, INSERT ON "association_acceptance_confirmations" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "association_acceptance_confirmations" FROM proovd_app;--> statement-breakpoint

-- ── tracking_links (§14.2: created at acceptance, inactive) ──────────────────

CREATE TABLE "tracking_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"code" text NOT NULL,
	-- §14.2: "the link stays inactive until approval and Creator readiness."
	-- Phase 14's launch is what flips this; nothing in Phase 12 may.
	"active" boolean DEFAULT false NOT NULL,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- §14.2: "a unique tracking-link record" — one per association, and the code
-- is globally unique because attribution will resolve on it alone.
CREATE UNIQUE INDEX "tracking_links_association_idx" ON "tracking_links" USING btree ("association_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tracking_links_code_idx" ON "tracking_links" USING btree ("code");--> statement-breakpoint
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_activation_paired"
  CHECK ("active" = ("activated_at" IS NOT NULL));--> statement-breakpoint

-- The link's identity never moves. Repointing a code at another association
-- would move every past attribution with it.
CREATE OR REPLACE FUNCTION enforce_tracking_link_identity()
RETURNS trigger AS $$
BEGIN
  IF NEW.association_id IS DISTINCT FROM OLD.association_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.code IS DISTINCT FROM OLD.code
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a tracking link''s identity is immutable; only activation may change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER tracking_link_identity
  BEFORE UPDATE ON "tracking_links"
  FOR EACH ROW EXECUTE FUNCTION enforce_tracking_link_identity();--> statement-breakpoint

GRANT SELECT, INSERT ON "tracking_links" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("active", "activated_at") ON "tracking_links" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "tracking_links" FROM proovd_app;--> statement-breakpoint

-- ── creator_bonuses (§14.3, §33.2.12, §33.2.13) ──────────────────────────────

CREATE TABLE "creator_bonuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	-- §14.3's six stored facts: trigger unit, threshold, additional percentage,
	-- maximum combined percentage, proposal version, earned result.
	"trigger_unit" "bonus_trigger_unit" NOT NULL,
	"threshold" bigint NOT NULL,
	"additional_percent" integer NOT NULL,
	"max_combined_percent" integer NOT NULL,
	"proposal_version_id" uuid,
	"earned_measured_value" bigint,
	"earned_percent" integer,
	"earned_recorded_at" timestamp with time zone,
	"offered_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creator_bonuses" ADD CONSTRAINT "creator_bonuses_association_fk"
  FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_bonuses" ADD CONSTRAINT "creator_bonuses_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_bonuses" ADD CONSTRAINT "creator_bonuses_version_fk"
  FOREIGN KEY ("proposal_version_id") REFERENCES "public"."proposal_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- One offered bonus per Creator per campaign. §14.3 speaks of "the" bonus for
-- a Creator; a second concurrent bonus scheme is nowhere stated (§1 rule 6).
CREATE UNIQUE INDEX "creator_bonuses_association_idx" ON "creator_bonuses" USING btree ("association_id");--> statement-breakpoint
CREATE INDEX "creator_bonuses_campaign_idx" ON "creator_bonuses" USING btree ("campaign_id");--> statement-breakpoint

-- §14.3/§6: the ceiling, at the row. The service also validates base + bid +
-- bonus against the agreement; this pins what no service can move.
ALTER TABLE "creator_bonuses" ADD CONSTRAINT "creator_bonuses_percents"
  CHECK (
    "threshold" >= 0
    AND "additional_percent" > 0
    AND "additional_percent" <= 50
    AND "max_combined_percent" >= "additional_percent"
    AND "max_combined_percent" <= 50
  );--> statement-breakpoint
ALTER TABLE "creator_bonuses" ADD CONSTRAINT "creator_bonuses_earned_complete"
  CHECK (
    (("earned_recorded_at" IS NULL) = ("earned_percent" IS NULL))
    AND ("earned_measured_value" IS NULL OR "earned_recorded_at" IS NOT NULL)
  );--> statement-breakpoint

-- The offer is immutable; only the earned result may be recorded, once.
CREATE OR REPLACE FUNCTION enforce_creator_bonus_immutable()
RETURNS trigger AS $$
BEGIN
  IF NEW.association_id IS DISTINCT FROM OLD.association_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.trigger_unit IS DISTINCT FROM OLD.trigger_unit
     OR NEW.threshold IS DISTINCT FROM OLD.threshold
     OR NEW.additional_percent IS DISTINCT FROM OLD.additional_percent
     OR NEW.max_combined_percent IS DISTINCT FROM OLD.max_combined_percent
     OR NEW.proposal_version_id IS DISTINCT FROM OLD.proposal_version_id
     OR NEW.offered_by IS DISTINCT FROM OLD.offered_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a Creator-specific bonus offer is immutable; a change is a new terms version (§14.3, §15)';
  END IF;
  IF OLD.earned_recorded_at IS NOT NULL
     AND (NEW.earned_measured_value IS DISTINCT FROM OLD.earned_measured_value
          OR NEW.earned_percent IS DISTINCT FROM OLD.earned_percent
          OR NEW.earned_recorded_at IS DISTINCT FROM OLD.earned_recorded_at) THEN
    RAISE EXCEPTION 'an earned bonus result is recorded once (§14.3)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER creator_bonus_immutable
  BEFORE UPDATE ON "creator_bonuses"
  FOR EACH ROW EXECUTE FUNCTION enforce_creator_bonus_immutable();--> statement-breakpoint

GRANT SELECT, INSERT ON "creator_bonuses" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("earned_measured_value", "earned_percent", "earned_recorded_at") ON "creator_bonuses" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "creator_bonuses" FROM proovd_app;--> statement-breakpoint

-- ── response_deadline_evaluations (§14.6, §33.2.11, §33.3.8) ─────────────────

CREATE TABLE "response_deadline_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	-- The stored deadline that fired — §29.6: never recomputed at evaluation.
	"deadline_at" timestamp with time zone NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" "deadline_outcome" NOT NULL,
	"locked_acceptance_count" integer NOT NULL,
	"expired_association_count" integer NOT NULL,
	"refund_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "response_deadline_evaluations" ADD CONSTRAINT "deadline_evaluations_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_deadline_evaluations" ADD CONSTRAINT "deadline_evaluations_refund_fk"
  FOREIGN KEY ("refund_id") REFERENCES "public"."listing_fee_refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The deadline is evaluated exactly once (§33.2.5's other half): the unique
-- index is the pivot, beside the idempotency key the evaluation claims.
CREATE UNIQUE INDEX "deadline_evaluations_campaign_idx" ON "response_deadline_evaluations" USING btree ("campaign_id");--> statement-breakpoint
ALTER TABLE "response_deadline_evaluations" ADD CONSTRAINT "deadline_evaluations_outcome_counts"
  CHECK (
    "locked_acceptance_count" >= 0
    AND "expired_association_count" >= 0
    AND (("outcome" = 'continues') = ("locked_acceptance_count" > 0))
  );--> statement-breakpoint

-- The evaluation is recorded once; only the refund it produced may be linked
-- afterwards, because the refund is confirmed outside the transaction.
CREATE OR REPLACE FUNCTION enforce_deadline_evaluation_immutable()
RETURNS trigger AS $$
BEGIN
  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.deadline_at IS DISTINCT FROM OLD.deadline_at
     OR NEW.evaluated_at IS DISTINCT FROM OLD.evaluated_at
     OR NEW.outcome IS DISTINCT FROM OLD.outcome
     OR NEW.locked_acceptance_count IS DISTINCT FROM OLD.locked_acceptance_count
     OR NEW.expired_association_count IS DISTINCT FROM OLD.expired_association_count
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a deadline evaluation is recorded, not edited; only its refund link may be filled in';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER deadline_evaluation_immutable
  BEFORE UPDATE ON "response_deadline_evaluations"
  FOR EACH ROW EXECUTE FUNCTION enforce_deadline_evaluation_immutable();--> statement-breakpoint

GRANT SELECT, INSERT ON "response_deadline_evaluations" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("refund_id") ON "response_deadline_evaluations" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "response_deadline_evaluations" FROM proovd_app;
