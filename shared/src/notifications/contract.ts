/**
 * The transactional message contract — Spec §27.1, §27.2, §3.1, §3.2, §3.3.
 *
 * §27 states its rules as prose: "at most one primary action", "money emails
 * include amount, seller/MoR, descriptor, pending/completed status", "deadline
 * emails spell out timezone". A rule in prose is a rule nobody can test, and by
 * Phase 22 there are over a hundred messages for it to be true of. So each rule
 * is a record here, the backend restates it, and the coverage suite walks the
 * register and renders every message against it — the same arrangement §26.5's
 * eleven ledger dimensions and §31.7's ten risk signals already use.
 *
 * ── Why money messages come in four classes ─────────────────────────────────
 * §27.2 asks a money email for amount, seller/MoR, descriptor, and status. Read
 * flatly that would demand a statement descriptor on a cancellation — a
 * descriptor for a charge that will never exist, on the one message where §30
 * makes it most important not to imply money moved — and on a Founder payment
 * release, which is not a card charge and therefore appears on nobody's
 * statement. A descriptor asserted where none exists is a charge implied.
 *
 * So the four facts apply by what the message is actually about:
 *
 *  - `charge`    money moved off a card now. Owes all four.
 *  - `scheduled` money will move off this card later and has not yet. Owes all
 *                four *and* the explicit not-charged statement — this is the
 *                pre-order confirmation and the pre-charge reminder, the two
 *                messages §30 is most concerned about.
 *  - `payout`    money moved toward someone — a release, a Transfer, a refund.
 *                There is no card statement and no seller, so neither is owed.
 *  - `no_charge` money did not move and will not. Owes the amount, where things
 *                stand, and the not-charged statement instead of a descriptor.
 *
 * The detectors below are deliberately literal — they read the *rendered*
 * message, not the sender's intention, which is the same reason §7's preview
 * gate scans rendered output rather than the record behind it.
 */

/* ── §27.1 the system-wide state pattern ───────────────────────────────────── */

/**
 * The six questions every waiting, review, payment, recovery, and exception
 * state answers. Surfaces answer all six; a message answers as many as apply
 * and always the support route (§27.2's own rule), which is question 6.
 */
export const STATE_PATTERN_QUESTIONS = [
  'what_happened',
  'what_happens_next',
  'who_owns_it',
  'when_is_the_next_update',
  'what_can_the_user_do_now',
  'how_do_they_get_help_without_losing_context',
] as const;

export type StatePatternQuestion = (typeof STATE_PATTERN_QUESTIONS)[number];

/**
 * §27.1: "Dates are local time primary with canonical UTC secondary; deadline
 * emails spell out timezone." A deadline email that renders `18:00` and leaves
 * the reader to guess is the failure this names — so a message carrying a
 * deadline must render a named zone beside it.
 */
export const TIMEZONE_TOKENS = ['UTC', 'GMT'] as const;

/* ── §27.2 transactional email rules ───────────────────────────────────────── */

export interface TransactionalRule {
  /** Where the rule is enforced, so a reader can check the claim. */
  enforcedBy: string;
  statement: string;
}

export const TRANSACTIONAL_RULES = {
  not_opt_out_able: {
    statement: 'Transactional email is not opt-out-able.',
    enforcedBy: 'no unsubscribe path exists in notifications/send.ts or any template',
  },
  specific_subject: {
    statement: 'A specific subject naming the campaign or product.',
    enforcedBy: 'catalog subject check — the campaign or product name appears in the subject',
  },
  one_primary_action: {
    statement: 'At most one primary action.',
    enforcedBy: 'catalog render check — at most one distinct http(s) action URL per message',
  },
  support_route: {
    statement: 'A plain-text support route.',
    enforcedBy: 'catalog render check — the support address appears in the text part',
  },
  stable_reference: {
    statement: 'A stable campaign, reservation, or case reference.',
    enforcedBy: 'catalog render check — a quotable reference appears in the text part',
  },
  money_facts: {
    statement: 'Money emails include amount, seller/MoR, descriptor, and pending/completed status.',
    enforcedBy: 'MONEY_MESSAGE_FACTS, per money class',
  },
  previewable: {
    statement: 'High-impact messages can be previewed with final variables before manual send.',
    enforcedBy: 'notifications/preview.ts renders from the catalog with the caller’s variables',
  },
  no_duplicate_delivery: {
    statement: 'Duplicate webhook or job delivery cannot create a duplicate email.',
    enforcedBy: 'notification_deliveries unique (event, target, entity), claimed before the send',
  },
} as const satisfies Record<string, TransactionalRule>;

export type TransactionalRuleKey = keyof typeof TRANSACTIONAL_RULES;

export const TRANSACTIONAL_RULE_KEYS = Object.keys(
  TRANSACTIONAL_RULES,
) as TransactionalRuleKey[];

/* ── §27.2 + §3.3 the money facts ──────────────────────────────────────────── */

/** See the header note for why these are four and not one. */
export type MoneyMessageClass = 'charge' | 'scheduled' | 'payout' | 'no_charge';

export const MONEY_MESSAGE_CLASSES = [
  'charge',
  'scheduled',
  'payout',
  'no_charge',
] as const satisfies readonly MoneyMessageClass[];

export interface MoneyFact {
  /** §3.3 or §27.2, whichever states it. */
  specRef: string;
  description: string;
  /** Which money classes owe this fact. */
  appliesTo: readonly MoneyMessageClass[];
  /** What the rendered text must contain for the fact to be present. */
  detect: RegExp;
}

export const MONEY_MESSAGE_FACTS = {
  amount: {
    specRef: '§27.2, §3.3',
    description: 'The amount, as a formatted US dollar figure.',
    appliesTo: ['charge', 'scheduled', 'payout', 'no_charge'],
    detect: /US\$\s?\d/,
  },
  money_moved: {
    specRef: '§3.3',
    description: 'Whether money moved, stated rather than implied.',
    appliesTo: ['charge', 'scheduled', 'payout', 'no_charge'],
    // Includes the §22.1 earnings vocabulary — `finalized`, `awaiting
    // transfer`, `transferred` — because "your earnings are finalized and
    // awaiting transfer" states exactly where the money stands. Restricting
    // this to `charged`/`paid` would have forced those messages to claim
    // movement that has not happened.
    detect:
      /\b(charged|not\s+charged|no\s+charge|nothing has been charged|will be charged|refund(ed|s)?|released|paid|reversed|returned|funded|authoriz(e|ed)|blocked|finalized|awaiting\s+transfer|transferred)\b/i,
  },
  seller_and_mor: {
    specRef: '§27.2, §3.3',
    description:
      'The seller and merchant of record. A payout has no seller and a `no_charge` message has no sale to attribute.',
    appliesTo: ['charge', 'scheduled'],
    detect: /\b(seller|merchant of record|sold by|merchant)\b/i,
  },
  statement_descriptor: {
    specRef: '§27.2, §3.3, §24.12',
    description:
      'The expected statement descriptor. Only a card charge has one; asserting it elsewhere implies a charge that does not exist.',
    appliesTo: ['charge', 'scheduled'],
    detect: /\b(statement (shows|descriptor)|appears on your statement|PROOVD)/i,
  },
  status: {
    specRef: '§27.2',
    description:
      'Pending or completed status — where the money stands right now. A `no_charge` message is exempt: its status is that there is none, which `not_charged_statement` already asserts in words. Requiring both would push a cancellation toward inventing a status for a transaction that does not exist.',
    appliesTo: ['charge', 'scheduled', 'payout'],
    // Appendix B.6's customer-facing refund words are `started`, `completed`,
    // `failed` — not §24.8's internal `requested/submitted/succeeded/failed`.
    // The detector reads what a customer is shown, so it knows both.
    // Whitespace in a multi-word phrase is `\s+`, not a literal space: a
    // template wraps its plain-text part at a column, so `on its way` can
    // arrive with a newline in the middle of it and still be the words the
    // reader sees.
    detect:
      /\b(pending|completed?|scheduled|started|underway|in\s+progress|processing|canceled|cancelled|failed|succeeded|not\s+charged|no\s+charge|released|blocked|restricted|on\s+hold|eligible|reversed|adjusted|on\s+its\s+way|in\s+full|received)\b/i,
  },
  not_charged_statement: {
    specRef: '§3.2, §30',
    description:
      'A message about money that has not moved says so in words, not only by showing US$0 — §3.2 replaces "US$0 charge" with "card saved; not charged today".',
    appliesTo: ['scheduled', 'no_charge'],
    // The family of honest phrasings, not one pinned sentence: `not charged`,
    // `has not been charged`, `nothing has moved`, `card is saved`. A single
    // exact string would force every message into one voice, and a detector
    // that only knew one of them would pass the message that says the other.
    detect:
      /\b(not (been )?charged|no charge|nothing has (been charged|moved)|card is saved|card saved|will not be charged)\b/i,
  },
  recovery_path: {
    specRef: '§3.3',
    description: 'The cancellation, refund, or recovery path, or the support route that reaches it.',
    appliesTo: ['charge', 'scheduled', 'payout', 'no_charge'],
    detect: /\b(cancel|refund|update card|recover|support|contact|questions|help)\b/i,
  },
} as const satisfies Record<string, MoneyFact>;

export type MoneyFactKey = keyof typeof MONEY_MESSAGE_FACTS;

export const MONEY_FACT_KEYS = Object.keys(MONEY_MESSAGE_FACTS) as MoneyFactKey[];

export function moneyFactsFor(moneyClass: MoneyMessageClass): MoneyFactKey[] {
  return MONEY_FACT_KEYS.filter((key) =>
    (MONEY_MESSAGE_FACTS[key].appliesTo as readonly string[]).includes(moneyClass),
  );
}

/** The money facts a rendered message is missing for its class. */
export function missingMoneyFacts(
  renderedText: string,
  moneyClass: MoneyMessageClass,
): MoneyFactKey[] {
  return moneyFactsFor(moneyClass).filter(
    (key) => !MONEY_MESSAGE_FACTS[key].detect.test(renderedText),
  );
}

/* ── §3.1 / §3.2 the naming contract, as a scanner ─────────────────────────── */

export interface BannedTerm {
  specRef: string;
  /** What the message must say instead. */
  replacement: string;
  pattern: RegExp;
}

/**
 * The terms §3.1 and §3.2 forbid in anything a Founder, Creator, or Backer
 * reads. Internal messages are exempt from the §3.1 half — §3.1's own rule is
 * about what *renders* to a customer, and an Admin queue notice that says
 * `reservation` is naming the table it will be read against — but never from
 * the §3.2 half, because §3.2's replacements are about honesty rather than
 * audience, and an internal habit of writing `escrow` is exactly how it leaks
 * (§3.2's own closing sentence).
 */
export const CUSTOMER_ONLY_BANNED_TERMS = {
  reservation: {
    specRef: '§3.1',
    replacement: 'Pre-order',
    pattern: /\breservations?\b/i,
  },
  pre_build: {
    specRef: '§3.1',
    replacement: 'Idea Campaign',
    pattern: /\bpre[-_ ]build\b/i,
  },
  pre_launch: {
    specRef: '§3.1',
    replacement: 'Product Campaign',
    pattern: /\bpre[-_ ]launch\b/i,
  },
  affiliate: {
    specRef: '§3.1',
    replacement: 'Creator',
    pattern: /\baffiliates?\b/i,
  },
  tranche: {
    specRef: '§3.1',
    replacement: 'first payment / remaining payment',
    pattern: /\btranches?\b/i,
  },
  mbp: {
    specRef: '§3.1',
    replacement: 'the disclosed campaign terms',
    pattern: /\bMBP\b/,
  },
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
  goal: {
    specRef: '§3.2',
    replacement: 'order threshold',
    pattern: /\bgoals?\b/i,
  },
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
    pattern: /\b(equity|investment|returns on your|ROI)\b/i,
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

export type BannedTermKey =
  | keyof typeof CUSTOMER_ONLY_BANNED_TERMS
  | keyof typeof UNIVERSALLY_BANNED_TERMS;

export interface NamingViolation {
  term: BannedTermKey;
  specRef: string;
  replacement: string;
}

/**
 * The §3 violations in a rendered message. `internal` messages are scanned
 * against §3.2 only — see the note on `CUSTOMER_ONLY_BANNED_TERMS`.
 */
export function namingViolations(
  rendered: string,
  audience: 'founder' | 'affiliate' | 'backer' | 'internal',
): NamingViolation[] {
  const found: NamingViolation[] = [];
  for (const [term, def] of Object.entries(UNIVERSALLY_BANNED_TERMS)) {
    if (def.pattern.test(rendered)) {
      found.push({ term: term as BannedTermKey, specRef: def.specRef, replacement: def.replacement });
    }
  }
  if (audience !== 'internal') {
    for (const [term, def] of Object.entries(CUSTOMER_ONLY_BANNED_TERMS)) {
      if (def.pattern.test(rendered)) {
        found.push({
          term: term as BannedTermKey,
          specRef: def.specRef,
          replacement: def.replacement,
        });
      }
    }
  }
  return found;
}

/* ── §27.2's "at most one primary action" ──────────────────────────────────── */

/**
 * The distinct navigable action URLs in a rendered HTML body. `mailto:` and
 * `tel:` are support routes rather than actions — §27.2 requires the support
 * route *and* caps the actions at one, so counting the support route as an
 * action would make the two rules contradict each other.
 */
export function actionUrlsIn(html: string): string[] {
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1] ?? '');
  const actions = hrefs.filter((href) => /^https?:\/\//i.test(href));
  return [...new Set(actions)];
}
