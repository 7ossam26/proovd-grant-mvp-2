/**
 * The signup confirmation send — Spec §11, §27.2, §27.4, §33.2.3.
 *
 * Separate from `signup.ts` because it runs *after* the claim transaction
 * commits. A confirmation for an account that does not exist is worse than a
 * missing one: the Creator would be told to sign in to nothing. So the
 * transaction owns the account, and this owns the message.
 *
 * ── The dedup key is the association ────────────────────────────────────────
 * Unlike the invitation — where §8 requires resend to work, so the key had to
 * be the SEND — a signup happens once per association and §27.2's rule is the
 * only one in play: "duplicate webhook/job delivery cannot create a duplicate
 * email." Keying on the association is therefore correct here and would have
 * been wrong there. The difference is not stylistic: it is which Spec rule
 * applies, and the `notification_deliveries` constraint enforces whichever key
 * is chosen.
 *
 * ── A failed send does not undo an account ─────────────────────────────────
 * If the provider refuses, the account still exists and the Creator can still
 * sign in — so this records the failure and returns, rather than throwing into
 * a route that has already created something. Admin sees the unconfirmed
 * delivery and can resend. Rolling the account back to keep the email and the
 * account in step would destroy the more valuable of the two.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { Notifier } from '../notifications/send.js';
import { AFFILIATE_SIGNUP_CONFIRMED } from '../notifications/events.js';
import { renderSignupConfirmed } from '../notifications/templates/affiliate-signup-confirmed.js';
import { campaignAffiliateAssociations } from '../db/schema/domain.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import { auditEvents } from '../db/schema/integrity.js';

/**
 * §27.1 requires a next-update expectation, and §11 requires the waiting state
 * to give one.
 *
 * Deliberately not a date. §6 fixes no deadline for a Founder finishing setup —
 * there is no setting for it and §1 rule 6 forbids inventing one — so promising
 * "within five business days" would be a commitment Proovd has not made. What
 * is true is the trigger: the next update comes when the Founder finishes, and
 * Proovd is the one watching for it.
 */
export const NEXT_UPDATE_EXPECTATION =
  'We will email you as soon as the Founder finishes setting up and the campaign is ready ' +
  'to review. We are not waiting on anything from you, and you do not need to check back.';

export interface SignupNotificationDeps {
  db: Database;
  notifier: Notifier;
  context: { appBaseUrl: string; supportEmail: string; fromAddress: string };
}

export async function sendSignupConfirmation(
  { db, notifier, context }: SignupNotificationDeps,
  associationId: string,
): Promise<{ sent: boolean }> {
  const [row] = await db
    .select({
      email: affiliateSignupProfiles.email,
      publicHandle: affiliateSignupProfiles.publicHandle,
      legalName: affiliateSignupProfiles.legalName,
      campaignId: campaignAffiliateAssociations.campaignId,
      productName: founderProspects.productName,
    })
    .from(affiliateSignupProfiles)
    .innerJoin(
      campaignAffiliateAssociations,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    // Left, because §8's recruitment can precede Founder onboarding. A campaign
    // with no draft yet is a legitimate state, and the product name falls back
    // to a truthful placeholder rather than blocking the confirmation.
    .leftJoin(campaignDrafts, eq(campaignDrafts.campaignId, campaignAffiliateAssociations.campaignId))
    .leftJoin(founderProspects, eq(campaignDrafts.prospectId, founderProspects.id))
    .where(eq(affiliateSignupProfiles.associationId, associationId))
    .limit(1);

  if (!row?.email) return { sent: false };

  const message = await renderSignupConfirmed({
    recipientName: row.publicHandle || row.legalName,
    productName: row.productName ?? 'the campaign you were invited to',
    nextUpdate: NEXT_UPDATE_EXPECTATION,
    reference: row.campaignId,
    supportEmail: context.supportEmail,
  });

  const outcome = await notifier.send({
    eventKey: AFFILIATE_SIGNUP_CONFIRMED,
    entityType: 'affiliate_association',
    entityId: associationId,
    to: row.email,
    from: context.fromAddress,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });

  if (outcome.status === 'failed') {
    await db.insert(auditEvents).values({
      actor: 'system',
      targetType: 'affiliate_association',
      targetId: associationId,
      action: 'affiliate.signup_confirmation_failed',
      internalReason: `provider refused: ${outcome.reason}`,
      customerExplanation: null,
      newValue: { deliveryConfirmed: false },
    });
    return { sent: false };
  }

  return { sent: outcome.status === 'sent' };
}
