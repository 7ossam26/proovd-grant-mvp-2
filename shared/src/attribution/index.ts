/**
 * The attribution contract and discovery timing — Spec §18, §25.2 (Phase 14b).
 *
 * The vocabulary the click ledger, the resolution, and the Day 8 discovery
 * switch are built from. The backend restates the click vocabulary and the
 * discovery window in `attribution/vocabulary.ts` and drift-tests them against
 * these arrays — the same restate-and-drift-test arrangement the state enums,
 * the policy register, the §6 settings, and the §17 launch checklist use,
 * because the backend cannot import `@proovd/shared` at runtime. The frontend
 * imports the attribution status vocabulary directly, through Vite.
 *
 * ── Every rule maps to a §33.6 test ─────────────────────────────────────────
 *   §33.6.1  the last valid same-browser Creator link wins; a direct return
 *            preserves it.
 *   §33.6.2  a later valid click replaces the earlier; the cookie ends at close.
 *   §33.6.3  a click before `activated_at`, while paused, or after close — and a
 *            mid-campaign Creator's traffic before their own activation — earns
 *            nothing.
 *   §33.6.4  a click on an activated link is provisional until the first post is
 *            verified.
 *   §33.6.5  Days 1–7 are known-link-only; the Day 8 discovery switch does not
 *            rewrite existing attribution.
 */

/* ── The attribution status a resolved cookie carries (frontend-facing) ─────── */

/**
 * §18: "Attribution … becomes payable only on successful capture and
 * verification." The status is the answer to "could a charge on this browser
 * finalize to this Creator?", computed at read time from the current link and
 * first-post state — never stored, because the link can pause after the click.
 *
 *   none        no valid Creator link is attributed on this browser.
 *   provisional a valid click is attributed, but the first post is not verified
 *               yet (§33.6.4) — it may finalize later, or may not.
 *   verified    the first post passed; a later successful capture may finalize.
 *   blocked     the link is paused (a correction or rejection, §17/§33.4.8), so
 *               no earning can finalize even though the click was once valid.
 */
export const ATTRIBUTION_STATUSES = ['none', 'provisional', 'verified', 'blocked'] as const;
export type AttributionStatus = (typeof ATTRIBUTION_STATUSES)[number];

/** The two statuses under which the "You came through [handle]" earn line shows. */
export function attributionMayEarn(status: AttributionStatus): boolean {
  return status === 'provisional' || status === 'verified';
}

/* ── The click ledger vocabulary (also enforced as SQL CHECKs) ──────────────── */

/**
 * A click either becomes the attributed winner on its browser or is ignored.
 * The distinction is decided at click time, from the link's state at that
 * instant, and recorded on the ledger so §33.6.3's "earns nothing" cases are an
 * auditable fact rather than the absence of one.
 */
export const CLICK_OUTCOMES = ['attributed', 'ignored'] as const;
export type ClickOutcome = (typeof CLICK_OUTCOMES)[number];

/**
 * Why an ignored click cannot create payable attribution (§18). Every reason is
 * a state the link was in when the click arrived — never a property of the
 * visitor — so the same click on the same link resolves the same way for
 * everyone.
 *
 *   before_activation  the link had no `activated_at` yet (§33.6.3). A
 *                      mid-campaign Creator's pre-activation traffic is this.
 *   paused             the link was paused by a correction/rejection (§17).
 *   after_close        the click arrived at or after `campaign_close_at`; the
 *                      cookie has already expired (§33.6.2).
 *   campaign_not_live  the campaign was not in its live window (not yet public,
 *                      suspended, or killed).
 *   link_test          the safe §14.1 link-test marker was present; the click
 *                      must not contaminate production attribution or metrics.
 */
export const CLICK_IGNORED_REASONS = [
  'before_activation',
  'paused',
  'after_close',
  'campaign_not_live',
  'link_test',
] as const;
export type ClickIgnoredReason = (typeof CLICK_IGNORED_REASONS)[number];

/* ── Discovery timing (§18, §33.6.5) ────────────────────────────────────────── */

/**
 * §18: "Campaign Days 1–7: public route is accessible through known Creator,
 * Founder, Proovd-house, or direct links but excluded from Proovd
 * browse/discovery and indexing surfaces. Beginning Day 8: campaign may enter
 * Proovd browse/indexable discovery."
 *
 * Day 1 is the live day, so the browse/index switch opens exactly seven days
 * after `campaign_live_at`. This is a fixed §18 constant, not a §6 setting — the
 * settings register does not carry it — so it lives here and the backend
 * restates it, drift-tested, rather than reading a row.
 */
export const DISCOVERY_KNOWN_LINK_ONLY_DAYS = 7;
export const DISCOVERY_BROWSE_OPENS_ON_DAY = 8;

/** The instant the Day 8 browse/index switch opens for a campaign gone live. */
export function discoveryOpensAt(campaignLiveAt: Date): Date {
  return new Date(campaignLiveAt.getTime() + DISCOVERY_KNOWN_LINK_ONLY_DAYS * 24 * 60 * 60 * 1000);
}
