-- Founder prospect intake — Spec §7, §25.8.
--
-- ── What this changes, and what it deliberately does not ────────────────────
-- §7 draws a line this schema had blurred. Creating a prospect is one act
-- ("Admin creates a Founder prospect and the initial campaign container after
-- off-platform discovery"), and composing the invitation is another ("The
-- invitation-creation surface contains: …"). Everything on that second list is
-- still required — it simply belongs to the surface §7 names, rather than to a
-- discovery form filled in before anyone has decided what the invitation says.
--
-- So no column is dropped here. Every §7 field survives, keeps its meaning, and
-- stays anonymisable; what moved is only WHERE Admin fills it in, which is an
-- application concern. A migration that dropped `product_name` would have
-- destroyed the reference §7 requires in the invitation body itself.
--
-- ── The one new column ──────────────────────────────────────────────────────
-- `last_contact_at` records when Proovd last spoke to this person off-platform.
-- It is discovery provenance in exactly the sense §7's "Admin notes and
-- discovery evidence" already is, and §26.8's one-time relationship touches are
-- the same posture: a recorded human contact, never a schedule. It is therefore
-- deliberately a bare timestamp with NO recurrence, NO next-contact column, and
-- NO job that reads it — §30 forbids automated engagement sequences, and the
-- absence of anywhere to put a cadence is what keeps this from becoming one.
ALTER TABLE "founder_prospects" ADD COLUMN "last_contact_at" timestamp with time zone;--> statement-breakpoint
--
COMMENT ON COLUMN "founder_prospects"."last_contact_at" IS
  'When Proovd last spoke to this prospect off-platform (§7 discovery record). Anonymised by the §25.8 sweep. Never a schedule: no recurrence, no next-contact, no job reads it (§30).';--> statement-breakpoint
--
-- ── The anonymisation trigger learns the new column ─────────────────────────
-- 0005 made anonymisation irreversible by refusing to write content back onto
-- an anonymised prospect. A new content column that the trigger does not know
-- about is a hole in exactly that guarantee: the sweep would null it, and a
-- later UPDATE could put the contact date back on a record whose person asked
-- to be forgotten. §25.8's "irreversibly anonymized" has to cover every field
-- that says something about a person, and a date we spoke to them does.
CREATE OR REPLACE FUNCTION enforce_prospect_anonymisation() RETURNS trigger AS $fn$
BEGIN
  IF OLD."anonymised_at" IS NOT NULL THEN
    IF NEW."anonymised_at" IS DISTINCT FROM OLD."anonymised_at" THEN
      RAISE EXCEPTION 'anonymisation is irreversible; anonymised_at is append-only'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."legal_name" IS NOT NULL OR NEW."preferred_name" IS NOT NULL
    OR NEW."email"      IS NOT NULL OR NEW."phone"          IS NOT NULL
    OR NEW."product_name" IS NOT NULL OR NEW."product_url"  IS NOT NULL
    OR NEW."last_contact_at" IS NOT NULL
    THEN
      RAISE EXCEPTION 'this prospect has been anonymised; its content cannot be restored'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW."updated_at" := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint
--
-- No new grant. `founder_prospects` already carries SELECT, INSERT, UPDATE for
-- proovd_app from 0005, and DELETE is still revoked there.
