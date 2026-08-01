-- ── Scope binding for the Affiliate invitation token (§8, §11, §33.2.1) ────
--
-- Separate from 0008 only because Postgres refuses to use an enum label in the
-- transaction that added it, and the migrator runs one transaction per file.
-- 0008 added `affiliate_invitation` to `token_scope`; this is its first use.
--
-- §33.2.1: "No public signup; invitation claims only the Affiliate's
-- account/association."
--
-- The second half of that sentence is what this constraint enforces. An
-- `affiliate_invitation` token carries an association id and NOTHING else — no
-- draft id, no campaign id, no Backer identity — so a token issued for one
-- Creator on one campaign cannot be presented against another campaign's
-- surface, another Creator's account, or a Founder's draft. The association is
-- the scope, and the association names exactly one campaign and one prospect.
--
-- Enforcing it here rather than in the routes is the same choice §28.1's other
-- bindings made: a route that forgets the check is a bug, and a database that
-- cannot store the row is not.
ALTER TABLE "secure_tokens" DROP CONSTRAINT "secure_tokens_scope_binding";--> statement-breakpoint
ALTER TABLE "secure_tokens" ADD CONSTRAINT "secure_tokens_scope_binding" CHECK (
  ("scope" = 'founder_draft'
     AND "campaign_draft_id" IS NOT NULL
     AND "campaign_id" IS NULL
     AND "backer_identity_id" IS NULL
     AND "association_id" IS NULL)
  OR
  ("scope" = 'backer_magic_link'
     AND "campaign_draft_id" IS NULL
     AND "campaign_id" IS NOT NULL
     AND "backer_identity_id" IS NOT NULL
     AND "association_id" IS NULL)
  OR
  ("scope" = 'affiliate_invitation'
     AND "campaign_draft_id" IS NULL
     AND "campaign_id" IS NULL
     AND "backer_identity_id" IS NULL
     AND "association_id" IS NOT NULL)
);
