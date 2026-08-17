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
  DirectoryActionCell,
  FounderDirectoryFilterKey,
} from './logic.js';

/* ── List ───────────────────────────────────────────────────────────────────*/

/** One row of the Founders directory. Everything it shows, already resolved. */
export interface FounderListRow {
  /** `founder_prospects.id` — the person, stable across archive-and-restart. */
  prospectId: string;
  /** The stable quotable reference (`F-…`, migration 0047). */
  recordReference: string;
  legalName: string;
  preferredName: string;
  email: string;
  productName: string;
  businessName: string | null;
  /** `founder_prospects.internal_owner` — free text, the 2026-08-16 decision. */
  owner: string | null;

  /** `Idea` | `Product` | `Proposed` — Proposed is the absence of a §9 lock. */
  typeLabel: string;
  /** The composed lifecycle label (`Live · Day 6`, `Invite draft`, …). */
  lifecycle: string;

  /** The two action columns: who owes the next step, or why nobody does. */
  adminAction: DirectoryActionCell;
  founderAction: DirectoryActionCell;

  /** Which directory filter cards this row belongs to. Server-derived. */
  filters: FounderDirectoryFilterKey[];
  /** Server-composed search text — one source, so the palette and the filter
   *  can never disagree about what matches (the Creators-directory rule). */
  searchText: string;

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
  /** The stable quotable reference in the record's eyebrow (migration 0047). */
  recordReference: string;
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

  /** `Idea · locked` | `Product · locked` | `Proposed` — the header chip. */
  typeChip: string;
  /** The composed lifecycle label, same derivation as the directory row. */
  lifecycle: string;
  /** The two action cells, same kernel as the directory row. */
  adminAction: DirectoryActionCell;
  founderAction: DirectoryActionCell;

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

  /**
   * The invitation record as rows (Session B's Invite & Prefills tab).
   *
   * Structured facts beside the composed `technical` sentence, because the tab
   * renders them as a definition list. `expiration` is a sentence rather than
   * an instant: "Live until …", "Link inactive", or "No link issued yet" — the
   * state, not a timestamp the surface would have to interpret (§1.4). Never a
   * token value (§28.1).
   */
  facts: {
    sendCount: number;
    /** The live token's version, or the latest ever issued, or null. */
    tokenVersion: number | null;
    expiration: string;
    /** "Recorded <when>" once the claim happened, else null. */
    claimed: string | null;
    revoked: boolean;
  };
}

export interface VettingView {
  /** The checklist, in order, with what is done. */
  progress: { label: string; done: boolean }[];
  progressStatus: string;
  /** The LOCKED type (set at submission), or null while unlocked. */
  campaignType: string | null;
  campaignTypeAt: string | null;
  /** The path Admin has set on the draft, shown before the lock. */
  campaignTypeSelected: string | null;
  campaignTypeSelectedRaw: 'pre_build' | 'pre_launch' | null;
  /** True until the Founder submits; the control renders only while true. */
  campaignTypeEditable: boolean;
  /** The draft the campaign-path control writes against, when one exists. */
  draftId: string | null;
  answers: {
    key: 'problem' | 'solution' | 'views' | 'competition';
    label: string;
    text: string | null;
    /** "Originally prepared by Proovd · Last edited by Ahmed", or null. */
    provenance: string | null;
    /**
     * Whether §9's Admin prefill can still move this answer: Problem and
     * Solution only, before submission, and only while the Founder has not
     * taken the field over. Views and Competition are never editable.
     */
    editable: boolean;
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

/* ── Detail: Discovery & internal context (2026-08-16 rebuild) ─────────────*/

/**
 * §7's discovery record, rendered under the record's own field names.
 *
 * The reference's five prose boxes are its fixture's paraphrase of exactly
 * these fields; the recorded §7 vocabulary wins (the reconciliation's call).
 * Every editable row names the intake key `PUT …/prospect` accepts, so the
 * edit dialog and the intake form write through one path.
 */
export interface DiscoveryView {
  fields: {
    /** The prospect-update key this row edits, or null for a derived value. */
    key: string | null;
    label: string;
    value: string | null;
    helper: string | null;
  }[];
  /** §7's evidence list plus `Add research` entries — one record, one shape. */
  research: string[];
  meetingNotes: MeetingNoteView[];
}

/** One recorded meeting note (migration 0047). Insert-only; never edited. */
export interface MeetingNoteView {
  id: string;
  /** Already formatted for rendering. */
  meetingDate: string;
  participants: string;
  decisions: string;
  followUp: string;
  sourceLink: string;
  notes: string | null;
  recordedBy: string;
  recordedAt: string;
}

/**
 * The current campaign's live facts for the Overview panel and the hero line.
 *
 * Null before a campaign is scheduled to be live — §16a's rule: the panel then
 * names what it is waiting for rather than rendering zeros.
 */
export interface CampaignFactsView {
  campaignId: string;
  /** Day N since `campaign_live_at`, or null before launch. */
  campaignDay: number | null;
  liveAt: string | null;
  closesAt: string | null;
  /** When public discovery opened or opens (14b), or null. */
  discoveryOpenedAt: string | null;
  /** Count of currently-active reservations. Null before anything can exist. */
  activeBackers: number | null;
  /** The Idea threshold from the build, or null (Product has none). */
  threshold: number | null;
  activeAffiliates: number | null;
  /** The §18 public page, only while one exists (live or later). */
  publicUrl: string | null;
}

/* ── The whole detail ───────────────────────────────────────────────────────*/

/**
 * The Eligibility tab (Session B) — §10's claim and the §5 representations,
 * composed as read-only facts.
 *
 * Everything here is provider and system truth: the claim profile's own
 * suppliers, the recorded representations, and the `policy_consents` rows the
 * account claim wrote. There is deliberately no view of the DOB VALUE — the
 * tab reports that one was supplied and nothing more; the value itself lives
 * behind the profile edit with its §25.6 reason. The 18+/US answers are the
 * Founder's recorded REPRESENTATIONS (§10), rendered as such — the product
 * derives no age and never claims to have verified one.
 */
export interface EligibilityView {
  claim: {
    inviteClaimed: boolean;
    /** Already formatted, or null while unclaimed. */
    claimedAt: string | null;
    accountCreatedAt: string | null;
    /** 'Complete' | 'In progress' | 'Not started' — the claim profile's state. */
    completion: string;
    /** The stable `F-…` record reference the claim connected to. */
    connectedRecord: string;
  };
  facts: {
    /** null = no claim profile exists yet, which is not "No" (§16a). */
    dobSupplied: boolean | null;
    age18Plus: boolean | null;
    usPerson: boolean | null;
    /** "Chicago, IL · United States"-shaped, from the profile's own fields. */
    location: string | null;
    sanctionsClear: boolean | null;
  };
  /** The `policy_consents` rows the claim wrote. Empty while none exists. */
  acknowledgements: { label: string; version: string; acceptedAt: string }[];
  /**
   * Why the acknowledgements list is empty, when it is — "the claim has not
   * completed" and "the policies are still drafts" are different facts.
   */
  acknowledgementsAbsent: string | null;
}

export interface FounderWorkspaceDetail {
  header: FounderHeader;
  overview: OverviewPane;
  details: DetailsPane;
  campaigns: CampaignsPane;
  money: MoneyPane;
  discovery: DiscoveryView;
  eligibility: EligibilityView;
  campaignFacts: CampaignFactsView | null;
  history: FounderHistoryEntry[];
  /** Counts per chip, so a zero-count filter can be hidden without a scan. */
  historyCounts: Record<string, number>;
}
