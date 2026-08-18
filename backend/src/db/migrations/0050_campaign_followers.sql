-- ════════════════════════════════════════════════════════════════════════════
-- 0050 — the campaign follow record (campaign-page-v2, Session C)
--
-- ── THIS IS A RECORDED DEVIATION FROM §1 RULE 6 ─────────────────────────────
-- Capturing an email from somebody who has NOT pre-ordered, and sending them
-- recurring mail, is a new commercial capability the Spec does not define.
-- §1 rule 6 would forbid it. It is built by explicit product direction, at the
-- narrowest shape that honours the promise the `Follow build` button makes,
-- and it is recorded in CLAUDE.md the way the 2026-08-10 Admin-MFA removal and
-- the account-level Creator suspend/restore are — so that a later session does
-- not "fix" it by deleting it, and does not read it as licence for more.
--
-- What that narrowness means, concretely, in this file:
--   * ONE message (a double-opt-in confirmation) plus §27.7's existing digest.
--   * NO schedule of any kind. The columns that would hold one are asserted
--     ABSENT by test — the strongest form of a promise not to chase somebody
--     is having nowhere to record when to chase them (§30).
--   * NO public count. §30 defers public like/follow signals, so nothing here
--     rolls up onto `campaigns` and no public payload reads this table.
--   * NO fourth digest audience and NO fifth notification audience. The
--     frequency lives on the follow row; the delivery rides §27.7's existing
--     `backer_` channel.
--
-- ── Retention is §25.8's window 4, not an invented one ──────────────────────
-- "Marketing consent: until unsubscribe + 2 years." A follower email IS a
-- marketing consent. Deriving a window from campaign resolution instead would
-- be §1 rule 6 in the other direction — inventing a rule where the Spec
-- speaks. Window 5 separately covers the token hashes; window 1 does not
-- apply, because a follower has no reservation.
--
-- ── What this file deliberately does NOT add ────────────────────────────────
--   * `remind_at`, `notify_at`, `recurrence`, `repeat_interval`,
--     `next_send_at`, `cadence`, `template_id`, `escalate_at`, `snooze_until`
--     — no schedule-shaped column, on any table.
--   * `follower_count` on `campaigns` — §30, and a rolled-up number is also a
--     second answer to a question one query already answers.
--   * a fourth value in `digest_audience` or a fourth subject column on
--     `notification_digest_preferences` — 0035's
--     `digest_preference_subject_matches_audience` CHECK admits exactly two
--     subject columns and three audiences, and both registers are asserted
--     deep-equal between shared and backend.
--
-- The scope-binding CHECK re-add lands in 0051, not here: Postgres refuses to
-- use an enum label in the transaction that added it and the migrator runs one
-- transaction per file. That is the 0008/0009 precedent, verbatim.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. The new token scope ──────────────────────────────────────────────────
--
-- Added here, USED in 0051. Two lineages share it: the confirm link is
-- single-use and is claimed; the unfollow link must keep working for the life
-- of the record, and `verify` rejects a claimed token, so it is never claimed
-- and is revoked only when the follow ends.
ALTER TYPE "token_scope" ADD VALUE 'campaign_follow';--> statement-breakpoint

-- ── 2. campaign_followers ───────────────────────────────────────────────────
--
-- `email`, `email_normalized` and `consent_text` are NULLABLE on purpose: the
-- §25.8 sweep nulls them, and a NOT NULL column would make the retention write
-- impossible to express. The two-shape CHECK below is what requires them on a
-- LIVE row, which is stronger than NOT NULL — it also refuses a half-swept row.
CREATE TABLE "campaign_followers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE RESTRICT,

  -- The address as typed, and §4.1's own normalisation of it. Normalising with
  -- a second rule here would make one address two follows.
  "email" text,
  "email_normalized" text,

  "state" text NOT NULL DEFAULT 'pending',

  -- §27.7: the preference exists only because a person chose it. There is NO
  -- DEFAULT here and no code path may supply one — the follow form asks.
  "frequency" text NOT NULL,

  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "confirmed_at" timestamptz,
  "unfollowed_at" timestamptz,
  "anonymised_at" timestamptz,

  -- The consent itself, preserved as it was shown (§24.10's posture applied to
  -- a marketing consent: the text somebody agreed to is not a template lookup).
  "consent_text" text,
  "consent_version" text NOT NULL,

  "source" text NOT NULL
);--> statement-breakpoint

ALTER TABLE "campaign_followers" ADD CONSTRAINT "campaign_followers_state"
  CHECK ("state" IN ('pending', 'confirmed', 'unfollowed'));--> statement-breakpoint

ALTER TABLE "campaign_followers" ADD CONSTRAINT "campaign_followers_source"
  CHECK ("source" IN ('campaign_page', 'checkout_success'));--> statement-breakpoint

-- A state and its stamp cannot disagree.
ALTER TABLE "campaign_followers" ADD CONSTRAINT "campaign_followers_state_stamps" CHECK (
  ("state" <> 'confirmed' OR "confirmed_at" IS NOT NULL)
  AND ("state" <> 'unfollowed' OR "unfollowed_at" IS NOT NULL)
);--> statement-breakpoint

-- Two shapes and no third (0047's arrangement): live (the address and the
-- consent text present and non-blank) or anonymised (all three null, stamped).
-- A row that lost its address but kept the text somebody agreed to is not a
-- state this table can hold.
ALTER TABLE "campaign_followers" ADD CONSTRAINT "campaign_followers_two_shapes" CHECK (
  (
    "anonymised_at" IS NULL
    AND btrim(coalesce("email", '')) <> ''
    AND btrim(coalesce("email_normalized", '')) <> ''
    AND btrim(coalesce("consent_text", '')) <> ''
  )
  OR (
    "anonymised_at" IS NOT NULL
    AND "email" IS NULL
    AND "email_normalized" IS NULL
    AND "consent_text" IS NULL
  )
);--> statement-breakpoint

-- One follow per address per campaign, over LIVE rows only — an anonymised row
-- has no address to collide with. A partial index means any
-- `onConflictDoUpdate` against it must carry `targetWhere`, or Postgres raises
-- 42P10 at runtime (`notifications/preferences.ts` documents this).
CREATE UNIQUE INDEX "campaign_followers_one_per_address_idx"
  ON "campaign_followers" ("campaign_id", "email_normalized")
  WHERE "email_normalized" IS NOT NULL;--> statement-breakpoint

CREATE INDEX "campaign_followers_campaign_state_idx"
  ON "campaign_followers" ("campaign_id", "state");--> statement-breakpoint

-- The retention sweep's own predicate: unfollowed, not yet anonymised.
CREATE INDEX "campaign_followers_retention_idx"
  ON "campaign_followers" ("unfollowed_at")
  WHERE "anonymised_at" IS NULL;--> statement-breakpoint

-- ── 3. Grants (§25.6) ───────────────────────────────────────────────────────
--
-- UPDATE is column-scoped by name (the 0005 `campaign_invitation_sends`
-- arrangement): the lifecycle stamps, the frequency, and the three columns the
-- §25.8 sweep must null. `campaign_id`, `requested_at`, `source` and
-- `consent_version` are outside the grant — the fact that somebody asked, for
-- which campaign, from where, and under which consent version, outlives the
-- text of it. DELETE is revoked: an unfollow is a state and an anonymisation
-- is a null, never a vanished row.
GRANT SELECT, INSERT ON "campaign_followers" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("email", "email_normalized", "consent_text", "state", "frequency",
              "confirmed_at", "unfollowed_at", "anonymised_at")
  ON "campaign_followers" TO proovd_app;--> statement-breakpoint
REVOKE DELETE ON "campaign_followers" FROM proovd_app;--> statement-breakpoint

-- ── 4. Identity immutability, and irreversible anonymisation ────────────────
--
-- Irreversibility is a DATABASE property, not a service one: a row that could
-- be un-anonymised was never anonymised, only hidden. `email_normalized` may
-- travel in exactly one direction — non-null → null — which is the sweep's
-- write and nothing else.
CREATE OR REPLACE FUNCTION enforce_campaign_follower_integrity() RETURNS trigger AS $fn$
BEGIN
  IF OLD."anonymised_at" IS NOT NULL THEN
    RAISE EXCEPTION 'an anonymised follow is settled; its content cannot be restored (§25.8)'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."campaign_id"      IS DISTINCT FROM OLD."campaign_id"
  OR NEW."requested_at"     IS DISTINCT FROM OLD."requested_at"
  OR NEW."source"           IS DISTINCT FROM OLD."source"
  OR NEW."consent_version"  IS DISTINCT FROM OLD."consent_version"
  THEN
    RAISE EXCEPTION 'a follow record cannot be repointed or its consent rewritten (§25.6)'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."email_normalized" IS NOT NULL
     AND NEW."email_normalized" IS NOT NULL
     AND NEW."email_normalized" IS DISTINCT FROM OLD."email_normalized"
  THEN
    RAISE EXCEPTION 'a follow address is fixed; a different address is a different follow'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER campaign_followers_integrity
  BEFORE UPDATE ON "campaign_followers"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_campaign_follower_integrity();--> statement-breakpoint

-- ── 5. campaign_follow_events — written by TRIGGER, never by a service ──────
--
-- This is a consent, so "did they ask for this, and when did they stop asking"
-- is a fact we may have to prove. A service that wrote the history is a
-- service one careless `db.update()` bypasses — the reasoning `app_setting_versions`
-- (06a), `draft_field_edits` (07) and `optional_item_events` (09a) already
-- record. There is no `notes` column and no actor: every transition here is
-- the person's own act or the retention sweep's.
CREATE TABLE "campaign_follow_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "follower_id" uuid NOT NULL REFERENCES "campaign_followers"("id") ON DELETE RESTRICT,
  "event" text NOT NULL,
  "from_state" text,
  "to_state" text NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "campaign_follow_events" ADD CONSTRAINT "campaign_follow_events_kind"
  CHECK ("event" IN ('requested', 'confirmed', 'unfollowed', 'frequency_changed', 'anonymised'));--> statement-breakpoint

CREATE INDEX "campaign_follow_events_follower_idx"
  ON "campaign_follow_events" ("follower_id", "occurred_at");--> statement-breakpoint

GRANT SELECT, INSERT ON "campaign_follow_events" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "campaign_follow_events" FROM proovd_app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION record_campaign_follow_event() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "campaign_follow_events" ("follower_id", "event", "from_state", "to_state")
    VALUES (NEW."id", 'requested', NULL, NEW."state");
    RETURN NEW;
  END IF;

  IF NEW."anonymised_at" IS NOT NULL AND OLD."anonymised_at" IS NULL THEN
    INSERT INTO "campaign_follow_events" ("follower_id", "event", "from_state", "to_state")
    VALUES (NEW."id", 'anonymised', OLD."state", NEW."state");
  ELSIF NEW."state" IS DISTINCT FROM OLD."state" THEN
    INSERT INTO "campaign_follow_events" ("follower_id", "event", "from_state", "to_state")
    VALUES (NEW."id", NEW."state", OLD."state", NEW."state");
  ELSIF NEW."frequency" IS DISTINCT FROM OLD."frequency" THEN
    INSERT INTO "campaign_follow_events" ("follower_id", "event", "from_state", "to_state")
    VALUES (NEW."id", 'frequency_changed', OLD."state", NEW."state");
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER campaign_followers_history
  AFTER INSERT OR UPDATE ON "campaign_followers"
  FOR EACH ROW
  EXECUTE FUNCTION record_campaign_follow_event();--> statement-breakpoint

-- ── 6. The token's fourth binding column ────────────────────────────────────
--
-- The CHECK that requires it for `campaign_follow` (and forbids it everywhere
-- else) is 0051's — it names the enum label added at the top of this file.
ALTER TABLE "secure_tokens" ADD COLUMN "campaign_follower_id" uuid
  REFERENCES "campaign_followers"("id") ON DELETE RESTRICT;--> statement-breakpoint

-- 0009 did not need this and it matters here: omitting the new column from the
-- immutability trigger would leave it mutable, which is exactly the cross-scope
-- repoint §33.1.2 exists to catch — a live delivered URL silently pointed at
-- somebody else's follow.
CREATE OR REPLACE FUNCTION enforce_secure_token_immutability() RETURNS trigger AS $fn$
BEGIN
  IF NEW."token_hash"           IS DISTINCT FROM OLD."token_hash"
  OR NEW."scope"                IS DISTINCT FROM OLD."scope"
  OR NEW."lineage_id"           IS DISTINCT FROM OLD."lineage_id"
  OR NEW."version"              IS DISTINCT FROM OLD."version"
  OR NEW."campaign_draft_id"    IS DISTINCT FROM OLD."campaign_draft_id"
  OR NEW."campaign_id"          IS DISTINCT FROM OLD."campaign_id"
  OR NEW."backer_identity_id"   IS DISTINCT FROM OLD."backer_identity_id"
  OR NEW."campaign_follower_id" IS DISTINCT FROM OLD."campaign_follower_id"
  THEN
    RAISE EXCEPTION 'secure_tokens identity and scope are immutable; rotate instead'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."claimed_at" IS NOT NULL AND NEW."claimed_at" IS DISTINCT FROM OLD."claimed_at" THEN
    RAISE EXCEPTION 'secure_tokens.claimed_at is append-only'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
