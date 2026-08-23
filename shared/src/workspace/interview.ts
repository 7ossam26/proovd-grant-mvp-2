/**
 * The Founder interview booking — Spec §12, tech-stack §12.
 *
 * ── Four statuses, and §12 names all four ───────────────────────────────────
 * Saving a selected platform and time completes the item. Provider confirmation
 * can add joining details later; canceled and abandoned bookings do not count.
 *
 * ── Why the record is ours ──────────────────────────────────────────────────
 * tech-stack §12: "The booking record in our database is the source of truth,
 * populated from Cal.com webhooks. `interview_confirmed` is a domain state that
 * gates a US$2 listing-fee discount and one third of the high-effort
 * classification — it cannot live in a vendor's system." So these statuses are
 * Proovd's, a webhook is an *input* to them, and `confirmed` must stay reachable
 * without one (a missed webhook is a reconciliation, not a lost discount).
 *
 * ── Three conferencing providers, and a §6 setting that narrows them ────────
 * §12 fixes the set: "Google Meet, Zoom, or Microsoft Teams." A booking may
 * never carry a fourth, so this is a closed list. §6's `interview_providers`
 * setting is a different question — which of them Proovd actually offers — and
 * it ships unset with no default, so no slot can be offered until an operator
 * states one. The list here bounds what is storable; the setting decides what is
 * bookable.
 */

/** §12's four booking conditions. Only `confirmed` completes the item. */
export const INTERVIEW_STATUSES = [
  /** A time was chosen and the booking has not been confirmed. Does not count. */
  'selected',
  /** §12's one qualifying state. */
  'confirmed',
  /** Canceled by the Founder or by Proovd. Does not count. */
  'canceled',
  /** Started and left. Does not count. */
  'abandoned',
] as const;

export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

/** §12: "Google Meet, Zoom, or Microsoft Teams." A closed set. */
export const MEETING_PROVIDERS = ['google_meet', 'zoom', 'microsoft_teams'] as const;
export type MeetingProvider = (typeof MEETING_PROVIDERS)[number];

/** Customer-facing names. The stored values are internal (§3). */
export const MEETING_PROVIDER_LABELS: Record<MeetingProvider, string> = {
  google_meet: 'Google Meet',
  zoom: 'Zoom',
  microsoft_teams: 'Microsoft Teams',
};

/**
 * Whether a booking completes §12's Interview item.
 *
 * One function, because the fee calculation and the surface must never disagree
 * about it, and because the accepted statuses written in two places are one
 * refactor away from being written as `status !== 'canceled'` in one of them.
 */
export function interviewCompletesItem(status: InterviewStatus | null | undefined): boolean {
  return status === 'selected' || status === 'confirmed';
}

/**
 * Whether a booking counts as "scheduled or confirmed" for high-effort (§12).
 *
 * A saved or confirmed interview also satisfies the high-effort input.
 */
export function interviewCountsForHighEffort(status: InterviewStatus | null | undefined): boolean {
  return status === 'selected' || status === 'confirmed';
}
