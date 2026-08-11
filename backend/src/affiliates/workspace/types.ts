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
  sends: { at: string; by: string; to: string; status: string; confirmed: boolean }[];
  /** What §8's preview gate currently refuses, if anything. */
  unresolved: string[];
  canSend: boolean;
}

export interface CreatorProfilePane {
  summary: { handle: string | null; channelUrl: string | null; platform: string | null };
  /** Account details (Affiliate supplied) and Channel details (Admin authored). */
  blocks: ProfileBlock[];
  verification: VerificationBlock;
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
  history: CreatorHistoryEntry[];
  /** Counts per chip, so a zero-count filter can be hidden without a scan. */
  historyCounts: Record<string, number>;
}
