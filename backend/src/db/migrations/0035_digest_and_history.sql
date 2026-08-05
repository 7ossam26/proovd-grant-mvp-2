-- Phase 22c — the optional digest preference and the notification history
-- (§27.7, §30, DNA §5.2, §5.5).
--
-- What the database itself guarantees here:
--
--   * a preference EXISTS only because a person chose it. There is no default
--     frequency, no backfill, and no row shape that means "we assumed". §30
--     forbids prechecked optional consent, and the absence of a row is what
--     makes §27.7's "Backer selects preference at first magic-link visit"
--     answerable at all — no row is "has not chosen", and `off` is a choice;
--   * every choice and every change is kept. The history is written by TRIGGER
--     rather than by the service, so a careless `db.update()` cannot skip it —
--     the same reasoning as `app_setting_versions` (06a), `optional_item_events`
--     (09a), and `draft_field_edits` (07). The digest is the one email a person
--     can turn off, so "did they ask for this" is a fact we may have to prove;
--   * a preference cannot change WHO it belongs to. Audience and subject are
--     immutable by trigger; re-pointing a preference at another account would
--     move one person's choice onto another person's inbox;
--   * exactly one subject per row, matching the audience. A Founder or Creator
--     preference carries a user; a Backer preference carries a `backer_identity`
--     — which is campaign-scoped by §4.1, so a Backer's choice is per-campaign
--     and the schema says so rather than implying a cross-campaign person
--     record that deliberately does not exist (§5.4, §28.1).
--
-- What is deliberately ABSENT:
--
--   * any table storing digest CONTENT. A digest is composed at send time from
--     `campaign_updates`, `campaign_comments`, and `association_status_history`
--     — records that are already durable. A second copy is 16b's drifting
--     second-store trap, and here the drift would be a person reading a summary
--     of something that has since been removed;
--   * any unread counter, any `last_opened_at`, any streak column. §27.7 says
--     notification history must not turn the Founder home into a dashboard and
--     DNA §5.5 replaces notification pressure with anticipation; an unread badge
--     is that pressure, and a column to hold it is how it arrives.
--
-- The history itself needs NO new table: `notification_deliveries` already
-- records event, recipient, entity, provider id, and confirmation. It gains an
-- index, because the dedup index leads with `event_key` and every §27.7 read is
-- by recipient over a time window.

-- ── notification_digest_preferences (§27.7) ─────────────────────────────────
CREATE TABLE "notification_digest_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  -- §27.7 gives the preference to three roles. Admin reads history and receives
  -- no digest, so there is no `admin` value to set.
  "audience" text NOT NULL,

  -- Exactly one of these, decided by the audience. Same shape as
  -- `secure_tokens`' scope binding (0009): the alternative — one nullable
  -- "subject id" with no type — makes a Backer identity and a user id
  -- interchangeable in a column that decides where email goes.
  "user_id" text REFERENCES "user"("id"),
  "backer_identity_id" uuid REFERENCES "backer_identities"("id"),

  -- §27.7 names two cadences. `off` is the third value because a recorded
  -- refusal and an unanswered question are different facts (§1.4) and only the
  -- second one should be asked again.
  "frequency" text NOT NULL,

  "chosen_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "digest_preference_audience_valid"
    CHECK ("audience" IN ('founder', 'affiliate', 'backer')),

  CONSTRAINT "digest_preference_frequency_valid"
    CHECK ("frequency" IN ('off', 'daily', 'weekly')),

  -- One subject, and it has to match the audience.
  CONSTRAINT "digest_preference_subject_matches_audience" CHECK (
    ("audience" IN ('founder', 'affiliate')
      AND "user_id" IS NOT NULL AND "backer_identity_id" IS NULL)
    OR
    ("audience" = 'backer'
      AND "backer_identity_id" IS NOT NULL AND "user_id" IS NULL)
  )
);--> statement-breakpoint

-- One preference per person. A user holds exactly one role (`user.role` has no
-- default and every creation path states it, §5), so one row per user is one
-- row per role too.
CREATE UNIQUE INDEX "digest_preferences_user_idx"
  ON "notification_digest_preferences" ("user_id")
  WHERE "user_id" IS NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "digest_preferences_backer_idx"
  ON "notification_digest_preferences" ("backer_identity_id")
  WHERE "backer_identity_id" IS NOT NULL;--> statement-breakpoint

-- The sweep's own read: everyone due a digest of a given cadence.
CREATE INDEX "digest_preferences_frequency_idx"
  ON "notification_digest_preferences" ("frequency", "audience")
  WHERE "frequency" <> 'off';--> statement-breakpoint

-- ── notification_digest_preference_events (§1.1, §25.6) ─────────────────────
-- Insert-only. The first row of a preference is the original choice, with
-- `prior_frequency` NULL — the same "row one is the promise" shape as
-- `delivery_commitments` (0034).
CREATE TABLE "notification_digest_preference_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "preference_id" uuid NOT NULL REFERENCES "notification_digest_preferences"("id"),
  "prior_frequency" text,
  "new_frequency" text NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX "digest_preference_events_idx"
  ON "notification_digest_preference_events" ("preference_id", "occurred_at");--> statement-breakpoint

-- ── The preference's subject never moves ────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_digest_preference_identity()
RETURNS trigger AS $$
BEGIN
  IF NEW."audience" IS DISTINCT FROM OLD."audience"
     OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
     OR NEW."backer_identity_id" IS DISTINCT FROM OLD."backer_identity_id"
     OR NEW."chosen_at" IS DISTINCT FROM OLD."chosen_at" THEN
    RAISE EXCEPTION 'a digest preference belongs to the person who chose it and never moves (§27.7)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "digest_preferences_identity_immutable"
  BEFORE UPDATE ON "notification_digest_preferences"
  FOR EACH ROW EXECUTE FUNCTION enforce_digest_preference_identity();--> statement-breakpoint

-- ── Every choice is recorded, by trigger ────────────────────────────────────
CREATE OR REPLACE FUNCTION record_digest_preference_change()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "notification_digest_preference_events"
      ("preference_id", "prior_frequency", "new_frequency")
    VALUES (NEW."id", NULL, NEW."frequency");
  ELSIF NEW."frequency" IS DISTINCT FROM OLD."frequency" THEN
    INSERT INTO "notification_digest_preference_events"
      ("preference_id", "prior_frequency", "new_frequency")
    VALUES (NEW."id", OLD."frequency", NEW."frequency");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "digest_preferences_history"
  AFTER INSERT OR UPDATE ON "notification_digest_preferences"
  FOR EACH ROW EXECUTE FUNCTION record_digest_preference_change();--> statement-breakpoint

CREATE OR REPLACE FUNCTION refuse_digest_preference_event_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'digest preference history is insert-only (§1.1, §25.6)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "digest_preference_events_immutable"
  BEFORE UPDATE OR DELETE ON "notification_digest_preference_events"
  FOR EACH ROW EXECUTE FUNCTION refuse_digest_preference_event_change();--> statement-breakpoint

-- ── The history read (§27.7) ────────────────────────────────────────────────
-- `notification_deliveries_dedup_idx` leads with `event_key`, so it cannot
-- serve "everything sent to this person, newest first" — which is every §27.7
-- history query and the digest's own "was this already emailed to them" check.
CREATE INDEX "notification_deliveries_target_idx"
  ON "notification_deliveries" ("target", "created_at" DESC);--> statement-breakpoint

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Column-scoped UPDATE, on the 0026/0027 house style: the only thing a person
-- may change about their own preference is the cadence.
GRANT SELECT, INSERT ON "notification_digest_preferences" TO "proovd_app";--> statement-breakpoint
GRANT UPDATE ("frequency", "updated_at") ON "notification_digest_preferences" TO "proovd_app";--> statement-breakpoint
REVOKE DELETE ON "notification_digest_preferences" FROM "proovd_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "notification_digest_preference_events" TO "proovd_app";--> statement-breakpoint
REVOKE UPDATE, DELETE ON "notification_digest_preference_events" FROM "proovd_app";
