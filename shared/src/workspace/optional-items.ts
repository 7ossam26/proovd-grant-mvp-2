/**
 * The five §12 optional items — Spec §12 (Phase 6), §33.3.1.
 *
 * Same shape as the policy register and the §6 settings register, and for the
 * same reason: one declaration, mirrored by a backend enum and drift-tested, so
 * the surface, the fee calculation, and the evidence engine cannot disagree
 * about what the five items *are*.
 *
 * ── This register describes. It does not decide ─────────────────────────────
 * Nothing here evaluates completion. §12's completion rules are objective
 * checks against uploaded bytes, fetched URLs, and a booking status, and every
 * one of them has to run on the server — a browser cannot prove a file is not a
 * 1×1 placeholder, and a rule that ran only in the browser would be a rule the
 * Founder could turn off. `backend/src/workspace/evidence.ts` is the engine;
 * this file is the vocabulary it and the surface share.
 *
 * The backend cannot import this module at runtime (`@proovd/shared` exports
 * TypeScript source and the production image ships only `backend/dist`), so it
 * restates the five keys and the rejection reasons as its own literals and
 * `backend/src/tests/campaign-workspace.test.ts` fails the suite if they drift.
 * That is the same arrangement as the state enums, the policy slugs, and the
 * setting bounds.
 *
 * ── Why the copy lives beside the key ───────────────────────────────────────
 * §12's completion rules are what the Founder is being asked to satisfy, so the
 * sentence describing each one is part of the product, not a comment. Keeping
 * it here means the workspace step, the Admin evidence panel, and the fee
 * preview all say the same thing about what "complete" means for an item —
 * three surfaces, one sentence.
 */

/** The five items, in §12's order. Also the order of the workspace flow. */
export const OPTIONAL_ITEM_KEYS = [
  'visuals',
  'branding',
  'interview',
  'story',
  'socials',
] as const;

export type OptionalItemKey = (typeof OPTIONAL_ITEM_KEYS)[number];

export interface OptionalItemRecord {
  key: OptionalItemKey;
  /** Customer-facing (§3). Never an internal word. */
  label: string;
  /** What the Founder is deciding at this step — the One-Question Rule (DNA §5.1). */
  question: string;
  /** §12's completion rule, in the Founder's words. Shown before they start. */
  completesWhen: string;
  /**
   * Why it is worth doing, stated without pressure.
   *
   * Every item is worth the same US$2 (§6), so the saving is stated as a fact
   * and never as a countdown, a streak, or a "only N left" (DNA §5.10, §30).
   */
  why: string;
  /** §12's own words for what does *not* count. §33.3.1 tests each of these. */
  doesNotCount: readonly string[];
  specRef: string;
}

export const OPTIONAL_ITEMS: readonly OptionalItemRecord[] = [
  {
    key: 'visuals',
    label: 'Visuals',
    question: 'Do you have a photo or video of what you are making?',
    completesWhen:
      'At least one real campaign visual or video is uploaded, opens for us, and you have approved it for use on your campaign.',
    why: 'Backers decide with their eyes first. It also takes US$2 off your listing fee.',
    doesNotCount: [
      'An empty or zero-byte file.',
      'A placeholder — a single-colour block, a tiny image, or a stock "image coming soon".',
      'The same file uploaded twice.',
      'A file we cannot open when we check it.',
      'A file you have uploaded but not approved for campaign use.',
    ],
    specRef: '§12 · Objective completion rules · Visuals',
  },
  {
    key: 'branding',
    label: 'Branding',
    question: 'Do you have a logo and campaign colours?',
    completesWhen:
      'A usable logo or wordmark is uploaded and approved for campaign use, and your campaign colours are saved.',
    why: 'A campaign that looks like itself reads as real. It also takes US$2 off your listing fee.',
    doesNotCount: [
      'A logo with no campaign colours saved beside it.',
      'An empty or placeholder logo file.',
      'A logo you have uploaded but not approved for campaign use.',
    ],
    specRef: '§12 · Objective completion rules · Branding',
  },
  {
    key: 'interview',
    label: 'Founder interview',
    question: 'Would you like to talk to someone at Proovd?',
    completesWhen: 'You save a platform and time for your Founder interview.',
    why: 'It is a real conversation with a person here. It also takes US$2 off your listing fee.',
    doesNotCount: [
      'A time that was not saved.',
      'A booking you started and left.',
      'A booking that was canceled.',
    ],
    specRef: '§12 · Objective completion rules · Interview',
  },
  {
    key: 'story',
    label: 'Story',
    question: 'Is your campaign story written and ready to be public?',
    completesWhen: 'Your campaign story is written and saved.',
    why: 'It is the part Backers read before they decide. It also takes US$2 off your listing fee.',
    doesNotCount: [
      'Answers to the prompts, on their own.',
      'A transcript of a conversation.',
      'A summary of a conversation.',
      'An empty story.',
    ],
    specRef: '§12 · Objective completion rules · Story',
  },
  {
    key: 'socials',
    label: 'Socials',
    question: 'Where can people find you or the product?',
    completesWhen: 'At least one valid public profile you control is saved.',
    why: 'It is how a Backer checks you are real. It also takes US$2 off your listing fee.',
    doesNotCount: [
      'Text that is not a valid web address.',
      'A private or restricted profile.',
      'A profile you do not control.',
    ],
    specRef: '§12 · Objective completion rules · Socials',
  },
] as const;

export function optionalItem(key: OptionalItemKey): OptionalItemRecord {
  const found = OPTIONAL_ITEMS.find((i) => i.key === key);
  if (!found) throw new Error(`unknown optional item: ${key}`);
  return found;
}

/* ── Why an item is not complete ──────────────────────────────────────────── */

/**
 * The rejection vocabulary — one code per way §12 says an item does not count.
 *
 * Codes rather than sentences because the backend decides and the frontend
 * renders: a server that returned prose would be a server writing the surface's
 * copy, and a surface that inferred the reason from prose would break the first
 * time the wording improved. §33.3.1 asserts against these codes.
 *
 * Every code below is traceable to a clause of §12. There is deliberately no
 * generic `invalid`: a reason the Founder cannot act on is the §27.1 failure.
 */
export const EVIDENCE_REJECTIONS = {
  /* Uploads — §12 "Empty files, placeholders, duplicate uploads" */
  file_empty: 'The file is empty.',
  file_placeholder: 'The file looks like a placeholder rather than a real visual.',
  file_duplicate: 'That exact file is already attached to this campaign.',
  file_unreadable: 'We could not open the file when we checked it.',
  file_type_unsupported: 'That kind of file cannot be used on a campaign page.',
  file_too_large: 'The file is larger than a campaign page can carry.',

  /* Links — §12 "inaccessible URLs" */
  url_malformed: 'That is not a web address we can open.',
  url_unreachable: 'That address did not open when we checked it.',
  url_not_public: 'That address is private or asks for a sign-in.',

  /* Approval — §12 "unapproved drafts", "Founder-approved" */
  not_approved: 'You have not approved this for campaign use yet.',

  /* Missing content */
  nothing_supplied: 'Nothing has been added for this yet.',
  direction_incomplete: 'Campaign colours have not been saved yet.',
  logo_missing: 'A logo or wordmark has not been uploaded.',

  /* Interview — §12 "unconfirmed appointments" */
  booking_unconfirmed: 'The booking is not confirmed.',
  booking_canceled: 'The booking was canceled.',
  booking_absent: 'No interview is booked.',

  /* Admin — §12 "Admin may invalidate an item before payment with a reason" */
  invalidated: 'Proovd set this back for a reason we have written down.',
} as const;

export type EvidenceRejection = keyof typeof EVIDENCE_REJECTIONS;

export const EVIDENCE_REJECTION_CODES = Object.keys(EVIDENCE_REJECTIONS) as EvidenceRejection[];

/**
 * §12's decision source, stored with every completion.
 *
 * "Each item stores evidence, completion timestamp, and decision source." The
 * three sources are genuinely different claims: the Founder approved it, a
 * provider told us, or an Admin decided. Collapsing them would make an override
 * indistinguishable from the Founder's own act, and §12 requires an override to
 * be recorded as an override.
 */
export const DECISION_SOURCES = ['founder_approval', 'provider_event', 'admin_override'] as const;
export type DecisionSource = (typeof DECISION_SOURCES)[number];
