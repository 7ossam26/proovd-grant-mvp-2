/**
 * The Founder dashboard's four chapters — Founder Dashboard Session B.
 *
 * `docs/phases/founder-dashboard.md`. The Founder's home after the flow is one
 * address with four chapters: Choose, Live, Get paid, Wrap. This file is the
 * register the shell reads; the chapters' CONTENT belongs to Sessions C–F.
 *
 * ── Why any of this is a register rather than four `if`s ────────────────────
 * Three separate things have to agree about a chapter — the rail (which one is
 * current, which are open), the drawer (what each one is and why a locked one
 * is locked), and the router (which `?chapter=` values are addressable). Three
 * hand-written lists is two chances to disagree, and the disagreement shows up
 * as a rail tab that opens nothing.
 *
 * ── The reference's own copy, kept ──────────────────────────────────────────
 * The labels, titles, notes and lock lines below are the supplied reference's
 * (`STORY_CHAPTERS` / `storyLockedLine`), not this session's paraphrase.
 *
 * ── Nothing here reads a query parameter (B4) ───────────────────────────────
 * The reference drives its own state from `?phase=`, `?type=`, `?day=`. In
 * production every one of those is a column: the chapter a campaign is in is
 * derived from `campaigns.status`, and whether the money chapters can open at
 * all is derived from `campaign_live_at`. A value a caller can set is a value a
 * caller can lie about, which is the identity mistake `routes/vetting.ts`
 * records — and here it would hand somebody the Get-paid chapter of a campaign
 * that never opened.
 */

import type { CampaignStatus } from '../states/campaign.js';

/* ── The four chapters ───────────────────────────────────────────────────── */

export const FOUNDER_CHAPTER_IDS = ['choose', 'live', 'payouts', 'after'] as const;
export type FounderChapterId = (typeof FOUNDER_CHAPTER_IDS)[number];

export interface FounderChapter {
  readonly id: FounderChapterId;
  /** The rail's word. */
  readonly label: string;
  /** The chapter's own heading. */
  readonly title: string;
  /** One line, in the drawer, saying what the chapter is for. */
  readonly note: string;
  /**
   * Why this chapter is not open yet, read by the drawer. `null` for the one
   * chapter that is always open — a lock line for a thing that never locks is
   * a sentence nobody can ever be shown (§1.4).
   */
  readonly lockedLine: string | null;
}

export const FOUNDER_CHAPTERS: readonly FounderChapter[] = [
  {
    id: 'choose',
    label: 'Choose',
    title: 'Choose your launch team',
    note: 'Matches, terms and the people you want beside you.',
    lockedLine: null,
  },
  {
    id: 'live',
    label: 'Live',
    title: 'Run the campaign',
    note: 'What changed, what needs you and how the campaign is moving.',
    lockedLine: 'Opens when a creator accepts and the campaign is live.',
  },
  {
    id: 'payouts',
    label: 'Get paid',
    title: 'Get paid',
    /*
      The reference's own line reads "Card retries, W-9, payout requests and
      delivery proof." Session E replaced two thirds of it, deliberately:
      §22.3 has no Founder request for a scheduled payment, and there is no
      route that could take one, so a chapter note promising the control would
      be §1.4's failure in the one sentence describing what the chapter is for.
      "Delivery proof" went with it — §22.4's evidence is a recorded checklist
      with a durable receipt, and R2 is unconfigured besides (Track A4).
    */
    note: 'Card retries, your W-9, when each payment lands, and what you owe your backers.',
    lockedLine: 'Opens when the campaign closes and the money is counted.',
  },
  {
    id: 'after',
    label: 'Wrap',
    title: 'Keep the story',
    note: 'Creator recap, backer export, cooldown and what comes next.',
    lockedLine: 'Opens when the campaign is over.',
  },
] as const;

export function founderChapter(id: FounderChapterId): FounderChapter {
  const found = FOUNDER_CHAPTERS.find((chapter) => chapter.id === id);
  // Unreachable through the type, and thrown rather than defaulted: silently
  // substituting chapter one would render the wrong chapter under the right
  // address, which is worse than a stack trace.
  if (!found) throw new Error(`no founder chapter '${id}'`);
  return found;
}

export function founderChapterIndex(id: FounderChapterId): number {
  return FOUNDER_CHAPTER_IDS.indexOf(id);
}

/** `?chapter=` is the position (DNA §5.12), so an unknown value is not fatal. */
export function isFounderChapterId(value: unknown): value is FounderChapterId {
  return (
    typeof value === 'string' &&
    (FOUNDER_CHAPTER_IDS as readonly string[]).includes(value)
  );
}

/* ── Which chapter a campaign is IN ──────────────────────────────────────── */

/**
 * Every one of §23.1's 27 lifecycle states, mapped to the chapter whose work it
 * is. Total by `satisfies`, on the `CAMPAIGN_STATUS_LABELS` precedent: a 28th
 * campaign state fails the BUILD rather than quietly falling into chapter one.
 *
 * Three groupings are worth stating because they are judgements:
 *
 *  - `refunded_no_creator` and `ended_no_charge` are `after`. Both are ended
 *    campaigns; §14.6 and §31.6 can both produce one that was never live, which
 *    is exactly what `everLive` below exists to keep out of the money chapters.
 *  - `captured_pending_w9` through `remaining_payment_released` are `payouts`
 *    rather than `after`: §22.3's money is still moving, and `day_14_review`
 *    sits between two payments rather than after the last one.
 *  - `suspended`, `killed` and `banned_founder` are `after` — a suspended
 *    campaign is neither recruiting nor running, and §29's recorded state and
 *    the outcome-specific ended page are Chapter 4's. A suspension can be
 *    lifted and the campaign returns to its own status, so nothing here is
 *    stored; this map is read on every request.
 */
export const CAMPAIGN_STATUS_CHAPTER = {
  invited_draft: 'choose',
  vetting_submitted: 'choose',
  account_claimed: 'choose',
  stripe_onboarding_pending: 'choose',
  listing_fee_pending: 'choose',
  affiliate_response_and_build: 'choose',
  pending_review: 'choose',
  changes_required: 'choose',
  approved: 'choose',
  creator_prep: 'choose',
  creator_replacement: 'choose',
  refunded_no_creator: 'after',
  live: 'live',
  closed_pending_capture: 'payouts',
  capture_retry_window: 'payouts',
  closed_reconciling: 'payouts',
  captured_pending_w9: 'payouts',
  single_payment_released: 'payouts',
  first_payment_released: 'payouts',
  day_14_review: 'payouts',
  remaining_payment_released: 'payouts',
  fulfilled: 'after',
  closed_resolved: 'after',
  ended_no_charge: 'after',
  suspended: 'after',
  killed: 'after',
  banned_founder: 'after',
} as const satisfies Record<CampaignStatus, FounderChapterId>;

export function founderChapterForStatus(status: string): FounderChapterId {
  return (
    (CAMPAIGN_STATUS_CHAPTER as Record<string, FounderChapterId | undefined>)[status] ??
    'choose'
  );
}

/* ── Which chapters may be opened ────────────────────────────────────────── */

export interface FounderChapterFacts {
  /** `campaigns.status`. */
  readonly status: string;
  /**
   * Whether `campaign_live_at` is stamped — §17's launch sets it, and nothing
   * else does.
   *
   * This is the whole reason the shell reads a column rather than counting
   * statuses. A §31.6 cancellation and a §14.6 no-Creator failure both END a
   * campaign that never opened, so both land in `after`; without this, "the
   * chapters up to the current one are open" would hand that Founder a Live
   * chapter and a Get-paid chapter for a campaign with no Backers and no
   * charge. `campaign_close_at` cannot stand in for it — §17 stamps that at
   * LAUNCH, so it is a scheduled instant rather than evidence of anything.
   */
  readonly everLive: boolean;
}

/**
 * Past chapters stay open; future ones do not. The reference's own rule, with
 * the `everLive` exception above.
 */
export function founderChapterUnlocked(
  id: FounderChapterId,
  facts: FounderChapterFacts,
): boolean {
  const reached = founderChapterIndex(founderChapterForStatus(facts.status));
  if (id === 'choose') return true;
  if (id === 'live') return facts.everLive;
  if (id === 'payouts') return facts.everLive && reached >= founderChapterIndex('payouts');
  return reached >= founderChapterIndex('after');
}

/** The chapter to show when the address names none, or names a locked one. */
export function founderChapterOrDefault(
  requested: unknown,
  facts: FounderChapterFacts,
): FounderChapterId {
  const current = founderChapterForStatus(facts.status);
  if (!isFounderChapterId(requested)) return current;
  return founderChapterUnlocked(requested, facts) ? requested : current;
}

/* ── The address ─────────────────────────────────────────────────────────── */

/**
 * `/campaigns/:campaignId/home` keeps its address, so the flow's own
 * `You're live` link and every §27 email that points there keep working. The
 * chapter is a search parameter rather than a path segment for the reason the
 * Admin record tabs are: four views of ONE campaign, and a bookmark to the
 * Get-paid chapter should still be that campaign (DNA §5.12).
 */
export function founderDashboardPath(campaignId: string, chapter?: FounderChapterId): string {
  const base = `/campaigns/${encodeURIComponent(campaignId)}/home`;
  return chapter ? `${base}?chapter=${chapter}` : base;
}

/* ── What is built, and what is not ──────────────────────────────────────── */

export interface FounderChapterBuildState {
  /** The session that fills this chapter's content. */
  readonly session: string;
  /**
   * Where this chapter's work is done TODAY, as real addresses. An interim
   * chapter names the surface that owns it rather than apologising — the
   * arrangement the Admin rebuilds used for their un-rebuilt sections.
   *
   * `null` once the chapter renders its own content.
   */
  readonly ownedForNowBy: readonly { readonly label: string; readonly path: string }[] | null;
}

export const FOUNDER_CHAPTER_BUILD = {
  choose: {
    // §14.5's roster, §14.2's three responses, §14.3's bonus, the two
    // `campaign_build` fields, and deviation 1 — built Session C. The retired
    // `/roster` and `/creator-readiness` addresses redirect here.
    session: 'Session C',
    ownedForNowBy: null,
  },
  live: {
    // §20's Glance, ranked Act and Explore have existed since Phase 17a and are
    // swept by §33.11. The shell renders that surface rather than a placeholder
    // over the top of it — Session D rebuilds it to the reference.
    session: 'Session D',
    ownedForNowBy: null,
  },
  payouts: {
    // §21's retry window, §22.3's W-9 and schedule through the ONE resolver,
    // §22.4's Day 14 checklist and its durable receipt, and §22.5's four
    // obligations — built Session E. The retired `/results` and `/fulfillment`
    // addresses redirect here.
    session: 'Session E',
    ownedForNowBy: null,
  },
  after: {
    session: 'Session F',
    ownedForNowBy: [
      { label: 'Get paid', path: '/campaigns/:campaignId/home?chapter=payouts' },
      { label: 'Your campaigns', path: '/campaigns' },
    ],
  },
} as const satisfies Record<FounderChapterId, FounderChapterBuildState>;

/**
 * The drawer's own line. Pinned because it is the promise the lock states make
 * — a Founder who reads "Not yet" needs to know it is a sequence rather than a
 * permission they have to ask for.
 */
export const FOUNDER_CHAPTERS_INTRO =
  'Past chapters stay open. Future ones unlock when the campaign earns them.';
