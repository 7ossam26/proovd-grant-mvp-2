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

/* ── Screen 4: your voice ─────────────────────────────────────────────────── */

/**
 * The reference's heading, kept. Its LEDE is what was refused.
 *
 * *"Pick a tone we should write your scripts in"* promises generation. §30
 * defers AI pitch rewriting and refinement, §12 makes the helper resources
 * "static, copy-ready guidance—not an embedded AI product", and there is no
 * model client anywhere in this tree. `VOICE_IS_NEVER_USED_TO_REWRITE` in
 * `voice.ts` is the pinned sentence that travels with the control; this is the
 * question re-asked so that sentence is not a correction of the line above it.
 */
export const CREATOR_VOICE_HEAD = 'Sound like you.';
export const CREATOR_VOICE_LEDE =
  'How would you describe your own style? Founders read this when they are deciding whether you suit their campaign.';

/** Above the six chips. The reference's own framing, and an accurate one. */
export const CREATOR_VOICE_CHIPS_LABEL = 'A tone you are good at';

/**
 * What the reference says here is *"These are the most popular ones for your
 * niche."*, which is a claim about data nothing holds — no record counts tone
 * choices, and none is grouped by niche. Refused rather than approximated.
 */
export const CREATOR_VOICE_CHIPS_HELP =
  'Pick as many as genuinely fit. You can change this later.';

export const CREATOR_VOICE_CUSTOM_LABEL = 'Add your own';
export const CREATOR_VOICE_FLEXIBLE_LABEL = 'I am flexible with different tones';

/* ── Screen 5: presence ───────────────────────────────────────────────────── */

export const CREATOR_PRESENCE_HEAD = 'Put a face to it.';
export const CREATOR_PRESENCE_LEDE =
  'This is how Founders see you. A photo and a short bio tell them who they would be working with.';

/**
 * Pinned. Renders where the reference draws its photo control.
 *
 * §12's object storage is Track A4 and `unconfiguredStorage` throws rather than
 * pretending, so there is no bucket to put a photo in — no presign route, no
 * file input, and `profile_photo_key` stays unread. §1.4 gives two honest
 * options, hide the control or say what it is; hiding it would make the flow
 * describe a smaller product than the one being built, so the reason renders
 * where the control would be. This is the Affiliate evidence uploader's
 * arrangement (2026-08-17), applied to the Creator's own screen.
 */
export const CREATOR_PHOTO_UNAVAILABLE =
  'Photo uploads are not switched on yet — we have no file storage connected, so there is nowhere for one to go. Your bio and your channel are what a Founder sees in the meantime, and we will ask you for a photo once this opens.';

/**
 * The bio's source label. §11's correction right, on the §8 Admin-written bio.
 *
 * `affiliate_prospects.admin_bio` is what a person at Proovd wrote after
 * researching the channel, and §11 requires both the label saying so and the
 * ability to change it.
 */
export const CREATOR_BIO_PREFILL_NOTE =
  'We drafted this from your public channel. Put it in your own words — what you write is what Founders read.';

/* ── Screen 6: verify ─────────────────────────────────────────────────────── */

export const CREATOR_VERIFY_HEAD = 'Show us the numbers.';

/**
 * The reference's own lede is about uploading screenshots, which is the half
 * that cannot happen yet. What CAN happen is the figures, so the question is
 * the figures and the upload is a named absence below them.
 */
export const CREATOR_VERIFY_LEDE =
  'Tell us how big your audience is. Somebody at Proovd checks this against your channel before a Founder sees it.';

/**
 * Pinned. Renders where the reference draws its upload control.
 *
 * The record already exists — 0048's `affiliate_evidence_files` is keyed on the
 * prospect, so a Creator-supplied row needs no new table — and what is missing
 * is the bucket. Same reason as the photo, said for the thing an Admin will
 * eventually verify against.
 */
export const CREATOR_EVIDENCE_UNAVAILABLE =
  'Screenshot uploads are not switched on yet — we have no file storage connected. If we need to see something, we will ask you for it directly rather than leave you guessing.';

/** True, and worth keeping. The reference's own sentence. */
export const CREATOR_VERIFY_READ_ONLY =
  'We never post, message, or act on your behalf. Nothing here connects to your account.';

/* ── Screen 7: the agreement ──────────────────────────────────────────────── */

/**
 * The re-authored head and lede.
 *
 * The reference draws *"You stay in control. Your pay is guaranteed."* over
 * *"As long as you follow the rules below, your earnings lock in. No
 * clawbacks."* — on the screen where somebody is consenting, which is where an
 * untrue promise costs the most. The first half is true and is kept; the second
 * is not, and `CREATOR_FLOW_ABSENCES` carries the full argument.
 */
export const CREATOR_AGREE_HEAD = 'You stay in control.';
export const CREATOR_AGREE_LEDE =
  'Two things worth knowing before you create the account. Neither is fine print.';

/**
 * §17, §14.2. The reference's first promise, which is true as drawn.
 *
 * Nothing publishes for a Creator: §14.2's acceptance is theirs, §17's post is
 * written and published by them, and Admin verifies what they submitted rather
 * than producing it.
 */
export const CREATOR_AGREE_CONTROL_TITLE = 'You decide what you post';
export const CREATOR_AGREE_CONTROL_BODY =
  'Nothing goes out in your name. You write the post, you publish it, and you choose which campaigns to take at all — turning one down does not count against you.';

/**
 * §22.1, §29.5, §24.8. The re-authored second promise.
 *
 * §29.5 protects VALID FINALIZED commission, and only absent Creator-caused
 * invalidity. §22.1 provides for cancelling unpaid invalid amounts and creating
 * a contractual recovery record on fraud, fake traffic, self-dealing, false
 * claims, invalid proof, or material breach — and 20a's
 * `applyCauseBasedAffiliateAdjustment` exists because that happens.
 *
 * So the guarantee is real and it is narrower than "no clawbacks": what is
 * protected is valid earnings against the campaign going badly, which is the
 * thing a Creator is actually worried about. Saying which is stronger copy than
 * saying neither.
 */
export const CREATOR_AGREE_MONEY_TITLE = 'Valid earnings are not clawed back for performance';
export const CREATOR_AGREE_MONEY_BODY =
  'Once pre-orders you brought in are charged and your commission is finalized, it is not reduced because the campaign did less well than hoped or because a Founder changed their mind. Earnings from invalid activity — fake traffic, self-dealing, or breaking the agreement — can be reversed, and that is a recorded decision with a reason behind it.';

/**
 * Above the five §28.4 controls.
 *
 * The reference bundles four representations into one sentence and one button.
 * §28.4 forbids bundling and requires the 18+ confirmation unchecked, and §11
 * names five things rather than four.
 */
export const CREATOR_AGREE_CONFIRMATIONS_LABEL = 'Five things you are telling us';
export const CREATOR_AGREE_CONFIRMATIONS_HELP =
  'Each one is a separate statement and none of them is ticked for you.';

/**
 * §11's two acceptances, and why there is no third.
 *
 * The reference's single button accepts *"the Terms, Acceptable Use Policy, and
 * IP & NDA Agreement"*. §31.5's IP agreement is PER CAMPAIGN and is due before
 * WORK — it is collected at §14.2 acceptance, on the campaign it belongs to —
 * so taking it here would collect it for a campaign this Creator has not been
 * offered yet. `AFFILIATE_CLAIM_POLICY_SLUGS` has held exactly two since Phase
 * 08b and does not change.
 */
export const CREATOR_AGREE_IP_LATER =
  'The intellectual-property and confidentiality agreement is per campaign, so we ask for it when you accept a campaign rather than now.';

/**
 * §11's five confirmations, as a register.
 *
 * §28.4 forbids bundling, so each is its own unchecked control writing its own
 * column — and a register is what lets a test count the CONTROLS and the
 * COLUMNS and compare the two numbers. Five labels hard-coded in a component
 * can be counted; they cannot be compared to the schema.
 *
 * `column` is the `affiliate_signup_profiles` column each writes, named here so
 * the comparison is against the database rather than against a second list.
 */
export interface CreatorConfirmation {
  /** The `SaveSignupInput` key, which is also the PATCH body key. */
  key: string;
  /** The `affiliate_signup_profiles` column it writes. */
  column: string;
  label: string;
}

export const CREATOR_CONFIRMATIONS: readonly CreatorConfirmation[] = [
  {
    key: 'confirmAge18Plus',
    column: 'confirm_age_18_plus',
    label: 'I am at least 18 years old.',
  },
  {
    key: 'confirmUsBased',
    column: 'confirm_us_based',
    label: 'I am based in the United States.',
  },
  {
    key: 'confirmActualOperator',
    column: 'confirm_actual_operator',
    label:
      'I am the person who actually runs this channel — not an agency or a manager acting for somebody else.',
  },
  {
    key: 'confirmNoDuplicateAccounts',
    column: 'confirm_no_duplicate_accounts',
    label: 'This is my only Proovd account.',
  },
  {
    key: 'confirmSanctionsEligible',
    column: 'confirm_sanctions_eligible',
    label: 'I am not on a sanctions list and I am eligible to be paid under US sanctions rules.',
  },
];

/* ── Screen 8: all set ────────────────────────────────────────────────────── */

export const CREATOR_DONE_HEAD = 'You are in.';

/**
 * §11's waiting state, named (§33.2.3).
 *
 * It lives on this screen and not on the invitation, because
 * `completeAffiliateSignup` claims AND revokes the token — so from the moment
 * the account exists, every `/creator-invitation/:token` address answers the
 * one rejection. A "you are signed up" state at a token address is a state
 * nobody can reach.
 */
export const CREATOR_DONE_ACCOUNT_MADE =
  'Your Proovd account is set up, and you are joined to the one campaign this invitation was for.';

/**
 * What happens if the sign-in after the claim does not go through.
 *
 * The ACCOUNT still exists — the claim is its own transaction and it committed.
 * Saying so is the difference between "try again" and somebody believing they
 * have to start over with a link that no longer works.
 */
export const CREATOR_SIGN_IN_AFTER_CLAIM_FAILED =
  'Your account was created — that part is done and it did not fail. We could not sign you in automatically just now, which is a separate step. Sign in with the email and password you just chose.';

/**
 * §11's waiting state names Proovd as the owner. One sentence, two renderers.
 *
 * It has existed twice since Phase 08b — once in `CreatorSignup` and once in
 * `templates/affiliate-signup-confirmed.tsx` — written independently, with
 * nothing comparing them. The owner of a wait is a promise about who is
 * accountable for ending it, and two copies of that promise is how one of them
 * quietly becomes "the Founder's fault".
 *
 * This is the canonical text. The frontend imports it; the backend restates it
 * for the `rootDir` reason and `creator-flow.test.ts` fails if they disagree.
 */
export const CREATOR_PROOVD_OWNS_THE_WAIT =
  'Proovd owns this step. We are working with the Founder to finish their setup, and we will ' +
  'email you as soon as there is something for you to look at.';

/**
 * Under the date of birth on the agreement screen.
 *
 * The Founder flow's `FLOW_AGE_IS_YOUR_STATEMENT` says the field checks the
 * date adds up to 18 or over "as a courtesy" — which is TRUE there, because
 * `ClaimStep` computes it. Nothing on the Creator's agreement screen does, so
 * reusing that sentence with the component would have been a claim about
 * behaviour this screen does not have (§1.4). Found by the browser pass.
 *
 * What is true here is the half that matters either way: §11 records what
 * somebody states, and the confirmation below is the statement.
 */
export const CREATOR_AGE_IS_YOUR_STATEMENT =
  'We do not work out your age from this and we do not verify it. What stands on your record is your own confirmation below.';
