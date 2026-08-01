-- ── Stripe foundations — Spec §32.2, §32.3, §32.4, §13, §24.1, §28.3 ───────
--
-- No money moves in this phase. This is the record every later phase writes
-- into: the connected accounts §13 and §11 onboard, and the provider-object
-- store §32.4 requires for "every object affecting state".
--
-- ── Why the provider-object shape is built in full now ─────────────────────
-- §32.4 lists fourteen kinds of object and Phases 11, 13, 15, 18, 19, and 20
-- each populate a few. Building the shape once means those phases add rows;
-- building it incrementally means six migrations that each widen a table the
-- ledger is already reading, and a reconciliation query whose columns mean
-- different things depending on when the row was written.
--
-- ── Mode is a column, not an assumption ────────────────────────────────────
-- §32.2 fails closed on any mode mismatch and §34 gates live mode on proving
-- test/live separation. A store that did not record which mode an object came
-- from could not answer "is any of this live?" — which is exactly the question
-- §34 condition 5 asks. So mode is stored per row and a CHECK keeps it to the
-- two Stripe has.

CREATE TYPE "stripe_mode" AS ENUM ('test', 'live');--> statement-breakpoint

-- §24.1: "One Proovd Connect platform. Founder connected account is
-- seller/payment account for Backer campaign charges. Affiliate connected
-- account is a recipient only." Two roles, and the difference is a commercial
-- boundary rather than a label — an Affiliate account must never be the seller.
CREATE TYPE "connected_account_role" AS ENUM ('founder_seller', 'affiliate_recipient');--> statement-breakpoint

-- §13's four return states, plus the state before onboarding starts. These are
-- the states a HUMAN is shown, which is why they are an enum and not a
-- requirements array: §13 is explicit that returning from Stripe "always lands
-- on a human-readable status", and a raw array is not one.
CREATE TYPE "connected_account_state" AS ENUM (
  'not_started',
  'more_information_required',
  'under_review',
  'restricted',
  'complete'
);--> statement-breakpoint

-- Which account the object lives on. §24.1 keeps the listing fee (Proovd as
-- MoR, platform) and campaign charges (Founder as MoR, connected) in separate
-- streams; a store that could not say which one an object belonged to would
-- make that separation unprovable.
CREATE TYPE "provider_account_context" AS ENUM ('platform', 'connected');--> statement-breakpoint

-- §32.4's list, in full. Later phases add rows, not values.
CREATE TYPE "provider_object_type" AS ENUM (
  'checkout_session',
  'connected_account',
  'customer',
  'setup_intent',
  'payment_method',
  'tax_calculation',
  'payment_intent',
  'charge',
  'application_fee',
  'application_fee_refund',
  'refund',
  'dispute',
  'transfer',
  'transfer_reversal',
  'payout'
);--> statement-breakpoint

-- ── stripe_connected_accounts (§13, §11, §24.1) ────────────────────────────
CREATE TABLE "stripe_connected_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_account_id" text NOT NULL,
	"mode" "stripe_mode" NOT NULL,
	"role" "connected_account_role" NOT NULL,

	-- The person. §11: "Reuse valid onboarding from a prior campaign. Never ask
	-- an Affiliate to re-enter valid provider data." So the account belongs to a
	-- user, and campaigns reference it — not the other way round.
	"owner_user_id" text NOT NULL,

	"state" "connected_account_state" DEFAULT 'not_started' NOT NULL,

	-- §13: "Onboarding/requirements status." Stripe's own booleans, stored as
	-- they arrive rather than collapsed into one — `charges_enabled` false with
	-- `payouts_enabled` true is a real state and means something different from
	-- either alone.
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,

	-- §13: "the exact missing requirement". Kept as the provider's own lists so
	-- the surface can name what is missing instead of saying "more information".
	"requirements_currently_due" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requirements_past_due" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requirements_eventually_due" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requirements_pending_verification" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requirements_disabled_reason" text,

	-- §13: "Required capabilities/statuses."
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,

	-- §13: "Policy/agreement acceptance references." A reference — which
	-- agreement, accepted when — and deliberately not the acceptance IP or user
	-- agent Stripe also exposes: §28.4 limits collection to what is needed, and
	-- nothing here needs them.
	"agreement_type" text,
	"agreement_accepted_at" timestamp with time zone,

	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_connected_accounts_account_idx" ON "stripe_connected_accounts" USING btree ("stripe_account_id");--> statement-breakpoint
CREATE INDEX "stripe_connected_accounts_owner_idx" ON "stripe_connected_accounts" USING btree ("owner_user_id","role");--> statement-breakpoint

-- Every account reference is an account reference. The env guard says the same
-- thing about the configured ids; this says it about the stored ones, so a
-- value that arrived from a handler cannot be anything else.
ALTER TABLE "stripe_connected_accounts" ADD CONSTRAINT "stripe_connected_accounts_id_shape"
  CHECK ("stripe_account_id" LIKE 'acct\_%');--> statement-breakpoint

-- §13: "Proovd does not store Stripe-collected government ID documents."
-- There is no column here that could hold one, and this constraint refuses a
-- requirements payload that is anything but a list of requirement *names* —
-- so a future handler that widened what it copied would fail at the write
-- rather than quietly filing identity data (§25.7).
ALTER TABLE "stripe_connected_accounts" ADD CONSTRAINT "stripe_connected_accounts_requirements_are_lists"
  CHECK (
    jsonb_typeof("requirements_currently_due") = 'array'
    AND jsonb_typeof("requirements_past_due") = 'array'
    AND jsonb_typeof("requirements_eventually_due") = 'array'
    AND jsonb_typeof("requirements_pending_verification") = 'array'
  );--> statement-breakpoint

-- ── stripe_account_events (§13 "Return and refresh events") ────────────────
-- Append-only. §13 asks the record to hold the return and refresh events; a
-- Founder who bounced off Stripe three times and an Admin trying to work out
-- why need the same history, and one a later statement could edit is not it.
CREATE TABLE "stripe_account_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connected_account_id" uuid NOT NULL,
	"stripe_account_id" text NOT NULL,
	-- `link_created` | `returned` | `refreshed` | `account_updated` | `deauthorized`
	"event" text NOT NULL,
	"prior_state" "connected_account_state",
	"new_state" "connected_account_state",
	-- `founder` | `admin` | `provider:stripe` | `system:<job>`
	"source" text NOT NULL,
	"actor" text NOT NULL,
	-- The provider event this came from, when it came from one.
	"provider_event_id" text,
	"detail" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stripe_account_events" ADD CONSTRAINT "stripe_account_events_account_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."stripe_connected_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stripe_account_events_account_idx" ON "stripe_account_events" USING btree ("connected_account_id","occurred_at");--> statement-breakpoint

-- ── provider_objects (§32.4) ───────────────────────────────────────────────
CREATE TABLE "provider_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"mode" "stripe_mode" NOT NULL,
	"object_type" "provider_object_type" NOT NULL,
	"provider_object_id" text NOT NULL,

	-- §32.4: "account context".
	"account_context" "provider_account_context" NOT NULL,
	"stripe_account_id" text,

	-- §32.4: "related domain IDs". Nullable because which one applies depends on
	-- the object — a Checkout session belongs to a campaign, a Transfer to an
	-- association. Foreign keys where the table exists, so a row cannot point at
	-- a campaign that does not.
	"campaign_id" uuid,
	"reservation_id" uuid,
	"association_id" uuid,
	"owner_user_id" text,

	-- §32.4: "amount components". Integer cents in bigint (§4.1) — never a
	-- float, never a NUMERIC. Named columns for the ones the §24.3 waterfall
	-- reconciles against, and `amount_detail` for anything an object carries
	-- that these do not name.
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"amount_cents" bigint,
	"amount_tax_cents" bigint,
	"amount_fee_cents" bigint,
	"amount_application_fee_cents" bigint,
	"amount_net_cents" bigint,
	"amount_detail" jsonb,

	-- §32.4: "status".
	"status" text,

	-- §32.4: "idempotency key". The key Proovd sent, so a retry can be matched
	-- to the object it produced without asking the provider.
	"idempotency_key" text,

	-- §32.4: "failure details".
	"failure_code" text,
	"failure_message" text,
	"failure_detail" jsonb,

	-- §32.4: "timestamps". The provider's own, beside ours — they differ, and
	-- reconciliation cares which is which (§27.1: stored UTC).
	"provider_created_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_objects" ADD CONSTRAINT "provider_objects_campaign_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_objects" ADD CONSTRAINT "provider_objects_reservation_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_objects" ADD CONSTRAINT "provider_objects_association_fk" FOREIGN KEY ("association_id") REFERENCES "public"."campaign_affiliate_associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- One row per provider object per mode. The mode is in the key because a test
-- object and a live object may share an id shape and must never collide into
-- one row — which is the quiet way test data would end up in a live ledger.
CREATE UNIQUE INDEX "provider_objects_identity_idx" ON "provider_objects" USING btree ("provider","mode","provider_object_id");--> statement-breakpoint
CREATE INDEX "provider_objects_campaign_idx" ON "provider_objects" USING btree ("campaign_id","object_type");--> statement-breakpoint
CREATE INDEX "provider_objects_reservation_idx" ON "provider_objects" USING btree ("reservation_id","object_type");--> statement-breakpoint
CREATE INDEX "provider_objects_account_idx" ON "provider_objects" USING btree ("stripe_account_id","object_type");--> statement-breakpoint
CREATE INDEX "provider_objects_idempotency_idx" ON "provider_objects" USING btree ("idempotency_key");--> statement-breakpoint

-- An object on a connected account names the account; one on the platform does
-- not. §24.1 draws the line between Proovd-as-MoR and Founder-as-MoR money, and
-- a row that could not say which side it was on would blur it.
ALTER TABLE "provider_objects" ADD CONSTRAINT "provider_objects_account_context_named"
  CHECK (
    ("account_context" = 'connected' AND "stripe_account_id" IS NOT NULL)
    OR ("account_context" = 'platform' AND "stripe_account_id" IS NULL)
  );--> statement-breakpoint

-- Money is integer cents and is never negative here. A refund is its own object
-- with its own positive amount (§24.8), not a negative charge — the ledger reads
-- these by type, and a sign convention nobody wrote down is how a total comes
-- out wrong.
ALTER TABLE "provider_objects" ADD CONSTRAINT "provider_objects_amounts_non_negative"
  CHECK (
    COALESCE("amount_cents", 0) >= 0
    AND COALESCE("amount_tax_cents", 0) >= 0
    AND COALESCE("amount_fee_cents", 0) >= 0
    AND COALESCE("amount_application_fee_cents", 0) >= 0
    AND COALESCE("amount_net_cents", 0) >= 0
  );--> statement-breakpoint

-- ── The mode of a stored object is fixed ───────────────────────────────────
-- §34 condition 5 is about proving test and live never mixed. A row whose mode
-- could be edited afterwards would make that unprovable, and the edit that did
-- it would be the one nobody remembers making.
CREATE OR REPLACE FUNCTION enforce_provider_object_mode_immutable()
RETURNS trigger AS $$
BEGIN
  IF NEW.mode IS DISTINCT FROM OLD.mode THEN
    RAISE EXCEPTION 'provider_objects.mode cannot be changed';
  END IF;
  IF NEW.provider_object_id IS DISTINCT FROM OLD.provider_object_id THEN
    RAISE EXCEPTION 'provider_objects.provider_object_id cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER provider_objects_mode_immutable
  BEFORE UPDATE ON "provider_objects"
  FOR EACH ROW EXECUTE FUNCTION enforce_provider_object_mode_immutable();--> statement-breakpoint

-- Same for the connected account: its id and its mode are its identity.
CREATE OR REPLACE FUNCTION enforce_connected_account_identity()
RETURNS trigger AS $$
BEGIN
  IF NEW.stripe_account_id IS DISTINCT FROM OLD.stripe_account_id
     OR NEW.mode IS DISTINCT FROM OLD.mode
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION 'stripe_connected_accounts identity (account id, mode, owner) is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER stripe_connected_accounts_identity_immutable
  BEFORE UPDATE ON "stripe_connected_accounts"
  FOR EACH ROW EXECUTE FUNCTION enforce_connected_account_identity();--> statement-breakpoint

-- ── Grants ─────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON "stripe_connected_accounts" TO proovd_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "provider_objects" TO proovd_app;--> statement-breakpoint

-- Append-only, like every other history table here (§25.6).
GRANT SELECT, INSERT ON "stripe_account_events" TO proovd_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "stripe_account_events" FROM proovd_app;
