/**
 * Creator earnings states and Appendix B.7 — Spec §20, §22.1 (Phase 17b).
 *
 * §20: "Earnings states are distinct: `estimated`, `finalized`, `approved for
 * transfer`, `transferred`, `paid out`, `payout failed`, `adjusted`. Each
 * unpaid/adjusted state names reason, owner, and next date/action."
 *
 * ── Seven states, not a boolean ─────────────────────────────────────────────
 * They are distinct because they mean different things to the person waiting:
 * `finalized` says the number will not change, `approved for transfer` says a
 * human has signed it off, `transferred` says Proovd sent it, `paid out` says the
 * bank has it. Collapsing any pair would answer "where is my money" with a word
 * that does not answer it. `payout failed` and `adjusted` are the two that carry
 * an action, which is why §20 asks every unpaid state to name one.
 *
 * ── Appendix B.7 is exact text ──────────────────────────────────────────────
 * Pinned like A.1's trust strip, A.3/A.4's pre-order consents, A.5's listing
 * consent, and B.8's support acknowledgement. The resolver substitutes its five
 * variables and throws on any bracket left in the rendered output — the §7/§8
 * preview gate applied to a template. `No action needed` is §11's exact phrase
 * and is a constant, because a paraphrase is a softer promise.
 *
 * ── Almost every state is Phase 19's, and this says so ──────────────────────
 * §22.1 finalizes earnings after the retry window and creates the Transfer on or
 * after Day 3 — all Phase 19. Phase 17b renders the state a Creator is actually
 * in, which during a live campaign is `estimated` with nothing captured yet, and
 * names what it is waiting for rather than showing a number nobody has computed
 * (§1.4, the same rule 16a's money panels follow).
 */

import { LiveRuleError } from './index.js';

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

/** The words Appendix B.7 puts on screen, in its own upper-case rendering. */
export const EARNINGS_STATE_LABELS: Readonly<Record<EarningsState, string>> = {
  estimated: 'ESTIMATED',
  finalized: 'FINALIZED',
  approved_for_transfer: 'APPROVED FOR TRANSFER',
  transferred: 'TRANSFERRED',
  paid_out: 'PAID OUT',
  payout_failed: 'PAYOUT FAILED',
  adjusted: 'ADJUSTED',
};

/**
 * §20: "Each unpaid/adjusted state names reason, owner, and next date/action."
 *
 * `paid_out` is the only state that owes none of that — the money arrived. Every
 * other state, including `transferred` (Proovd sent it; the bank has not
 * necessarily posted it), must say why it is not yet in the Creator's hands.
 */
export function requiresExplanation(state: EarningsState): boolean {
  return state !== 'paid_out';
}

/** §22.1: the two states where the Creator themselves has something to do. */
export function requiresCreatorAction(state: EarningsState): boolean {
  return state === 'payout_failed';
}

/* ── Appendix B.7, verbatim ────────────────────────────────────────────────── */

export const AFFILIATE_MONEY_STATUS_TEMPLATE = `US$[AMOUNT] recorded

Status: [ESTIMATED / FINALIZED / APPROVED FOR TRANSFER / TRANSFERRED /
PAID OUT / PAYOUT FAILED / ADJUSTED]
Why it is not paid yet: [REASON]
Expected next update: [DATE]
Your action: [ACTION or "No action needed"]`;

/** §11's exact phrase, shared by the waiting states and this one. */
export const NO_ACTION_NEEDED = 'No action needed';

export interface AffiliateMoneyStatusVariables {
  /** A formatted amount — `1,234.50`. Never a raw cent count. */
  amount: string;
  state: EarningsState;
  /** §20: why it is not paid yet. Required for every state but `paid_out`. */
  reason: string;
  /** §20: the next date or, where there is no fixed date, the next event. */
  nextUpdate: string;
  /** §20: the Creator's action, or `No action needed`. */
  action?: string | undefined;
}

/**
 * Renders B.7 for one Creator.
 *
 * Refuses an amount that is not a formatted amount, and refuses a missing reason
 * on a state that owes one — `resolveListingFeeConsent`'s posture applied to a
 * status block. A B.7 rendered with a bracket still in it is a status that says
 * nothing, and one rendered with an empty reason is the §20 requirement quietly
 * dropped.
 */
export function resolveAffiliateMoneyStatus(v: AffiliateMoneyStatusVariables): string {
  if (!/^[\d,]+\.\d{2}$/.test(v.amount)) {
    throw new LiveRuleError(
      `Appendix B.7 needs a formatted amount such as "1,234.50", got "${v.amount}"`,
    );
  }
  if (requiresExplanation(v.state) && !v.reason.trim()) {
    throw new LiveRuleError(`§20 requires a reason for the ${v.state} state`);
  }
  if (!v.nextUpdate.trim()) {
    throw new LiveRuleError('§20 requires an expected next update');
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
    throw new LiveRuleError(`Appendix B.7 rendered with an unfilled marker: ${rendered}`);
  }
  return rendered;
}

/* ── §20's Creator obligations while live ──────────────────────────────────── */

/**
 * The obligations §20 asks the live Creator surface to enforce or surface.
 *
 * A register rather than prose, for the reason every other §20 list is one: it is
 * the thing §33's Creator-facing checks assert against, and an obligation that
 * quietly disappears from a surface is one nobody agreed to drop.
 *
 * `enforced` says what the product actually does about it — §1.4 forbids
 * implying an automation that does not exist, and Proovd cannot detect a
 * purchased list or an identity-hidden account. Most of these are surfaced and
 * enforced by a person on evidence, which is what §1.3 makes valid when recorded.
 */
export interface CreatorObligation {
  key: string;
  /** What the Creator must do or must not do, in their words. */
  statement: string;
  enforcement: 'surfaced' | 'verified_on_evidence';
  specRef: string;
}

export const CREATOR_OBLIGATIONS: readonly CreatorObligation[] = [
  {
    key: 'content_availability',
    statement:
      'Keep your promotional content available for the agreed campaign and availability period. Story-format content may follow the natural lifespan you agreed in advance.',
    enforcement: 'verified_on_evidence',
    specRef: '§20 Affiliate during live campaign',
  },
  {
    key: 'no_spam',
    statement:
      'No spam, no unsolicited direct messages, no identity-hidden accounts, no purchased lists, no unrelated mass platforms, and nothing aimed at minors.',
    enforcement: 'verified_on_evidence',
    specRef: '§20 Affiliate during live campaign',
  },
  {
    key: 'no_prohibited_claims',
    statement:
      'No prohibited claims, and no sharing, selling, or transferring your tracking link to anyone.',
    enforcement: 'verified_on_evidence',
    specRef: '§20 Affiliate during live campaign',
  },
  {
    key: 'permitted_channels',
    statement:
      'Promote only through channels you own, administer, are permitted to use, or are a guest on — and follow that host’s rules.',
    enforcement: 'surfaced',
    specRef: '§20 Affiliate during live campaign',
  },
  {
    key: 'email_rules',
    statement:
      'Newsletter and email promotion must follow CAN-SPAM, platform rules, and any privacy rules that apply to that audience.',
    enforcement: 'surfaced',
    specRef: '§20 Affiliate during live campaign',
  },
  {
    key: 'student_affiliates',
    statement:
      'If you are a student Affiliate you act personally, and cannot imply your school or club endorses the campaign.',
    enforcement: 'surfaced',
    specRef: '§20 Affiliate during live campaign',
  },
  {
    key: 'disclosure',
    statement:
      'Every promotional post clearly discloses a paid or material relationship with this Founder and product — a native paid-promotion tool, a prominent #ad or #sponsored, story-integrated text, or a verbal pre-roll. It must be hard to miss and appear at the start or otherwise prominently.',
    enforcement: 'verified_on_evidence',
    specRef: '§20 Affiliate during live campaign',
  },
] as const;
