/**
 * The §5.3 and §8 registers, restated for the backend — Spec §5.3, §8, §2.2.
 *
 * The backend never imports `@proovd/shared` at runtime. That package exports
 * TypeScript source, this package compiles under `rootDir: src`, and the
 * production image ships only `backend/dist`. So the facts the server needs at
 * runtime are restated here and `src/tests/affiliate-recruitment.test.ts` fails
 * the suite if they drift from the shared register — the same pattern as the
 * state enums in `db/schema/domain.ts`, the policy slugs in `policy-gate.ts`,
 * and the setting bounds carried as columns on `app_settings`.
 *
 * Restated deliberately: the subtype list, its required evidence, the
 * verification statuses, and the §2.2 slot rule. NOT restated: labels, help
 * text, and every `basis` string. Those are read by the Admin surface, which
 * imports the shared register through Vite and has no such constraint — copying
 * copy is how two sentences come to disagree.
 */

import { associationStatus } from '../db/schema/domain.js';

/** Mirrors shared `AFFILIATE_SUBTYPES` (§5.3). */
export const AFFILIATE_SUBTYPES = [
  'social_creator',
  'newsletter_blog_operator',
  'podcast_host',
  'community_owner',
  'course_instructor',
  'student_affiliate',
  'niche_marketer',
] as const;

export type AffiliateSubtype = (typeof AFFILIATE_SUBTYPES)[number];

/** Mirrors shared `VERIFICATION_STATUSES` (§8). */
export const VERIFICATION_STATUSES = ['unverified', 'in_review', 'verified', 'rejected'] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/**
 * The unconditional §5.3 evidence per subtype — mirrors shared
 * `requiredEvidenceIds`. Conditional inputs ("audit where appropriate", the
 * institution disclaimer) are excluded here exactly as they are there.
 */
export const REQUIRED_EVIDENCE: Readonly<Record<AffiliateSubtype, readonly string[]>> = {
  social_creator: ['platform', 'followers', 'engagement', 'analytics'],
  newsletter_blog_operator: ['subscribers', 'click_through', 'engagement'],
  podcast_host: ['subscribers', 'downloads'],
  community_owner: ['members', 'active_users', 'rules_permission'],
  course_instructor: ['enrolled_students', 'ratings', 'platform_constraints'],
  student_affiliate: ['kyc', 'handles', 'promotion_plan'],
  niche_marketer: ['channel_access', 'identity_disclosed_presence', 'traffic_plan', 'campaign_fit'],
};

/** Mirrors shared `missingEvidence`. */
export function missingEvidence(
  subtype: AffiliateSubtype,
  recorded: Readonly<Record<string, unknown>> | null | undefined,
): readonly string[] {
  const present = recorded ?? {};
  return (REQUIRED_EVIDENCE[subtype] ?? []).filter((key) => {
    const value = present[key];
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    return false;
  });
}

/* ── §2.2's active-partnership slot ────────────────────────────────────────── */

/** Mirrors shared `ACTIVE_PARTNERSHIP_SLOT_LIMIT` (§2.2). */
export const ACTIVE_PARTNERSHIP_SLOT_LIMIT = 3;

/**
 * Mirrors shared `SLOT_OCCUPYING_STATUSES` (§2.2, §8).
 *
 * A slot runs from tracking-link activation until campaign close or recorded
 * removal, so `active` and `paused` occupy one and nothing else does. §8 states
 * the negative half — preparing, invited, and declined occupy none.
 */
export const SLOT_OCCUPYING_STATUSES = ['active', 'paused'] as const;

const OCCUPYING = new Set<string>(SLOT_OCCUPYING_STATUSES);

export function occupiesActiveSlot(status: string): boolean {
  return OCCUPYING.has(status);
}

export interface SlotUsage {
  used: number;
  limit: number;
  remaining: number;
  atLimit: boolean;
}

export function slotUsage(statuses: readonly string[]): SlotUsage {
  const used = statuses.filter(occupiesActiveSlot).length;
  return {
    used,
    limit: ACTIVE_PARTNERSHIP_SLOT_LIMIT,
    remaining: Math.max(0, ACTIVE_PARTNERSHIP_SLOT_LIMIT - used),
    atLimit: used >= ACTIVE_PARTNERSHIP_SLOT_LIMIT,
  };
}

/**
 * The §23.4 states, read off the Postgres enum the schema already declares.
 *
 * Exposed here so the slot rule and the state list it classifies are checkable
 * against each other in one place: a §23.4 state added later that nothing
 * classifies is what the drift test catches.
 */
export const ASSOCIATION_STATUSES = associationStatus.enumValues;
