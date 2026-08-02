/**
 * The attribution vocabulary the backend uses at runtime — Spec §18 (Phase 14b).
 *
 * `shared/src/attribution/index.ts` is the register; the backend cannot import
 * `@proovd/shared` at runtime (it compiles under `rootDir: src` and ships only
 * `dist`), so the click outcomes, the ignored reasons, the attribution
 * statuses, and the Day 8 discovery window are restated here and drift-tested in
 * `attribution.test.ts` against the shared arrays. This is the same
 * restate-and-drift-test arrangement the state enums, the §6 settings, and the
 * §17 launch checklist use.
 */

export const CLICK_OUTCOMES = ['attributed', 'ignored'] as const;
export type ClickOutcome = (typeof CLICK_OUTCOMES)[number];

export const CLICK_IGNORED_REASONS = [
  'before_activation',
  'paused',
  'after_close',
  'campaign_not_live',
  'link_test',
] as const;
export type ClickIgnoredReason = (typeof CLICK_IGNORED_REASONS)[number];

export const ATTRIBUTION_STATUSES = ['none', 'provisional', 'verified', 'blocked'] as const;
export type AttributionStatus = (typeof ATTRIBUTION_STATUSES)[number];

/** §18: Days 1–7 are known-link-only; the browse/index switch opens on Day 8. */
export const DISCOVERY_KNOWN_LINK_ONLY_DAYS = 7;

/** The instant the Day 8 browse/index switch opens for a campaign gone live. */
export function discoveryOpensAt(campaignLiveAt: Date): Date {
  return new Date(campaignLiveAt.getTime() + DISCOVERY_KNOWN_LINK_ONLY_DAYS * 24 * 60 * 60 * 1000);
}
