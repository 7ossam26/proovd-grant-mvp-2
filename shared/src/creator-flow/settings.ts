/**
 * The Creator's own settings — Creator Flow v2, Session A, 2026-08-19.
 *
 * ═══ THIS IS NOT A DEVIATION. IT IS §5.3 AS WRITTEN. ════════════════════════
 *
 * §5.3 lists, verbatim: *"Affiliate settings: name, email, phone, password,
 * channel type/handles, audience metrics, niche, bio,
 * connected-account/transfer/tax/payout status, notification preferences, and
 * delete-account request."*
 *
 * **None of it is editable after the claim today**, and that is a real gap
 * rather than a design decision. `affiliate_signup_profiles` has exactly three
 * writers: `saveSignupProfile`, which hard-refuses once `claimed_at` is set;
 * the claim itself; and Admin's `correctAffiliateAccountField`. No
 * session-authenticated Creator route writes the table at all.
 *
 * The gap has a visible consequence. `requestAffiliateCorrection` (Affiliate
 * workspace, Session B, 2026-08-17) emails a Creator the
 * `affiliate_correction_request` key — its own parameter doc reads *"the field
 * the Affiliate should review"* — **asking them to correct something they have
 * no route to correct.**
 *
 * ── It inherits the Admin correction path's discipline exactly ─────────────
 * Not a relaxation of `saveSignupProfile`'s refusal — a different route with
 * its own rules, because the two are different acts. Pre-claim, a keystroke is
 * a draft. Post-claim, it rewrites the record a Founder reads and the address
 * every transactional message goes to:
 *
 *   * a **reason** is required;
 *   * the **prior value is read from the row `FOR UPDATE` inside the
 *     transaction that changes it** (§33.12.4 — a caller that supplies both
 *     halves can supply a flattering pair);
 *   * an **audit row in the same transaction**, because this table has no
 *     history table and `date_of_birth`, `country`, `state_region` and the five
 *     confirmations have no provenance columns at all;
 *   * the supplier triple is recomputed on the prefillable fields, so §11's
 *     source label stays true after a Creator edits their own record.
 *
 * ── Two fields are not freely rewritable ──────────────────────────────────
 * `legal_name` is the identity Stripe was given, and `email` is where every
 * transactional message goes. Both take the same shape as the Admin path rather
 * than a free edit — see `CREATOR_SETTINGS_GUARDED`.
 */

/**
 * A field a Creator may change about themselves after the claim.
 *
 * `column` is the real column, named rather than free text — 16a's
 * overridable-field reasoning: a route accepting any string would happily
 * record a correction of something that does not exist, and the audit trail
 * would look complete while pointing at nothing.
 */
export interface CreatorSettingsField {
  id: string;
  label: string;
  column: string;
  /** Whether §11's prefill triple is recomputed when this changes. */
  prefillable: boolean;
  specRef: string;
  help?: string;
}

/**
 * §5.3's list, as columns that exist.
 *
 * Deliberately NOT here, each with its reason:
 *   * **the channel subtype** — Admin's §5.3 classification, and the evidence
 *     on file was recorded against it. `CHANNEL_TYPE_IS_ADMIN_CLASSIFICATION`
 *     is what renders instead. §5.3 lists "channel type/handles" and the
 *     handle is what a Creator owns.
 *   * **the five confirmations** — §11 representations made at the claim. A
 *     representation somebody can quietly toggle later is not a representation;
 *     a change there is a support conversation, not a form field.
 *   * **the payout status columns** — Stripe's, read-only, §13 and §5.3.
 *   * **`date_of_birth`, `country`, `state_region`** — collected once at the
 *     claim as part of the §11 representations, and changing them changes what
 *     was represented.
 */
export const CREATOR_SETTINGS_FIELDS: readonly CreatorSettingsField[] = [
  {
    id: 'public_handle',
    label: 'Public handle',
    column: 'public_handle',
    prefillable: true,
    specRef: '§5.3, §11',
    help: 'What Founders see. One handle, and it is the one on your public card.',
  },
  {
    id: 'phone',
    label: 'Phone',
    column: 'phone',
    prefillable: true,
    specRef: '§5.3',
    help: 'Collected, never verified. Proovd sends no SMS.',
  },
  {
    id: 'channel_reference',
    label: 'Channel link or handle',
    column: 'channel_reference',
    prefillable: true,
    specRef: '§5.3, §11',
  },
  {
    id: 'audience_niche',
    label: 'Audience niche',
    column: 'audience_niche',
    prefillable: true,
    specRef: '§5.3, §11',
  },
  {
    id: 'audience_size',
    label: 'Audience size',
    column: 'audience_size',
    prefillable: true,
    specRef: '§5.3, §11',
  },
  {
    id: 'bio',
    label: 'Bio',
    column: 'bio',
    prefillable: true,
    specRef: '§5.3, §11',
    help: 'How you are described to a Founder. We wrote the first version; it is yours now.',
  },
  {
    id: 'niche_description',
    label: 'What you cover',
    column: 'niche_description',
    prefillable: false,
    specRef: '§5.3',
  },
  {
    id: 'outreach_plan',
    label: 'How you reach your network',
    column: 'outreach_plan',
    prefillable: false,
    specRef: '§5.3',
  },
];

export type CreatorSettingsFieldId = (typeof CREATOR_SETTINGS_FIELDS)[number]['id'];

export const CREATOR_SETTINGS_FIELD_IDS: readonly string[] = CREATOR_SETTINGS_FIELDS.map(
  (f) => f.id,
);

export function creatorSettingsField(id: string): CreatorSettingsField | undefined {
  return CREATOR_SETTINGS_FIELDS.find((f) => f.id === id);
}

/**
 * The two that are not free edits, and what happens instead.
 *
 * Neither is refused — §5.3 names both — but neither is a text box that saves
 * on blur either. They take the Admin correction path's shape: a stated reason,
 * a recorded prior value, and an audit row, plus the consequence spelled out
 * before the change rather than discovered after it.
 */
export const CREATOR_SETTINGS_GUARDED: readonly {
  id: string;
  column: string;
  consequence: string;
  specRef: string;
}[] = [
  {
    id: 'legal_name',
    column: 'legal_name',
    consequence:
      'This is the name your payout account was opened with. Changing it here does not change it at Stripe, and a mismatch can hold up a transfer — so we check it rather than just saving it.',
    specRef: '§5.3, §13, §11',
  },
  {
    id: 'email',
    column: 'email',
    consequence:
      'Every message about your campaigns goes here, including the ones about money. Changing it moves all of them.',
    specRef: '§5.3, §27.2',
  },
];

export const CREATOR_SETTINGS_GUARDED_IDS: readonly string[] = CREATOR_SETTINGS_GUARDED.map(
  (f) => f.id,
);

/* ── The delete-account request ───────────────────────────────────────────── */

/**
 * §5.3 names it, and **the record already exists**. The gap is a route.
 *
 * Session A drafted a table for this and then found 0044's
 * `affiliate_deletion_requests` — already the right shape, already carrying the
 * `founder_deletion_requests` discipline: the record is of the ASK, there is no
 * `deleted_at`, no purge schedule, and no `approved` state, and the one review
 * outcome the product offers is "acknowledged, still under review", because
 * §25.8's retention obligations do not end because somebody clicked a button.
 *
 * What is missing is that only an Admin can file one:
 * `recordAffiliateDeletionRequest` sits on `/api/admin/creators/:id/
 * deletion-request`, and its `received_via` column exists precisely because the
 * ask arrives out of band today and somebody has to write down how it reached
 * us. Session F adds the Creator's own route onto the SAME record.
 *
 * A second table would have been the duplicate this codebase refuses
 * everywhere else — and on a person's erasure request, two copies disagreeing
 * is the worst version of that failure.
 */

/**
 * What Session F's route writes into 0044's `received_via`.
 *
 * A constant rather than a typed sentence, so every Creator-filed request is
 * distinguishable from one an Admin transcribed off a call — which is the whole
 * point of that column.
 */
export const CREATOR_DELETION_RECEIVED_VIA = 'Creator settings screen';

export const CREATOR_DELETION_IS_RECORDED_NOT_EXECUTED =
  'We record your request and a person reads it. Some records — anything about money, tax, or a campaign you promoted — we are required to keep for a set period whatever we do with your account, so nobody can promise to erase everything today.';

/* ── The pinned sentences ─────────────────────────────────────────────────── */

/**
 * Pinned. Renders at the top of the profile section.
 *
 * The reference's own line, kept because it is accurate and is the best short
 * statement of §11's public card in the product.
 */
export const SETTINGS_IS_WHAT_FOUNDERS_SEE =
  'This is exactly what Founders see when we match you to a campaign.';

/**
 * Pinned. Renders on the reason field.
 *
 * Why a settings form asks for a reason at all, which is otherwise the sort of
 * friction somebody removes as a courtesy. §25.6 is the answer, and this record
 * has no history table of its own to fall back on.
 */
export const SETTINGS_REASON_IS_RECORDED =
  'We keep a record of what changed and why. Your profile has no version history of its own, so this note is how anybody — including you — can tell later what happened.';

/**
 * Pinned. Renders beside the notification section.
 *
 * §27.2's first rule, on the surface the reference put three opt-out switches
 * on. The digest control that DOES exist is rendered here; what is refused is
 * switching off a receipt.
 */
export const SETTINGS_TRANSACTIONAL_IS_NOT_OPTIONAL =
  'Messages about money, deadlines, and decisions on your campaigns are not optional — those are the ones you would most want. What you can change is how often you get the summary of everything else.';
