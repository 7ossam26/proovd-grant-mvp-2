-- Phase 23b — the three §31.9 measurement stamps.
-- Spec §31.9, §33.12.6, §25.6.
--
-- The whole of this migration is three timestamps, and none of them records
-- anything new. Each stamps the FIRST occurrence of something the system
-- already causes, beside a fact that was already stored in the wrong tense for
-- a duration:
--
--   * `secure_tokens.last_used_at` is overwritten on every verification, so a
--     Founder who opened their invitation in March and again yesterday has no
--     March left anywhere. §31.9's "time to first magic" starts at the first
--     open, which is a different column.
--
--   * `possible_creator_results.recorded_at` is when an Admin recorded the
--     §10 assessment, not when the Founder was shown it. §31.9 says
--     "possible-creator rendering", and the gap between the two is exactly the
--     wait §31.9 exists to measure.
--
--   * `campaign_results.prepared_at` is when `Results ready` became true.
--     §31.9's "return after closure" measures the Founder OPENING it, within
--     seven days, which the prepared stamp cannot tell you.
--
-- §31.9's first sentence forbids a general analytics warehouse, and this is
-- what staying inside it costs: three columns on three tables that exist for
-- product reasons, rather than an events table that would need one.
--
-- All three are write-once. A "first" that a later visit can move is a "last"
-- with a misleading name, and the metric computed from it would drift toward
-- zero as people came back. Enforced by trigger, not by the services that set
-- them — three call sites are three chances to forget the WHERE clause.

-- ── §7: the first time an invitation link was opened ────────────────────────
-- Scoped to nothing: every token scope gets the column, because the same
-- question is asked of a Creator invitation and a Backer magic link and the
-- alternative is a fourth column later. It carries no personal data — it is a
-- timestamp about a token row that §25.8's sweep already governs.
ALTER TABLE "secure_tokens"
  ADD COLUMN "first_used_at" timestamptz;--> statement-breakpoint

COMMENT ON COLUMN "secure_tokens"."first_used_at" IS
  '§31.9: the first successful verification. Write-once; `last_used_at` is the current one.';--> statement-breakpoint

-- ── §10: the first time the possible-creator result was rendered ────────────
-- `possible_creator_results` is insert-only (0007), and stays that way apart
-- from this one column granted by name — the arrangement 0005 already uses for
-- `campaign_invitation_sends`. The Admin's count, its basis, and who recorded
-- it remain unwritable.
ALTER TABLE "possible_creator_results"
  ADD COLUMN "first_rendered_at" timestamptz;--> statement-breakpoint

COMMENT ON COLUMN "possible_creator_results"."first_rendered_at" IS
  '§31.9: the first time the Founder was actually shown this result. Write-once.';--> statement-breakpoint

GRANT UPDATE ("first_rendered_at") ON "possible_creator_results" TO proovd_app;--> statement-breakpoint

-- ── §21: the first time the Founder opened Results ready ────────────────────
-- Same shape, same reason. `campaign_results` is insert-only (0029) and the
-- narrative Admin reviewed stays that way.
ALTER TABLE "campaign_results"
  ADD COLUMN "first_viewed_at" timestamptz;--> statement-breakpoint

COMMENT ON COLUMN "campaign_results"."first_viewed_at" IS
  '§31.9: the first time the Founder opened their results. Write-once.';--> statement-breakpoint

GRANT UPDATE ("first_viewed_at") ON "campaign_results" TO proovd_app;--> statement-breakpoint

-- ── Write-once, at the level a service cannot forget ────────────────────────
-- Each trigger refuses only the one transition that matters: a non-null value
-- becoming something else. Setting it from NULL is what the services do;
-- clearing it or moving it is what nothing may do.
CREATE OR REPLACE FUNCTION enforce_first_stamp_write_once()
RETURNS trigger AS $$
DECLARE
  col text := TG_ARGV[0];
  old_value timestamptz;
  new_value timestamptz;
BEGIN
  EXECUTE format('SELECT ($1).%I', col) INTO old_value USING OLD;
  EXECUTE format('SELECT ($1).%I', col) INTO new_value USING NEW;

  IF old_value IS NOT NULL AND new_value IS DISTINCT FROM old_value THEN
    RAISE EXCEPTION
      '%.% is a first-occurrence stamp and cannot be moved once set (§31.9)',
      TG_TABLE_NAME, col
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER secure_tokens_first_used_write_once
  BEFORE UPDATE ON "secure_tokens"
  FOR EACH ROW EXECUTE FUNCTION enforce_first_stamp_write_once('first_used_at');--> statement-breakpoint

CREATE TRIGGER possible_creator_results_first_rendered_write_once
  BEFORE UPDATE ON "possible_creator_results"
  FOR EACH ROW EXECUTE FUNCTION enforce_first_stamp_write_once('first_rendered_at');--> statement-breakpoint

CREATE TRIGGER campaign_results_first_viewed_write_once
  BEFORE UPDATE ON "campaign_results"
  FOR EACH ROW EXECUTE FUNCTION enforce_first_stamp_write_once('first_viewed_at');--> statement-breakpoint

-- ── §33.12.3: campaign_payment_flags is append-only, like every other trail ──
-- Found by the P0 pass, not designed here. §23.3 makes a payment flag "an
-- independent row with timestamp, amount, actor, evidence, and provider IDs"
-- and §33.12.3 asks that the lifecycle and the flags be independently
-- AUDITABLE. A trail the application role can rewrite is not auditable, and
-- every other history table in the schema — campaign_status_history,
-- association_status_history, reservation_status_history, audit_events,
-- admin_overrides — has been insert-only since the phase that added it. This
-- one was granted UPDATE and DELETE at the start and nothing ever used them:
-- no service in the tree issues either against this table. So the grant is
-- withdrawn rather than the code being trusted to keep not using it.
--
-- A flag that turns out to be wrong is corrected the way every other record in
-- the product is: a new row, with the earlier answer surviving (§25.6).
REVOKE UPDATE, DELETE ON "campaign_payment_flags" FROM proovd_app;
