-- ═══════════════════════════════════════════════════════════════════════════
-- 0058 — the Founder's Backer data request
-- Founder Dashboard Session F (F4). `docs/phases/founder-dashboard.md`.
--
-- NOT a deviation. §25.7 already draws the line this record sits on: a Founder
-- gets aggregates, plus "Immediate Backer email/purchase details only for
-- fulfillment/support", plus "Identifiable survey/marketing fields only with
-- the specific optional consent". The first two arrive automatically through
-- §19's mandatory operational share. This is the ask for anything BEYOND that,
-- and it is a record a person decides.
--
-- The reference draws three purposes — marketing follow-up, adding backers to a
-- community, and customer support. Two of the three are refused, and the
-- refusal is in the CHECK rather than in a service: a purpose §25.7 does not
-- permit has no representable row, whatever a route is later persuaded to send.
--
-- What this table CANNOT hold, and it is what keeps the record from becoming an
-- access grant:
--
--   * no `granted_columns`, `scope`, `access_level`, `expires_at`, or any
--     column an exporter could read. `exportBackerRows` takes no request id and
--     no purpose — there is no argument an approved request could arrive as, so
--     approving one cannot widen a file. What an Admin does about an approved
--     request is §26.7's support case: a person, with the record in front of
--     them, which is §1.3's manual-but-recorded path.
--   * no marketing-consent column of any spelling. §31.8's "does not coerce
--     newsletter consent" has been enforced since Phase 21b by there being
--     nowhere to record one, and this table does not become the place.
--   * no schedule-shaped column and no job reads it. §30.
--
-- Its shape is `founder_meeting_requests`' (0056), which is `work_again_requests`'
-- (0036) — the ask, immutable; one decision, write-once; history kept.
--
-- §25.8: none of its seven windows covers an internal request between a Founder
-- and Proovd. `work_again_requests` and `founder_meeting_requests` are not
-- swept either, and inventing a window where the Spec fixes none would be §1
-- rule 6 in the other direction.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE "founder_backer_data_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id"),
  "founder_user_id" text NOT NULL,

  /* §25.7's two permitted purposes and nothing else. A marketing or community
     request is unrepresentable rather than refused-by-a-service. */
  "purpose" text NOT NULL,
  /* What they actually need and why — the ask itself, written once. */
  "detail" text NOT NULL,

  "status" text NOT NULL DEFAULT 'open',
  "requested_at" timestamptz NOT NULL DEFAULT now(),

  "decided_at" timestamptz,
  "decided_by" text,
  /* What the Founder is told. §25.6 keeps this apart from any internal note;
     there is no internal column here at all, because an Admin who needs one
     opens a §26.7 case. */
  "decision_note" text,

  "created_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "founder_backer_data_purpose_permitted" CHECK (
    "purpose" IN ('fulfillment', 'support')
  ),
  CONSTRAINT "founder_backer_data_detail_present" CHECK (btrim("detail") <> ''),
  CONSTRAINT "founder_backer_data_status_value" CHECK (
    "status" IN ('open', 'approved', 'declined')
  ),
  /* A decision carries who made it, when, and what the Founder was told —
     all three or none. A decided row with no note is a refusal nobody can
     act on (§27.1). */
  CONSTRAINT "founder_backer_data_decision_pairing" CHECK (
    ("status" = 'open'
      AND "decided_at" IS NULL AND "decided_by" IS NULL AND "decision_note" IS NULL)
    OR ("status" <> 'open'
      AND "decided_at" IS NOT NULL
      AND btrim(coalesce("decided_by", '')) <> ''
      AND btrim(coalesce("decision_note", '')) <> '')
  )
);--> statement-breakpoint

/* One open ask per campaign. A Founder who asks twice while the first is
   undecided is asking twice, not asking again — 0056's own index. */
CREATE UNIQUE INDEX "founder_backer_data_one_open_idx"
  ON "founder_backer_data_requests" ("campaign_id")
  WHERE "status" = 'open';--> statement-breakpoint

CREATE INDEX "founder_backer_data_campaign_idx"
  ON "founder_backer_data_requests" ("campaign_id", "requested_at" DESC);--> statement-breakpoint

CREATE INDEX "founder_backer_data_open_idx"
  ON "founder_backer_data_requests" ("requested_at")
  WHERE "status" = 'open';--> statement-breakpoint

/* A decided request is final and the ask never changes. A service that edited
   the purpose after approval would have turned one decision into cover for a
   different question. */
CREATE OR REPLACE FUNCTION enforce_founder_backer_data_finality()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'open' THEN
    RAISE EXCEPTION 'that request was already decided and cannot change';
  END IF;
  IF NEW."campaign_id" IS DISTINCT FROM OLD."campaign_id"
     OR NEW."founder_user_id" IS DISTINCT FROM OLD."founder_user_id"
     OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
     OR NEW."detail" IS DISTINCT FROM OLD."detail"
     OR NEW."requested_at" IS DISTINCT FROM OLD."requested_at" THEN
    RAISE EXCEPTION 'a backer data request is immutable apart from its decision';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "founder_backer_data_final"
  BEFORE UPDATE ON "founder_backer_data_requests"
  FOR EACH ROW EXECUTE FUNCTION enforce_founder_backer_data_finality();--> statement-breakpoint

/* UPDATE on exactly the decision quartet by name. `purpose` and `detail` sit
   outside the grant as well as behind the trigger. DELETE is revoked: a request
   somebody answered is history. */
GRANT SELECT, INSERT ON "founder_backer_data_requests" TO "proovd_app";--> statement-breakpoint
GRANT UPDATE ("status", "decided_at", "decided_by", "decision_note") ON "founder_backer_data_requests" TO "proovd_app";--> statement-breakpoint
REVOKE DELETE ON "founder_backer_data_requests" FROM "proovd_app";--> statement-breakpoint
