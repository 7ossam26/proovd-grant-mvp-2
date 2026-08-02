/**
 * Campaign updates — Spec §18 (Phase 14c).
 *
 * The vocabulary an update is built from: its audience, which audiences each
 * campaign type allows, and the customer-facing labels. The backend restates
 * the audience set and the per-type rule in `campaign/updates.ts` and drift-tests
 * them against these arrays — the restate-and-drift-test arrangement every
 * backend copy of shared data uses, because the backend cannot import
 * `@proovd/shared` at runtime. The frontend imports the labels through Vite.
 *
 * ── The audiences (§18) ─────────────────────────────────────────────────────
 * §18: "Product: general/public or Backer-only. Idea: general/public,
 * Backer-only, or milestone/progress." So `milestone_progress` is an Idea-only
 * audience; the other two are common. A Backer-only update is authored and
 * stored, but shown only on the Backer's magic-link page — never on the public
 * campaign page (§25.1 line "Public and Backer-only updates" is a Backer-surface
 * item). The public page renders `general_public` and `milestone_progress`.
 */

export const UPDATE_AUDIENCES = ['general_public', 'backer_only', 'milestone_progress'] as const;
export type UpdateAudience = (typeof UPDATE_AUDIENCES)[number];

/** §18: which audiences each campaign model may post. Idea adds milestone/progress. */
export const UPDATE_AUDIENCES_BY_MODEL: Record<'idea' | 'product', readonly UpdateAudience[]> = {
  idea: ['general_public', 'backer_only', 'milestone_progress'],
  product: ['general_public', 'backer_only'],
};

export function updateAudienceAllowed(model: 'idea' | 'product', audience: UpdateAudience): boolean {
  return UPDATE_AUDIENCES_BY_MODEL[model].includes(audience);
}

/** The audiences the public campaign page renders — never Backer-only. */
export const PUBLIC_UPDATE_AUDIENCES: readonly UpdateAudience[] = ['general_public', 'milestone_progress'];

export function updateIsPublic(audience: UpdateAudience): boolean {
  return PUBLIC_UPDATE_AUDIENCES.includes(audience);
}

/** The §18 audience label rendered beside each update's local publication time. */
export const UPDATE_AUDIENCE_LABELS: Record<UpdateAudience, string> = {
  general_public: 'Public',
  backer_only: 'Backers only',
  milestone_progress: 'Milestone',
};
