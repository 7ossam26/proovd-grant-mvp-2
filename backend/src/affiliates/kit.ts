/**
 * The preparing Campaign kit — Spec §10, §14.1, §31.5, §12, §33.2.4.
 *
 * §10 fixes exactly what a Creator may read at this stage: "the complete
 * currently available Founder/problem/solution/competition information and the
 * single Campaign kit."
 *
 * ── Why this is much smaller than §14.1 ─────────────────────────────────────
 * §14.1 lists the *complete formal* opportunity kit — reward packages, prices,
 * delivery dates, base percentage, bonus, bid eligibility, tracking links.
 * Almost none of it exists yet: the campaign has not been built (Phase 12), the
 * listing fee has not been paid (Phase 11), and the high-effort classification
 * has not been computed (Phase 09). §10's phrase is "currently available", and
 * this returns what is currently available and says plainly what is not.
 *
 * Rendering an empty reward table or a blank percentage would be worse than
 * omitting them: it would look like a campaign offering nothing rather than a
 * campaign that has not been built. §1.4 in a layout.
 *
 * ── No compensation, at all ─────────────────────────────────────────────────
 * Phase 08's trap: "Preparing must not expose a compensation decision. Showing
 * the base percentage as information is fine; showing an actionable control is
 * not (§12)." At preparing there is no percentage to show — §12 and §14.3 set
 * it in Phase 12 — so this projection selects no compensation column, offers no
 * control, and says the terms are not set yet. A field that does not exist
 * cannot become an actionable one by accident.
 *
 * ── One kit ─────────────────────────────────────────────────────────────────
 * §14.1: "All material lives in one Campaign kit." §30 defers a reusable
 * resource library explicitly. There is one read here and one surface for it.
 *
 * ── Every read is logged, and revocation is checked on every read ───────────
 * §31.5's exception holds only while the pre-view is "private, authenticated,
 * logged, campaign-scoped, revocable". `readPreparingKit` refuses a revoked
 * association before selecting anything, and writes the access row in the same
 * call that returns the content — not in a middleware a later route could skip.
 */

import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { campaignKitAccess } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import { campaignVetting, founderClaimProfiles } from '../db/schema/vetting.js';

/** §3: the customer-facing names for the two internal campaign types. */
const CAMPAIGN_TYPE_LABEL: Record<string, string> = {
  pre_build: 'Idea Campaign',
  pre_launch: 'Product Campaign',
};

export type KitSection = 'campaign_information' | 'campaign_kit';

export interface PreparingKit {
  associationId: string;
  campaignId: string;
  /** §23.1's lifecycle, for the surface to say where the campaign is. */
  campaignStatus: string;
  /** §14.1: "Campaign state: preparing, formal decision open, live, or ended." */
  associationStatus: string;

  /* ── §10's four named areas ────────────────────────────────────────────── */
  founder: {
    /** The public-facing name. Never the legal name unless it is the same. */
    name: string | null;
    /** §14.1: "entity/sole-proprietor status". */
    entity: string | null;
    soleProprietor: boolean | null;
  };
  productName: string | null;
  problem: string | null;
  solution: string | null;
  competition: string | null;
  /** §3: rendered as "Idea Campaign" / "Product Campaign", never internally. */
  campaignType: string | null;

  /**
   * §14.1 items that do not exist yet, named so the surface can say which and
   * why rather than rendering an empty section.
   *
   * This is a list of *absences*, and it is deliberate: §1.4 forbids implying
   * an activity that is not there, and a kit that silently omitted the reward
   * table would read as a campaign with no rewards.
   */
  notYetAvailable: Array<{ item: string; because: string }>;

  /** §31.5. Always true at this stage — there is no work permission here. */
  workPermitted: false;
  /** §10: accept/decline/propose/activate are unreachable until listing payment. */
  decisionsAvailable: false;
}

export type KitRefusal = 'not_found' | 'revoked' | 'not_revealed';

export type ReadKitResult =
  | { ok: true; kit: PreparingKit }
  | { ok: false; code: KitRefusal; message: string; next: string };

/**
 * Reads the kit for one association, on behalf of one signed-in Creator.
 *
 * Takes the user id rather than trusting the association alone: §31.5's
 * "private, authenticated" means the caller must be the Creator this
 * association belongs to, and the check is here rather than only in the route
 * so that no future caller can reach the content without it.
 */
export async function readPreparingKit(
  db: Database,
  input: { associationId: string; affiliateUserId: string; section: KitSection },
): Promise<ReadKitResult> {
  const [row] = await db
    .select({
      associationId: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      associationStatus: campaignAffiliateAssociations.status,
      revealedAt: campaignAffiliateAssociations.preparingRevealedAt,
      revokedAt: campaignAffiliateAssociations.kitAccessRevokedAt,
      claimedUserId: affiliateSignupProfiles.claimedUserId,
      campaignStatus: campaigns.status,
      campaignType: campaigns.type,
      listingPaidAt: campaigns.listingPaidAt,
    })
    .from(campaignAffiliateAssociations)
    .innerJoin(campaigns, eq(campaignAffiliateAssociations.campaignId, campaigns.id))
    .innerJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    .where(
      and(
        eq(campaignAffiliateAssociations.id, input.associationId),
        // The authorization predicate, in the query rather than after it. A
        // Creator asking for someone else's association gets `not_found` —
        // the same answer as an association that does not exist, so the two
        // are indistinguishable and nothing can be enumerated.
        eq(affiliateSignupProfiles.claimedUserId, input.affiliateUserId),
      ),
    )
    .limit(1);

  if (!row) {
    return {
      ok: false,
      code: 'not_found',
      message: 'We could not find that campaign for your account.',
      next: 'Go back to your campaigns. If you think this is wrong, reply to the email we sent you.',
    };
  }

  // §10: "Revocation removes it immediately." Checked before a single field of
  // the Founder's material is selected.
  if (row.revokedAt) {
    return {
      ok: false,
      code: 'revoked',
      message: 'Your access to this campaign has been withdrawn.',
      next: 'Nothing you did caused this on its own. Reply to the email we sent you and we will explain.',
    };
  }

  if (!row.revealedAt) {
    return {
      ok: false,
      code: 'not_revealed',
      message: 'This campaign is not ready for you to read yet.',
      next: 'We will email you as soon as it is. There is nothing for you to do.',
    };
  }

  /* ── §10's four areas ───────────────────────────────────────────────────── */

  const [content] = await db
    .select({
      productName: founderProspects.productName,
      founderPreferred: founderClaimProfiles.preferredName,
      founderLegal: founderClaimProfiles.legalName,
      businessName: founderClaimProfiles.businessName,
      businessEntityType: founderClaimProfiles.businessEntityType,
      soleProprietor: founderClaimProfiles.soleProprietor,
      problem: campaignVetting.problemText,
      solution: campaignVetting.solutionText,
      competition: campaignVetting.competitionText,
    })
    .from(campaignDrafts)
    .innerJoin(founderProspects, eq(campaignDrafts.prospectId, founderProspects.id))
    .leftJoin(campaignVetting, eq(campaignVetting.draftId, campaignDrafts.id))
    .leftJoin(founderClaimProfiles, eq(founderClaimProfiles.draftId, campaignDrafts.id))
    .where(eq(campaignDrafts.campaignId, row.campaignId))
    .limit(1);

  // §31.5's log. Written in the same call that returns the content, so there is
  // no arrangement of routes in which the kit is served without a record of it.
  await db.insert(campaignKitAccess).values({
    associationId: row.associationId,
    campaignId: row.campaignId,
    affiliateUserId: input.affiliateUserId,
    section: input.section,
  });

  return {
    ok: true,
    kit: {
      associationId: row.associationId,
      campaignId: row.campaignId,
      campaignStatus: row.campaignStatus,
      associationStatus: row.associationStatus,
      founder: {
        // §11 gives the Founder a public card of the Creator; this is the
        // mirror. The Creator sees who they would be promoting for, which
        // §14.1 lists first, and no contact route — §30 defers direct
        // Founder–Affiliate messaging in both directions.
        name: content?.founderPreferred ?? content?.founderLegal ?? null,
        entity: content?.businessName ?? content?.businessEntityType ?? null,
        soleProprietor: content?.soleProprietor ?? null,
      },
      productName: content?.productName ?? null,
      problem: content?.problem ?? null,
      solution: content?.solution ?? null,
      competition: content?.competition ?? null,
      campaignType: row.campaignType ? (CAMPAIGN_TYPE_LABEL[row.campaignType] ?? null) : null,
      notYetAvailable: notYetAvailable(row.listingPaidAt !== null),
      workPermitted: false,
      decisionsAvailable: false,
    },
  };
}

/**
 * The §14.1 items a preparing kit cannot carry yet, each with the reason.
 *
 * Naming the absence is the honest alternative to rendering an empty section.
 * Every entry here becomes available in a phase that is named, so a Creator
 * reading it learns the campaign is early rather than that it is thin.
 */
function notYetAvailable(listingPaid: boolean): PreparingKit['notYetAvailable'] {
  return [
    {
      item: 'Rewards, prices, and delivery dates',
      because: 'The Founder has not built the campaign page yet.',
    },
    {
      item: 'How much you would be paid',
      because:
        'Compensation is agreed when the campaign formally opens. Nothing is set yet, and nothing here is an offer.',
    },
    {
      item: 'Campaign open and close dates',
      because: 'They are fixed when the campaign is approved to go live.',
    },
    {
      item: 'Required posts and deliverables',
      because: 'They are part of the formal opportunity, not this preview.',
    },
    {
      item: 'Tracking links and disclosure text',
      because: 'They are issued after you accept a formal opportunity.',
    },
    ...(listingPaid
      ? []
      : [
          {
            item: 'The high-effort result',
            because: 'It is worked out with the Founder before the campaign opens.',
          },
        ]),
  ];
}

/* ── The Creator's own campaign list ──────────────────────────────────────── */

export interface CreatorCampaignRow {
  associationId: string;
  campaignId: string;
  productName: string | null;
  status: string;
  revealedAt: Date | null;
  revoked: boolean;
  /** True only when there is something to read — drives the one action. */
  reviewAvailable: boolean;
}

/**
 * Every campaign this Creator is associated with.
 *
 * Scoped by user id, so there is no campaign id in the request to substitute.
 * A revoked association still appears — the Creator was told about it, and a
 * campaign that silently vanished would be more alarming than one that says
 * access was withdrawn — but it carries no review action.
 */
export async function listCreatorCampaigns(
  db: Database,
  affiliateUserId: string,
): Promise<CreatorCampaignRow[]> {
  const rows = await db
    .select({
      associationId: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      status: campaignAffiliateAssociations.status,
      revealedAt: campaignAffiliateAssociations.preparingRevealedAt,
      revokedAt: campaignAffiliateAssociations.kitAccessRevokedAt,
      productName: founderProspects.productName,
    })
    .from(campaignAffiliateAssociations)
    .innerJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    .leftJoin(campaignDrafts, eq(campaignDrafts.campaignId, campaignAffiliateAssociations.campaignId))
    .leftJoin(founderProspects, eq(campaignDrafts.prospectId, founderProspects.id))
    .where(eq(affiliateSignupProfiles.claimedUserId, affiliateUserId));

  return rows.map((row) => ({
    associationId: row.associationId,
    campaignId: row.campaignId,
    productName: row.productName,
    status: row.status,
    revealedAt: row.revealedAt,
    revoked: row.revokedAt !== null,
    reviewAvailable: row.revealedAt !== null && row.revokedAt === null,
  }));
}

/** §10: Admin sees every access. The log, in full, for one association. */
export async function readAccessLog(db: Database, associationId: string) {
  return db
    .select()
    .from(campaignKitAccess)
    .where(eq(campaignKitAccess.associationId, associationId))
    .orderBy(campaignKitAccess.occurredAt);
}
