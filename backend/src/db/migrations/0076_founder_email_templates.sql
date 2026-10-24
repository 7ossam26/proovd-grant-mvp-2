-- Shared Founder onboarding copy; all edits are audited in the same transaction.
CREATE TABLE "founder_email_templates" (
  "key" text PRIMARY KEY,
  "copy" jsonb NOT NULL CHECK (jsonb_typeof("copy") = 'object'),
  "version" integer NOT NULL CHECK ("version" > 0),
  "updated_by" text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "change_note" text NOT NULL,
  CONSTRAINT "founder_email_templates_known_key" CHECK ("key" IN (
    'founder_invitation', 'founder_email_code', 'founder_application_review_received',
    'founder_application_information_needed', 'founder_application_changes_requested',
    'founder_application_approved', 'founder_application_rejected'
  ))
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "founder_email_templates" TO "proovd_app";
--> statement-breakpoint
REVOKE DELETE ON "founder_email_templates" FROM "proovd_app";
