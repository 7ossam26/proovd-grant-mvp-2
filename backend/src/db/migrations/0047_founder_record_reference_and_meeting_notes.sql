-- The Admin Founders rebuild, Session A — a post-Phase-24 change, 2026-08-16.
-- Spec §1.3, §7, §25.6, §25.8, §26.1, §30.
--
-- The reference bundle (docs/design-refrence/Proovd-Founder-Admin.html) needs
-- exactly two facts no record holds, and this migration is those two and
-- nothing else. Everything else the walked reference shows — the six directory
-- filter counts, the two action columns, the lifecycle labels, the invitation
-- versions, the prefill provenance — composes from records that already exist
-- (docs/phases/admin-founders-reconciliation.md is the walk).
--
-- ═══ 1. The stable record reference (`F-…`) ═════════════════════════════════
--
-- A quotable id for the PERSON, in the header of every Founder record. The
-- `PVD-`/`D14-`/`RF-` precedent applies unchanged: random rather than
-- sequential, because a sequential number tells anyone who holds one roughly
-- how many Founders Proovd has invited — a business fact nobody quoting a
-- record needs; and drawn from an alphabet with no O/0 or I/1, because a
-- reference read over the phone must not need glyph disambiguation.
--
-- The database mints it, via the column DEFAULT, rather than a service: every
-- existing path that creates a prospect — the intake route, the seeds, dozens
-- of test inserts — keeps working unchanged, and there is no code path that
-- can create a prospect without a reference. It is NOT content: the reference
-- survives §25.8 anonymisation as part of the minimum audit skeleton (it names
-- nobody), and it is immutable by trigger because a reference that can move is
-- not a reference.
--
-- ═══ 2. Meeting notes ═══════════════════════════════════════════════════════
--
-- The reference shows dated, attributed entries ("1 on file", "Earlier ·
-- recorded during intake") with an `Add meeting note` action whose required
-- fields are the meeting date, the participants, the decisions, the follow-up,
-- and the source. `founder_prospects.admin_notes` is a single text column and
-- `discovery_evidence` is untyped JSON; neither holds a sequence of attributed
-- entries, so this is a table.
--
-- Insert-only in the strong sense: a correction is a NEW note, and the only
-- UPDATE the grant and the trigger permit is the §25.8 anonymisation write,
-- which moves a row from its live shape to its all-null shape — never back,
-- and never to a third shape. A meeting note records what was discussed with
-- a person, which is exactly the class of content the unclaimed-draft sweep
-- deletes, so the content columns join the sweep (backend/src/invitations/
-- retention.ts) and the CHECK below makes the two shapes the only
-- representable states. What survives anonymisation is the audit skeleton
-- §25.8 requires: a meeting was recorded, by whom, when.
--
-- Per the `relationship_touches` and 0046 precedent, there is no `remind_at`,
-- no recurrence, no `next_meeting_at`, and no job that reads this table — §30
-- forbids automated engagement sequences, and having nowhere to record a
-- cadence is what keeps a meeting log from becoming one. The absence is
-- asserted in information_schema by test.
--> statement-breakpoint

-- ── 1. The mint function ────────────────────────────────────────────────────
--
-- `F-` plus five characters of the 30-glyph alphabet (~24 million values).
-- Loops until unused — the loop reads its own transaction's writes, so the
-- backfill below cannot self-collide. random() rather than a crypto source:
-- this is an identifier, not a secret; nothing is granted by knowing one.
CREATE OR REPLACE FUNCTION mint_founder_record_reference() RETURNS text AS $fn$
DECLARE
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  candidate text;
BEGIN
  LOOP
    SELECT 'F-' || string_agg(substr(alphabet, (floor(random() * 30))::int + 1, 1), '')
      INTO candidate
      FROM generate_series(1, 5);
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM "founder_prospects" WHERE "record_reference" = candidate
    );
  END LOOP;
  RETURN candidate;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint

-- ── 2. The column, backfilled before it hardens ─────────────────────────────

ALTER TABLE "founder_prospects" ADD COLUMN "record_reference" text;--> statement-breakpoint

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT "id" FROM "founder_prospects" WHERE "record_reference" IS NULL LOOP
    UPDATE "founder_prospects"
      SET "record_reference" = mint_founder_record_reference()
      WHERE "id" = r."id";
  END LOOP;
END $$;--> statement-breakpoint

ALTER TABLE "founder_prospects"
  ALTER COLUMN "record_reference" SET DEFAULT mint_founder_record_reference();--> statement-breakpoint
ALTER TABLE "founder_prospects"
  ALTER COLUMN "record_reference" SET NOT NULL;--> statement-breakpoint

-- The shape is pinned so a hand-written INSERT cannot file a sequential or
-- confusable reference the mint function would never produce.
ALTER TABLE "founder_prospects" ADD CONSTRAINT "founder_prospects_record_reference_shape"
  CHECK ("record_reference" ~ '^F-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{5}$');--> statement-breakpoint

CREATE UNIQUE INDEX "founder_prospects_record_reference_idx"
  ON "founder_prospects" ("record_reference");--> statement-breakpoint

-- ── 3. The prospect trigger learns immutability of the reference ────────────
--
-- Same function 0005 created and 0039/0043 extended. The reference is added as
-- an IMMUTABLE fact rather than a content fact: it is never nulled by the
-- sweep (it is the audit skeleton), and it can never change once minted.
CREATE OR REPLACE FUNCTION enforce_prospect_anonymisation() RETURNS trigger AS $fn$
BEGIN
  IF NEW."record_reference" IS DISTINCT FROM OLD."record_reference" THEN
    RAISE EXCEPTION 'a record reference is permanent; it cannot be reissued (§26.1)'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."anonymised_at" IS NOT NULL THEN
    IF NEW."anonymised_at" IS DISTINCT FROM OLD."anonymised_at" THEN
      RAISE EXCEPTION 'anonymisation is irreversible; anonymised_at is append-only'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."legal_name" IS NOT NULL OR NEW."preferred_name" IS NOT NULL
    OR NEW."email"      IS NOT NULL OR NEW."phone"          IS NOT NULL
    OR NEW."product_name" IS NOT NULL OR NEW."product_url"  IS NOT NULL
    OR NEW."last_contact_at" IS NOT NULL
    OR NEW."date_of_birth" IS NOT NULL OR NEW."state_region" IS NOT NULL
    OR NEW."country" IS NOT NULL OR NEW."business_entity_type" IS NOT NULL
    OR NEW."business_name" IS NOT NULL
    THEN
      RAISE EXCEPTION 'this prospect has been anonymised; its content cannot be restored'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW."updated_at" := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint

-- ── 4. founder_meeting_notes ────────────────────────────────────────────────

CREATE TABLE "founder_meeting_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "prospect_id" uuid NOT NULL REFERENCES "founder_prospects"("id"),

  -- The reference dialog's five required facts. All nullable in the SCHEMA
  -- because the anonymised shape nulls them; the two-shape CHECK below is what
  -- requires them on a live row, which is stronger than NOT NULL — it also
  -- refuses a half-anonymised row.
  "meeting_date" date,
  "participants" text,
  "decisions" text,
  "follow_up" text,
  "source_link" text,

  -- The one genuinely optional field on the dialog.
  "notes" text,

  -- Better Auth ids are text, not uuid. The author is the session, never the
  -- body — the `assignToSelf` precedent.
  "created_by" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "anonymised_at" timestamptz
);--> statement-breakpoint

-- Two shapes and no third: live (all five facts present, non-blank) or
-- anonymised (every content column null, stamped). A note that lost its
-- participants but kept its decisions is not a state this table can hold.
ALTER TABLE "founder_meeting_notes" ADD CONSTRAINT "founder_meeting_notes_two_shapes" CHECK (
  (
    "anonymised_at" IS NULL
    AND "meeting_date" IS NOT NULL
    AND btrim(coalesce("participants", '')) <> ''
    AND btrim(coalesce("decisions", '')) <> ''
    AND btrim(coalesce("follow_up", '')) <> ''
    AND btrim(coalesce("source_link", '')) <> ''
    AND ("notes" IS NULL OR btrim("notes") <> '')
  )
  OR (
    "anonymised_at" IS NOT NULL
    AND "meeting_date" IS NULL
    AND "participants" IS NULL
    AND "decisions" IS NULL
    AND "follow_up" IS NULL
    AND "source_link" IS NULL
    AND "notes" IS NULL
  )
);--> statement-breakpoint

CREATE INDEX "founder_meeting_notes_prospect_idx"
  ON "founder_meeting_notes" ("prospect_id", "created_at" DESC);--> statement-breakpoint

-- ── 5. Grants (§25.6) ───────────────────────────────────────────────────────
--
-- UPDATE is granted on exactly the columns the §25.8 sweep must null, by name
-- (the 0005 `campaign_invitation_sends` arrangement). `prospect_id`,
-- `created_by`, and `created_at` are outside the grant: the fact that a
-- meeting was recorded, by whom, when, outlives the text of it. DELETE is
-- revoked: a correction is a new note, and an anonymisation is a null, never
-- a vanished row.
GRANT SELECT, INSERT ON "founder_meeting_notes" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("meeting_date", "participants", "decisions", "follow_up", "source_link", "notes", "anonymised_at")
  ON "founder_meeting_notes" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "founder_meeting_notes" FROM proovd_app;--> statement-breakpoint

-- ── 6. The only legal UPDATE is the anonymising one ─────────────────────────
--
-- An edit is a new row. The single write this trigger lets through is the
-- sweep's: live shape → anonymised shape, once, never back. Combined with the
-- two-shape CHECK, "editable" is simply not a state this table has.
CREATE OR REPLACE FUNCTION enforce_meeting_note_integrity() RETURNS trigger AS $fn$
BEGIN
  IF OLD."anonymised_at" IS NOT NULL THEN
    RAISE EXCEPTION 'an anonymised meeting note is settled; its content cannot be restored (§25.8)'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."anonymised_at" IS NULL THEN
    RAISE EXCEPTION 'a meeting note is a record, not a draft — a correction is a new note (§25.6)'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER founder_meeting_note_integrity
  BEFORE UPDATE ON "founder_meeting_notes"
  FOR EACH ROW EXECUTE FUNCTION enforce_meeting_note_integrity();
