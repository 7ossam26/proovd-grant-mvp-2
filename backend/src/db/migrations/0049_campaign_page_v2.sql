-- ── The public campaign page, rebuilt — Session A, the record ────────────────
--
-- A post-Phase-24 change, 2026-08-18. Spec §14.4, §18, §20, §30, §3.2.
-- docs/phases/campaign-page-v2.md is the brief; the supplied reference is
-- docs/design-refrence/Proovd-Campaign-Page-v2.html.
--
-- §18 defines the campaign page's CONTENT and hands presentation to the DNA
-- document by name — "Every campaign page exposes all of the following; the DNA
-- UX document controls presentation." So a redesign is licensed and dropping an
-- item is not. Almost everything the reference draws is a re-presentation of
-- data already on disk; this migration is the part that genuinely is not.
--
-- Everything added here is OPTIONAL. Not one of these columns joins a
-- `REQUIRED_*` build register, and no CHECK requires any of them: a build must
-- never stop completing because a campaign has no marketing headline.
--
-- ── What this file deliberately does NOT add ────────────────────────────────
--
--   * No `goal` column, of any spelling, anywhere. §3.2 bans the word for an
--     Idea threshold in EVERY audience including identifiers, and §33.11.3's
--     scan reads the built bundle — where a prop name survives minification.
--     The reference's eyebrow is `PRIVATE BETA GOAL`; ours is ORDER THRESHOLD,
--     and the stored number is `campaign_build.order_threshold`, unchanged.
--     (The Campaigns hub hit this exact scan with `progress.goal` on its first
--     draft, which is what that scan is for.)
--   * No `follower_count` on `campaigns`, and no public count column of any
--     kind. §30 forbids fabricated popularity signals; a number computed from a
--     table nobody can audit is one. Session C's follow record carries no
--     counter either.
--   * No `is_featured` on a reward package. `featuredRewardSku` is already
--     `sort_order`'s answer, and a second mechanism would be a second answer.
--   * No schedule-shaped column on either new table — no `remind_at`, no
--     recurrence, no `next_send_at`. Neither table is read by any job. A demo
--     moment is copy on a page, not a thing that fires.
--   * No media column on `campaign_demo_moments`. The reference's demo stage is
--     CSS and text; §12's object storage is Track A4 and `unconfiguredStorage`
--     still throws, so a column for an asset nobody can upload would be the
--     §1.4 failure wearing a schema.
--
-- ── §25.8 retention: no window applies, stated rather than left implicit ────
--
-- §25.8 defines seven windows and none of them covers a Founder's own published
-- campaign content. `campaign_build`, `campaign_reward_packages`, and
-- `campaign_faqs` are not swept for that reason and never have been; the two new
-- tables are the same class of record and are not swept either. That is the same
-- answer 0046 gave for Admin-authored task content — and it is written down here
-- rather than inferred from the absence of a sweep, because inventing a window
-- where the Spec fixes none is §1 rule 6 in the other direction.
--
-- ═══ 1. campaign_build — the page's own copy (§14.4, §18) ═══════════════════
--
-- §14.4 lists "Hero preference" and "Product visuals and brand assets" among
-- the shared ingredients; these are the same class — presentation of the
-- Founder's own product. Not one of them carries a commercial rule: no price,
-- no date, no threshold, no eligibility. All nullable, all optional, and a
-- campaign with none of them renders the section it would have filled as
-- absent rather than empty.

ALTER TABLE "campaign_build" ADD COLUMN "hero_headline" text;--> statement-breakpoint
ALTER TABLE "campaign_build" ADD COLUMN "hero_headline_accent" text;--> statement-breakpoint
ALTER TABLE "campaign_build" ADD COLUMN "hero_subheadline" text;--> statement-breakpoint
ALTER TABLE "campaign_build" ADD COLUMN "founder_pull_quote" text;--> statement-breakpoint
ALTER TABLE "campaign_build" ADD COLUMN "platform_line" text;--> statement-breakpoint
ALTER TABLE "campaign_build" ADD COLUMN "demo_context_label" text;--> statement-breakpoint
ALTER TABLE "campaign_build" ADD COLUMN "benefits_heading" text;--> statement-breakpoint
ALTER TABLE "campaign_build" ADD COLUMN "rewards_heading" text;--> statement-breakpoint
ALTER TABLE "campaign_build" ADD COLUMN "updates_heading" text;--> statement-breakpoint
ALTER TABLE "campaign_build" ADD COLUMN "faq_heading" text;--> statement-breakpoint

-- ═══ 2. campaign_reward_packages — the reference's tier badge ═══════════════
--
-- `Lowest price` / `Best value` / `For five`. Free text rather than a closed
-- list: §14.4 names no badge vocabulary and inventing one would be §1 rule 6.
-- It is `requires_review` in the §20 register — a badge sits beside a price and
-- is exactly where "Best value" becomes a claim.

ALTER TABLE "campaign_reward_packages" ADD COLUMN "badge" text;--> statement-breakpoint

-- ═══ 3. campaign_updates — the reference's headline metric ══════════════════
--
-- The reference's latest update carries a large `86%` above its body. Both
-- halves or neither: a bare `86%` reads as nothing to a screen reader (the
-- label IS its accessible name, §28.5), and a label with no value is an empty
-- promise (§1.4). The database is what says so, rather than every writer
-- remembering.

ALTER TABLE "campaign_updates" ADD COLUMN "metric_label" text;--> statement-breakpoint
ALTER TABLE "campaign_updates" ADD COLUMN "metric_value" text;--> statement-breakpoint
ALTER TABLE "campaign_updates" ADD CONSTRAINT "campaign_updates_metric_pair" CHECK (
  ("metric_label" IS NULL) = ("metric_value" IS NULL)
);--> statement-breakpoint
-- A present half is a filled-in half. A blank string satisfies NOT NULL and
-- renders as the same nothing the pair CHECK exists to refuse.
ALTER TABLE "campaign_updates" ADD CONSTRAINT "campaign_updates_metric_non_blank" CHECK (
  "metric_label" IS NULL OR (btrim("metric_label") <> '' AND btrim("metric_value") <> '')
);--> statement-breakpoint

-- ═══ 4. campaign_demo_moments (§14.4-class presentation) ════════════════════
--
-- The reference's interactive demo stage: three moments of the Founder's own
-- product, each a time, a state word, a headline, and either a passive signal
-- or one action. §14.4 does not name it and this brief does not pretend it
-- does — it is presentation of the Founder's product, in the same class as the
-- hero and the visuals, and it carries no commercial rule.
--
-- A moment is a signal OR an action, and the database is what says so. The two
-- render differently and mean different things: a signal says the product left
-- you alone, an action says it asked for something. A row that claimed both, or
-- neither, would render as a card with a dead control on it.

CREATE TABLE "campaign_demo_moments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	-- `8:15`. A label the Founder types, never an instant the product
	-- interprets — §27.1's timezone rule governs deadlines the product promises
	-- to people, and this is a clock face in a mockup of their own app.
	"time_label" text NOT NULL,
	"moment_label" text NOT NULL,
	"state_word" text NOT NULL,
	"headline" text NOT NULL,
	"signal_text" text,
	"is_action" boolean DEFAULT false NOT NULL,
	"action_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "campaign_demo_moments" ADD CONSTRAINT "campaign_demo_moments_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id");--> statement-breakpoint

ALTER TABLE "campaign_demo_moments" ADD CONSTRAINT "campaign_demo_moments_shape" CHECK (
  ("is_action" AND "action_label" IS NOT NULL AND btrim("action_label") <> '')
  OR (NOT "is_action" AND "signal_text" IS NOT NULL AND btrim("signal_text") <> '')
);--> statement-breakpoint

ALTER TABLE "campaign_demo_moments" ADD CONSTRAINT "campaign_demo_moments_text_present" CHECK (
  btrim("time_label") <> ''
  AND btrim("moment_label") <> ''
  AND btrim("state_word") <> ''
  AND btrim("headline") <> ''
);--> statement-breakpoint

CREATE UNIQUE INDEX "campaign_demo_moments_order_idx"
  ON "campaign_demo_moments" ("campaign_id", "sort_order");--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "campaign_demo_moments" TO proovd_app;--> statement-breakpoint

-- ═══ 5. campaign_benefit_cards (§14.4-class presentation) ═══════════════════
--
-- The reference's three benefit cards. Its variant classes are named after one
-- campaign's copy — `.timing-card`, `.tap-card`, `.streak-card` — and the last
-- of those is a word §30 lists among the forbidden mechanics. More practically,
-- a variant named for Tidemark's copy is unusable by the next Founder. So the
-- three visual treatments are named by SHAPE: `bars`, `check`, `dots`.
--
-- A closed list, because a fourth value would render nothing at all — a card
-- with an empty visual is worse than a card that was refused (§1.4).

CREATE TABLE "campaign_benefit_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"footer_word" text NOT NULL,
	"visual_variant" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "campaign_benefit_cards" ADD CONSTRAINT "campaign_benefit_cards_campaign_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id");--> statement-breakpoint

ALTER TABLE "campaign_benefit_cards" ADD CONSTRAINT "campaign_benefit_cards_variant" CHECK (
  "visual_variant" IN ('bars', 'check', 'dots')
);--> statement-breakpoint

ALTER TABLE "campaign_benefit_cards" ADD CONSTRAINT "campaign_benefit_cards_text_present" CHECK (
  btrim("title") <> '' AND btrim("footer_word") <> ''
);--> statement-breakpoint

CREATE UNIQUE INDEX "campaign_benefit_cards_order_idx"
  ON "campaign_benefit_cards" ("campaign_id", "sort_order");--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "campaign_benefit_cards" TO proovd_app;--> statement-breakpoint

-- ═══ 6. Two new §20 live-edit surfaces ══════════════════════════════════════
--
-- 0027 pinned `campaign_live_edits.surface` to the six surfaces that existed
-- then. A demo moment and a benefit card are two more places a live campaign
-- can be edited, and §20's register now names their fields — so the CHECK has
-- to admit them or a legal column-one edit fails at the database with a
-- constraint name instead of at the register with a reason.
--
-- Dropped and re-added rather than widened in place: Postgres has no ALTER
-- CONSTRAINT for a CHECK's expression, and the two-statement form is what the
-- rest of this repo does (0009's scope-binding re-add is the precedent).

ALTER TABLE "campaign_live_edits" DROP CONSTRAINT "campaign_live_edits_surface_known";--> statement-breakpoint

ALTER TABLE "campaign_live_edits" ADD CONSTRAINT "campaign_live_edits_surface_known"
  CHECK ("surface" IN (
    'build', 'faq', 'reward_package', 'reservation', 'agreement', 'campaign',
    'demo_moment', 'benefit_card'
  ));
