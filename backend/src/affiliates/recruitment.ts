/**
 * Admin recruits a campaign-specific Affiliate — Spec §8, §5.3, §23.4, §25.4.
 *
 * §8's phase is entirely Admin-side and deliberately quiet: it "can start
 * before, during, or after Founder onboarding" and "does not start the paid
 * 72-hour response clock." Nothing here notifies a Founder, moves a campaign,
 * or commits anyone to anything. It records who Proovd found and why.
 *
 * ── The prospect and the association are different lifetimes ────────────────
 * §25.4 splits its own record that way: an "Affiliate account" section and a
 * "Per campaign" section. So the person is one `affiliate_prospects` row and
 * each campaign they are recruited to is one `campaign_affiliate_associations`
 * row carrying its own recruitment source, recruiting Admin, timing, and
 * invitation status. Recruiting the same Creator to a second campaign creates a
 * second association and a second invitation — never a reuse of the first,
 * because §11 ties the Creator to "the one campaign that caused the invitation."
 *
 * ── Verification completeness is reported, not enforced ─────────────────────
 * §5.3's evidence table is per subtype and §8 requires "verification status and
 * evidence" recorded. But Admin builds this record incrementally from public
 * research, and §5.3 itself qualifies inputs with "where appropriate". So
 * `missingEvidence` reports the gap and `verified` is refused while a gap
 * remains — but an incomplete prospect saves. Refusing the save would push an
 * Admin to type something into an evidence field to get past it, which is a
 * worse record than an honestly incomplete one (§1.4).
 *
 * ── What this file cannot do ────────────────────────────────────────────────
 * Set a rate. §8: the internal quality tier is "used only as assessment
 * data—not as a commission floor", and §12/§14.3 own compensation from Phase 12.
 * There is no percentage, no floor, and no multiplier in this module, and the
 * tier it writes is free text a database CHECK refuses to let be numeric.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  campaigns,
  campaignAffiliateAssociations,
  associationStatus,
  associationStatusHistory,
} from '../db/schema/domain.js';

type AssociationStatusValue = (typeof associationStatus.enumValues)[number];
import { affiliateProspects, type AffiliateProspect } from '../db/schema/affiliates.js';
import { auditEvents } from '../db/schema/integrity.js';
import {
  AFFILIATE_SUBTYPES,
  VERIFICATION_STATUSES,
  missingEvidence,
  occupiesActiveSlot,
  slotUsage,
  type AffiliateSubtype,
  type SlotUsage,
  type VerificationStatus,
} from './registry.js';

/* ── Creating a prospect and its campaign association (§8) ─────────────────── */

export interface CreateAffiliateProspectInput {
  /** §8: full legal name. The person who must personally claim (§5.3). */
  legalName: string;
  /** §8: the public-facing name or handle. What the Founder sees (§11). */
  publicHandle: string;
  email: string;
  phone?: string | null;

  subtype: AffiliateSubtype;
  channelReference: string;
  audienceNiche: string;
  /**
   * §8's "why THIS campaign fits THIS channel", when Admin recorded one.
   *
   * Optional since 2026-08-11: the column has always been nullable, and the
   * Creator-workspace reference removes the visible control an Admin filled it
   * from. `admin-affiliates.ts` records the full reasoning; the short version
   * is §5.3's, that an honestly incomplete record beats a placeholder somebody
   * typed to get past a required box.
   */
  campaignFit?: string | null;
  audienceSize?: string | null;
  engagementEvidence?: Record<string, string> | null;
  audienceDemographics?: string | null;
  permissionBasis: string;
  priorSponsoredContent?: string | null;

  adminBio: string;
  /** §8: assessment data only. Free text; a CHECK refuses a numeric value. */
  qualityTier?: string | null;

  conflictNotes?: string | null;
  sanctionsNotes?: string | null;
  internalComments?: string | null;

  recruitmentSource: string;
  /** §8: the named recruiting Admin. §1.3: manual work counts when recorded. */
  recruitingAdmin: string;

  /** The one campaign this recruitment is for (§8, §11). */
  campaignId: string;
  /** §23.4: stored separately from the association status. */
  rosterIntent: 'initial_roster' | 'mid_campaign';

  /** `user:<id>` of the Admin. */
  actor: string;
}

export interface CreatedAffiliateProspect {
  prospectId: string;
  associationId: string;
}

export type CreateProspectResult =
  | { ok: true; value: CreatedAffiliateProspect }
  | { ok: false; message: string };

const trim = (value: string | null | undefined): string | null => {
  const next = value?.trim();
  return next ? next : null;
};

/**
 * §8: "Internal quality tier, used only as assessment data—not as a commission
 * floor."
 *
 * The database CHECK is the real guard; this is the same rule stated where an
 * Admin can be told about it, because a 500 from a constraint violation is a
 * worse experience than a sentence explaining why "3" is not a tier.
 */
function rejectNumericTier(tier: string | null): string | null {
  if (tier === null) return null;
  return /^[0-9]+([.,][0-9]+)?%?$/.test(tier.trim())
    ? 'A quality tier must not be a bare number or percentage. §8 makes it assessment data, never a commission floor — write what you concluded, not a score.'
    : null;
}

export async function createAffiliateProspect(
  db: Database,
  input: CreateAffiliateProspectInput,
): Promise<CreateProspectResult> {
  if (!AFFILIATE_SUBTYPES.includes(input.subtype)) {
    return { ok: false, message: 'That is not one of the §5.3 channel subtypes.' };
  }

  const tier = trim(input.qualityTier);
  const tierProblem = rejectNumericTier(tier);
  if (tierProblem) return { ok: false, message: tierProblem };

  const [campaign] = await db
    .select({ id: campaigns.id, status: campaigns.status, archivedAt: campaigns.archivedAt })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);

  if (!campaign) return { ok: false, message: 'That campaign does not exist.' };
  if (campaign.archivedAt) {
    // §9's wrong-type path archives a campaign and starts a fresh one. Nothing
    // is carried across, and that includes a roster — recruiting to the retired
    // record would attach a Creator to a campaign that will never run.
    return {
      ok: false,
      message:
        'That campaign was archived and replaced. Recruit to the replacement campaign instead — nothing carries across from an archived record.',
    };
  }

  return db.transaction(async (tx) => {
    const [prospect] = await tx
      .insert(affiliateProspects)
      .values({
        legalName: input.legalName.trim(),
        publicHandle: input.publicHandle.trim(),
        email: input.email.trim().toLowerCase(),
        phone: trim(input.phone),
        subtype: input.subtype,
        channelReference: input.channelReference.trim(),
        audienceNiche: input.audienceNiche.trim(),
        campaignFit: trim(input.campaignFit),
        audienceSize: trim(input.audienceSize),
        engagementEvidence: input.engagementEvidence ?? null,
        audienceDemographics: trim(input.audienceDemographics),
        permissionBasis: input.permissionBasis.trim(),
        priorSponsoredContent: trim(input.priorSponsoredContent),
        adminBio: input.adminBio.trim(),
        qualityTier: tier,
        conflictNotes: trim(input.conflictNotes),
        sanctionsNotes: trim(input.sanctionsNotes),
        internalComments: trim(input.internalComments),
        recruitmentSource: input.recruitmentSource.trim(),
        recruitingAdmin: input.recruitingAdmin.trim(),
        createdBy: input.actor,
      })
      .returning({ id: affiliateProspects.id });

    const [association] = await tx
      .insert(campaignAffiliateAssociations)
      .values({
        campaignId: input.campaignId,
        // The account does not exist yet — §8 recruits before §11 signs up. The
        // prospect id is the identity until a claim binds a user to it.
        affiliateId: prospect!.id,
        prospectId: prospect!.id,
        status: 'prospect',
        rosterMembership: input.rosterIntent,
        recruitmentSource: input.recruitmentSource.trim(),
        recruitingAdmin: input.recruitingAdmin.trim(),
        recruitedAt: new Date(),
        invitationStatus: 'draft',
      })
      .returning({ id: campaignAffiliateAssociations.id });

    // §23.4: every transition is append-only history, including the creation row.
    await tx.insert(associationStatusHistory).values({
      associationId: association!.id,
      fromStatus: null,
      toStatus: 'prospect',
      actor: input.actor,
    });

    await tx.insert(auditEvents).values({
      actor: input.actor,
      targetType: 'affiliate_association',
      targetId: association!.id,
      action: 'affiliate.prospect_created',
      internalReason: `recruited from ${input.recruitmentSource.trim()} by ${input.recruitingAdmin.trim()} for campaign ${input.campaignId} (§8)`,
      customerExplanation: null,
      newValue: {
        prospectId: prospect!.id,
        campaignId: input.campaignId,
        subtype: input.subtype,
        rosterIntent: input.rosterIntent,
        publicHandle: input.publicHandle.trim(),
      },
    });

    return { ok: true as const, value: { prospectId: prospect!.id, associationId: association!.id } };
  });
}

/* ── Editing (§8) ──────────────────────────────────────────────────────────── */

/**
 * Declared explicitly rather than derived from the create input, because the
 * two differ in a way that matters: a patch may *clear* a field, so every
 * value here is `string | null | undefined` where the create input has
 * `string`. `undefined` means "not in this request"; `null` means "empty it".
 * Deriving with `Partial<…>` would silently forbid clearing.
 *
 * `subtype`, `campaignId`, and `rosterIntent` are absent on purpose. The
 * subtype decides which §5.3 evidence the record needs, and changing it here
 * would leave evidence gathered against one requirement filed under another.
 * The campaign and the roster intent belong to the association, not the person.
 */
export interface UpdateProspectInput {
  legalName?: string | null;
  publicHandle?: string | null;
  email?: string | null;
  phone?: string | null;
  channelReference?: string | null;
  audienceNiche?: string | null;
  campaignFit?: string | null;
  audienceSize?: string | null;
  engagementEvidence?: Record<string, string> | null;
  audienceDemographics?: string | null;
  permissionBasis?: string | null;
  priorSponsoredContent?: string | null;
  adminBio?: string | null;
  qualityTier?: string | null;
  conflictNotes?: string | null;
  sanctionsNotes?: string | null;
  internalComments?: string | null;
  recruitmentSource?: string | null;
  recruitingAdmin?: string | null;
  actor: string;
}

/**
 * A save writes only the keys it was given.
 *
 * `undefined` means "not in this request", exactly as it does in the vetting
 * and claim-profile saves. The subtype is deliberately not updatable here: it
 * decides which §5.3 evidence the record needs, and silently changing it would
 * leave evidence gathered against one requirement filed under another.
 * Changing a subtype is `changeSubtype`, which says what it is doing.
 */
export async function updateAffiliateProspect(
  db: Database,
  prospectId: string,
  input: UpdateProspectInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const current = await readProspect(db, prospectId);
  if (!current) return { ok: false, message: 'That prospect does not exist.' };
  if (current.claimedAt) {
    return {
      ok: false,
      message:
        'This Creator has claimed their account. Their own details are theirs to correct from their settings (§11); Admin notes can still be edited.',
    };
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const prior: Record<string, unknown> = {};

  const text = (key: keyof UpdateProspectInput, column: string): void => {
    const incoming = input[key] as string | null | undefined;
    if (incoming === undefined) return;
    prior[column] = (current as unknown as Record<string, unknown>)[column] ?? null;
    patch[column] = trim(incoming);
  };

  text('legalName', 'legalName');
  text('publicHandle', 'publicHandle');
  text('phone', 'phone');
  text('channelReference', 'channelReference');
  text('audienceNiche', 'audienceNiche');
  text('campaignFit', 'campaignFit');
  text('audienceSize', 'audienceSize');
  text('audienceDemographics', 'audienceDemographics');
  text('permissionBasis', 'permissionBasis');
  text('priorSponsoredContent', 'priorSponsoredContent');
  text('adminBio', 'adminBio');
  text('conflictNotes', 'conflictNotes');
  text('sanctionsNotes', 'sanctionsNotes');
  text('internalComments', 'internalComments');
  text('recruitmentSource', 'recruitmentSource');
  text('recruitingAdmin', 'recruitingAdmin');

  if (input.email !== undefined) {
    prior['email'] = current.email;
    patch['email'] = trim(input.email)?.toLowerCase() ?? null;
  }

  if (input.qualityTier !== undefined) {
    const tier = trim(input.qualityTier);
    const problem = rejectNumericTier(tier);
    if (problem) return { ok: false, message: problem };
    prior['qualityTier'] = current.qualityTier;
    patch['qualityTier'] = tier;
  }

  if (input.engagementEvidence !== undefined) {
    prior['engagementEvidence'] = current.engagementEvidence;
    patch['engagementEvidence'] = input.engagementEvidence ?? null;
  }

  if (Object.keys(patch).length === 1) return { ok: true };

  await db.transaction(async (tx) => {
    await tx.update(affiliateProspects).set(patch).where(eq(affiliateProspects.id, prospectId));
    await tx.insert(auditEvents).values({
      actor: input.actor,
      targetType: 'affiliate_prospect',
      targetId: prospectId,
      action: 'affiliate.prospect_updated',
      internalReason: `recruitment record edited: ${Object.keys(prior).join(', ')}`,
      customerExplanation: null,
      priorValue: prior,
      newValue: patch,
    });
  });

  return { ok: true };
}

/* ── Verification (§8, §5.3) ───────────────────────────────────────────────── */

export interface RecordVerificationInput {
  status: VerificationStatus;
  evidence?: Record<string, string> | null;
  /** The named Admin who checked. §1.3: manual work counts when recorded. */
  verifiedBy: string;
  actor: string;
}

/**
 * Records the §8 verification decision.
 *
 * `verified` is refused while the subtype's §5.3 evidence is incomplete —
 * that is the one place completeness is enforced rather than reported, because
 * "verified" is a claim about evidence and a claim with no evidence behind it
 * is the §1.4 failure written into a column.
 */
export async function recordVerification(
  db: Database,
  prospectId: string,
  input: RecordVerificationInput,
): Promise<{ ok: true } | { ok: false; message: string; missing?: readonly string[] }> {
  if (!VERIFICATION_STATUSES.includes(input.status)) {
    return { ok: false, message: 'That is not a verification status.' };
  }
  if (!input.verifiedBy.trim()) {
    return { ok: false, message: 'Name who carried out the verification. It is stored.' };
  }

  const prospect = await readProspect(db, prospectId);
  if (!prospect) return { ok: false, message: 'That prospect does not exist.' };
  if (!prospect.subtype) {
    return { ok: false, message: 'This prospect has no channel subtype, so §5.3 names no evidence for it.' };
  }

  const evidence = input.evidence ?? (prospect.verificationEvidence as Record<string, string> | null);

  if (input.status === 'verified') {
    const missing = missingEvidence(prospect.subtype, evidence);
    if (missing.length > 0) {
      return {
        ok: false,
        message:
          'This cannot be recorded as verified while the evidence §5.3 requires for this channel type is missing.',
        missing,
      };
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(affiliateProspects)
      .set({
        verificationStatus: input.status,
        verificationEvidence: evidence ?? null,
        verifiedBy: input.verifiedBy.trim(),
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(affiliateProspects.id, prospectId));

    await tx.insert(auditEvents).values({
      actor: input.actor,
      targetType: 'affiliate_prospect',
      targetId: prospectId,
      action: 'affiliate.verification_recorded',
      internalReason: `verification ${prospect.verificationStatus} → ${input.status}, checked by ${input.verifiedBy.trim()} (§8, §5.3)`,
      customerExplanation: null,
      priorValue: { status: prospect.verificationStatus, verifiedBy: prospect.verifiedBy },
      newValue: { status: input.status, verifiedBy: input.verifiedBy.trim() },
    });
  });

  return { ok: true };
}

/* ── Reading ──────────────────────────────────────────────────────────────── */

export async function readProspect(
  db: Database,
  prospectId: string,
): Promise<AffiliateProspect | null> {
  const [row] = await db
    .select()
    .from(affiliateProspects)
    .where(eq(affiliateProspects.id, prospectId))
    .limit(1);
  return row ?? null;
}

export interface AssociationRecord {
  associationId: string;
  campaignId: string;
  prospectId: string;
  status: string;
  rosterMembership: string;
  invitationStatus: string;
  recruitmentSource: string | null;
  recruitingAdmin: string | null;
  recruitedAt: Date | null;
  prospect: AffiliateProspect;
  /** §5.3 evidence still missing for this subtype. Reported, never enforced. */
  missingEvidence: readonly string[];
  /** §2.2, across every campaign this person is associated with. */
  slots: SlotUsage;
}

export async function readAssociation(
  db: Database,
  associationId: string,
): Promise<AssociationRecord | null> {
  const [row] = await db
    .select({ association: campaignAffiliateAssociations, prospect: affiliateProspects })
    .from(campaignAffiliateAssociations)
    .innerJoin(
      affiliateProspects,
      eq(campaignAffiliateAssociations.prospectId, affiliateProspects.id),
    )
    .where(eq(campaignAffiliateAssociations.id, associationId))
    .limit(1);

  if (!row) return null;

  return {
    associationId: row.association.id,
    campaignId: row.association.campaignId,
    prospectId: row.prospect.id,
    status: row.association.status,
    rosterMembership: row.association.rosterMembership,
    invitationStatus: row.association.invitationStatus,
    recruitmentSource: row.association.recruitmentSource,
    recruitingAdmin: row.association.recruitingAdmin,
    recruitedAt: row.association.recruitedAt,
    prospect: row.prospect,
    missingEvidence: row.prospect.subtype
      ? missingEvidence(
          row.prospect.subtype,
          row.prospect.verificationEvidence as Record<string, string> | null,
        )
      : [],
    slots: await readSlotUsage(db, row.prospect.id),
  };
}

/**
 * §2.2's count, for one person across every campaign.
 *
 * Derived from the association states, never stored — see
 * `shared/src/affiliates/slots.ts`. Phase 08 cannot move an association into a
 * slot-occupying state, so this reads zero for everything it creates; it is
 * here because §8 has Admin recruit knowing whether a Creator is already at
 * three, and because Phase 14's activation enforces the cap by reading it.
 */
export async function readSlotUsage(db: Database, prospectId: string): Promise<SlotUsage> {
  const rows = await db
    .select({ status: campaignAffiliateAssociations.status })
    .from(campaignAffiliateAssociations)
    .where(eq(campaignAffiliateAssociations.prospectId, prospectId));

  return slotUsage(rows.map((r) => r.status));
}

export interface AffiliateRosterRow {
  associationId: string;
  prospectId: string;
  campaignId: string;
  legalName: string | null;
  publicHandle: string | null;
  email: string | null;
  subtype: AffiliateSubtype | null;
  status: string;
  invitationStatus: string;
  rosterMembership: string;
  verificationStatus: VerificationStatus;
  recruitingAdmin: string | null;
  lastSentAt: Date | null;
  claimedAt: Date | null;
  createdAt: Date;
}

/** Every Creator recruited to one campaign (§8, §26.1). */
export async function listCampaignAffiliates(
  db: Database,
  campaignId: string,
): Promise<AffiliateRosterRow[]> {
  return db
    .select({
      associationId: campaignAffiliateAssociations.id,
      prospectId: affiliateProspects.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      legalName: affiliateProspects.legalName,
      publicHandle: affiliateProspects.publicHandle,
      email: affiliateProspects.email,
      subtype: affiliateProspects.subtype,
      status: campaignAffiliateAssociations.status,
      invitationStatus: campaignAffiliateAssociations.invitationStatus,
      rosterMembership: campaignAffiliateAssociations.rosterMembership,
      verificationStatus: affiliateProspects.verificationStatus,
      recruitingAdmin: campaignAffiliateAssociations.recruitingAdmin,
      claimedAt: affiliateProspects.claimedAt,
      createdAt: campaignAffiliateAssociations.createdAt,
      lastSentAt: sql<Date | null>`(
        SELECT max(s.sent_at) FROM affiliate_invitation_sends s
         WHERE s.association_id = ${campaignAffiliateAssociations.id}
      )`.as('last_sent_at'),
    })
    .from(campaignAffiliateAssociations)
    .innerJoin(
      affiliateProspects,
      eq(campaignAffiliateAssociations.prospectId, affiliateProspects.id),
    )
    .where(eq(campaignAffiliateAssociations.campaignId, campaignId))
    .orderBy(desc(campaignAffiliateAssociations.createdAt));
}

/* ── The Founder's view (§8, §11) ──────────────────────────────────────────── */

/**
 * What a Founder may see of their recruited roster.
 *
 * §8: "The Founder does not browse or contact a general Affiliate pool. The
 * Founder may later see only the recruited campaign roster and its statuses."
 * §11: "the Founder may see the recruited Affiliate's public card and current
 * status. The Founder cannot contact the Affiliate directly or inspect
 * sensitive onboarding data."
 *
 * So this returns the public handle, the channel, the niche, the Admin bio, and
 * a status — and no email, no phone, no legal name, no quality tier, no
 * verification evidence, no internal comments, no conflict or sanctions notes.
 * The safest implementation of "cannot inspect" is a query that never selects
 * the columns: there is no filtering step here that could be skipped, because
 * the sensitive columns are not in the projection at all.
 */
export interface FounderVisibleCreator {
  associationId: string;
  publicHandle: string | null;
  subtype: AffiliateSubtype | null;
  audienceNiche: string | null;
  audienceSize: string | null;
  adminBio: string | null;
  status: string;
  rosterMembership: string;
}

export async function listFounderVisibleRoster(
  db: Database,
  campaignId: string,
): Promise<FounderVisibleCreator[]> {
  return db
    .select({
      associationId: campaignAffiliateAssociations.id,
      publicHandle: affiliateProspects.publicHandle,
      subtype: affiliateProspects.subtype,
      audienceNiche: affiliateProspects.audienceNiche,
      audienceSize: affiliateProspects.audienceSize,
      adminBio: affiliateProspects.adminBio,
      status: campaignAffiliateAssociations.status,
      rosterMembership: campaignAffiliateAssociations.rosterMembership,
    })
    .from(campaignAffiliateAssociations)
    .innerJoin(
      affiliateProspects,
      eq(campaignAffiliateAssociations.prospectId, affiliateProspects.id),
    )
    .where(eq(campaignAffiliateAssociations.campaignId, campaignId))
    .orderBy(desc(campaignAffiliateAssociations.createdAt));
}

/* ── Association transitions (§23.4) ───────────────────────────────────────── */

/**
 * Moves an association, recording the append-only history row §23 requires.
 *
 * The legal edges are the shared machine's (`associationMachine`), and this
 * does not restate them — it asks. A conditional UPDATE on the current status
 * settles concurrency: two requests moving the same association both matching
 * would be two history rows for one transition.
 */
export type AssociationExecutor = Pick<Database, 'update' | 'insert'>;

export async function transitionAssociation(
  associationId: string,
  from: AssociationStatusValue,
  to: AssociationStatusValue,
  actor: string,
  executor: AssociationExecutor,
  /**
   * The `association_status_history` row id when the transition happened, and
   * null when it matched nothing.
   *
   * Phase 22b widened this from `boolean`: §27.3's `founder_roster_update` must
   * dedup on the history ROW — §27.7's digest excludes a roster item whose
   * covering key already delivered, and that exclusion binds on this exact id.
   * A module-scoped "last id" would have been smaller and wrong: two concurrent
   * requests interleave at every `await`, and the caller reads it after one.
   * Every existing call site tests truthiness, which reads identically.
   */
): Promise<string | null> {
  const moved = await executor
    .update(campaignAffiliateAssociations)
    .set({ status: to, updatedAt: new Date() })
    .where(
      and(
        eq(campaignAffiliateAssociations.id, associationId),
        eq(campaignAffiliateAssociations.status, from),
      ),
    )
    .returning({ id: campaignAffiliateAssociations.id });

  if (moved.length !== 1) return null;

  const [history] = await executor
    .insert(associationStatusHistory)
    .values({
      associationId,
      fromStatus: from,
      toStatus: to,
      actor,
    })
    .returning({ id: associationStatusHistory.id });

  return history?.id ?? null;
}

export { occupiesActiveSlot };
