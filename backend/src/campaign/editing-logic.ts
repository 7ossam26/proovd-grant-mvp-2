/**
 * §20's live-editing register and the FAQ commitment check, restated.
 *
 * The backend cannot import `@proovd/shared` at runtime — same constraint as the
 * state enums, the policy slugs, the launch checklist, the support registers, and
 * 17a's `live/logic.ts`; same answer. `src/tests/live-editing.test.ts` walks every
 * field and every commitment case through both, so a tier that changed in one
 * place and not the other fails the suite rather than quietly letting a Founder
 * publish a promise nobody accepted.
 */

export const EDIT_TIERS = ['direct_versioned', 'requires_review', 'never_direct'] as const;
export type EditTier = (typeof EDIT_TIERS)[number];

export const EDIT_SURFACES = [
  'build',
  'faq',
  'reward_package',
  'reservation',
  'agreement',
  'campaign',
  'demo_moment',
  'benefit_card',
] as const;
export type EditSurface = (typeof EDIT_SURFACES)[number];

export interface EditableFieldDefinition {
  field: string;
  tier: EditTier;
  label: string;
  surface: EditSurface;
  reason: string;
  specRef: string;
}

export const EDITABLE_FIELDS: readonly EditableFieldDefinition[] = [
  /* Column 1 — directly allowed, with version history. */
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

  /* Column 2 — Admin review + affected-Creator reacceptance. */
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

  /* Column 3 — cannot be changed directly at all. */
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

/** Throws on an unregistered field — no default in either direction (see shared). */
export function tierFor(surface: EditSurface, field: string): EditableFieldDefinition {
  const definition = BY_KEY.get(`${surface}:${field}`);
  if (!definition) {
    throw new Error(
      `"${field}" on ${surface} is not in the §20 live-editing register, so it has no live write path`,
    );
  }
  return definition;
}

export function fieldsInTier(tier: EditTier): EditableFieldDefinition[] {
  return EDITABLE_FIELDS.filter((definition) => definition.tier === tier);
}

/* ── The §20 FAQ loophole ──────────────────────────────────────────────────── */

export const COMMITMENT_KINDS = ['date', 'price', 'refund', 'delivery'] as const;
export type CommitmentKind = (typeof COMMITMENT_KINDS)[number];

const MONTHS =
  '(january|february|march|april|may|june|july|august|september|october|november|december)';

/**
 * Deliberately broad. A false positive costs a review; a false negative moves a
 * delivery date without anybody accepting it, which is what §20's third column
 * exists to prevent. The asymmetry decides the tuning.
 */
export function commitmentsIn(text: string): CommitmentKind[] {
  const found = new Set<CommitmentKind>();
  const value = text.toLowerCase();

  if (
    new RegExp(`${MONTHS}\\s+\\d{4}`).test(value) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(value) ||
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(value) ||
    new RegExp(`\\b\\d{1,2}(st|nd|rd|th)?\\s+of\\s+${MONTHS}`).test(value)
  ) {
    found.add('date');
  }
  if (/\bus\$\s?\d|\$\s?\d|\b\d+(\.\d{2})?\s?(usd|dollars)\b/.test(value)) {
    found.add('price');
  }
  if (/\brefund(s|ed|ing|able)?\b|\bmoney[- ]back\b|\bguarantee(d|s)?\b/.test(value)) {
    found.add('refund');
  }
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
 * §20 names the FAQ by example, not as the scope. The rebuilt campaign page
 * added ten more column-one free-text fields, and a section heading reading
 * "Shipping in March 2027" moves a delivery date exactly as an FAQ answer would
 * — so the default is that every column-one field is checked, and this names
 * only what structurally cannot carry a promise a reader acts on.
 */
export const COMMITMENT_CHECK_EXEMPT: Readonly<Record<string, string>> = {
  'build:communityUrl':
    'A URL, not a sentence. The page renders link text, and a slug is not a statement a reader acts on — while a date-shaped path segment would trip the check on every correct edit.',
  'build:founderProfileUrl':
    'A URL, not a sentence. Same reason as the community link.',
  'benefit_card:visualVariant':
    'A closed vocabulary of three shapes. It carries no text at all, so there is nothing for a commitment to be written into.',
};

/** Whether the §20 loophole check runs on one column-one field (see shared). */
export function commitmentCheckApplies(surface: EditSurface, field: string): boolean {
  const definition = BY_KEY.get(`${surface}:${field}`);
  if (!definition || definition.tier !== 'direct_versioned') return false;
  return COMMITMENT_CHECK_EXEMPT[`${surface}:${field}`] === undefined;
}

/* ── §18's comment rules, restated ─────────────────────────────────────────── */

export const COMMENT_FLAG_STATES = ['open', 'upheld', 'dismissed'] as const;
export const COMMENT_VISIBILITY = ['visible', 'removed'] as const;

export function defaultCommentAuthorName(backerNumber: number): string {
  return `Backer ${backerNumber}`;
}

export type DisplayNameRefusal = 'too_short' | 'too_long' | 'email_local_part' | 'looks_like_email';

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

/** §18: new comments are disabled after close, suspension, or kill. */
export function commentsOpenFor(campaignStatus: string): boolean {
  return campaignStatus === 'live';
}

/* ── §20/§22.1 earnings states, restated ───────────────────────────────────── */

export const EARNINGS_STATES = [
  'estimated',
  'finalized',
  'approved_for_transfer',
  'transferred',
  'paid_out',
  'payout_failed',
  'adjusted',
] as const;
export type EarningsState = (typeof EARNINGS_STATES)[number];

export const EARNINGS_STATE_LABELS: Readonly<Record<EarningsState, string>> = {
  estimated: 'ESTIMATED',
  finalized: 'FINALIZED',
  approved_for_transfer: 'APPROVED FOR TRANSFER',
  transferred: 'TRANSFERRED',
  paid_out: 'PAID OUT',
  payout_failed: 'PAYOUT FAILED',
  adjusted: 'ADJUSTED',
};

export function requiresExplanation(state: EarningsState): boolean {
  return state !== 'paid_out';
}

/* ── Appendix B.7, restated (shared/live/earnings — drift-tested) ──────────── */

/**
 * Phase 17b restated the states but deliberately never rendered B.7 — there
 * was no amount to state. Phase 18b has one: a captured, attributed subtotal
 * exists after close, so the Creator close surface and the §27.4 close notice
 * render the block server-side, and the resolver arrives with them.
 */
export const AFFILIATE_MONEY_STATUS_TEMPLATE = `US$[AMOUNT] recorded

Status: [ESTIMATED / FINALIZED / APPROVED FOR TRANSFER / TRANSFERRED /
PAID OUT / PAYOUT FAILED / ADJUSTED]
Why it is not paid yet: [REASON]
Expected next update: [DATE]
Your action: [ACTION or "No action needed"]`;

/** §11's exact phrase, shared by the waiting states and this one. */
export const NO_ACTION_NEEDED = 'No action needed';

export interface AffiliateMoneyStatusVariables {
  amount: string;
  state: EarningsState;
  reason: string;
  nextUpdate: string;
  action?: string | undefined;
}

export function resolveAffiliateMoneyStatus(v: AffiliateMoneyStatusVariables): string {
  if (!/^[\d,]+\.\d{2}$/.test(v.amount)) {
    throw new Error(`Appendix B.7 needs a formatted amount such as "1,234.50", got "${v.amount}"`);
  }
  if (requiresExplanation(v.state) && !v.reason.trim()) {
    throw new Error(`§20 requires a reason for the ${v.state} state`);
  }
  if (!v.nextUpdate.trim()) {
    throw new Error('§20 requires an expected next update');
  }

  const action = v.action?.trim() || NO_ACTION_NEEDED;
  const reason = v.reason.trim() || 'It has been paid out.';

  const rendered = AFFILIATE_MONEY_STATUS_TEMPLATE.replace('[AMOUNT]', v.amount)
    .replace(
      '[ESTIMATED / FINALIZED / APPROVED FOR TRANSFER / TRANSFERRED /\nPAID OUT / PAYOUT FAILED / ADJUSTED]',
      EARNINGS_STATE_LABELS[v.state],
    )
    .replace('[REASON]', reason)
    .replace('[DATE]', v.nextUpdate.trim())
    .replace('[ACTION or "No action needed"]', action);

  if (/\[[^\]]+\]/.test(rendered)) {
    throw new Error(`Appendix B.7 rendered with an unfilled marker: ${rendered}`);
  }
  return rendered;
}
