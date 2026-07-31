CREATE TYPE "public"."proovd_role" AS ENUM('admin', 'founder', 'affiliate');--> statement-breakpoint
CREATE TYPE "public"."token_revocation_reason" AS ENUM('superseded_by_rotation', 'claimed', 'admin_revoked', 'expired', 'security_reissue', 'draft_anonymised');--> statement-breakpoint
CREATE TYPE "public"."token_scope" AS ENUM('founder_draft', 'backer_magic_link');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "proovd_role" NOT NULL,
	"phone" text,
	"phone_verified" boolean DEFAULT false NOT NULL,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secure_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "token_scope" NOT NULL,
	"token_hash" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"lineage_id" uuid NOT NULL,
	"supersedes_token_id" uuid,
	"campaign_draft_id" uuid,
	"campaign_id" uuid,
	"backer_identity_id" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" "token_revocation_reason",
	"claimed_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_idx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_idx" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factor_user_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_idx" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "user_role_idx" ON "user" USING btree ("role");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "secure_tokens_hash_idx" ON "secure_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "secure_tokens_lineage_idx" ON "secure_tokens" USING btree ("lineage_id","version");--> statement-breakpoint
CREATE INDEX "secure_tokens_campaign_idx" ON "secure_tokens" USING btree ("campaign_id","scope");--> statement-breakpoint
CREATE INDEX "secure_tokens_draft_idx" ON "secure_tokens" USING btree ("campaign_draft_id");--> statement-breakpoint
-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written section (phase 04). drizzle-kit does not generate CHECK
-- constraints, partial indexes, roles, or grants — these are maintained here
-- by hand and kept under review. Do not regenerate over them.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Token scope binding (§28.1) ────────────────────────────────────────────
-- "Scope to exactly one draft or one Backer/campaign identity." A token not
-- bound to a specific entity is a token that grants broad access, which is the
-- failure §28.1 exists to prevent. Written out at the bottom of
-- backend/src/db/schema/tokens.ts.
ALTER TABLE "secure_tokens" ADD CONSTRAINT "secure_tokens_scope_binding" CHECK (
  ("scope" = 'founder_draft'
     AND "campaign_draft_id" IS NOT NULL
     AND "campaign_id" IS NULL
     AND "backer_identity_id" IS NULL)
  OR
  ("scope" = 'backer_magic_link'
     AND "campaign_draft_id" IS NULL
     AND "campaign_id" IS NOT NULL
     AND "backer_identity_id" IS NOT NULL)
);--> statement-breakpoint
-- ── One live token per lineage (§7, §33.1.2) ───────────────────────────────
-- This partial unique index is what makes "two concurrent claims yield one
-- account and one failed safe response" a database guarantee rather than an
-- application race. Rotation must revoke before it issues, so a
-- half-completed rotation cannot commit.
CREATE UNIQUE INDEX "secure_tokens_one_live_per_lineage"
  ON "secure_tokens" ("lineage_id")
  WHERE "revoked_at" IS NULL AND "claimed_at" IS NULL;--> statement-breakpoint
-- ── Phone is never verified (§5.2, §5.3, §33.1.8) ──────────────────────────
-- "Phone is collected and explicitly unverified; no SMS OTP exists." Pinning
-- the column false means no later code path can mark a phone verified without
-- first building a verification mechanism the Spec does not have.
ALTER TABLE "user" ADD CONSTRAINT "user_phone_never_verified"
  CHECK ("phone_verified" = false);--> statement-breakpoint
-- ── Application role grants ────────────────────────────────────────────────
-- proovd_app is created in 0001. Better Auth reads and writes its own tables
-- through the same connection, so it gets full DML there.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "user",
  "session",
  "account",
  "verification",
  "two_factor"
  TO proovd_app;--> statement-breakpoint
-- secure_tokens: rows are issued, used, revoked, and claimed — never deleted.
-- Retention anonymises draft *content* (§7); the token row itself stays as the
-- "minimum audit evidence" that section requires.
GRANT SELECT, INSERT, UPDATE ON "secure_tokens" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "secure_tokens" FROM proovd_app;--> statement-breakpoint
-- ── A token hash is write-once (§28.1) ─────────────────────────────────────
-- Rotation issues a new row; it never rewrites an existing hash, scope, or
-- lineage. Enforcing that in the database closes the path where a token is
-- silently repointed at another Founder's draft or another Backer's campaign
-- while keeping its delivered URL alive — the cross-scope access §33.1.2 tests.
CREATE OR REPLACE FUNCTION enforce_secure_token_immutability() RETURNS trigger AS $fn$
BEGIN
  IF NEW."token_hash"         IS DISTINCT FROM OLD."token_hash"
  OR NEW."scope"              IS DISTINCT FROM OLD."scope"
  OR NEW."lineage_id"         IS DISTINCT FROM OLD."lineage_id"
  OR NEW."version"            IS DISTINCT FROM OLD."version"
  OR NEW."campaign_draft_id"  IS DISTINCT FROM OLD."campaign_draft_id"
  OR NEW."campaign_id"        IS DISTINCT FROM OLD."campaign_id"
  OR NEW."backer_identity_id" IS DISTINCT FROM OLD."backer_identity_id"
  THEN
    RAISE EXCEPTION 'secure_tokens identity and scope are immutable; rotate instead'
      USING ERRCODE = '23514';
  END IF;
  -- A claim is historical. §23: "a successful SetupIntent stays historical even
  -- after the reservation is canceled" — the same rule applies to a consumed
  -- token, so claimed_at can be set once and never cleared or moved.
  IF OLD."claimed_at" IS NOT NULL AND NEW."claimed_at" IS DISTINCT FROM OLD."claimed_at" THEN
    RAISE EXCEPTION 'secure_tokens.claimed_at is append-only'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER secure_tokens_immutable_identity
  BEFORE UPDATE ON "secure_tokens"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_secure_token_immutability();