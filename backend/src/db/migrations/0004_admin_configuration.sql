CREATE TYPE "public"."prerequisite_status" AS ENUM('satisfied', 'not_satisfied');--> statement-breakpoint
CREATE TYPE "public"."setting_kind" AS ENUM('money_cents', 'percent', 'count', 'calendar_days', 'business_days', 'hours', 'seconds', 'months', 'boolean', 'text_list', 'text');--> statement-breakpoint
CREATE TYPE "public"."setting_provenance" AS ENUM('specified', 'operator', 'derived');--> statement-breakpoint
CREATE TABLE "app_setting_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"prior_value" text,
	"new_value" text,
	"changed_by" text NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"kind" "setting_kind" NOT NULL,
	"provenance" "setting_provenance" NOT NULL,
	"minimum" integer,
	"maximum" integer,
	"spec_ref" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text NOT NULL,
	"update_reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_prerequisites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prerequisite_key" text NOT NULL,
	"status" "prerequisite_status" NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text NOT NULL,
	"evidence_links" jsonb
);
--> statement-breakpoint
CREATE INDEX "app_setting_versions_key_idx" ON "app_setting_versions" USING btree ("key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "app_setting_versions_identity_idx" ON "app_setting_versions" USING btree ("key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "app_settings_key_idx" ON "app_settings" USING btree ("key");--> statement-breakpoint
CREATE INDEX "production_prerequisites_key_idx" ON "production_prerequisites" USING btree ("prerequisite_key","recorded_at");--> statement-breakpoint
-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written section (phase 06). drizzle-kit does not generate CHECK
-- constraints, grants, triggers, or seed rows — these are maintained here by
-- hand and kept under review. Do not regenerate over them.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── A setting §6 fixes a value for always has one ──────────────────────────
-- `operator` settings are the ones §6 names while fixing no number — approved
-- campaign min/max duration, the interview roster, the Admin reauthentication
-- window. Those may be NULL, and being NULL is what blocks them (§6:
-- "Incomplete prerequisites fail closed"). Everything else carries the value
-- §6 states, or the value the committed calendar states, and a NULL there is a
-- commercial rule that has gone missing.
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_value_matches_provenance" CHECK (
  "provenance" = 'operator' OR "value" IS NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_version_positive" CHECK ("version" >= 1);--> statement-breakpoint
--
-- ── Change history is a trigger, not a service call (§25.6) ────────────────
-- This is the table the listing fee, the platform fee, the Proovd 5%, and
-- every deadline in the system are read from. §25.6 requires actor, reason,
-- prior value, new value, and time on every high-impact change, and a service
-- that writes the history row is a service one careless UPDATE can bypass.
--
-- Three things are enforced here that application code cannot be trusted to
-- remember:
--
--   1. Identity is immutable. A key names a commercial rule; repointing one at
--      a different rule while keeping the name is how the wrong number gets
--      read by the right consumer.
--   2. A `derived` value cannot be edited. The holiday-calendar version and
--      its timezone come from a committed artifact, and §29.6 forbids an edit
--      silently resetting a deadline that was already computed and promised. A
--      new calendar is a new committed version and a new deployment.
--   3. `version` is the trigger's to set. A caller that could choose its own
--      version could overwrite a history row's identity.
CREATE OR REPLACE FUNCTION enforce_app_setting_change() RETURNS trigger AS $fn$
BEGIN
  IF NEW."key"        IS DISTINCT FROM OLD."key"
  OR NEW."kind"       IS DISTINCT FROM OLD."kind"
  OR NEW."provenance" IS DISTINCT FROM OLD."provenance"
  THEN
    RAISE EXCEPTION 'app_settings identity is immutable; a setting key names a commercial rule'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."provenance" = 'derived' AND NEW."value" IS DISTINCT FROM OLD."value" THEN
    RAISE EXCEPTION 'a derived setting is not editable; it follows its committed artifact (§29.6)'
      USING ERRCODE = '23514';
  END IF;

  NEW."version"    := OLD."version" + 1;
  NEW."updated_at" := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER app_settings_enforce_change
  BEFORE UPDATE ON "app_settings"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_app_setting_change();--> statement-breakpoint
--
-- The history row itself. Unskippable because `updated_by` and
-- `update_reason` are NOT NULL on the row being written — an update that does
-- not say who and why never reaches this trigger, because it never commits.
CREATE OR REPLACE FUNCTION record_app_setting_version() RETURNS trigger AS $fn$
BEGIN
  INSERT INTO "app_setting_versions"
    ("key", "version", "prior_value", "new_value", "changed_by", "reason")
  VALUES (
    NEW."key",
    NEW."version",
    CASE WHEN TG_OP = 'UPDATE' THEN OLD."value" ELSE NULL END,
    NEW."value",
    NEW."updated_by",
    NEW."update_reason"
  );
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER app_settings_record_version
  AFTER INSERT OR UPDATE ON "app_settings"
  FOR EACH ROW
  EXECUTE FUNCTION record_app_setting_version();--> statement-breakpoint
--
-- ── Application role grants ────────────────────────────────────────────────
-- proovd_app is created in 0001. Settings are read and updated; they are never
-- inserted by the application (the register decides which settings exist) and
-- never deleted (a deleted setting is a commercial rule that vanished without
-- a history row).
GRANT SELECT, UPDATE ON "app_settings" TO proovd_app;--> statement-breakpoint
REVOKE INSERT, DELETE ON "app_settings" FROM proovd_app;--> statement-breakpoint
-- History and attestations are INSERT-only, exactly like audit_events (§25.6).
GRANT SELECT, INSERT ON "app_setting_versions", "production_prerequisites" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "app_setting_versions", "production_prerequisites" FROM proovd_app;--> statement-breakpoint
--
-- ── The §6 operating constants ─────────────────────────────────────────────
-- Every row mirrors shared/src/settings/registry.ts, and
-- src/tests/admin-settings.test.ts fails the suite if the two diverge — the
-- same drift guard the policy register and the state enums use.
--
-- A NULL value is not missing data. It is a setting §6 names while fixing no
-- number, and §1 rule 6 forbids inventing one, so it ships unset and blocks
-- until an operator states it. `admin_reauth_window_seconds` is additionally
-- seeded from ADMIN_REAUTH_WINDOW_SECONDS on first boot, because the app has
-- to start before an Admin can configure anything.
INSERT INTO "app_settings" ("key", "value", "kind", "provenance", "minimum", "maximum", "spec_ref", "updated_by", "update_reason")
SELECT seed.key, seed.value, seed.kind::"setting_kind", seed.provenance::"setting_provenance",
       seed.minimum, seed.maximum, seed.spec_ref,
       'system:migration',
       'seeded from the §6 register at migration 0004'
FROM (VALUES
  ('listing_fee_base_cents',                   '3500',                                                                 'money_cents',   'specified',  0,    NULL, '§6 · Listing-fee base: US$35'),
  ('listing_fee_item_discount_cents',          '200',                                                                  'money_cents',   'specified',  0,    NULL, '§6 · US$2 per completed Visuals, Branding, confirmed Founder interview, Story, Socials'),
  ('listing_fee_max_discount_cents',           '1000',                                                                 'money_cents',   'specified',  0,    NULL, '§6 · Maximum discount: US$10'),
  ('listing_fee_min_cents',                    '2500',                                                                 'money_cents',   'specified',  0,    NULL, '§6 · Minimum listing fee: US$25'),
  ('platform_fee_percent',                     '5',                                                                    'percent',       'specified',  0,    100,  '§6 · Platform fee: 5% of captured pre-tax reward subtotal'),
  ('affiliate_base_percent_standard',          '30',                                                                   'percent',       'specified',  0,    100,  '§6 · Base Affiliate percentages: 30%'),
  ('affiliate_base_percent_with_fixed',        '20',                                                                   'percent',       'specified',  0,    100,  '§6 · 20% when an accepted Product-Campaign fixed Creator payment exists'),
  ('affiliate_percentage_ceiling',             '50',                                                                   'percent',       'specified',  0,    100,  '§6 · Percentage compensation ceiling: 50% per attributed captured charge'),
  ('high_effort_inputs',                       E'visuals_absent\nbranding_absent\nfounder_interview_absent',           'text_list',     'specified',  NULL, NULL, '§6 · High-effort inputs: no Visuals, no Branding, no confirmed/scheduled Founder interview'),
  ('campaign_cap_cents',                       '5000000',                                                              'money_cents',   'specified',  0,    NULL, '§6 · Campaign cap: US$50,000 aggregate pre-tax active-pre-order value'),
  ('product_default_duration_days',            '14',                                                                   'calendar_days', 'specified',  1,    NULL, '§6 · Product Campaign default duration: 14 days'),
  ('product_min_duration_days',                NULL,                                                                   'calendar_days', 'operator',   1,    NULL, '§6 · approved min/max duration'),
  ('product_max_duration_days',                NULL,                                                                   'calendar_days', 'operator',   1,    NULL, '§6 · approved min/max duration'),
  ('capture_retry_window_hours',               '48',                                                                   'hours',         'specified',  1,    NULL, '§6 · Failed-payment retry window: fixed 48 hours'),
  ('precharge_reminder_lead_hours',            '24',                                                                   'hours',         'specified',  1,    NULL, '§6 · Pre-charge reminder: approximately 24 hours before trigger'),
  ('affiliate_response_window_hours',          '72',                                                                   'hours',         'specified',  1,    NULL, '§6 · Affiliate formal-response window: fixed 72 hours from listing_paid_at'),
  ('founder_free_cancellation_window_hours',   '48',                                                                   'hours',         'specified',  1,    NULL, '§6 · Founder free-cancellation window: 48 hours from listing_paid_at, only while not live'),
  ('creator_replacement_window_business_days', '3',                                                                    'business_days', 'specified',  1,    NULL, '§6 · Creator replacement window: three US business days from creator_failure_recorded_at'),
  ('founder_cooldown_months',                  '3',                                                                    'months',        'specified',  3,    NULL, '§6 · Founder repeat-campaign cooldown: at least three months'),
  ('business_day_calendar_version',            'us-federal.v1',                                                        'text',          'derived',    NULL, NULL, '§6 · US business-day calendar, timezone, holiday version'),
  ('business_day_time_zone',                   'America/New_York',                                                     'text',          'derived',    NULL, NULL, '§6 · US business-day calendar, timezone, holiday version'),
  ('idea_single_payment_day',                  '3',                                                                    'calendar_days', 'specified',  0,    NULL, '§6 · Founder payment schedules: Idea 100% Day 3'),
  ('idea_single_payment_percent',              '100',                                                                  'percent',       'specified',  0,    100,  '§6 · Founder payment schedules: Idea 100% Day 3'),
  ('product_first_payment_day',                '3',                                                                    'calendar_days', 'specified',  0,    NULL, '§6 · Founder payment schedules: Product 40% Day 3 / 60% Day 14'),
  ('product_first_payment_percent',            '40',                                                                   'percent',       'specified',  0,    100,  '§6 · Founder payment schedules: Product 40% Day 3 / 60% Day 14'),
  ('product_remaining_payment_day',            '14',                                                                   'calendar_days', 'specified',  0,    NULL, '§6 · Founder payment schedules: Product 40% Day 3 / 60% Day 14'),
  ('product_remaining_payment_percent',        '60',                                                                   'percent',       'specified',  0,    100,  '§6 · Founder payment schedules: Product 40% Day 3 / 60% Day 14'),
  ('product_early_remaining_payment_enabled',  'false',                                                                'boolean',       'specified',  NULL, NULL, '§6 · Product early-remaining-payment control, disabled by default and evidence-gated'),
  ('required_promotional_posts',               '3',                                                                    'count',         'specified',  1,    NULL, '§6 · Default required promotional post count: three'),
  ('interview_providers',                      NULL,                                                                   'text_list',     'operator',   NULL, NULL, '§6 · Interview providers'),
  ('interview_availability',                   NULL,                                                                   'text',          'operator',   NULL, NULL, '§6 · interview availability'),
  ('interviewers',                             NULL,                                                                   'text_list',     'operator',   NULL, NULL, '§6 · interviewers'),
  ('interview_reminder_lead_hours',            NULL,                                                                   'hours',         'operator',   1,    NULL, '§6 · reminder lead times'),
  ('support_sla_business_days',                '1',                                                                    'business_days', 'specified',  1,    NULL, '§6 · Support SLA: one business day, Monday–Friday excluding US federal holidays'),
  ('admin_mfa_required',                       'true',                                                                 'boolean',       'specified',  NULL, NULL, '§6 · Admin MFA and reauthentication window'),
  ('admin_reauth_window_seconds',              NULL,                                                                   'seconds',       'operator',   1,    NULL, '§6 · Admin MFA and reauthentication window')
) AS seed(key, value, kind, provenance, minimum, maximum, spec_ref);