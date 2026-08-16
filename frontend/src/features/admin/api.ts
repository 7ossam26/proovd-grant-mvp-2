/**
 * The Admin API client.
 *
 * One rule shapes this file: the server decides, and its refusal is what the
 * Admin reads. §1.1 requires server-side authorization on every surface, so
 * nothing here treats a client-side check as sufficient, and nothing invents a
 * friendlier message over a server one — the server already answers §27.1's six
 * questions in `whatHappened` / `next` / `action`, and paraphrasing it in the
 * browser is how the two start disagreeing.
 *
 * ── What this file carries, and what it deliberately does not ───────────────
 * Three groups: the session, the Founder workspace, and the one un-authenticated
 * read (`/api/draft/:token`) whose consumer happens to live outside `features/
 * admin` and has always borrowed this module's fetch helper.
 *
 * Everything else that used to live here — settings, Creator recruitment, the
 * §12 optional items, Creator readiness, the support queue, campaign operations,
 * disputes, and the high-impact override machine — went out with the surfaces
 * that consumed it. Those workspaces are supplied separately; a client function
 * with no caller is a claim that a surface exists (§1.4), and this module is
 * where that claim would be least visible.
 *
 * ── The workspace is keyed on the PERSON ────────────────────────────────────
 * Every workspace path below is `/api/admin/founders/:prospectId`, never
 * `:draftId`. A Founder whose campaign was archived-and-restarted (§9's
 * wrong-type path) has more than one draft and more than one campaign;
 * `founder_prospects` is the record that survives a restart, so it is the
 * record the workspace addresses.
 *
 * `updateProspect` is the one exception and it is not an inconsistency: §7's
 * invitation-creation fields belong to the *draft* that will carry them, and a
 * person with two drafts has two sets of them. It is addressed by the draft the
 * create call just returned, which is the only moment anything in this app
 * needs a draft id.
 */

import type {
  AttentionAction,
  CampaignStatus,
  FounderAccessAction,
  FounderAccountState,
  FounderDirectoryFilterKey,
  FounderEditableFieldKey,
  FounderHistoryCategory,
  FounderSetupStage,
  InvitationState,
  ProfileOverrideKey,
} from '@proovd/shared';

/** The failure shape every guarded route returns (`guards.ts`, `admin.ts`). */
export interface AdminError {
  error: string;
  title: string;
  whatHappened?: string;
  next?: string;
  action?: string;
  support?: string;
  status: number;
}

export class AdminRequestError extends Error {
  readonly detail: AdminError;
  constructor(detail: AdminError) {
    super(detail.title);
    this.name = 'AdminRequestError';
    this.detail = detail;
  }
}

/**
 * A failure with no usable body — the network dropped, or something returned
 * HTML. §30 forbids a generic error with no data status and no recovery, so
 * even this one says what is and is not known.
 */
function opaqueFailure(status: number): AdminError {
  return {
    error: 'unreachable',
    status,
    title: 'Proovd could not be reached',
    whatHappened:
      status === 0
        ? 'The request did not complete, so nothing was saved and nothing was changed.'
        : `The server answered ${status} with no explanation, so it is not certain whether the change was applied.`,
    next:
      status === 0
        ? 'Check your connection and try again.'
        : 'Reload this page to see the current stored values before trying again.',
  };
}

/**
 * Exported for `creators/api.ts`, which is the Creator workspace's own client.
 *
 * One fetch helper, not two: §27.1's answers arrive in `whatHappened` / `next`
 * / `action`, and a second `call` would be a second place for the rule that the
 * server's refusal is rendered verbatim to drift.
 */
export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      headers: init?.body ? { 'content-type': 'application/json' } : {},
      ...init,
    });
  } catch {
    throw new AdminRequestError(opaqueFailure(0));
  }

  if (!response.ok) {
    let body: Partial<AdminError> | null = null;
    try {
      body = (await response.json()) as Partial<AdminError>;
    } catch {
      body = null;
    }
    throw new AdminRequestError(
      body?.title
        ? { ...(body as AdminError), status: response.status }
        : opaqueFailure(response.status),
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/* ── Session ──────────────────────────────────────────────────────────────── */

/**
 * The environment facts the shell's chip reports.
 *
 * Optional, and rendered only when it arrives. §34 forbids claiming a mode
 * nobody checked, and a chip hardcoded to `TEST MODE` says the one thing that
 * must never be said by a page that did not ask — so the absence of this key
 * renders no chip at all rather than a reassuring default.
 */
export interface AdminEnvironment {
  stripeMode: 'test' | 'live';
  /** The pinned §32.2 API version, so a mismatch is visible without a deploy log. */
  stripeApiVersion: string;
  /** The last signed webhook this deployment accepted, or null if none yet. */
  webhooksLastEventAt: string | null;
}

export interface AdminIdentity {
  id: string;
  name: string;
  email: string;
  sessionEstablishedAt: string;
  prerequisiteKeys: string[];
  environment?: AdminEnvironment;
}

export const fetchAdminIdentity = (): Promise<AdminIdentity> =>
  call<AdminIdentity>('/api/admin/me');

/*
 * Signing in is NOT here any more.
 *
 * `signInWithPassword` and `verifyTotp` used to live in this module, which put
 * two implementations of "sign in" in the codebase — one for Admin, one for
 * everybody else — differing in their refusal wording and in how they
 * classified a failure. That is the shape a leak takes: the copy nobody is
 * looking at grows a helpful branch.
 *
 * Both doors now call `surfaces/auth/api.ts`, and both render the refusal from
 * `surfaces/auth/refusal.ts`. The second factor `verifyTotp` drove was removed
 * on 2026-08-10 (see `backend/src/auth/auth.ts`).
 */

export const signOut = (): Promise<unknown> =>
  call('/api/auth/sign-out', { method: 'POST', body: JSON.stringify({}) });

/* ── The Founder workspace payload (§26.1, §26.2, §27.1) ──────────────────── */

/*
 * These interfaces mirror `backend/src/founders/types.ts` name for name. They
 * are restated rather than imported because the frontend and the backend are
 * separate packages with separate build roots — the same arrangement every
 * other api module in this app uses — and a shape that drifts fails
 * `npm run typecheck` here the moment a fixture is typed against it.
 *
 * The vocabulary types themselves (`CampaignStatus`, `FounderAccountState`,
 * `InvitationState`, …) come from `@proovd/shared`, which the browser bundle
 * imports directly. There is one register; nothing here restates it.
 */

/** One cell of the directory's two action columns. Server-composed. */
export interface DirectoryActionCell {
  kind: 'due' | 'none';
  label: string;
}

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
  owner: string | null;

  /** `Idea` | `Product` | `Proposed` — Proposed is the absence of a §9 lock. */
  typeLabel: string;
  /** The composed lifecycle label (`Live · Day 6`, `Invite draft`, …). */
  lifecycle: string;
  adminAction: DirectoryActionCell;
  founderAction: DirectoryActionCell;
  /** Which directory filter cards this row belongs to. Server-derived. */
  filters: FounderDirectoryFilterKey[];
  /** Server-composed search text — the one matcher every filter reads. */
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

/** One recorded meeting note (migration 0047). Insert-only; never edited. */
export interface MeetingNoteView {
  id: string;
  meetingDate: string;
  participants: string;
  decisions: string;
  followUp: string;
  sourceLink: string;
  notes: string | null;
  recordedBy: string;
  recordedAt: string;
}

/** §7's discovery record, the research entries, and the meeting notes. */
export interface DiscoveryView {
  fields: {
    /** The prospect-update key this row edits, or null for a derived value. */
    key: string | null;
    label: string;
    value: string | null;
    helper: string | null;
  }[];
  research: string[];
  meetingNotes: MeetingNoteView[];
}

/** The current campaign's live facts. Null counts = not yet populated (§16a). */
export interface CampaignFactsView {
  campaignId: string;
  campaignDay: number | null;
  liveAt: string | null;
  closesAt: string | null;
  discoveryOpenedAt: string | null;
  activeBackers: number | null;
  threshold: number | null;
  activeAffiliates: number | null;
  publicUrl: string | null;
}

export interface FounderWorkspaceDetail {
  header: FounderHeader;
  overview: OverviewPane;
  details: DetailsPane;
  campaigns: CampaignsPane;
  money: MoneyPane;
  discovery: DiscoveryView;
  campaignFacts: CampaignFactsView | null;
  history: FounderHistoryEntry[];
  /** Counts per chip, so a zero-count filter can be hidden without a scan. */
  historyCounts: Record<string, number>;
}

/**
 * §7's preview gate, rendered.
 *
 * `unresolved` are bracketed markers still in the message; `missingBeforeSend`
 * are the §7 list items that never appear in it — the invitation source and the
 * internal campaign owner — which the marker scan therefore cannot see. Send is
 * refused server-side on either, whatever this payload says.
 */
export interface InvitationPreview {
  subject: string;
  html: string;
  text: string;
  recipientEmail: string | null;
  unresolved: string[];
  missingBeforeSend: string[];
  blocked: boolean;
}

/* ── The Founder workspace client ─────────────────────────────────────────── */

const founderBase = (prospectId: string) =>
  `/api/admin/founders/${encodeURIComponent(prospectId)}`;

export const fetchFounders = (): Promise<{ founders: FounderListRow[] }> =>
  call('/api/admin/founders');

export const fetchFounderWorkspace = (
  prospectId: string,
): Promise<FounderWorkspaceDetail> => call(founderBase(prospectId));

/** A new off-platform conversation, written down (migration 0047). */
export const addMeetingNote = (
  prospectId: string,
  body: {
    meetingDate: string;
    participants: string;
    decisions: string;
    followUp: string;
    sourceLink: string;
    notes?: string;
  },
): Promise<FounderWorkspaceDetail> =>
  call(`${founderBase(prospectId)}/meeting-notes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** One research finding, appended to §7's discovery-evidence list. */
export const addResearchEntry = (
  prospectId: string,
  body: { title: string; findings?: string; sourceLink: string },
): Promise<FounderWorkspaceDetail> =>
  call(`${founderBase(prospectId)}/research`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/**
 * §7's first act: writing down somebody met off-platform.
 *
 * Only the two facts that identify them are required. The rest of §7's
 * invitation-creation list is filled in on the workspace beside the message it
 * feeds, and Send stays closed until it is there — demanding all of it here
 * makes an Admin type something into a box to get past a form, which is a worse
 * record than an honestly incomplete one.
 *
 * There is deliberately no `competition` key (§9 Step 4, §33.1.5) and no
 * campaign-story key (§12): what Admin learned about either belongs in
 * `adminNotes`, which the Founder never sees.
 *
 * `problem` and `solution` are here because §9 calls them "human-prefilled by
 * Proovd from discovery" and this intake IS the discovery record. They are
 * written through the vetting prefill after the prospect commits, so the
 * provenance survives and a later Founder edit is never overwritten.
 */
export interface CreateProspectBody {
  legalName: string;
  email: string;
  preferredName?: string;
  phone?: string;
  productName?: string;
  /** §7's "product/company URL". The field is `productUrl` on the record. */
  productUrl?: string;
  /** §7 requires it on the send row, so it is asked for at intake if known. */
  invitationSource?: string;
  /** The Proovd team member responsible for this Founder's onboarding. */
  internalOwner?: string;
  /** `YYYY-MM-DD` from a date input. A record of a conversation, not a plan. */
  lastContactAt?: string;
  problem?: string;
  solution?: string;
  adminNotes?: string;
}

/**
 * All three ids, because the caller needs each for a different reason: the
 * prospect is the workspace address, the draft is what §7's invitation content
 * hangs off, and the campaign is the container §23.1 has just entered.
 */
export interface CreatedProspect {
  prospectId: string;
  campaignId: string;
  draftId: string;
}

export const createProspect = (body: CreateProspectBody): Promise<CreatedProspect> =>
  call('/api/admin/founders', { method: 'POST', body: JSON.stringify(body) });

/**
 * The rest of §7's invitation-creation list, against the draft that carries it.
 *
 * A key absent from the body writes nothing (§9's autosave rule, enforced on
 * the server), so saving a phone number can never blank an invitation source
 * recorded on a different visit. Send `null` to clear a value deliberately —
 * omitting it and clearing it are two different intentions and the route keeps
 * them apart.
 */
export interface UpdateProspectBody {
  preferredName?: string | null;
  phone?: string | null;
  productName?: string | null;
  productUrl?: string | null;
  launchFrame?: string | null;
  usAgeFit?: string | null;
  deliveryFeasibility?: string | null;
  compensationExpectations?: string | null;
  affiliateSourcingHypothesis?: string | null;
  adminNotes?: string | null;
  discoveryEvidence?: string[] | null;
  invitationSource?: string | null;
  internalOwner?: string | null;
  lastContactAt?: string | null;
}

/**
 * The campaign path, set by Admin from discovery (simplified flow). Freely
 * changeable until the Founder submits, which is when §9's permanent lock
 * happens and the server refuses further writes.
 */
export const setFounderCampaignPath = (
  draftId: string,
  campaignPath: 'pre_build' | 'pre_launch',
): Promise<unknown> =>
  call(`/api/admin/founders/${encodeURIComponent(draftId)}/campaign-path`, {
    method: 'PUT',
    body: JSON.stringify({ campaignPath }),
  });

/**
 * §9's Admin prefill for Problem and Solution, on the draft.
 *
 * The server owns the semantics: it refuses after submission, and once the
 * Founder has edited a field their words stay — the prefill snapshot updates
 * without touching what renders. The workspace only offers the control while
 * the server said the answer is still `editable`.
 */
export const prefillVettingAnswer = (
  draftId: string,
  key: 'problem' | 'solution',
  value: string | null,
): Promise<unknown> =>
  call(`/api/admin/founders/${encodeURIComponent(draftId)}/vetting-prefill`, {
    method: 'PUT',
    body: JSON.stringify({ [key]: value }),
  });

export const updateProspect = (
  draftId: string,
  body: UpdateProspectBody,
): Promise<{ ok: true }> =>
  call(`/api/admin/founders/${encodeURIComponent(draftId)}/prospect`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

/**
 * One field of the record, changed.
 *
 * `reason` is required where §25.6 requires it — the server decides that from
 * the record (`editReasonRequired`), never from the caller — and the prior value
 * is read from the row rather than supplied, so the audit pair cannot be
 * flattering (§33.12.4).
 *
 * `evidence` rides with it because §25.6 names evidence links as their own
 * audit column and the edit dialog collects one wherever a reason is required.
 * Collecting it and then dropping it in the client would be the worst of both:
 * the Admin believes it was filed and the record does not have it.
 */
export const updateFounderField = (
  prospectId: string,
  key: FounderEditableFieldKey,
  body: { value: string; reason?: string; evidence?: string },
): Promise<FounderWorkspaceDetail> =>
  call(`${founderBase(prospectId)}/fields/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

/** A value used for THIS invitation only. The Founder profile is not touched. */
export const setInvitationOverride = (
  prospectId: string,
  key: ProfileOverrideKey,
  value: string,
): Promise<FounderWorkspaceDetail> =>
  call(`${founderBase(prospectId)}/invitation/overrides/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });

export const clearInvitationOverride = (
  prospectId: string,
  key: ProfileOverrideKey,
): Promise<FounderWorkspaceDetail> =>
  call(`${founderBase(prospectId)}/invitation/overrides/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });

export const fetchInvitationPreview = (prospectId: string): Promise<InvitationPreview> =>
  call(`${founderBase(prospectId)}/invitation/preview`);

export interface InvitationSendResult {
  sendId: string;
  tokenVersion: number;
  resent: boolean;
}

export const sendInvite = (prospectId: string): Promise<InvitationSendResult> =>
  call(`${founderBase(prospectId)}/invitation/send`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

/**
 * A second invitation, which retires the first link.
 *
 * Its own route rather than a flag on `sendInvite`: §7 requires resend to work
 * and the previous link to stop working, and those are two different things to
 * tell a Founder who writes in holding the old one.
 */
export const sendNewInvite = (prospectId: string): Promise<InvitationSendResult> =>
  call(`${founderBase(prospectId)}/invitation/new`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const cancelInvite = (
  prospectId: string,
  reason: string,
): Promise<{ tokensRevoked: number }> =>
  call(`${founderBase(prospectId)}/invitation/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

/**
 * §26.7 standing: suspend this person's Founder access, or restore it.
 *
 * `reviewOwner` and `nextReviewAt` are §27.1's two promises to somebody who is
 * waiting, and the server refuses them on a restore — a closed review that
 * still names a next date is a promise nothing will honour (§1.4).
 */
export const recordAccessAction = (
  prospectId: string,
  body: {
    action: FounderAccessAction;
    reason: string;
    evidence?: string;
    reviewOwner?: string;
    nextReviewAt?: string;
  },
): Promise<FounderWorkspaceDetail> =>
  call(`${founderBase(prospectId)}/access`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/**
 * §22.7's one strike. Permanent, and there is no lift anywhere in the product.
 *
 * `trigger` must be one the record already meets; the server refuses every
 * other value by name, so there is no discretionary path through this call.
 */
export const banFounder = (
  prospectId: string,
  // §22.7's five recorded facts, all of them. None is optional and none is
  // defaulted: a permanent sanction justified by a blank the product filled in
  // is not the record §22.7 asks for.
  body: {
    trigger: string;
    notice: string;
    reason: string;
    evidence: string;
    paymentRecoveryStatus: string;
    enforcementDecision: string;
  },
): Promise<FounderWorkspaceDetail> =>
  call(`${founderBase(prospectId)}/ban`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/**
 * §25.8: the Founder asked to close their account, and we wrote it down.
 *
 * Recording the ASK. Nothing is deleted here, and there is no route that
 * deletes — campaign, payment, tax, support, and audit records outlive the
 * account regardless of what anyone requests.
 */
export const recordDeletionRequest = (
  prospectId: string,
  body: { detail: string; receivedVia: string; requestedAt: string },
): Promise<FounderWorkspaceDetail> =>
  call(`${founderBase(prospectId)}/deletion-request`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const recordDeletionReview = (
  prospectId: string,
  requestId: string,
  note: string,
): Promise<FounderWorkspaceDetail> =>
  call(
    `${founderBase(prospectId)}/deletion-request/${encodeURIComponent(requestId)}/reviews`,
    { method: 'POST', body: JSON.stringify({ note }) },
  );

/**
 * §22.10: whether Proovd has approved this Founder to run another campaign.
 *
 * The cooldown is not part of this — it is derived from the closed campaign's
 * own instant on every read and there is nothing here that could move it.
 */
export const setNextCampaignReadiness = (
  prospectId: string,
  // Two statements, because §25.6 wants the criteria that were applied and
  // §29.4 wants what the Founder is actually told — and the second must name
  // the real position rather than paraphrase an internal note.
  body: { approved: boolean; criteriaNote: string; customerExplanation: string },
): Promise<FounderWorkspaceDetail> =>
  call(`${founderBase(prospectId)}/next-campaign-readiness`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/* ── The draft landing state (§7) — no account, no session ────────────────── */

export interface DraftLanding {
  recipientName: string;
  /** The address the invitation reached — the Founder's own (§26.2). */
  recipientEmail: string | null;
  productName: string;
  whatWeUnderstood: string | null;
  senderName: string | null;
  expectedSetupTime: string | null;
  /** §7's "when we last spoke", as an ISO instant. Null when unrecorded. */
  lastContactAt: string | null;
  reference: string;
  processSummary: string[];
  noGuarantee: string;
}

export const fetchDraftLanding = (token: string): Promise<DraftLanding> =>
  call(`/api/draft/${encodeURIComponent(token)}`);
