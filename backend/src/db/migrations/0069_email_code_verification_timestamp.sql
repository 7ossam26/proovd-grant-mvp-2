-- Backfill the Admin panel's durable OTP confirmation instant.
--
-- Before this migration, successful verification wrote `email_ownership =
-- code_verified` and claimed the single-use secure token, but failed to copy
-- that instant onto the claim profile. Future verifications write both fields;
-- this repairs the already-confirmed records from their immutable token proof.

WITH verified_codes AS (
  SELECT
    campaign_draft_id,
    max(claimed_at) AS verified_at
  FROM secure_tokens
  WHERE scope = 'founder_email_code'
    AND claimed_at IS NOT NULL
  GROUP BY campaign_draft_id
)
UPDATE founder_claim_profiles profile
SET
  email_code_verified_at = verified_codes.verified_at,
  updated_at = greatest(profile.updated_at, verified_codes.verified_at)
FROM verified_codes
WHERE profile.draft_id = verified_codes.campaign_draft_id
  AND profile.email_ownership = 'code_verified'
  AND profile.email_code_verified_at IS NULL;

