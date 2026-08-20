/**
 * The backend's copy of the sentences deviation 2's message renders — Founder
 * Dashboard Session D.
 *
 * The backend never imports `@proovd/shared` at runtime: shared exports
 * TypeScript source, this package compiles under `rootDir: src`, and the
 * production image ships only `backend/dist`. So the sentences a rendered email
 * carries are restated here and drift-tested against shared, exactly as the
 * §14.5 roster labels, the §21 close registers, the §27.2 contract rules and
 * Session C's `meeting-logic.ts` are.
 *
 * Only what a MESSAGE renders is restated. The absence register, the edit-tier
 * groups and the Glance copy are surface-side and reach the browser through
 * Vite — a second copy of those would be a second copy of an argument.
 */

/** §30, §11: the acknowledgement carries no note, and the record has no column. */
export const ACKNOWLEDGEMENT_HAS_NO_MESSAGE =
  'This tells them you saw it and nothing else. There is no note to write — anything you want to say goes through Proovd.';

/** Insert-only by grant: a message that was sent cannot be unsent. */
export const ACKNOWLEDGEMENT_IS_ONE_WAY =
  'Once you send it, they have it. There is no way to take it back, so it is worth meaning it.';
