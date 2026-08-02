/**
 * §17's first-post checklist and outcome effects, restated for the backend —
 * Spec §17, §33.4.7, §33.4.8.
 *
 * `shared/src/launch/index.ts` is the register. The backend cannot import
 * `@proovd/shared` at runtime (it compiles under `rootDir: src` and ships only
 * `dist`), so the seven check keys and the three outcome effects are restated
 * here and `launch.test.ts` drift-tests them against the shared arrays — the
 * same arrangement `interviews/labels.ts` and `creator-payment/logic.ts` use.
 */

/** §17's seven first-post verification check keys. Mirrors shared, drift-tested. */
export const FIRST_POST_CHECK_KEYS = [
  'channel_account_identity',
  'public_accessibility',
  'ftc_disclosure',
  'brand_note_compliance',
  'no_prohibited_claim',
  'work_matches_terms',
  'risk_disclosure',
] as const;

export type FirstPostCheckKey = (typeof FIRST_POST_CHECK_KEYS)[number];

/** §17's three outcomes. Mirrors shared `POST_VERIFICATION_OUTCOMES`. */
export const POST_OUTCOMES = ['passed', 'correction_needed', 'rejected'] as const;
export type PostOutcome = (typeof POST_OUTCOMES)[number];

export interface OutcomeEffect {
  /** Does the Creator's tracking link pause (§33.4.8)? */
  pausesLink: boolean;
  /** Does this open an enforcement review and preserve evidence (§17)? */
  opensEnforcement: boolean;
  /** The association status the outcome moves an `active` Creator to. */
  pausesAssociation: boolean;
}

/**
 * §17's outcome table, as effects. None moves money or touches the page launch
 * (§33.4.7): passed leaves traffic provisionally attributable; the other two
 * pause the link so nothing invalid can finalize, and rejected also opens
 * enforcement. Mirrors shared `POST_VERIFICATION_EFFECTS`, drift-tested.
 */
export const OUTCOME_EFFECTS: Record<PostOutcome, OutcomeEffect> = {
  passed: { pausesLink: false, opensEnforcement: false, pausesAssociation: false },
  correction_needed: { pausesLink: true, opensEnforcement: false, pausesAssociation: true },
  rejected: { pausesLink: true, opensEnforcement: true, pausesAssociation: true },
};

/** Every §17 check present and true. A checklist missing a key is not complete. */
export function checklistComplete(results: Record<string, unknown> | null | undefined): boolean {
  if (!results) return false;
  return FIRST_POST_CHECK_KEYS.every((k) => results[k] === true);
}

/** The keys whose recorded result is not `true` — the reasons a post did not pass. */
export function failedChecks(results: Record<string, unknown> | null | undefined): FirstPostCheckKey[] {
  return FIRST_POST_CHECK_KEYS.filter((k) => !results || results[k] !== true);
}
