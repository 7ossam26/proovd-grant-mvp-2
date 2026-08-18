/**
 * The backend's runtime copy of the digest frequency vocabulary.
 *
 * `backend/tsconfig.json` compiles under `rootDir: src` and the production
 * image ships only `backend/dist`, so nothing here can import `@proovd/shared`
 * at runtime — the constraint `db/schema/domain.ts` has documented since Phase
 * 01. The answer is the same one the state enums, the §6 settings and the §27
 * keys take: restate the data, drift-test it, never import across the boundary.
 *
 * `followers.test.ts` asserts this equals `DIGEST_FREQUENCIES` from shared.
 */

export const DIGEST_FREQUENCIES = ['daily', 'weekly'] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

/**
 * §25.8's FOURTH window: "Marketing consent: until unsubscribe + 2 years."
 *
 * A follower email is a marketing consent, exactly — so this is the Spec's own
 * number, not one derived from campaign resolution. Deriving one would be §1
 * rule 6 in the other direction: inventing a rule where the Spec speaks.
 * Window 5 separately covers the token hashes; window 1 does not apply,
 * because a follower has no reservation.
 */
export const FOLLOW_CONSENT_RETENTION_YEARS = 2;

/** The retention clock's anchor, stated once so nothing recomputes it. */
export function followAnonymisationDueAt(unfollowedAt: Date): Date {
  const due = new Date(unfollowedAt.getTime());
  due.setUTCFullYear(due.getUTCFullYear() + FOLLOW_CONSENT_RETENTION_YEARS);
  return due;
}
