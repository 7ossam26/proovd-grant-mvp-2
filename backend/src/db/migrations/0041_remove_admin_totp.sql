-- ── Removing the Admin second factor (2026-08-10) ──────────────────────────
--
-- The Admin TOTP/2FA layer was removed by product direction. §5.1 and §28.2
-- make Admin MFA mandatory, so this is a recorded deviation from the Spec
-- rather than a defect being fixed; `backend/src/auth/auth.ts` carries the
-- note, and §34's live-mode condition 8 was restated to describe the controls
-- that now exist.
--
-- What is NOT weakened here: `requireAdmin` still refuses every non-`admin`
-- role server-side, `requireFreshSession` still gates high-impact actions on a
-- recent sign-in, and no bypass replaced the factor.
--
-- Three things go, in this order — the child table first, then the flag on
-- `user`, then the §6 setting that claimed the requirement was in force.

-- 1. The factor store itself.
--
-- Dropped rather than emptied. The table held a symmetrically-encrypted TOTP
-- secret and a backup-code blob for every enrolled Admin; keeping that at rest
-- for a factor nothing verifies is strictly worse than not having it, and an
-- emptied table is one INSERT away from being a live credential store again.
-- The grant goes with it (a grant on a dropped table is dropped by Postgres).
DROP TABLE IF EXISTS "two_factor";--> statement-breakpoint

-- 2. The flag `requireAdmin` used to read.
--
-- Left in place it would be a column nothing writes and nothing reads, which
-- is exactly the shape a later phase mistakes for a meaningful signal — and a
-- default of `false` on a column named "two factor enabled" reads, to anyone
-- auditing the database, as "MFA is off for every Admin" rather than "there is
-- no MFA".
ALTER TABLE "user" DROP COLUMN IF EXISTS "two_factor_enabled";--> statement-breakpoint

-- 3. The §6 setting `admin_mfa_required`, seeded 'true' by 0004.
--
-- §1.4: a setting whose value asserts a control that no longer exists is a
-- false statement in the one surface an operator consults to learn what is in
-- force. It is deleted rather than flipped to 'false', because flipping it
-- would record a *decision to disable MFA* that nobody made — the requirement
-- was not turned off, the mechanism was removed.
--
-- `admin_reauth_window_seconds` is deliberately untouched. §6 names one
-- setting covering "Admin MFA and reauthentication window"; the
-- reauthentication half is still enforced on every high-impact action and is
-- now the only freshness control there is, which makes it more load-bearing
-- than before, not less.
--
-- History first: `app_setting_versions.key` has no FK to `app_settings`, so
-- deleting the setting alone would strand its version rows under a key that no
-- longer resolves. This is the one place in the product where audit history is
-- removed, and it is removed because the subject of that history — a
-- requirement flag for a mechanism that no longer exists — cannot be
-- interpreted without it.
DELETE FROM "app_setting_versions" WHERE "key" = 'admin_mfa_required';--> statement-breakpoint
DELETE FROM "app_settings" WHERE "key" = 'admin_mfa_required';
