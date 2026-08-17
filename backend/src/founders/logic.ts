/**
 * The Founder workspace vocabulary, restated for the backend.
 *
 * `shared/src/admin/founder-workspace.ts` is the source of truth. The backend
 * cannot import it — it compiles under `rootDir: src` and ships only
 * `backend/dist`, so a cross-package import does not resolve at runtime. The
 * answer this repo has used since Phase 01 for the state enums, and since 06a
 * for the §6 settings, is to restate the data here and fail the suite if the
 * two ever disagree: `tests/founder-workspace.test.ts` compares every register
 * below against `@proovd/shared` (test files are outside the build's rootDir,
 * so they may import both).
 *
 * Restating rather than deriving is deliberate. A third copy could drift; a
 * copy a test compares cannot drift without somebody being told.
 */

/* ── Campaign type and lifecycle labels (§3.1, §23.1) ───────────────────────*/

export const CAMPAIGN_TYPE_LABELS: Record<string, string> = {
  pre_build: 'Idea Campaign',
  pre_launch: 'Product Campaign',
};

export const CAMPAIGN_STATUS_LABELS = {
  invited_draft: 'Invited — setup not started',
  vetting_submitted: 'Setup answers submitted',
  account_claimed: 'Founder account created',
  stripe_onboarding_pending: 'Finishing payment setup',
  listing_fee_pending: 'Listing fee not paid yet',
  affiliate_response_and_build: 'Building campaign and waiting for Creators',
  pending_review: 'Waiting for Proovd review',
  changes_required: 'Changes requested by Proovd',
  approved: 'Approved — waiting to launch',
  creator_prep: 'Creators preparing to launch',
  creator_replacement: 'Finding a replacement Creator',
  refunded_no_creator: 'Ended — no Creator accepted, listing fee refunded',
  live: 'Live',
  closed_pending_capture: 'Closed — charging Backers',
  capture_retry_window: 'Closed — retrying failed cards',
  closed_reconciling: 'Closed — reconciling',
  captured_pending_w9: 'Waiting for the W-9 before payment',
  single_payment_released: 'Founder payment released',
  first_payment_released: 'First Founder payment released',
  day_14_review: 'Day 14 progress review',
  remaining_payment_released: 'Remaining Founder payment released',
  fulfilled: 'Delivered',
  closed_resolved: 'Closed and reconciled',
  ended_no_charge: 'Ended — no Backers charged',
  suspended: 'Suspended',
  killed: 'Stopped by Proovd',
  banned_founder: 'Stopped — Founder no longer eligible',
} as const;

export type CampaignStatus = keyof typeof CAMPAIGN_STATUS_LABELS;

export function campaignStatusLabel(status: string): string {
  return (CAMPAIGN_STATUS_LABELS as Record<string, string | undefined>)[status] ?? status;
}

export function campaignTypeLabel(type: string | null): string | null {
  if (!type) return null;
  return CAMPAIGN_TYPE_LABELS[type] ?? type;
}

/* ── Account standing ───────────────────────────────────────────────────────*/

export const FOUNDER_ACCOUNT_STATES = [
  'Not created yet',
  'Active',
  'Access suspended',
  'Permanently banned',
] as const;
export type FounderAccountState = (typeof FOUNDER_ACCOUNT_STATES)[number];

export const FOUNDER_ACCESS_ACTIONS = ['suspend', 'restore'] as const;
export type FounderAccessAction = (typeof FOUNDER_ACCESS_ACTIONS)[number];

/**
 * The account state, derived from the three records that actually decide it.
 *
 * Order matters and is not arbitrary: a ban outranks a suspension because
 * §22.7 is permanent and a suspension is a review that ends, and both outrank
 * "not created" because a person can be banned before ever claiming (the
 * invitation is live and we want it to stop working). Nothing stores this.
 */
export function deriveAccountState(input: {
  accountClaimed: boolean;
  banned: boolean;
  latestAccessAction: FounderAccessAction | null;
}): FounderAccountState {
  if (input.banned) return 'Permanently banned';
  if (input.latestAccessAction === 'suspend') return 'Access suspended';
  if (!input.accountClaimed) return 'Not created yet';
  return 'Active';
}

export const GHOST_BAN_TRIGGER_SUMMARY =
  'Defined ghost-ban triggers: failed Day 14 Progress Check · no required ' +
  'communication for 30+ days after payment · product 30+ days past the ' +
  'disclosed delivery month without the required notice · Idea delivery ' +
  'failure with no updated timeline within 30 days.';

/* ── Setup stage ────────────────────────────────────────────────────────────*/

export const FOUNDER_SETUP_STAGES = [
  'Not invited',
  'Invite sent',
  'Getting started',
  'Setup complete',
] as const;
export type FounderSetupStage = (typeof FOUNDER_SETUP_STAGES)[number];

/**
 * Where the Founder has got to, and — when they are mid-way — how far.
 *
 * The detail line only appears in `Getting started`, because that is the only
 * stage where a fraction tells the Admin something they cannot see from the
 * stage word alone.
 */
export function deriveSetupStage(input: {
  invitationSent: boolean;
  answered: number;
  total: number;
  signupComplete: boolean;
}): { stage: FounderSetupStage; detail: string | null } {
  if (input.signupComplete) return { stage: 'Setup complete', detail: null };
  if (!input.invitationSent) return { stage: 'Not invited', detail: null };
  if (input.answered === 0) return { stage: 'Invite sent', detail: null };
  return {
    stage: 'Getting started',
    detail: `${input.answered} of ${input.total} setup questions completed`,
  };
}

/* ── Invitation ─────────────────────────────────────────────────────────────*/

export const INVITATION_STATES = [
  'Not sent',
  'Invite sent',
  'New invite sent',
  'Invite opened',
  'Invite accepted',
  'Invite canceled',
  'Invite expired',
] as const;
export type InvitationState = (typeof INVITATION_STATES)[number];

export function invitationMeaning(state: InvitationState, preferred: string): string {
  switch (state) {
    case 'Not sent':
      return 'An invitation has been prepared but has not been sent.';
    case 'Invite sent':
      return `${preferred} can currently use the active invitation link.`;
    case 'New invite sent':
      return 'A newer invitation was sent. The previous invitation link no longer works.';
    case 'Invite opened':
      return `${preferred} opened the Founder setup. The invitation link is still active.`;
    case 'Invite accepted':
      return `${preferred} used the invitation and completed the account-claim step.`;
    case 'Invite canceled':
      return `Proovd canceled this invitation. ${preferred} can no longer use its link.`;
    case 'Invite expired':
      return `This invitation link expired before ${preferred} used it.`;
  }
}

export function invitationLinkIsLive(state: InvitationState): boolean {
  return state === 'Invite sent' || state === 'New invite sent' || state === 'Invite opened';
}

/**
 * The invitation state, read from the draft, its sends, and the claim.
 *
 * `sendCount > 1` is what distinguishes "New invite sent" from "Invite sent",
 * and it matters: the copy has to tell the Admin the OLD link stopped working,
 * which is the single most common support question a resend produces.
 */
export function deriveInvitationState(input: {
  draftStatus: string;
  sendCount: number;
  openedAt: Date | null;
  claimedAt: Date | null;
  tokenExpiresAt: Date | null;
  now: Date;
}): InvitationState {
  if (input.claimedAt) return 'Invite accepted';
  if (input.draftStatus === 'revoked') return 'Invite canceled';
  if (input.draftStatus === 'expired') return 'Invite expired';
  if (input.sendCount === 0) return 'Not sent';
  if (input.tokenExpiresAt && input.tokenExpiresAt.getTime() <= input.now.getTime()) {
    return 'Invite expired';
  }
  if (input.openedAt) return 'Invite opened';
  return input.sendCount > 1 ? 'New invite sent' : 'Invite sent';
}

/* ── Profile → invitation overrides (§7, §26.2) ─────────────────────────────*/

export const PROFILE_OVERRIDE_FIELDS = [
  { key: 'recipientName', label: 'Recipient name', column: 'overrideRecipientName' },
  { key: 'recipientEmail', label: 'Recipient email', column: 'overrideRecipientEmail' },
  { key: 'recipientPhone', label: 'Recipient phone', column: 'overrideRecipientPhone' },
  { key: 'product', label: 'Product', column: 'overrideProduct' },
  { key: 'website', label: 'Website', column: 'overrideWebsite' },
] as const;

export type ProfileOverrideKey = (typeof PROFILE_OVERRIDE_FIELDS)[number]['key'];

export const PROFILE_OVERRIDE_KEYS = PROFILE_OVERRIDE_FIELDS.map(
  (f) => f.key,
) as readonly ProfileOverrideKey[];

export function isProfileOverrideKey(value: string): value is ProfileOverrideKey {
  return (PROFILE_OVERRIDE_KEYS as readonly string[]).includes(value);
}

export function overrideHelper(
  key: ProfileOverrideKey,
  preferred: string,
  overridden: boolean,
  profileValue: string,
): string {
  if (!overridden) return `Automatically filled from ${preferred}’s Founder profile.`;
  if (key === 'recipientEmail') {
    return `Custom value for this invitation. ${preferred}’s Founder profile email has not changed.`;
  }
  return `Custom value for this invitation. ${preferred}’s Founder profile still says “${profileValue}.”`;
}

/* ── Editable fields (§25.6) ────────────────────────────────────────────────*/

export const FOUNDER_FIELD_GROUPS = ['profile', 'invitation'] as const;
export type FounderFieldGroup = (typeof FOUNDER_FIELD_GROUPS)[number];

export interface FounderEditableField {
  readonly key: string;
  readonly label: string;
  readonly group: FounderFieldGroup;
  readonly helper?: string;
  readonly input?: 'text' | 'textarea' | 'select';
}

export const FOUNDER_EDITABLE_FIELDS: readonly FounderEditableField[] = [
  { key: 'preferred', label: 'Preferred name', group: 'profile' },
  { key: 'legal', label: 'Legal name', group: 'profile' },
  { key: 'email', label: 'Email', group: 'profile' },
  {
    key: 'phone',
    label: 'Phone',
    group: 'profile',
    helper: 'Phone number has not been verified, and the MVP has no way to verify one.',
  },
  {
    key: 'dob',
    label: 'Date of birth',
    group: 'profile',
    helper: 'Entered as YYYY-MM-DD, e.g. 1990-04-23.',
  },
  { key: 'state', label: 'State', group: 'profile' },
  { key: 'country', label: 'Country', group: 'profile' },
  {
    key: 'bizType',
    label: 'Business type',
    group: 'profile',
    helper:
      'Sole proprietor · LLC · Corporation — no forced list; a later policy may define one.',
  },
  {
    key: 'bizLegal',
    label: 'Legal business name',
    group: 'profile',
    helper:
      'Auto-fills invitations and campaigns. Sent and accepted records keep the wording they used.',
  },
  { key: 'product', label: 'Product / startup name', group: 'profile' },
  { key: 'website', label: 'Website', group: 'profile' },
  {
    key: 'invSource',
    label: 'How we found this Founder',
    group: 'invitation',
    helper:
      'Proovd research · Referral · Founder outreach · Event · Existing relationship — or anything custom.',
  },
  {
    key: 'invOwner',
    label: 'Proovd owner',
    group: 'invitation',
    helper:
      'Proovd team member currently responsible for this Founder’s onboarding and follow-up.',
  },
  { key: 'invKnow', label: 'What we know so far', group: 'invitation', input: 'textarea' },
  {
    key: 'invFit',
    label: 'Why we think they could be a fit',
    group: 'invitation',
    input: 'textarea',
  },
  {
    key: 'invTime',
    label: 'Estimated time to get started',
    group: 'invitation',
    helper: 'This must reflect the actual expected effort.',
  },
];

export function founderFieldByKey(key: string): FounderEditableField | undefined {
  return FOUNDER_EDITABLE_FIELDS.find((f) => f.key === key);
}

/**
 * §25.6's reason requirement, decided by the record rather than by the caller.
 *
 * Once a person owns the account, correcting their record is a change to
 * somebody else's data and the why is required. Before the claim it is Proovd's
 * own prep, and demanding a paragraph for a typo teaches Admins to type
 * "correction" into every box — a worse record than an honest blank.
 */
export function editReasonRequired(
  group: FounderFieldGroup,
  accountClaimed: boolean,
): boolean {
  return group === 'profile' && accountClaimed;
}

/* ── History (§26.8, §25.6) ─────────────────────────────────────────────────*/

export const FOUNDER_HISTORY_CATEGORIES = [
  'invite',
  'account',
  'campaign',
  'money',
  'support',
  'admin',
  'enforcement',
] as const;
export type FounderHistoryCategory = (typeof FOUNDER_HISTORY_CATEGORIES)[number];

export function isFounderHistoryCategory(v: string): v is FounderHistoryCategory {
  return (FOUNDER_HISTORY_CATEGORIES as readonly string[]).includes(v);
}

/* ── Attention (§20-style ranking, one act) ─────────────────────────────────*/

/**
 * `open-campaign` replaced `parked-campaign` on 2026-08-16 — the Campaigns
 * workspace exists, so a campaign issue routes to it.
 */
export const ATTENTION_ACTIONS = [
  'jump-access',
  'jump-overview',
  'jump-money',
  'open-campaign',
] as const;
export type AttentionAction = (typeof ATTENTION_ACTIONS)[number];

/* ── The directory (2026-08-16 rebuild) ─────────────────────────────────────*/

export const FOUNDER_DIRECTORY_FILTERS = [
  { key: 'all', title: 'All Founders', subtitle: 'Complete directory' },
  { key: 'needs_admin', title: 'Needs Admin', subtitle: 'Decisions and exceptions' },
  { key: 'invited', title: 'Invited — not accepted', subtitle: 'Waiting for claim' },
  { key: 'onboarding', title: 'Onboarding', subtitle: 'Claimed and moving' },
  { key: 'live', title: 'Live', subtitle: 'Campaigns to watch' },
  { key: 'pre_invite', title: 'Pre-invite', subtitle: 'Research ready' },
] as const;

export type FounderDirectoryFilterKey = (typeof FOUNDER_DIRECTORY_FILTERS)[number]['key'];

export const FOUNDER_TYPE_FILTERS = [
  { key: 'all', label: 'All types' },
  { key: 'idea', label: 'Idea' },
  { key: 'product', label: 'Product' },
  { key: 'proposed', label: 'Proposed' },
] as const;

export type FounderTypeFilterKey = (typeof FOUNDER_TYPE_FILTERS)[number]['key'];

/**
 * The derived label for a campaign whose §9 type is not locked yet. The
 * ABSENCE of a decision, never a third type — it appears in the filter
 * vocabulary and the derived directory label, and in no type register.
 */
export const PROPOSED_TYPE_LABEL = 'Proposed';

export type DirectoryActionKind = 'due' | 'none';

export interface DirectoryActionCell {
  readonly kind: DirectoryActionKind;
  readonly label: string;
}

export const WAITING_ON_PROOVD_LABEL = 'Waiting on Proovd';
export const NO_ACCESS_YET_LABEL = 'No access yet';

/**
 * The Founder's own default next step per lifecycle state. Restated from
 * shared and drift-tested; see the shared register for the reasoning. The
 * composition refines these where a finer record answers better.
 */
export const FOUNDER_NEXT_STEP_LABELS: Record<CampaignStatus, string | null> = {
  invited_draft: null,
  vetting_submitted: 'Complete the account claim',
  account_claimed: 'Continue campaign setup',
  stripe_onboarding_pending: 'Finish payment setup',
  listing_fee_pending: 'Pay the listing fee',
  affiliate_response_and_build: 'Finish the campaign build',
  pending_review: null,
  changes_required: 'Address the requested changes',
  approved: null,
  creator_prep: null,
  creator_replacement: null,
  refunded_no_creator: null,
  live: null,
  closed_pending_capture: null,
  capture_retry_window: null,
  closed_reconciling: null,
  captured_pending_w9: 'Submit the W-9 securely',
  single_payment_released: null,
  first_payment_released: null,
  day_14_review: 'Submit Day 14 progress evidence',
  remaining_payment_released: null,
  fulfilled: null,
  closed_resolved: null,
  ended_no_charge: null,
  suspended: null,
  killed: null,
  banned_founder: null,
};

/* ── Meeting notes and research entries (§7, migration 0047) ────────────────*/

export const MEETING_NOTE_FIELDS = [
  { key: 'meetingDate', label: 'Meeting date', required: true },
  { key: 'participants', label: 'Participants', required: true },
  { key: 'notes', label: 'Notes', required: false },
  { key: 'decisions', label: 'Decisions', required: true },
  { key: 'followUp', label: 'Follow-up', required: true },
  { key: 'sourceLink', label: 'Source or link', required: true },
] as const;

export const RESEARCH_ENTRY_FIELDS = [
  { key: 'title', label: 'Research title', required: true },
  { key: 'findings', label: 'Research findings', required: false },
  { key: 'sourceLink', label: 'Source or link', required: true },
] as const;

/* ── Copy the API sends with a payload ──────────────────────────────────────*/

export const SUMMARY_IS_NOT_ADMIN_WRITABLE =
  'Only the Founder can set this. Proovd never chooses a summary frequency on ' +
  'someone’s behalf.';

export const SUMMARY_NOT_CHOSEN_LABEL = 'Not chosen yet';

export const REQUIRED_EMAILS_LABEL = 'Always enabled';
export const REQUIRED_EMAILS_HELPER =
  'Transactional account, campaign, payment, support, and safety messages ' +
  'cannot be turned off.';

export const CREATOR_MATCH_CAVEAT =
  'This is an early relevance signal based on the Founder’s submitted ' +
  'information. It does not mean these Creators have accepted the campaign or ' +
  'agreed to participate.';

export const CAMPAIGN_TYPE_LOCK_NOTE =
  'Campaign type confirmed. Once confirmed, the campaign type cannot be ' +
  'switched directly — a wrong type is archived and a new setup begins.';

export const DELETION_RETENTION_NOTE =
  'Some campaign, payment, tax, support, and audit records may still need to ' +
  'be retained even if the Founder account is closed.';

export const IDENTITY_CHECK_HELPER =
  'Identity verification is managed by Stripe. Proovd stores the verification ' +
  'status, not Stripe’s government ID documents.';

/**
 * A stable 1–14 sticker index for a person.
 *
 * Derived from the id so the same Founder always carries the same sticker
 * across sessions and machines — a decorative value that moved on every read
 * would make two Admins describing "the one with the green sticker" disagree.
 */
export function stickerFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 14) + 1;
}
