/**
 * The §12 workspace vocabulary, restated for the backend.
 *
 * `shared/src/workspace/` is the register. The backend never imports
 * `@proovd/shared` at runtime — that package exports TypeScript source, the
 * backend compiles under `rootDir: src`, and the production image ships only
 * `backend/dist` — so the keys that the database enums and the evidence engine
 * depend on are restated here as literals and
 * `src/tests/campaign-workspace.test.ts` fails the suite if the two ever
 * disagree.
 *
 * This is the same arrangement as the state enums in `db/schema/domain.ts`, the
 * required policy slugs in `policies/policy-gate.ts`, the setting bounds carried
 * as columns on `app_settings`, and the §5.3 subtypes in
 * `affiliates/registry.ts`. Restate, drift-test, never import across the
 * boundary.
 *
 * What is deliberately NOT restated: labels, questions, guidance, prompts. The
 * server decides; the surface writes. Copying the copy here would create a
 * second place for the product's words to live and the first divergence would
 * be invisible.
 */

/** Mirrors `OPTIONAL_ITEM_KEYS`. The order is §12's and the flow's. */
export const OPTIONAL_ITEM_KEYS = ['visuals', 'branding', 'interview', 'story', 'socials'] as const;
export type OptionalItemKey = (typeof OPTIONAL_ITEM_KEYS)[number];

/** Mirrors `EVIDENCE_REJECTION_CODES`. */
export const EVIDENCE_REJECTION_CODES = [
  'file_empty',
  'file_placeholder',
  'file_duplicate',
  'file_unreadable',
  'file_type_unsupported',
  'file_too_large',
  'url_malformed',
  'url_unreachable',
  'url_not_public',
  'not_approved',
  'nothing_supplied',
  'direction_incomplete',
  'logo_missing',
  'booking_unconfirmed',
  'booking_canceled',
  'booking_absent',
  'invalidated',
] as const;
export type EvidenceRejection = (typeof EVIDENCE_REJECTION_CODES)[number];

/** Mirrors `DECISION_SOURCES`, and the `decision_source` Postgres enum. */
export const DECISION_SOURCES = ['founder_approval', 'provider_event', 'admin_override'] as const;
export type DecisionSource = (typeof DECISION_SOURCES)[number];

/** Mirrors `INTERVIEW_STATUSES`, and the `interview_status` Postgres enum. */
export const INTERVIEW_STATUSES = ['selected', 'confirmed', 'canceled', 'abandoned'] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

/** Mirrors `MEETING_PROVIDERS`, and the `meeting_provider` Postgres enum. */
export const MEETING_PROVIDERS = ['google_meet', 'zoom', 'microsoft_teams'] as const;
export type MeetingProvider = (typeof MEETING_PROVIDERS)[number];

/**
 * §12's two interview rules, which are deliberately different.
 *
 * The item completes only on `confirmed`; the high-effort input is satisfied by
 * "scheduled/confirmed". Reading one for both would either pay the US$2 early
 * or classify an engaged Founder as high-effort. Both live here so the two
 * sentences of §12 have one implementation each.
 */
export function interviewCompletesItem(status: InterviewStatus | null | undefined): boolean {
  return status === 'confirmed';
}

export function interviewCountsForHighEffort(status: InterviewStatus | null | undefined): boolean {
  return status === 'selected' || status === 'confirmed';
}
