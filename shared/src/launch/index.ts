/**
 * Coordinated launch and first-post verification — Spec §17, §29.6 (Phase 14a).
 *
 * The vocabulary the launch and the verification are built from: the strict
 * five-step launch order, §17's seven first-post verification checks, and the
 * three verification outcomes with their §17 effects. The backend restates the
 * checklist and the outcome effects in `launch/logic.ts` and drift-tests them
 * against these arrays — the same restate-and-drift-test arrangement the state
 * enums, the policy register, and the §6 settings use, because the backend
 * cannot import `@proovd/shared` at runtime.
 *
 * ── The order is the whole point (§17, §33.4.5) ─────────────────────────────
 * "Page first, links second" is not a style choice: a tracking link that
 * activates before the page it resolves to is a live URL pointing at a 404
 * (the phase's first trap). The step order below is the contract the launch
 * orchestration executes in exactly this sequence.
 *
 * ── Verification is a compliance gate, never a payment trigger (§33.4.7) ─────
 * The three outcomes decide whether traffic through a Creator's link may later
 * *finalize* — they move no money. "Passed" leaves post-activation traffic
 * provisionally attributable; "correction needed" and "rejected" pause the link
 * so nothing invalid can finalize. None of them releases the fixed payment,
 * launches, or unlaunches the page.
 */

/* ── The five-step launch order (§17) ──────────────────────────────────────── */

export interface LaunchStep {
  readonly key: string;
  readonly order: number;
  readonly label: string;
  /** Who performs it. */
  readonly actor: 'system' | 'creator' | 'admin';
}

/**
 * §17: "At `campaign_live_at`, execute idempotently in this order." Steps 1–2
 * are the atomic launch the system performs; 3–5 are the human sequence that
 * follows and cannot begin before the link that a post carries is live.
 */
export const LAUNCH_STEP_ORDER: readonly LaunchStep[] = [
  { key: 'activate_page', order: 1, label: 'Activate the approved public campaign page', actor: 'system' },
  {
    key: 'activate_links',
    order: 2,
    label: 'Activate scheduled Creator tracking links with activated_at = campaign_live_at',
    actor: 'system',
  },
  { key: 'publish_posts', order: 3, label: 'Creators publish their scheduled posts with the working links', actor: 'creator' },
  { key: 'submit_post_url', order: 4, label: 'Each Creator submits the public post URL', actor: 'creator' },
  { key: 'verify_post', order: 5, label: 'Admin verifies the live post', actor: 'admin' },
] as const;

/* ── §17's seven first-post verification checks ────────────────────────────── */

export interface FirstPostCheck {
  readonly key: string;
  readonly label: string;
  readonly description: string;
}

/**
 * §17: "For each submitted URL record submission time and verify:" — the seven
 * checks, verbatim in intent. They are recorded as a checklist on the
 * verification; none of them is derivable by the system (a human reads the post),
 * so the record is the Admin's judgement, stored with its result.
 */
export const FIRST_POST_VERIFICATION_CHECKS: readonly FirstPostCheck[] = [
  {
    key: 'channel_account_identity',
    label: 'Approved channel and account identity',
    description: 'The post is on the approved channel and the account matches the recruited Creator.',
  },
  {
    key: 'public_accessibility',
    label: 'Public accessibility',
    description: 'The post is publicly reachable without a login or a follow.',
  },
  {
    key: 'ftc_disclosure',
    label: 'FTC disclosure names Founder and product',
    description: 'A clear FTC disclosure names the Founder and the product being promoted.',
  },
  {
    key: 'brand_note_compliance',
    label: 'Brand-note compliance',
    description: 'The post follows the campaign brand notes and required wording.',
  },
  {
    key: 'no_prohibited_claim',
    label: 'No prohibited or unsupported claim',
    description: 'The post makes no prohibited claim and no claim it cannot support.',
  },
  {
    key: 'work_matches_terms',
    label: 'Work matches agreed terms',
    description: 'The delivered work matches the agreed deliverables and channel rules.',
  },
  {
    key: 'risk_disclosure',
    label: 'Campaign-type risk disclosure where material',
    description: 'Where material, the post carries the campaign-type/risk disclosure.',
  },
] as const;

export type FirstPostCheckKey = (typeof FIRST_POST_VERIFICATION_CHECKS)[number]['key'];

/* ── The three §17 outcomes and their effects ──────────────────────────────── */

export const POST_VERIFICATION_OUTCOMES = ['passed', 'correction_needed', 'rejected'] as const;
export type PostVerificationOutcome = (typeof POST_VERIFICATION_OUTCOMES)[number];

export interface OutcomeEffect {
  readonly outcome: PostVerificationOutcome;
  readonly label: string;
  /** §17's effect column, stated as product behaviour. */
  readonly effect: string;
  /** Does the Creator's tracking link pause? */
  readonly pausesLink: boolean;
  /** Does this open an enforcement review and preserve evidence? */
  readonly opensEnforcement: boolean;
}

/**
 * §17's outcome table. None of these moves money or touches the page launch
 * (§33.4.7, §33.4.8): "Post verification never launches or unlaunches the
 * campaign page and never releases fixed-payment money."
 */
export const POST_VERIFICATION_EFFECTS: Record<PostVerificationOutcome, OutcomeEffect> = {
  passed: {
    outcome: 'passed',
    label: 'Passed',
    effect:
      'Valid traffic and captured charges after activated_at remain provisionally attributable and may later finalize.',
    pausesLink: false,
    opensEnforcement: false,
  },
  correction_needed: {
    outcome: 'correction_needed',
    label: 'Correction needed',
    effect:
      "Pause this Creator's link as configured, identify the exact correction and its due time, and prevent invalid earnings from finalizing.",
    pausesLink: true,
    opensEnforcement: false,
  },
  rejected: {
    outcome: 'rejected',
    label: 'Rejected / serious breach',
    effect:
      'Pause the link, block invalid earnings, open an enforcement review, and preserve the evidence. The public campaign launch is not reversed.',
    pausesLink: true,
    opensEnforcement: true,
  },
};

/** Every §17 check answered true, and the whole checklist present. */
export function firstPostChecklistComplete(results: Partial<Record<string, boolean>>): boolean {
  return FIRST_POST_VERIFICATION_CHECKS.every((c) => results[c.key] === true);
}
