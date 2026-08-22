/**
 * The Admin Founders client — Spec §7, §9, §10, §25.6, §26.1, §26.2.
 *
 * One typed call per backend route, and nothing else. The server composes every
 * fact this panel renders (`FounderWorkspaceDetail`), so nothing here derives a
 * value, formats an amount, or decides a state — a value the browser computed
 * is a value with no `prior_value` to override against (§26.2).
 *
 * The fetch helper is `../api.ts`'s, deliberately: §27.1's answers arrive in
 * `whatHappened` / `next` / `action`, and a second `call` would be a second
 * place for "the server's refusal is rendered verbatim" to drift.
 */

import { call } from '../api.js';

export { AdminRequestError } from '../api.js';
export type { AdminError } from '../api.js';

/* ── Directory (§26.1) ────────────────────────────────────────────────────── */

export interface DirectoryActionCell {
  kind: string;
  label: string;
}

export interface FounderListRow {
  prospectId: string;
  recordReference: string;
  legalName: string;
  preferredName: string;
  email: string;
  productName: string;
  businessName: string | null;
  owner: string | null;
  typeLabel: string;
  lifecycle: string;
  adminAction: DirectoryActionCell;
  founderAction: DirectoryActionCell;
  filters: string[];
  /** Server-composed, so the search box and the server can never disagree. */
  searchText: string;
  setup: { stage: string; detail: string | null };
  account: string;
  paymentSetup: string;
  currentCampaign: { campaignId: string; name: string; status: string } | null;
  attention: { needed: false } | { needed: true; text: string; action: unknown };
  draftId: string;
  campaignId: string;
  status: string;
  invitationSource: string | null;
  internalOwner: string | null;
  lastSentAt: string | null;
  claimedAt: string | null;
  createdAt: string;
  retentionDueAt: string | null;

  /* ── Migration 0059's directory columns ─────────────────────────────────
     The columns exist (`campaigns.workflow_stage_reached`,
     `founder_prospects.last_active_at`) but `GET /api/admin/founders` does
     not compose them yet, so every one of these is OPTIONAL and the surface
     renders a stated absence when it is missing. Typing them as required
     would make the browser read `undefined` as a value; defaulting them to
     0 or `invite` would be the panel inventing a position (§1.4, §16a —
     "not yet populated" is not zero). */

  /** How many campaign records this person has. */
  campaignCount?: number;
  /** The eleven-stage workflow position — `FounderWorkflowStageId`. */
  workflowStage?: string | null;
  /** The stage's own sub-status, from the reference's per-stage vocabulary. */
  workflowStatus?: string | null;
  /** Written by `founderStandingGate` on every Founder request. */
  lastActiveAt?: string | null;
}

export const listFounders = (): Promise<{ founders: FounderListRow[] }> =>
  call('/api/admin/founders');

/* ── Create (§7) ──────────────────────────────────────────────────────────── */

export interface CreateFounderInput {
  legalName: string;
  email: string;
  preferredName?: string;
  phone?: string;
  productName?: string;
  productUrl?: string;
  invitationSource?: string;
  internalOwner?: string;
  adminNotes?: string;
  problem?: string;
  solution?: string;
}

export interface CreatedFounder {
  prospectId: string;
  campaignId: string;
  draftId: string;
}

export const createFounder = (input: CreateFounderInput): Promise<CreatedFounder> =>
  call('/api/admin/founders', { method: 'POST', body: JSON.stringify(input) });

/* ── Workspace detail (§26.1, §26.2) ──────────────────────────────────────── */

export interface OverrideField {
  key: string;
  label: string;
  value: string;
  profileValue: string;
  overridden: boolean;
  helper: string;
}

export interface ContentField {
  key: string;
  label: string;
  value: string | null;
  helper: string | null;
}

/**
 * One immutable activity entry — `backend/src/founders/types.ts`'s own shape.
 *
 * There is no id and no `detail`: the composer fans out across the tables that
 * already record each event and names the one it came from in `source`, so the
 * claim is checkable from the response (§26.8's rule — a second event store
 * that drifts from the first is worse than no timeline).
 */
export interface FounderHistoryEntry {
  category: string;
  /** Already rendered for reading. */
  at: string;
  /** The sortable instant, so the browser never re-parses a rendered date. */
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
  /** The table this entry came from. */
  source: string;
}

/**
 * The read-and-route sections' state — the SUBSET the chrome reads.
 *
 * The server's `OperationsView` is much larger; declaring only what is rendered
 * keeps this file from claiming a shape no surface here consumes. A stage
 * screen that needs another section extends this interface rather than casting
 * its own copy — two declarations of one payload is how they start disagreeing.
 */
export interface FounderOperationsView {
  campaignId: string;
  campaignName: string;
  typeLabel: string;
  statusLabel: string;

  /** ⌘K's `Creator` type. Scoped to the current campaign. */
  roster: {
    associationId: string;
    prospectId: string;
    name: string;
    handle: string | null;
    statusLabel: string;
    terms: string;
    backers: number;
    validClicks: number;
  }[];

  /** ⌘K's `Backer` type. */
  backerRows: {
    total: number;
    rows: {
      backer: string;
      reward: string;
      createdAt: string;
      status: string;
      attribution: string;
      caseRef: string | null;
      caseId: string | null;
    }[];
  };

  /** ⌘K's `Request` type — §22.9's work-again asks. */
  workAgain: {
    creatorName: string;
    requestedAt: string;
    status: string;
    message: string | null;
    respondedAt: string | null;
    responseNote: string | null;
  }[];

  /** §31.6's cancellation state, which is also a request. */
  cancellation: {
    state: string;
    kind: string | null;
    requestedAt: string | null;
    decidedAt: string | null;
    customerExplanation: string | null;
  } | null;

  /**
   * The Support tool's list and its `(n)` count.
   *
   * There is no `detail` column and no total: the reference's dialog shows a
   * body per case, and the server composes a reference, subject, status, owner
   * and due time. The dialog renders those five and says so.
   */
  supportCases: {
    caseId: string;
    reference: string;
    subject: string | null;
    status: string;
    owner: string;
    due: string | null;
  }[];
}

export interface FounderWorkspaceDetail {
  header: {
    prospectId: string;
    recordReference: string;
    legalName: string;
    preferredName: string;
    businessName: string | null;
    website: string | null;
    email: string;
    phone: string | null;
    phoneVerified: false;
    state: string | null;
    country: string | null;
    sticker: number;
    typeChip: string;
    lifecycle: string;
    adminAction: DirectoryActionCell;
    founderAction: DirectoryActionCell;
    account: string;
    setup: { stage: string; detail: string | null };
    paymentSetup: string;
    currentCampaign: { campaignId: string; name: string; status: string } | null;
    attention: { needed: false } | { needed: true; text: string; action: unknown };
    availableActions: string[];
    /** Migration 0059's `last_active_at`. Not composed yet — see above. */
    lastActiveAt?: string | null;
  };
  overview: {
    invitation: {
      state: string;
      stateAt: string | null;
      meaning: string;
      invitedBy: string | null;
      source: string | null;
      owner: string | null;
      overrides: OverrideField[];
      content: ContentField[];
      sends?: { at: string; by: string; to: string; confirmed: boolean }[];
      linkLive?: boolean;
      tokenVersion?: number | null;
      retentionDueAt?: string | null;
    };
    vetting: {
      progress: { label: string; done: boolean }[];
      progressStatus: string;
      campaignType: string | null;
      campaignTypeSelected: string | null;
      campaignTypeSelectedRaw: string | null;
      campaignTypeEditable: boolean;
      draftId: string;
      answers: {
        key: string;
        label: string;
        text: string | null;
        provenance: string | null;
        editable: boolean;
      }[];
      creatorSignal?: { count: number; basis: string; recordedAt: string } | null;
    };
    accountCreatedAt: string | null;
    signInMethod: string | null;
  };
  details: unknown;
  campaigns: {
    /**
     * `rawStatus` is the lifecycle value itself (§23.1 — lifecycle only, never
     * a payment flag). The stage register keys on it; `status` beside it is the
     * composed human label and is what gets rendered.
     */
    current: {
      campaignId: string;
      name: string;
      type: string;
      status: string;
      rawStatus: string;
      buildStatus: string | null;
      rosterReadiness: string | null;
      listing: string | null;
      opensAt: string | null;
      closesAt: string | null;
      issue: string | null;
      /**
       * `campaigns.workflow_stage_reached` — the HIGH-WATER MARK, which is a
       * different question from `rawStatus`. Status moves backward
       * (`changes_required` after `pending_review`), so a menu whose
       * reachability came from status would re-lock a screen somebody has
       * already used. Optional until the route composes it; the workspace
       * then falls back to the current stage, which under-unlocks rather
       * than over-unlocks.
       */
      workflowStageReached?: string | null;
      /** `campaign_build_drafts.draft_version` — the glance's `· v4`. */
      buildVersion?: number | null;
    } | null;
    previous: { campaignId: string; name: string; type: string; status: string; lines: string[] }[];
    next: unknown;
  };
  money: unknown;
  discovery: unknown;
  eligibility: unknown;
  campaignFacts: unknown;
  /** Null with no campaign — five of the ⌘K corpus's seven types then empty. */
  operations: FounderOperationsView | null;
  communications: { total: number; rows: { eventKey: string; target: string; at: string; state: string }[] };
  history: FounderHistoryEntry[];
  historyCounts: Record<string, number>;
}

export const fetchFounder = (prospectId: string): Promise<FounderWorkspaceDetail> =>
  call(`/api/admin/founders/${encodeURIComponent(prospectId)}`);

/* ── Editing one field (§25.6) ────────────────────────────────────────────── */

/**
 * The reason is required once the Founder owns the account, and the SERVER
 * decides that — `editReasonRequired` reads the record. This sends whatever the
 * form collected and renders the refusal if the server wants more.
 */
export const updateFounderField = (
  prospectId: string,
  key: string,
  value: string,
  reason?: string,
): Promise<unknown> =>
  call(`/api/admin/founders/${encodeURIComponent(prospectId)}/fields/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value, ...(reason ? { reason } : {}) }),
  });

/* ── §9's two prefills. Competition is never among them (§33.1.5). ────────── */

export const prefillVetting = (
  draftId: string,
  patch: { problem?: string; solution?: string },
): Promise<unknown> =>
  call(`/api/admin/founders/${encodeURIComponent(draftId)}/vetting-prefill`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });

export const setCampaignPath = (
  draftId: string,
  campaignPath: 'pre_build' | 'pre_launch' | null,
): Promise<unknown> =>
  call(`/api/admin/founders/${encodeURIComponent(draftId)}/campaign-path`, {
    method: 'PUT',
    body: JSON.stringify({ campaignPath }),
  });

/* ── §7 compose, preview, send ────────────────────────────────────────────── */

export interface ComposePatch {
  whatWeUnderstood?: string | null;
  whyInvited?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  expectedSetupTime?: string | null;
}

export const composeInvitation = (draftId: string, patch: ComposePatch): Promise<unknown> =>
  call(`/api/admin/founders/${encodeURIComponent(draftId)}/invitation`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });

export const updateProspect = (
  draftId: string,
  patch: Record<string, string | null>,
): Promise<unknown> =>
  call(`/api/admin/founders/${encodeURIComponent(draftId)}/prospect`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });

export interface InvitationPreview {
  subject: string;
  html: string;
  text: string;
  recipientEmail: string | null;
  /** Bracketed markers still in the rendered output. */
  unresolved: string[];
  /** §7 list items that never appear in the message, so the gate cannot see them. */
  missingFields: string[];
  /** True while §7's gate holds Send closed. */
  blocked: boolean;
}

export const previewInvitation = (draftId: string): Promise<InvitationPreview> =>
  call(`/api/admin/founders/${encodeURIComponent(draftId)}/preview`);

export interface SendResult {
  sendId: string;
  tokenVersion: number;
  resent: boolean;
}

/** Takes `requireFreshSession` on the server. A stale session is refused there. */
export const sendInvitation = (draftId: string): Promise<SendResult> =>
  call(`/api/admin/founders/${encodeURIComponent(draftId)}/send`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const revokeInvitation = (draftId: string, reason: string): Promise<unknown> =>
  call(`/api/admin/founders/${encodeURIComponent(draftId)}/revoke`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

/* ── §10's possible-creator result ────────────────────────────────────────── */

/** Freshness-gated: the number a Founder sees before they create an account. */
export const recordCreatorSignal = (
  campaignId: string,
  count: number,
  basis: string,
): Promise<unknown> =>
  call(`/api/admin/campaigns/${encodeURIComponent(campaignId)}/creator-signal`, {
    method: 'POST',
    body: JSON.stringify({ count, basis }),
  });

/* ── The Admin prefills the Invite stage writes (added 2026-08-22) ─────────── */

/**
 * `PUT /api/admin/founders/:draftId/prefills`.
 *
 * Draft-scoped, and deliberately separate from `vetting-prefill`: these six are
 * Admin reference values about who a campaign should be pitched to and what
 * account the Founder will land in. They are not §9 answers, they are not
 * written into `campaign_vetting`, and none of them is ever presented as
 * calculated — the Onboarding stage renders each as `Admin prefill`.
 *
 * `affiliateType` is a `PREFILL_AFFILIATE_TYPES` id, never a label, and never a
 * `AFFILIATE_SUBTYPES` value: the two registers are deliberately different.
 */
export interface FounderPrefillPatch {
  viewsCount?: number | null;
  affiliateMatches?: number | null;
  affiliateType?: string | null;
  brandVoice1?: string | null;
  brandVoice2?: string | null;
  username?: string | null;
}

export const saveFounderPrefills = (
  draftId: string,
  patch: FounderPrefillPatch,
): Promise<unknown> =>
  call(`/api/admin/founders/${encodeURIComponent(draftId)}/prefills`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });

/* ── The application review (added 2026-08-22) ─────────────────────────────── */

/**
 * `POST /api/admin/campaigns/:campaignId/application-review/decide`.
 *
 * §25.6 keeps the two reasons apart as separate columns, so they are separate
 * parameters here: `internalReason` is the record, `customerExplanation` is the
 * only half that may ever reach the Founder. One field carrying both is how an
 * internal note ends up pasted into a customer message.
 *
 * `outcome` is an `APPLICATION_REVIEW_OUTCOMES` id. The server owns the set —
 * an unrecognised value is refused there and the refusal is what renders.
 */
export interface ApplicationReviewDecision {
  outcome: string;
  internalReason: string;
  customerExplanation?: string;
}

export const decideApplicationReview = (
  campaignId: string,
  decision: ApplicationReviewDecision,
): Promise<unknown> =>
  call(
    `/api/admin/campaigns/${encodeURIComponent(campaignId)}/application-review/decide`,
    { method: 'POST', body: JSON.stringify(decision) },
  );

/**
 * `POST /api/admin/campaigns/:campaignId/application-review/change-request`.
 *
 * `fieldKey` is a register key, never a column name and never free text: a
 * request against a field that does not exist would look complete while
 * pointing at nothing. The register lives on the server, which is what refuses
 * a key it does not know.
 */
export const requestApplicationChange = (
  campaignId: string,
  body: { fieldKey: string; reason: string },
): Promise<unknown> =>
  call(
    `/api/admin/campaigns/${encodeURIComponent(campaignId)}/application-review/change-request`,
    { method: 'POST', body: JSON.stringify(body) },
  );

/* ── §26.7's access decision ──────────────────────────────────────────────── */

/**
 * Suspend or restore a Founder's access.
 *
 * Freshness-gated on the server, and the reason is REQUIRED there — a blank one
 * is refused by `recordAccessAction` by name, not merely by the dialog that
 * collects it. The response is the whole workspace payload again, so the caller
 * re-renders from the server's own answer rather than patching a local copy.
 */
export const recordAccessDecision = (
  prospectId: string,
  action: 'suspend' | 'restore',
  reason: string,
): Promise<FounderWorkspaceDetail> =>
  call(`/api/admin/founders/${encodeURIComponent(prospectId)}/access`, {
    method: 'POST',
    body: JSON.stringify({ action, reason }),
  });

/* ── The panel supplement ─────────────────────────────────────────────────── */

/**
 * `GET /api/admin/founder-panel/:prospectId` — everything the eleven stages
 * need that `readFounderWorkspace` does not already compose.
 *
 * Typed as `unknown` on purpose. The server is the authority on this payload's
 * shape and it grows stage by stage; `readPanel` in `stages/recordGroup.tsx`
 * narrows it once, in one place, and every stage reads through that. A wide
 * interface here would be a second declaration of the same payload — which is
 * exactly how two copies start disagreeing.
 *
 * A refusal is not fatal: the shell keeps the workspace it already has and each
 * stage renders the absence of its supplement rather than an empty screen.
 */
export const fetchFounderPanel = (prospectId: string): Promise<unknown> =>
  call(`/api/admin/founder-panel/${encodeURIComponent(prospectId)}`);
