-- ═══════════════════════════════════════════════════════════════════════════
-- 0056 — the Founder→Creator meeting request
-- Founder Dashboard Session C, deviation 1. `docs/phases/founder-dashboard.md`.
--
-- A RECORDED DEVIATION from §1 rule 6, by explicit product direction, sitting
-- beside three things §30 defers by name: Founder browsing of unmatched
-- Affiliates, a Founder–Creator meeting scheduler, and direct Founder–Affiliate
-- messaging. See `backend/src/db/schema/meetings.ts` for the full statement.
--
-- Every column, constraint, index and trigger here is `work_again_requests`'
-- (0036), rescoped. §22.9 is the one mediated Founder→Creator ask the product
-- already has, and copying its shape rather than inventing one is what makes
-- "is this a message or a scheduler" answerable by comparison.
--
-- What this table CANNOT hold is the deviation's narrowing, and it is checked
-- rather than intended:
--
--   * no scheduling column of any kind — no `scheduled_for`, `starts_at`,
--     `ends_at`, `duration`, `timezone`, `platform`, `meeting_url`,
--     `calendar_id`, `slot`. §12's Cal.com booking is the one scheduler
--     (tech-stack §12), and a second one is what §30 refuses.
--   * no second message. One `message`, immutable; one `response_note`. No
--     messages table, no reply column — the absence IS what keeps this from
--     being the direct messaging §30 defers.
--   * no contact column. The Creator's address never reaches the Founder (§11).
--   * no terms. No percentage, no amount, no eligibility — accepting is
--     agreeing to talk, and §14.2's three responses stay the only things that
--     move a number.
--
-- §25.8: none of its seven windows covers a mediated request between two
-- accounts, and `work_again_requests` is not swept either. Inventing a window
-- where the Spec fixes none would be §1 rule 6 in the other direction.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE "founder_meeting_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id"),
  "association_id" uuid NOT NULL REFERENCES "campaign_affiliate_associations"("id"),
  "founder_user_id" text NOT NULL,

  "status" text NOT NULL DEFAULT 'requested',
  "message" text NOT NULL,

  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "responded_at" timestamptz,
  "response_note" text,

  "created_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "founder_meeting_status_value" CHECK (
    "status" IN ('requested', 'accepted', 'declined', 'withdrawn')
  ),
  CONSTRAINT "founder_meeting_message_present" CHECK (btrim("message") <> ''),
  CONSTRAINT "founder_meeting_response_pairing" CHECK (
    ("status" = 'requested' AND "responded_at" IS NULL)
    OR ("status" <> 'requested' AND "responded_at" IS NOT NULL)
  )
);--> statement-breakpoint

/* One open ask per (campaign, Creator). A Founder who asks twice while the
   first is unanswered is asking twice, not asking again. */
CREATE UNIQUE INDEX "founder_meeting_one_open_idx"
  ON "founder_meeting_requests" ("campaign_id", "association_id")
  WHERE "status" = 'requested';--> statement-breakpoint

CREATE INDEX "founder_meeting_association_idx"
  ON "founder_meeting_requests" ("association_id", "requested_at" DESC);--> statement-breakpoint

/* The association must be the campaign's own, enforced at the database so a
   service bug cannot send one Founder's message to a Creator on somebody
   else's campaign. The service checks Founder ownership of the campaign first;
   this is the half a service cannot forget. */
CREATE OR REPLACE FUNCTION enforce_founder_meeting_scope()
RETURNS trigger AS $$
DECLARE
  v_campaign uuid;
BEGIN
  SELECT "campaign_id" INTO v_campaign
    FROM "campaign_affiliate_associations"
   WHERE "id" = NEW."association_id";

  IF v_campaign IS NULL THEN
    RAISE EXCEPTION 'a meeting request cites an association that does not exist';
  END IF;
  IF v_campaign <> NEW."campaign_id" THEN
    RAISE EXCEPTION 'that Creator is not on this campaign (§11)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "founder_meeting_scope"
  BEFORE INSERT ON "founder_meeting_requests"
  FOR EACH ROW EXECUTE FUNCTION enforce_founder_meeting_scope();--> statement-breakpoint

/* An answered request is final, and the message never changes. §22.9's own
   finality trigger: a Founder who wants to ask again opens a NEW request, and
   the Creator's earlier answer survives. This is also the mechanism that makes
   "one message, sent as written" true against a direct UPDATE — a service that
   edited the message after the fact would have made this a thread. */
CREATE OR REPLACE FUNCTION enforce_founder_meeting_finality()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'requested' THEN
    RAISE EXCEPTION 'that meeting request was already answered and cannot change';
  END IF;
  IF NEW."campaign_id" IS DISTINCT FROM OLD."campaign_id"
     OR NEW."association_id" IS DISTINCT FROM OLD."association_id"
     OR NEW."founder_user_id" IS DISTINCT FROM OLD."founder_user_id"
     OR NEW."message" IS DISTINCT FROM OLD."message"
     OR NEW."requested_at" IS DISTINCT FROM OLD."requested_at" THEN
    RAISE EXCEPTION 'a meeting request is immutable apart from its response';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "founder_meeting_final"
  BEFORE UPDATE ON "founder_meeting_requests"
  FOR EACH ROW EXECUTE FUNCTION enforce_founder_meeting_finality();--> statement-breakpoint

/* UPDATE is granted on exactly the response trio by name. `message` sits
   outside the grant as well as behind the trigger, so "one message, written
   once" is true twice over. DELETE is revoked: a request somebody answered is
   history. */
GRANT SELECT, INSERT ON "founder_meeting_requests" TO "proovd_app";--> statement-breakpoint
GRANT UPDATE ("status", "responded_at", "response_note") ON "founder_meeting_requests" TO "proovd_app";--> statement-breakpoint
REVOKE DELETE ON "founder_meeting_requests" FROM "proovd_app";--> statement-breakpoint
