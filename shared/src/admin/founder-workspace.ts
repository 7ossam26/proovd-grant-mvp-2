/**
 * The Founder Admin workspace vocabulary — Spec §26.1, §26.2, §3.1, §7, §23.1.
 *
 * The workspace is one person: a directory row, a record with eight sections
 * (rebuilt 2026-08-16 to the supplied reference — Overview, Onboarding,
 * Campaign, Affiliates, Backers & Demand, Money & Fulfillment, Support &
 * Enforcement, History), and the dialogs that write against it. This file owns
 * the words all of them use, so no surface invents a second name for a state
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

/* ─────────────────────────────── The directory (2026-08-16 rebuild) ────── */

/**
 * The six filter cards across the top of the directory, in the reference's
 * order and wording.
 *
 * Membership is the SERVER's answer — the Creators-workspace rule: two
 * derivations of "needs Admin" is two answers waiting to disagree, and §26.2
 * needs a `prior_value` to override against, which a browser-derived value
 * does not have. The rules recorded here are documentation of what the backend
 * derives, not something a surface re-computes:
 *
 *   all          every prospect.
 *   needs_admin  the Admin action column is due (the same kernel as the row).
 *   invited      an invitation send exists and no account claim does.
 *   onboarding   claimed, and the current campaign has not reached `live`.
 *   live         the current campaign is `live`.
 *   pre_invite   no invitation send exists yet.
 *
 * The cards may overlap (a live campaign can need Admin), which is why they
 * are filters rather than a partition.
 */
export const FOUNDER_DIRECTORY_FILTERS = [
  { key: 'all', title: 'All Founders', subtitle: 'Complete directory' },
  { key: 'needs_admin', title: 'Needs Admin', subtitle: 'Decisions and exceptions' },
  { key: 'invited', title: 'Invited — not accepted', subtitle: 'Waiting for claim' },
  { key: 'onboarding', title: 'Onboarding', subtitle: 'Claimed and moving' },
  { key: 'live', title: 'Live', subtitle: 'Campaigns to watch' },
  { key: 'pre_invite', title: 'Pre-invite', subtitle: 'Research ready' },
] as const;

export type FounderDirectoryFilterKey = (typeof FOUNDER_DIRECTORY_FILTERS)[number]['key'];

export const FOUNDER_DIRECTORY_FILTER_KEYS = FOUNDER_DIRECTORY_FILTERS.map(
  (f) => f.key,
) as readonly FounderDirectoryFilterKey[];

/**
 * The directory's Type filter.
 *
 * `proposed` is the reference's word for a campaign whose type is not locked
 * yet — the ABSENCE of a §9 decision, never a third type. §9 locks Idea or
 * Product at submission and nothing else exists, so `Proposed` appears in this
 * filter vocabulary and in the derived directory label, and in no type
 * register anywhere: adding it to `CAMPAIGN_TYPE_LABELS` would mint the third
 * type §9 forbids.
 */
export const FOUNDER_TYPE_FILTERS = [
  { key: 'all', label: 'All types' },
  { key: 'idea', label: 'Idea' },
  { key: 'product', label: 'Product' },
  { key: 'proposed', label: 'Proposed' },
] as const;

export type FounderTypeFilterKey = (typeof FOUNDER_TYPE_FILTERS)[number]['key'];

/** The derived label for an unlocked type. Not a member of any type register. */
export const PROPOSED_TYPE_LABEL = 'Proposed' as const;

/**
 * One cell of the directory's two action columns.
 *
 * The reference splits today's single attention chip into "who owes the next
 * step" — an Admin column and a Founder column — and every no-action state
 * carries its reason (§1.4: `No action — draft saved` beats a bare dash).
 * `due` renders emphasised; `none` renders quiet. The label is always the
 * whole sentence — the server composes it, the surface styles it.
 */
export type DirectoryActionKind = 'due' | 'none';

export interface DirectoryActionCell {
  readonly kind: DirectoryActionKind;
  readonly label: string;
}

/** The Founder column's two fixed no-action words, from the reference. */
export const WAITING_ON_PROOVD_LABEL = 'Waiting on Proovd' as const;
export const NO_ACCESS_YET_LABEL = 'No access yet' as const;

/**
 * The Founder's own default next step, per §23.1 lifecycle state.
 *
 * Total over the 27 states so a 28th without a decision fails the build.
 * `null` means the state asks nothing of the Founder — the cell then reads
 * `Waiting on Proovd` when Admin owes the next step, or `No action needed`.
 *
 * These are DEFAULTS: the backend refines where a finer record answers better
 * (an open Day 14 review with evidence already submitted stops asking for it;
 * a §22.3 blocker names the exact secure action). Nothing here invents a
 * deadline or a rule — every label names the act the state's own Spec section
 * already asks of the Founder.
 */
export const FOUNDER_NEXT_STEP_LABELS = {
  invited_draft: null, // derived from the invitation record, not the status
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
} as const satisfies Record<CampaignStatus, string | null>;

/* ───────────────────────── The record's sections (2026-08-16 rebuild) ──── */

/**
 * The eight sections of the Founder record and their sub-tabs, in the
 * reference's order and wording.
 *
 * The section and sub-tab live in the URL (`?section=…&tab=…`, DNA §5.12) so
 * a record state can be linked to. `built` records which sections this
 * rebuild's Session A ships in their final shape — the others render the
 * surface that currently owns their content, honestly labelled, until
 * Sessions B and C replace them (§1.4: an interim that says what it is beats
 * a mock of what it will be).
 */
export const FOUNDER_RECORD_SECTIONS = [
  { key: 'overview', label: 'Overview', tabs: [] },
  {
    key: 'onboarding',
    label: 'Onboarding',
    tabs: [
      { key: 'invite', label: 'Invite & Prefills' },
      { key: 'eligibility', label: 'Eligibility' },
      { key: 'optional', label: 'Optional Items' },
      { key: 'stripe', label: 'Stripe & Listing Fee' },
    ],
  },
  {
    key: 'campaign',
    label: 'Campaign',
    tabs: [
      { key: 'details', label: 'Details' },
      { key: 'review', label: 'Review' },
      { key: 'live', label: 'Live' },
      { key: 'page', label: 'Page & Updates' },
    ],
  },
  {
    key: 'affiliates',
    label: 'Affiliates',
    tabs: [
      { key: 'relationships', label: 'Relationships' },
      { key: 'requests', label: 'Requests' },
      { key: 'performance', label: 'Performance & Completion' },
    ],
  },
  {
    key: 'backers',
    label: 'Backers & Demand',
    tabs: [
      { key: 'demand', label: 'Demand' },
      { key: 'responses', label: 'Responses' },
      { key: 'backers', label: 'Backers' },
    ],
  },
  {
    key: 'money',
    label: 'Money & Fulfillment',
    tabs: [
      { key: 'close', label: 'Close' },
      { key: 'payments', label: 'Payments' },
      { key: 'fulfillment', label: 'Fulfillment' },
      { key: 'refunds', label: 'Refunds & Recovery' },
    ],
  },
  {
    key: 'support',
    label: 'Support & Enforcement',
    tabs: [
      { key: 'support', label: 'Support' },
      { key: 'cancellation', label: 'Cancellation' },
      { key: 'enforcement', label: 'Enforcement' },
    ],
  },
  {
    key: 'history',
    label: 'History',
    tabs: [
      { key: 'timeline', label: 'Timeline' },
      { key: 'communications', label: 'Communications' },
    ],
  },
] as const;

export type FounderRecordSectionKey = (typeof FOUNDER_RECORD_SECTIONS)[number]['key'];

export const FOUNDER_RECORD_SECTION_KEYS = FOUNDER_RECORD_SECTIONS.map(
  (s) => s.key,
) as readonly FounderRecordSectionKey[];

/* ───────────────── The Onboarding section (Session B, 2026-08-17) ──────── */

/**
 * Each Onboarding sub-tab leads with a question and answers it with the
 * record's state — the reference's own arrangement, wording pinned here so the
 * surface cannot drift into a second phrasing of the same question.
 *
 * The optional-items subtitle deliberately names no amount: the per-item
 * discount is a §6 setting (`optional_item_discount_cents`), so the number
 * renders from the server's fee lines and never from copy.
 */
export const ONBOARDING_TAB_COPY = {
  invite: {
    question: 'What did we send, and what did the Founder change?',
    subtitle: 'Invitation and prefills keep their sources, versions, and Founder corrections.',
  },
  eligibility: {
    question: 'Did the Founder legitimately become eligible?',
    subtitle: 'Admin can inspect these events but cannot fabricate or rewrite them.',
  },
  optional: {
    question: 'Which optional work earned a legitimate fee discount?',
    subtitle:
      'Optional items never block onboarding completion. Each valid item reduces the listing fee before payment.',
  },
  stripe: {
    question: 'Can this Founder move into campaign work?',
    subtitle:
      'Stripe remains provider-owned. The listing fee changes only through valid optional-item qualifications before payment.',
  },
} as const;

export type OnboardingTabKey = keyof typeof ONBOARDING_TAB_COPY;

/**
 * The Eligibility tab's pinned rule — the reference's own sentence, kept
 * because it is the strongest form of the §10 posture: age, location, the
 * acceptance state, its timestamp, and its version are provider and system
 * truth, and the tab renders no control that could change any of them. The
 * suite asserts the absence, not just the sentence.
 */
export const ELIGIBILITY_READ_ONLY_NOTE =
  'No Admin control on this screen can change age, country, acceptance state, timestamp, or version.';

/**
 * §12's division of labour, stated where an Admin looks for an edit control.
 * The content belongs to the Founder; what Admin owns is the DECISION — an
 * invalidation with an explanation the Founder can read, a reinstatement, or
 * an evidence-backed override. There is no route that writes the Founder's
 * workspace content, and the tab says so rather than offering dead controls.
 */
export const OPTIONAL_ITEM_CONTENT_IS_FOUNDERS =
  'This content is the Founder’s own work. Admin decides validity — invalidate ' +
  'with an explanation, reinstate, or override with evidence — but never ' +
  'writes the content itself.';

/* ──────────────── The Create Founder compose (Session B) ─────────────────── */

/**
 * The compose page's "Before you send" checklist, in the reference's order and
 * wording. Computed from form state as a courtesy only — the send route
 * re-decides every line server-side (§1.1), and the rail says so.
 */
export const CREATE_FOUNDER_CHECKLIST = [
  'Founder and business are identified',
  'Invitation email is valid',
  'US location is recorded',
  'One internal owner is assigned',
  'Exact invitation is ready',
] as const;

/**
 * The reference boxes the compose deliberately does not render, each with the
 * rule that refuses it. A register rather than component copy so the absence
 * is checkable — a later session re-adding one of these boxes fails a test
 * that walks this list, instead of quietly reintroducing a §1.8 conflict the
 * first build already paid for.
 */
export const CREATE_FOUNDER_ABSENCES = [
  {
    box: 'Business explanation',
    reason:
      'No §9 record reads a business explanation — the vetting answers are Problem, Solution, and the views range, and a prefill with no destination is a box that stores nothing.',
  },
  {
    box: 'Audience',
    reason:
      'The audience answer is the Founder’s own choice from a closed list of four ranges (migration 0042). There is no prefill path, and free text would invent one.',
  },
  {
    box: 'Founder story',
    reason:
      'The Story is a §12 optional item whose completing act is the Founder’s own approval. An Admin-written story would be Proovd’s content earning the Founder a discount.',
  },
  {
    box: 'Social links',
    reason:
      '§12’s social profiles are Founder workspace content with their own control confirmation. What Admin finds in research belongs in discovery evidence.',
  },
  {
    box: 'Meeting notes',
    reason:
      'A meeting note is a five-fact record (date, participants, decisions, follow-up, source — migration 0047). A freeform box here would degrade it to prose; the record’s own dialog is the path.',
  },
  {
    box: 'Potential viewer and Affiliate counts',
    reason:
      'The §10 possible-Creator count is an Admin assessment recorded after the Founder submits, and no §7 invitation content carries an estimate — a number in the message would read as the promise §7 forbids.',
  },
  {
    box: 'Visual asset uploads',
    reason:
      'Object storage is Track A4 and unconfigured — there is nowhere for a file to go, so no upload control renders anywhere in the product.',
  },
  {
    box: 'Branding evidence',
    reason:
      'Branding is the Founder’s §12 workspace content, evaluated by the server against what they saved. Admin’s §12 acts are invalidate, reinstate, and override — on the record, not at intake.',
  },
  {
    box: 'Interview scheduling',
    reason:
      'The booking record is created by the Founder’s own flow (§12, Track A4). Admin’s reconciliation path confirms or cancels an existing booking from the record’s Optional Items tab.',
  },
] as const;

/* ─────────────────────────────── Meeting notes (§7, migration 0047) ────── */

/**
 * The meeting-note dialog's fields, in the reference's order.
 *
 * Five required facts and one optional body. The point of a meeting note is
 * exactly the fields the reference requires — "Keep the decision,
 * participants, follow-up, and source attached to this Founder" — so the
 * service refuses a blank one by name and migration 0047's two-shape CHECK
 * refuses it regardless.
 */
export const MEETING_NOTE_FIELDS = [
  { key: 'meetingDate', label: 'Meeting date', required: true },
  { key: 'participants', label: 'Participants', required: true },
  { key: 'notes', label: 'Notes', required: false },
  { key: 'decisions', label: 'Decisions', required: true },
  { key: 'followUp', label: 'Follow-up', required: true },
  { key: 'sourceLink', label: 'Source or link', required: true },
] as const;

export type MeetingNoteFieldKey = (typeof MEETING_NOTE_FIELDS)[number]['key'];

/**
 * The research dialog's fields (the reference's `Add research`). A research
 * entry is a `discovery_evidence` line — §7's "Admin notes and discovery
 * evidence" — composed as one stored string, so the intake's evidence list
 * and this dialog stay one record with one shape.
 */
export const RESEARCH_ENTRY_FIELDS = [
  { key: 'title', label: 'Research title', required: true },
  { key: 'findings', label: 'Research findings', required: false },
  { key: 'sourceLink', label: 'Source or link', required: true },
] as const;

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
 *
 * ── What LEFT this register on 2026-08-16, and why ──────────────────────────
 * `campaign` — the Campaigns workspace was built 2026-08-15; the link is a
 * real route to `/admin/campaigns/:id`. `support` — the Support workspace was
 * built 2026-08-13; the link is a real route to `/admin/support` (unfiltered:
 * the support queue takes no search parameter yet, and the link says so
 * rather than promising a filter it cannot deliver). `tabs` — it was doing
 * double duty for the shell's parked Today nav AND the Money pane's W-9
 * action, and its sentence ("Parked while the Founder workspace is built")
 * had been false since 2026-08-10. It is split into `today` and `w9Close`.
 */
export const PARKED_MESSAGES = {
  today:
    'The Today overview is parked. Founders, Creators, Campaigns, Support, and Backers are the sections that exist.',
  explorePanels:
    'This opens the reservation ledger, money controls, and risk panels — their screens are not rebuilt yet; their APIs and §33 suites are live.',
  w9Close:
    'W-9 requests and decisions are close-operations work — that console is not rebuilt yet; the §22.3 services behind it are live.',
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

/**
 * The attention box's jump targets, so the surface cannot invent a sixth.
 *
 * `open-campaign` replaced `parked-campaign` on 2026-08-16: the Campaigns
 * workspace exists at `/admin/campaigns/:id`, so a campaign issue routes to
 * the workspace that owns campaign operations rather than to a toast about
 * one that did not exist yet.
 */
export const ATTENTION_ACTIONS = [
  'jump-access',
  'jump-overview',
  'jump-money',
  'open-campaign',
] as const;
export type AttentionAction = (typeof ATTENTION_ACTIONS)[number];

/* ─────────── The operations sections (Session C, 2026-08-17) ───────────── */

/**
 * Each read-and-route sub-tab leads with a question and answers it with the
 * record's state — the Onboarding arrangement (Session B), extended to the
 * five operations sections and History. The wording is the reference's own,
 * pinned here so the surface cannot drift into a second phrasing.
 *
 * The Money section deliberately shares ONE question across Payments,
 * Fulfillment, and Refunds & Recovery — the reference renders the same
 * eyebrow on all three, because before close they are one answer ("nothing
 * is due yet") and after close they are three views of one decision queue.
 */
export const OPERATIONS_TAB_COPY = {
  campaign: {
    details: {
      question: 'What exactly will Backers and Affiliates accept?',
      subtitle:
        'Every field renders from the recorded build; corrections run through the live-editing door, never through this page.',
    },
    review: {
      question: 'What still prevents approval?',
      subtitle:
        'Review rounds, roster readiness, and recorded feedback — the state of the review decision, not a second place to make it.',
    },
    live: {
      question: 'What changed in the live campaign?',
      subtitle: 'System-derived performance is read-only.',
    },
    page: {
      question: 'What are Backers seeing and what changed?',
      subtitle:
        'The public page, Founder updates, and the comment thread stay attached to the published version.',
    },
  },
  affiliates: {
    relationships: {
      question: 'What is waiting on whom?',
      subtitle:
        'Both sides must accept the same version before terms lock. Each relationship is operated from its own record.',
    },
    requests: {
      question: 'Which mediated request needs resolution?',
      subtitle:
        'The one mediated ask this product records is the work-again request; everything else arrives through support.',
    },
    performance: {
      question: 'How are Affiliates affecting this campaign?',
      subtitle:
        'Ranked by Backers brought in. Deep Affiliate analytics live in the Affiliate record.',
    },
  },
  backers: {
    demand: {
      question: 'Where is demand actually coming from?',
      /*
       * The reference writes "…tracking and reservation events". The Founders
       * suite scans every rendered pane against a stricter-than-§3.1 list that
       * has forbidden `reservation` since Session A, and the scan caught the
       * reference's own wording — so the pinned sentence says pre-order.
       */
      subtitle: 'Generated from valid tracking and pre-order events.',
    },
    responses: {
      question: 'What are Backers telling this Founder?',
      subtitle:
        'Original answers remain immutable; what may leave this screen respects the Backer’s own consent.',
    },
    backers: {
      question: 'Which Backer record needs support or payment context?',
      subtitle: 'Checkout responses and provider payment results are read-only.',
    },
  },
  money: {
    close: {
      question: 'Is this campaign ready to close cleanly?',
      subtitle:
        'System counts cannot be rewritten. Admin reviews eligibility and exact exceptions.',
    },
    payments: {
      question: 'What money or fulfillment decision is due?',
      subtitle: 'No Admin action can fabricate a post-close or provider outcome.',
    },
    fulfillment: {
      question: 'What money or fulfillment decision is due?',
      subtitle: 'Original and revised commitments remain visible together.',
    },
    refunds: {
      question: 'What money or fulfillment decision is due?',
      subtitle: 'Cases appear only from real charge, dispute, support, or enforcement events.',
    },
  },
  support: {
    support: {
      question: 'Which promise to a customer is due next?',
      subtitle: 'One owner, one due time, full campaign and payment context.',
    },
    cancellation: {
      question: 'Is there a Founder cancellation request?',
      subtitle: 'No request, decision, or financial consequence is fabricated.',
    },
    enforcement: {
      question: 'Is this Founder or campaign safe to continue?',
      subtitle: 'Sensitive actions are audited and never shown as a vague block.',
    },
  },
  history: {
    timeline: {
      question: 'How did this Founder reach the current state?',
      subtitle:
        'Existing events are immutable; Admin may add contextual notes without rewriting them.',
    },
    communications: {
      question: 'What did Proovd send — and what happened next?',
      subtitle:
        'Already-sent messages are immutable. Every message here was sent by the event that owns it.',
    },
  },
} as const;

export type OperationsSectionKey = keyof typeof OPERATIONS_TAB_COPY;

/**
 * What the reference draws on the operations sections and this record refuses
 * to mount, each with the rule — the `CREATE_FOUNDER_ABSENCES` arrangement.
 * The surface renders the refusals as sentences where the reference put
 * controls, so a later session re-adding one fails the register walk.
 */
export const OPERATIONS_ABSENCES = [
  {
    control: 'Edit a campaign field from this record',
    reason:
      'Campaign content changes run through §20’s one live-editing door, where the field’s own tier decides direct publish, review, or refusal — a per-field edit here would be a second door, and for never-direct fields a door that must not exist.',
  },
  {
    control: 'Mark reviewed / Approve campaign / Return changes',
    reason:
      '§15’s review is round-based with grouped feedback; no per-field reviewed record exists to write, and approval is a freshness-gated decision on the review routes, whose Admin console is not built yet.',
  },
  {
    control: 'Record a proposal acceptance, counter, or decline for either side',
    reason:
      'A §14.2 decision belongs to the side that makes it, through its own signed-in surface — Admin mediates and never agrees, and the one Admin move on a version (rejection) lives on the Creator relationship record.',
  },
  {
    control: 'Set a Creator bonus',
    reason:
      'A §14.3 bonus is proposed and accepted inside a proposal version’s bilateral lock; an Admin writing one directly would invent a commercial term nobody accepted.',
  },
  {
    control: 'Send a work-again request',
    reason:
      '§22.9’s request is the Founder’s own ask, recorded from the Founder’s session — an Admin control here would fabricate a Founder’s ask and a Creator would act on it.',
  },
  {
    control: 'Send a W-9 reminder',
    reason:
      '§27 names no manual W-9 reminder message — the due notices are sweep-sent on the recorded schedule, and a button that sends an unregistered message is the failure the notification register exists to prevent.',
  },
  {
    control: 'Approve, hold, or release a Founder payment',
    reason:
      '§22.3’s money decisions belong to the close-operations queue with its own gates and evidence — a release control on a person’s record would be a second door into money, and that queue’s Admin console is not built yet.',
  },
  {
    control: 'Decide a Day-14 review or a fulfillment evidence request',
    reason:
      '§22.4 and §22.5 decisions are recorded through the fulfillment services with their own consequence matrices; this record renders their one resolver and the decision console is not built yet.',
  },
  {
    control: 'Suspend or kill the campaign from this record',
    reason:
      'Campaign-scoped enforcement is §26.7’s recorded decision with its complete pre/post-capture effects — it is operated where those rules live, and account-level suspension and the ban already have their gated controls in this record’s header.',
  },
  {
    control: 'Send warning',
    reason:
      'No §27 notification key names a warning message, and a send the registry does not know about is the §1.4 failure — enforcement that reaches a person is a recorded action with its own notices.',
  },
  {
    control: 'Compose a Founder message',
    reason:
      'The product’s manual-send surfaces are the two invitation gates; every other message is sent by the event that owns it, and a general compose control would send messages §27 does not name.',
  },
  {
    control: 'Export the audit trail or the response dataset',
    reason:
      '§25.7’s one register-driven export is the §26.5 ledger’s, where what is withheld is named before the button is pressed — an export whose columns this record chose would be a limit the requester can widen.',
  },
] as const;

/**
 * The Requests tab's pinned absence — the brief's named Session C decision.
 * No meeting or end-partnership record was built, because no Founder-facing
 * surface can create one (§30 defers direct Founder–Creator messaging, and
 * §16's no-nudge posture is why §20's surfaces offer no ask-to-meet). A table
 * nobody can populate is §1.4's key-with-no-sender wearing a schema.
 */
export const MEDIATED_REQUESTS_ABSENT =
  'No meeting or end-partnership record exists — a Founder’s ask to meet a Creator or to end a partnership arrives through support and lives on the case. The one mediated ask this product records is the work-again request.';

/** §18/§20: moderation decides visibility; nobody edits another user's words. */
export const COMMENTS_NEVER_REWRITTEN =
  'Admin never rewrites another user’s comment — a flag is decided, and a removal names who and why while the row survives.';
