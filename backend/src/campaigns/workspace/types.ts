/**
 * The Campaigns Admin workspace contract — Spec §26.1, §26.2, §27.1.
 *
 * Everything a Campaigns surface renders arrives already resolved. Nothing in
 * `features/admin/campaigns/` maps a status to a label, decides whether a
 * campaign is blocked, or works out which filter a row belongs to — §26.2 needs
 * a `prior_value` to compare against and a value the browser derived has none,
 * and two derivations of "is this blocked" are two answers waiting to disagree
 * between the list and the record.
 *
 * ── Read-only, by having no write shape ─────────────────────────────────────
 * There is no mutation result type in this file and no `MutationOutcome`. The
 * absence is the enforcement: a route that wanted to change a campaign would
 * have nothing to answer with, and `admin-campaigns.ts` mounts only GETs.
 *
 * ── Absent is a first-class value ───────────────────────────────────────────
 * `CampaignFact` carries `value: null` plus `waitingOn`, so a campaign whose
 * close batch has not run says what it is waiting for instead of rendering
 * US$0.00 or an empty cell. §16a's rule — not yet populated is not zero — is
 * the single most important thing on a page that summarises five domains that
 * mostly have not run yet.
 */

import type {
  CampaignBlockerOwner,
  CampaignGroup,
  CampaignHistorySource,
  CampaignHistoryTag,
  CampaignPublicState,
  CampaignStage,
  CampaignStageState,
  CampaignStateKind,
} from './logic.js';

/* ── Small shared shapes ────────────────────────────────────────────────────*/

/**
 * A pointer into a record that lives in its own workspace.
 *
 * Exactly one of `href` / `unavailableBecause` is set. The Support workspace
 * introduced this shape on 2026-08-13 for the same reason it is needed here —
 * §1.4's two honest options are to hide a control or to name what it is, and
 * hiding three of six destinations would make Campaigns describe a smaller
 * product than the one being built.
 */
export interface CampaignRecordLink {
  key: string;
  label: string;
  /** The line under the label — a live fact about this campaign, per the reference. */
  detail: string;
  mark: string;
  href: string | null;
  unavailableBecause: string | null;
}

/**
 * One fact, and what it is waiting for when there is none.
 *
 * `value` null with `waitingOn` set is "this phase has not run"; `value` set
 * is the answer. There is deliberately no third state — a fact with neither is
 * a blank cell nobody can act on.
 */
export interface CampaignFact {
  label: string;
  value: string | null;
  waitingOn: string | null;
}

/** An instant, rendered once on the server and carried with its raw ISO form. */
export interface CampaignInstant {
  at: string;
  label: string;
}

/* ── The blocker (§27.1's who owns it / what next) ──────────────────────────*/

/**
 * The one thing standing in this campaign's way, or nothing.
 *
 * `blocked: false` is a first-class answer with the reference's own sentence,
 * not an empty object — DNA §5.4's done-moment, and the reason a row reads
 * "Nothing is holding it up" rather than showing a blank that looks like
 * missing data.
 *
 * Every branch that sets `blocked: true` names a RECORD: a review outcome, an
 * enforcement action's own explanation, a count of associations in a §14.2
 * decision state, an open support case, a missing listing payment. Nothing here
 * invents a deadline or a condition (§1 rule 6).
 */
export interface CampaignBlocker {
  /** True when a NAMED party owes the next step. `system` is never blocked. */
  blocked: boolean;
  /**
   * True when the text is genuinely `NO_BLOCKER_LABEL`.
   *
   * A second boolean rather than a string comparison in the browser, because
   * `blocked` and `clear` are NOT opposites: §21's retry window is a real
   * blocker sentence that nobody at Proovd owes, so it is `blocked: false` and
   * `clear: false` at once. The band's "Current blocker" / "On track" pill
   * reads `clear`; the routing control reads `blocked`.
   */
  clear: boolean;
  /** The sentence. `NO_BLOCKER_LABEL` when there is genuinely nothing. */
  text: string;
  owner: CampaignBlockerOwner;
  ownerLabel: string;
  /** What happens next and when — never an invented deadline. */
  due: string;
  /** Null when the owner is `system`; otherwise where the work is done. */
  route: CampaignRecordLink | null;
}

/* ── The directory ──────────────────────────────────────────────────────────*/

export interface CampaignDirectoryRow {
  campaignId: string;
  /** A rendering of `campaignId`, not a stored reference. */
  displayId: string;
  initials: string;
  name: string;
  company: string | null;
  founderName: string | null;
  /** The Founder workspace address, when a prospect record backs this campaign. */
  founderHref: string | null;
  /** §3.1's label. Null while the type is unlocked (§33.1.7). */
  typeLabel: string | null;
  /** §23.1's label for the raw status. The pill's text. */
  stateLabel: string;
  rawStatus: string;
  stateKind: CampaignStateKind;
  /** Filter membership — derived, never stored. */
  groups: CampaignGroup[];
  blocker: CampaignBlocker;
  /** The reference's contextual date column: the launch, the close, or what ended it. */
  dateLabel: string;
  /** One lowercased haystack the search matches, composed server-side. */
  searchText: string;
}

export interface CampaignDirectoryView {
  /** §30: a refresh stamp, never a "real time" claim. The instant the read ran. */
  checkedAt: string;
  rows: CampaignDirectoryRow[];
  /** Derived: how many rows carry a blocker with a named owner. */
  blockedCount: number;
}

/* ── The record ─────────────────────────────────────────────────────────────*/

export interface CampaignRecordHeader {
  campaignId: string;
  displayId: string;
  name: string;
  company: string | null;
  founderName: string | null;
  founderHref: string | null;
  typeLabel: string | null;
  stateLabel: string;
  rawStatus: string;
  stateKind: CampaignStateKind;
  /** The five facts of the reference's strip. */
  waitingOnLabel: string;
  launch: string;
  close: string;
  publicState: CampaignPublicState;
  publicStateLabel: string;
  /**
   * The campaign's public address, or null.
   *
   * Null for every campaign that has never gone live (§18: no public page
   * exists, and `/api/campaign/:id` answers 404). The brief's §9 requires that
   * nothing unpublished becomes publicly reachable through this tab, and the
   * enforcement is that there is no address here for a control to open.
   */
  publicUrl: string | null;
  publicUrlUnavailableBecause: string | null;
}

export interface CampaignOverviewPane {
  blocker: CampaignBlocker;
  /** The reference's quick-facts panel: Type, Founder, Review, Affiliate work, Public page. */
  quickFacts: CampaignFact[];
  stages: {
    key: CampaignStage;
    label: string;
    state: CampaignStageState;
    caption: string;
  }[];
  dates: CampaignFact[];
  links: CampaignRecordLink[];
}

/**
 * The live totals.
 *
 * `live: false` carries the not-live state and the dates alone. `metrics` is
 * only present when the campaign has actually gone live — a metric hero showing
 * three zeros for a campaign that never launched is §16a's zero-that-means-two
 * -things, on the most quotable panel in the section.
 */
export interface CampaignLivePane {
  live: boolean;
  publicStateLabel: string;
  metrics: {
    active: number;
    canceled: number;
    /** The third metric, which is type-dependent per the reference. */
    third: {
      label: string;
      value: string;
      /**
       * Idea only, and only when the build actually set a threshold.
       *
       * The denominator is `threshold`, never `goal`: §3.2 bans `goal` for an
       * Idea threshold in every audience including identifiers, and §33.11.3
       * scans the whole shipped bundle for it. A property name survives
       * minification, so `progress.goal` would have shipped the banned word to
       * every browser — which is exactly the trap §33.11.3 exists to catch, and
       * did.
       */
      progress:
        | { percent: number; threshold: number; note: null }
        | { percent: null; threshold: null; note: string }
        | null;
    };
  } | null;
  dates: CampaignFact[];
  links: CampaignRecordLink[];
}

export interface CampaignClosePane {
  closed: boolean;
  heading: string;
  facts: CampaignFact[];
  links: CampaignRecordLink[];
}

export interface CampaignHistoryEntry {
  id: string;
  at: string;
  atLabel: string;
  headline: string;
  detail: string;
  tag: CampaignHistoryTag;
  /** The table this entry was READ FROM. §26.8: no second event store. */
  source: CampaignHistorySource;
}

export interface CampaignRecordView {
  checkedAt: string;
  header: CampaignRecordHeader;
  overview: CampaignOverviewPane;
  liveTab: CampaignLivePane;
  close: CampaignClosePane;
  history: CampaignHistoryEntry[];
}
