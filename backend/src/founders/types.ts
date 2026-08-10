/**
 * The Founder Admin workspace payload — Spec §26.1, §26.2, §27.1.
 *
 * One person, five panes. This file is the contract: the backend composes it,
 * the Admin surface renders it, and nothing on the surface derives a fact the
 * server did not send. That rule is what keeps §26.2 true — a value the browser
 * computed is a value with no `prior_value` to override against.
 *
 * ── The workspace is person-scoped, and that is a correction ────────────────
 * The previous Admin Founders surface keyed on `draftId`, so a Founder whose
 * campaign was archived-and-restarted (§9's wrong-type path) appeared twice
 * with no relationship between the rows, and "their previous campaigns" was not
 * a question the product could answer. `founder_prospects` is the record that
 * survives a restart — a restart makes a new campaign, draft, and vetting
 * record for the SAME prospect — so the prospect is the person and the
 * workspace is keyed on it.
 *
 * ── Absence is a value ──────────────────────────────────────────────────────
 * Every optional field below is `null` when the product genuinely does not know
 * yet, and the surface renders that as its own state rather than as a zero or a
 * blank (§1.4, and §16a's "not yet populated is not zero"). Where a pane cannot
 * be filled because a phase has not run, the payload says what it is waiting
 * for instead of shipping an empty section.
 */

/*
 * The backend never imports `@proovd/shared` — it compiles under
 * `rootDir: src` and ships only `backend/dist`, so a cross-package import does
 * not resolve at runtime (the constraint `db/schema/domain.ts` has documented
 * since Phase 01). The vocabularies below are therefore restated from
 * `shared/src/admin/founder-workspace.ts` and drift-tested against it in
 * `tests/founder-workspace.test.ts`, exactly as the state enums, the §6
 * settings, and the §27 notification keys already are.
 */
import type {
  CampaignStatus,
  FounderAccountState,
  FounderSetupStage,
  InvitationState,
  ProfileOverrideKey,
  FounderHistoryCategory,
  AttentionAction,
} from './logic.js';

/* ── List ───────────────────────────────────────────────────────────────────*/

/** One row of the Founders table. Everything it shows, already resolved. */
export interface FounderListRow {
  /** `founder_prospects.id` — the person, stable across archive-and-restart. */
  prospectId: string;
  legalName: string;
  preferredName: string;
  email: string;
  productName: string;

  setup: { stage: FounderSetupStage; detail: string | null };
  account: FounderAccountState;
  paymentSetup: string;

  /** The campaign the Admin would open. Null when none is running. */
  currentCampaign: { campaignId: string; name: string; status: string } | null;

  attention: FounderAttention;
}

/**
 * The one thing that needs doing, or nothing.
 *
 * `needed: false` is a first-class answer, not an empty object — DNA §5.4's
 * done-moment, and the reason the row renders "No action needed" rather than a
 * blank cell that reads as missing data.
 */
export type FounderAttention =
  | { needed: false }
  | {
      needed: true;
      text: string;
      action: { label: string; act: AttentionAction } | null;
    };

/* ── Detail: header ─────────────────────────────────────────────────────────*/

export interface FounderHeader {
  prospectId: string;
  legalName: string;
  preferredName: string;
  businessName: string | null;
  website: string | null;
  email: string;
  phone: string | null;
  /** §33.1.8: pinned false at the database. Rendered as a stated fact. */
  phoneVerified: false;
  state: string | null;
  country: string | null;
  /** Deterministic 1–14 sticker index, derived from the id so it never moves. */
  sticker: number;

  account: FounderAccountState;
  setup: { stage: FounderSetupStage; detail: string | null };
  paymentSetup: string;
  currentCampaign: { campaignId: string; name: string; status: string } | null;

  attention: FounderAttention;

  /** Which menu actions this record's state actually permits. */
  availableActions: FounderMenuAction[];
}

export type FounderMenuAction =
  | 'edit'
  | 'sendinvite'
  | 'newinvite'
  | 'cancelinvite'
  | 'suspend'
  | 'restore'
  | 'ban'
  | 'deletion';

/* ── Detail: Overview ───────────────────────────────────────────────────────*/

/** A profile value an invitation may override, resolved for rendering. */
export interface OverrideField {
  key: ProfileOverrideKey;
  label: string;
  /** What this invitation will actually use. */
  value: string;
  /** What the Founder profile says, whether or not it is overridden. */
  profileValue: string;
  overridden: boolean;
  helper: string;
}

export interface InvitationView {
  state: InvitationState;
  /** "Sent Aug 8, 2026 · 3:15 PM" — already formatted, or null. */
  stateAt: string | null;
  meaning: string;
  invitedBy: string | null;
  source: string | null;
  owner: string | null;

  overrides: OverrideField[];

  /** Admin-editable invitation content, by `FOUNDER_EDITABLE_FIELDS` key. */
  content: { key: string; label: string; value: string | null; helper: string | null }[];
  /** §7's two fixed promises and the support address. Never editable. */
  fixedContent: { key: string; label: string; value: string }[];

  /** What §7's preview gate currently refuses, if anything. */
  unresolvedMarkers: string[];
  missingBeforeSend: string[];
  canSend: boolean;

  history: { at: string; title: string; body: string }[];
  /** Token facts only — never a value (§28.1). */
  technical: string;
}

export interface VettingView {
  /** The checklist, in order, with what is done. */
  progress: { label: string; done: boolean }[];
  progressStatus: string;
  campaignType: string | null;
  campaignTypeAt: string | null;
  answers: {
    key: 'problem' | 'solution' | 'competition';
    label: string;
    text: string | null;
    /** "Originally prepared by Proovd · Last edited by Ahmed", or null. */
    provenance: string | null;
  }[];
  lastSaved: string | null;
  /** §10's recorded Admin assessment. `null` = never recorded, which is not 0. */
  creatorMatches: { count: number; recordedAt: string | null } | null;
}

export interface OverviewPane {
  invitation: InvitationView;
  vetting: VettingView;
  accountCreatedAt: string | null;
  signInMethod: string | null;
}

/* ── Detail: Details ────────────────────────────────────────────────────────*/

/** One rendered field: its value, and whether Admin may change it here. */
export interface DetailField {
  key: string;
  label: string;
  value: string | null;
  helper: string | null;
  editable: boolean;
}

export interface StandingView {
  value: string;
  detail: string | null;
  owner: string | null;
  startedAt: string | null;
  nextReviewAt: string | null;
}

export interface DetailsPane {
  personal: DetailField[];
  business: DetailField[];
  preferences: DetailField[];
  standing: StandingView;
  /** §22.7's record, when one exists. Permanent — there is no lift. */
  ban: { trigger: string; decidedAt: string; notice: string } | null;
  deletionRequest: {
    id: string;
    detail: string;
    requestedAt: string;
    receivedVia: string;
    reviews: { note: string; actor: string; at: string }[];
  } | null;
}

/* ── Detail: Campaigns ──────────────────────────────────────────────────────*/

export interface CampaignSummary {
  campaignId: string;
  name: string;
  /** §3.1 label. The raw value rides alongside for Technical details. */
  type: string;
  status: string;
  rawStatus: CampaignStatus;
  buildStatus: string | null;
  rosterReadiness: string | null;
  review: { outcome: string; why: string | null } | null;
  listing: string | null;
  opensAt: string | null;
  closesAt: string | null;
  issue: string | null;
}

export interface PreviousCampaign {
  campaignId: string;
  name: string;
  type: string;
  status: string;
  /** Already-formatted result lines. Empty when the phase has not run. */
  lines: string[];
}

export interface CampaignsPane {
  current: CampaignSummary | null;
  previous: PreviousCampaign[];
  /** §22.10. Null when there is no closed campaign to measure from. */
  next: {
    earliest: string | null;
    wait: string | null;
    readiness: string;
    readinessNote: string | null;
    canApprove: boolean;
    canRemoveApproval: boolean;
  } | null;
}

/* ── Detail: Money ──────────────────────────────────────────────────────────*/

/**
 * A money section that may have no data yet.
 *
 * `populated: false` carries what it is waiting for, so the surface can say so
 * rather than rendering US$0.00 — §16a's rule, which matters most here.
 */
export interface MoneySection<T> {
  populated: boolean;
  waitingOn: string | null;
  value: T | null;
}

export interface MoneyPane {
  setup: { value: string; body: string; action: string | null };
  identity: { value: string; helper: string };
  stripe: {
    accountId: string;
    requirements: string;
    lastUpdated: string | null;
    capability: string;
  } | null;
  listings: {
    campaignId: string;
    campaignName: string;
    lines: { label: string; amount: string; sub: boolean }[];
    status: string;
  }[];
  w9: { value: string; line: string; action: string | null };
  payments: MoneySection<
    { campaignName: string; label: string; amount: string; status: string; line: string }[]
  >;
  blockers: {
    amount: string | null;
    state: string;
    reason: string;
    owner: string;
    action: string;
    nextReview: string | null;
  }[];
  pricing: { value: string; reasons: string[] | null; note: string | null } | null;
}

/* ── Detail: History ────────────────────────────────────────────────────────*/

export interface FounderHistoryEntry {
  category: FounderHistoryCategory;
  at: string;
  /** Sortable instant, so the client never re-parses a rendered date. */
  occurredAt: string;
  title: string;
  body: string;
  reason: string | null;
  /** The §25.6 record behind a sensitive event, when there is one. */
  audit: {
    by: string;
    field: string;
    priorValue: string;
    newValue: string;
    reason: string;
    evidence: string;
    at: string;
  } | null;
  /** The table this came from, so the claim is checkable from the response. */
  source: string;
}

/* ── The whole detail ───────────────────────────────────────────────────────*/

export interface FounderWorkspaceDetail {
  header: FounderHeader;
  overview: OverviewPane;
  details: DetailsPane;
  campaigns: CampaignsPane;
  money: MoneyPane;
  history: FounderHistoryEntry[];
  /** Counts per chip, so a zero-count filter can be hidden without a scan. */
  historyCounts: Record<string, number>;
}
