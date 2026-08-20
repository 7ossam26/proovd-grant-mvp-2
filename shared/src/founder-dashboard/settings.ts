/**
 * The Founder's own settings — Founder Dashboard, Session G, 2026-08-20.
 *
 * ═══ THIS IS NOT A DEVIATION. IT IS §5.2 AS WRITTEN. ════════════════════════
 *
 * §5.2 lists, verbatim: *"Founder settings: name, email, phone, profile photo,
 * password, business/entity data, connected-account status, read-only KYC
 * status, notification preferences, post-close W-9 status, and delete-account
 * request."*
 *
 * Eleven items. Before this, ONE of them existed as a Founder-facing control:
 * the notification preference, at `/settings/notifications`, whose own header
 * has said since Phase 22c that *"when a later phase has a second account-level
 * setting, it joins this page."* This is that phase, and the page it joins is
 * this one — `/settings/notifications` redirects here.
 *
 * ── The register is the done-when ─────────────────────────────────────────
 * "Every §5.2 item is present or renders why it is not" is only checkable if
 * the eleven are a list rather than a paragraph. So they are, and each carries
 * either `present: true` or an `absentBecause` a surface renders where the
 * control would be. A twelfth item is a §1 rule 6 conversation; a missing one
 * fails the register walk.
 *
 * ── What is deliberately NOT copied from the Creator's version ────────────
 * Creator Flow Session A built `affiliate_profile_corrections` (0055) because
 * `affiliate_signup_profiles` has **no history table at all** — no provenance
 * columns on `date_of_birth`, `country`, `state_region` or the five
 * confirmations, and nothing trigger-written beside them. The record had to be
 * created before a reason could be stored.
 *
 * The Founder record is not in that position. `founder_claim_profiles` has
 * carried a trigger-written provenance history since Phase 07 —
 * `record_claim_profile_edits` writes `draft_field_edits` with the prior value,
 * the new value, the supplier, the editor and the instant, insert-only and
 * swept by §25.8 — and `audit_events` carries the reason, which is exactly what
 * Admin's own `updateFounderField` has written since 2026-08-16.
 *
 * So Session G copies the **discipline** and not the table: a required reason,
 * the prior value read from the row `FOR UPDATE` inside the transaction that
 * changes it (§33.12.4), an audit row in the same transaction, and registered
 * field ids rather than free-text column names (16a's overridable-field
 * reasoning). A third store for prior/new/reason would be the duplicate this
 * codebase refuses everywhere else — §26.8's *"a second event store that drifts
 * from the first is worse than no timeline"* — and it would put the Founder's
 * own corrections somewhere `founders/history.ts` does not look, which is the
 * one place a support person goes to find out what happened.
 */

/* ── §5.2's eleven, as a register ─────────────────────────────────────────── */

export interface FounderSettingsItem {
  id: string;
  /** §5.2's own word for it. */
  label: string;
  specRef: string;
  /**
   * Null where the item is built. A sentence where it is not — rendered in the
   * item's own position, never omitted, because a settings page missing one of
   * §5.2's names reads as a page that forgot rather than one that decided.
   */
  absentBecause: string | null;
}

export const FOUNDER_SETTINGS_ITEMS: readonly FounderSettingsItem[] = [
  { id: 'name', label: 'Name', specRef: '§5.2, §10', absentBecause: null },
  { id: 'email', label: 'Email', specRef: '§5.2, §27.2', absentBecause: null },
  { id: 'phone', label: 'Phone', specRef: '§5.2', absentBecause: null },
  {
    id: 'profile_photo',
    label: 'Profile photo',
    specRef: '§5.2, §12',
    absentBecause:
      'There is nowhere to put a photo yet. Proovd’s file storage is not configured on this deployment, so an upload control here would be a control that cannot finish — and a picture is not what any Founder-facing surface renders today.',
  },
  { id: 'password', label: 'Password', specRef: '§5.2, §5.5', absentBecause: null },
  {
    id: 'business',
    label: 'Business or entity details',
    specRef: '§5.2, §10',
    absentBecause: null,
  },
  {
    id: 'connected_account',
    label: 'Payout account status',
    specRef: '§5.2, §13',
    absentBecause: null,
  },
  { id: 'kyc', label: 'Identity check', specRef: '§5.2, §13', absentBecause: null },
  {
    id: 'notifications',
    label: 'Notification preferences',
    specRef: '§5.2, §27.7',
    absentBecause: null,
  },
  { id: 'w9', label: 'W-9 status', specRef: '§5.2, §22.3', absentBecause: null },
  {
    id: 'delete_account',
    label: 'Close your account',
    specRef: '§5.2, §25.8',
    absentBecause: null,
  },
];

export const FOUNDER_SETTINGS_ITEM_IDS: readonly string[] = FOUNDER_SETTINGS_ITEMS.map(
  (item) => item.id,
);

export function founderSettingsItem(id: string): FounderSettingsItem | undefined {
  return FOUNDER_SETTINGS_ITEMS.find((item) => item.id === id);
}

/* ── The fields a Founder may correct about themselves ────────────────────── */

/**
 * `column` is the real `founder_claim_profiles` column, named rather than free
 * text. 16a's reasoning: a route accepting any string would happily record a
 * correction of something that does not exist, and the trail would look
 * complete while pointing at nothing.
 */
export interface FounderSettingsField {
  id: string;
  label: string;
  column: string;
  specRef: string;
  help?: string;
}

/**
 * §5.2's name, phone, and business/entity data, as columns that exist.
 *
 * Deliberately NOT here, each with its reason:
 *   * **`date_of_birth`** — §10 collects it once as part of the Founder's own
 *     age representation, and changing it changes what was represented. The
 *     product derives no age from it and never claims to have verified one, so
 *     a settings control that quietly moved it would move a statement rather
 *     than a preference.
 *   * **the three §10 representations** — 18+, US person, and sanctions, each
 *     its own unchecked control at the claim (§28.4). A representation
 *     somebody can toggle later is not a representation.
 *   * **`country` and `state_region`** — the same claim-time answers, and
 *     `country` in particular is what §24.3's tax handling and §11's US-only
 *     rule read. A change there is a support conversation.
 *   * **every payout column** — Stripe's, read-only, §13 and §5.2.
 *   * **the §9 answers** — Problem, Solution and Positioning are locked at
 *     submission and their route sits behind a token the claim invalidated.
 *     They have no editable key anywhere in the product, and the Admin
 *     workspace has refused one three times since 2026-08-16.
 */
export const FOUNDER_SETTINGS_FIELDS: readonly FounderSettingsField[] = [
  {
    id: 'preferred_name',
    label: 'Preferred name',
    column: 'preferred_name',
    specRef: '§5.2, §10',
    help: 'What we call you in messages. Not the name on your payout account.',
  },
  {
    id: 'phone',
    label: 'Phone',
    column: 'phone',
    specRef: '§5.2',
    help: 'Collected, never verified. Proovd sends no SMS and has no way to check a number.',
  },
  {
    id: 'business_name',
    label: 'Business name',
    column: 'business_name',
    specRef: '§5.2, §10',
    help: 'Blank if you are a sole proprietor with no separate entity.',
  },
  {
    id: 'business_entity_type',
    label: 'Business type',
    column: 'business_entity_type',
    specRef: '§5.2, §10',
    help: 'Sole proprietor · LLC · Corporation — or whatever yours actually is.',
  },
];

export type FounderSettingsFieldId = (typeof FOUNDER_SETTINGS_FIELDS)[number]['id'];

export const FOUNDER_SETTINGS_FIELD_IDS: readonly string[] = FOUNDER_SETTINGS_FIELDS.map(
  (f) => f.id,
);

export function founderSettingsField(id: string): FounderSettingsField | undefined {
  return FOUNDER_SETTINGS_FIELDS.find((f) => f.id === id);
}

/**
 * The two §5.2 names that are not free edits, and what happens instead.
 *
 * Neither is refused — §5.2 lists both — but neither is a box that saves on
 * blur either. Both take the correction path's shape, with the consequence
 * stated BEFORE the change rather than discovered after it.
 *
 * `legal_name` is the identity the payout account was opened with; `email` is
 * where every transactional message about money goes. This is the Creator
 * register's own pair, for the same two reasons.
 */
export const FOUNDER_SETTINGS_GUARDED: readonly {
  id: string;
  label: string;
  column: string;
  consequence: string;
  specRef: string;
}[] = [
  {
    id: 'legal_name',
    label: 'Legal name',
    column: 'legal_name',
    consequence:
      'This is the name your payout account was opened with. Changing it here does not change it at Stripe, and a mismatch can hold up a payment — so we record why rather than just saving it.',
    specRef: '§5.2, §13',
  },
  {
    id: 'email',
    label: 'Email',
    column: 'email',
    consequence:
      'Every message about your campaign goes here, including the ones about money and deadlines. Changing it moves all of them, and it does not change the address you sign in with.',
    specRef: '§5.2, §27.2',
  },
];

export const FOUNDER_SETTINGS_GUARDED_IDS: readonly string[] = FOUNDER_SETTINGS_GUARDED.map(
  (f) => f.id,
);

/** Every id a correction route may accept. Nothing else is a field. */
export const FOUNDER_CORRECTABLE_IDS: readonly string[] = [
  ...FOUNDER_SETTINGS_FIELD_IDS,
  ...FOUNDER_SETTINGS_GUARDED_IDS,
];

/* ── The delete-account request ───────────────────────────────────────────── */

/**
 * §5.2 names it, and **the record already exists**.
 *
 * `founder_deletion_requests` landed in 0040 with the Founders workspace
 * (2026-08-16): the record is of the ASK, there is no `deleted_at`, no purge
 * schedule, and no `approved` state, because §25.8's retention obligations do
 * not end because somebody clicked a button. Its `received_via` column exists
 * precisely because the ask arrives out of band today — an email, a call — and
 * somebody has to write down how it reached us.
 *
 * So Session G adds the Founder's own route onto the SAME record, calling the
 * SAME `recordDeletionRequest` service, with `received_via` set to the constant
 * below. This is Creator Flow Session A's decision, taken for the same reason:
 * a second table would be the duplicate this codebase refuses everywhere else,
 * and on a person's erasure request two copies disagreeing is the worst version
 * of that failure.
 */
export const FOUNDER_DELETION_RECEIVED_VIA = 'Founder settings screen';

/**
 * Pinned, and it rides the control rather than sitting under it.
 *
 * §1.4: the copy must not imply the account is deleted. Somebody who reads
 * "Delete my account" and nothing else will believe their records are gone, and
 * the next tax document they receive will be the correction.
 */
export const FOUNDER_DELETION_IS_RECORDED_NOT_EXECUTED =
  'We record your request and a person reads it. Some records — anything about money, tax, or a campaign that ran — we are required to keep for a set period whatever we do with your account, so nobody can promise to erase everything today.';

/* ── The password ─────────────────────────────────────────────────────────── */

/**
 * The §28.1 review `auth.ts` demands, done, with its conclusion.
 *
 * `POST /api/auth/change-password` is a Better Auth core email/password
 * endpoint, already mounted because `emailAndPassword.enabled` is true. Four
 * things were checked before a surface pointed at it:
 *
 *  1. **It is not an enumeration oracle.** It requires a live session, so the
 *     caller already holds the account. A wrong current password reveals only
 *     that the caller does not know their own — which is not a fact about
 *     anybody else, and is the one case §5.5's non-enumerating rejection is
 *     not about.
 *  2. **It is rate-limited.** `/api/auth` carries §28.1's per-address limit
 *     (`authRouteLimit`), which the app has applied since Phase 04.
 *  3. **It is behind the cross-origin write guard.** `crossOriginWriteGuard`
 *     refuses a state-changing request from an untrusted Origin, and Better
 *     Auth applies its own to `/api/auth/*` besides.
 *  4. **It is not `update-user`.** That endpoint writes `user.name` and
 *     `user.phone`, which no Proovd surface renders — the claim profile is what
 *     every surface reads — so surfacing it would let somebody edit a record
 *     that decides nothing while believing they had corrected the one that
 *     does. It stays unsurfaced, and `delete-user` and `change-email` stay
 *     disabled.
 *
 * Proovd's own route wraps it rather than the browser calling it directly, for
 * two things the library cannot do for us: it always revokes the other
 * sessions, and it writes the §25.6 audit row in the same act.
 */
export const PASSWORD_CHANGE_REVOKES_OTHER_SESSIONS =
  'Changing your password signs you out everywhere else. This browser stays signed in.';

/** What the surface says instead of guessing why a change was refused. */
export const PASSWORD_CHANGE_NEEDS_CURRENT =
  'Enter the password you use now, then the new one. If you have forgotten it, use the reset link instead — it does not need the old one.';

/* ── The pinned sentences ─────────────────────────────────────────────────── */

/**
 * Pinned. Renders on the reason field.
 *
 * Why a settings form asks for a reason at all, which is otherwise the sort of
 * friction somebody removes as a courtesy. §25.6 is the answer, and the Admin
 * path has required exactly this since 2026-08-16 — `editReasonRequired` makes
 * a reason mandatory on a profile field once an account is claimed, and this is
 * the same field on the same row.
 */
export const FOUNDER_SETTINGS_REASON_IS_RECORDED =
  'We keep a record of what changed and why. Your own record and Proovd’s stay in step that way, and anybody looking later — including you — can tell what happened.';

/**
 * Pinned. Renders beside the notification section.
 *
 * §27.2's first rule, on the page most likely to grow a row of opt-out
 * switches. What can be changed is how often the summary arrives; what cannot
 * is a receipt.
 */
export const FOUNDER_TRANSACTIONAL_IS_NOT_OPTIONAL =
  'Messages about money, deadlines, and decisions on your campaign are not optional — those are the ones you would most want. What you can change is how often you get the summary of everything else.';

/**
 * Pinned. Renders above the Stripe block.
 *
 * §13 and §5.2: Proovd holds a status and an account id and never the documents
 * behind them. Saying so is what stops the block reading as a record Proovd
 * could correct if asked.
 */
export const KYC_IS_STRIPES_RECORD =
  'Your identity check is Stripe’s. Proovd sees whether it is done and what is still outstanding — never the documents themselves, and there is nothing here for us to change on your behalf.';

/**
 * Pinned. Renders above the W-9 block.
 *
 * The W-9 is recorded per campaign (`founder_w9_records` is unique on the
 * campaign), and this page is account-level. Naming which campaign it is
 * reporting on is the honest form; a bare "verified" on a page with no campaign
 * on it would be a claim about an unnamed thing.
 */
export const W9_IS_PER_CAMPAIGN =
  'A W-9 belongs to a campaign rather than to your account, so this is the one for your current campaign.';

/* ── What this page is not ────────────────────────────────────────────────── */

export interface FounderSettingsAbsence {
  id: string;
  /** What the reference — or the obvious reading of §5.2 — would have put here. */
  element: string;
  absentBecause: string;
  specRef: string;
}

/**
 * The `OPERATIONS_ABSENCES` arrangement, applied to a settings page.
 *
 * A settings page is where options accumulate, and every one of them would be a
 * rule nobody agreed to (§1 rule 6). These are the ones that were considered
 * and refused; each renders its sentence where the control would have been, so
 * a later session that wants one back has to delete the sentence refusing it.
 */
export const SETTINGS_ABSENCES: readonly FounderSettingsAbsence[] = [
  {
    id: 'per_topic_toggles',
    element: 'A row of switches for which kinds of email you receive',
    absentBecause:
      'There is one notification choice and it is how often the summary arrives. Everything else Proovd sends is about money, a deadline, or a decision on your campaign, and none of that is a preference — a switch that turned off a charge notice would be the one setting nobody should be able to find.',
    specRef: '§27.2, §27.7',
  },
  {
    id: 'account_name_edit',
    element: 'An editable account name separate from your record',
    absentBecause:
      'There is one name and it is the one on your record. A second name stored beside it would be the one no surface renders, so correcting it would feel like a change and do nothing.',
    specRef: '§5.2, §10',
  },
  {
    id: 'sign_in_email_change',
    element: 'Changing the address you sign in with',
    absentBecause:
      'Your contact address and your sign-in address are two different things here, and only the first is yours to move on this page. Changing where you sign in is a support conversation, because getting it wrong locks you out of the account rather than misdirecting a message.',
    specRef: '§5.2, §5.5',
  },
  {
    id: 'delete_executes',
    element: 'A control that deletes the account',
    absentBecause:
      'Nothing here erases anything, and no route in the product does. What exists is a recorded request that a person reads — because the records Proovd is required to keep about money, tax, and a campaign that ran outlive the account either way.',
    specRef: '§25.8',
  },
  {
    id: 'representation_toggles',
    element: 'Editable 18+, US-person, and sanctions confirmations',
    absentBecause:
      'Those are statements you made, not settings. They are shown as what you confirmed and when; changing one is a conversation with support rather than a switch, because a representation somebody can quietly toggle is not a representation.',
    specRef: '§10, §28.4',
  },
  {
    id: 'kyc_documents',
    element: 'Your identity documents, or a control to replace them',
    absentBecause:
      'Proovd never receives them. Stripe collects and holds identity documents directly and reports back a status and a list of anything outstanding, which is all this page has and all it could have.',
    specRef: '§13, §5.2',
  },
  {
    id: 'w9_upload',
    element: 'A W-9 upload box',
    absentBecause:
      'A W-9 goes through a secure route rather than a file field on a settings page, and Proovd records that one was received and verified rather than keeping the form. No screen in the product can take a taxpayer identification number.',
    specRef: '§22.3, §11',
  },
];

export function settingsAbsence(id: string): FounderSettingsAbsence {
  const found = SETTINGS_ABSENCES.find((entry) => entry.id === id);
  if (!found) throw new Error(`No settings absence is registered as “${id}”.`);
  return found;
}

/* ── The address ──────────────────────────────────────────────────────────── */

/**
 * Account-level, like the notification page it absorbs.
 *
 * Every other authenticated Founder address is `:campaignId`-scoped, because
 * everything else a Founder does belongs to one campaign. These eleven belong
 * to the person, and a Founder with two campaigns must not have two of them.
 */
export const FOUNDER_SETTINGS_PATH = '/settings';

/**
 * Which record the page reads when a Founder has more than one campaign.
 *
 * `founder_claim_profiles` is unique per campaign, so a Founder who has run two
 * campaigns has two rows — and an account-level page has to pick one. It picks
 * the most recently created, which is exactly what `loadFounderContext` has
 * done for the Admin workspace since 2026-08-16. The two must agree or an Admin
 * correcting a Founder's phone number and the Founder correcting their own
 * would be editing different rows.
 */
export const SETTINGS_READS_THE_CURRENT_RECORD =
  'These are the details on your current campaign’s record.';
