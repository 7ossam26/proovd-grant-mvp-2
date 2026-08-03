/**
 * Pre-order consent resolution — Spec §19, §25.2.
 *
 * Resolves Appendix A.3 (Idea) or A.4 (Product) from the ledger's own values,
 * hashes the exact text, and returns everything a reservation records: the
 * appendix, the version, the SHA-256 hash, and the resolved body itself. §19:
 * "Store the consent text version and hash with the reservation." A dispute
 * (§24.11) reconciles against that stored text.
 *
 * The amounts are formatted with `formatCents` before they reach the shared
 * resolver, which refuses anything that is not a formatted amount — so a total
 * the Backer never saw can never be hashed as one they agreed to (§19).
 */

import { createHash } from 'node:crypto';
import {
  formatCents,
  resolveIdeaConsent,
  resolveProductConsent,
  type ResolvedPreorderConsent,
} from './restated.js';
import type { PreorderContext } from './context.js';

export interface BuiltConsent {
  appendix: 'A.3' | 'A.4';
  version: string;
  hash: string;
  text: string;
  marketingLabel: string;
  action: string;
  /** The close instant rendered as the consent's `[CLOSE DATE — UTC]` copy. */
  closeDateUtc: string;
  /** The amounts, formatted, for the surface that renders the same values. */
  rewardSubtotal: string;
  salesTax: string;
  totalAuthorized: string;
}

/** `2026-03-03T17:00:00Z` → `March 3, 2026, 5:00 PM UTC`. */
export function formatUtcInstant(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
  return `${parts} UTC`;
}

/** The Product policy reference line, or a truthful fallback while one is absent. */
function policyReference(context: PreorderContext): { reference: string; url: string } {
  const p = context.refundPolicy;
  if (p && p.title) {
    const version = p.version ? ` ${p.version}` : '';
    const effective = p.effectiveDate ? ` (effective ${p.effectiveDate})` : '';
    return {
      reference: `${p.title}${version}${effective}`,
      url: p.sourceUrl ?? 'proovd.co/refunds',
    };
  }
  // A live Product build carries a policy; this keeps the consent renderable if
  // it is momentarily absent, and never invents a version it does not have.
  return { reference: "the Founder's campaign refund policy", url: 'proovd.co/refunds' };
}

export interface BuildConsentInput {
  context: PreorderContext;
  rewardTitle: string;
  rewardDelivery: string;
  subtotalCents: bigint;
  taxCents: bigint;
}

/** Resolves the campaign-type-specific consent and hashes it. */
export function buildConsent(input: BuildConsentInput): BuiltConsent {
  const { context } = input;
  const totalCents = input.subtotalCents + input.taxCents;
  const rewardSubtotal = formatCents(input.subtotalCents);
  const salesTax = formatCents(input.taxCents);
  const totalAuthorized = formatCents(totalCents);
  const closeDateUtc = formatUtcInstant(context.closeAt);

  let resolved: ResolvedPreorderConsent;
  let appendix: 'A.3' | 'A.4';
  if (context.model === 'idea') {
    appendix = 'A.3';
    resolved = resolveIdeaConsent({
      campaignTitle: context.title,
      founderLegalName: context.founder.legalName,
      rewardPackageName: input.rewardTitle,
      rewardSubtotal,
      salesTax,
      totalAuthorized,
      closeDateUtc,
      orderThreshold: String(context.orderThreshold ?? 0),
      expectedStatementDescriptor: context.statementDescriptor,
    });
  } else {
    appendix = 'A.4';
    const policy = policyReference(context);
    resolved = resolveProductConsent({
      campaignTitle: context.title,
      founderLegalName: context.founder.legalName,
      rewardPackageName: input.rewardTitle,
      rewardSubtotal,
      salesTax,
      totalAuthorized,
      closeDateUtc,
      deliveryMonthYear: input.rewardDelivery,
      policyReference: policy.reference,
      preservedPolicyUrl: policy.url,
      expectedStatementDescriptor: context.statementDescriptor,
    });
  }

  const hash = createHash('sha256').update(resolved.body, 'utf8').digest('hex');

  return {
    appendix,
    version: resolved.version,
    hash,
    text: resolved.body,
    marketingLabel: resolved.marketingLabel,
    action: resolved.action,
    closeDateUtc,
    rewardSubtotal,
    salesTax,
    totalAuthorized,
  };
}
