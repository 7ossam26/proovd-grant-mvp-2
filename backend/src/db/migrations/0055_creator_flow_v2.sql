-- Creator Flow v2, Session A — a post-Phase-24 change, 2026-08-19.
-- Spec §1.3, §5.3, §8, §11, §14.1, §22.1, §24, §25.6, §25.8, §28.4, §29.4, §30.
--
-- The Creator's signup and dashboard are rebuilt to the supplied reference at
-- `docs/design-refrence/Proovd-Creator-Flow-v2.html`. The brief is
-- `docs/phases/creator-flow-v2.md`; the walk is
-- `docs/phases/creator-flow-reconciliation.md`.
--
-- Most of that rebuild is a RE-PRESENTATION of records that already exist —
-- §14.1's opportunity, §14.2's three decisions, §17's partnership, §21's close
-- view, and 0048's six Affiliate families are all untouched here. What this
-- migration adds is the part that genuinely has nowhere to live: four columns
-- the reference asks a Creator for, three record families behind the authorised
-- deviations, and ONE that closes a §5.3 right the product has never had.
--
-- It was going to be two. Session A drafted a delete-account request table and
-- then found one — 0044's, already the right shape — so section 8 records the
-- finding instead: **the gap there is a route, not a record.**
--
-- ── The four authorised deviations, and which of them lands here ───────────
-- Each was put with the rule that forbids it and taken by explicit product
-- direction on 2026-08-19, recorded the way the 2026-08-10 Admin-MFA removal
-- and 0050's `campaign_followers` are. Deviation 1 (the nine-screen onboarding)
-- and deviation 5 (the account-level home) need no schema at all — they are a
-- pagination and a layout. Deviations 2, 3 and 4 need a record each, and each
-- is narrowed by WHAT ITS TABLE CANNOT HOLD rather than by intention.
--
-- ── What this migration deliberately does NOT add ─────────────────────────
--
--   * **No `proposal_access` column, and nothing shaped like one.** §29.4 makes
--     `restrict bidding` an enforcement action and the Affiliate workspace
--     DERIVES proposal access from §29 records (2026-08-17). A stored
--     eligibility flag would be a second, contradictory answer to one question,
--     and it is the single most likely thing a later phase would read the
--     standing tier as. There is no column here it could read.
--   * **No amount, percentage, rate, floor, multiplier, or commission column on
--     any new table.** §8: the internal quality tier is "assessment data—not a
--     commission floor". §24 defines four money streams and a referral payment
--     would be a fifth. `affiliate_referrals` is asserted as an exact column
--     set for exactly this reason (0052's openness arrangement).
--   * **No second subtype register.** `AFFILIATE_SUBTYPE_DEFINITIONS` stays the
--     authority for §5.3 evidence. The reference's nine channel tiles are a
--     presentation over seven subtypes plus a platform, and
--     `affiliate_channel_metrics` is CHECK-pinned to evidence ids that already
--     exist in that register rather than to a list of its own.
--   * **No `affiliate_signup_field_edits` history table.** The in-row
--     `*_prefilled` / `*_supplier` / `*_edited_at` triple is the arrangement
--     `affiliate-signup.ts:8-14` chose deliberately, and §25.6's audit row
--     covers the post-claim writes the triple does not describe. A second
--     history mechanism beside it would be two answers to "what did this say
--     before".
--   * **No schedule-shaped column anywhere** — no `remind_at`, `notify_at`,
--     `recurrence`, `repeat_interval`, `next_send_at`, `cadence`,
--     `escalate_at`, `snooze_until`, `template_id` — and no job under
--     `backend/src/jobs/` reads any table below (§30).
--   * **No asset, URL, file, or campaign column on `creator_resource_interest`.**
--     §14.1: "All material lives in one Campaign kit. No separate
--     resource-library or education journey is required." The moment a column
--     here could hold a file, this and the §31.5 kit would be the same thing
--     and that sentence would be false.
--   * **No second delete-account request table.** 0044 already has one, with
--     no `deleted_at`, no purge schedule, and no `approved` state, because
--     §25.8's retention obligations outlive the account. Session F adds a
--     Creator-facing ROUTE onto that record — see section 8.
--   * **Nothing that could hold a bank account, routing number, tax id, or
--     identity document.** `affiliate_signup_no_bank_data` stands and this
--     migration adds no column it would have to be extended to cover.
--   * **No `phone_verified`, anywhere.** §33.1.8 scans for one;
--     `user.phone_verified` is CHECK-pinned false in 0002 and stays that way.
--     The phone stays collected and unverified (§5.3).
--
-- ═══ 1. Four columns the reference asks a Creator for (§5.3, §11) ═══════════
--
-- `channel_type` is the Creator's OWN answer — which of the nine tiles they
-- picked — and it is **not** `affiliate_prospects.subtype`, which is the
-- Admin's §5.3 classification and is what the recorded verification evidence
-- was gathered against. The two may disagree, and a disagreement is a FACT FOR
-- ADMIN rather than something the product resolves: overwriting the
-- classification would silently invalidate a verification, which is the exact
-- reason the subtype has rendered read-only since Phase 08b.
--
-- It carries the full provenance triple because the screen arrives pre-selected
-- from the Admin's subtype, and §11 requires a source label on prefilled public
-- information plus the ability to correct it. The other three are never
-- prefilled — Proovd does not learn them at recruitment — so they carry none,
-- which is the same shape `date_of_birth`, `country` and `state_region` already
-- have.
ALTER TABLE "affiliate_signup_profiles"
  ADD COLUMN "channel_type" text,
  ADD COLUMN "channel_type_prefilled" text,
  ADD COLUMN "channel_type_supplier" signup_field_supplier,
  ADD COLUMN "channel_type_edited_at" timestamp with time zone,
  -- Screen 3's free-text "what you cover", beside the closed niche list.
  ADD COLUMN "niche_description" text,
  -- Screen 3's student-only "how you reach your network". §5.3's
  -- `student_affiliate` evidence input is literally `promotion_plan`; this is
  -- the Creator's own statement of it, and the evidence record stays Admin's.
  ADD COLUMN "outreach_plan" text,
  -- Screen 5's profile photo. An R2 object key, never bytes and never a URL —
  -- the `campaign_assets` arrangement. R2 is unconfigured (Track A4), so this
  -- is NULL for every row today and the surface renders a named absence rather
  -- than a dead control.
  ADD COLUMN "profile_photo_key" text;--> statement-breakpoint

-- The tile must be one the register knows. A free-text channel would make the
-- §5.3 disagreement check undecidable — you cannot compare an arbitrary string
-- to a subtype — and it is the check that keeps a Creator's answer from being
-- read as the Admin's classification.
ALTER TABLE "affiliate_signup_profiles"
  ADD CONSTRAINT "affiliate_signup_channel_type_known" CHECK (
    "channel_type" IS NULL OR "channel_type" IN (
      'youtube','tiktok','instagram','newsletter','podcast',
      'community','course','student','niche_marketer'
    )
  );--> statement-breakpoint

-- ═══ 2. The recorded tone (§11, §12, §30) ═══════════════════════════════════
--
-- Screen 4. The reference asks it as "a tone we should write your scripts in",
-- which is refused: §30 defers AI pitch rewriting, §12 makes the helper
-- resources "static, copy-ready guidance—not an embedded AI product", and there
-- is no model client in this tree. Nothing writes anything in a tone.
--
-- The field survives the re-authoring because the answer is genuinely useful to
-- the person it is shown to: it is what a Founder reads on the §11 public card,
-- and it is the Creator's own statement about what they are good at. It is
-- SHOWN and never an input to generation.
--
-- One live set per profile, superseded rather than edited — an answer somebody
-- changed their mind about is two facts, and which was live when a Founder
-- looked is a question somebody may have to answer (0016/0025/0052 precedent).
CREATE TABLE "affiliate_voice_tones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "profile_id" uuid NOT NULL REFERENCES "affiliate_signup_profiles"("id") ON DELETE RESTRICT,
  -- Ids from `CREATOR_VOICE_TONES`. An array rather than a row per tone,
  -- because the SET is what was chosen at one moment — five rows superseded
  -- individually could never answer "what did this profile say in March".
  "tones" text[] NOT NULL DEFAULT '{}',
  -- Free text the Creator typed. Bounded by the service, not here: a length cap
  -- in a CHECK would refuse a row rather than tell somebody their chip is long.
  "custom_tones" text[] NOT NULL DEFAULT '{}',
  -- The reference's "I'm flexible" switch. Its own column rather than a seventh
  -- tone, because it says something about the OTHER answers.
  "flexible" boolean NOT NULL DEFAULT false,
  "recorded_by" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "superseded_at" timestamp with time zone,
  -- A tone set that says nothing is not an answer. `flexible` alone IS an
  -- answer, so it satisfies this on its own.
  CONSTRAINT "affiliate_voice_says_something" CHECK (
    cardinality("tones") > 0 OR cardinality("custom_tones") > 0 OR "flexible" = true
  )
);--> statement-breakpoint

CREATE UNIQUE INDEX "affiliate_voice_one_live_idx"
  ON "affiliate_voice_tones" ("profile_id")
  WHERE "superseded_at" IS NULL;--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_affiliate_voice_immutability() RETURNS trigger AS $fn$
BEGIN
  IF NEW."profile_id"   IS DISTINCT FROM OLD."profile_id"
  OR NEW."tones"        IS DISTINCT FROM OLD."tones"
  OR NEW."custom_tones" IS DISTINCT FROM OLD."custom_tones"
  OR NEW."flexible"     IS DISTINCT FROM OLD."flexible"
  OR NEW."recorded_by"  IS DISTINCT FROM OLD."recorded_by"
  OR NEW."recorded_at"  IS DISTINCT FROM OLD."recorded_at"
  THEN
    RAISE EXCEPTION 'a recorded tone set is immutable; record a new one instead'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."superseded_at" IS NOT NULL AND NEW."superseded_at" IS DISTINCT FROM OLD."superseded_at" THEN
    RAISE EXCEPTION 'this tone set has already been superseded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "affiliate_voice_immutable"
  BEFORE UPDATE ON "affiliate_voice_tones"
  FOR EACH ROW EXECUTE FUNCTION enforce_affiliate_voice_immutability();--> statement-breakpoint

-- ═══ 3. The per-channel metrics (§5.3, §8) ══════════════════════════════════
--
-- Screen 6. `verifySpec()` at line 2457 of the reference computes these from a
-- six-branch hard-coded switch and renders them NOWHERE — a genuine bug in the
-- prototype whose output is good.
--
-- They are built from `AFFILIATE_SUBTYPE_DEFINITIONS` rather than from the
-- reference's list, because that register already carries every one of these
-- ids and is already what an Admin verifies against. Two lists would mean a
-- Creator answering one question and an Admin verifying a different one.
--
-- The value is TEXT, deliberately. "About 40k" and "12,300 on the main list"
-- are real answers, and a numeric column would refuse them and push somebody to
-- type a number they do not have — §5.3's own "audit where appropriate" and
-- `subtypes.ts`' reasoning about honestly incomplete records. §8's verification
-- is Admin's judgement over evidence, not arithmetic over a column.
CREATE TABLE "affiliate_channel_metrics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "profile_id" uuid NOT NULL REFERENCES "affiliate_signup_profiles"("id") ON DELETE RESTRICT,
  -- The evidence id from §5.3's own register. Pinned below.
  "metric_id" text NOT NULL,
  "value" text NOT NULL,
  "recorded_by" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "superseded_at" timestamp with time zone,
  CONSTRAINT "affiliate_channel_metric_value_present" CHECK (btrim("value") <> ''),
  -- The nine ids in `CREATOR_CHANNEL_METRIC_IDS`, each of which is an evidence
  -- input `AFFILIATE_SUBTYPE_DEFINITIONS` already names. A metric id outside
  -- this list is a question no subtype asks, so a Creator could not have been
  -- shown it and an Admin has nothing to verify it against.
  CONSTRAINT "affiliate_channel_metric_id_known" CHECK (
    "metric_id" IN (
      'followers','engagement','subscribers','click_through','downloads',
      'members','active_users','enrolled_students','ratings'
    )
  )
);--> statement-breakpoint

CREATE UNIQUE INDEX "affiliate_channel_metric_one_live_idx"
  ON "affiliate_channel_metrics" ("profile_id", "metric_id")
  WHERE "superseded_at" IS NULL;--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_affiliate_channel_metric_immutability() RETURNS trigger AS $fn$
BEGIN
  IF NEW."profile_id"  IS DISTINCT FROM OLD."profile_id"
  OR NEW."metric_id"   IS DISTINCT FROM OLD."metric_id"
  OR NEW."value"       IS DISTINCT FROM OLD."value"
  OR NEW."recorded_by" IS DISTINCT FROM OLD."recorded_by"
  OR NEW."recorded_at" IS DISTINCT FROM OLD."recorded_at"
  THEN
    RAISE EXCEPTION 'a recorded channel metric is immutable; record a new one instead'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."superseded_at" IS NOT NULL AND NEW."superseded_at" IS DISTINCT FROM OLD."superseded_at" THEN
    RAISE EXCEPTION 'this metric has already been superseded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "affiliate_channel_metric_immutable"
  BEFORE UPDATE ON "affiliate_channel_metrics"
  FOR EACH ROW EXECUTE FUNCTION enforce_affiliate_channel_metric_immutability();--> statement-breakpoint

-- ═══ 4. The standing snapshot — DEVIATION 2 (§8, §26, §29.4, §30) ═══════════
--
-- **A recorded deviation from §1 rule 6, by explicit product direction.**
--
-- The reference's Home draws a score, a percentile, a Gold→Platinum tier, a
-- streak, and a leaderboard. §30 forbids public leaderboards, streaks, and
-- automatic percentile pruning; §8 makes the internal quality tier "assessment
-- data—not a commission floor"; §26 makes the Admin panel the only
-- dashboard-style product.
--
-- ── THE TIER BINDS NOTHING, and that is the hard constraint ────────────────
-- The reference's "Climb toward Platinum for higher floors and early access" is
-- an eligibility condition in §1 rule 6's own list, and it would COLLIDE with
-- something already built: §29.4 makes `restrict bidding` an enforcement action
-- and the Affiliate workspace derives proposal access from §29 records. A
-- standing tier that changed proposal access would be a second, contradictory
-- answer to one question, and the two would disagree the first time an Admin
-- restricted somebody with a high score.
--
-- So there is no rate, floor, percentage, multiplier, or eligibility column
-- here, the promise is not made in any copy, and a Session D source scan
-- asserts that nothing under `affiliates/decisions.ts`, `creator-payment/`,
-- `close/earnings.ts` or `affiliates/readiness.ts` reads this table at all.
--
-- ── A SNAPSHOT, with its inputs stored beside it ──────────────────────────
-- 21b's completion-findings reasoning, applied to the number a Creator will
-- read hardest. A live recomputation is a number that silently rewrites its own
-- justification the next time a record moves, and the person reading it would
-- have no way to know it had. Insert-only; a recomputation is a NEW row.
CREATE TABLE "affiliate_standing_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- The PERSON, not the association. Standing is across every campaign, which
  -- is also why it can never be read as a per-campaign eligibility input.
  "prospect_id" uuid NOT NULL REFERENCES "affiliate_prospects"("id") ON DELETE RESTRICT,
  "score" integer NOT NULL,
  "tier" text NOT NULL,
  -- Null until there is a cohort to sit in. §16a: not yet populated is not
  -- zero, and a brand-new Creator is not in the bottom percentile — there is
  -- nothing to compare them against yet, which is a different fact from
  -- ranking them last.
  "percentile" integer,
  -- The counts that produced the score, keyed by `CREATOR_STANDING_INPUTS`.
  -- Stored so the number can be explained later without re-deriving it from
  -- records that have since moved.
  "inputs" jsonb NOT NULL,
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "affiliate_standing_score_bounded" CHECK ("score" BETWEEN 0 AND 1000),
  CONSTRAINT "affiliate_standing_percentile_bounded" CHECK (
    "percentile" IS NULL OR "percentile" BETWEEN 1 AND 100
  ),
  CONSTRAINT "affiliate_standing_tier_known" CHECK (
    "tier" IN ('starting','established','gold','platinum')
  ),
  -- An input set that is not an object is a score with no stated basis, which
  -- is the whole thing this table exists to prevent.
  CONSTRAINT "affiliate_standing_inputs_object" CHECK (jsonb_typeof("inputs") = 'object')
);--> statement-breakpoint

CREATE INDEX "affiliate_standing_prospect_idx"
  ON "affiliate_standing_snapshots" ("prospect_id", "computed_at" DESC);--> statement-breakpoint

-- ═══ 5. The referral — DEVIATION 3 (§5.3, §8, §24) ══════════════════════════
--
-- **A recorded deviation from §1 rule 6, by explicit product direction.**
--
-- The reference draws `Refer other affiliates`, `earn a percentage of their
-- campaigns`, and `proovd.co/join/mohab`. §5.3: "No open public signup. Enters
-- only through a private, campaign-specific invitation." §8: "No generic
-- Affiliate credential email and no public signup exist."
--
-- ── An INTRODUCTION, not a signup route ───────────────────────────────────
-- This produces an Admin task naming who vouched for whom. Recruitment stays
-- §8's, the invitation stays campaign-specific, and this row creates no
-- account, no `affiliate_prospects` row, and no association. There is no token
-- scope, no public route, and no join address — a referral is read by a person.
--
-- ── `earn a percentage of their campaigns` is REFUSED OUTRIGHT ────────────
-- §24 defines four money streams and this would be a fifth, paid out of
-- somebody else's campaign to a person with no association to it. The
-- enforcement is the column set: **no amount, no percentage, no commission, no
-- currency, no cents.** A test asserts the exact set, the way 0052's openness
-- record is asserted.
CREATE TABLE "affiliate_referrals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- Who vouched. The PERSON, since a referral is not about a campaign.
  "referrer_prospect_id" uuid NOT NULL REFERENCES "affiliate_prospects"("id") ON DELETE RESTRICT,
  "referred_name" text NOT NULL,
  "referred_contact" text NOT NULL,
  "relationship" text NOT NULL,
  "why" text NOT NULL,
  "note" text,
  -- `recorded` → `reviewed` → `closed`. Deliberately no `accepted`/`joined`:
  -- whether the person was eventually recruited is §8's record, and reporting
  -- it back would tell a Creator about somebody else's admission decision — and
  -- would give the referral an outcome, which is the shape a commission needs.
  "state" text NOT NULL DEFAULT 'recorded',
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reviewed_by" text,
  "reviewed_at" timestamp with time zone,
  CONSTRAINT "affiliate_referral_state_known" CHECK (
    "state" IN ('recorded','reviewed','closed')
  ),
  CONSTRAINT "affiliate_referral_fields_present" CHECK (
    btrim("referred_name") <> '' AND btrim("referred_contact") <> ''
    AND btrim("relationship") <> '' AND btrim("why") <> ''
  ),
  -- A reviewed referral names who read it. A state nobody signed is a state
  -- nobody can follow up on (§1.3).
  CONSTRAINT "affiliate_referral_review_accounted" CHECK (
    ("state" = 'recorded' AND "reviewed_by" IS NULL AND "reviewed_at" IS NULL)
    OR ("state" <> 'recorded' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL)
  )
);--> statement-breakpoint

CREATE INDEX "affiliate_referral_referrer_idx"
  ON "affiliate_referrals" ("referrer_prospect_id", "recorded_at" DESC);--> statement-breakpoint

-- What the Creator wrote is what an Admin reads. Only the review may be added.
CREATE OR REPLACE FUNCTION enforce_affiliate_referral_immutability() RETURNS trigger AS $fn$
BEGIN
  IF NEW."referrer_prospect_id" IS DISTINCT FROM OLD."referrer_prospect_id"
  OR NEW."referred_name"        IS DISTINCT FROM OLD."referred_name"
  OR NEW."referred_contact"     IS DISTINCT FROM OLD."referred_contact"
  OR NEW."relationship"         IS DISTINCT FROM OLD."relationship"
  OR NEW."why"                  IS DISTINCT FROM OLD."why"
  OR NEW."note"                 IS DISTINCT FROM OLD."note"
  OR NEW."recorded_at"          IS DISTINCT FROM OLD."recorded_at"
  THEN
    RAISE EXCEPTION 'a recorded referral is what somebody wrote; it cannot be edited'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."state" <> 'recorded' AND NEW."state" IS DISTINCT FROM OLD."state" THEN
    RAISE EXCEPTION 'this referral has already been reviewed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "affiliate_referral_immutable"
  BEFORE UPDATE ON "affiliate_referrals"
  FOR EACH ROW EXECUTE FUNCTION enforce_affiliate_referral_immutability();--> statement-breakpoint

-- ═══ 6. Resource interest — DEVIATION 4 (§14.1, §30) ════════════════════════
--
-- **A recorded deviation from §1 rule 6, by explicit product direction.**
--
-- The reference draws four tiles whose action is "We'll email you when it's
-- ready." §14.1's last line: "All material lives in one Campaign kit. No
-- separate resource-library or education journey is required." §30 defers a
-- reusable Affiliate course/resource library by name.
--
-- ── What keeps §14.1's sentence true is a SEPARATION, and it is structural ──
-- This table carries **no campaign material and no campaign reference**: a
-- resource key, a subject, a timestamp. There is no asset column, no URL
-- column, no file column, and no campaign id — asserted absent in
-- `information_schema`. It cannot become the §31.5 Campaign kit, which is per
-- campaign, access-logged, and revocable.
--
-- No schedule column and no job reads this (§30). "We'll email you when it's
-- ready" is recorded as interest; §27 defines no resource key, and one send if
-- something is ever built is a decision with its own coverage entry.
CREATE TABLE "creator_resource_interest" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "prospect_id" uuid NOT NULL REFERENCES "affiliate_prospects"("id") ON DELETE RESTRICT,
  -- A key from `CREATOR_RESOURCES`. Pinned, because interest in something
  -- nobody named is interest nobody can act on.
  "resource_id" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "creator_resource_id_known" CHECK (
    "resource_id" IN (
      'marketing_toolkit','content_templates','best_practices','tracking_and_analytics'
    )
  )
);--> statement-breakpoint

-- Asking twice is the same fact. A second attempt changes nothing rather than
-- accumulating rows that would later read as demand.
CREATE UNIQUE INDEX "creator_resource_interest_once_idx"
  ON "creator_resource_interest" ("prospect_id", "resource_id");--> statement-breakpoint

-- ═══ 7. The post-claim profile correction (§5.3, §11, §25.6, §33.12.4) ══════
--
-- **NOT a deviation. This is §5.3 as written, and it closes a real gap.**
--
-- §5.3 lists "Affiliate settings: name, email, phone, password, channel
-- type/handles, audience metrics, niche, bio, ... notification preferences, and
-- delete-account request." **None of it is editable after the claim today.**
-- `saveSignupProfile` hard-refuses once `claimed_at` is set and no
-- session-authenticated Creator route writes the profile at all — so
-- `requestAffiliateCorrection` (2026-08-17) has been emailing Creators asking
-- them to correct something they have no route to correct.
--
-- This is the record behind that route. It is NOT a relaxation of
-- `saveSignupProfile`'s refusal — that refusal is load-bearing for screens 1–8
-- and stays exactly as it is. This is a different act with its own discipline,
-- inherited from Admin's `correctAffiliateAccountField`:
--
--   * a reason is REQUIRED (CHECK, below);
--   * the prior value is read from the row `FOR UPDATE` inside the transaction
--     that changes it — §33.12.4, because a caller that supplies both halves
--     can supply a flattering pair. `prior_value` is NOT NULL and a genuinely
--     absent prior is stored as JSON `null`, never SQL NULL: the two are
--     different facts, and SQL NULL here would mean "no before was recorded",
--     which is the state the constraint exists to forbid (16a's arrangement);
--   * the service writes an `audit_events` row in the same transaction, because
--     this table has no history table and `date_of_birth`, `country`,
--     `state_region` and the five confirmations carry no provenance columns.
--
-- Insert-only. A correction of a correction is a new row.
CREATE TABLE "affiliate_profile_corrections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "profile_id" uuid NOT NULL REFERENCES "affiliate_signup_profiles"("id") ON DELETE RESTRICT,
  -- A field id from `CREATOR_SETTINGS_FIELDS` or `CREATOR_SETTINGS_GUARDED`,
  -- never a free-text column name — 16a's overridable-field reasoning: a route
  -- accepting any string would record a correction of something that does not
  -- exist, and the trail would look complete while pointing at nothing.
  "field_id" text NOT NULL,
  "prior_value" jsonb NOT NULL,
  "new_value" jsonb NOT NULL,
  "reason" text NOT NULL,
  -- The Creator's own account. This route is theirs; Admin's is a different
  -- one, with a different record, and keeping them apart is what lets a later
  -- reader tell who changed something.
  "corrected_by_user_id" text NOT NULL,
  "corrected_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "affiliate_correction_field_known" CHECK (
    "field_id" IN (
      'public_handle','phone','channel_reference','audience_niche','audience_size',
      'bio','niche_description','outreach_plan','legal_name','email'
    )
  ),
  CONSTRAINT "affiliate_correction_reason_present" CHECK (btrim("reason") <> '')
);--> statement-breakpoint

CREATE INDEX "affiliate_correction_profile_idx"
  ON "affiliate_profile_corrections" ("profile_id", "corrected_at" DESC);--> statement-breakpoint

-- ═══ 8. The delete-account request already exists — the gap was a ROUTE ═══
--
-- Session A drafted a table for it and then found one. `affiliate_deletion_
-- requests` and `affiliate_deletion_reviews` landed in **0044** with the
-- Creators workspace (2026-08-11), and they are already the right shape: the
-- record is of the ASK, there is no `deleted_at`, no purge schedule, and no
-- `approved` state, and the one review outcome the product offers is
-- "acknowledged, still under review" because §25.8's retention obligations do
-- not end because somebody clicked a button.
--
-- What is missing is not a record. It is that **only an Admin can file one** —
-- `recordAffiliateDeletionRequest` is mounted on `/api/admin/creators/:id/
-- deletion-request`, and its `received_via` column exists precisely because
-- today the ask arrives out of band, by email or on a call, and somebody has to
-- write down how it reached us.
--
-- So Session F adds a Creator-facing route that writes the SAME record with
-- `received_via = CREATOR_DELETION_RECEIVED_VIA`, and this migration adds
-- nothing. A second table would have been the duplicate this codebase refuses
-- everywhere else — §26.8's "a second event store that drifts from the first is
-- worse than no timeline", applied to a person's erasure request, where the two
-- copies disagreeing is the worst version of that failure.
--
-- ═══ 9. Grants ═════════════════════════════════════════════════════════════
--
-- Insert-only throughout, with UPDATE granted on named columns only and DELETE
-- revoked. Nothing below can be rewritten by the application role, which is
-- what makes the immutability triggers above a guarantee rather than a habit.
GRANT SELECT, INSERT ON "affiliate_voice_tones" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("superseded_at") ON "affiliate_voice_tones" TO proovd_app;--> statement-breakpoint

GRANT SELECT, INSERT ON "affiliate_channel_metrics" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("superseded_at") ON "affiliate_channel_metrics" TO proovd_app;--> statement-breakpoint

-- No UPDATE at all. A standing snapshot is a computation at a moment; a
-- recomputation is a new row, and an editable score is a score somebody can
-- move without the inputs moving.
GRANT SELECT, INSERT ON "affiliate_standing_snapshots" TO proovd_app;--> statement-breakpoint

GRANT SELECT, INSERT ON "affiliate_referrals" TO proovd_app;--> statement-breakpoint
GRANT UPDATE ("state", "reviewed_by", "reviewed_at") ON "affiliate_referrals" TO proovd_app;--> statement-breakpoint

-- No UPDATE. Interest is recorded once and the unique index makes a repeat a
-- no-op rather than an edit.
GRANT SELECT, INSERT ON "creator_resource_interest" TO proovd_app;--> statement-breakpoint

-- No UPDATE. §33.12.4's prior value is worthless if it can be rewritten
-- afterwards — `admin_overrides`' rule, applied to the Creator's own record.
GRANT SELECT, INSERT ON "affiliate_profile_corrections" TO proovd_app;--> statement-breakpoint

REVOKE DELETE ON "affiliate_voice_tones" FROM proovd_app;--> statement-breakpoint
REVOKE DELETE ON "affiliate_channel_metrics" FROM proovd_app;--> statement-breakpoint
REVOKE DELETE ON "affiliate_standing_snapshots" FROM proovd_app;--> statement-breakpoint
REVOKE DELETE ON "affiliate_referrals" FROM proovd_app;--> statement-breakpoint
REVOKE DELETE ON "creator_resource_interest" FROM proovd_app;--> statement-breakpoint
REVOKE DELETE ON "affiliate_profile_corrections" FROM proovd_app;
