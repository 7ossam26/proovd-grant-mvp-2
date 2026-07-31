/**
 * Compensation matrix and percentage ceiling — Spec §14.3, §6.
 *
 * Six cells resolve base percentage, bid eligibility, and fixed-payment
 * availability from campaign type × high-effort × fixed-payment accepted:
 *
 *   | Campaign              | Fixed payment | Base | Bid above base            |
 *   | Idea, standard        | Prohibited    | 30%  | No                        |
 *   | Idea, high effort     | Prohibited    | 30%  | Yes, total capped at 50%  |
 *   | Product, standard     | None          | 30%  | No                        |
 *   | Product, standard     | Accepted      | 20%  | No                        |
 *   | Product, high effort  | None          | 30%  | Yes, total capped at 50%  |
 *   | Product, high effort  | Accepted      | 20%  | Yes, total capped at 50%  |
 *
 * Naming (§3): `pre_build` = Idea Campaign, `pre_launch` = Product Campaign —
 * internal names only, never rendered to a Founder or Backer.
 */

import {
  AFFILIATE_BASE_PERCENT_STANDARD,
  AFFILIATE_BASE_PERCENT_WITH_FIXED,
  PERCENTAGE_CEILING,
} from './constants.js';
import { assertPercent } from './cents.js';
import { MoneyRuleError } from './errors.js';

export type CampaignType = 'pre_build' | 'pre_launch';

export interface CompensationCell {
  basePercent: number;
  /** §14.3: bidding above base is high-effort-only. */
  bidAllowed: boolean;
  /** §14.3: fixed Creator payment is Product-only; prohibited on Idea. */
  fixedPaymentAllowed: boolean;
}

/**
 * Resolves one of the six §14.3 cells. Throws when the combination itself is
 * illegal — a fixed payment accepted on an Idea Campaign is not a cell, it is
 * a rule violation (§33.2.8).
 */
export function resolveCompensation(
  campaignType: CampaignType,
  highEffort: boolean,
  fixedPaymentAccepted: boolean,
): CompensationCell {
  if (campaignType === 'pre_build' && fixedPaymentAccepted) {
    throw new MoneyRuleError(
      'fixed Creator payment is prohibited on an Idea Campaign (§14.3)',
    );
  }

  return {
    basePercent: fixedPaymentAccepted
      ? AFFILIATE_BASE_PERCENT_WITH_FIXED
      : AFFILIATE_BASE_PERCENT_STANDARD,
    bidAllowed: highEffort,
    fixedPaymentAllowed: campaignType === 'pre_launch',
  };
}

/**
 * Validates an Affiliate proposal against the resolved cell (§14.2, §33.2.8):
 * a percentage bid above base only when high-effort; a fixed-payment request
 * only on a Product Campaign. `bidPercent` is the proposed TOTAL percentage
 * (base + increase); on a standard campaign any value above base is rejected.
 */
export function validateProposal(
  cell: CompensationCell,
  proposal: { bidPercent?: number; fixedPaymentRequested?: boolean },
): void {
  const { bidPercent, fixedPaymentRequested } = proposal;

  if (fixedPaymentRequested && !cell.fixedPaymentAllowed) {
    throw new MoneyRuleError(
      'fixed Creator payment request is prohibited on this campaign (§14.3)',
    );
  }

  if (bidPercent !== undefined) {
    assertPercent(bidPercent, 100, 'bidPercent');
    if (bidPercent > cell.basePercent && !cell.bidAllowed) {
      throw new MoneyRuleError(
        'a bid above the base percentage requires a high-effort campaign (§14.3)',
      );
    }
    if (bidPercent > PERCENTAGE_CEILING) {
      throw new MoneyRuleError(
        `total percentage may never exceed ${PERCENTAGE_CEILING}% (§6, §14.3)`,
      );
    }
  }
}

/**
 * The percentage ceiling (§6, §14.3): base + bid increase + bonus never
 * exceeds 50% per attributed captured charge. A fixed amount sits outside the
 * ceiling — deliberately not a parameter here, so it cannot be counted.
 *
 * Returns the combined total percentage after validating it.
 */
export function combinedPercent(parts: {
  basePercent: number;
  bidIncreasePercent?: number;
  bonusPercent?: number;
}): number {
  const base = parts.basePercent;
  const bid = parts.bidIncreasePercent ?? 0;
  const bonus = parts.bonusPercent ?? 0;
  assertPercent(base, PERCENTAGE_CEILING, 'basePercent');
  assertPercent(bid, PERCENTAGE_CEILING, 'bidIncreasePercent');
  assertPercent(bonus, PERCENTAGE_CEILING, 'bonusPercent');

  const total = base + bid + bonus;
  if (total > PERCENTAGE_CEILING) {
    throw new MoneyRuleError(
      `base + bid + bonus = ${total}% exceeds the ${PERCENTAGE_CEILING}% ceiling (§6, §14.3)`,
    );
  }
  return total;
}
