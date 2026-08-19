/**
 * The Creator referral — Creator Flow v2 **deviation 3**, Session D, 2026-08-19.
 *
 * ═══ A RECORDED DEVIATION FROM §1 RULE 6, BY EXPLICIT PRODUCT DIRECTION ═════
 *
 * The full reasoning is in `shared/src/creator-flow/referrals.ts` and migration
 * 0055 section 5. Three things belong here, where somebody editing this file
 * will read them.
 *
 * ── It is an introduction, and nothing here admits anybody ────────────────
 * This module creates no account, no `affiliate_prospects` row, no association,
 * and no token. It writes one row and one audit event. §5.3's first sentence —
 * "No open public signup. Enters only through a private, campaign-specific
 * invitation" — stays true because the person referred still enters exactly the
 * way everybody else does, through §8's recruitment, and if nobody recruits
 * them nothing happens.
 *
 * ── It pays nothing, and the enforcement is the column set ────────────────
 * `affiliate_referrals` has no amount, percentage, commission, currency, or
 * cents column, and a test asserts the exact set. §24 defines four money
 * streams and a referral payment would be a fifth, paid out of somebody else's
 * campaign to a person with no association to it.
 *
 * ── An Admin reads it, and that is why there is an audit row ──────────────
 * §1.4: a form that records something nobody will ever see is a promise. There
 * is no §27 key for a referral — inventing one would be inventing a message the
 * Spec does not define — so the destination is the record plus an
 * `audit_events` row, which the Creators workspace history renders through its
 * own allowlist. That is the arrangement `founder_meeting_notes` already uses:
 * a fact reaches an Admin through a history that composes rather than through a
 * notification nobody specified.
 */

import { desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { AuditWriter } from '../auth/audit.js';
import { affiliateReferrals } from '../db/schema/creator-flow.js';

export interface ReferralInput {
  referredName: string;
  referredContact: string;
  relationship: string;
  why: string;
  note?: string | undefined;
}

export type ReferralOutcome =
  | { ok: true; id: string }
  | { ok: false; code: 'incomplete'; missing: string[]; message: string };

const REQUIRED: readonly (keyof ReferralInput)[] = [
  'referredName',
  'referredContact',
  'relationship',
  'why',
];

/**
 * Record one referral.
 *
 * The four required answers are refused by name in the service AND by 0055's
 * `affiliate_referral_fields_present` CHECK regardless — the service refuses
 * first so a Creator reads a sentence rather than a constraint name, and the
 * CHECK refuses a hand-written INSERT the same way. `relationship` and `why`
 * are required because they are what makes this a vouch rather than an address
 * harvest, which is the whole distinction between an introduction and a signup
 * route.
 */
export async function recordCreatorReferral(
  db: Database,
  audit: AuditWriter,
  input: ReferralInput & { referrerProspectId: string; actorId: string },
): Promise<ReferralOutcome> {
  const missing = REQUIRED.filter((key) => !(input[key] ?? '').trim());
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'incomplete',
      missing: missing as string[],
      message:
        'We need their name, a way to reach them, how you know them, and why you would vouch for them. An Admin reads all four before deciding whether to look into it.',
    };
  }

  const [row] = await db
    .insert(affiliateReferrals)
    .values({
      referrerProspectId: input.referrerProspectId,
      referredName: input.referredName.trim(),
      referredContact: input.referredContact.trim(),
      relationship: input.relationship.trim(),
      why: input.why.trim(),
      note: input.note?.trim() || null,
    })
    .returning({ id: affiliateReferrals.id });

  await audit({
    actorId: input.actorId,
    action: 'affiliate.referral_recorded',
    targetType: 'affiliate_prospect',
    targetId: input.referrerProspectId,
    // The target is the REFERRER, so this lands on the history of the person
    // who vouched — which is where an Admin deciding whether to act on it wants
    // it. The referred person has no record here to attach anything to, and
    // creating one would be the signup route this deviation refuses.
    internalReason:
      'A Creator referred somebody for §8 recruitment. No account, association, or invitation was created; the referral pays nothing.',
  });

  return { ok: true, id: row?.id ?? '' };
}

/** Every referral one Creator has made, newest first. */
export async function listCreatorReferrals(db: Database, prospectId: string) {
  return db
    .select({
      id: affiliateReferrals.id,
      referredName: affiliateReferrals.referredName,
      state: affiliateReferrals.state,
      recordedAt: affiliateReferrals.recordedAt,
    })
    .from(affiliateReferrals)
    .where(eq(affiliateReferrals.referrerProspectId, prospectId))
    .orderBy(desc(affiliateReferrals.recordedAt));
}
