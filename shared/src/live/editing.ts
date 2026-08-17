/**
 * Live editing and the §18 comment thread — Spec §20, §15, §18 (Phase 17b).
 *
 * ── §20's three columns, as a register ──────────────────────────────────────
 * §20 gives live editing three tiers: directly allowed with version history,
 * requires Admin review plus affected-Creator reacceptance, and cannot be
 * changed directly at all. A list in prose is a list nobody can test, so it is a
 * register — the backend restates it and drift-tests, the save path looks each
 * field up rather than branching on a name, and §33.6.12 asserts against the
 * register rather than against a screenshot.
 *
 * ── The Founder never classifies their own edit ─────────────────────────────
 * §15 makes materiality "an Admin judgement recorded with its reason", and 12b's
 * `recordMaterialChange` was built to take a classification rather than guess
 * one. So the tier is a property of the **field**, not of the Founder's opinion
 * about the edit: a `requires_review` field has no direct write path while live,
 * whatever anybody calls the change. That is what makes §33.6.12's second half —
 * "material edits cannot publish directly" — a structural fact rather than a
 * promise about behaviour.
 *
 * ── The third column is enforced by absence ─────────────────────────────────
 * `never_direct` fields have no write route anywhere, and most already have a
 * database guarantee behind them: the campaign type is pinned by the §9 trigger,
 * accepted compensation by the §14.2 immutability trigger, and a reservation's
 * snapshot of the reward it bought is written once at pre-order. The register
 * names them so the absence is checkable; it does not create the enforcement.
 *
 * ── The FAQ loophole ────────────────────────────────────────────────────────
 * §20: "An FAQ cannot silently change a promise locked elsewhere… a Founder
 * editing 'when will I get it?' in the FAQ must not effectively move a delivery
 * date." An FAQ is a `direct_versioned` field, so without this an FAQ answer
 * would be the one unreviewed path to every promise in the second column.
 * `commitmentsIn` finds commitment-shaped statements and the edit routes to
 * review instead of publishing — §20's own destination for a change to a
 * promise, not a new refusal invented here.
 *
 * ── §20 names the FAQ by EXAMPLE, so the check is not scoped to the FAQ ─────
 * The rebuilt campaign page (2026-08-18) added ten more column-one free-text
 * fields — five section headings, three demo-moment labels, a benefit card's
 * footer word — and a section heading is the same loophole with a different
 * name. So the check runs on every column-one field that renders as prose, and
 * `COMMITMENT_CHECK_EXEMPT` names the ones it does NOT run on, each with the
 * reason it structurally cannot carry a promise. Exempting by register rather
 * than by an `if` is what keeps the next field somebody adds inside the check
 * by default.
 */

import { LiveRuleError } from './index.js';

/* ── §20's three tiers ─────────────────────────────────────────────────────── */

export const EDIT_TIERS = ['direct_versioned', 'requires_review', 'never_direct'] as const;
export type EditTier = (typeof EDIT_TIERS)[number];

export interface EditableFieldDefinition {
  /** The stored column or record this names. */
  field: string;
  tier: EditTier;
  /** Customer-facing (§3.1). What the Founder calls it. */
  label: string;
  /** Where it lives, so the register can name a field outside `campaign_build`. */
  surface:
    | 'build'
    | 'faq'
    | 'reward_package'
    | 'reservation'
    | 'agreement'
    | 'campaign'
    | 'demo_moment'
    | 'benefit_card';
  /** Why it sits in this tier, in words a Founder reads on the refusal. */
  reason: string;
  specRef: string;
}

/**
 * Every field a live campaign exposes, and which of §20's three columns it is in.
 *
 * A field absent from this register has **no** live write path: `tierFor` throws
 * rather than defaulting, because a default of `direct_versioned` would silently
 * open the next column-two field somebody adds, and a default of `never_direct`
 * would break a legitimate edit with no explanation. Neither failure should be
 * quiet.
 */
export const EDITABLE_FIELDS: readonly EditableFieldDefinition[] = [
  /* ── Column 1: directly allowed, with version history ────────────────────── */
  {
    field: 'communityUrl',
    tier: 'direct_versioned',
    label: 'Community link',
    surface: 'build',
    reason: '§20 allows the community link to be changed directly while live.',
    specRef: '§20 live editing, column 1',
  },
  {
    field: 'brandPerception',
    tier: 'direct_versioned',
    label: 'How you want the brand perceived',
    surface: 'build',
    reason:
      '§20 allows brand notes that do not alter approved claims to be changed directly. Approved claims live in the story and the required wording, which are reviewed.',
    specRef: '§20 live editing, column 1',
  },
  {
    field: 'brandVoice',
    tier: 'direct_versioned',
    label: 'Brand voice',
    surface: 'build',
    reason: '§20 allows brand notes that do not alter approved claims.',
    specRef: '§20 live editing, column 1',
  },
  {
    field: 'heroPreference',
    tier: 'direct_versioned',
    label: 'Hero preference',
    surface: 'build',
    reason: 'A presentation preference. It states no claim, price, date, or promise.',
    specRef: '§20 live editing, column 1',
  },
  {
    field: 'founderProfileUrl',
    tier: 'direct_versioned',
    label: 'Your profile link',
    surface: 'build',
    reason: 'A link to you. It states no claim about the product.',
    specRef: '§20 live editing, column 1',
  },
  {
    field: 'question',
    tier: 'direct_versioned',
    label: 'FAQ question',
    surface: 'faq',
    reason: '§20 allows a non-material FAQ clarification directly.',
    specRef: '§20 live editing, column 1',
  },
  {
    field: 'answer',
    tier: 'direct_versioned',
    label: 'FAQ answer',
    surface: 'faq',
    reason:
      '§20 allows a non-material FAQ clarification directly — but an FAQ cannot silently change a promise locked elsewhere, so an answer that states a date, a price, or a refund term goes to review.',
    specRef: '§20 live editing, column 1',
  },
  {
    field: 'demoContextLabel',
    tier: 'direct_versioned',
    label: 'Demo context label',
    surface: 'build',
    reason: 'A label above the demo. It names what follows and states no claim.',
    specRef: '§20 live editing, column 1',
  },
  {
    field: 'benefitsHeading',
    tier: 'direct_versioned',
    label: 'Benefits heading',
    surface: 'build',
    reason: 'A section heading. It names what is below it and states no claim of its own.',
    specRef: '§20 live editing, column 1',
  },
  {
    field: 'rewardsHeading',
    tier: 'direct_versioned',
    label: 'Rewards heading',
    surface: 'build',
    reason: 'A section heading. The rewards themselves are reviewed; the words above them are not.',
    specRef: '§20 live editing, column 1',
  },
  {
    field: 'updatesHeading',
    tier: 'direct_versioned',
    label: 'Updates heading',
    surface: 'build',
    reason: 'A section heading. It names what is below it and states no claim of its own.',
    specRef: '§20 live editing, column 1',
  },
  {
    field: 'faqHeading',
    tier: 'direct_versioned',
    label: 'FAQ heading',
    surface: 'build',
    reason: 'A section heading. It names what is below it and states no claim of its own.',
    specRef: '§20 live editing, column 1',
  },
  {
    field: 'timeLabel',
    tier: 'direct_versioned',
    label: 'Demo moment time',
    surface: 'demo_moment',
    reason: 'A clock face inside a picture of your product. It promises nothing.',
    specRef: '§20 live editing, column 1',
  },
  {
    field: 'momentLabel',
    tier: 'direct_versioned',
    label: 'Demo moment name',
    surface: 'demo_moment',
    reason: 'A label on one moment of the demo. It states no claim about the product.',
    specRef: '§20 live editing, column 1',
  },
  {
    field: 'stateWord',
    tier: 'direct_versioned',
    label: 'Demo moment state',
    surface: 'demo_moment',
    reason: 'One word describing the state the demo is showing. It states no claim.',
    specRef: '§20 live editing, column 1',
  },
  {
    field: 'footerWord',
    tier: 'direct_versioned',
    label: 'Benefit card footer word',
    surface: 'benefit_card',
    reason: 'One word under a benefit card, restating its own title.',
    specRef: '§20 live editing, column 1',
  },
  {
    field: 'visualVariant',
    tier: 'direct_versioned',
    label: 'Benefit card shape',
    surface: 'benefit_card',
    reason:
      'Which of three shapes the card draws. It carries no text at all, so it cannot carry a promise.',
    specRef: '§20 live editing, column 1',
  },

  /* ── Column 2: Admin review + affected-Creator reacceptance ──────────────── */
  {
    field: 'publicStory',
    tier: 'requires_review',
    label: 'Your public story',
    surface: 'build',
    reason: '§20 puts claims behind review, and the story is where claims live.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'requiredWording',
    tier: 'requires_review',
    label: 'Required wording',
    surface: 'build',
    reason:
      '§20 puts Creator channel rules behind review — Creators accepted these terms and must accept a change to them.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'prohibitedClaims',
    tier: 'requires_review',
    label: 'Prohibited claims',
    surface: 'build',
    reason: '§20 puts Creator channel rules behind review.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'opensAt',
    tier: 'requires_review',
    label: 'Open date',
    surface: 'build',
    reason: '§20 puts campaign dates and duration behind review.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'closesAt',
    tier: 'requires_review',
    label: 'Close date',
    surface: 'build',
    reason:
      '§20 puts campaign dates and duration behind review. Backers agreed to a charge rule that names this date.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'deliveryWindow',
    tier: 'requires_review',
    label: 'Delivery window',
    surface: 'build',
    reason: '§20 puts delivery promises behind review.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'earlyProductDisclaimer',
    tier: 'requires_review',
    label: 'Early-product disclaimer',
    surface: 'build',
    reason: '§20 puts delivery promises and claims behind review.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'risksAndChallenges',
    tier: 'requires_review',
    label: 'Risks and challenges',
    surface: 'build',
    reason: '§20 puts claims behind review.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'refundPolicyText',
    tier: 'requires_review',
    label: 'Refund policy',
    surface: 'build',
    reason: '§20 puts refund terms behind review.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'refundPolicyTitle',
    tier: 'requires_review',
    label: 'Refund policy title',
    surface: 'build',
    reason: '§20 puts refund terms behind review.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'refundPolicySourceUrl',
    tier: 'requires_review',
    label: 'Refund policy source',
    surface: 'build',
    reason: '§20 puts refund terms behind review.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'refundPolicyVersion',
    tier: 'requires_review',
    label: 'Refund policy version',
    surface: 'build',
    reason: '§20 puts refund terms behind review.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'refundPolicyEffectiveDate',
    tier: 'requires_review',
    label: 'Refund policy effective date',
    surface: 'build',
    reason: '§20 puts refund terms behind review.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'title',
    tier: 'requires_review',
    label: 'Campaign title',
    surface: 'build',
    reason: 'The title is the campaign a Backer agreed to and a Creator promoted.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'priceCents',
    tier: 'requires_review',
    label: 'Reward price',
    surface: 'reward_package',
    reason: '§20 puts rewards and prices behind review.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'contents',
    tier: 'requires_review',
    label: 'What the reward contains',
    surface: 'reward_package',
    reason: '§20 puts rewards behind review.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'fulfillmentCommitment',
    tier: 'requires_review',
    label: 'Fulfillment commitment',
    surface: 'reward_package',
    reason: '§20 puts delivery promises behind review.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'delivery',
    tier: 'requires_review',
    label: 'Reward delivery date',
    surface: 'reward_package',
    reason: '§20 puts delivery promises behind review.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'badge',
    tier: 'requires_review',
    label: 'Reward badge',
    surface: 'reward_package',
    reason:
      '§20 puts rewards and prices behind review. A badge sits beside a price, which is exactly where "Best value" stops being decoration.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'heroHeadline',
    tier: 'requires_review',
    label: 'Hero headline',
    surface: 'build',
    reason:
      '§20 puts claims behind review. This is the largest type on the page and the first thing anybody reads, which is exactly where a claim lives.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'heroHeadlineAccent',
    tier: 'requires_review',
    label: 'Hero headline, second line',
    surface: 'build',
    reason: '§20 puts claims behind review, and this is the emphasised half of the headline.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'heroSubheadline',
    tier: 'requires_review',
    label: 'Hero subheadline',
    surface: 'build',
    reason:
      '§20 puts claims behind review. The line under the headline is where the promise is usually spelled out.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'founderPullQuote',
    tier: 'requires_review',
    label: 'Your pull quote',
    surface: 'build',
    reason: '§20 puts claims behind review, and a sentence in your own voice is a claim.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'platformLine',
    tier: 'requires_review',
    label: 'Where it will be available',
    surface: 'build',
    reason:
      '§20 puts delivery promises behind review. Which platforms a Backer will get this on is a delivery promise.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'headline',
    tier: 'requires_review',
    label: 'Demo moment headline',
    surface: 'demo_moment',
    reason: '§20 puts claims behind review, and this sentence says what your product does.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'signalText',
    tier: 'requires_review',
    label: 'Demo moment signal',
    surface: 'demo_moment',
    reason: '§20 puts claims behind review, and this says what your product does at that moment.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'actionLabel',
    tier: 'requires_review',
    label: 'Demo moment action',
    surface: 'demo_moment',
    reason: '§20 puts claims behind review, and this says what your product asks a person to do.',
    specRef: '§20 live editing, column 2',
  },
  {
    field: 'title',
    tier: 'requires_review',
    label: 'Benefit card title',
    surface: 'benefit_card',
    reason: '§20 puts claims behind review. A benefit card states what your product does.',
    specRef: '§20 live editing, column 2',
  },

  /* ── Column 3: cannot be changed directly at all ─────────────────────────── */
  {
    field: 'type',
    tier: 'never_direct',
    label: 'Campaign type',
    surface: 'campaign',
    reason:
      '§9 locks the campaign type permanently at submission and there is no migration path. A wrong type is corrected by archiving and starting again, never by converting.',
    specRef: '§20 live editing, column 3',
  },
  {
    field: 'orderThreshold',
    tier: 'never_direct',
    label: 'Order threshold',
    surface: 'build',
    reason:
      'Backers agreed to a charge rule that names this number, and it is fixed when the campaign closes.',
    specRef: '§20 live editing, column 3',
  },
  {
    field: 'internalTargetCents',
    tier: 'never_direct',
    label: 'Internal momentum target',
    surface: 'build',
    reason:
      'The internal target is not a public funding gate and is not changed once the campaign is running.',
    specRef: '§20 live editing, column 3',
  },
  {
    field: 'rewardSku',
    tier: 'never_direct',
    label: 'A pre-order’s reward',
    surface: 'reservation',
    reason:
      'This is what a Backer actually agreed to buy. It is recorded once when they pre-order and never rewritten.',
    specRef: '§20 live editing, column 3',
  },
  {
    field: 'rewardSubtotalCents',
    tier: 'never_direct',
    label: 'A pre-order’s price',
    surface: 'reservation',
    reason: 'This is the amount a Backer agreed to. It is recorded once and never rewritten.',
    specRef: '§20 live editing, column 3',
  },
  {
    field: 'totalAuthorizedCents',
    tier: 'never_direct',
    label: 'A pre-order’s authorized total',
    surface: 'reservation',
    reason:
      'The exact total a Backer consented to, including sales tax. It is recorded once and never rewritten.',
    specRef: '§20 live editing, column 3',
  },
  {
    field: 'basePercent',
    tier: 'never_direct',
    label: 'Accepted Creator compensation',
    surface: 'agreement',
    reason:
      'Both sides accepted these exact terms. A change is a new proposal both sides accept, never an edit.',
    specRef: '§20 live editing, column 3',
  },
  {
    field: 'fixedPaymentCents',
    tier: 'never_direct',
    label: 'Accepted fixed Creator payment',
    surface: 'agreement',
    reason: 'Both sides accepted this exact amount. A change is a new proposal, never an edit.',
    specRef: '§20 live editing, column 3',
  },
] as const;

const BY_KEY = new Map<string, EditableFieldDefinition>(
  EDITABLE_FIELDS.map((definition) => [`${definition.surface}:${definition.field}`, definition]),
);

/**
 * The tier for one field, or a throw.
 *
 * There is deliberately no default. A default of `direct_versioned` would open
 * the next column-two field somebody adds; a default of `never_direct` would
 * break a legitimate edit with no explanation. An unregistered field is a bug in
 * the register, and it should say so.
 */
export function tierFor(
  surface: EditableFieldDefinition['surface'],
  field: string,
): EditableFieldDefinition {
  const definition = BY_KEY.get(`${surface}:${field}`);
  if (!definition) {
    throw new LiveRuleError(
      `"${field}" on ${surface} is not in the §20 live-editing register, so it has no live write path`,
    );
  }
  return definition;
}

export function fieldsInTier(tier: EditTier): EditableFieldDefinition[] {
  return EDITABLE_FIELDS.filter((definition) => definition.tier === tier);
}

/* ── The FAQ loophole (§20) ────────────────────────────────────────────────── */

export const COMMITMENT_KINDS = ['date', 'price', 'refund', 'delivery'] as const;
export type CommitmentKind = (typeof COMMITMENT_KINDS)[number];

const MONTHS =
  '(january|february|march|april|may|june|july|august|september|october|november|december)';

/**
 * Commitment-shaped statements in a piece of FAQ text.
 *
 * §20's loophole in one function. It is deliberately **broad**: a false positive
 * sends a clarification through review, which costs the Founder a day; a false
 * negative moves a delivery date without anybody accepting it, which is the thing
 * the third column exists to prevent. The asymmetry decides the tuning.
 *
 * It does not try to decide whether the statement *contradicts* the approved
 * build. Comparing prose to prose would be a judgement, and §15 makes materiality
 * judgements Admin's — this only decides which desk the edit lands on.
 */
export function commitmentsIn(text: string): CommitmentKind[] {
  const found = new Set<CommitmentKind>();
  const value = text.toLowerCase();

  // A month with a year, an ISO-ish date, or a numeric date.
  if (
    new RegExp(`${MONTHS}\\s+\\d{4}`).test(value) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(value) ||
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(value) ||
    new RegExp(`\\b\\d{1,2}(st|nd|rd|th)?\\s+of\\s+${MONTHS}`).test(value)
  ) {
    found.add('date');
  }

  // An amount of money.
  if (/\bus\$\s?\d|\$\s?\d|\b\d+(\.\d{2})?\s?(usd|dollars)\b/.test(value)) {
    found.add('price');
  }

  // A refund or guarantee term.
  if (/\brefund(s|ed|ing|able)?\b|\bmoney[- ]back\b|\bguarantee(d|s)?\b/.test(value)) {
    found.add('refund');
  }

  // A shipping or delivery promise, with or without a date beside it.
  if (
    /\b(ship|ships|shipping|shipped|deliver|delivers|delivered|delivery|arrive|arrives|available)\b/.test(
      value,
    ) &&
    /\b(by|before|on|within|no later than|in)\b/.test(value)
  ) {
    found.add('delivery');
  }

  return [...found];
}

/**
 * The column-one fields the §20 loophole check does NOT run on, and why.
 *
 * §20 names the FAQ by example, not as the scope, so the default is that every
 * `direct_versioned` field is checked — a section heading that reads "Shipping
 * in March 2027" moves a delivery date exactly as an FAQ answer would. What is
 * listed here is only what *structurally* cannot carry a promise a reader acts
 * on, and each entry says which property makes that true.
 *
 * It is deliberately short. A long exemption list is how the check comes to
 * cover the one field somebody wanted it not to cover; a field absent from this
 * list is checked, which is the safe default for the register to have.
 */
export const COMMITMENT_CHECK_EXEMPT: Readonly<Record<string, string>> = {
  'build:communityUrl':
    'A URL, not a sentence. The page renders link text, and a slug is not a statement a reader acts on — while a date-shaped path segment would trip the check on every correct edit.',
  'build:founderProfileUrl':
    'A URL, not a sentence. Same reason as the community link.',
  'benefit_card:visualVariant':
    'A closed vocabulary of three shapes. It carries no text at all, so there is nothing for a commitment to be written into.',
};

/**
 * Whether the §20 loophole check runs on one column-one field.
 *
 * Column two already goes to review, and column three has no write path — so
 * the check is only meaningful on column one, and asking here rather than at
 * each call site is what stops a later surface forgetting it.
 */
export function commitmentCheckApplies(
  surface: EditableFieldDefinition['surface'],
  field: string,
): boolean {
  const definition = BY_KEY.get(`${surface}:${field}`);
  if (!definition || definition.tier !== 'direct_versioned') return false;
  return COMMITMENT_CHECK_EXEMPT[`${surface}:${field}`] === undefined;
}

/* ── §18's comment thread ──────────────────────────────────────────────────── */

/**
 * §18: "One general thread and one thread per update."
 *
 * The general thread is the campaign itself, so a comment carries a nullable
 * update id rather than living in two tables. A per-update thread is a filter,
 * not a different kind of record.
 */
export const COMMENT_THREADS = ['general', 'update'] as const;
export type CommentThread = (typeof COMMENT_THREADS)[number];

/**
 * §18: "Display `Backer ###` or a chosen display name, never email local-part by
 * default."
 *
 * The number is a per-campaign sequence rather than anything derived from the
 * identity — deriving it from an email or an id would make it a handle that
 * leaks whichever value it was derived from. `never email local-part by default`
 * is enforced by `displayNameRefusal` below: a chosen name that is the local part
 * of the Backer's own address is refused, because the default must not be
 * reachable by typing it.
 */
export function defaultCommentAuthorName(backerNumber: number): string {
  if (!Number.isInteger(backerNumber) || backerNumber < 1) {
    throw new LiveRuleError(`a Backer number is a positive integer, got ${String(backerNumber)}`);
  }
  return `Backer ${backerNumber}`;
}

export type DisplayNameRefusal = 'too_short' | 'too_long' | 'email_local_part' | 'looks_like_email';

/**
 * Whether a chosen display name may be used, and why not when it may not.
 *
 * §18 forbids the email local part *by default*; refusing it as a chosen name too
 * is the stricter reading, and it is the right one — a Backer who types their own
 * local part has almost certainly not understood that the thread is public, and
 * the cost of being wrong is publishing part of someone's email address.
 */
export function displayNameRefusal(
  chosen: string,
  backerEmail: string,
): DisplayNameRefusal | null {
  const name = chosen.trim();
  if (name.length < 2) return 'too_short';
  if (name.length > 40) return 'too_long';
  if (/@/.test(name)) return 'looks_like_email';
  const localPart = backerEmail.split('@')[0]?.trim().toLowerCase() ?? '';
  if (localPart.length >= 3 && name.toLowerCase() === localPart) return 'email_local_part';
  return null;
}

/**
 * §18: "New comments are disabled after close, suspension, or kill."
 *
 * Reading stays open — the ended-state contract keeps the page accessible — so
 * this decides posting only. Anything that is not `live` cannot be posted to,
 * which also covers a campaign that never launched: there is no thread to join.
 */
export function commentsOpenFor(campaignStatus: string): boolean {
  return campaignStatus === 'live';
}

/** §18: "Flagging routes to Admin." Three states, and no automatic removal. */
export const COMMENT_FLAG_STATES = ['open', 'upheld', 'dismissed'] as const;
export type CommentFlagState = (typeof COMMENT_FLAG_STATES)[number];

/**
 * §18 gives no automatic moderation and §1 rule 6 forbids inventing one, so a
 * flag routes to a person and a comment stays visible until an Admin decides.
 * Hiding on flag would let one reader remove another's comment.
 */
export const COMMENT_VISIBILITY = ['visible', 'removed'] as const;
export type CommentVisibility = (typeof COMMENT_VISIBILITY)[number];
