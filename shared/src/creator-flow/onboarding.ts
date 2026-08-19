/**
 * The onboarding screens' pinned copy — Creator Flow v2, Session B, 2026-08-19.
 *
 * Sentences that are load-bearing rather than decorative: each one is here
 * because getting it wrong would state something the product does not do. A
 * surface may lay them out; it may not reword them, and the tests compare the
 * rendered output against these constants rather than against a paraphrase.
 *
 * What is NOT here is ordinary screen copy — a field label, a placeholder, a
 * heading. Pinning those would freeze the design for no gain and would make
 * every wording change a shared-package edit.
 */

/* ── Screen 0, the invitation ─────────────────────────────────────────────── */

/**
 * The reference's splash promise, re-authored.
 *
 * It reads *"We bring you products people actually want, and pay you every time
 * they bite"* — which describes a payment per click on the first screen a
 * Creator ever sees. §22.1 pays a percentage of the CAPTURED, validly
 * attributed, pre-tax subtotal, after §17's first post is verified and after
 * Admin finalizes the earnings; §18 decides attribution at the click and marks
 * it provisional until that verification. A visit that never becomes a charge
 * pays nothing, and so does an attributed charge on an unverified post.
 *
 * The beat survives — this is still the one sentence under the headline — and
 * the promise becomes the one the product keeps.
 */
export const CREATOR_INVITE_PROMISE =
  'We bring you products people actually want. When someone you sent pre-orders and their card is charged, you earn a share of it.';

/**
 * What the reference's splash never says, and §8's invitation already promises.
 *
 * §8 requires the invitation email to state that declining later does not harm
 * standing, and `DECLINE_NOTICE` has carried that sentence since Phase 08a. The
 * landing page is where somebody actually decides whether to open the thing, so
 * it says the same. Deliberately not a second wording — see `affiliates/`.
 */
export const CREATOR_INVITE_NO_OBLIGATION =
  'Creating your account does not commit you to this campaign. You see the full terms first, and turning it down later does not count against you.';

/* ── Screen 1, the password ───────────────────────────────────────────────── */

/**
 * The requirement list, and the reason it has exactly one entry.
 *
 * The reference draws four live checks — eight characters, an upper, a lower, a
 * special — and `completeAffiliateSignup` enforces exactly one thing: **twelve
 * characters**. Shipping the reference's list would tick all four for an
 * eight-character password and then be refused by the server, which is §1.1's
 * failure with a green tick on it.
 *
 * So the list is what the server enforces, and the server was not changed to
 * match the list. Three reasons, in order: the Founder and the Admin have no
 * composition rule either, and a per-role password policy is a difference
 * nobody asked for; Session F's password change goes through Better Auth's own
 * route, which would start refusing passwords that already exist; and length
 * beats composition on the evidence. A checklist where three of four ticks
 * decide nothing teaches people that ticks are decorative.
 */
export const CREATOR_PASSWORD_MIN_LENGTH = 12;

export interface CreatorPasswordRequirement {
  id: string;
  label: string;
  met: (value: string) => boolean;
}

export const CREATOR_PASSWORD_REQUIREMENTS: readonly CreatorPasswordRequirement[] = [
  {
    id: 'length',
    label: `At least ${CREATOR_PASSWORD_MIN_LENGTH} characters`,
    met: (value) => value.length >= CREATOR_PASSWORD_MIN_LENGTH,
  },
];

export function creatorPasswordMeetsRequirements(value: string): boolean {
  return CREATOR_PASSWORD_REQUIREMENTS.every((r) => r.met(value));
}

/** The reference's own line, and it is true — Better Auth hashes at the claim. */
export const CREATOR_PASSWORD_NEVER_PLAIN =
  'We never store it in plain text.';

/**
 * Why the password is gone after a reload, said on the screen that asks again.
 *
 * It is held in memory for the length of the walk and written nowhere — not
 * `sessionStorage`, not `localStorage`, and not to the server, because there is
 * no account to attach it to until the claim. A reload therefore loses it while
 * losing nothing else: every profile answer is saved as it is typed. Session
 * C's Agree screen asks again rather than bouncing somebody backwards, so
 * position survives the interruption even though the credential does not.
 */
export const CREATOR_PASSWORD_NOT_KEPT =
  'Your password is only held while you are on these pages. If you reload we will ask for it again at the end — everything else you have entered is already saved.';

/* ── Screen 2, you ────────────────────────────────────────────────────────── */

/** §11's source label, and the reference wrote it well. */
export const CREATOR_PROFILE_PREFILL_NOTE =
  'We filled this in from what we already knew. Change anything that is wrong.';

/**
 * The email is editable, and the reference renders it `Locked`.
 *
 * §11 gives a Creator the right to correct prefilled public information, the
 * column carries a full supplier triple, and `saveSignupProfile` has accepted
 * the key since Phase 08b. Locking it would be the product declining a right
 * the Spec grants — and it is the address every transactional message goes to,
 * so getting it wrong is the most expensive field on the screen to leave wrong.
 */
export const CREATOR_EMAIL_IS_WHERE_WE_WRITE =
  'This is where we send everything about your campaigns and your money.';

/**
 * §5.3 and §33.1.8: a phone number is collected and never verified.
 *
 * `user.phone_verified` is CHECK-pinned false, there is no SMS path anywhere in
 * the product, and a suite scans the tree to keep it that way. A field that
 * quietly implied verification would be the first step toward one.
 */
export const CREATOR_PHONE_NOT_VERIFIED =
  'For support only. We do not text you and we do not verify this number.';

/* ── Screen 3, the channel ────────────────────────────────────────────────── */

/** The reference's own heading, and it is accurate: this is §11's public card. */
export const CREATOR_CHANNEL_IS_THE_PUBLIC_CARD =
  'This is what a Founder sees when they consider working with you.';

/**
 * The reference's `You can edit all of this later under Profile.`
 *
 * True only once Session F ships Settings — and §5.3 licenses that right today
 * while the product has no route for it, which is the gap the last session
 * closes. Until then the honest sentence is that a correction goes through a
 * person, which is what `requestAffiliateCorrection` has been emailing Creators
 * about since 2026-08-17.
 *
 * **Session F replaces this with the reference's own line.** It is a constant
 * so that replacement is one edit rather than a search.
 */
export const CREATOR_CHANNEL_CORRECTIONS_TODAY =
  'If any of this changes, tell us and we will update it for you.';
