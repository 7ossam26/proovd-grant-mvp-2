-- ── The simplified vetting flow (2026-08-10, product direction) ─────────────
--
-- §9's five-item sequence becomes three: Problem, Solution, and the amount of
-- views. This is a recorded deviation from the Spec, the 0041 shape: the
-- campaign-path choice moves to Admin (set on the vetting record from
-- discovery, still locked permanently at submission — nothing about the 0007
-- type-lock trigger changes), Competition is no longer collected, and the
-- possible-creator result no longer gates the account claim.
--
-- What is NOT weakened here: the type lock, the competition never-prefill
-- CHECK, the anonymisation rules, and the append-only history all survive
-- unchanged. Existing records keep their competition text.

-- 1. The new answer: the amount of views, as one of four recorded ranges.
--
-- A CHECK rather than an enum: the set is a product register in
-- `shared/src/vetting/steps.ts` and four values do not earn a Postgres type
-- that every future value would need a two-migration dance to extend.
ALTER TABLE "campaign_vetting" ADD COLUMN "views_range" text;--> statement-breakpoint
ALTER TABLE "campaign_vetting" ADD CONSTRAINT "campaign_vetting_views_range_known" CHECK (
  "views_range" IS NULL
  OR "views_range" IN ('under_10k','10k_100k','100k_1m','over_1m')
);--> statement-breakpoint

-- 2. What "submitted means complete" now means.
--
-- A record submitted under the old flow is complete in the old shape
-- (competition answered, no views range existed to ask for); one submitted
-- under the new flow is complete in the new shape (views answered, competition
-- never asked). The CHECK admits exactly those two shapes, so neither a legacy
-- row nor a new submission can be half-answered. `selected_type` stays
-- required: it is Admin's answer now, but a submission still locks it and a
-- lock over NULL is the thing the 0007 comment refuses.
ALTER TABLE "campaign_vetting" DROP CONSTRAINT "campaign_vetting_submitted_is_complete";--> statement-breakpoint
ALTER TABLE "campaign_vetting" ADD CONSTRAINT "campaign_vetting_submitted_is_complete" CHECK (
  "submitted_at" IS NULL
  OR "anonymised_at" IS NOT NULL
  OR (
    "selected_type"  IS NOT NULL
    AND "problem_text"  IS NOT NULL AND btrim("problem_text")  <> ''
    AND "solution_text" IS NOT NULL AND btrim("solution_text") <> ''
    AND (
      "views_range" IS NOT NULL
      OR ("competition_text" IS NOT NULL AND btrim("competition_text") <> '')
    )
  )
);--> statement-breakpoint

-- 3. The write rules learn about the new column.
--
-- Same three rules as 0007, restated whole because CREATE OR REPLACE replaces
-- whole: anonymisation is irreversible and content cannot come back (the views
-- range is swept with the rest, so it cannot be restored either), and after
-- submission every answer — views included — is read-only.
CREATE OR REPLACE FUNCTION enforce_vetting_write() RETURNS trigger AS $fn$
BEGIN
  IF OLD."anonymised_at" IS NOT NULL THEN
    IF NEW."anonymised_at" IS DISTINCT FROM OLD."anonymised_at" THEN
      RAISE EXCEPTION 'anonymisation is irreversible; anonymised_at is append-only'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."problem_text" IS NOT NULL OR NEW."solution_text" IS NOT NULL
    OR NEW."competition_text" IS NOT NULL
    OR NEW."views_range" IS NOT NULL
    OR NEW."problem_prefilled_text" IS NOT NULL OR NEW."solution_prefilled_text" IS NOT NULL
    THEN
      RAISE EXCEPTION 'this vetting record has been anonymised; its content cannot be restored'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF OLD."submitted_at" IS NOT NULL AND NEW."anonymised_at" IS NULL THEN
    IF NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at" THEN
      RAISE EXCEPTION 'vetting submission is final; submitted_at is append-only'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."selected_type"    IS DISTINCT FROM OLD."selected_type"
    OR NEW."problem_text"     IS DISTINCT FROM OLD."problem_text"
    OR NEW."solution_text"    IS DISTINCT FROM OLD."solution_text"
    OR NEW."competition_text" IS DISTINCT FROM OLD."competition_text"
    OR NEW."views_range"      IS DISTINCT FROM OLD."views_range"
    THEN
      RAISE EXCEPTION 'vetting has been submitted and its answers are now read-only'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  NEW."updated_at" := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint

-- 4. The history trigger records views-range changes like every other answer.
--
-- Restated whole for the same CREATE OR REPLACE reason. The supplier is
-- hard-coded `founder`: the range is the Founder's own answer and there is no
-- prefill path to it.
CREATE OR REPLACE FUNCTION record_vetting_edits() RETURNS trigger AS $fn$
BEGIN
  -- The retention sweep is not an edit. See the 0007 note.
  IF NEW."anonymised_at" IS DISTINCT FROM OLD."anonymised_at" THEN
    RETURN NULL;
  END IF;

  IF NEW."selected_type" IS DISTINCT FROM OLD."selected_type" THEN
    -- Supplied by Admin now (the campaign path is set from discovery), but the
    -- history vocabulary has two suppliers and `proovd` is the honest one.
    INSERT INTO "draft_field_edits"
      ("draft_id","record","field","prior_value","new_value","supplier","edited_by")
    VALUES (NEW."draft_id",'vetting','selected_type',
            OLD."selected_type"::text, NEW."selected_type"::text,'proovd',NEW."updated_by");
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
    INSERT INTO "draft_field_edits"
      ("draft_id","record","field","prior_value","new_value","supplier","edited_by")
    VALUES (NEW."draft_id",'vetting','views_range',
            OLD."views_range", NEW."views_range",'founder',NEW."updated_by");
  END IF;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;
