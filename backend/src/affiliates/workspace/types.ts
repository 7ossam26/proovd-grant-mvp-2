/**
 * The Creator (Affiliate) Admin workspace payload — Spec §26.1, §8, §11, §5.3.
 *
 * One person, four surfaces. This file is the contract: the backend composes
 * it, the Admin surface renders it, and nothing on the surface derives a fact
 * the server did not send. That rule is what keeps §26.2 true — a value the
 * browser computed is a value with no `prior_value` to override against.
 *
 * ── The workspace is keyed on the PROSPECT, and the id trap is real ─────────
 * `affiliate_prospects.id` is the person. It survives across campaigns: one
 * Creator recruited to two campaigns is ONE prospect with TWO
 * `campaign_affiliate_associations` rows, unique on (campaign_id, prospect_id).
 *
 * Three ids are easy to confuse and mean different things:
 *
 *   `prospectId`      the person. This workspace's subject.
 *   `associationId`   one campaign relationship. Earnings, transfers, the
 *                     tracking link, the invitation, enforcement, readiness,
 *                     post submissions, and proposals are ALL keyed on this.
 *   `claimedUserId`   the Better Auth account, once one exists. Notifications,
 *                     sessions, and the standing gate key on this.
 *
 * And one that looks like a fourth and is not:
 * `campaign_affiliate_associations.affiliate_id` holds the PROSPECT id, not an
 * account id. Anything keying a connected-account lookup off it would route
 * money at a UUID nobody owns — `close/earnings.ts` records the same trap.
 *
 * ── Absence is a value ──────────────────────────────────────────────────────
 * Every optional field below is `null` when the product genuinely does not know
 * yet, and the surface renders that as its own state rather than as a zero or a
 * blank (§1.4, and §16a's "not yet populated is not zero"). Where a block
 * cannot be filled because a phase has not run, the payload says what it is
 * waiting for instead of shipping an empty section.
 */

/*
 * The backend never imports `@proovd/shared` — it compiles under
 * `rootDir: src` and ships only `backend/dist`, so a cross-package import does
 * not resolve at runtime (the constraint `db/schema/domain.ts` has documented
 * since Phase 01). The vocabularies below are therefore restated in `labels.ts`
 * from `shared/src/admin/creator-workspace.ts` and drift-tested against it,
 * exactly as the state enums, the §6 settings, and the §27 notification keys
 * already are.
 */
import type {
  AttentionOwner,
  CreatorAccountState,
  CreatorAttentionKind,
  CreatorHistoryCategory,
  ProvenanceKey,
} from './labels.js';

/* ── Directory ──────────────────────────────────────────────────────────────*/

/**
 * The one thing that needs doing on this record, or nothing.
 *
 * `needed: false` is a first-class answer, not an empty object — DNA §5.4's
 * done-moment, and the reason a row renders "No action needed right now"
 * rather than a blank cell that reads as missing data.
 */
export type CreatorAttention =
  | { needed: false }
  | {
      needed: true;
      kind: CreatorAttentionKind;
      owner: AttentionOwner;
      label: string;
      detail: string;
      /** The relationship it concerns, when it is about one. */
      associationId: string | null;
    };

/** One row of the Affiliate directory. Everything it shows, already resolved. */
export interface CreatorDirectoryRow {
  /** `affiliate_prospects.id` — the person, stable across campaigns. */
  prospectId: string;
  /** Two upper-case letters from the name, for the monogram square. */
  initials: string;
  /** §8's `legal_name`, labelled "Name" on the surface (the reference's word). */
  name: string;
  /** §8's `public_handle`, labelled "Username". */
  handle: string | null;
  /** The §5.3 subtype's own label. */
  subtype: string | null;
  /** Where they publish, derived from `channel_reference`'s host. */
  platform: string | null;
  niche: string | null;

  verification: { state: string; label: string; at: string | null; missing: number };

  /** How many relationships, and how many of them hold a §2.2 slot. */
  campaigns: { total: number; activeSlots: number; slotLimit: number; leadLabel: string | null };

  /** §13's state, or null when nobody has claimed the account. */
  payout: { state: string | null; label: string };

  account: CreatorAccountState;

  attention: CreatorAttention;

  /**
   * The server's answer to each filter pill, so the browser filters over facts
   * rather than deriving a second opinion.
   */
  filters: { adminWork: boolean; verification: boolean; payout: boolean };

  /** Everything the search box matches, lower-cased and joined server-side. */
  searchText: string;

  recruitedAt: string | null;
}

/* ── The record header ──────────────────────────────────────────────────────*/

export interface CreatorHeader {
  prospectId: string;
  initials: string;
  name: string;
  handle: string | null;
  channelUrl: string | null;
  platform: string | null;
  subtype: string | null;
  niche: string | null;
  /** `country · state` from the signup profile, or null before the claim. */
  location: string | null;

  /** The four facts on the identity band. */
  verification: { state: string; label: string; at: string | null; missing: string[] };
  slots: { used: number; limit: number; remaining: number; atLimit: boolean };
  payout: { state: string | null; label: string };
  account: CreatorAccountState;

  attention: CreatorAttention;

  /**
   * Open §26.7 cases anchored on this person — the Support tab's badge
   * (Session C). Counted from the same rows the standing pane lists, so the
   * badge and the list can never disagree.
   */
  openCases: number;

  /** Which menu actions this record's state actually permits. */
  availableActions: CreatorMenuAction[];
}

export type CreatorMenuAction =
  | 'assign'
  | 'suspend'
  | 'restore'
  | 'deletion'
  | 'verify';

/* ── The relationships list ─────────────────────────────────────────────────*/

export interface CreatorRelationshipSummary {
  associationId: string;
  campaignId: string;
  campaignName: string;
  founderName: string | null;
  /** §3.1's label — `Idea Campaign` / `Product Campaign`, never the raw enum. */
  campaignType: string | null;
  campaignTypeRaw: 'pre_build' | 'pre_launch' | null;
  /** §23.4's state, in Admin's one-to-one vocabulary. */
  status: string;
  statusRaw: string;
  /** `Initial launch roster` | `Mid-campaign addition`. */
  designation: string;
  owner: AttentionOwner;
  activatedAt: string | null;
  closesAt: string | null;
  /** True when this relationship is holding one of §2.2's three slots. */
  holdsSlot: boolean;

  /*
   * The three facts the Selected-relationship strip renders (2026-08-17
   * rebuild). Composed labels, decided server-side like every other cell —
   * `Accepted` / `Proposal pending` / `Not started`; the link's four states;
   * the completion answer with `Not due before close` kept distinct from
   * `Decision pending` (§16a: not yet populated is not zero).
   */
  agreement: string;
  trackingLink: string;
  completion: string;
}

/* ── Profile & evidence ─────────────────────────────────────────────────────*/

/**
 * One rendered field, with who supplied it.
 *
 * `provenance` is not decoration — it decides what may be edited. A `provider`
 * field has no edit control anywhere (§13: Proovd stores the status, not the
 * document), and an `affiliate` field is corrected through a route that records
 * a reason rather than overwritten.
 */
export interface ProfileField {
  key: string;
  label: string;
  value: string | null;
  helper: string | null;
  /** What the surface renders when `value` is null. Two words for absence. */
  emptyLabel: string;
  wide?: boolean;
}

export interface ProfileBlock {
  provenance: ProvenanceKey;
  title: string;
  fields: ProfileField[];
}

/** One recorded §5.3 evidence input, present or named as missing. */
export interface EvidenceItem {
  id: string;
  label: string;
  /** §5.3's own word for what this input is evidence OF. */
  basis: string;
  value: string | null;
  required: boolean;
}

export interface VerificationBlock {
  state: string;
  label: string;
  at: string | null;
  by: string | null;
  /** What "engagement" means for THIS subtype (§5.3's seven answers). */
  metricLabel: string;
  metrics: ProfileField[];
  evidence: EvidenceItem[];
  missing: string[];
}

/**
 * §13's connected account, read from the stored record.
 *
 * Never from a live provider call: §13 makes Stripe the owner of this fact and
 * Proovd the holder of its status, and a block that implied it had just asked
 * would claim a capability the read does not have (§1.4).
 */
export interface ProviderBlock {
  populated: boolean;
  waitingOn: string | null;
  accountId: string | null;
  state: string | null;
  label: string;
  transferCapability: string;
  requirements: string[];
  requirementsLabel: string;
  lastUpdated: string | null;
}

/** One invitation, per relationship — §11 ties an Affiliate to one campaign. */
export interface CreatorInvitationView {
  associationId: string;
  campaignName: string;
  state: string;
  stateLabel: string;
  lastSentAt: string | null;
  /** Token facts only — never a value (§28.1). */
  hasLiveToken: boolean;
  claimedAt: string | null;
  /*
   * The lifecycle-modal facts (Session B). All stored instants or their
   * honest absence — the `Opened` step has no field here on purpose, because
   * there is no record it could render (the register carries the reason).
   */
  createdAt: string | null;
  signupStartedAt: string | null;
  tokenExpiresAt: string | null;
  sends: { at: string; by: string; to: string; status: string; confirmed: boolean }[];
  /** What §8's preview gate currently refuses, if anything. */
  unresolved: string[];
  canSend: boolean;
}

/* ── Evidence files and the per-metric trail (Session B) ────────────────────*/

/** One evidence picture on the §5.3 research record (0048). */
export interface EvidenceFileView {
  id: string;
  category: string;
  categoryLabel: string;
  filename: string | null;
  /** `pending` | `stored` | `rejected` — the Phase 09a lifecycle. */
  state: string;
  rejection: string | null;
  /** `1200 × 800` once the bytes were read; null before (§1.4). */
  dimensions: string | null;
  uploadedBy: string;
  uploadedAt: string | null;
}

/** The latest decision per §5.3 metric, or its honest absence. */
export interface MetricDecisionView {
  metric: string;
  label: string;
  decision: string | null;
  detail: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

/** §29-derived proposal access — never a stored flag (0048's header). */
export interface ProposalAccessView {
  key: 'standard' | 'restricted';
  label: string;
  /** The enforcement record the answer derives from, when restricted. */
  derivedFrom: string | null;
}

/** The Account-agreements block (§10, §29.8, §31.5). */
export interface CreatorAgreementsView {
  /** Latest accepted version per account-level document, or null pre-claim. */
  terms: string | null;
  aup: string | null;
  /** `accepted` | `reacceptance_required` | `not_claimed`. */
  policyState: string;
  /** The published versions the §29.8 requirement dialog may cite. */
  publishedVersions: { slug: string; version: string; title: string }[];
  /** Per-campaign IP/commercial acceptance, one row per relationship. */
  perCampaign: { associationId: string; campaignName: string; state: string }[];
}

export interface CreatorProfilePane {
  summary: { handle: string | null; channelUrl: string | null; platform: string | null };
  /** Account details (Affiliate supplied) and Channel details (Admin authored). */
  blocks: ProfileBlock[];
  verification: VerificationBlock;
  /*
   * The Session B additions: the evidence pictures with the honest
   * unavailable state while R2 is Track A4, the per-metric decision trail,
   * §29-derived proposal access, and the agreements block.
   */
  evidenceFiles: {
    /** Whether an upload can be offered at all (storage configured). */
    available: boolean;
    waitingOn: string | null;
    files: EvidenceFileView[];
  };
  metricDecisions: MetricDecisionView[];
  proposalAccess: ProposalAccessView;
  agreements: CreatorAgreementsView;
  provider: ProviderBlock;
  invitations: CreatorInvitationView[];
  /** Recovery, notifications, retention — §5.5, §27.2, §27.7, §25.8. */
  support: ProfileField[];
  deletionRequest: {
    id: string;
    detail: string;
    requestedAt: string;
    receivedVia: string;
    reviews: { note: string; actor: string; at: string }[];
  } | null;
}

/* ── Policy, cases, and access (§26.7, §29) ─────────────────────────────────*/

/**
 * What is open against this person, and what standing they hold.
 *
 * Two scopes deliberately side by side, because collapsing them is the mistake
 * this pane exists to prevent: an ACCOUNT suspension is a reversible review of
 * the person, and a §29 enforcement action is against ONE campaign relationship
 * and carries five customer-facing statement fields and an appeal window. The
 * pane shows both and never merges them.
 */
export interface CreatorStandingPane {
  account: {
    state: CreatorAccountState;
    /** The latest recorded decision, when there is one. */
    latest: {
      action: string;
      reason: string;
      evidence: string | null;
      reviewOwner: string | null;
      nextReviewAt: string | null;
      actor: string;
      at: string;
    } | null;
    history: { action: string; reason: string; actor: string; at: string }[];
  };
  /** §29's records, per campaign relationship. */
  enforcement: {
    id: string;
    associationId: string;
    campaignName: string;
    actionKind: string;
    reasonCategory: string;
    /** The five §29 customer-facing statement fields, as recorded. */
    statement: {
      evidenceAndBehavior: string;
      ruleViolated: string;
      immediateEffect: string;
      correctionPath: string;
      humanRoute: string;
    };
    appealDueAt: string | null;
    appeal: {
      id: string;
      grounds: string;
      decision: string | null;
      decidedAt: string | null;
    } | null;
    at: string;
  }[];
  /** §29.1 and §29.2, recorded rather than decided. */
  disclosures: {
    kind: 'conflict' | 'self_preorder';
    associationId: string;
    campaignName: string;
    detail: string;
    at: string;
  }[];
  /** §29.8: an outstanding requirement blocks every `/api/creator` call. */
  policyReacceptanceOpen: boolean;
  /**
   * The person's §26.7 cases (Session C) — anchored on their account or one of
   * their associations, because `support_cases` has no prospect column and
   * needs none. Operating a case stays the Support workspace's; each row
   * carries the address that owns it.
   */
  cases: CreatorCaseView[];
}

export interface CreatorCaseView {
  id: string;
  /** The quotable `PVD-…` reference (§33.9.10). */
  reference: string;
  topic: string;
  subject: string | null;
  status: string;
  /** Open work — `status <> 'resolved'`, the queue's own membership rule. */
  open: boolean;
  openedAt: string | null;
  /** The Support workspace address that operates this case. */
  href: string;
}

export interface CreatorCommunicationView {
  /** The §27 key — the label resolves in the browser from the shared registry
      (Phase 22c's rule: the backend returns the key, never a fourth copy). */
  eventKey: string;
  target: string;
  entityType: string;
  entityId: string;
  /** Confirmed at the provider, or recorded-not-confirmed (§1.4's state). */
  confirmed: boolean;
  at: string | null;
  occurredAt: string;
}

/* ── History ────────────────────────────────────────────────────────────────*/

export interface CreatorHistoryEntry {
  category: CreatorHistoryCategory;
  at: string;
  /** Sortable instant, so the client never re-parses a rendered date. */
  occurredAt: string;
  title: string;
  detail: string;
  actor: string;
  /** The table this came from, so the claim is checkable from the response. */
  source: string;
  /** `<table>:<row id>` — the reference's "immutable event" reference. */
  reference: string;
}

/* ── The whole detail ───────────────────────────────────────────────────────*/

export interface CreatorWorkspaceDetail {
  header: CreatorHeader;
  relationships: CreatorRelationshipSummary[];
  profile: CreatorProfilePane;
  standing: CreatorStandingPane;
  history: CreatorHistoryEntry[];
  /** Counts per chip, so a zero-count filter can be hidden without a scan. */
  historyCounts: Record<string, number>;
  /**
   * The person's `notification_deliveries` rows (Session C) — the real record
   * of recipient, event key, delivery state, and dedup entity. Audience-
   * prefixed to `affiliate_*`, newest first, bounded.
   */
  communications: CreatorCommunicationView[];
}
