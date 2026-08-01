/**
 * What the workspace looks like to each actor — Spec §12, §24.6, §26.
 *
 * Three projections, and the differences between them are authorization
 * decisions rather than layout ones:
 *
 *  `readFounderWorkspace`  what the Founder is working on, plus the itemised
 *                          fee §12 requires and the §24.6 explanation that the
 *                          5% campaign fee is a different stream.
 *  `readAdminWorkspace`    §12's Admin list — every item, its evidence, the
 *                          discount line, the high-effort inputs, the fee
 *                          preview, interview state, invalidation history, and
 *                          any override.
 *  `readKitMaterials`      §12: "The preparing Campaign kit may show available
 *                          materials and high-effort result/basis." Approved
 *                          material only, and no compensation of any kind.
 *
 * ── Money crosses the wire as strings ───────────────────────────────────────
 * Cents are `bigint`. `JSON.stringify` throws on one, and coercing to `number`
 * is how integer-cent money quietly becomes a float. Every amount below is a
 * decimal string and the surface formats it with `shared/money`'s USD
 * formatter — which is also why the surface never does arithmetic on them.
 */

import { desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import {
  campaignOptionalItems,
  highEffortClassifications,
  listingFeeCalculations,
  optionalItemEvents,
} from '../db/schema/workspace.js';
import { loadWorkspaceRows, type WorkspaceRows } from './service.js';
import { readInterviewConfiguration, readBookingHistory } from './interview.js';
import { OPTIONAL_ITEM_KEYS, type OptionalItemKey } from './registry.js';

/* ── Shared shapes ────────────────────────────────────────────────────────── */

export interface ItemView {
  item: OptionalItemKey;
  complete: boolean;
  completedAt: string | null;
  decisionSource: string | null;
  rejections: string[];
  /** §12's "before payment" window for Admin invalidation and correction. */
  locked: boolean;
  invalidated: {
    at: string | null;
    /** Only the customer-facing wording reaches the Founder (§25.6). */
    explanation: string | null;
  };
}

export interface FeeView {
  baseCents: string;
  itemDiscountCents: string;
  maxDiscountCents: string;
  minSubtotalCents: string;
  completedItems: number;
  discountLines: Array<{ item: OptionalItemKey; discountCents: string }>;
  discountCents: string;
  subtotalCents: string;
  calculatedAt: string | null;
  /** True once Phase 11 has charged this calculation. */
  locked: boolean;
  /**
   * §24.6: the listing fee is its own stream. §12: "The 5% campaign fee is
   * separate and unchanged." The surface renders this beside the total so the
   * two are never read as one charge — the sentence is here rather than in the
   * component because it is a commercial statement, not copy.
   */
  separateStreamNote: string;
}

/**
 * §24.6 and §12, in one sentence the Founder reads under the total.
 *
 * It says three things deliberately: what this charge is, what the other one is,
 * and that the second is not part of the first. §3's banned vocabulary is
 * avoided and the internal names `listing_fee` and `platform_fee` do not appear.
 */
export const SEPARATE_STREAM_NOTE =
  'This is the one-off fee for listing your campaign, paid to Proovd. It is separate from the ' +
  '5% Proovd keeps from what your campaign actually collects — that is charged later, only on ' +
  'money you receive, and it is not part of this total.';

export interface HighEffortView {
  visualsCompleted: boolean;
  brandingCompleted: boolean;
  interviewScheduledOrConfirmed: boolean;
  highEffort: boolean;
  calculatedAt: string | null;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function itemView(row: typeof campaignOptionalItems.$inferSelect): ItemView {
  return {
    item: row.item,
    complete: row.complete,
    completedAt: row.completedAt?.toISOString() ?? null,
    decisionSource: row.decisionSource,
    rejections: Array.isArray(row.rejections) ? (row.rejections as string[]) : [],
    locked: row.lockedAt !== null,
    invalidated: {
      at: row.invalidatedAt?.toISOString() ?? null,
      explanation: row.invalidatedExplanation,
    },
  };
}

async function feeView(db: Database, campaignId: string): Promise<FeeView | null> {
  const [latest] = await db
    .select()
    .from(listingFeeCalculations)
    .where(eq(listingFeeCalculations.campaignId, campaignId))
    .orderBy(desc(listingFeeCalculations.calculatedAt))
    .limit(1);

  if (!latest) return null;

  return {
    baseCents: latest.baseCents.toString(),
    itemDiscountCents: latest.itemDiscountCents.toString(),
    maxDiscountCents: latest.maxDiscountCents.toString(),
    minSubtotalCents: latest.minSubtotalCents.toString(),
    completedItems: latest.completedItems,
    discountLines: (latest.discountLines as Array<{ item: OptionalItemKey; discountCents: string }>) ?? [],
    discountCents: latest.discountCents.toString(),
    subtotalCents: latest.subtotalCents.toString(),
    calculatedAt: latest.calculatedAt.toISOString(),
    locked: latest.lockedAt !== null,
    separateStreamNote: SEPARATE_STREAM_NOTE,
  };
}

async function highEffortView(db: Database, campaignId: string): Promise<HighEffortView | null> {
  const [latest] = await db
    .select()
    .from(highEffortClassifications)
    .where(eq(highEffortClassifications.campaignId, campaignId))
    .orderBy(desc(highEffortClassifications.calculatedAt))
    .limit(1);

  if (!latest) return null;

  return {
    visualsCompleted: latest.visualsCompleted,
    brandingCompleted: latest.brandingCompleted,
    interviewScheduledOrConfirmed: latest.interviewScheduledOrConfirmed,
    highEffort: latest.highEffort,
    calculatedAt: latest.calculatedAt.toISOString(),
  };
}

function assetViews(rows: WorkspaceRows, purpose: 'visual' | 'logo') {
  return rows.assets
    .filter((a) => a.purpose === purpose && a.removedAt === null)
    .map((a) => ({
      id: a.id,
      filename: a.originalFilename,
      contentType: a.contentType,
      state: a.state,
      rejection: a.rejection,
      approved: a.approvedAt !== null,
      width: a.width,
      height: a.height,
      byteSize: a.byteSize?.toString() ?? null,
    }));
}

/* ── The Founder ──────────────────────────────────────────────────────────── */

export interface FounderWorkspaceView {
  campaignId: string;
  campaignStatus: string;
  /** True once Phase 11 has charged. The whole surface goes read-only. */
  listingPaid: boolean;
  items: ItemView[];
  fee: FeeView | null;
  highEffort: HighEffortView | null;
  brand: {
    colors: string | null;
    typography: string | null;
    notes: string | null;
    approved: boolean;
    logos: ReturnType<typeof assetViews>;
  };
  story: { text: string | null; approved: boolean };
  visuals: ReturnType<typeof assetViews>;
  socials: Array<{
    id: string;
    url: string;
    platform: string | null;
    handle: string | null;
    accessible: boolean | null;
    rejection: string | null;
    controlsConfirmed: boolean;
    checkedAt: string | null;
  }>;
  interview: {
    bookable: boolean;
    /** Named so the surface can say what is missing rather than "unavailable". */
    missingSettings: string[];
    providers: string[];
    availability: string | null;
    booking: {
      id: string;
      status: string;
      scheduledAt: string | null;
      timezone: string | null;
      provider: string | null;
      link: string | null;
      interviewer: string | null;
    } | null;
  };
  lastSavedAt: string | null;
  resumeStep: string | null;
  /** False while Track A4 has not landed. The surface says so, honestly. */
  uploadsAvailable: boolean;
}

export async function readFounderWorkspace(
  db: Database,
  input: { campaignId: string; uploadsAvailable: boolean },
): Promise<FounderWorkspaceView | null> {
  const rows = await loadWorkspaceRows(db, input.campaignId);
  if (!rows) return null;

  const [campaign] = await db
    .select({ status: campaigns.status, listingPaidAt: campaigns.listingPaidAt })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);

  const [fee, highEffort, config] = await Promise.all([
    feeView(db, input.campaignId),
    highEffortView(db, input.campaignId),
    readInterviewConfiguration(db),
  ]);

  const ordered = OPTIONAL_ITEM_KEYS.map((key) => rows.items.find((i) => i.item === key)).filter(
    (row): row is typeof campaignOptionalItems.$inferSelect => row !== undefined,
  );

  return {
    campaignId: input.campaignId,
    campaignStatus: campaign?.status ?? 'unknown',
    listingPaid: campaign?.listingPaidAt !== null && campaign?.listingPaidAt !== undefined,
    items: ordered.map(itemView),
    fee,
    highEffort,
    brand: {
      colors: rows.workspace.brandColors,
      typography: rows.workspace.brandTypography,
      notes: rows.workspace.brandNotes,
      approved: rows.workspace.brandApprovedAt !== null,
      logos: assetViews(rows, 'logo'),
    },
    story: {
      text: rows.workspace.storyText,
      approved: rows.workspace.storyApprovedAt !== null,
    },
    visuals: assetViews(rows, 'visual'),
    socials: rows.socials
      .filter((s) => s.removedAt === null)
      .map((s) => ({
        id: s.id,
        url: s.url,
        platform: s.platform,
        handle: s.handle,
        accessible: s.accessible,
        rejection: s.rejection,
        controlsConfirmed: s.controlsConfirmed,
        checkedAt: s.checkedAt?.toISOString() ?? null,
      })),
    interview: {
      bookable: config.bookable,
      missingSettings: config.missingSettings,
      providers: config.providers,
      availability: config.availability,
      booking: rows.booking
        ? {
            id: rows.booking.id,
            status: rows.booking.status,
            scheduledAt: rows.booking.scheduledAt?.toISOString() ?? null,
            timezone: rows.booking.founderTimezone,
            provider: rows.booking.meetingProvider,
            link: rows.booking.meetingLink,
            interviewer: rows.booking.interviewer,
          }
        : null,
    },
    lastSavedAt: rows.workspace.lastSavedAt?.toISOString() ?? null,
    resumeStep: rows.workspace.resumeStep,
    uploadsAvailable: input.uploadsAvailable,
  };
}

/* ── Admin (§12, §26.2) ───────────────────────────────────────────────────── */

/**
 * §12: "Admin sees every item, evidence, status, discount line, high-effort
 * inputs, fee preview, interview state, invalidation history, and override."
 *
 * Every clause of that sentence is a field below, including the two the Founder
 * never sees: the raw evidence snapshot each decision rested on, and the
 * internal reason behind an invalidation (§25.6 keeps it in its own column
 * precisely so it can stay internal).
 */
export async function readAdminWorkspace(db: Database, campaignId: string) {
  const rows = await loadWorkspaceRows(db, campaignId);
  if (!rows) return null;

  const [fee, highEffort, itemHistory, bookingHistory, config] = await Promise.all([
    feeView(db, campaignId),
    highEffortView(db, campaignId),
    db
      .select()
      .from(optionalItemEvents)
      .where(eq(optionalItemEvents.campaignId, campaignId))
      .orderBy(desc(optionalItemEvents.occurredAt)),
    readBookingHistory(db, campaignId),
    readInterviewConfiguration(db),
  ]);

  return {
    campaignId,
    items: OPTIONAL_ITEM_KEYS.map((key) => {
      const row = rows.items.find((i) => i.item === key);
      if (!row) return null;
      return {
        ...itemView(row),
        // Admin only. The evidence snapshot and the internal reason.
        evidence: row.evidence,
        invalidatedReason: row.invalidatedReason,
        invalidatedBy: row.invalidatedBy,
        evaluatedAt: row.evaluatedAt?.toISOString() ?? null,
      };
    }).filter(Boolean),
    fee,
    highEffort,
    assets: rows.assets.map((a) => ({
      id: a.id,
      purpose: a.purpose,
      state: a.state,
      rejection: a.rejection,
      approved: a.approvedAt !== null,
      removed: a.removedAt !== null,
      filename: a.originalFilename,
      contentType: a.contentType,
      byteSize: a.byteSize?.toString() ?? null,
      width: a.width,
      height: a.height,
      storageKey: a.storageKey,
      createdBy: a.createdBy,
      createdAt: a.createdAt.toISOString(),
    })),
    socials: rows.socials.map((s) => ({
      id: s.id,
      url: s.url,
      accessible: s.accessible,
      httpStatus: s.httpStatus,
      rejection: s.rejection,
      /** §1.4: labelled as the Founder's statement, never as verified. */
      controlsConfirmedByFounder: s.controlsConfirmed,
      removed: s.removedAt !== null,
      checkedAt: s.checkedAt?.toISOString() ?? null,
    })),
    interview: {
      configuration: config,
      booking: rows.booking,
      history: bookingHistory,
    },
    itemHistory,
  };
}

/* ── The preparing Campaign kit (§12 Affiliate) ───────────────────────────── */

/**
 * §12: "The preparing Campaign kit may show available materials and high-effort
 * result/basis. It must not present a mutable compensation decision before
 * formal activation."
 *
 * Two rules, and the second is why this returns no percentage, no bid
 * eligibility, and no control of any kind — Phase 08c's projection selects no
 * compensation column at all and this adds none. "May show" is also read as
 * permission rather than obligation: only *approved* material appears, because
 * an unapproved draft is not something the Founder has agreed to show anyone.
 *
 * The high-effort result travels with its basis. §12 requires the criteria to be
 * presented neutrally and it is not a quality judgement, so the three inputs go
 * with it — a Creator who sees "high effort" and nothing else would read it as
 * a verdict.
 */
export interface KitMaterials {
  visuals: Array<{ id: string; contentType: string }>;
  hasLogo: boolean;
  brandDirection: { colors: string | null; typography: string | null } | null;
  story: string | null;
  socials: Array<{ url: string; platform: string | null }>;
  highEffort: HighEffortView | null;
  /** §12: high-effort "controls only whether an Affiliate can bid a percentage
      above the base; it does not control fixed-payment availability." */
  highEffortMeaning: string;
}

export const HIGH_EFFORT_MEANING =
  'High effort describes how much of the campaign material the Founder has prepared so far. It ' +
  'is not a judgement of the campaign or the Founder. It affects one thing only: whether a ' +
  'Creator may propose a percentage above the base rate. It does not affect whether a fixed ' +
  'payment is available.';

export async function readKitMaterials(
  db: Database,
  campaignId: string,
): Promise<KitMaterials | null> {
  const rows = await loadWorkspaceRows(db, campaignId);
  if (!rows) return null;

  const approvedVisuals = rows.assets.filter(
    (a) => a.purpose === 'visual' && a.state === 'stored' && a.approvedAt !== null && a.removedAt === null,
  );
  const approvedLogo = rows.assets.some(
    (a) => a.purpose === 'logo' && a.state === 'stored' && a.approvedAt !== null && a.removedAt === null,
  );

  return {
    visuals: approvedVisuals.map((a) => ({ id: a.id, contentType: a.contentType })),
    hasLogo: approvedLogo,
    brandDirection:
      rows.workspace.brandApprovedAt !== null
        ? { colors: rows.workspace.brandColors, typography: rows.workspace.brandTypography }
        : null,
    story: rows.workspace.storyApprovedAt !== null ? rows.workspace.storyText : null,
    socials: rows.socials
      .filter((s) => s.removedAt === null && s.accessible === true)
      .map((s) => ({ url: s.url, platform: s.platform })),
    highEffort: await highEffortView(db, campaignId),
    highEffortMeaning: HIGH_EFFORT_MEANING,
  };
}
