/**
 * What a Creator asks for from their own working surface — Creator Flow v2,
 * Session F, 2026-08-20.
 *
 * Three records, all of which already existed, none of which had a
 * Creator-facing route:
 *
 *   * the **§29.5 termination ask** — the reference's
 *     `Terminate / report founder`;
 *   * the **§29.1 self-pre-order disclosure** and the **§29.2 conflict
 *     disclosure** — both listed in `CREATOR_FLOW_OMISSIONS` as things the
 *     Spec requires and the prototype never drew.
 *
 * ── The termination ask opens a CASE, and does not write 0048's row ────────
 * This is a decision, and it departs from the brief's own sentence. 0048's
 * `association_termination_requests` requires a §24.8 `cause` and a
 * `money_treatment` from that cause's permitted matrix — and both are an
 * Admin's recorded judgement (20a). Asking a Creator to choose one is asking
 * them to classify a refund that does not exist, and every one of the five
 * causes asserts fault about somebody. There is no unclassified shape, and
 * adding one would weaken a CHECK that exists to stop the strongest treatments
 * becoming reachable.
 *
 * So the Creator states §29.5's reason and a person classifies it. The ask is a
 * §26.7 support case — real reference, real owner, §27.8's business-day promise
 * on the committed calendar — and the Admin's own control on the Creators
 * workspace records the classified 0048 row from it. `openAffiliateSupportCase`
 * took exactly this shape on 2026-08-17 and this reuses it rather than opening
 * a second queue.
 *
 * ── The two disclosures are recorded, not judged ──────────────────────────
 * §29.1 requires both certifications and the record CHECKs them; §29.2 requires
 * the relationship kind and the detail. Neither route decides anything: a
 * disclosure is a fact somebody states, and the consequence — an own-link
 * reservation's attribution moving to `blocked` — is the existing service's,
 * not this one's.
 */

import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { AuditWriter } from '../auth/audit.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { campaignAffiliateAssociations } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { openSupportCase } from '../support/cases.js';
import { recordConflictDisclosure, recordSelfPreorderDisclosure } from '../enforcement/affiliates.js';
import { TERMINATION_REASON_IDS } from '../creator-flow/logic.js';

export type AskResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: 'not_found' | 'invalid' | 'already_recorded'; message: string };

function invalid(message: string): { ok: false; code: 'invalid'; message: string } {
  return { ok: false, code: 'invalid', message };
}

/** §29.5's four reasons, with the sentence a case carries for each. */
const REASON_LINES: Record<string, string> = {
  founder_material_breach: 'The Creator says the Founder has broken the agreement.',
  proovd_suspension: 'The Creator wants the partnership to end with a suspended campaign.',
  emergency_or_capacity:
    'The Creator can no longer give the campaign the time they agreed to, or has an emergency.',
  other: 'The Creator asked to end the partnership for a reason they described themselves.',
};

/**
 * The Creator asks Proovd to end an active partnership.
 *
 * Ends nothing, decides no money, and changes no earnings state — 0048's own
 * header says that about the record an Admin later files, and it is truer of
 * this ask, which is a message with a deadline attached.
 */
export async function requestPartnershipEnd(
  db: Database,
  input: {
    userId: string;
    associationId: string;
    reasonId: string;
    detail: string;
    requesterEmail: string;
  },
): Promise<AskResult<{ caseId: string; reference: string; acknowledgement: string }>> {
  if (!(TERMINATION_REASON_IDS as readonly string[]).includes(input.reasonId)) {
    return invalid('Pick one of the reasons listed. Nothing else has a shape we can act on.');
  }
  const detail = input.detail.trim();
  if (!detail) {
    return invalid('Say what happened, in your own words. A person reads every one of these.');
  }

  const [owned] = await db
    .select({
      associationId: affiliateSignupProfiles.associationId,
      campaignId: campaignAffiliateAssociations.campaignId,
    })
    .from(affiliateSignupProfiles)
    .innerJoin(
      campaignAffiliateAssociations,
      eq(campaignAffiliateAssociations.id, affiliateSignupProfiles.associationId),
    )
    .where(
      and(
        eq(affiliateSignupProfiles.associationId, input.associationId),
        eq(affiliateSignupProfiles.claimedUserId, input.userId),
      ),
    )
    .limit(1);
  // Somebody else's partnership answers what a nonexistent one answers.
  if (!owned) {
    return { ok: false, code: 'not_found', message: 'There is no partnership at that address.' };
  }

  const [build] = await db
    .select({ title: campaignBuild.title })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, owned.campaignId))
    .limit(1);

  const result = await openSupportCase(db, {
    topic: 'campaign_question',
    // §26.7's owner is the accountable organisation, and this is Proovd's to
    // decide — routing it to the Founder would hand them the ask about
    // themselves.
    owner: 'proovd_support',
    requesterKind: 'creator',
    requesterUserId: input.userId,
    requesterEmail: input.requesterEmail,
    campaignId: owned.campaignId,
    associationId: input.associationId,
    message:
      `Asking to end the partnership on ${build?.title ?? 'a campaign'}.` +
      `

${REASON_LINES[input.reasonId] ?? ''}\n\n${detail}`,
    createdBy: input.userId,
  });
  if (!result.ok) return { ok: false, code: 'invalid', message: result.message };
  return {
    ok: true,
    caseId: result.result.caseId,
    reference: result.result.reference,
    // The same Appendix B.8 string the acknowledgement email carries — produced
    // once, so the screen and the inbox cannot disagree (§33.11.5).
    acknowledgement: result.result.acknowledgement,
  };
}

/** §29.1. Both certifications are required, by CHECK and by the service. */
export async function discloseOwnPreorder(
  db: Database,
  audit: AuditWriter,
  input: {
    userId: string;
    associationId: string;
    intentNote: string;
    selfFundedCertified: boolean;
    identityDisclosed: boolean;
  },
): Promise<AskResult<{ id: string }>> {
  const owns = await ownsAssociation(db, input.userId, input.associationId);
  if (!owns) {
    return { ok: false, code: 'not_found', message: 'There is no partnership at that address.' };
  }
  const result = await recordSelfPreorderDisclosure(
    { db, audit },
    {
      associationId: input.associationId,
      intentNote: input.intentNote,
      selfFundedCertified: input.selfFundedCertified,
      identityDisclosed: input.identityDisclosed,
      actor: input.userId,
    },
  );
  if (!result.ok) return { ok: false, code: result.code, message: result.message };
  return { ok: true, id: result.id };
}

/** §29.2. The relationship kind is a closed vocabulary; the detail is theirs. */
export async function discloseConflict(
  db: Database,
  audit: AuditWriter,
  input: { userId: string; associationId: string; relationshipKind: string; detail: string },
): Promise<AskResult<{ id: string }>> {
  const owns = await ownsAssociation(db, input.userId, input.associationId);
  if (!owns) {
    return { ok: false, code: 'not_found', message: 'There is no partnership at that address.' };
  }
  const result = await recordConflictDisclosure(
    { db, audit },
    {
      associationId: input.associationId,
      relationshipKind: input.relationshipKind as never,
      detail: input.detail,
      // §29.2 records who disclosed it. Here that is always the Creator.
      disclosedBy: 'affiliate',
      actor: input.userId,
    },
  );
  if (!result.ok) return { ok: false, code: result.code, message: result.message };
  return { ok: true, id: result.id };
}

async function ownsAssociation(
  db: Database,
  userId: string,
  associationId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: affiliateSignupProfiles.id })
    .from(affiliateSignupProfiles)
    .where(
      and(
        eq(affiliateSignupProfiles.associationId, associationId),
        eq(affiliateSignupProfiles.claimedUserId, userId),
      ),
    )
    .limit(1);
  return Boolean(row);
}
