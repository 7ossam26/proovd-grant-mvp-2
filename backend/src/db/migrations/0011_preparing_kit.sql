-- ── §10's Affiliate handoff and §31.5's pilot pre-view exception ───────────
--
-- §10: on `founder_signup_complete` the named campaign "appears automatically
-- in `preparing` state exactly once", and the Creator "may read the complete
-- currently available Founder/problem/solution/competition information and the
-- single Campaign kit."
--
-- §31.5 is what makes that legal, and it is narrow: "Pilot pre-view exception
-- allows the private authenticated preparing kit before agreement, but creates
-- no work permission; access is logged/revocable and the agreement remains
-- mandatory before work."
--
-- Four columns and one table implement the four adjectives. Private and
-- authenticated are the route's job; LOGGED is `campaign_kit_access`;
-- REVOCABLE is `kit_access_revoked_at`; and "exactly once" is
-- `preparing_revealed_at` beside the idempotency key and the conditional
-- status UPDATE.

ALTER TABLE "campaign_affiliate_associations" ADD COLUMN "preparing_revealed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_affiliate_associations" ADD COLUMN "kit_access_revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_affiliate_associations" ADD COLUMN "kit_access_revoked_reason" text;--> statement-breakpoint
ALTER TABLE "campaign_affiliate_associations" ADD COLUMN "kit_access_revoked_by" text;--> statement-breakpoint

-- ── The access log (§10 "Every access is logged", §31.5) ───────────────────
-- Insert-only, like `audit_events`. This is the evidence that the exception was
-- operated as described — a log a later statement could edit is not evidence of
-- anything, and §31.5's whole justification rests on it being true.
--
-- It records who opened what and when, and nothing about the content: the kit
-- is the Founder's confidential material, and copying it into a log row would
-- put a second copy somewhere insert-only that no revocation could reach.
CREATE TABLE "campaign_kit_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"affiliate_user_id" text NOT NULL,
	"section" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_kit_access" ADD CONSTRAINT "campaign_kit_access_association_fk" FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_kit_access" ADD CONSTRAINT "campaign_kit_access_campaign_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_kit_access_association_idx" ON "campaign_kit_access" USING btree ("association_id","occurred_at");--> statement-breakpoint
CREATE INDEX "campaign_kit_access_campaign_idx" ON "campaign_kit_access" USING btree ("campaign_id","occurred_at");--> statement-breakpoint

-- ── Revocation is one-way (§10: "Revocation removes it immediately") ───────
-- Clearing the stamp would restore access to confidential material silently,
-- and an access grant nobody consciously made is exactly what §31.5's exception
-- cannot survive. Re-granting is deliberately not built: §1 rule 6 forbids
-- inventing a flow the Spec does not describe, and a later phase that needs one
-- has to add it on purpose.
CREATE OR REPLACE FUNCTION enforce_kit_revocation_irreversible()
RETURNS trigger AS $$
BEGIN
  IF OLD.kit_access_revoked_at IS NOT NULL THEN
    IF NEW.kit_access_revoked_at IS NULL THEN
      RAISE EXCEPTION 'campaign_affiliate_associations.kit_access_revoked_at cannot be cleared';
    END IF;
    IF NEW.kit_access_revoked_at <> OLD.kit_access_revoked_at THEN
      RAISE EXCEPTION 'campaign_affiliate_associations.kit_access_revoked_at cannot be changed';
    END IF;
  END IF;
  -- The reveal stamp is equally one-way: §10 says the campaign appears
  -- "exactly once", and a stamp that could be cleared is a second reveal
  -- waiting to happen.
  IF OLD.preparing_revealed_at IS NOT NULL AND NEW.preparing_revealed_at IS DISTINCT FROM OLD.preparing_revealed_at THEN
    RAISE EXCEPTION 'campaign_affiliate_associations.preparing_revealed_at is set once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER kit_revocation_irreversible
  BEFORE UPDATE ON "campaign_affiliate_associations"
  FOR EACH ROW EXECUTE FUNCTION enforce_kit_revocation_irreversible();--> statement-breakpoint

GRANT SELECT, INSERT ON "campaign_kit_access" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "campaign_kit_access" FROM proovd_app;
