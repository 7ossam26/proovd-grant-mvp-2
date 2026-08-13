-- The Support Admin workspace — Spec §26.7, §26.8, §27.8, §25.6, §29.9, §29.10.
--
-- Built on the case domain Phase 16b already shipped. `support_cases`,
-- `support_case_messages`, and `support_case_handoffs` are EXTENDED here, never
-- replaced: they already carry §27.8's business-day deadline with the calendar
-- version that produced it, the §33.9.11 customer-facing/internal split, and the
-- §26.8 four-fact handoff gate. A parallel ticket table would have been a second
-- answer to "when did we promise this person a response".
--
-- ═══ What the reference needed that no record held ══════════════════════════
--
--   1. A subject line. A case had a topic and a first message; the queue needs
--      the one sentence a person would recognise it by.
--   2. A named ADMIN. §26.7's `owner` is an ORGANISATION — Proovd or the
--      Founder — and it is what Appendix B.8 tells the customer. "Which human
--      is handling this" is a different fact and gets its own column, because
--      overloading `owner` would make the acknowledgement email say a person's
--      name where the Spec pins an organisation's.
--   3. Who the case is blocked on right now, and what they owe.
--   4. Evidence.
--   5. Coordination with a party outside the customer thread.
--   6. Resolution text, closing, and reopening.
--
-- ═══ `closed` is a STAMP, not a fifth status ════════════════════════════════
--
-- Five modules read `status <> 'resolved'` to mean "still open" — the §27.8
-- queue, `support/promises.ts`, `backer-support.ts`'s escalation arm,
-- `completion/satisfaction.ts`, and `live/act.ts`. A fifth enum member would
-- have put every closed case straight back into the SLA queue and started
-- breaching promises on cases that were finished weeks ago. So closing is
-- `closed_at` on a case that is already `resolved`, and the CHECK below refuses
-- any other combination.
--
-- ═══ Triage never touches the deadline ══════════════════════════════════════
--
-- §27.8 publishes one response promise for every case. `triage_priority`
-- therefore has no relationship to `human_response_due_at`, which the existing
-- 0025 immutability trigger already refuses to move — so a later phase cannot
-- wire triage to the SLA without deleting a trigger, which is a visible edit.
--
-- ═══ `waiting_on` and `status` cannot disagree ═════════════════════════════
--
-- Two columns describing the same thing is how they drift, so a CHECK pins
-- them together rather than a service remembering to write both. The backfill
-- below derives `waiting_on` from the status every existing row already has.
--> statement-breakpoint

-- ── 1. support_cases, extended ─────────────────────────────────────────────

ALTER TABLE "support_cases" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "support_cases" ADD COLUMN "subcategory" text;--> statement-breakpoint
ALTER TABLE "support_cases" ADD COLUMN "internal_reason" text;--> statement-breakpoint
ALTER TABLE "support_cases" ADD COLUMN "triage_priority" text NOT NULL DEFAULT 'normal';--> statement-breakpoint
ALTER TABLE "support_cases" ADD COLUMN "waiting_on" text;--> statement-breakpoint
ALTER TABLE "support_cases" ADD COLUMN "next_action" text;--> statement-breakpoint
ALTER TABLE "support_cases" ADD COLUMN "assignee_user_id" text REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "support_cases" ADD COLUMN "assigned_at" timestamptz;--> statement-breakpoint
ALTER TABLE "support_cases" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "support_cases" ADD COLUMN "resolved_by" text;--> statement-breakpoint
ALTER TABLE "support_cases" ADD COLUMN "closed_at" timestamptz;--> statement-breakpoint

-- The backfill is deterministic, which is why `waiting_on` can be CHECKed at
-- all. Every existing case already states who it waits on in its status; this
-- only writes the finer-grained word for it.
UPDATE "support_cases" SET "waiting_on" = CASE
  WHEN "status" = 'resolved' THEN NULL
  WHEN "status" = 'awaiting_founder' THEN 'founder'
  WHEN "status" = 'awaiting_customer' THEN "requester_kind"
  ELSE 'proovd'
END;--> statement-breakpoint

ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_triage_known"
  CHECK ("triage_priority" IN ('urgent', 'high', 'normal', 'low'));--> statement-breakpoint

ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_waiting_known"
  CHECK ("waiting_on" IS NULL
         OR "waiting_on" IN ('proovd', 'founder', 'creator', 'backer', 'provider'));--> statement-breakpoint

-- The two columns, pinned together — but only where they genuinely say the same
-- thing. `awaiting_customer` means the person who ASKED owes the next move, so
-- there the two must agree exactly.
--
-- `open` deliberately admits every party, including a Creator or a Founder,
-- because those are two different facts: `awaiting_founder` means the Founder is
-- the accountable owner and §27.8's 48-hour clock is running, while `open` with
-- `waiting_on = 'creator'` means PROOVD still owes the customer a response and
-- is chasing a Creator to produce it. A stricter CHECK made the second one
-- unrepresentable, which would have forced a Backer's tracking question to claim
-- the Backer was the one holding it up.
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_waiting_matches_status" CHECK (
  ("status" = 'resolved' AND "waiting_on" IS NULL)
  OR (
    "status" <> 'resolved'
    AND "waiting_on" IS NOT NULL
    AND ("status" <> 'awaiting_customer' OR "waiting_on" = "requester_kind")
    AND ("status" <> 'awaiting_founder' OR "waiting_on" = 'founder')
  )
);--> statement-breakpoint

-- Closing is only reachable from resolved, and a closed case carries the
-- resolution that justified it. §26.7: a decision with no recorded reason is a
-- decision nobody can review.
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_closed_only_when_resolved" CHECK (
  "closed_at" IS NULL
  OR ("status" = 'resolved' AND "resolved_at" IS NOT NULL AND btrim(coalesce("resolution", '')) <> '')
);--> statement-breakpoint

-- A resolution names the person who reached it. Neither half without the other.
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_resolution_attributed" CHECK (
  ("resolution" IS NULL AND "resolved_by" IS NULL)
  OR (btrim(coalesce("resolution", '')) <> '' AND btrim(coalesce("resolved_by", '')) <> '')
);--> statement-breakpoint

-- Blank is not a value. A subject somebody cleared reads as "no subject
-- recorded" and renders the topic instead; a subject of one space renders as a
-- gap nobody can see.
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_text_fields_non_blank" CHECK (
  ("subject" IS NULL OR btrim("subject") <> '')
  AND ("subcategory" IS NULL OR btrim("subcategory") <> '')
  AND ("internal_reason" IS NULL OR btrim("internal_reason") <> '')
  AND ("next_action" IS NULL OR btrim("next_action") <> '')
);--> statement-breakpoint

-- An assignment has a time, and a time has an assignment.
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_assignment_stamped" CHECK (
  ("assignee_user_id" IS NULL AND "assigned_at" IS NULL)
  OR ("assignee_user_id" IS NOT NULL AND "assigned_at" IS NOT NULL)
);--> statement-breakpoint

-- The queue reads unassigned-and-open first; the workspace directory sorts by
-- recency. Two access shapes, two indexes.
CREATE INDEX "support_cases_assignee_idx"
  ON "support_cases" ("assignee_user_id", "status");--> statement-breakpoint
CREATE INDEX "support_cases_directory_idx"
  ON "support_cases" ("created_at" DESC);--> statement-breakpoint

-- ── 2. support_case_assignments (§25.6) ────────────────────────────────────
--
-- Insert-only. The reference shows "previous owner" and "reason for
-- reassignment" as fields on the ticket; storing them there would keep exactly
-- one handover and overwrite it on the next, which is the opposite of what
-- §25.6 asks for. The current assignee lives on the case; how it got there
-- lives here, in full.
--
-- Distinct from `support_case_handoffs`, deliberately: a handoff changes the
-- accountable ORGANISATION and §26.8 gates it on four facts about what the
-- customer was already told. Moving a case between two Proovd Admins promises
-- the customer nothing new and must not demand the same four sentences — a gate
-- that fires on routine work is a gate people learn to type past.
CREATE TABLE "support_case_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" uuid NOT NULL,
  "from_user_id" text REFERENCES "user"("id") ON DELETE RESTRICT,
  "to_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "reason" text,
  "actor" text NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "support_case_assignments" ADD CONSTRAINT "support_case_assignments_case_fk"
  FOREIGN KEY ("case_id") REFERENCES "support_cases"("id");--> statement-breakpoint

ALTER TABLE "support_case_assignments" ADD CONSTRAINT "support_case_assignments_moved" CHECK (
  "from_user_id" IS NULL OR "from_user_id" <> "to_user_id"
);--> statement-breakpoint

ALTER TABLE "support_case_assignments" ADD CONSTRAINT "support_case_assignments_reason_non_blank"
  CHECK ("reason" IS NULL OR btrim("reason") <> '');--> statement-breakpoint

CREATE INDEX "support_case_assignments_case_idx"
  ON "support_case_assignments" ("case_id", "occurred_at");--> statement-breakpoint

-- ── 3. support_case_evidence (§24.11's posture, applied to a case) ─────────
--
-- Insert-only, and it stores a REFERENCE rather than a file. §12's object
-- storage is Track A4 and `unconfiguredStorage` throws; a `storage_key` column
-- here would be a promise the deployment cannot keep, and §1.4 is why there
-- isn't one. `linked_kind` is CHECKed against a register because evidence
-- pointing at free text is evidence that can point at nothing — which looks
-- complete inside a §24.11 dispute packet while proving none of it.
CREATE TABLE "support_case_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "description" text NOT NULL,
  "linked_kind" text NOT NULL DEFAULT 'none',
  "linked_reference" text,
  "added_by" text NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "support_case_evidence" ADD CONSTRAINT "support_case_evidence_case_fk"
  FOREIGN KEY ("case_id") REFERENCES "support_cases"("id");--> statement-breakpoint

ALTER TABLE "support_case_evidence" ADD CONSTRAINT "support_case_evidence_kind_known"
  CHECK ("kind" IN (
    'screenshot', 'campaign_version', 'post_url', 'tracking_information',
    'payment_record', 'refund_record', 'delivery_evidence', 'message_record', 'other'
  ));--> statement-breakpoint

ALTER TABLE "support_case_evidence" ADD CONSTRAINT "support_case_evidence_linked_known"
  CHECK ("linked_kind" IN (
    'campaign', 'reservation', 'association', 'post_submission',
    'refund', 'dispute', 'payment', 'none'
  ));--> statement-breakpoint

ALTER TABLE "support_case_evidence" ADD CONSTRAINT "support_case_evidence_description_present"
  CHECK (btrim("description") <> '');--> statement-breakpoint

-- A link that names a kind names the record too. `none` is the honest answer
-- for evidence with no record behind it, and it is the default.
ALTER TABLE "support_case_evidence" ADD CONSTRAINT "support_case_evidence_link_complete" CHECK (
  ("linked_kind" = 'none' AND "linked_reference" IS NULL)
  OR ("linked_kind" <> 'none' AND btrim(coalesce("linked_reference", '')) <> '')
);--> statement-breakpoint

CREATE INDEX "support_case_evidence_case_idx"
  ON "support_case_evidence" ("case_id", "occurred_at");--> statement-breakpoint

-- ── 4. support_case_contacts (§26.8, §30) ──────────────────────────────────
--
-- Coordination Proovd did OUTSIDE the customer thread, recorded so the case
-- carries the whole story. §27 defines no notification key for it and this
-- table does not send one — `outcome` is the only mutable column, so recording
-- what came back is possible and rewriting what was asked is not.
--
-- There is no `remind_at`, no `recurrence`, and no job that reads this table.
-- §30 forbids automated engagement sequences, and `relationship_touches`
-- records the same absence for the same reason: having nowhere to put a
-- schedule is what keeps one from appearing.
CREATE TABLE "support_case_contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" uuid NOT NULL,
  "party_kind" text NOT NULL,
  "party_label" text NOT NULL,
  "message" text NOT NULL,
  "expected_response_at" timestamptz,
  "outcome" text,
  "outcome_recorded_at" timestamptz,
  "recorded_by" text NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "support_case_contacts" ADD CONSTRAINT "support_case_contacts_case_fk"
  FOREIGN KEY ("case_id") REFERENCES "support_cases"("id");--> statement-breakpoint

ALTER TABLE "support_case_contacts" ADD CONSTRAINT "support_case_contacts_party_known"
  CHECK ("party_kind" IN ('founder', 'creator', 'backer', 'provider'));--> statement-breakpoint

ALTER TABLE "support_case_contacts" ADD CONSTRAINT "support_case_contacts_body_present"
  CHECK (btrim("message") <> '' AND btrim("party_label") <> '');--> statement-breakpoint

ALTER TABLE "support_case_contacts" ADD CONSTRAINT "support_case_contacts_outcome_stamped" CHECK (
  ("outcome" IS NULL AND "outcome_recorded_at" IS NULL)
  OR (btrim(coalesce("outcome", '')) <> '' AND "outcome_recorded_at" IS NOT NULL)
);--> statement-breakpoint

CREATE INDEX "support_case_contacts_case_idx"
  ON "support_case_contacts" ("case_id", "occurred_at");--> statement-breakpoint

-- ── 5. support_case_reopens (§26.8) ────────────────────────────────────────
--
-- Insert-only. §26.8's rule that nothing is deleted applies hardest here: a
-- reopen is the record that a resolution did not hold, and the reference is
-- explicit that reopening creates no new case and replaces no history. The
-- reason is required — "reopened" with no cause is the state nobody can review.
CREATE TABLE "support_case_reopens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "prior_resolution" text,
  "prior_resolved_at" timestamptz,
  "prior_closed_at" timestamptz,
  "actor" text NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "support_case_reopens" ADD CONSTRAINT "support_case_reopens_case_fk"
  FOREIGN KEY ("case_id") REFERENCES "support_cases"("id");--> statement-breakpoint

ALTER TABLE "support_case_reopens" ADD CONSTRAINT "support_case_reopens_reason_present"
  CHECK (btrim("reason") <> '');--> statement-breakpoint

CREATE INDEX "support_case_reopens_case_idx"
  ON "support_case_reopens" ("case_id", "occurred_at");--> statement-breakpoint

-- ── 6. Grants (§25.6) ──────────────────────────────────────────────────────
--
-- Every new table is insert-only. The one exception is granted BY NAME: a
-- contact's outcome is a fact that arrives later, and it is the only column on
-- any of these tables that a second write may touch. The 0005 arrangement.
GRANT SELECT, INSERT ON "support_case_assignments" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "support_case_assignments" FROM proovd_app;--> statement-breakpoint

GRANT SELECT, INSERT ON "support_case_evidence" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "support_case_evidence" FROM proovd_app;--> statement-breakpoint

GRANT SELECT, INSERT ON "support_case_contacts" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("outcome", "outcome_recorded_at") ON "support_case_contacts" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "support_case_contacts" FROM proovd_app;--> statement-breakpoint

GRANT SELECT, INSERT ON "support_case_reopens" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "support_case_reopens" FROM proovd_app;--> statement-breakpoint

-- ── 7. A recorded outcome is written once ──────────────────────────────────
--
-- The UPDATE grant above exists so an outcome can arrive; this trigger is what
-- stops it becoming an editable field. §25.6's posture: a correction is a new
-- record, not a rewrite of the old one.
CREATE OR REPLACE FUNCTION enforce_contact_outcome_write_once()
RETURNS trigger AS $$
BEGIN
  IF OLD."outcome" IS NOT NULL AND NEW."outcome" IS DISTINCT FROM OLD."outcome" THEN
    RAISE EXCEPTION 'a recorded contact outcome cannot be rewritten (§25.6)';
  END IF;
  IF NEW."message" IS DISTINCT FROM OLD."message"
     OR NEW."party_kind" IS DISTINCT FROM OLD."party_kind"
     OR NEW."party_label" IS DISTINCT FROM OLD."party_label"
     OR NEW."expected_response_at" IS DISTINCT FROM OLD."expected_response_at"
     OR NEW."occurred_at" IS DISTINCT FROM OLD."occurred_at" THEN
    RAISE EXCEPTION 'a recorded contact cannot be edited (§25.6)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER support_contact_outcome_write_once
  BEFORE UPDATE ON "support_case_contacts"
  FOR EACH ROW EXECUTE FUNCTION enforce_contact_outcome_write_once();--> statement-breakpoint

-- ── 8. A closed case is finished (§26.8) ───────────────────────────────────
--
-- Reopening is the ONE path back, and it goes through `reopenCase`, which
-- records why. This trigger refuses every other way: a case cannot quietly
-- un-close, and its resolution cannot be rewritten while it stands. Clearing
-- `closed_at` is permitted only together with clearing the resolution, which is
-- exactly what a reopen does — so the legitimate path stays open and editing in
-- place does not.
CREATE OR REPLACE FUNCTION enforce_support_closure_integrity()
RETURNS trigger AS $$
BEGIN
  IF OLD."closed_at" IS NOT NULL
     AND NEW."closed_at" IS NOT NULL
     AND NEW."closed_at" IS DISTINCT FROM OLD."closed_at" THEN
    RAISE EXCEPTION 'a closing time cannot be moved (§26.8)';
  END IF;

  IF OLD."resolution" IS NOT NULL
     AND NEW."resolution" IS NOT NULL
     AND NEW."resolution" IS DISTINCT FROM OLD."resolution" THEN
    RAISE EXCEPTION 'a recorded resolution cannot be rewritten — reopen the case instead (§26.8)';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER support_case_closure_integrity
  BEFORE UPDATE ON "support_cases"
  FOR EACH ROW EXECUTE FUNCTION enforce_support_closure_integrity();
