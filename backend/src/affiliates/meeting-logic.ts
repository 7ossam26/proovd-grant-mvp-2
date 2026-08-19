/**
 * The backend's copy of the three sentences deviation 1's message renders —
 * Founder Dashboard Session C.
 *
 * The backend never imports `@proovd/shared` at runtime: shared exports
 * TypeScript source, this package compiles under `rootDir: src`, and the
 * production image ships only `backend/dist`. So the sentences a rendered email
 * carries are restated here and drift-tested against shared, exactly as the
 * §14.5 roster labels, the §21 close registers and the §27.2 contract rules are.
 *
 * Only what a MESSAGE renders is restated. The absence register, the revision
 * kernel and the bonus copy are surface-side and reach the browser through
 * Vite — a second copy of those would be a second copy of an argument.
 */

/** §30, tech-stack §12: §12's Cal.com booking is the one scheduler. */
export const MEETING_REQUEST_IS_NOT_A_SCHEDULER =
  'This asks them if they want to talk. It does not book anything — if they say yes, Proovd arranges the time.';

/** §14.2's own promise, restated for a request that is not a proposal. */
export const MEETING_REQUEST_NO_PENALTY =
  'They can say no. It does not affect their standing, their terms, or anything about this campaign.';

/** §14.2: its three responses are the only things that move terms. */
export const MEETING_REQUEST_CHANGES_NOTHING =
  'Asking to meet changes nothing about their offer or your campaign. Their proposal stays exactly where it is.';
