CREATE TYPE "public"."invitation_delivery_method" AS ENUM('email', 'manual');--> statement-breakpoint
ALTER TABLE "campaign_invitation_sends"
  ADD COLUMN "delivery_method" "invitation_delivery_method" DEFAULT 'email' NOT NULL;
