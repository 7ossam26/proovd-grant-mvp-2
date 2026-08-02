/**
 * The three formal decisions and the proposal versions — Spec §14.2, §14.3,
 * §23.4, §31.5, §33.2.5–§33.2.13.
 *
 * ── The distributed-agreement core, and where each guarantee lives ──────────
 * Two parties responding concurrently to different versions must resolve to
 * exactly one locked version or none — never two (§33.2.9, §33.2.10). Four
 * layers, from softest to hardest:
 *
 *   1. Every response begins by locking the ASSOCIATION row (`FOR UPDATE`), so
 *      responses to one Creator's proposals are serialized outright.
 *   2. Every state change is a conditional UPDATE on the version's current
 *      state; a stale response — acceptance of a superseded version, a second
 *      acceptance, a counter to a resolved version — matches nothing.
 *   3. `proposal_versions_one_open` and `proposal_versions_one_locked`
 *      (partial unique indexes, migration 0017) make a second open or a second
 *      locked version impossible for ANY writer, including one that skips 1–2.
 *   4. The agreement row is unique on the association, so even a defeated
 *      version machine cannot record two compensations for one Creator.
 *
 * ── The matrix is read from `app_settings`, not from constants ──────────────
 * Phase 06's rule: `shared/money/constants` is seed defaults only. The base
 * percentages and the ceiling come from the §6 settings in force at decision
 * time; the shared `resolveCompensation`/`validateProposal` kernel stays the
 * unit-tested reference and the suite walks both to prove they agree.
 *
 * ── Admin mediates; Admin never agrees ──────────────────────────────────────
 * §14.2: "Admin may mediate or reject policy-violating terms but cannot
 * substitute for both parties' acceptance." `adminRejectVersion` moves a
 * version to `rejected_by_admin` — a terminal state with no path to `locked`
 * — and there is no function in this module that accepts on a party's behalf.
 */

import { and, count, desc, eq, inArray, max } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Database } from '../db/client.js';
import {
  campaigns,
  campaignAffiliateAssociations,
} from '../db/schema/domain.js';
import {
  proposalVersions,
  associationCompensationAgreements,
  associationAcceptanceConfirmations,
  trackingLinks,
  creatorBonuses,
  type ProposalVersion,
  type AssociationCompensationAgreement,
  type CreatorBonus,
  type TrackingLink,
} from '../db/schema/decisions.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { highEffortClassifications } from '../db/schema/workspace.js';
import { LINK_TEST_MARKER } from './roster-labels.js';
import { policyVersions } from '../db/schema/policies.js';
import { policyConsents } from '../db/schema/vetting.js';
import { listingFeePayments } from '../db/schema/listing.js';
import type { AuditWriter } from '../auth/audit.js';
import { readSettingValue } from '../settings/service.js';
import { transitionAssociation } from './recruitment.js';

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'execute'>;

/* ── The §14.3 cell, from the settings in force ───────────────────────────── */

/** §31.5's per-campaign agreement; the §14.2 acceptance requires it. */
export const IP_AGREEMENT_SLUG = 'ip-agreement';
/** The "campaign terms and AUP state" §14.2 records at acceptance. */
export const TERMS_AUP_SLUGS = ['terms', 'affiliate-aup', 'aup'] as const;

export interface CompensationSettings {
  standardBasePercent: number;
  withFixedBasePercent: number;
  ceilingPercent: number;
}

export async function readCompensationSettings(db: Executor): Promise<CompensationSettings> {
  const percent = async (key: string): Promise<number> => {
    const value = await readSettingValue(db as Database, key);
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100) {
      throw new Error(`setting "${key}" is not a usable percentage`);
    }
    return value;
  };
  return {
    standardBasePercent: await percent('affiliate_base_percent_standard'),
    withFixedBasePercent: await percent('affiliate_base_percent_with_fixed'),
    ceilingPercent: await percent('affiliate_percentage_ceiling'),
  };
}

export interface MatrixCell {
  basePercent: number;
  /** §14.3: bidding above base is high-effort-only. */
  bidAllowed: boolean;
  /** §14.3: a fixed Creator payment is Product-only; prohibited on Idea. */
  fixedPaymentAllowed: boolean;
  ceilingPercent: number;
}

/**
 * One of §14.3's six cells, for a campaign. The shared
 * `resolveCompensation` kernel is the unit-tested reference; this reads the
 * same three facts from the campaign row and the settings in force, and the
 * suite walks all six cells through both to prove they agree (§33.2.7).
 */
export function resolveCell(
  settings: CompensationSettings,
  campaign: { campaignType: 'pre_build' | 'pre_launch'; highEffort: boolean },
  fixedPaymentAccepted: boolean,
): MatrixCell {
  if (campaign.campaignType === 'pre_build' && fixedPaymentAccepted) {
    throw new Error('fixed Creator payment is prohibited on an Idea Campaign (§14.3)');
  }
  return {
    basePercent: fixedPaymentAccepted
      ? settings.withFixedBasePercent
      : settings.standardBasePercent,
    bidAllowed: campaign.highEffort,
    fixedPaymentAllowed: campaign.campaignType === 'pre_launch',
    ceilingPercent: settings.ceilingPercent,
  };
}

/* ── Loading one association on behalf of one caller ──────────────────────── */

/** The statuses in which the formal decision is open to act on (§14.2). */
const DECISION_OPEN_STATUSES = ['formal_decision_open', 'reviewing', 'proposal_pending'] as const;

export interface DecisionContext {
  associationId: string;
  campaignId: string;
  associationStatus: string;
  kitRevokedAt: Date | null;
  creatorEmail: string | null;
  creatorHandle: string | null;
  campaignType: 'pre_build' | 'pre_launch';
  highEffort: boolean;
  responseDeadlineAt: Date | null;
  campaignStatus: string;
}

/**
 * The association, scoped to the calling Creator INSIDE the query (§5.5's
 * posture): someone else's association answers null, the same as one that
 * does not exist.
 */
async function loadForCreator(
  tx: Executor,
  associationId: string,
  affiliateUserId: string,
): Promise<DecisionContext | null> {
  const [row] = await tx
    .select({
      associationId: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      associationStatus: campaignAffiliateAssociations.status,
      kitRevokedAt: campaignAffiliateAssociations.kitAccessRevokedAt,
      creatorEmail: affiliateSignupProfiles.email,
      creatorHandle: affiliateSignupProfiles.publicHandle,
      campaignType: campaigns.type,
      highEffort: campaigns.highEffort,
      campaignStatus: campaigns.status,
      responseDeadlineAt: listingFeePayments.responseDeadlineAt,
    })
    .from(campaignAffiliateAssociations)
    .innerJoin(campaigns, eq(campaigns.id, campaignAffiliateAssociations.campaignId))
    .innerJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    .leftJoin(listingFeePayments, eq(listingFeePayments.campaignId, campaigns.id))
    .where(
      and(
        eq(campaignAffiliateAssociations.id, associationId),
        eq(affiliateSignupProfiles.claimedUserId, affiliateUserId),
      ),
    )
    .limit(1);

  if (!row || !row.campaignType) return null;
  return {
    associationId: row.associationId,
    campaignId: row.campaignId,
    associationStatus: row.associationStatus,
    kitRevokedAt: row.kitRevokedAt,
    creatorEmail: row.creatorEmail,
    creatorHandle: row.creatorHandle,
    campaignType: row.campaignType,
    highEffort: row.highEffort === true,
    responseDeadlineAt: row.responseDeadlineAt,
    campaignStatus: row.campaignStatus,
  };
}

/** The Founder's own campaign, or null — the same join `findFounderCampaign` uses. */
async function loadForFounder(
  tx: Executor,
  campaignId: string,
  founderUserId: string,
): Promise<{ campaignId: string; campaignType: 'pre_build' | 'pre_launch'; highEffort: boolean; campaignStatus: string; responseDeadlineAt: Date | null } | null> {
  const [row] = await tx
    .select({
      campaignId: campaigns.id,
      campaignType: campaigns.type,
      highEffort: campaigns.highEffort,
      campaignStatus: campaigns.status,
      responseDeadlineAt: listingFeePayments.responseDeadlineAt,
    })
    .from(campaigns)
    .innerJoin(founderClaimProfiles, eq(founderClaimProfiles.campaignId, campaigns.id))
    .leftJoin(listingFeePayments, eq(listingFeePayments.campaignId, campaigns.id))
    .where(and(eq(campaigns.id, campaignId), eq(founderClaimProfiles.claimedUserId, founderUserId)))
    .limit(1);
  if (!row || !row.campaignType) return null;
  return {
    campaignId: row.campaignId,
    campaignType: row.campaignType,
    highEffort: row.highEffort === true,
    campaignStatus: row.campaignStatus,
    responseDeadlineAt: row.responseDeadlineAt,
  };
}

/** Serializes all decision work for one association (layer 1 of the core). */
async function lockAssociation(tx: Executor, associationId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: campaignAffiliateAssociations.id, status: campaignAffiliateAssociations.status })
    .from(campaignAffiliateAssociations)
    .where(eq(campaignAffiliateAssociations.id, associationId))
    .for('update')
    .limit(1);
  return row?.status ?? null;
}

/* ── Refusals ─────────────────────────────────────────────────────────────── */

export type DecisionRefusal =
  | 'not_found'
  | 'not_open'
  | 'deadline_passed'
  | 'confirmations_incomplete'
  | 'policies_unpublished'
  | 'already_accepted'
  | 'proposal_already_open'
  | 'invalid_terms'
  | 'stale_version';

export interface Refused {
  ok: false;
  code: DecisionRefusal;
  message: string;
  next: string;
  missing?: string[];
}

function refuse(code: DecisionRefusal, message: string, next: string, missing?: string[]): Refused {
  return { ok: false, code, message, next, ...(missing ? { missing } : {}) };
}

const DEADLINE_PASSED = refuse(
  'deadline_passed',
  'The response window for this campaign has closed.',
  'Nothing you sent was lost, and this does not affect your standing. If the campaign continues, we may be in touch about future opportunities.',
);

/**
 * §14.6: "A late response cannot silently reactivate the failed/refunded
 * campaign." Checked as a fact about the stored deadline and the campaign's
 * own state, before any response is processed.
 */
function windowOpen(context: {
  responseDeadlineAt: Date | null;
  campaignStatus: string;
}, now: Date): boolean {
  if (!context.responseDeadlineAt) return false;
  if (context.campaignStatus !== 'affiliate_response_and_build') return false;
  return now.getTime() <= context.responseDeadlineAt.getTime();
}

/* ── §14.2's acceptance requirements ──────────────────────────────────────── */

export interface AcceptanceConfirmations {
  /** "Compensation terms." */
  compensationTerms: boolean;
  /** "Per-campaign Creator-only IP/confidentiality agreement" (§31.5). */
  ipAgreement: boolean;
  /** "FTC disclosure acknowledgment." */
  ftcDisclosure: boolean;
  /** "Campaign terms and AUP state." */
  termsAup: boolean;
}

const CONFIRMATION_KEYS: Array<keyof AcceptanceConfirmations> = [
  'compensationTerms',
  'ipAgreement',
  'ftcDisclosure',
  'termsAup',
];

/**
 * Records the §14.2 requirements inside the accepting transaction: the §31.5
 * consent (citing a published version — the 0003 trigger backs this up), and
 * the confirmations row. Returns a refusal when the IP agreement is still a
 * draft — the claim's `policies_unpublished` posture, unchanged.
 */
async function recordAcceptanceRequirements(
  tx: Executor,
  input: {
    associationId: string;
    campaignId: string;
    affiliateUserId: string;
    confirmations: AcceptanceConfirmations;
    acceptedVia: string;
  },
): Promise<Refused | { ok: true }> {
  const missing = CONFIRMATION_KEYS.filter((key) => input.confirmations[key] !== true);
  if (missing.length > 0) {
    return refuse(
      'confirmations_incomplete',
      'Each confirmation has to be made before you can accept.',
      'Nothing you entered was lost.',
      missing,
    );
  }

  const documents = await tx
    .select({
      id: policyVersions.id,
      slug: policyVersions.slug,
      version: policyVersions.version,
      status: policyVersions.status,
    })
    .from(policyVersions)
    .where(inArray(policyVersions.slug, [IP_AGREEMENT_SLUG, ...TERMS_AUP_SLUGS]));

  const bySlug = new Map(documents.map((d) => [d.slug, d]));
  const ip = bySlug.get(IP_AGREEMENT_SLUG);
  if (!ip || ip.status !== 'published') {
    // §31.4 forbids a placeholder, §1 rule 6 forbids writing the text, and a
    // consent may cite only a published version. Refuse in the open.
    return refuse(
      'policies_unpublished',
      'We cannot record your acceptance yet: the IP and confidentiality agreement is still with our lawyers, and we will not ask you to sign something that is not final.',
      'Nothing you entered was lost. We will email you the moment this opens.',
      [IP_AGREEMENT_SLUG],
    );
  }

  // One consent per (subject, version); a retry is not a second acceptance.
  const inserted = await tx
    .insert(policyConsents)
    .values({
      subjectType: 'user',
      subjectId: input.affiliateUserId,
      policyVersionId: ip.id,
      slug: ip.slug,
      version: ip.version,
      acceptedVia: input.acceptedVia,
    })
    .onConflictDoNothing()
    .returning({ id: policyConsents.id });

  let consentId = inserted[0]?.id;
  if (!consentId) {
    const [existing] = await tx
      .select({ id: policyConsents.id })
      .from(policyConsents)
      .where(
        and(
          eq(policyConsents.subjectType, 'user'),
          eq(policyConsents.subjectId, input.affiliateUserId),
          eq(policyConsents.policyVersionId, ip.id),
        ),
      )
      .limit(1);
    consentId = existing!.id;
  }

  const now = new Date();
  await tx.insert(associationAcceptanceConfirmations).values({
    associationId: input.associationId,
    campaignId: input.campaignId,
    compensationTermsConfirmedAt: now,
    ipAgreementConsentId: consentId,
    ftcDisclosureAcknowledgedAt: now,
    termsAupState: Object.fromEntries(
      TERMS_AUP_SLUGS.map((slug) => {
        const doc = bySlug.get(slug);
        return [slug, doc ? { version: doc.version, status: doc.status } : null];
      }),
    ),
  });

  return { ok: true };
}

/* ── The tracking link (§14.2: unique, inactive) ──────────────────────────── */

async function mintTrackingLink(
  tx: Executor,
  associationId: string,
  campaignId: string,
): Promise<void> {
  // Idempotent under retry: the unique association index turns a second mint
  // into a no-op rather than a second code.
  await tx
    .insert(trackingLinks)
    .values({
      associationId,
      campaignId,
      // Never derived from a name; attribution will resolve on this alone.
      code: randomBytes(12).toString('base64url'),
    })
    .onConflictDoNothing();
}

/* ── Accept standard terms (§14.2, §33.2.6) ───────────────────────────────── */

export interface AcceptedOutcome {
  ok: true;
  agreement: AssociationCompensationAgreement;
  trackingLink: TrackingLink | null;
}

export async function acceptStandardTerms(
  db: Database,
  deps: { audit: AuditWriter },
  input: {
    associationId: string;
    affiliateUserId: string;
    confirmations: AcceptanceConfirmations;
    actor: string;
    now?: Date;
  },
): Promise<AcceptedOutcome | Refused> {
  const now = input.now ?? new Date();

  const result = await db.transaction(async (tx) => {
    const status = await lockAssociation(tx, input.associationId);
    if (status === null) return refuse('not_found', NOT_FOUND_MESSAGE, NOT_FOUND_NEXT);

    const context = await loadForCreator(tx, input.associationId, input.affiliateUserId);
    if (!context) return refuse('not_found', NOT_FOUND_MESSAGE, NOT_FOUND_NEXT);

    if (!(DECISION_OPEN_STATUSES as readonly string[]).includes(context.associationStatus)) {
      if (context.associationStatus === 'accepted') {
        return refuse(
          'already_accepted',
          'You have already accepted this opportunity.',
          'Your confirmation is in your email.',
        );
      }
      return refuse('not_open', NOT_OPEN_MESSAGE, NOT_OPEN_NEXT);
    }
    if (!windowOpen(context, now)) return DEADLINE_PASSED;

    const requirements = await recordAcceptanceRequirements(tx, {
      associationId: context.associationId,
      campaignId: context.campaignId,
      affiliateUserId: input.affiliateUserId,
      confirmations: input.confirmations,
      acceptedVia: 'affiliate_standard_acceptance',
    });
    if ('code' in requirements) return requirements;

    /* Accepting the standard terms closes any version still awaiting a
       response — the Creator has chosen the standard cell over it, and an
       open version outliving a locked agreement would be a second path to
       `locked` waiting for a stale click. The proposer's own recorded
       decision never changes (trigger), so the closing decision is written
       only on the side that had not yet decided. */
    await tx
      .update(proposalVersions)
      .set({ state: 'declined', affiliateDecision: 'declined', affiliateDecidedAt: now })
      .where(
        and(
          eq(proposalVersions.associationId, context.associationId),
          eq(proposalVersions.state, 'awaiting_creator'),
        ),
      );
    await tx
      .update(proposalVersions)
      .set({ state: 'declined' })
      .where(
        and(
          eq(proposalVersions.associationId, context.associationId),
          eq(proposalVersions.state, 'awaiting_founder'),
        ),
      );

    // §14.2: "Accept the applicable base percentage" — the standard cell, with
    // no fixed payment, from the settings in force (§6).
    const settings = await readCompensationSettings(tx);
    const cell = resolveCell(settings, context, false);

    let agreement: AssociationCompensationAgreement;
    try {
      const [inserted] = await tx
        .insert(associationCompensationAgreements)
        .values({
          associationId: context.associationId,
          campaignId: context.campaignId,
          source: 'standard_terms',
          basePercent: cell.basePercent,
          bidIncreasePercent: 0,
          totalPercent: cell.basePercent,
          affiliateAcceptedAt: now,
        })
        .returning();
      agreement = inserted!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        return refuse(
          'already_accepted',
          'Compensation for this campaign is already locked.',
          'Your confirmation is in your email.',
        );
      }
      throw error;
    }

    await mintTrackingLink(tx, context.associationId, context.campaignId);

    // §14.2: the association becomes `accepted`, not `active`.
    const moved = await transitionAssociation(
      context.associationId,
      context.associationStatus as 'formal_decision_open',
      'accepted',
      input.actor,
      tx,
    );
    if (!moved) {
      throw new Error('association moved during acceptance; retry will meet its true state');
    }

    const [link] = await tx
      .select()
      .from(trackingLinks)
      .where(eq(trackingLinks.associationId, context.associationId))
      .limit(1);

    await deps.audit({
      action: 'decision.standard_terms_accepted',
      targetType: 'campaign_affiliate_association',
      targetId: context.associationId,
      internalReason: `standard terms accepted at base ${cell.basePercent}%; tracking link minted inactive`,
      newValue: {
        basePercent: cell.basePercent,
        campaignId: context.campaignId,
      },
      actorId: input.affiliateUserId,
    });

    return { ok: true as const, agreement, trackingLink: link ?? null };
  });

  return result;
}

const NOT_FOUND_MESSAGE = 'We could not find that campaign for your account.';
const NOT_FOUND_NEXT = 'Go back to your campaigns.';
const NOT_OPEN_MESSAGE = 'This campaign is not open for a decision right now.';
const NOT_OPEN_NEXT = 'Nothing is needed from you. We will email you if that changes.';

/* ── Decline (§14.2, §33.2.6) ─────────────────────────────────────────────── */

export interface DeclinedOutcome {
  ok: true;
  declinedAt: Date;
}

export async function declineOpportunity(
  db: Database,
  deps: { audit: AuditWriter },
  input: {
    associationId: string;
    affiliateUserId: string;
    reason?: string | undefined;
    actor: string;
    now?: Date;
  },
): Promise<DeclinedOutcome | Refused> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const status = await lockAssociation(tx, input.associationId);
    if (status === null) return refuse('not_found', NOT_FOUND_MESSAGE, NOT_FOUND_NEXT);

    const context = await loadForCreator(tx, input.associationId, input.affiliateUserId);
    if (!context) return refuse('not_found', NOT_FOUND_MESSAGE, NOT_FOUND_NEXT);

    if (!(DECISION_OPEN_STATUSES as readonly string[]).includes(context.associationStatus)) {
      return refuse('not_open', NOT_OPEN_MESSAGE, NOT_OPEN_NEXT);
    }
    // A decline is honoured to the deadline; past it the window logic answers.
    if (!windowOpen(context, now)) return DEADLINE_PASSED;

    // Any version still awaiting a response closes with the decline.
    await tx
      .update(proposalVersions)
      .set({
        state: 'declined',
        affiliateDecision: 'declined',
        affiliateDecidedAt: now,
      })
      .where(
        and(
          eq(proposalVersions.associationId, context.associationId),
          eq(proposalVersions.state, 'awaiting_creator'),
        ),
      );
    await tx
      .update(proposalVersions)
      .set({ state: 'declined' })
      .where(
        and(
          eq(proposalVersions.associationId, context.associationId),
          eq(proposalVersions.state, 'awaiting_founder'),
        ),
      );

    // §14.2: "Store decision time and optional reason."
    await tx
      .update(campaignAffiliateAssociations)
      .set({ declinedAt: now, declineReason: input.reason?.trim() || null, updatedAt: now })
      .where(eq(campaignAffiliateAssociations.id, context.associationId));

    const moved = await transitionAssociation(
      context.associationId,
      context.associationStatus as 'formal_decision_open',
      'declined',
      input.actor,
      tx,
    );
    if (!moved) return refuse('not_open', NOT_OPEN_MESSAGE, NOT_OPEN_NEXT);

    await deps.audit({
      action: 'decision.declined',
      targetType: 'campaign_affiliate_association',
      targetId: context.associationId,
      internalReason: `Creator declined the formal opportunity${input.reason ? ` — reason: ${input.reason}` : ' (no reason given)'}`,
      actorId: input.affiliateUserId,
    });

    return { ok: true as const, declinedAt: now };
  });
}

/* ── Propose terms (§14.2, §14.3, §33.2.7, §33.2.8) ───────────────────────── */

export interface ProposalInput {
  /** The proposed TOTAL percentage (base + increase). */
  bidTotalPercent?: number | undefined;
  fixedPaymentRequestCents?: bigint | undefined;
}

/**
 * §33.2.8's two rules, decided against the campaign's own cell: an Idea
 * Campaign rejects a fixed request; a standard (non-high-effort) campaign
 * rejects a bid above base. Returns the refusal, or the validated values.
 */
function validateProposalAgainstCell(
  cell: MatrixCell,
  proposal: ProposalInput,
): Refused | { bidTotalPercent: number | null; fixedPaymentRequestCents: bigint | null } {
  const bid = proposal.bidTotalPercent;
  const fixed = proposal.fixedPaymentRequestCents;

  if (bid === undefined && fixed === undefined) {
    return refuse(
      'invalid_terms',
      'A proposal has to propose something: a percentage, a fixed payment, or both.',
      'Nothing you entered was lost.',
    );
  }
  if (fixed !== undefined && !cell.fixedPaymentAllowed) {
    return refuse(
      'invalid_terms',
      'A fixed Creator payment is not available on an Idea Campaign.',
      'You can accept the standard percentage, or propose a different percentage if this campaign allows it.',
    );
  }
  if (fixed !== undefined && fixed <= 0n) {
    return refuse('invalid_terms', 'A fixed payment request must be a positive amount.', 'Nothing you entered was lost.');
  }
  if (bid !== undefined) {
    if (!Number.isInteger(bid) || bid <= 0 || bid > 100) {
      return refuse('invalid_terms', 'The percentage has to be a whole number between 1 and 100.', 'Nothing you entered was lost.');
    }
    // The base the bid is measured against is the base that would apply WITH
    // the proposal's own fixed request (§14.3's 20% column).
    const applicableBase = fixed !== undefined ? cell.basePercent : cell.basePercent;
    if (bid > applicableBase && !cell.bidAllowed) {
      return refuse(
        'invalid_terms',
        'A percentage above the base is only available on a high-effort campaign.',
        'You can accept the standard terms instead.',
      );
    }
    if (bid <= applicableBase) {
      return refuse(
        'invalid_terms',
        `The standard terms already give you ${applicableBase}%. A proposal only makes sense above that.`,
        'You can accept the standard terms instead.',
      );
    }
    if (bid > cell.ceilingPercent) {
      return refuse(
        'invalid_terms',
        `Total percentage compensation never exceeds ${cell.ceilingPercent}%.`,
        'Propose a percentage at or under the ceiling.',
      );
    }
  }
  return {
    bidTotalPercent: bid ?? null,
    fixedPaymentRequestCents: fixed ?? null,
  };
}

export interface ProposalOutcome {
  ok: true;
  version: ProposalVersion;
}

export async function submitProposal(
  db: Database,
  deps: { audit: AuditWriter },
  input: {
    associationId: string;
    affiliateUserId: string;
    proposal: ProposalInput;
    actor: string;
    now?: Date;
  },
): Promise<ProposalOutcome | Refused> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const status = await lockAssociation(tx, input.associationId);
    if (status === null) return refuse('not_found', NOT_FOUND_MESSAGE, NOT_FOUND_NEXT);

    const context = await loadForCreator(tx, input.associationId, input.affiliateUserId);
    if (!context) return refuse('not_found', NOT_FOUND_MESSAGE, NOT_FOUND_NEXT);

    if (!(DECISION_OPEN_STATUSES as readonly string[]).includes(context.associationStatus)) {
      return refuse('not_open', NOT_OPEN_MESSAGE, NOT_OPEN_NEXT);
    }
    if (!windowOpen(context, now)) return DEADLINE_PASSED;

    const settings = await readCompensationSettings(tx);
    // The cell the bid is validated against carries the base that would apply
    // if this proposal's own fixed request were accepted (§14.3).
    const cell = resolveCell(
      settings,
      context,
      input.proposal.fixedPaymentRequestCents !== undefined && context.campaignType === 'pre_launch',
    );
    const validated = validateProposalAgainstCell(cell, input.proposal);
    if ('code' in validated) return validated;

    const version = await insertVersion(tx, {
      associationId: context.associationId,
      campaignId: context.campaignId,
      proposedBy: 'affiliate',
      bidTotalPercent: validated.bidTotalPercent,
      fixedPaymentRequestCents: validated.fixedPaymentRequestCents,
      now,
    });
    if ('code' in version) return version;

    if (context.associationStatus !== 'proposal_pending') {
      const moved = await transitionAssociation(
        context.associationId,
        context.associationStatus as 'formal_decision_open',
        'proposal_pending',
        input.actor,
        tx,
      );
      if (!moved) return refuse('not_open', NOT_OPEN_MESSAGE, NOT_OPEN_NEXT);
    }

    await deps.audit({
      action: 'decision.proposal_submitted',
      targetType: 'campaign_affiliate_association',
      targetId: context.associationId,
      internalReason: `Creator proposed version ${version.version.versionNumber}: ${describeTerms(version.version)}`,
      newValue: {
        versionId: version.version.id,
        bidTotalPercent: validated.bidTotalPercent,
        fixedPaymentRequestCents: validated.fixedPaymentRequestCents?.toString() ?? null,
      },
      actorId: input.affiliateUserId,
    });

    return { ok: true as const, version: version.version };
  });
}

/** Inserts the next immutable version. The one-open index settles races. */
async function insertVersion(
  tx: Executor,
  input: {
    associationId: string;
    campaignId: string;
    proposedBy: 'affiliate' | 'founder';
    bidTotalPercent: number | null;
    fixedPaymentRequestCents: bigint | null;
    now: Date;
    /** Pre-minted by the counter path, which retires the old version first. */
    id?: string;
  },
): Promise<Refused | { version: ProposalVersion }> {
  const [latest] = await tx
    .select({ n: max(proposalVersions.versionNumber) })
    .from(proposalVersions)
    .where(eq(proposalVersions.associationId, input.associationId));
  const nextNumber = (latest?.n ?? 0) + 1;

  try {
    const [inserted] = await tx
      .insert(proposalVersions)
      .values({
        ...(input.id ? { id: input.id } : {}),
        associationId: input.associationId,
        campaignId: input.campaignId,
        versionNumber: nextNumber,
        proposedBy: input.proposedBy,
        bidTotalPercent: input.bidTotalPercent,
        fixedPaymentRequestCents: input.fixedPaymentRequestCents,
        // §14.2: a version awaits the party that did not write it.
        state: input.proposedBy === 'affiliate' ? 'awaiting_founder' : 'awaiting_creator',
        ...(input.proposedBy === 'affiliate'
          ? { affiliateDecision: 'proposed' as const, affiliateDecidedAt: input.now }
          : { founderDecision: 'proposed' as const, founderDecidedAt: input.now }),
      })
      .returning();
    return { version: inserted! };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return refuse(
        'proposal_already_open',
        'A proposal is already awaiting a response on this campaign.',
        'Respond to the open proposal first.',
      );
    }
    throw error;
  }
}

function describeTerms(version: Pick<ProposalVersion, 'bidTotalPercent' | 'fixedPaymentRequestCents'>): string {
  const parts: string[] = [];
  if (version.bidTotalPercent !== null) parts.push(`${version.bidTotalPercent}% total`);
  if (version.fixedPaymentRequestCents !== null) {
    parts.push(`fixed payment request ${version.fixedPaymentRequestCents} cents`);
  }
  return parts.join(', ') || 'no values';
}

/* ── Responding to a version (§14.2, §33.2.9, §33.2.10) ───────────────────── */

export type ResponseAction =
  | { action: 'accept'; confirmations?: AcceptanceConfirmations }
  | { action: 'decline' }
  | { action: 'counter'; proposal: ProposalInput };

export type RespondOutcome =
  | { ok: true; outcome: 'locked'; version: ProposalVersion; agreement: AssociationCompensationAgreement }
  | { ok: true; outcome: 'declined'; version: ProposalVersion }
  | { ok: true; outcome: 'countered'; version: ProposalVersion; newVersion: ProposalVersion }
  | Refused;

/**
 * One party's response to one exact version. The version id in the request is
 * the whole point: a response names the version it answers, and if that
 * version has been superseded or resolved in the meantime the conditional
 * UPDATE matches nothing and the caller is told the state moved (§33.2.9).
 */
export async function respondToProposal(
  db: Database,
  deps: { audit: AuditWriter },
  input: {
    versionId: string;
    party: 'affiliate' | 'founder';
    /** The session user: the Creator's user id, or the Founder's. */
    userId: string;
    response: ResponseAction;
    actor: string;
    now?: Date;
  },
): Promise<RespondOutcome> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    // Find the version's association WITHOUT locking the version first —
    // association before version, always, so writers cannot deadlock.
    const [pointer] = await tx
      .select({
        associationId: proposalVersions.associationId,
      })
      .from(proposalVersions)
      .where(eq(proposalVersions.id, input.versionId))
      .limit(1);
    if (!pointer) return refuse('not_found', 'That proposal could not be found.', NOT_FOUND_NEXT);

    const status = await lockAssociation(tx, pointer.associationId);
    if (status === null) return refuse('not_found', NOT_FOUND_MESSAGE, NOT_FOUND_NEXT);

    // Authorization: the caller must be this association's Creator, or the
    // campaign's Founder — decided inside the query, not after it.
    const context = await loadForCreator(tx, pointer.associationId, input.userId);
    let resolved: DecisionContext | null = context;
    if (input.party === 'founder') {
      if (context) return refuse('not_found', NOT_FOUND_MESSAGE, NOT_FOUND_NEXT);
      const [assoc] = await tx
        .select({
          associationId: campaignAffiliateAssociations.id,
          campaignId: campaignAffiliateAssociations.campaignId,
          associationStatus: campaignAffiliateAssociations.status,
          kitRevokedAt: campaignAffiliateAssociations.kitAccessRevokedAt,
          creatorEmail: affiliateSignupProfiles.email,
          creatorHandle: affiliateSignupProfiles.publicHandle,
        })
        .from(campaignAffiliateAssociations)
        .leftJoin(
          affiliateSignupProfiles,
          eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
        )
        .where(eq(campaignAffiliateAssociations.id, pointer.associationId))
        .limit(1);
      if (!assoc) return refuse('not_found', NOT_FOUND_MESSAGE, NOT_FOUND_NEXT);
      const founderCampaign = await loadForFounder(tx, assoc.campaignId, input.userId);
      if (!founderCampaign) return refuse('not_found', NOT_FOUND_MESSAGE, NOT_FOUND_NEXT);
      resolved = {
        associationId: assoc.associationId,
        campaignId: assoc.campaignId,
        associationStatus: assoc.associationStatus,
        kitRevokedAt: assoc.kitRevokedAt,
        creatorEmail: assoc.creatorEmail,
        creatorHandle: assoc.creatorHandle,
        campaignType: founderCampaign.campaignType,
        highEffort: founderCampaign.highEffort,
        responseDeadlineAt: founderCampaign.responseDeadlineAt,
        campaignStatus: founderCampaign.campaignStatus,
      };
    }
    if (!resolved) return refuse('not_found', NOT_FOUND_MESSAGE, NOT_FOUND_NEXT);

    // §14.6/§33.2.11: a response after the deadline, or to a failed and
    // refunded campaign, is refused before any state is read further.
    if (!windowOpen(resolved, now)) return DEADLINE_PASSED;
    if (resolved.associationStatus !== 'proposal_pending') {
      return refuse('not_open', 'There is no open proposal on this campaign.', NOT_OPEN_NEXT);
    }

    const [version] = await tx
      .select()
      .from(proposalVersions)
      .where(eq(proposalVersions.id, input.versionId))
      .for('update')
      .limit(1);
    if (!version) return refuse('not_found', 'That proposal could not be found.', NOT_FOUND_NEXT);

    const awaiting = input.party === 'founder' ? 'awaiting_founder' : 'awaiting_creator';
    if (version.state !== awaiting) {
      // Stale: superseded, already resolved, or simply not this party's turn.
      return refuse(
        'stale_version',
        'This proposal version is no longer the one awaiting a response.',
        'Reload to see the current version. Nothing was changed.',
      );
    }

    const decisionColumns =
      input.party === 'founder'
        ? { founderDecision: 'accepted' as const, founderDecidedAt: now }
        : { affiliateDecision: 'accepted' as const, affiliateDecidedAt: now };

    if (input.response.action === 'accept') {
      // The Creator's own explicit acceptance carries §14.2's requirements
      // with it; the Founder's acceptance locks compensation only.
      if (input.party === 'affiliate') {
        const requirements = await recordAcceptanceRequirements(tx, {
          associationId: resolved.associationId,
          campaignId: resolved.campaignId,
          affiliateUserId: input.userId,
          confirmations: input.response.confirmations ?? {
            compensationTerms: false,
            ipAgreement: false,
            ftcDisclosure: false,
            termsAup: false,
          },
          acceptedVia: 'affiliate_proposal_acceptance',
        });
        if ('code' in requirements) return requirements;
      }

      // Layer 2: the conditional lock. A concurrent counter or acceptance has
      // already moved this row, and this matches nothing.
      const locked = await tx
        .update(proposalVersions)
        .set({ state: 'locked', lockedAt: now, ...decisionColumns })
        .where(and(eq(proposalVersions.id, version.id), eq(proposalVersions.state, awaiting)))
        .returning();
      if (locked.length !== 1) {
        return refuse('stale_version', 'This proposal version was answered another way first.', 'Reload to see the current state.');
      }

      // The agreement: base from the settings in force, derived against the
      // version's own fixed request (§14.3's 20% column when one exists).
      const settings = await readCompensationSettings(tx);
      const fixedAccepted =
        version.fixedPaymentRequestCents !== null && resolved.campaignType === 'pre_launch';
      const cell = resolveCell(settings, resolved, fixedAccepted);
      const totalPercent = version.bidTotalPercent ?? cell.basePercent;
      if (totalPercent < cell.basePercent || totalPercent > cell.ceilingPercent) {
        throw new Error(
          `locked version ${version.id} resolves to an illegal total ${totalPercent}% — refusing to record`,
        );
      }

      const proposerTime =
        version.proposedBy === 'affiliate' ? version.affiliateDecidedAt! : version.founderDecidedAt!;
      let agreement: AssociationCompensationAgreement;
      try {
        const [inserted] = await tx
          .insert(associationCompensationAgreements)
          .values({
            associationId: resolved.associationId,
            campaignId: resolved.campaignId,
            source: 'proposal_version',
            proposalVersionId: version.id,
            basePercent: cell.basePercent,
            bidIncreasePercent: totalPercent - cell.basePercent,
            totalPercent,
            fixedPaymentCents: version.fixedPaymentRequestCents,
            affiliateAcceptedAt: input.party === 'affiliate' ? now : proposerTime,
            founderAcceptedAt: input.party === 'founder' ? now : proposerTime,
          })
          .returning();
        agreement = inserted!;
      } catch (error) {
        if (isUniqueViolation(error)) {
          return refuse('already_accepted', 'Compensation for this campaign is already locked.', 'Reload to see the locked terms.');
        }
        throw error;
      }

      await mintTrackingLink(tx, resolved.associationId, resolved.campaignId);
      const moved = await transitionAssociation(
        resolved.associationId,
        'proposal_pending',
        'accepted',
        input.actor,
        tx,
      );
      if (!moved) throw new Error('association moved during proposal acceptance');

      const [refreshed] = await tx
        .select()
        .from(proposalVersions)
        .where(eq(proposalVersions.id, version.id))
        .limit(1);

      await deps.audit({
        action: 'decision.proposal_locked',
        targetType: 'campaign_affiliate_association',
        targetId: resolved.associationId,
        internalReason: `version ${version.versionNumber} locked by exact bilateral acceptance: ${describeTerms(version)}; total ${totalPercent}%`,
        newValue: {
          versionId: version.id,
          totalPercent,
          fixedPaymentCents: version.fixedPaymentRequestCents?.toString() ?? null,
        },
        actorId: input.userId,
      });

      return { ok: true as const, outcome: 'locked' as const, version: refreshed!, agreement };
    }

    if (input.response.action === 'decline') {
      const declineColumns =
        input.party === 'founder'
          ? { founderDecision: 'declined' as const, founderDecidedAt: now }
          : { affiliateDecision: 'declined' as const, affiliateDecidedAt: now };
      const declined = await tx
        .update(proposalVersions)
        .set({ state: 'declined', ...declineColumns })
        .where(and(eq(proposalVersions.id, version.id), eq(proposalVersions.state, awaiting)))
        .returning();
      if (declined.length !== 1) {
        return refuse('stale_version', 'This proposal version was answered another way first.', 'Reload to see the current state.');
      }

      // The association stays `proposal_pending`: §14.2 keeps all three
      // outcomes open — the Creator can still accept standard terms, counter,
      // or decline the opportunity itself.
      await deps.audit({
        action: 'decision.proposal_version_declined',
        targetType: 'campaign_affiliate_association',
        targetId: resolved.associationId,
        internalReason: `version ${version.versionNumber} declined by the ${input.party === 'founder' ? 'Founder' : 'Creator'}`,
        actorId: input.userId,
      });
      return { ok: true as const, outcome: 'declined' as const, version: declined[0]! };
    }

    /* counter — §14.2: "A Founder revision creates a new immutable version
       with `awaiting_creator`; it is not acceptance." Symmetrically for a
       Creator's counter.

       Supersede FIRST, then insert: the one-open index requires the old
       version to stop being open before the counter can exist. The pointer
       names an id minted before the insert, and the DEFERRABLE FK resolves it
       at commit — the 10b supersession shape, reused. */
    const settings = await readCompensationSettings(tx);
    const counterFixed =
      input.response.proposal.fixedPaymentRequestCents !== undefined &&
      resolved.campaignType === 'pre_launch';
    const cell = resolveCell(settings, resolved, counterFixed);
    const validated = validateProposalAgainstCell(cell, input.response.proposal);
    if ('code' in validated) return validated;

    const supersedingId = randomUUID();
    const counterDecision =
      input.party === 'founder'
        ? { founderDecision: 'declined' as const, founderDecidedAt: now }
        : { affiliateDecision: 'declined' as const, affiliateDecidedAt: now };
    const superseded = await tx
      .update(proposalVersions)
      .set({
        state: 'superseded',
        supersededByVersionId: supersedingId,
        ...counterDecision,
      })
      .where(and(eq(proposalVersions.id, version.id), eq(proposalVersions.state, awaiting)))
      .returning();
    if (superseded.length !== 1) {
      // The old version resolved while we validated; nothing was written.
      throw new StaleCounter();
    }

    const superseding = await insertVersion(tx, {
      associationId: resolved.associationId,
      campaignId: resolved.campaignId,
      proposedBy: input.party,
      bidTotalPercent: validated.bidTotalPercent,
      fixedPaymentRequestCents: validated.fixedPaymentRequestCents,
      now,
      id: supersedingId,
    });
    // A refusal here would leave the supersession committed with no successor;
    // throw so the whole response rolls back and the retry meets true state.
    if ('code' in superseding) throw new StaleCounter();

    await deps.audit({
      action: 'decision.proposal_countered',
      targetType: 'campaign_affiliate_association',
      targetId: resolved.associationId,
      internalReason: `${input.party === 'founder' ? 'Founder revision' : 'Creator counter'} created version ${superseding.version.versionNumber} (${describeTerms(superseding.version)}); version ${version.versionNumber} superseded — a revision is not acceptance (§14.2)`,
      newValue: { versionId: superseding.version.id },
      actorId: input.userId,
    });

    return {
      ok: true as const,
      outcome: 'countered' as const,
      version: superseded[0]!,
      newVersion: superseding.version,
    };
  }).catch((error: unknown) => {
    if (error instanceof StaleCounter) {
      return refuse(
        'stale_version',
        'This proposal version was answered another way first.',
        'Reload to see the current state. Nothing was changed.',
      ) as RespondOutcome;
    }
    throw error;
  });
}

class StaleCounter extends Error {}

/* ── Admin mediation (§14.2) ──────────────────────────────────────────────── */

/**
 * Rejects a policy-violating version. Terminal, and deliberately NOT a path to
 * `locked` — there is no admin acceptance function in this module, because
 * mediation is not agreement.
 */
export async function adminRejectVersion(
  db: Database,
  deps: { audit: AuditWriter },
  input: { versionId: string; actor: string; internalReason: string; customerExplanation: string },
): Promise<{ ok: true; version: ProposalVersion } | Refused> {
  return db.transaction(async (tx) => {
    const [pointer] = await tx
      .select({ associationId: proposalVersions.associationId })
      .from(proposalVersions)
      .where(eq(proposalVersions.id, input.versionId))
      .limit(1);
    if (!pointer) return refuse('not_found', 'That proposal could not be found.', 'Check the id.');

    await lockAssociation(tx, pointer.associationId);

    const rejected = await tx
      .update(proposalVersions)
      .set({ state: 'rejected_by_admin' })
      .where(
        and(
          eq(proposalVersions.id, input.versionId),
          inArray(proposalVersions.state, ['awaiting_founder', 'awaiting_creator']),
        ),
      )
      .returning();
    if (rejected.length !== 1) {
      return refuse('stale_version', 'That version is no longer open.', 'Reload the campaign.');
    }

    await deps.audit({
      action: 'decision.proposal_rejected_by_admin',
      targetType: 'campaign_affiliate_association',
      targetId: pointer.associationId,
      internalReason: input.internalReason,
      customerExplanation: input.customerExplanation,
      newValue: { versionId: input.versionId },
    });

    return { ok: true as const, version: rejected[0]! };
  });
}

/* ── Creator-specific bonuses (§14.3, §33.2.12, §33.2.13) ─────────────────── */

export type BonusRefusal = Refused;

export async function offerCreatorBonus(
  db: Database,
  deps: { audit: AuditWriter },
  input: {
    campaignId: string;
    founderUserId: string;
    associationId: string;
    triggerUnit: 'attributed_subtotal_cents' | 'unique_attributed_backers';
    threshold: bigint;
    additionalPercent: number;
    actor: string;
  },
): Promise<{ ok: true; bonus: CreatorBonus } | Refused> {
  return db.transaction(async (tx) => {
    const campaign = await loadForFounder(tx, input.campaignId, input.founderUserId);
    if (!campaign) return refuse('not_found', 'That campaign could not be found.', 'Check your campaigns.');

    const [association] = await tx
      .select({
        id: campaignAffiliateAssociations.id,
        campaignId: campaignAffiliateAssociations.campaignId,
      })
      .from(campaignAffiliateAssociations)
      .where(
        and(
          eq(campaignAffiliateAssociations.id, input.associationId),
          eq(campaignAffiliateAssociations.campaignId, input.campaignId),
        ),
      )
      .for('update')
      .limit(1);
    if (!association) {
      return refuse('not_found', 'That Creator is not on this campaign.', 'Check the roster.');
    }

    if (
      !Number.isInteger(input.additionalPercent) ||
      input.additionalPercent <= 0 ||
      input.threshold < 0n
    ) {
      return refuse('invalid_terms', 'A bonus needs a positive whole-number percentage and a non-negative threshold.', 'Nothing you entered was lost.');
    }

    /* §33.2.12: the ceiling includes base + bid + bonus. Measured against the
       locked agreement when one exists, else against the campaign's own cell
       at its maximum lawful total — never against a number the Founder hopes
       for. */
    const settings = await readCompensationSettings(tx);
    const [agreement] = await tx
      .select()
      .from(associationCompensationAgreements)
      .where(eq(associationCompensationAgreements.associationId, input.associationId))
      .limit(1);
    const baseline = agreement
      ? agreement.totalPercent
      : resolveCell(settings, campaign, false).basePercent;
    const combined = baseline + input.additionalPercent;
    if (combined > settings.ceilingPercent) {
      return refuse(
        'invalid_terms',
        `Base plus bid plus bonus may never exceed ${settings.ceilingPercent}%. This Creator's locked terms are ${baseline}%, so the largest bonus available is ${Math.max(settings.ceilingPercent - baseline, 0)}%.`,
        'Offer a smaller bonus percentage.',
      );
    }

    try {
      const [bonus] = await tx
        .insert(creatorBonuses)
        .values({
          associationId: input.associationId,
          campaignId: input.campaignId,
          triggerUnit: input.triggerUnit,
          threshold: input.threshold,
          additionalPercent: input.additionalPercent,
          maxCombinedPercent: Math.min(combined, settings.ceilingPercent),
          proposalVersionId: agreement?.proposalVersionId ?? null,
          offeredBy: input.actor,
        })
        .returning();

      await deps.audit({
        action: 'decision.creator_bonus_offered',
        targetType: 'campaign_affiliate_association',
        targetId: input.associationId,
        internalReason:
          `Creator-specific bonus offered: +${input.additionalPercent}% when this Creator's own ` +
          `${input.triggerUnit === 'attributed_subtotal_cents' ? 'captured attributed pre-tax subtotal' : 'unique captured attributed-Backer count'} ` +
          `reaches ${input.threshold}; combined maximum ${Math.min(combined, settings.ceilingPercent)}%`,
        actorId: input.founderUserId,
      });

      return { ok: true as const, bonus: bonus! };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return refuse('invalid_terms', 'A bonus is already offered to this Creator.', 'Withdrawal or change of an offered bonus is a terms change and goes through review.');
      }
      throw error;
    }
  });
}

/* ── Reads ────────────────────────────────────────────────────────────────── */

export async function listVersions(db: Executor, associationId: string): Promise<ProposalVersion[]> {
  return db
    .select()
    .from(proposalVersions)
    .where(eq(proposalVersions.associationId, associationId))
    .orderBy(proposalVersions.versionNumber);
}

export async function findAgreement(
  db: Executor,
  associationId: string,
): Promise<AssociationCompensationAgreement | null> {
  const [row] = await db
    .select()
    .from(associationCompensationAgreements)
    .where(eq(associationCompensationAgreements.associationId, associationId))
    .limit(1);
  return row ?? null;
}

export async function findTrackingLink(
  db: Executor,
  associationId: string,
): Promise<TrackingLink | null> {
  const [row] = await db
    .select()
    .from(trackingLinks)
    .where(eq(trackingLinks.associationId, associationId))
    .limit(1);
  return row ?? null;
}

/** How many locked mutual acceptances a campaign holds (§14.6's question). */
export async function countLockedAcceptances(db: Executor, campaignId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(associationCompensationAgreements)
    .where(eq(associationCompensationAgreements.campaignId, campaignId));
  return Number(row?.n ?? 0);
}

/** The latest open (awaiting) version for one association, if any. */
export async function findOpenVersion(
  db: Executor,
  associationId: string,
): Promise<ProposalVersion | null> {
  const [row] = await db
    .select()
    .from(proposalVersions)
    .where(
      and(
        eq(proposalVersions.associationId, associationId),
        inArray(proposalVersions.state, ['awaiting_founder', 'awaiting_creator']),
      ),
    )
    .orderBy(desc(proposalVersions.versionNumber))
    .limit(1);
  return row ?? null;
}

/* ── The formal opportunity read (§14.1, §14.5) ───────────────────────────── */

/**
 * The FTC disclosure text served beside the tracking link. Standard
 * material-connection wording; §14.1 requires the kit to carry it with
 * one-click copy. Content, not a commercial rule.
 */
export const CREATOR_DISCLOSURE_TEXT =
  'Paid partnership: I may earn a commission from purchases made through this link. #ad';

export interface FormalOpportunity {
  associationId: string;
  campaignId: string;
  associationStatus: string;
  /** §14.1: "Why this fits your audience" — Admin's two §8 sentences. */
  whyThisFitsYourAudience: string | null;
  /** §14.1: campaign state, in the §14.5 vocabulary. */
  campaignStateLabel: string;
  /** The exact stored deadline (§14.5), ISO. */
  responseDeadlineAt: string | null;
  highEffort: {
    result: boolean;
    /** §14.1: "its objective basis" — the three stored §12 inputs. */
    basis: {
      visualsCompleted: boolean;
      brandingCompleted: boolean;
      interviewScheduledOrConfirmed: boolean;
    } | null;
  };
  compensation: {
    basePercent: number;
    /** §14.3: base when an accepted fixed payment would apply (Product only). */
    basePercentWithFixed: number | null;
    bidAllowed: boolean;
    fixedPaymentAvailable: boolean;
    ceilingPercent: number;
  };
  /** §14.2: all three outcomes, none hidden. */
  decisionsAvailable: boolean;
  versions: Array<{
    id: string;
    versionNumber: number;
    proposedBy: string;
    bidTotalPercent: number | null;
    fixedPaymentRequestCents: string | null;
    state: string;
    createdAt: string;
  }>;
  agreement: {
    totalPercent: number;
    fixedPaymentCents: string | null;
    source: string;
  } | null;
  /** Present only after acceptance; inactive until approval and readiness. */
  trackingLink: {
    url: string;
    /** §14.1: the safe test URL — carries the marker attribution excludes. */
    testUrl: string;
    active: boolean;
    disclosureText: string;
  } | null;
}

/**
 * Reads the formal opportunity for one association, on behalf of the signed-in
 * Creator. The first read from `formal_decision_open` records the §14.5
 * `reviewing` state — a conditional transition, so a second read changes
 * nothing.
 */
export async function readFormalOpportunity(
  db: Database,
  deps: { appBaseUrl: string },
  input: { associationId: string; affiliateUserId: string; actor: string },
): Promise<{ ok: true; opportunity: FormalOpportunity } | Refused> {
  const context = await loadForCreator(db, input.associationId, input.affiliateUserId);
  if (!context) return refuse('not_found', NOT_FOUND_MESSAGE, NOT_FOUND_NEXT);

  const formalStatuses = [
    'formal_decision_open',
    'reviewing',
    'proposal_pending',
    'accepted',
    'declined',
    'expired_no_acceptance',
  ];
  if (!formalStatuses.includes(context.associationStatus)) {
    return refuse(
      'not_open',
      'The formal opportunity for this campaign has not opened yet.',
      'Your campaign page shows everything currently available.',
    );
  }

  // §14.5's `reviewing`: recorded on first read, idempotent by condition.
  if (context.associationStatus === 'formal_decision_open') {
    await transitionAssociation(
      context.associationId,
      'formal_decision_open',
      'reviewing',
      input.actor,
      db,
    );
    context.associationStatus = 'reviewing';
  }

  const [recruitment] = await db
    .select({ whyRecruited: campaignAffiliateAssociations.whyRecruited })
    .from(campaignAffiliateAssociations)
    .where(eq(campaignAffiliateAssociations.id, context.associationId))
    .limit(1);

  const settings = await readCompensationSettings(db);
  const cell = resolveCell(settings, context, false);

  const [classification] = await db
    .select()
    .from(highEffortClassifications)
    .where(eq(highEffortClassifications.campaignId, context.campaignId))
    .orderBy(desc(highEffortClassifications.calculatedAt))
    .limit(1);

  const versions = await listVersions(db, context.associationId);
  const agreement = await findAgreement(db, context.associationId);
  const link = agreement ? await findTrackingLink(db, context.associationId) : null;

  const labels: Record<string, string> = {
    formal_decision_open: 'Formal decision open',
    reviewing: 'Formal decision open',
    proposal_pending: 'Formal decision open',
    accepted: 'Accepted',
    declined: 'Declined',
    expired_no_acceptance: 'Ended',
  };

  return {
    ok: true,
    opportunity: {
      associationId: context.associationId,
      campaignId: context.campaignId,
      associationStatus: context.associationStatus,
      whyThisFitsYourAudience: recruitment?.whyRecruited ?? null,
      campaignStateLabel: labels[context.associationStatus] ?? 'Formal decision open',
      responseDeadlineAt: context.responseDeadlineAt?.toISOString() ?? null,
      highEffort: {
        result: context.highEffort,
        basis: classification
          ? {
              visualsCompleted: classification.visualsCompleted,
              brandingCompleted: classification.brandingCompleted,
              interviewScheduledOrConfirmed: classification.interviewScheduledOrConfirmed,
            }
          : null,
      },
      compensation: {
        basePercent: cell.basePercent,
        basePercentWithFixed:
          context.campaignType === 'pre_launch' ? settings.withFixedBasePercent : null,
        bidAllowed: cell.bidAllowed,
        fixedPaymentAvailable: cell.fixedPaymentAllowed,
        ceilingPercent: cell.ceilingPercent,
      },
      decisionsAvailable: (DECISION_OPEN_STATUSES as readonly string[]).includes(
        context.associationStatus,
      ),
      versions: versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        proposedBy: v.proposedBy,
        bidTotalPercent: v.bidTotalPercent,
        fixedPaymentRequestCents: v.fixedPaymentRequestCents?.toString() ?? null,
        state: v.state,
        createdAt: v.createdAt.toISOString(),
      })),
      agreement: agreement
        ? {
            totalPercent: agreement.totalPercent,
            fixedPaymentCents: agreement.fixedPaymentCents?.toString() ?? null,
            source: agreement.source,
          }
        : null,
      trackingLink: link
        ? {
            url: `${deps.appBaseUrl}/c/${link.code}`,
            testUrl: `${deps.appBaseUrl}/c/${link.code}?${LINK_TEST_MARKER}=1`,
            active: link.active,
            disclosureText: CREATOR_DISCLOSURE_TEXT,
          }
        : null,
    },
  };
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if ((current as { code?: string }).code === '23505') return true;
    current = current.cause;
  }
  return false;
}
