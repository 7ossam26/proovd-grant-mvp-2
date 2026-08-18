-- Founder Flow v2, Session A — a post-Phase-24 change, 2026-08-18.
-- Spec §1.3, §9, §10, §14.2, §14.3, §16, §25.6, §25.8, §30.
--
-- This migration is deliberately small, and the reason it is small is the
-- finding: the twenty-six screens the supplied reference draws are almost
-- entirely a RE-PRESENTATION of records that already exist. Four of the flow's
-- changes are reversions to §9 and §10 as written, and a reversion needs no
-- schema at all — the columns the 2026-08-10 simplification stopped writing
-- were never dropped.
--
-- So there are exactly two things here: one new record family that genuinely
-- does not exist, and one trigger that has become wrong.
--
-- What is deliberately ABSENT, and why:
--
--   * Nothing for Competition, the campaign path, or `views_range`. Every
--     column exists — `competition_text`, `competition_supplier` and its
--     `founder`-pinned CHECK, `selected_type`, `type_chosen_at`, `views_range`
--     and its CHECK — because 0042 removed questions, not storage.
--   * `0042`'s completeness CHECK is NOT tightened. It admits two shapes,
--     competition-answered or views-answered, and it must keep admitting both:
--     requiring competition would validate against existing rows on ALTER
--     TABLE and fail on every legacy views-only submission. Competition is
--     required in the SERVICE, where a refusal is a sentence a Founder reads
--     rather than a constraint name.
--   * No `answers` table merging §9's three answers with §12's five optional
--     items. The reference presents all eight as one sequence; the registers
--     stay two, because §12 completion is DERIVED from objective evidence and
--     a single answers table would quietly make it a Founder assertion.
--   * No voice-adjective table. `campaign_build.brand_voice` is a §14.4-required
--     text column that already means exactly this, and the reference's chips
--     serialize into it losslessly. A repeater beside it would make §14.4's
--     required field and the Founder's chips two answers to one question.
--   * No column for the six-digit verification code. It rides `secure_tokens`
--     with a new scope, and that lands with its screens (Session C) — never
--     before them, because a code screen built first grows a client-side "is
--     this right" check, which is the enumeration oracle the frozen rejection
--     exists to prevent.
--   * No cap column for rewards or voice words. §14.4 caps neither, and a cap
--     is a commercial rule (§1 rule 6). The reference's three-card pager is a
--     layout.
--   * No schedule-shaped column and no job reads anything below (§30).
--   * No `phone_verified`, anywhere. §33.1.8 scans for one; `user.phone_verified`
--     is CHECK-pinned false in 0002 and stays that way.
--
-- ═══ 1. The Founder's fixed-payment openness (§14.2, §14.3, §16) ════════════
--
-- **A recorded deviation from §1 rule 6, by explicit product direction.**
--
-- §16: the optional fixed Creator payment "exists only for a Product Campaign,
-- is requested by the Creator, accepted by both parties through one proposal
-- version, and is not the default model." A Founder picking a pay model during
-- onboarding — before the listing fee is paid, before any Creator exists — has
-- no place in §14.2's bilateral, versioned negotiation.
--
-- So the record BINDS NOTHING, and that is enforced by what it cannot hold:
--
--   * **No amount column.** A number here would be the proposal §14.2 says only
--     a Creator may make. The reference's own copy already concedes the point
--     ("A proovd representative will get in touch with you to lock down the
--     fixed Creator payment"), which is §1.3's manual-but-recorded path.
--   * **No percentage column.** §14.3's matrix is three §6 settings; a rate
--     typed on an onboarding screen would be a fourth answer to the same
--     question.
--   * **No proposal-version reference.** This is not a version, does not create
--     one, and is not an input to one.
--   * **A CHECK refusing an Idea campaign.** §14.3 prohibits the fixed payment
--     there outright, so an openness record for one is UNREPRESENTABLE rather
--     than merely unused — the 0017/0019 arrangement, which already refuses the
--     same thing at the version, the agreement, and the allocation.
--
-- It is read by Admin when recruiting, and by nothing else. A later phase asked
-- to read it as a default, a filter, or an eligibility condition is asking for
-- the §1 rule 6 violation the missing columns exist to prevent.
--
-- Insert-only and superseded rather than edited, on the 0016/0025 precedent: an
-- answer a Founder changed their mind about is two facts, not one edited fact,
-- and which one was live when a Creator was approached is a question somebody
-- may have to answer.
CREATE TABLE "founder_fixed_payment_openness" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE RESTRICT,
  -- Three answers and no fourth. `open` and `not_open` are the Founder's own
  -- statement; `undecided` is a recorded "I do not know yet", which is a
  -- different fact from never having been asked (§1.4) and is why the flow can
  -- offer a way past the screen without inventing a default.
  "stance" text NOT NULL,
  -- The campaign type this was answered AGAINST, stored rather than re-read.
  -- A stance recorded on a Product campaign is a stance about a Product
  -- campaign; the type is immutable after the lock, so this can never drift —
  -- but storing it is what makes the CHECK below decidable at INSERT time.
  "campaign_type" text NOT NULL,
  "recorded_by" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "superseded_at" timestamp with time zone,
  CONSTRAINT "founder_openness_stance_known" CHECK (
    "stance" IN ('open','not_open','undecided')
  ),
  -- §14.3, at the level a service cannot forget and a support script cannot
  -- bypass. `pre_build` is the Idea Campaign.
  CONSTRAINT "founder_openness_product_only" CHECK ("campaign_type" = 'pre_launch')
);--> statement-breakpoint

-- One LIVE answer per campaign. A second is refused by the database rather than
-- by a service that counted first; superseding is what makes room for it.
CREATE UNIQUE INDEX "founder_openness_one_live_idx"
  ON "founder_fixed_payment_openness" ("campaign_id")
  WHERE "superseded_at" IS NULL;--> statement-breakpoint

-- The stored type must be the campaign's own. Without this, the product-only
-- CHECK above is satisfiable by writing 'pre_launch' onto an Idea campaign's
-- row — the constraint would read as enforcement and enforce nothing.
CREATE OR REPLACE FUNCTION enforce_founder_openness_shape() RETURNS trigger AS $fn$
DECLARE
  actual text;
BEGIN
  SELECT "type"::text INTO actual FROM "campaigns" WHERE "id" = NEW."campaign_id";
  IF actual IS NULL THEN
    -- §9 locks the type at submission. Before that there is no answer to be
    -- open about, and a stance recorded against an unlocked type could later
    -- find itself attached to an Idea campaign.
    RAISE EXCEPTION 'campaign type is not locked yet; there is nothing to be open about'
      USING ERRCODE = '23514';
  END IF;
  IF actual <> NEW."campaign_type" THEN
    RAISE EXCEPTION 'openness records the campaign type it was answered against (% <> %)',
      NEW."campaign_type", actual USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "founder_openness_shape"
  BEFORE INSERT ON "founder_fixed_payment_openness"
  FOR EACH ROW EXECUTE FUNCTION enforce_founder_openness_shape();--> statement-breakpoint

-- Insert-only apart from the retirement. Everything a later reader would want
-- to trust — what was answered, by whom, when — is outside every grant.
CREATE OR REPLACE FUNCTION enforce_founder_openness_immutability() RETURNS trigger AS $fn$
BEGIN
  IF NEW."campaign_id"   IS DISTINCT FROM OLD."campaign_id"
  OR NEW."stance"        IS DISTINCT FROM OLD."stance"
  OR NEW."campaign_type" IS DISTINCT FROM OLD."campaign_type"
  OR NEW."recorded_by"   IS DISTINCT FROM OLD."recorded_by"
  OR NEW."recorded_at"   IS DISTINCT FROM OLD."recorded_at"
  THEN
    RAISE EXCEPTION 'a recorded openness answer is immutable; record a new one instead'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."superseded_at" IS NOT NULL AND NEW."superseded_at" IS DISTINCT FROM OLD."superseded_at" THEN
    RAISE EXCEPTION 'this answer has already been superseded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "founder_openness_immutable"
  BEFORE UPDATE ON "founder_fixed_payment_openness"
  FOR EACH ROW EXECUTE FUNCTION enforce_founder_openness_immutability();--> statement-breakpoint

GRANT SELECT, INSERT ON "founder_fixed_payment_openness" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("superseded_at") ON "founder_fixed_payment_openness" TO proovd_app;--> statement-breakpoint

-- ═══ 2. The campaign path has two suppliers again (§9, §25.6) ═══════════════
--
-- 0042 hard-coded `'proovd'` as the supplier of every `selected_type` change,
-- and while Admin was the only writer that was the honest answer. §9 step 1 is
-- the Founder's again from 2026-08-18: Admin may set a path from discovery and
-- the Founder's screen arrives pre-selected from it, but the Founder's own
-- answer supersedes — and a history row claiming Proovd chose it would be a
-- provenance record that is simply untrue.
--
-- The supplier is DERIVED from the actor rather than from a new column, for the
-- reason `applyProvenance` gives about Problem and Solution: a request that
-- could declare its own supplier could declare a flattering one. `updated_by`
-- is `draft:<draftId>` for everything a draft-token holder does (there is no
-- account yet, so that is the honest actor) and an Admin user id otherwise, so
-- who wrote it is already recorded and needs no second field to disagree with.
--
-- Restated whole because CREATE OR REPLACE replaces whole. Every other branch
-- is 0042's, unchanged — including competition's hard-coded `founder`, which
-- has three locks on it and gains no fourth here.
CREATE OR REPLACE FUNCTION record_vetting_edits() RETURNS trigger AS $fn$
BEGIN
  -- The retention sweep is not an edit. See the 0007 note.
  IF NEW."anonymised_at" IS DISTINCT FROM OLD."anonymised_at" THEN
    RETURN NULL;
  END IF;

  IF NEW."selected_type" IS DISTINCT FROM OLD."selected_type" THEN
    INSERT INTO "draft_field_edits"
      ("draft_id","record","field","prior_value","new_value","supplier","edited_by")
    VALUES (NEW."draft_id",'vetting','selected_type',
            OLD."selected_type"::text, NEW."selected_type"::text,
            -- Cast explicitly: a CASE yields `text`, and `supplier` is the
            -- `field_supplier` enum. The literal branches beside it coerce from
            -- unknown; this one would not, and the failure is at runtime.
            (CASE WHEN NEW."updated_by" LIKE 'draft:%' THEN 'founder' ELSE 'proovd' END)::field_supplier,
            NEW."updated_by");
  END IF;
  IF NEW."problem_prefilled_text" IS DISTINCT FROM OLD."problem_prefilled_text" THEN
    INSERT INTO "draft_field_edits"
      ("draft_id","record","field","prior_value","new_value","supplier","edited_by")
    VALUES (NEW."draft_id",'vetting','problem_prefilled_text',
            OLD."problem_prefilled_text", NEW."problem_prefilled_text",'proovd',NEW."updated_by");
  END IF;
  IF NEW."problem_text" IS DISTINCT FROM OLD."problem_text" THEN
    INSERT INTO "draft_field_edits"
      ("draft_id","record","field","prior_value","new_value","supplier","edited_by")
    VALUES (NEW."draft_id",'vetting','problem_text',
            OLD."problem_text", NEW."problem_text",
            COALESCE(NEW."problem_supplier",'founder'),NEW."updated_by");
  END IF;
  IF NEW."solution_prefilled_text" IS DISTINCT FROM OLD."solution_prefilled_text" THEN
    INSERT INTO "draft_field_edits"
      ("draft_id","record","field","prior_value","new_value","supplier","edited_by")
    VALUES (NEW."draft_id",'vetting','solution_prefilled_text',
            OLD."solution_prefilled_text", NEW."solution_prefilled_text",'proovd',NEW."updated_by");
  END IF;
  IF NEW."solution_text" IS DISTINCT FROM OLD."solution_text" THEN
    INSERT INTO "draft_field_edits"
      ("draft_id","record","field","prior_value","new_value","supplier","edited_by")
    VALUES (NEW."draft_id",'vetting','solution_text',
            OLD."solution_text", NEW."solution_text",
            COALESCE(NEW."solution_supplier",'founder'),NEW."updated_by");
  END IF;
  IF NEW."competition_text" IS DISTINCT FROM OLD."competition_text" THEN
    -- Hard-coded `founder`, not the column. §9 admits no other answer here and
    -- a history row is the last place that should be able to say otherwise.
    INSERT INTO "draft_field_edits"
      ("draft_id","record","field","prior_value","new_value","supplier","edited_by")
    VALUES (NEW."draft_id",'vetting','competition_text',
            OLD."competition_text", NEW."competition_text",'founder',NEW."updated_by");
  END IF;
  IF NEW."views_range" IS DISTINCT FROM OLD."views_range" THEN
    -- Retired from collection on 2026-08-18. The branch stays so that the
    -- retention sweep's clearing of a legacy answer is still recorded as the
    -- change it is.
    INSERT INTO "draft_field_edits"
      ("draft_id","record","field","prior_value","new_value","supplier","edited_by")
    VALUES (NEW."draft_id",'vetting','views_range',
            OLD."views_range", NEW."views_range",'founder',NEW."updated_by");
  END IF;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;
