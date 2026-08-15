/**
 * The Backers Admin payload contract — Spec §26.1, §25.7, §28.4.
 *
 * `frontend/src/features/admin/backers/api.ts` mirrors this name for name; the
 * two packages have separate build roots so neither imports the other, and the
 * vocabulary types both sides need come from `@proovd/shared`.
 *
 * ── Three ids, and confusing them is the mistake that leaks ─────────────────
 * `reservationId` is one pre-order. `backerIdentityId` is the pseudonymous
 * per-campaign person (§4.1's dedup key groups a Product Backer's several
 * transactions under one). `associationId` is one Creator's relationship to one
 * campaign, and is what earnings, the tracking link, and enforcement all key on.
 * A row here is a RESERVATION, because §26.5's ledger is per transaction and
 * the reference's "One row per Backer" is a promise about the page having no
 * detail view, not a claim that a person appears once.
 *
 * ── What is deliberately not in this file ───────────────────────────────────
 * No payment-processor identifier (`stripeCustomerId`, `setupIntentId`,
 * `paymentIntentId`, `chargeId`, the fingerprint), no card metadata, no billing
 * address, no phone, no auth data. §25.7 classes the first group as identifying
 * a card or a person at the provider, and this surface needs none of them —
 * money work is the close and refund consoles' and §26.5's ledger. A type that
 * cannot name a field is a field a later query cannot accidentally select.
 */

import type { BackerConsentState } from './logic.js';

/* ── Shared shapes ─────────────────────────────────────────────────────────*/

/** A value with the small label the reference pairs it with. */
export interface BackerStat {
  value: string;
  label: string;
}

export interface BackerFilterOption {
  value: string;
  label: string;
}

/* ── The Affiliate results view ────────────────────────────────────────────*/

export interface AffiliateResultRow {
  /** The relationship. Every number on this row is scoped to it. */
  associationId: string;
  campaignId: string;
  /** §11 keeps the Founder to public handles; Admin may see the legal name. */
  name: string;
  handle: string;
  campaignName: string;
  /** Counts and money, already formatted — the browser does no money math. */
  backers: number;
  backersLabel: string;
  preorderValue: string;
  /** Null where the link never activated: no active period to measure (§1.4). */
  timeActive: string | null;
  timeActiveWaitingOn: string | null;
  /** Value ÷ backers. Null over zero Backers, never `US$0.00` (§16a). */
  average: string | null;
  /** Where the drill-through lands, as real URL state. */
  drillThrough: { campaignId: string; associationId: string };
  /** Server-composed, so the table and any palette agree on what matches. */
  searchText: string;
}

export interface AffiliateResultsView {
  rows: AffiliateResultRow[];
  shown: string;
  /** Present when the campaign filter picked a campaign with no attribution. */
  noAttributionNote: string | null;
  /** Stated where a window was asked for and the campaign has no anchor. */
  anchorNote: string | null;
}

/* ── The Every Backer view ─────────────────────────────────────────────────*/

/**
 * One rendered question/answer pair.
 *
 * `answered` is separate from `answer` because §1.4 requires an absence to be
 * visible as an absence — the reference substituted a default and that is the
 * behaviour this field exists to make impossible.
 */
export interface BackerAnswer {
  question: string;
  answer: string;
  answered: boolean;
}

export interface BackerRow {
  reservationId: string;
  /** §18's per-campaign number where the Backer has one, else null. */
  backerNumber: number | null;
  /**
   * The identity line. There is NO Backer name in this product (§5.4, §28.1,
   * §19) — the email is the identity, and nothing here derives a name from it.
   */
  email: string;
  campaignId: string;
  campaignName: string;
  orderAmount: string;
  /** Null where the pre-order arrived without a Creator link (§18). */
  affiliateName: string | null;
  affiliateHandle: string | null;
  associationId: string | null;
  attributionStatus: string;
  /** §23.5's state, in words. A canceled pre-order is not silently a Backer. */
  statusLabel: string;
  date: string;
  answers: BackerAnswer[];
  /** §28.4's optional consent, and what it permits. Never defaulted. */
  consentState: BackerConsentState;
  consentLabel: string;
  consentPermits: string;
  searchText: string;
}

export interface BackerListView {
  rows: BackerRow[];
  shown: string;
  /** Cursor-free: the count is what the filter matched, page is 1-based. */
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

/* ── The page ──────────────────────────────────────────────────────────────*/

export interface BackerTotals {
  attributedBackers: BackerStat;
  attributedValue: BackerStat;
  affiliates: BackerStat;
  /** What the three above leave out, so the two views cannot look wrong. */
  excludesNote: string;
  organicBackers: number;
}

export interface BackersDirectoryView {
  totals: BackerTotals;
  campaigns: BackerFilterOption[];
  /** `organic` is first and is a sentinel, never an Affiliate (§18). */
  affiliates: BackerFilterOption[];
  affiliateResults: AffiliateResultsView;
  backers: BackerListView;
  /** Pinned posture lines, resolved server-side so both surfaces agree. */
  readOnly: string;
  noRecordPage: string;
  answersNotExportable: string;
  consentAbsentIsNotGranted: string;
}

/* ── The query ─────────────────────────────────────────────────────────────*/

export interface BackerQuery {
  campaignId?: string | undefined;
  /** An association id, `organic`, or absent for all. */
  affiliate?: string | undefined;
  window?: string | undefined;
  affiliateSearch?: string | undefined;
  backerSearch?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}
