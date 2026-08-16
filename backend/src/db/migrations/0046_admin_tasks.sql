-- The Admin Tasks panel — a post-Phase-24 change, 2026-08-16. Spec §1.1, §1.3,
-- §25.6, §30; DNA §5.4, §5.10.
--
-- §26 does not name a task list, and this migration does not pretend it does.
-- What it creates is the record behind a private note an operator writes to
-- themselves, pointed at the record it belongs to — none of the seven things
-- §1 rule 6 forbids inventing. The whole design of these two tables is what
-- they refuse to become:
--
-- ═══ There is no `assigned_to`, and the absence is asserted by test ═════════
--
-- Assignment already exists: `support_cases` carries an owner, a waiting
-- party, a due time, a handoff gate with four required fields, and §27.8's
-- published response promise. A second way to hand work to a named person
-- would be a second door into rules that machinery encodes — the same reason
-- the Campaigns hub is read-only. If a task turns out to be work somebody is
-- owed, the answer is a support case, not a column here. Do not add one.
--
-- ═══ There is no schedule-shaped column, and never will be ══════════════════
--
-- §30 forbids automated engagement sequences. `due_on` is a bare DATE an Admin
-- checks — it drives the read-side pill and the optional sort, and nothing
-- else: no `remind_at`, no `notify_at`, no `recurrence`, no `next_send_at`,
-- no `snooze_until`, no `escalate_at`, no `priority`, no `sla_*`. The
-- `relationship_touches` and `support_case_contacts` precedent: having
-- nowhere to record a schedule is what keeps one from appearing. A `date`
-- rather than a `timestamptz`, deliberately — §27.1's timezone rule governs
-- deadlines the product promises to people, and this is not one; it is a day
-- in the author's own head, and an instant would imply a moment something
-- fires. Nothing fires.
--
-- ═══ Deletion is soft, because every list is shared ═════════════════════════
--
-- Every Admin sees every list. On a shared list, one Admin hard-deleting
-- another's note destroys somebody else's work with no record, so
-- `deleted_at`/`deleted_by` are set, reads filter them out, and the row
-- survives — the repo's standing posture. DELETE is revoked from the app role
-- outright, and a recorded deletion cannot be cleared: there is no undelete
-- route, and a trigger refuses the write.
--
-- ═══ Completion records who ═════════════════════════════════════════════════
--
-- On a shared list, "done" without an author is a fact nobody can follow up
-- on. Reopening is permitted — the pair clears together — because a checkbox
-- an Admin cannot untick records their slip forever, which is a punishment,
-- not a record.
--
-- ═══ The reference triple is all-or-nothing ═════════════════════════════════
--
-- A `ref_id` with no `ref_kind` is a pointer at nothing. `ref_label` is
-- resolved and stored at WRITE time — a label resolved on read silently
-- rewrites what somebody wrote down when a campaign is renamed (the §18
-- comment thread's stored-author reasoning). The href is deliberately NOT
-- stored: whether the destination still exists is a fact about now, re-read
-- on every render.
--
-- ═══ Retention: a genuine gap, named rather than filled ═════════════════════
--
-- §25.8 defines seven retention windows and none of them covers
-- Admin-authored internal content. That is a real gap, and §1 rule 6's "if
-- something seems missing, say so" is why it is recorded here and not filled:
-- `support_case_messages`, `support_cases.internal_reason`, and
-- `relationship_touches.note` are none of them swept either, and the only
-- retention sweep in the product is for unclaimed invitation drafts. Inventing
-- a window for this table would be inventing a rule.
--> statement-breakpoint

-- ── 1. admin_task_lists ────────────────────────────────────────────────────

CREATE TABLE "admin_task_lists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  -- Better Auth ids are text, not uuid.
  "created_by" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "archived_at" timestamptz,
  "archived_by" text REFERENCES "user"("id") ON DELETE RESTRICT
);--> statement-breakpoint

ALTER TABLE "admin_task_lists" ADD CONSTRAINT "admin_task_lists_name_present"
  CHECK (btrim("name") <> '');--> statement-breakpoint

-- An archive has an author, and an author has an archive.
ALTER TABLE "admin_task_lists" ADD CONSTRAINT "admin_task_lists_archive_attributed" CHECK (
  ("archived_at" IS NULL AND "archived_by" IS NULL)
  OR ("archived_at" IS NOT NULL AND "archived_by" IS NOT NULL)
);--> statement-breakpoint

-- ── 2. admin_tasks ─────────────────────────────────────────────────────────

CREATE TABLE "admin_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "list_id" uuid NOT NULL REFERENCES "admin_task_lists"("id"),
  "title" text NOT NULL,
  "notes" text,
  -- A day the author checks, never an instant anything fires on (§30).
  "due_on" date,
  "created_by" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "completed_by" text REFERENCES "user"("id") ON DELETE RESTRICT,
  "deleted_at" timestamptz,
  "deleted_by" text REFERENCES "user"("id") ON DELETE RESTRICT,
  "ref_kind" text,
  "ref_id" text,
  "ref_label" text
);--> statement-breakpoint

ALTER TABLE "admin_tasks" ADD CONSTRAINT "admin_tasks_title_present"
  CHECK (btrim("title") <> '');--> statement-breakpoint

-- Blank is not a value; an empty notes field is stored as NULL.
ALTER TABLE "admin_tasks" ADD CONSTRAINT "admin_tasks_notes_non_blank"
  CHECK ("notes" IS NULL OR btrim("notes") <> '');--> statement-breakpoint

-- The register in shared/src/admin/tasks.ts, pinned here so a sixth kind is a
-- migration rather than a typo.
ALTER TABLE "admin_tasks" ADD CONSTRAINT "admin_tasks_ref_kind_known" CHECK (
  "ref_kind" IS NULL OR "ref_kind" IN (
    'founder', 'creator_relationship', 'campaign', 'backer', 'support_case'
  )
);--> statement-breakpoint

-- All three or none: a ref_id with no ref_kind is a pointer at nothing, and a
-- reference with no stored label is one a rename can rewrite.
ALTER TABLE "admin_tasks" ADD CONSTRAINT "admin_tasks_ref_all_or_nothing" CHECK (
  ("ref_kind" IS NULL AND "ref_id" IS NULL AND "ref_label" IS NULL)
  OR (
    "ref_kind" IS NOT NULL
    AND btrim(coalesce("ref_id", '')) <> ''
    AND btrim(coalesce("ref_label", '')) <> ''
  )
);--> statement-breakpoint

-- Completion records who (§1.3). Both or neither, so reopening clears the pair.
ALTER TABLE "admin_tasks" ADD CONSTRAINT "admin_tasks_completion_attributed" CHECK (
  ("completed_at" IS NULL AND "completed_by" IS NULL)
  OR ("completed_at" IS NOT NULL AND "completed_by" IS NOT NULL)
);--> statement-breakpoint

-- A deletion records who, always.
ALTER TABLE "admin_tasks" ADD CONSTRAINT "admin_tasks_deletion_attributed" CHECK (
  ("deleted_at" IS NULL AND "deleted_by" IS NULL)
  OR ("deleted_at" IS NOT NULL AND "deleted_by" IS NOT NULL)
);--> statement-breakpoint

-- The panel reads one list at a time and filters deleted rows on every read.
CREATE INDEX "admin_tasks_list_idx" ON "admin_tasks" ("list_id", "created_at" DESC);--> statement-breakpoint

-- ── 3. Grants (§25.6) ──────────────────────────────────────────────────────
--
-- UPDATE is granted because a task is genuinely editable — title, notes, due
-- day, list, reference, the completion toggle, the soft delete, the archive.
-- What is NOT editable is who wrote it and when, and the triggers below are
-- what hold that. DELETE is revoked on both tables: a correction is a new
-- state on the surviving row, never a vanished one.
GRANT SELECT, INSERT, UPDATE ON "admin_task_lists" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "admin_task_lists" FROM proovd_app;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON "admin_tasks" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "admin_tasks" FROM proovd_app;--> statement-breakpoint

-- ── 4. Authorship survives every later write ───────────────────────────────
--
-- A recorded author and creation time cannot be rewritten, an archive cannot
-- be quietly lifted, and an archived list cannot be edited — archiving is the
-- last thing that happens to one.
CREATE OR REPLACE FUNCTION enforce_admin_task_list_integrity()
RETURNS trigger AS $$
BEGIN
  IF NEW."created_by" IS DISTINCT FROM OLD."created_by"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'a list''s recorded author cannot be rewritten (§25.6)';
  END IF;
  IF OLD."archived_at" IS NOT NULL THEN
    RAISE EXCEPTION 'an archived list is settled — a new list is a new record (§25.6)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER admin_task_list_integrity
  BEFORE UPDATE ON "admin_task_lists"
  FOR EACH ROW EXECUTE FUNCTION enforce_admin_task_list_integrity();--> statement-breakpoint

-- A deleted task is settled: nothing about it may change afterwards, and the
-- deletion itself cannot be cleared — there is no undelete route, and this is
-- what makes its absence structural rather than unbuilt.
CREATE OR REPLACE FUNCTION enforce_admin_task_integrity()
RETURNS trigger AS $$
BEGIN
  IF NEW."created_by" IS DISTINCT FROM OLD."created_by"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'a task''s recorded author cannot be rewritten (§25.6)';
  END IF;
  IF OLD."deleted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'a deleted task is settled (§25.6)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER admin_task_integrity
  BEFORE UPDATE ON "admin_tasks"
  FOR EACH ROW EXECUTE FUNCTION enforce_admin_task_integrity();
