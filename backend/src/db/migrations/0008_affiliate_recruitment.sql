CREATE TYPE "public"."affiliate_subtype" AS ENUM('social_creator', 'newsletter_blog_operator', 'podcast_host', 'community_owner', 'course_instructor', 'student_affiliate', 'niche_marketer');--> statement-breakpoint
CREATE TYPE "public"."affiliate_verification_status" AS ENUM('unverified', 'in_review', 'verified', 'rejected');--> statement-breakpoint
CREATE TABLE "affiliate_prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text,
	"public_handle" text,
	"email" text,
	"phone" text,
	"subtype" "affiliate_subtype",
	"channel_reference" text,
	"audience_niche" text,
	"campaign_fit" text,
	"audience_size" text,
	"engagement_evidence" jsonb,
	"audience_demographics" text,
	"permission_basis" text,
	"prior_sponsored_content" text,
	"admin_bio" text,
	"quality_tier" text,
	"verification_status" "affiliate_verification_status" DEFAULT 'unverified' NOT NULL,
	"verification_evidence" jsonb,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"conflict_notes" text,
	"sanctions_notes" text,
	"internal_comments" text,
	"recruitment_source" text,
	"recruiting_admin" text,
	"claimed_user_id" text,
	"claimed_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "affiliate_invitation_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"recipient_email" text,
	"recipient_name" text,
	"sender_name" text NOT NULL,
	"sender_email" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notification_id" text,
	"token_id" uuid NOT NULL,
	"token_version" integer NOT NULL,
	"token_expires_at" timestamp with time zone,
	"status" "invitation_status" NOT NULL,
	"sent_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "affiliate_invitation_sends" ADD CONSTRAINT "affiliate_invitation_sends_association_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_invitation_sends" ADD CONSTRAINT "affiliate_invitation_sends_prospect_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."affiliate_prospects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_invitation_sends" ADD CONSTRAINT "affiliate_invitation_sends_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "affiliate_prospects_email_idx" ON "affiliate_prospects" USING btree ("email");--> statement-breakpoint
CREATE INDEX "affiliate_prospects_claimed_idx" ON "affiliate_prospects" USING btree ("claimed_user_id");--> statement-breakpoint
CREATE INDEX "affiliate_prospects_subtype_idx" ON "affiliate_prospects" USING btree ("subtype");--> statement-breakpoint
CREATE INDEX "affiliate_sends_association_sent_idx" ON "affiliate_invitation_sends" USING btree ("association_id","sent_at");--> statement-breakpoint
CREATE INDEX "affiliate_sends_prospect_idx" ON "affiliate_invitation_sends" USING btree ("prospect_id");--> statement-breakpoint

-- ── §25.4's per-campaign recruitment facts on the association ──────────────
-- §25.4 splits the Affiliate record into an account section and a "Per
-- campaign" section whose first entry is "Recruitment source/Admin/timing and
-- invitation events." Those live on the association, because the same person
-- recruited to a second campaign was recruited to it differently — by a
-- possibly different Admin, from a different source, on a different day.
ALTER TABLE "campaign_affiliate_associations" ADD COLUMN "prospect_id" uuid;--> statement-breakpoint
ALTER TABLE "campaign_affiliate_associations" ADD COLUMN "recruitment_source" text;--> statement-breakpoint
ALTER TABLE "campaign_affiliate_associations" ADD COLUMN "recruiting_admin" text;--> statement-breakpoint
ALTER TABLE "campaign_affiliate_associations" ADD COLUMN "recruited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_affiliate_associations" ADD COLUMN "invitation_status" "invitation_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint

-- The composed invitation content (§8). Per campaign, not per person: the same
-- Creator recruited to a second campaign is being told something different, and
-- storing this on the prospect would overwrite the first one's reasoning.
ALTER TABLE "campaign_affiliate_associations" ADD COLUMN "why_recruited" text;--> statement-breakpoint
ALTER TABLE "campaign_affiliate_associations" ADD COLUMN "reviewed_presence" text;--> statement-breakpoint
ALTER TABLE "campaign_affiliate_associations" ADD COLUMN "sender_name" text;--> statement-breakpoint
ALTER TABLE "campaign_affiliate_associations" ADD COLUMN "sender_email" text;--> statement-breakpoint
ALTER TABLE "campaign_affiliate_associations" ADD CONSTRAINT "associations_prospect_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."affiliate_prospects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "associations_prospect_idx" ON "campaign_affiliate_associations" USING btree ("prospect_id");--> statement-breakpoint

-- §11: "The Affiliate remains tied to the one campaign that caused the
-- invitation." One association per (campaign, prospect). Recruiting the same
-- Creator to the same campaign twice is a mistake, not a second relationship;
-- without this it would produce two invitations and two independent statuses
-- for one person, and §8 allows exactly one invitation per association.
CREATE UNIQUE INDEX "associations_campaign_prospect_idx"
  ON "campaign_affiliate_associations" ("campaign_id", "prospect_id")
  WHERE "prospect_id" IS NOT NULL;--> statement-breakpoint

-- ── The third token scope (§8, §11, §33.2.1) ───────────────────────────────
-- The enum value is added HERE and first used in 0009. Postgres refuses to use
-- a new enum label in the transaction that added it, and the Drizzle migrator
-- runs one transaction per file — so the scope-binding CHECK that references
-- 'affiliate_invitation' has to be the next migration, not the next statement.
ALTER TYPE "public"."token_scope" ADD VALUE IF NOT EXISTS 'affiliate_invitation';--> statement-breakpoint
ALTER TABLE "secure_tokens" ADD COLUMN "association_id" uuid;--> statement-breakpoint
CREATE INDEX "secure_tokens_association_idx" ON "secure_tokens" USING btree ("association_id");--> statement-breakpoint

-- ── Grants ────────────────────────────────────────────────────────────────
-- The prospect is edited throughout recruitment, so UPDATE is granted; DELETE
-- is not, for the same reason it is not on `founder_prospects` — an audit row
-- referencing a prospect that no longer exists is not evidence of anything.
GRANT SELECT, INSERT, UPDATE ON "affiliate_prospects" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "affiliate_prospects" FROM proovd_app;--> statement-breakpoint

-- ── The send record is append-only (§8, and §7's reasoning) ────────────────
-- This is the record that answers "when was this Creator last invited, with
-- which token version, by whom". A row a later statement could edit is not an
-- invitation history. `notification_id` is granted BY NAME because the send row
-- lands before the provider call and is confirmed after it — the same ordering
-- the Founder invitation uses, and for the same crash-shaped reason. `sent_at`,
-- `token_version`, `association_id`, and `status` are outside every grant.
--
-- `recipient_email` and `recipient_name` are granted for the retention sweep,
-- which does not run against these rows in Phase 08a — there is no Affiliate
-- draft content yet — but the columns are the ones a sweep would have to null,
-- and granting them here keeps the grant beside the columns it describes.
GRANT SELECT, INSERT ON "affiliate_invitation_sends" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "affiliate_invitation_sends" FROM proovd_app;--> statement-breakpoint
GRANT UPDATE ("notification_id", "recipient_email", "recipient_name") ON "affiliate_invitation_sends" TO proovd_app;--> statement-breakpoint

-- ── The quality tier can never become a commission floor (§8) ──────────────
-- §8: "Internal quality tier, used only as assessment data—not as a commission
-- floor." The column is TEXT rather than an enum or an integer precisely so
-- there is nothing in it to rank or multiply.
--
-- This constraint closes the remaining door: a tier that is *only* digits would
-- be one cast away from being a number, and the first phase that needs a
-- default percentage would find one sitting here. Refusing a purely numeric
-- tier means the column cannot quietly become a rate. §1 rule 6 forbids
-- inventing a commercial rule; this makes inventing one by accident impossible.
ALTER TABLE "affiliate_prospects" ADD CONSTRAINT "affiliate_quality_tier_not_numeric" CHECK (
  "quality_tier" IS NULL
  OR btrim("quality_tier") !~ '^[0-9]+([.,][0-9]+)?%?$'
);
