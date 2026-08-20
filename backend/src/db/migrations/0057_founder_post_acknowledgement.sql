-- ═══════════════════════════════════════════════════════════════════════════
-- 0057 — the Founder's acknowledgement of a Creator's campaign post
-- Founder Dashboard Session D, deviation 2. `docs/phases/founder-dashboard.md`.
--
-- A RECORDED DEVIATION from §1 rule 6, by explicit product direction. The
-- reference's `Like it` control toasts "Liked — creator will see it", which
-- makes it a MESSAGE — and §30 defers "Direct Founder–Affiliate messaging"
-- while §11 says "The Founder cannot contact the Affiliate directly." See
-- `backend/src/db/schema/posts.ts` for the full statement.
--
-- What this table CANNOT hold is the narrowing, and it is checked rather than
-- intended:
--
--   * no free text of any kind — no `note`, `body`, `comment`, `text`,
--     `message`, `reason`. The absence IS what keeps this from being the
--     direct messaging §30 defers.
--   * no undo. No `withdrawn_at`, no `removed_at`, no UPDATE grant, no DELETE
--     grant. A message that was sent cannot be unsent, and §27.2's dedup means
--     re-acknowledging sends nothing — so a toggle would be a control that
--     quietly does less than it offers.
--   * no decision. No amount, no percentage, no verification, no eligibility.
--     §17's post verification is Admin's and nothing here touches it.
--   * no contact column. The Creator's address never reaches the Founder (§11).
--
-- §25.8: none of its seven windows covers an acknowledgement between two
-- accounts, and neither `work_again_requests` (0036) nor `founder_meeting_
-- requests` (0056) is swept. Inventing a window where the Spec fixes none would
-- be §1 rule 6 in the other direction.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE "founder_post_acknowledgements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id"),
  "association_id" uuid NOT NULL REFERENCES "campaign_affiliate_associations"("id"),
  "submission_id" uuid NOT NULL REFERENCES "creator_post_submissions"("id"),
  "founder_user_id" text NOT NULL,

  "acknowledged_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

/* One per (post, Founder). A second click is the same acknowledgement, not a
   second one — and the §27 message dedups on the submission besides. */
CREATE UNIQUE INDEX "founder_post_ack_one_idx"
  ON "founder_post_acknowledgements" ("submission_id", "founder_user_id");--> statement-breakpoint

CREATE INDEX "founder_post_ack_campaign_idx"
  ON "founder_post_acknowledgements" ("campaign_id", "acknowledged_at" DESC);--> statement-breakpoint

/* The post, the association and the campaign must agree, enforced at the
   database so a service bug cannot attach one Founder's acknowledgement to a
   post on somebody else's campaign. The service checks Founder ownership of the
   campaign first; this is the half a service cannot forget — 0056's own
   arrangement. */
CREATE OR REPLACE FUNCTION enforce_founder_post_ack_scope()
RETURNS trigger AS $$
DECLARE
  v_campaign uuid;
  v_association uuid;
BEGIN
  SELECT "campaign_id", "association_id" INTO v_campaign, v_association
    FROM "creator_post_submissions"
   WHERE "id" = NEW."submission_id";

  IF v_campaign IS NULL THEN
    RAISE EXCEPTION 'an acknowledgement cites a post that does not exist';
  END IF;
  IF v_campaign <> NEW."campaign_id" THEN
    RAISE EXCEPTION 'that post is not on this campaign (§11)';
  END IF;
  IF v_association <> NEW."association_id" THEN
    RAISE EXCEPTION 'that post was not submitted by that Creator';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "founder_post_ack_scope"
  BEFORE INSERT ON "founder_post_acknowledgements"
  FOR EACH ROW EXECUTE FUNCTION enforce_founder_post_ack_scope();--> statement-breakpoint

/* Insert-only in the strong sense: neither UPDATE nor DELETE is granted, so
   "one-way" is the database's answer rather than a service's discipline. There
   is no column an UPDATE could usefully move anyway — which is the point. */
GRANT SELECT, INSERT ON "founder_post_acknowledgements" TO "proovd_app";--> statement-breakpoint
REVOKE UPDATE, DELETE ON "founder_post_acknowledgements" FROM "proovd_app";--> statement-breakpoint
