/**
 * The Founder Admin workspace vocabulary — Spec §26.1, §26.2, §3.1, §7, §23.1.
 *
 * The workspace is one person seen five ways: Overview (how they arrived),
 * Details (who they are), Campaigns (what they are running), Money (what is
 * owed and what blocks it), and History (everything that happened). This file
 * owns the words all five use, so no surface invents a second name for a state
 * the product already has one for.
 *
 * ── Why a label register exists at all ──────────────────────────────────────
 * §23.1 gives `campaigns.status` 27 machine values and §3.1 forbids several of
 * them reaching a person — `pre_build` and `pre_launch` are the named examples.
 * An Admin surface that renders the enum is a surface that will be read aloud
 * to a Founder on a support call, so the label is the product's answer and the
 * raw value lives one gesture below it under "Technical details". That is the
 * reference's own arrangement, and it is why both halves are exported here
 * rather than the raw value being quietly formatted at each call site.
 *
 * ── The register is total, and that is the point ─────────────────────────────
 * `CAMPAIGN_STATUS_LABELS` is typed as a total map over `CAMPAIGN_STATUSES`, so
 * adding a 28th lifecycle state without giving it a human label fails the build
 * rather than rendering `banned_founder` to somebody. The same shape is used
 * for every other vocabulary below.
 *
 * ── What this file deliberately does NOT decide ─────────────────────────────
 * No eligibility, no deadline, no money. It is names for facts other modules
 * own (§1 rule 6). Where the reference implies a rule the Spec does not state,
 * the rule is absent here and the surface says so honestly instead.
 */

import { CAMPAIGN_STATUSES, type CampaignStatus } from '../states/campaign.js';

/* ────────────────────────────────────────────── Campaign type and lifecycle */

/**
 * §3.1's mandated substitutions. `pre_build`/`pre_launch` are internal only;
 * these are the only two strings an Admin surface may render for them, and the
 * same two a Founder sees, so a support conversation uses one vocabulary.
 */
export const CAMPAIGN_TYPE_LABELS = {
  pre_build: 'Idea Campaign',
  pre_launch: 'Product Campaign',
} as const satisfies Record<'pre_build' | 'pre_launch', string>;

export type CampaignTypeKey = keyof typeof CAMPAIGN_TYPE_LABELS;

/**
 * Human-readable label for each of §23.1's 27 lifecycle states.
 *
 * Written in the plain register §3.1 asks for: what is happening and who is
 * waiting, never the table name. `affiliate_response_and_build` is the
 * reference's own worked example ("Building campaign and waiting for
 * Creators") and the rest follow its voice.
 *
 * Total by construction — see the file header.
 */
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
} as const satisfies Record<CampaignStatus, string>;

/** The label, or the raw value when a caller hands over something unknown. */
export function campaignStatusLabel(status: string): string {
  return (
    (CAMPAIGN_STATUS_LABELS as Record<string, string | undefined>)[status] ?? status
  );
}

/** Guard used by the backend restatement's drift test. */
export function isCampaignStatus(value: string): value is CampaignStatus {
  return (CAMPAIGN_STATUSES as readonly string[]).includes(value);
}

/* ─────────────────────────────────────────────────────── Account standing */

/**
 * What a person's Proovd Founder account is, right now.
 *
 * Four values, and only one of them is stored. "Not created yet" is the absence
 * of a claim; "Permanently banned" is a `founder_ghost_bans` row (§22.7, one
 * strike, no lift); "Access suspended" is the latest `founder_access_actions`
 * row; "Active" is what is left. Deriving rather than storing is deliberate —
 * a stored status is one a failed write can strand out of step with the records
 * that actually decide it.
 */
export const FOUNDER_ACCOUNT_STATES = [
  'Not created yet',
  'Active',
  'Access suspended',
  'Permanently banned',
] as const;
export type FounderAccountState = (typeof FOUNDER_ACCOUNT_STATES)[number];

/**
 * The two person-level access actions an Admin can take, plus the ban.
 *
 * Suspension is reversible and therefore a pair; the ban is §22.7's one-strike
 * record and is NOT in this list, because it is not an access action that can
 * be undone by its opposite — it has no opposite, by Spec.
 */
export const FOUNDER_ACCESS_ACTIONS = ['suspend', 'restore'] as const;
export type FounderAccessAction = (typeof FOUNDER_ACCESS_ACTIONS)[number];

/**
 * §22.7's four ghost-ban triggers, in the reference's own wording.
 *
 * The register exists so the ban confirmation can state the defined triggers
 * rather than implying Admin discretion. `recordGhostBan` refuses anything not
 * among the triggers a record actually meets, so this is copy, never a
 * permission list.
 */
export const GHOST_BAN_TRIGGER_SUMMARY =
  'Defined ghost-ban triggers: failed Day 14 Progress Check · no required ' +
  'communication for 30+ days after payment · product 30+ days past the ' +
  'disclosed delivery month without the required notice · Idea delivery ' +
  'failure with no updated timeline within 30 days.';

/* ──────────────────────────────────────────────────────────── Setup stage */

/**
 * The Founder-setup column on the list, and the header's "Founder setup" line.
 * Derived from the vetting record's completeness — never stored.
 */
export const FOUNDER_SETUP_STAGES = [
  'Not invited',
  'Invite sent',
  'Getting started',
  'Setup complete',
] as const;
export type FounderSetupStage = (typeof FOUNDER_SETUP_STAGES)[number];

/* ────────────────────────────────────────────────────────────── Invitation */

/**
 * What the Admin sees on the invitation line, and what each value MEANS.
 *
 * §27.1 asks every waiting state to answer "what happened" — a status word on
 * its own does not, so each state ships the sentence that explains it. The
 * sentences take the Founder's preferred name because that is who the Admin is
 * about to talk about.
 */
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

/** Whether a live invitation link exists that a Founder could still use. */
export function invitationLinkIsLive(state: InvitationState): boolean {
  return state === 'Invite sent' || state === 'New invite sent' || state === 'Invite opened';
}

/* ─────────────────────────────────────────────── Profile → invitation fill */

/**
 * The five values an invitation takes from the Founder profile, and may
 * override for one invitation only.
 *
 * §7 has Admin compose a message about a specific person; §26.2 says user data
 * auto-populates. Both are true at once here: the profile is the source, the
 * invitation may differ, and the difference is labelled rather than silently
 * flattened. An override is per-DRAFT — the profile is untouched, which is the
 * whole reason the two are separate columns rather than one editable value.
 *
 * `from` is the phrase the helper sentence uses for a value that is not simply
 * the person's own field ("the product currently associated with …").
 */
export const PROFILE_OVERRIDE_FIELDS = [
  { key: 'recipientName', label: 'Recipient name', profileField: 'legalName' },
  { key: 'recipientEmail', label: 'Recipient email', profileField: 'email' },
  { key: 'recipientPhone', label: 'Recipient phone', profileField: 'phone' },
  {
    key: 'product',
    label: 'Product',
    profileField: 'product',
    from: 'the product currently associated with',
  },
  {
    key: 'website',
    label: 'Website',
    profileField: 'website',
    from: 'the current product website of',
  },
] as const;

export type ProfileOverrideKey = (typeof PROFILE_OVERRIDE_FIELDS)[number]['key'];

export const PROFILE_OVERRIDE_KEYS = PROFILE_OVERRIDE_FIELDS.map((f) => f.key) as readonly ProfileOverrideKey[];

/**
 * The helper sentence under an override-able field.
 *
 * Two shapes, and the difference matters: when a value IS overridden the
 * sentence has to say the profile did not change, because the Admin is looking
 * at a value that disagrees with the record and needs to know which one is
 * authoritative. The email case omits the quoted profile value — repeating
 * somebody's real email beside the address a message is actually going to is
 * how the wrong one gets copied.
 */
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

export const OVERRIDE_EDIT_HELPER = (preferred: string): string =>
  `Custom value for this invitation only — ${preferred}’s Founder profile is not changed.`;

/* ──────────────────────────────────────────── The editable-field registry */

/**
 * Every field an Admin may change on a Founder record, and what changing it
 * means.
 *
 * Two groups, and the split is the information model:
 *
 *   `profile`     the Founder's own record. Changing it updates every surface
 *                 that auto-fills from it. Sent, accepted, approved, and paid
 *                 records keep the wording they used — that is enforced by the
 *                 send/consent snapshots, not by this register.
 *   `invitation`  content for one invitation. Changing it updates the record
 *                 and any future send; already-delivered messages are
 *                 untouched because a send is its own immutable row.
 *
 * ── What is NOT here, and why ───────────────────────────────────────────────
 * The three §9 setup answers (Problem, Solution, Competition) have no entry.
 * §9 makes them the Founder's own words — Competition may never even be
 * prefilled — so the workspace renders them read-only with their provenance.
 * An Admin correcting a Founder's answer is a support case, not a field edit.
 *
 * The activity-summary preference has no entry either, for a harder reason:
 * §27.7 and §30 require a digest frequency to exist only because a person chose
 * it. It is rendered read-only; see `SUMMARY_IS_NOT_ADMIN_WRITABLE`.
 */
export const FOUNDER_FIELD_GROUPS = ['profile', 'invitation'] as const;
export type FounderFieldGroup = (typeof FOUNDER_FIELD_GROUPS)[number];

export interface FounderEditableField {
  readonly key: string;
  readonly label: string;
  readonly group: FounderFieldGroup;
  /** Rendered under the value, and inside the edit dialog. */
  readonly helper?: string;
  /** `textarea` for multi-sentence content; `select` for a closed list. */
  readonly input?: 'text' | 'textarea' | 'select';
  readonly options?: readonly string[];
}

export const FOUNDER_EDITABLE_FIELDS = [
  { key: 'preferred', label: 'Preferred name', group: 'profile' },
  { key: 'legal', label: 'Legal name', group: 'profile' },
  { key: 'email', label: 'Email', group: 'profile' },
  {
    key: 'phone',
    label: 'Phone',
    group: 'profile',
    helper:
      'Phone number has not been verified, and the MVP has no way to verify one.',
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
] as const satisfies readonly FounderEditableField[];

export type FounderEditableFieldKey = (typeof FOUNDER_EDITABLE_FIELDS)[number]['key'];

export const FOUNDER_EDITABLE_FIELD_KEYS = FOUNDER_EDITABLE_FIELDS.map(
  (f) => f.key,
) as readonly FounderEditableFieldKey[];

export function founderFieldByKey(key: string): FounderEditableField | undefined {
  return FOUNDER_EDITABLE_FIELDS.find((f) => f.key === key);
}

/**
 * §7's two promises the Admin may not reword, and the support address.
 *
 * They are shown on the invitation-content list beside the editable fields and
 * carry no Edit control, for the reason `invitations.ts` has recorded since
 * Phase 06b: an editable no-guarantee clause is one that gets softened under
 * pressure from a Founder who wants a roster filled.
 */
export const INVITATION_FIXED_CONTENT_KEYS = ['invNext', 'invExpect', 'invSupport'] as const;
export type InvitationFixedContentKey = (typeof INVITATION_FIXED_CONTENT_KEYS)[number];

export const INVITATION_FIXED_CONTENT_LABELS = {
  invNext: 'What happens next',
  invExpect: 'Expectations we show the Founder',
  invSupport: 'Support contact',
} as const satisfies Record<InvitationFixedContentKey, string>;

export const INVITATION_FIXED_CONTENT_HELPER =
  'Fixed wording. §7 forbids Proovd promising acceptance, results, reward ' +
  'pricing, or a named Creator’s participation, so this sentence is not ' +
  'editable on any surface.';

/**
 * Why the activity summary is shown but not editable here.
 *
 * §27.7's preference exists only because a person chose it, and §30 forbids the
 * product setting it on their behalf. Rendering it read-only is the honest
 * form: the Admin can see what the Founder chose without there being a path
 * that answers for them.
 */
export const SUMMARY_IS_NOT_ADMIN_WRITABLE =
  'Only the Founder can set this. Proovd never chooses a summary frequency on ' +
  'someone’s behalf.';

export const SUMMARY_NOT_CHOSEN_LABEL = 'Not chosen yet' as const;

/**
 * The required-email line on Account preferences. §27.2's first rule, stated
 * where somebody might otherwise look for an off switch.
 */
export const REQUIRED_EMAILS_LABEL = 'Always enabled' as const;
export const REQUIRED_EMAILS_HELPER =
  'Transactional account, campaign, payment, support, and safety messages ' +
  'cannot be turned off.';

/* ─────────────────────────────────────────────────────── Reason and audit */

/**
 * When an Admin edit must state a reason.
 *
 * The rule is the reference's, and it is a good one: once a person owns the
 * account, correcting their record is a change to somebody else's data and
 * §25.6 wants the why. Before the claim it is Proovd's own prep — a typo in a
 * discovery note is not an audit event worth a paragraph, and demanding one
 * teaches Admins to type "correction" into every box, which is a worse record
 * than an honest blank.
 *
 * Invitation content is exempt at every stage: it is Proovd's own message, and
 * an already-sent version is preserved by its send row regardless.
 */
export function editReasonRequired(
  group: FounderFieldGroup,
  accountClaimed: boolean,
): boolean {
  return group === 'profile' && accountClaimed;
}

/** The body copy of the edit dialog, which differs across the four cases. */
export function editDialogBody(
  group: FounderFieldGroup,
  accountClaimed: boolean,
  invitationSent: boolean,
  preferred: string,
): string {
  if (group === 'invitation') {
    return invitationSent
      ? 'Already-sent invitations keep their delivered wording — this change updates the record and any future send.'
      : 'Updates the prepared invitation before it is sent.';
  }
  return accountClaimed
    ? 'Every surface that auto-fills from the profile updates to the new value. Sent, accepted, approved, or paid records keep the wording they used.'
    : `${preferred} hasn’t claimed an account yet — prep data can be corrected freely.`;
}

/* ──────────────────────────────────────────────────────────────── History */

/**
 * The eight history filters, in the reference's order.
 *
 * These are *categories of thing that happened to this person*, not the
 * §26.8 timeline's source tables — a Founder-scoped feed spans records the
 * campaign timeline never sees (invitation sends, W-9 events, Stripe account
 * events), so the chips are their own vocabulary and the composer maps onto
 * them.
 */
export const FOUNDER_HISTORY_CATEGORIES = [
  { key: 'all', label: 'All activity' },
  { key: 'invite', label: 'Invitation & setup' },
  { key: 'account', label: 'Account' },
  { key: 'campaign', label: 'Campaigns' },
  { key: 'money', label: 'Money' },
  { key: 'support', label: 'Support' },
  { key: 'admin', label: 'Admin changes' },
  { key: 'enforcement', label: 'Enforcement' },
] as const;

export type FounderHistoryFilterKey = (typeof FOUNDER_HISTORY_CATEGORIES)[number]['key'];
/** Every category except the `all` pseudo-filter — what an entry may carry. */
export type FounderHistoryCategory = Exclude<FounderHistoryFilterKey, 'all'>;

export const FOUNDER_HISTORY_CATEGORY_KEYS = FOUNDER_HISTORY_CATEGORIES.filter(
  (c) => c.key !== 'all',
).map((c) => c.key) as readonly FounderHistoryCategory[];

export const HISTORY_AUDIT_NOTE =
  'Plain-language history. The system keeps the complete audit record — actor, ' +
  'timestamps, before/after values, reasons, evidence, provider IDs, and ' +
  'reauthentication context — behind each sensitive event.';

/* ────────────────────────────────────────────────────────── Parked actions */

/**
 * The destinations the Founder workspace links to that are not built.
 *
 * §1.4: a control that claims a capability the product does not have is worse
 * than no control. Each message names what the destination IS, so an Admin
 * reading it learns where the work will live rather than that something broke.
 */
export const PARKED_MESSAGES = {
  tabs: 'Parked while the Founder workspace is built.',
  campaign: 'This opens the Campaign workspace — parked for now.',
  support: 'The support console is parked for now.',
  creatorFit: 'The Creator-fit review queue is parked for now.',
  photo: 'Photo upload is parked for now.',
  stripeHosted: 'The Stripe-hosted page is parked for now.',
} as const;

export type ParkedKey = keyof typeof PARKED_MESSAGES;

/* ───────────────────────────────────────────────────── Small shared copy */

export const NO_ATTENTION_LABEL = 'No action needed right now' as const;
export const NO_ATTENTION_ROW_LABEL = 'No action needed' as const;
export const ATTENTION_CHIP_LABEL = 'Needs attention' as const;
export const NO_ACTIVE_CAMPAIGN_LABEL = 'No active campaign' as const;

/**
 * The one sentence the Creator-matches block must carry whenever a number is
 * shown. §10 forbids the count reading as a commitment, and the number is the
 * most quotable thing on the Overview pane.
 */
export const CREATOR_MATCH_CAVEAT =
  'This is an early relevance signal based on the Founder’s submitted ' +
  'information. It does not mean these Creators have accepted the campaign or ' +
  'agreed to participate.';

/** §9's type lock, stated where an Admin might look for a "change type" control. */
export const CAMPAIGN_TYPE_LOCK_NOTE =
  'Campaign type confirmed. Once confirmed, the campaign type cannot be ' +
  'switched directly — a wrong type is archived and a new setup begins.';

/** §25.8: closing an account does not delete what retention law still needs. */
export const DELETION_RETENTION_NOTE =
  'Some campaign, payment, tax, support, and audit records may still need to ' +
  'be retained even if the Founder account is closed.';

export const DELETION_NO_BULK_ACTION_NOTE =
  'There is no “delete everything” action.' as const;

/** §13/§25.7: Proovd stores the status, never the document. */
export const IDENTITY_CHECK_HELPER =
  'Identity verification is managed by Stripe. Proovd stores the verification ' +
  'status, not Stripe’s government ID documents.';

/** The attention box's jump targets, so the surface cannot invent a sixth. */
export const ATTENTION_ACTIONS = [
  'jump-access',
  'jump-overview',
  'jump-money',
  'parked-campaign',
] as const;
export type AttentionAction = (typeof ATTENTION_ACTIONS)[number];
