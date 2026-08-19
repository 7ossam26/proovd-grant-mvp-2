/**
 * The Creator app shell and Home — Creator Flow v2 **deviation 5**, Session D,
 * 2026-08-19.
 *
 * ═══ A RECORDED DEVIATION FROM §1 RULE 6, BY EXPLICIT PRODUCT DIRECTION ═════
 *
 * §26: *"The Admin panel is the only dashboard-style product in MVP."* The Spec
 * gives the Creator four named surfaces — §11's claim, §10's preparing kit,
 * §14.1's opportunity, §17's active partnership — plus settings and the §27.7
 * notification history, and no home.
 *
 * What is built is a home that is **not a widget grid**. §20's rules for the
 * Founder campaign home, applied here by analogy because the Spec gives no
 * Creator equivalent:
 *
 *   * one thing waiting, or the caught-up ending with **no manufactured CTA**
 *     (DNA §5.4, and §20's own sentence);
 *   * every number derived from a record that exists, or not shown at all;
 *   * no counters table — the pitch count is a query over `proposal_versions`
 *     and the association states, exactly as §20's counts compose from
 *     `reservation_status_history`;
 *   * freshness stated as a time and never as a claim about immediacy —
 *     `GLANCE_FRESHNESS` is reused rather than a second wording minted, and
 *     `BANNED_FRESHNESS_TERMS` is scanned across this surface too;
 *   * every unpopulated block names what it is waiting for (§16a).
 *
 * ── What a later phase must not read this as licence for ───────────────────
 * Not a Backer dashboard. Not real-time sockets. Not a second place a campaign
 * is operated from — every section here links INTO the surface that owns the
 * work, which is the Campaigns hub's own read-and-route architecture.
 */

/* ── The rail ─────────────────────────────────────────────────────────────── */

export interface CreatorAppSection {
  id: string;
  label: string;
  /**
   * Where it goes, or `null` while the section has no address at all.
   *
   * `href` and `unavailableBecause` are never both set and never both null —
   * the `CAMPAIGN_DESTINATIONS` arrangement, asserted in both directions. A
   * rail entry that is neither reachable nor explained is the shown-but-broken
   * control §1.4 exists to prevent.
   */
  href: string | null;
  /** Why it does not open yet, in words a person reads. */
  unavailableBecause: string | null;
  /** Which session replaces it. Removed with the entry when that lands. */
  buildsIn: string | null;
}

/**
 * The five sections, in the reference's own order.
 *
 * Two of them point at addresses that already exist and are genuinely the
 * section rather than a stand-in: `Pitches` is the Creator's own campaign and
 * invitation list (Session E redraws it as `Active`/`Pitches` over the same
 * decisions), and `Settings` is the §27.7 preference surface, which is the only
 * settings address a Creator has ever had. Session F builds the rest of §5.3's
 * settings onto that address.
 *
 * The other two have no address at all, and say so rather than opening
 * something that is not what the label promised.
 */
export const CREATOR_APP_SECTIONS: readonly CreatorAppSection[] = [
  {
    id: 'home',
    label: 'Home',
    href: '/creator/home',
    unavailableBecause: null,
    buildsIn: null,
  },
  {
    id: 'pitches',
    label: 'Pitches',
    href: '/creator/campaigns',
    unavailableBecause: null,
    buildsIn: null,
  },
  {
    id: 'earnings',
    label: 'Earnings',
    href: null,
    unavailableBecause:
      'Your earnings live on each campaign for now — open a campaign from Pitches to see what it has earned. One earnings page across every campaign is being built.',
    buildsIn: 'F',
  },
  {
    id: 'resources',
    label: 'Resources',
    href: null,
    unavailableBecause:
      'Everything you need to promote a campaign is in that campaign’s own kit, which you get when you accept it. There is nothing separate to open yet.',
    buildsIn: 'F',
  },
  {
    id: 'settings',
    label: 'Settings',
    href: '/creator/settings/notifications',
    unavailableBecause: null,
    buildsIn: null,
  },
];

export const CREATOR_APP_SECTION_IDS: readonly string[] = CREATOR_APP_SECTIONS.map((s) => s.id);

/** The rail's own labels for the two controls that are not sections. */
export const CREATOR_APP_UPDATES_LABEL = 'Updates';
export const CREATOR_APP_SIGN_OUT_LABEL = 'Sign out';
export const CREATOR_APP_MENU_LABEL = 'Menu';

/**
 * Pinned. Renders at the top of the notification drawer.
 *
 * 22c's history is a read over `notification_deliveries` and nothing else: no
 * count, no read state, no unread column. Somebody who has used any other
 * product will read a list of messages as an inbox and expect the ones they
 * have not opened to be marked, so the drawer says what it is rather than
 * leaving them to work it out from the absence of a badge.
 */
export const CREATOR_UPDATES_ARE_A_RECORD =
  'A record of what we have emailed you, newest first. Nothing here is unread or waiting — it is the same list your inbox has.';

/* ── Home ─────────────────────────────────────────────────────────────────── */

/** The reference's own greeting. A name we already hold, and nothing else. */
export function creatorHomeGreeting(firstName: string | null): string {
  const trimmed = (firstName ?? '').trim();
  return trimmed ? `Hi ${trimmed}` : 'Hi';
}

export const CREATOR_HOME_WAITING_EYEBROW = 'Waiting for you';

/**
 * The hero headline. §20's one Act, in the Creator's vocabulary.
 *
 * A count of things a person can act on right now, from a query — never a
 * stored counter, and never a number that includes anything already decided.
 */
export function creatorPitchesWaitingHeadline(count: number): string {
  return count === 1 ? '1 pitch waiting' : `${count} pitches waiting`;
}

export const CREATOR_HOME_REVIEW_ACTION = 'Review pitches';

/**
 * The caught-up ending. The reference's own words, and DNA §5.4's designed
 * done-moment rather than a gap to fill.
 *
 * §20: *"show no manufactured CTA"*. There is no action beside this sentence
 * and nowhere in the component for one to be added — the branch that renders it
 * returns no control at all.
 */
export const CREATOR_HOME_CAUGHT_UP = 'You’re all caught up.';

/**
 * The caught-up body. §27.1's questions the ending still owes: what happens
 * next, who owns it, and how you will hear.
 *
 * Deliberately not a control. Naming the next thing is not the same as offering
 * one, and the difference is that nobody is being asked to do anything.
 */
export const CREATOR_HOME_CAUGHT_UP_BODY =
  'Nothing is waiting on you. When a Founder invites you to a campaign we email you, and it appears under Pitches.';

export const CREATOR_HOME_STANDING_TITLE = 'Your standing';
export const CREATOR_HOME_TRACK_RECORD_TITLE = 'Track record';
export const CREATOR_HOME_TEAM_UP_TITLE = 'Team up again';

/**
 * The leaderboard's title.
 *
 * The reference says `Ranked by impact`, which is a word for a thing nothing
 * measures. This ranks by the standing score, which is the number beside it,
 * and says so — a heading naming a different quantity is how a reader concludes
 * a second measurement exists.
 */
export const CREATOR_HOME_LEADERBOARD_TITLE = 'Ranked by standing';

/** §3.1: the customer-facing name is Creator. The reference says `affiliates`. */
export const CREATOR_HOME_REFERRAL_TITLE = 'Refer another Creator';

/**
 * Pinned. Renders with `Team up again`.
 *
 * The §22.9 request is the FOUNDER's ask, and §30 defers direct Founder-Creator
 * messaging — so there is no control here that starts one, and the section is
 * empty until a Founder has asked. Without this sentence an empty section reads
 * as something broken rather than as something nobody has used yet (§16a).
 */
export const CREATOR_TEAM_UP_IS_THE_FOUNDERS_ASK =
  'Founders you have worked with can ask you to work together again. Their request appears here and you answer yes or no — there is nothing to send from your side, and saying no carries no penalty.';

/**
 * Pinned. Renders where the reference draws `Pick your next campaign`.
 *
 * That control implies a pool to pick from. §5.3 admits Creators only through a
 * private, campaign-specific invitation and §30 defers browsing; a button
 * offering a choice nobody has is worse than no button (§1.4). What replaces it
 * is the honest sentence, beside a link to the invitations the Creator holds.
 */
export const CREATOR_NO_CAMPAIGN_POOL =
  'There is no catalogue of campaigns to browse. Founders and Proovd invite you to a specific campaign, and every invitation you hold is under Pitches.';

/* ── What the reference draws that this surface refuses ───────────────────── */

export interface CreatorAppAbsence {
  id: string;
  /** What the reference draws, in its own words where it has them. */
  element: string;
  /** The pinned constant that renders in its place, where one does. */
  replacedBy: string | null;
  reason: string;
  specRef: string;
}

/**
 * `AFFILIATE_OPERATIONS_ABSENCES`' arrangement, applied to a customer surface.
 *
 * A refusal recorded only in a comment is one a later session deletes without
 * noticing. Where the refusal has a visible consequence the entry names the
 * pinned constant that renders in its place — so re-adding one of these means
 * deleting the sentence that says why it must not exist. Where there is nothing
 * to say, because a badge simply does not appear, `replacedBy` is `null` and
 * the suite asserts the ABSENCE instead.
 */
export const CREATOR_APP_ABSENCES: readonly CreatorAppAbsence[] = [
  {
    id: 'founders_see_this',
    element: 'A `Founders see this` badge on the standing tier.',
    replacedBy: null,
    reason:
      'Nothing shows a Creator tier to a Founder. §11’s roster projection is seven columns and the quality tier is not among them, and §8 makes that tier assessment data. Either the Founder-side render exists or the claim does not; the claim goes.',
    specRef: '§8, §11',
  },
  {
    id: 'tier_unlocks',
    element: '`Climb toward Platinum for higher floors and early access.`',
    replacedBy: 'STANDING_BINDS_NOTHING',
    reason:
      'An eligibility condition in §1 rule 6’s own list, and it would collide with §29.4’s `restrict bidding`, which the Admin workspace already derives from enforcement records rather than storing.',
    specRef: '§1 rule 6, §29.4',
  },
  {
    id: 'streak',
    element: '`6-campaign streak. These only go up.`',
    replacedBy: null,
    reason: '§30 forbids streaks by name. A count that can only rise is a pressure mechanic.',
    specRef: '§30',
  },
  {
    id: 'shout_outs',
    element: '`Founder shout-outs` — two testimonials attributed to named Founders.',
    replacedBy: null,
    reason:
      'No record holds them, and §30 defers public Founder ratings from the other direction. Building the record would be building the thing that is deferred.',
    specRef: '§30',
  },
  {
    id: 'hits',
    element: 'The track record’s `Hits` count.',
    replacedBy: null,
    reason:
      'A hit would have to mean a campaign that sold well, which is the sales judgement §22.8 keeps out of a Creator’s standing entirely. `Verified` replaces it: a fact about what the Creator did.',
    specRef: '§22.8, §33.10.6',
  },
  {
    id: 'invented_tier_tasks',
    element:
      '`Reply to new matches within 24 hours` and `Keep your conversion above 4%`, with `More tasks`.',
    replacedBy: null,
    reason:
      'The first would make §14.2’s no-penalty decline untrue; the second is a performance target no record sets, and §22.8 keeps sales out of standing. The third seeded task has a record behind it and survives.',
    specRef: '§14.2, §22.8',
  },
  {
    id: 'referral_percentage',
    element: '`Bring an affiliate you’d vouch for and earn a percentage of their campaigns.`',
    replacedBy: 'REFERRAL_PAYS_NOTHING',
    reason:
      '§24 defines four money streams and this would be a fifth, paid out of somebody else’s campaign to a person with no association to it. The record has no amount column.',
    specRef: '§24',
  },
  {
    id: 'public_join_link',
    element: '`proovd.co/join/mohab` with a `Copy` button.',
    replacedBy: 'REFERRAL_HAS_NO_PUBLIC_LINK',
    reason:
      '§5.3 admits Creators only through a private, campaign-specific invitation. A link-shaped thing that opened a form would still read as a signup route to everybody who saw it.',
    specRef: '§5.3, §8',
  },
  {
    id: 'pick_next_campaign',
    element: '`Pick your next campaign`, a full-width primary action.',
    replacedBy: 'CREATOR_NO_CAMPAIGN_POOL',
    reason:
      'It implies a pool to pick from, which §5.3 and §30 both refuse. What renders instead is the honest sentence beside a link to the invitations the Creator actually holds.',
    specRef: '§5.3, §30',
  },
  {
    id: 'updates_unread_count',
    element: '`Updates · 2 new` in the menu and a `2` beside the rail’s bell.',
    replacedBy: 'CREATOR_UPDATES_ARE_A_RECORD',
    reason:
      '22c’s history is a read over notification_deliveries with no count in the payload, no read-state write, and no unread column. A badge here would be the first of the four things that turn it into a dashboard, and it would have to be computed from a column that deliberately does not exist.',
    specRef: '§27.7, §30',
  },
  {
    id: 'sign_out_returns_to_onboarding',
    element: '`signOut()` resets to step 0 of the wizard.',
    replacedBy: null,
    reason:
      'A prototype artifact. Signing out ends the session; the onboarding token was claimed and revoked when the account was created, so there is nothing to return to.',
    specRef: '§5.3',
  },
  {
    id: 'leaderboard_money',
    element: 'A leaderboard row carrying another Creator’s earnings or campaigns.',
    replacedBy: 'STANDING_LEADERBOARD_SHOWS_HANDLES_ONLY',
    reason:
      '§11 draws a Founder→Creator boundary and the Spec has no Creator→Creator twin, so this brief states one: a Creator sees of another Creator exactly what a Founder sees of them.',
    specRef: '§11, §30',
  },
];

export const CREATOR_APP_ABSENCE_IDS: readonly string[] = CREATOR_APP_ABSENCES.map((a) => a.id);
