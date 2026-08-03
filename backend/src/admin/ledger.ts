/**
 * The §26.5 reservation and charge ledger.
 *
 * "Filter/export by: campaign, Founder, Creator/source/organic/house; date;
 * reservation/SetupIntent/PaymentIntent/retry status; refund/dispute;
 * consent/policy version and optional-consent state; unique Backer vs Product
 * transaction count; duplicate-review case/outcome; subtotal/tax/total, tax
 * expiry/usability; attribution/link activation; cap result."
 *
 * Eleven dimensions, all of them reads over columns Phases 03, 11, 14, and 15
 * already wrote. Nothing here computes money — the ledger *reports* the
 * waterfall, and a second arithmetic implementation living in a reporting query
 * is precisely how a preview and a charge come to disagree (§24.3: one
 * implementation, in `shared/money`).
 *
 * ── Seeing is not exporting (§25.7) ─────────────────────────────────────────
 * `listLedger` returns everything an Admin may look at, restricted columns
 * included, because support and risk work genuinely needs the Backer's email in
 * front of a person. `exportLedger` returns the permitted set only, and it reads
 * that set from the register rather than from the caller — the phase brief's
 * instruction is that §25.7's limits "apply to what Admin can hand out, not just
 * what they can see", and a limit the requester can widen is not a limit. There
 * is no override parameter, and adding one would be the whole point of the rule.
 *
 * ── Counting people is not counting transactions (§4.1) ─────────────────────
 * §26.5 asks for "unique Backer vs Product transaction count" as one dimension
 * because on a Product Campaign they differ: one person may hold several
 * transactions, each with its own reward, consent, tax, and cancellation. So the
 * summary reports both numbers side by side and never presents either as "the
 * number of Backers" on its own.
 */

import { and, asc, desc, eq, gte, inArray, lte, notInArray, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, reservations } from '../db/schema/domain.js';
import { backerIdentities, deduplicationCases } from '../db/schema/reservations.js';
import { trackingLinks } from '../db/schema/decisions.js';
import { PERMITTED_EXPORT_COLUMNS, type PermittedExportColumn } from './logic.js';

/** §23.5's eleven reservation states, as the ledger's lifecycle filter. */
export type ReservationStatusFilter =
  | 'reserved_active'
  | 'reserved_canceled'
  | 'threshold_not_met_no_charge'
  | 'pending_capture'
  | 'capture_failed_retrying'
  | 'capture_failed_dropped'
  | 'captured'
  | 'refunded'
  | 'reversed'
  | 'disputed'
  | 'killed_no_charge';

/**
 * §26.5's "refund/dispute" dimension.
 *
 * Derived from the reservation status rather than stored twice — §23.5 already
 * carries `refunded`, `reversed`, and `disputed` as states, and a parallel
 * boolean would be a second answer to a question the state machine settles.
 */
export type RefundDisputeFilter = 'any' | 'refunded' | 'reversed' | 'disputed' | 'none';

/** §26.5's "Creator/source/organic/house" dimension (§18's attribution sources). */
export type SourceFilter = 'creator' | 'organic' | 'house' | 'any';

export interface LedgerFilters {
  campaignId?: string;
  /** The Founder's user id. Resolved through the campaign's claim profile. */
  founderUserId?: string;
  source?: SourceFilter;
  /** A specific Creator association, when `source` is not enough. */
  associationId?: string;
  reservedFrom?: Date;
  reservedTo?: Date;
  statuses?: readonly ReservationStatusFilter[];
  /** True → only reservations whose SetupIntent succeeded (§33.5.4). */
  hasSetupIntent?: boolean;
  refundDispute?: RefundDisputeFilter;
  consentVersion?: string;
  consentAppendix?: string;
  /** §28.4's optional consents, filtered independently — never as one flag. */
  founderMarketingConsent?: boolean;
  newsletterConsent?: boolean;
  duplicateCaseStatus?: 'open' | 'merged' | 'separated' | 'none';
  minSubtotalCents?: bigint;
  maxSubtotalCents?: bigint;
  /** §19: a calculation that is unusable at capture means no charge at all. */
  taxUsableAtClose?: boolean;
  taxExpiredBefore?: Date;
  /** §31.7: `not_collecting` is a risk, and therefore a thing you filter for. */
  taxabilityReason?: string;
  attributionStatus?: string;
  /** True → the winning link was active at the moment of the click. */
  linkActivated?: boolean;
  capResult?: 'within_cap' | 'rejected_cap_exceeded' | 'not_evaluated';
  limit?: number;
  offset?: number;
}

export interface LedgerRow {
  reservationId: string;
  campaignId: string;
  campaignType: string | null;
  status: string;
  reservedAt: string | null;
  canceledAt: string | null;
  rewardSku: string | null;
  rewardTitle: string | null;
  rewardSubtotalCents: string;
  salesTaxCents: string;
  totalAuthorizedCents: string | null;
  totalCapturedCents: string;
  taxJurisdiction: string | null;
  taxabilityReason: string | null;
  taxCalculationExpiresAt: string | null;
  taxCloseUsable: boolean | null;
  consentAppendix: string | null;
  consentVersion: string | null;
  consentHash: string | null;
  founderMarketingConsent: boolean;
  newsletterConsent: boolean;
  operationalSharingAck: boolean;
  attributionSource: string | null;
  attributionStatus: string | null;
  attributionAssociationId: string | null;
  linkActivatedAt: string | null;
  capResult: string | null;
  duplicateCaseStatus: string | null;
  statementDescriptor: string | null;
  /* §25.7 restricted — on screen for support and risk, never in an export. */
  backerEmail: string | null;
  backerPhone: string | null;
  billingLine1: string | null;
  billingCity: string | null;
  surveyWhy: string | null;
  surveyRecommend: number | null;
  paymentMethodFingerprint: string | null;
  stripeCustomerId: string | null;
}

export interface LedgerSummary {
  /**
   * §26.5's own dimension: these are two different numbers on a Product
   * Campaign and the surface shows both. Reporting only the transaction count
   * would overstate reach; reporting only the Backer count would understate
   * revenue.
   */
  uniqueBackers: number;
  transactions: number;
  subtotalCents: string;
  taxCents: string;
  capturedCents: string;
}

export interface LedgerPage {
  rows: LedgerRow[];
  summary: LedgerSummary;
  total: number;
}

const MAX_PAGE = 200;

function conditions(filters: LedgerFilters): SQL[] {
  const where: SQL[] = [];

  if (filters.campaignId) where.push(eq(reservations.campaignId, filters.campaignId));
  if (filters.associationId) {
    where.push(eq(reservations.attributionAssociationId, filters.associationId));
  }

  // §18's three sources. `creator` is "an association won it"; `organic` and
  // `house` are the stored source values — asking for one of them must not
  // silently include the other.
  if (filters.source && filters.source !== 'any') {
    if (filters.source === 'creator') {
      where.push(sql`${reservations.attributionAssociationId} IS NOT NULL`);
    } else {
      where.push(
        and(
          eq(reservations.attributionSource, filters.source),
          sql`${reservations.attributionAssociationId} IS NULL`,
        ) as SQL,
      );
    }
  }

  if (filters.reservedFrom) where.push(gte(reservations.reservedAt, filters.reservedFrom));
  if (filters.reservedTo) where.push(lte(reservations.reservedAt, filters.reservedTo));

  if (filters.statuses && filters.statuses.length > 0) {
    where.push(inArray(sql`${reservations.status}::text`, [...filters.statuses]));
  }

  if (filters.hasSetupIntent !== undefined) {
    where.push(
      filters.hasSetupIntent
        ? sql`${reservations.setupIntentId} IS NOT NULL`
        : sql`${reservations.setupIntentId} IS NULL`,
    );
  }

  if (filters.refundDispute && filters.refundDispute !== 'any') {
    // §23.5 already carries these three as states, so the dimension is derived
    // rather than stored twice — a parallel boolean would be a second answer to
    // a question the state machine settles.
    const moneyBack: readonly string[] = ['refunded', 'reversed', 'disputed'];
    if (filters.refundDispute === 'none') {
      where.push(notInArray(sql<string>`${reservations.status}::text`, [...moneyBack]));
    } else {
      where.push(eq(sql`${reservations.status}::text`, filters.refundDispute));
    }
  }

  if (filters.consentVersion) where.push(eq(reservations.consentVersion, filters.consentVersion));
  if (filters.consentAppendix) {
    where.push(eq(reservations.consentAppendix, filters.consentAppendix));
  }
  // §28.4: two separate optional consents, filtered separately. One combined
  // "gave consent" filter would be the bundling the Spec forbids, in a report.
  if (filters.founderMarketingConsent !== undefined) {
    where.push(eq(reservations.founderMarketingConsent, filters.founderMarketingConsent));
  }
  if (filters.newsletterConsent !== undefined) {
    where.push(eq(reservations.newsletterConsent, filters.newsletterConsent));
  }

  if (filters.minSubtotalCents !== undefined) {
    where.push(gte(reservations.rewardSubtotalCents, filters.minSubtotalCents));
  }
  if (filters.maxSubtotalCents !== undefined) {
    where.push(lte(reservations.rewardSubtotalCents, filters.maxSubtotalCents));
  }

  if (filters.taxUsableAtClose !== undefined) {
    where.push(eq(reservations.taxCloseUsable, filters.taxUsableAtClose));
  }
  if (filters.taxExpiredBefore) {
    where.push(lte(reservations.taxCalculationExpiresAt, filters.taxExpiredBefore));
  }
  if (filters.taxabilityReason) {
    where.push(eq(reservations.taxabilityReason, filters.taxabilityReason));
  }

  if (filters.attributionStatus) {
    where.push(eq(reservations.attributionStatus, filters.attributionStatus));
  }
  if (filters.linkActivated !== undefined) {
    where.push(
      filters.linkActivated
        ? sql`${trackingLinks.activatedAt} IS NOT NULL`
        : sql`${trackingLinks.activatedAt} IS NULL`,
    );
  }

  if (filters.capResult) where.push(eq(sql`${reservations.capResult}`, filters.capResult));

  if (filters.duplicateCaseStatus) {
    where.push(
      filters.duplicateCaseStatus === 'none'
        ? sql`${deduplicationCases.id} IS NULL`
        : eq(sql`${deduplicationCases.status}::text`, filters.duplicateCaseStatus),
    );
  }

  if (filters.founderUserId) {
    // Resolved through the campaign rather than stored on the reservation: the
    // Founder of a campaign is a fact about the campaign, and copying it onto
    // every transaction would be a second place for it to be wrong.
    where.push(
      sql`EXISTS (
        SELECT 1 FROM founder_claim_profiles fcp
        WHERE fcp.campaign_id = ${reservations.campaignId}
          AND fcp.claimed_user_id = ${filters.founderUserId}
      )`,
    );
  }

  return where;
}

/**
 * The one query both the screen and the export run.
 *
 * Two callers, one set of filters, one join graph — an export that resolved its
 * rows differently from the screen would let an Admin export a set they never
 * saw, which is the reconciliation failure §26.5 exists to prevent.
 */
async function selectRows(db: Database, filters: LedgerFilters) {
  const where = conditions(filters);
  const limit = Math.min(filters.limit ?? 50, MAX_PAGE);

  return db
    .select({
      reservationId: reservations.id,
      campaignId: reservations.campaignId,
      campaignType: sql<string | null>`${campaigns.type}::text`,
      status: sql<string>`${reservations.status}::text`,
      reservedAt: reservations.reservedAt,
      canceledAt: reservations.canceledAt,
      rewardSku: reservations.rewardSku,
      rewardTitle: reservations.rewardTitle,
      rewardSubtotalCents: reservations.rewardSubtotalCents,
      salesTaxCents: reservations.salesTaxCents,
      totalAuthorizedCents: reservations.totalAuthorizedCents,
      totalCapturedCents: reservations.totalCapturedCents,
      taxJurisdiction: reservations.taxJurisdiction,
      taxabilityReason: reservations.taxabilityReason,
      taxCalculationExpiresAt: reservations.taxCalculationExpiresAt,
      taxCloseUsable: reservations.taxCloseUsable,
      consentAppendix: reservations.consentAppendix,
      consentVersion: reservations.consentVersion,
      consentHash: reservations.consentHash,
      founderMarketingConsent: reservations.founderMarketingConsent,
      newsletterConsent: reservations.newsletterConsent,
      operationalSharingAck: reservations.operationalSharingAck,
      attributionSource: reservations.attributionSource,
      attributionStatus: reservations.attributionStatus,
      attributionAssociationId: reservations.attributionAssociationId,
      linkActivatedAt: trackingLinks.activatedAt,
      capResult: reservations.capResult,
      duplicateCaseStatus: sql<string | null>`${deduplicationCases.status}::text`,
      statementDescriptor: reservations.statementDescriptor,
      backerEmail: reservations.backerEmail,
      backerPhone: reservations.backerPhone,
      billingLine1: reservations.billingLine1,
      billingCity: reservations.billingCity,
      surveyWhy: reservations.surveyWhy,
      surveyRecommend: reservations.surveyRecommend,
      paymentMethodFingerprint: reservations.paymentMethodFingerprint,
      stripeCustomerId: reservations.stripeCustomerId,
    })
    .from(reservations)
    .leftJoin(campaigns, eq(campaigns.id, reservations.campaignId))
    .leftJoin(trackingLinks, eq(trackingLinks.id, reservations.attributionTrackingLinkId))
    .leftJoin(
      deduplicationCases,
      eq(deduplicationCases.suspectedBackerIdentityId, reservations.backerIdentityId),
    )
    .where(where.length > 0 ? (and(...where) as SQL) : undefined)
    .orderBy(desc(reservations.reservedAt), asc(reservations.id))
    .limit(limit)
    .offset(filters.offset ?? 0);
}

function toRow(r: Awaited<ReturnType<typeof selectRows>>[number]): LedgerRow {
  return {
    reservationId: r.reservationId,
    campaignId: r.campaignId,
    campaignType: r.campaignType,
    status: r.status,
    reservedAt: r.reservedAt?.toISOString() ?? null,
    canceledAt: r.canceledAt?.toISOString() ?? null,
    rewardSku: r.rewardSku,
    rewardTitle: r.rewardTitle,
    rewardSubtotalCents: r.rewardSubtotalCents.toString(),
    salesTaxCents: r.salesTaxCents.toString(),
    totalAuthorizedCents: r.totalAuthorizedCents?.toString() ?? null,
    totalCapturedCents: r.totalCapturedCents.toString(),
    taxJurisdiction: r.taxJurisdiction,
    taxabilityReason: r.taxabilityReason,
    taxCalculationExpiresAt: r.taxCalculationExpiresAt?.toISOString() ?? null,
    taxCloseUsable: r.taxCloseUsable,
    consentAppendix: r.consentAppendix,
    consentVersion: r.consentVersion,
    consentHash: r.consentHash,
    founderMarketingConsent: r.founderMarketingConsent,
    newsletterConsent: r.newsletterConsent,
    operationalSharingAck: r.operationalSharingAck,
    attributionSource: r.attributionSource,
    attributionStatus: r.attributionStatus,
    attributionAssociationId: r.attributionAssociationId,
    linkActivatedAt: r.linkActivatedAt?.toISOString() ?? null,
    capResult: r.capResult,
    duplicateCaseStatus: r.duplicateCaseStatus,
    statementDescriptor: r.statementDescriptor,
    backerEmail: r.backerEmail,
    backerPhone: r.backerPhone,
    billingLine1: r.billingLine1,
    billingCity: r.billingCity,
    surveyWhy: r.surveyWhy,
    surveyRecommend: r.surveyRecommend,
    paymentMethodFingerprint: r.paymentMethodFingerprint,
    stripeCustomerId: r.stripeCustomerId,
  };
}

export async function listLedger(db: Database, filters: LedgerFilters = {}): Promise<LedgerPage> {
  const rows = (await selectRows(db, filters)).map(toRow);
  const where = conditions(filters);

  const [totals] = await db
    .select({
      transactions: sql<number>`count(*)::int`,
      uniqueBackers: sql<number>`count(DISTINCT ${reservations.backerIdentityId})::int`,
      subtotalCents: sql<string>`coalesce(sum(${reservations.rewardSubtotalCents}), 0)::text`,
      taxCents: sql<string>`coalesce(sum(${reservations.salesTaxCents}), 0)::text`,
      capturedCents: sql<string>`coalesce(sum(${reservations.totalCapturedCents}), 0)::text`,
    })
    .from(reservations)
    .leftJoin(campaigns, eq(campaigns.id, reservations.campaignId))
    .leftJoin(trackingLinks, eq(trackingLinks.id, reservations.attributionTrackingLinkId))
    .leftJoin(
      deduplicationCases,
      eq(deduplicationCases.suspectedBackerIdentityId, reservations.backerIdentityId),
    )
    .where(where.length > 0 ? (and(...where) as SQL) : undefined);

  return {
    rows,
    total: totals?.transactions ?? 0,
    summary: {
      transactions: totals?.transactions ?? 0,
      uniqueBackers: totals?.uniqueBackers ?? 0,
      subtotalCents: totals?.subtotalCents ?? '0',
      taxCents: totals?.taxCents ?? '0',
      capturedCents: totals?.capturedCents ?? '0',
    },
  };
}

export interface LedgerExport {
  columns: readonly PermittedExportColumn[];
  rows: Array<Record<string, string>>;
  /** Named in the response so the surface can state it, not just obey it. */
  withheldColumns: readonly string[];
  csv: string;
}

/**
 * §25.7's permitted export.
 *
 * The column list comes from the register, never from the caller. Every value
 * is stringified through the same path, so a bigint cannot serialise as
 * `12345n` in one column and `12345` in another and quietly break a
 * reconciliation in a spreadsheet.
 */
export async function exportLedger(
  db: Database,
  filters: LedgerFilters = {},
): Promise<LedgerExport> {
  const page = await listLedger(db, { ...filters, limit: MAX_PAGE });
  const columns = PERMITTED_EXPORT_COLUMNS;

  const rows = page.rows.map((row) => {
    const out: Record<string, string> = {};
    for (const column of columns) {
      const value = (row as unknown as Record<string, unknown>)[column];
      out[column] = value === null || value === undefined ? '' : String(value);
    }
    return out;
  });

  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [
    columns.join(','),
    ...rows.map((r) => columns.map((c) => escape(r[c] ?? '')).join(',')),
  ].join('\n');

  return {
    columns,
    rows,
    withheldColumns: [
      'backerEmail',
      'backerPhone',
      'billingLine1',
      'billingCity',
      'surveyWhy',
      'surveyRecommend',
      'paymentMethodFingerprint',
      'stripeCustomerId',
    ],
    csv,
  };
}

/**
 * §26.5's Backer-counting dimension, on its own.
 *
 * §4.1 makes "one active pre-order per practical unique Backer" an Idea rule and
 * explicitly permits a Product Backer several transactions, so the two counts
 * diverge by design and the ledger must never collapse them.
 */
export async function countBackersAndTransactions(
  db: Database,
  campaignId: string,
): Promise<{ uniqueBackers: number; transactions: number }> {
  const [row] = await db
    .select({
      transactions: sql<number>`count(*)::int`,
      uniqueBackers: sql<number>`count(DISTINCT ${reservations.backerIdentityId})::int`,
    })
    .from(reservations)
    .innerJoin(backerIdentities, eq(backerIdentities.id, reservations.backerIdentityId))
    .where(eq(reservations.campaignId, campaignId));

  return {
    uniqueBackers: row?.uniqueBackers ?? 0,
    transactions: row?.transactions ?? 0,
  };
}
