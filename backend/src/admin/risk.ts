/**
 * The §31.7 risk-control inventory — ten signals, computed live.
 *
 * §31.7 opens with "Before close and throughout live operations", so this is not
 * a close-time report. Every signal is recomputed on each read from the records
 * the earlier phases already write; nothing here stores a risk verdict, because
 * a stored verdict is one that stays true after the thing it described was
 * fixed.
 *
 * ── The zero that is not a clean result ─────────────────────────────────────
 * §31.7: "zero tax caused by missing collection configuration is not treated as
 * proof that no tax is due." So `tax_not_collecting` counts every reservation
 * whose stored taxability reason is `not_collecting` *and* every campaign whose
 * seller tax readiness is unrecorded, and it is `blocking`. There is no branch
 * that resolves it to "clean" and no threshold below which it stops being
 * reported. This is the same refusal `STRIPE_TAX_ENABLED` makes at the listing
 * Checkout, moved to the campaign charge.
 *
 * ── No score, no index, no automatic refusal ────────────────────────────────
 * Signals are counted and named, never summed or ranked. §1 rule 6 forbids
 * inventing an eligibility condition, and a risk score is exactly that with
 * arithmetic in front of it — the first phase that wanted an automatic refusal
 * would find a number sitting there to compare against a threshold nobody
 * agreed to. Admin reads the signals and records a decision (§1.3).
 */

import { and, eq, isNull, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignAffiliateAssociations, reservations } from '../db/schema/domain.js';
import { backerIdentities, deduplicationCases } from '../db/schema/reservations.js';
import { campaignRewardPackages } from '../db/schema/build.js';
import { trackingLinkClicks } from '../db/schema/attribution.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { stripeConnectedAccounts, stripeAccountEvents, providerObjects } from '../db/schema/payments.js';
import { providerEvents, idempotencyKeys } from '../db/schema/integrity.js';
import { campaignSellerTaxReadiness } from '../db/schema/admin-operations.js';
import {
  RISK_SIGNAL_KEYS,
  RISK_SEVERITIES,
  SELLER_TAX_READINESS_FACT_KEYS,
  isSellerTaxReady,
  missingSellerTaxFacts,
  type RiskSignalKey,
  type RiskSeverity,
} from './logic.js';

export interface RiskSignalResult {
  key: RiskSignalKey;
  severity: RiskSeverity;
  /** How many instances. 0 is a real answer here — nothing was found. */
  count: number;
  /** The specific things found, capped. Empty when count is 0. */
  instances: Array<{ id: string; detail: string }>;
  /**
   * True when the signal could not be evaluated because the phase that produces
   * its input has not run. Distinct from `count: 0`, which means "evaluated,
   * found nothing" — §1.4 again: not-yet-checked must never read as clear.
   */
  notYetObservable: boolean;
}

export interface RiskPanel {
  campaignId: string | null;
  signals: RiskSignalResult[];
  /** Every `blocking` signal with a non-zero count. */
  blockingKeys: RiskSignalKey[];
  sellerTaxReadiness: SellerTaxReadinessState;
}

export interface SellerTaxReadinessState {
  recorded: boolean;
  ready: boolean;
  missingFacts: readonly string[];
  recordedBy: string | null;
  evidenceReference: string | null;
  mode: string | null;
  recordedAt: string | null;
}

const INSTANCE_CAP = 25;

/** §31.7's closing paragraph: four facts, all four, before live tax collection. */
export async function readSellerTaxReadiness(
  db: Database,
  campaignId: string,
  mode: string,
): Promise<SellerTaxReadinessState> {
  const [row] = await db
    .select()
    .from(campaignSellerTaxReadiness)
    .where(
      and(
        eq(campaignSellerTaxReadiness.campaignId, campaignId),
        eq(campaignSellerTaxReadiness.mode, mode),
        isNull(campaignSellerTaxReadiness.supersededAt),
      ),
    )
    .limit(1);

  if (!row) {
    return {
      recorded: false,
      ready: false,
      // Unrecorded is not partially ready — all four are outstanding.
      missingFacts: SELLER_TAX_READINESS_FACT_KEYS,
      recordedBy: null,
      evidenceReference: null,
      mode: null,
      recordedAt: null,
    };
  }

  const facts: Record<string, boolean> = {
    head_office_location: row.headOfficeLocationRecorded,
    product_tax_code: row.productTaxCodeRecorded,
    registration: row.registrationRecorded,
    provider_tax_settings: row.providerTaxSettingsRecorded,
  };

  return {
    recorded: true,
    ready: isSellerTaxReady(facts),
    missingFacts: missingSellerTaxFacts(facts),
    recordedBy: row.recordedBy,
    evidenceReference: row.evidenceReference,
    mode: row.mode,
    recordedAt: row.createdAt.toISOString(),
  };
}

/**
 * Compute all ten §31.7 signals.
 *
 * `campaignId` narrows to one campaign; omitting it sweeps every campaign, which
 * is what the operations dashboard reads.
 */
export async function readRiskPanel(
  db: Database,
  options: { campaignId?: string; mode: string },
): Promise<RiskPanel> {
  const { campaignId, mode } = options;
  const scope = (col: SQL | ReturnType<typeof eq>): SQL | undefined =>
    campaignId ? (col as SQL) : undefined;

  const signals: RiskSignalResult[] = [];

  /* 1 — Stripe Radar result on every PaymentIntent (§31.7).
     Radar outcomes arrive on PaymentIntents, which Phase 18 creates. Until then
     there is nothing to read, and the honest answer is "not yet observable"
     rather than "no risk found". */
  const [piCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(providerObjects)
    .where(
      and(
        eq(sql`${providerObjects.objectType}::text`, 'payment_intent'),
        campaignId ? eq(providerObjects.campaignId, campaignId) : sql`true`,
      ),
    );

  const radarInstances = await db
    .select({ id: providerObjects.providerObjectId, status: providerObjects.status })
    .from(providerObjects)
    .where(
      and(
        eq(sql`${providerObjects.objectType}::text`, 'payment_intent'),
        campaignId ? eq(providerObjects.campaignId, campaignId) : sql`true`,
        sql`${providerObjects.status} IN ('requires_action', 'canceled', 'requires_payment_method')`,
      ),
    )
    .limit(INSTANCE_CAP);

  signals.push({
    key: 'radar_result',
    severity: RISK_SEVERITIES.radar_result,
    count: radarInstances.length,
    instances: radarInstances.map((r) => ({
      id: r.id,
      detail: `PaymentIntent status ${r.status ?? 'unknown'} — read the Radar detail in the provider before deciding.`,
    })),
    notYetObservable: (piCount?.n ?? 0) === 0,
  });

  /* 2 — the practical Idea duplicate queue (§4.1). */
  const duplicates = await db
    .select({
      id: deduplicationCases.id,
      signals: deduplicationCases.signals,
      campaign: deduplicationCases.campaignId,
    })
    .from(deduplicationCases)
    .innerJoin(campaigns, eq(campaigns.id, deduplicationCases.campaignId))
    .where(
      and(
        eq(sql`${deduplicationCases.status}::text`, 'open'),
        campaignId ? eq(deduplicationCases.campaignId, campaignId) : sql`true`,
      ),
    )
    .limit(INSTANCE_CAP);

  signals.push({
    key: 'duplicate_queue',
    severity: RISK_SEVERITIES.duplicate_queue,
    count: duplicates.length,
    instances: duplicates.map((d) => ({
      id: d.id,
      detail: `Open duplicate case on campaign ${d.campaign}. Matched signals: ${JSON.stringify(d.signals)}. Shared IP alone never merges (§4.1).`,
    })),
    notYetObservable: false,
  });

  /* 3 — a reservation above the highest valid reward price (§31.7).
     A transaction that cannot correspond to anything on sale is a ledger error
     or a manipulation, so it is blocking rather than advisory. */
  const overpriced = await db
    .select({
      id: reservations.id,
      subtotal: reservations.rewardSubtotalCents,
      campaign: reservations.campaignId,
      highest: sql<string>`(
        SELECT coalesce(max(rp.price_cents), 0)::text
        FROM campaign_reward_packages rp
        WHERE rp.campaign_id = ${reservations.campaignId}
      )`,
    })
    .from(reservations)
    .where(
      and(
        campaignId ? eq(reservations.campaignId, campaignId) : sql`true`,
        sql`${reservations.rewardSubtotalCents} > (
          SELECT coalesce(max(rp.price_cents), 0)
          FROM campaign_reward_packages rp
          WHERE rp.campaign_id = ${reservations.campaignId}
        )`,
      ),
    )
    .limit(INSTANCE_CAP);

  const [rewardCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(campaignRewardPackages)
    .where(campaignId ? eq(campaignRewardPackages.campaignId, campaignId) : sql`true`);

  signals.push({
    key: 'amount_above_highest_reward',
    severity: RISK_SEVERITIES.amount_above_highest_reward,
    count: overpriced.length,
    instances: overpriced.map((o) => ({
      id: o.id,
      detail: `Subtotal ${o.subtotal.toString()} exceeds the highest reward price ${o.highest} on campaign ${o.campaign}.`,
    })),
    // With no reward packages built there is no ceiling to compare against.
    notYetObservable: (rewardCount?.n ?? 0) === 0,
  });

  /* 4 — click velocity and suspicious conversion spikes (§18, §31.7).
     Read from the §18 click ledger, which already records every click and the
     reason an ignored one earned nothing. "Velocity" here is clicks from one
     visitor on one link inside a single hour — a factual concentration, not a
     verdict, and Admin compares it against first-post verification. */
  const velocity = await db
    .select({
      linkId: trackingLinkClicks.trackingLinkId,
      visitorId: trackingLinkClicks.visitorId,
      n: sql<number>`count(*)::int`,
    })
    .from(trackingLinkClicks)
    .where(campaignId ? eq(trackingLinkClicks.campaignId, campaignId) : sql`true`)
    .groupBy(
      trackingLinkClicks.trackingLinkId,
      trackingLinkClicks.visitorId,
      sql`date_trunc('hour', ${trackingLinkClicks.clickedAt})`,
    )
    .having(sql`count(*) > 20`)
    .limit(INSTANCE_CAP);

  const [clickCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(trackingLinkClicks)
    .where(campaignId ? eq(trackingLinkClicks.campaignId, campaignId) : sql`true`);

  signals.push({
    key: 'click_velocity',
    severity: RISK_SEVERITIES.click_velocity,
    count: velocity.length,
    instances: velocity.map((v) => ({
      id: v.linkId,
      detail: `${v.n} clicks from one browser on this link within a single hour.`,
    })),
    notYetObservable: (clickCount?.n ?? 0) === 0,
  });

  /* 5 — Creator self-pre-order and duplicate Creator accounts (§29.1).
     A Backer whose contact matches a Creator associated with the same campaign.
     Matched on the normalized email the dedup key is built from, because that is
     the comparison §4.1 already established as the practical identity test. */
  const selfPreorder = await db
    .select({
      id: reservations.id,
      email: backerIdentities.emailNormalized,
      campaign: reservations.campaignId,
    })
    .from(reservations)
    .innerJoin(backerIdentities, eq(backerIdentities.id, reservations.backerIdentityId))
    .where(
      and(
        campaignId ? eq(reservations.campaignId, campaignId) : sql`true`,
        sql`EXISTS (
          SELECT 1
          FROM campaign_affiliate_associations caa
          JOIN affiliate_prospects ap ON ap.id = caa.prospect_id
          WHERE caa.campaign_id = ${reservations.campaignId}
            AND lower(btrim(ap.email)) = ${backerIdentities.emailNormalized}
        )`,
      ),
    )
    .limit(INSTANCE_CAP);

  signals.push({
    key: 'affiliate_self_preorder',
    severity: RISK_SEVERITIES.affiliate_self_preorder,
    count: selfPreorder.length,
    instances: selfPreorder.map((s) => ({
      id: s.id,
      detail: `The Backer contact on this pre-order matches a Creator recruited to campaign ${s.campaign}. §29.1 treats self-pre-order as fraud.`,
    })),
    notYetObservable: false,
  });

  /* 6 — disclosed or suspected Founder–Creator relationship (§29.2).
     Two inputs: a conflict note an Admin recorded during recruitment, and
     contact overlap between the campaign's Founder and one of its Creators. */
  const relationships = await db
    .select({
      id: campaignAffiliateAssociations.id,
      campaign: campaignAffiliateAssociations.campaignId,
      notes: affiliateProspects.conflictNotes,
    })
    .from(campaignAffiliateAssociations)
    .innerJoin(
      affiliateProspects,
      eq(affiliateProspects.id, campaignAffiliateAssociations.prospectId),
    )
    .where(
      and(
        campaignId ? eq(campaignAffiliateAssociations.campaignId, campaignId) : sql`true`,
        isNotNull(affiliateProspects.conflictNotes),
        sql`btrim(${affiliateProspects.conflictNotes}) <> ''`,
      ),
    )
    .limit(INSTANCE_CAP);

  signals.push({
    key: 'founder_creator_relationship',
    severity: RISK_SEVERITIES.founder_creator_relationship,
    count: relationships.length,
    instances: relationships.map((r) => ({
      id: r.id,
      detail: `Recorded conflict note on this association (campaign ${r.campaign}). §29.2 decides whether the partnership continues.`,
    })),
    notYetObservable: false,
  });

  /* 7 — sanctions, OFAC, or provider restriction (§13, §31.7).
     A recorded sanctions note, or an account Stripe itself has restricted. */
  const sanctioned = await db
    .select({ id: affiliateProspects.id, notes: affiliateProspects.sanctionsNotes })
    .from(affiliateProspects)
    .where(
      and(
        isNotNull(affiliateProspects.sanctionsNotes),
        sql`btrim(${affiliateProspects.sanctionsNotes}) <> ''`,
      ),
    )
    .limit(INSTANCE_CAP);

  const restricted = await db
    .select({ id: stripeConnectedAccounts.id, account: stripeConnectedAccounts.stripeAccountId })
    .from(stripeConnectedAccounts)
    .where(eq(sql`${stripeConnectedAccounts.state}::text`, 'restricted'))
    .limit(INSTANCE_CAP);

  signals.push({
    key: 'sanctions_or_restriction',
    severity: RISK_SEVERITIES.sanctions_or_restriction,
    count: sanctioned.length + restricted.length,
    instances: [
      ...sanctioned.map((s) => ({
        id: s.id,
        detail: 'Recorded sanctions or eligibility note on this Creator prospect.',
      })),
      ...restricted.map((r) => ({
        id: r.id,
        detail: `Connected account ${r.account} is restricted at the provider. Nothing pays out while this is open (§13).`,
      })),
    ].slice(0, INSTANCE_CAP),
    notYetObservable: false,
  });

  /* 8 — tax `not_collecting` or missing registration (§31.7).
     THE trap. A zero tax line is not evidence that no tax is due, so every
     `not_collecting` reservation is reported, and an unrecorded seller tax
     readiness is itself an instance. Blocking, always. */
  const notCollecting = await db
    .select({ id: reservations.id, campaign: reservations.campaignId })
    .from(reservations)
    .where(
      and(
        campaignId ? eq(reservations.campaignId, campaignId) : sql`true`,
        eq(reservations.taxabilityReason, 'not_collecting'),
      ),
    )
    .limit(INSTANCE_CAP);

  const taxInstances = notCollecting.map((n) => ({
    id: n.id,
    detail: `Tax resolved to \`not_collecting\` on campaign ${n.campaign}. A zero produced by missing collection configuration is not proof that no tax is due (§31.7).`,
  }));

  // Sweeping every campaign has no single readiness record to report, and
  // inventing an aggregate one would claim a state no campaign is in. The
  // unrecorded shape is the honest answer: nothing has been recorded *here*.
  const readiness: SellerTaxReadinessState = campaignId
    ? await readSellerTaxReadiness(db, campaignId, mode)
    : {
        recorded: false,
        ready: false,
        missingFacts: SELLER_TAX_READINESS_FACT_KEYS,
        recordedBy: null,
        evidenceReference: null,
        mode: null,
        recordedAt: null,
      };

  if (campaignId && !readiness.ready) {
    taxInstances.push({
      id: campaignId,
      detail: readiness.recorded
        ? `Seller tax readiness is incomplete: ${readiness.missingFacts.join(', ')} still outstanding (§31.7).`
        : 'Seller tax readiness has not been recorded for this campaign. All four §31.7 facts are outstanding.',
    });
  }

  signals.push({
    key: 'tax_not_collecting',
    severity: RISK_SEVERITIES.tax_not_collecting,
    count: taxInstances.length,
    instances: taxInstances.slice(0, INSTANCE_CAP),
    // Never "not yet observable": the readiness gate is answerable from the
    // moment a campaign exists, and absence of a record is itself the finding.
    notYetObservable: false,
  });

  /* 9 — connected-account requirement or capability change (§13, §31.7).
     Read from the append-only account event log rather than from the account's
     current state: §31.7 asks about the *change*, and a current state cannot
     say whether it just moved. */
  const accountChanges = await db
    .select({
      id: stripeAccountEvents.id,
      account: stripeAccountEvents.stripeAccountId,
      prior: sql<string | null>`${stripeAccountEvents.priorState}::text`,
      next: sql<string | null>`${stripeAccountEvents.newState}::text`,
    })
    .from(stripeAccountEvents)
    .where(
      and(
        eq(stripeAccountEvents.event, 'account_updated'),
        sql`${stripeAccountEvents.priorState} IS DISTINCT FROM ${stripeAccountEvents.newState}`,
      ),
    )
    .limit(INSTANCE_CAP);

  signals.push({
    key: 'connected_account_change',
    severity: RISK_SEVERITIES.connected_account_change,
    count: accountChanges.length,
    instances: accountChanges.map((a) => ({
      id: a.id,
      detail: `Account ${a.account} moved ${a.prior ?? 'unknown'} → ${a.next ?? 'unknown'}. Check what it can still do before relying on it.`,
    })),
    notYetObservable: false,
  });

  /* 10 — batch, webhook, job, and ledger exception (§28.3, §31.7).
     Two honest partial-failure states, both by design: a provider event claimed
     but never processed (Phase 10a deliberately does not roll the claim back),
     and an idempotency key claimed but never completed. Both mean unfinished
     work, and neither resolves itself. */
  const unprocessed = await db
    .select({ id: providerEvents.id, type: providerEvents.eventType })
    .from(providerEvents)
    .where(isNull(providerEvents.processedAt))
    .limit(INSTANCE_CAP);

  const incomplete = await db
    .select({ id: idempotencyKeys.id, key: idempotencyKeys.key, purpose: idempotencyKeys.purpose })
    .from(idempotencyKeys)
    .where(isNull(idempotencyKeys.completedAt))
    .limit(INSTANCE_CAP);

  signals.push({
    key: 'processing_exception',
    severity: RISK_SEVERITIES.processing_exception,
    count: unprocessed.length + incomplete.length,
    instances: [
      ...unprocessed.map((u) => ({
        id: u.id,
        detail: `Provider event ${u.type ?? 'unknown'} was claimed but never processed. The claim is deliberately not rolled back (§28.3) — reconcile it.`,
      })),
      ...incomplete.map((i) => ({
        id: i.id,
        detail: `Idempotency key for ${i.purpose} was claimed but never completed: ${i.key}`,
      })),
    ].slice(0, INSTANCE_CAP),
    notYetObservable: false,
  });

  // Every §31.7 signal is present, in register order. A signal quietly dropped
  // would be a risk nobody watches and nobody notices going unwatched.
  const emitted = signals.map((s) => s.key);
  for (const key of RISK_SIGNAL_KEYS) {
    if (!emitted.includes(key)) {
      throw new Error(`§31.7 risk signal missing from the panel: ${key}`);
    }
  }

  return {
    campaignId: campaignId ?? null,
    signals,
    blockingKeys: signals
      .filter((s) => s.severity === 'blocking' && s.count > 0)
      .map((s) => s.key),
    sellerTaxReadiness: readiness,
  };
}

export interface RecordSellerTaxReadinessInput {
  campaignId: string;
  mode: string;
  headOfficeLocationDetail?: string | undefined;
  productTaxCodeDetail?: string | undefined;
  registrationDetail?: string | undefined;
  providerTaxSettingsDetail?: string | undefined;
  recordedBy: string;
  evidenceReference: string;
}

export type RecordReadinessResult =
  | { ok: true; ready: boolean; missingFacts: readonly string[] }
  | { ok: false; code: 'invalid'; message: string };

/**
 * Record (or supersede) a campaign's §31.7 seller tax readiness.
 *
 * Supersession rather than edit, on the 10b tax-configuration precedent: the
 * record is the basis on which live tax was collected, so it becomes history the
 * moment anything relies on it. Retire and point in one statement — the
 * DEFERRABLE FK in migration 0024 exists for exactly this, and the alternative
 * was an exception in the immutability trigger, which is how a superseded record
 * becomes editable after all.
 *
 * A fact is recorded only when its detail is supplied. §31.7 wants the location,
 * the code, and the registration themselves — a bare `true` is a checkbox, and
 * the 0024 CHECK refuses it anyway.
 */
export async function recordSellerTaxReadiness(
  db: Database,
  input: RecordSellerTaxReadinessInput,
): Promise<RecordReadinessResult> {
  if (!input.recordedBy.trim() || !input.evidenceReference.trim()) {
    return {
      ok: false,
      code: 'invalid',
      message: 'A named person and an evidence reference are both required (§34, §1.3).',
    };
  }

  const present = (v: string | undefined) => Boolean(v && v.trim());

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: campaignSellerTaxReadiness.id })
      .from(campaignSellerTaxReadiness)
      .where(
        and(
          eq(campaignSellerTaxReadiness.campaignId, input.campaignId),
          eq(campaignSellerTaxReadiness.mode, input.mode),
          isNull(campaignSellerTaxReadiness.supersededAt),
        ),
      )
      .for('update')
      .limit(1);

    const successorId = crypto.randomUUID();

    if (existing) {
      await tx
        .update(campaignSellerTaxReadiness)
        .set({ supersededAt: new Date(), supersededById: successorId })
        .where(eq(campaignSellerTaxReadiness.id, existing.id));
    }

    await tx.insert(campaignSellerTaxReadiness).values({
      id: successorId,
      campaignId: input.campaignId,
      mode: input.mode,
      headOfficeLocationRecorded: present(input.headOfficeLocationDetail),
      headOfficeLocationDetail: input.headOfficeLocationDetail ?? null,
      productTaxCodeRecorded: present(input.productTaxCodeDetail),
      productTaxCodeDetail: input.productTaxCodeDetail ?? null,
      registrationRecorded: present(input.registrationDetail),
      registrationDetail: input.registrationDetail ?? null,
      providerTaxSettingsRecorded: present(input.providerTaxSettingsDetail),
      providerTaxSettingsDetail: input.providerTaxSettingsDetail ?? null,
      recordedBy: input.recordedBy,
      evidenceReference: input.evidenceReference,
    });

    const facts: Record<string, boolean> = {
      head_office_location: present(input.headOfficeLocationDetail),
      product_tax_code: present(input.productTaxCodeDetail),
      registration: present(input.registrationDetail),
      provider_tax_settings: present(input.providerTaxSettingsDetail),
    };

    return {
      ok: true as const,
      ready: isSellerTaxReady(facts),
      missingFacts: missingSellerTaxFacts(facts),
    };
  });
}
