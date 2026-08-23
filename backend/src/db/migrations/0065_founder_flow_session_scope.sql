-- A persistent, draft-scoped Founder Flow authorization established after
-- email verification. It is deliberately a different scope from the delivered
-- invitation: rotating, revoking, claiming, or expiring that invitation cannot
-- change an already-valid flow session.
--
-- Postgres cannot use a new enum label in the transaction that adds it, so the
-- binding CHECK and live-session index follow in 0066.

ALTER TYPE "token_scope" ADD VALUE 'founder_flow_session';
