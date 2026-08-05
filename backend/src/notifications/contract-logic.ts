/**
 * `shared/src/notifications/contract.ts` and `classification.ts`, restated.
 *
 * The backend cannot import `@proovd/shared` at runtime: that package exports
 * TypeScript source, the backend compiles under `rootDir: src`, and the
 * production image ships only `backend/dist`. This is the same constraint
 * `db/schema/domain.ts` documents for the state enums, `policies/policy-gate.ts`
 * for the required policy slugs, and `launch/business-calendar.ts` for the
 * holiday data — and the answer is the same one: restate what is needed here,
 * and let `tests/notification-coverage.test.ts` fail the suite if the two ever
 * disagree.
 *
 * The audience is derived from the key prefix rather than restated as a fourth
 * copy of the register. The shared registry already guarantees every key is
 * prefixed with its own audience and its own test asserts it, so the prefix IS
 * the audience — deriving it cannot drift, and a fourth table could.
 */

export type MoneyMessageClass = 'charge' | 'scheduled' | 'payout' | 'no_charge';
export type MessageAudience = 'founder' | 'affiliate' | 'backer' | 'internal';

export const TIMEZONE_TOKENS = ['UTC', 'GMT'] as const;

export interface MoneyFact {
  specRef: string;
  appliesTo: readonly MoneyMessageClass[];
  detect: RegExp;
}

export const MONEY_MESSAGE_FACTS = {
  amount: {
    specRef: '§27.2, §3.3',
    appliesTo: ['charge', 'scheduled', 'payout', 'no_charge'],
    detect: /US\$\s?\d/,
  },
  money_moved: {
    specRef: '§3.3',
    appliesTo: ['charge', 'scheduled', 'payout', 'no_charge'],
    detect:
      /\b(charged|not\s+charged|no\s+charge|nothing has been charged|will be charged|refund(ed|s)?|released|paid|reversed|returned|funded|authoriz(e|ed)|blocked|finalized|awaiting\s+transfer|transferred)\b/i,
  },
  seller_and_mor: {
    specRef: '§27.2, §3.3',
    appliesTo: ['charge', 'scheduled'],
    detect: /\b(seller|merchant of record|sold by|merchant)\b/i,
  },
  statement_descriptor: {
    specRef: '§27.2, §3.3, §24.12',
    appliesTo: ['charge', 'scheduled'],
    detect: /\b(statement (shows|descriptor)|appears on your statement|PROOVD)/i,
  },
  status: {
    specRef: '§27.2',
    appliesTo: ['charge', 'scheduled', 'payout'],
    detect:
      /\b(pending|completed?|scheduled|started|underway|in\s+progress|processing|canceled|cancelled|failed|succeeded|not\s+charged|no\s+charge|released|blocked|restricted|on\s+hold|eligible|reversed|adjusted|on\s+its\s+way|in\s+full|received)\b/i,
  },
  not_charged_statement: {
    specRef: '§3.2, §30',
    appliesTo: ['scheduled', 'no_charge'],
    detect: /\b(not (been )?charged|no charge|nothing has (been charged|moved)|card is saved|card saved|will not be charged)\b/i,
  },
  recovery_path: {
    specRef: '§3.3',
    appliesTo: ['charge', 'scheduled', 'payout', 'no_charge'],
    detect: /\b(cancel|refund|update card|recover|support|contact|questions|help)\b/i,
  },
} as const satisfies Record<string, MoneyFact>;

export type MoneyFactKey = keyof typeof MONEY_MESSAGE_FACTS;

export const MONEY_FACT_KEYS = Object.keys(MONEY_MESSAGE_FACTS) as MoneyFactKey[];

export function missingMoneyFacts(
  renderedText: string,
  moneyClass: MoneyMessageClass,
): MoneyFactKey[] {
  return MONEY_FACT_KEYS.filter(
    (key) =>
      (MONEY_MESSAGE_FACTS[key].appliesTo as readonly string[]).includes(moneyClass) &&
      !MONEY_MESSAGE_FACTS[key].detect.test(renderedText),
  );
}

export interface BannedTerm {
  specRef: string;
  replacement: string;
  pattern: RegExp;
}

export const CUSTOMER_ONLY_BANNED_TERMS = {
  reservation: { specRef: '§3.1', replacement: 'Pre-order', pattern: /\breservations?\b/i },
  pre_build: { specRef: '§3.1', replacement: 'Idea Campaign', pattern: /\bpre[-_ ]build\b/i },
  pre_launch: { specRef: '§3.1', replacement: 'Product Campaign', pattern: /\bpre[-_ ]launch\b/i },
  affiliate: { specRef: '§3.1', replacement: 'Creator', pattern: /\baffiliates?\b/i },
  tranche: {
    specRef: '§3.1',
    replacement: 'first payment / remaining payment',
    pattern: /\btranches?\b/i,
  },
  mbp: { specRef: '§3.1', replacement: 'the disclosed campaign terms', pattern: /\bMBP\b/ },
} as const satisfies Record<string, BannedTerm>;

export const UNIVERSALLY_BANNED_TERMS = {
  pledge: {
    specRef: '§3.2',
    replacement: 'reserve a pre-order / authorize a future charge',
    pattern: /\bpledge[ds]?\b/i,
  },
  donate: {
    specRef: '§3.2',
    replacement: 'pre-order / founding-member contribution',
    pattern: /\bdonat(e|ed|ion|ions)\b/i,
  },
  all_or_nothing: {
    specRef: '§3.2',
    replacement: 'conditional charge contingent on the order threshold',
    pattern: /\ball[- ]or[- ]nothing\b/i,
  },
  goal: { specRef: '§3.2', replacement: 'order threshold', pattern: /\bgoals?\b/i },
  escrow: {
    specRef: '§3.2',
    replacement: 'Stripe Connect payout controls',
    pattern: /\bescrow\b/i,
  },
  custody: {
    specRef: '§3.2',
    replacement: 'Stripe Connect payout controls',
    pattern: /\bcustod(y|ial)\b/i,
  },
  trust_account: {
    specRef: '§3.2',
    replacement: 'Stripe Connect payout controls',
    pattern: /\btrust account\b/i,
  },
  proovd_holds: {
    specRef: '§3.2, §22.3',
    replacement: 'eligible / blocked with the named requirement / released',
    pattern: /\b(held in a Proovd account|Proovd (bank )?hold|we hold your (money|funds))\b/i,
  },
  equity: {
    specRef: '§3.2',
    replacement: 'reward package / founding-member benefit',
    // Phase 23a narrowed this from every occurrence of the word to the forms
    // that make a claim about the reader's money — see the shared register for
    // why `/safety`'s prohibited-category list and `/about`'s denial are §3.2's
    // own position rather than breaches of it.
    pattern:
      /\b(equity (stake|crowdfunding|share)|your (investment|equity)|invest(ing)? in (this|the) (campaign|product|company)|investment (opportunity|return)|returns on your|ROI)\b/i,
  },
  anyone_can_launch: {
    specRef: '§3.2',
    replacement: 'vetted founders apply through Proovd onboarding',
    pattern: /\banyone can launch\b/i,
  },
  first_half: {
    specRef: '§3.2',
    replacement: 'fixed Creator payment pending completion / fixed Creator payment paid',
    pattern: /\b(first half|final half)\b/i,
  },
  upfront: {
    specRef: '§3.2',
    replacement: 'optional fixed Creator payment / Creator payment funded',
    pattern: /\bupfront (fee|payout|payment)\b/i,
  },
} as const satisfies Record<string, BannedTerm>;

export interface NamingViolation {
  term: string;
  specRef: string;
  replacement: string;
}

export function namingViolations(rendered: string, audience: MessageAudience): NamingViolation[] {
  const found: NamingViolation[] = [];
  for (const [term, def] of Object.entries(UNIVERSALLY_BANNED_TERMS)) {
    if (def.pattern.test(rendered)) {
      found.push({ term, specRef: def.specRef, replacement: def.replacement });
    }
  }
  if (audience !== 'internal') {
    for (const [term, def] of Object.entries(CUSTOMER_ONLY_BANNED_TERMS)) {
      if (def.pattern.test(rendered)) {
        found.push({ term, specRef: def.specRef, replacement: def.replacement });
      }
    }
  }
  return found;
}

export function actionUrlsIn(html: string): string[] {
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1] ?? '');
  return [...new Set(hrefs.filter((href) => /^https?:\/\//i.test(href)))];
}

/* ── The §27.2 / §27.1 classification, restated ────────────────────────────── */

export const MONEY_MESSAGE_CLASS: Record<string, MoneyMessageClass> = {
  backer_charge_receipt: 'charge',
  backer_retry_success: 'charge',
  backer_charge_failed_update_card: 'charge',
  founder_listing_fee_receipt: 'charge',
  backer_preorder_confirmation: 'scheduled',
  backer_precharge_reminder: 'scheduled',
  backer_refund_started: 'payout',
  backer_refund_completed: 'payout',
  backer_refund_failed: 'payout',
  founder_listing_fee_refund: 'payout',
  founder_single_payment_released: 'payout',
  founder_first_payment_released: 'payout',
  founder_remaining_payment_released: 'payout',
  founder_w9_block: 'payout',
  founder_payment_blocked: 'payout',
  founder_early_remaining_result: 'payout',
  affiliate_commission_finalized: 'payout',
  affiliate_transfer_created: 'payout',
  affiliate_transfer_failure: 'payout',
  affiliate_transfer_reversal: 'payout',
  affiliate_payout_paid: 'payout',
  affiliate_payout_failed: 'payout',
  backer_cancellation_confirmation: 'no_charge',
  backer_threshold_miss_no_charge: 'no_charge',
  backer_retry_dropped: 'no_charge',
};

export const DEADLINE_MESSAGE_KEYS: readonly string[] = [
  'backer_precharge_reminder',
  'backer_charge_failed_update_card',
  'founder_response_window_started',
  'affiliate_warning',
  'affiliate_suspension',
  'affiliate_policy_reacceptance',
  'internal_day_14_due',
  'internal_money_decisions_due',
  'internal_dispute_opened',
];

/**
 * §27.2's "not opt-out-able" does not bind these, and inverts for them: the
 * digest is §27.7's optional message and owes the reader a way to stop it. See
 * the shared register for why the exception is named rather than implicit.
 */
export const NON_TRANSACTIONAL_KEYS: readonly string[] = [
  'founder_activity_digest',
  'affiliate_activity_digest',
  'backer_campaign_update_digest',
];

export function isTransactionalMessage(key: string): boolean {
  return !NON_TRANSACTIONAL_KEYS.includes(key);
}

export function moneyClassFor(key: string): MoneyMessageClass | undefined {
  return MONEY_MESSAGE_CLASS[key];
}

export function carriesDeadline(key: string): boolean {
  return DEADLINE_MESSAGE_KEYS.includes(key);
}

/**
 * The audience, from the key prefix. The shared register guarantees every key
 * is prefixed with its own audience, so this cannot drift the way a fourth
 * copy of the table would.
 */
export function audienceOf(key: string): MessageAudience {
  const prefix = key.split('_')[0];
  if (prefix === 'founder' || prefix === 'affiliate' || prefix === 'backer' || prefix === 'internal')
    return prefix;
  throw new Error(`notification key has no audience prefix: ${key}`);
}
