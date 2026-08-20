/**
 * Chapter 4, Wrap, and the Backers page — Founder Dashboard Session F.
 *
 * `docs/phases/founder-dashboard.md` F1–F5. This module composes what the
 * Founder reads after the money is out, and it adds ONE record (0058's data
 * request). Everything else it serves already existed and had no Founder route:
 *
 *   F1  §22.8's completion findings, §22.9's work-again asks, §22.10's two
 *       gates, §22.11's resolution — all read from Phase 21b's services.
 *   F2  §19's operational share. `founder_operational_shares` has been written
 *       by five services since Phase 15a and read by no Founder route. §19 says
 *       the share is MANDATORY and disclosed before consent, so this is a
 *       compliance gap closed rather than new capability.
 *   F3  §20's Explore section 10. The payload has shipped `available: []` since
 *       Phase 17a, honestly declaring its own absence; this is what fills it.
 *   F4  the Backer data request — §25.7's line, as a record a person decides.
 *
 * ── The export reads the register, and takes no argument that could widen it ─
 * `exportBackerRows` has exactly two parameters: the database and the campaign.
 * No column list, no purpose, no request id, no "include survey" flag — so
 * there is nothing an approved F4 request could arrive as, and approving one
 * cannot change what a file carries. 16a's rule, applied to the Founder side:
 * a limit the requester can widen is not a limit.
 *
 * ── §22.11's item keys stay internal ────────────────────────────────────────
 * `readResolution` returns the five areas with their outstanding §21
 * reconciliation ITEM KEYS — `batch_completeness`, `provisional_vs_earned`,
 * `founder_share_w9`. Those are Admin vocabulary and §3.1's whole risk is an
 * internal name reaching a customer, so the Founder projection carries whether
 * the campaign is resolved and when, and never which key is outstanding. That
 * is not a summary standing in for detail: which item an Admin still has to
 * verify is not something a Founder can act on, and §27.1's "who owns the next
 * step" is answered by naming Proovd.
 *
 * ── The Creator recap is §11's projection, unchanged ────────────────────────
 * `listFounderVisibleRoster` is frozen at seven columns and this module does
 * not widen it. What it adds beside each entry is the recorded §22.8 completion
 * status and any §22.9 ask — two facts about the RELATIONSHIP, both of which
 * the Founder is a party to.
 */

import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { AuditWriter } from '../auth/audit.js';
import { campaigns, reservations } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { founderOperationalShares } from '../db/schema/reservations.js';
import { campaignFulfillment } from '../db/schema/fulfillment.js';
import { creatorCompletionStatuses, workAgainRequests } from '../db/schema/completion.js';
import { founderBackerDataRequests } from '../db/schema/backer-data.js';
import { listFounderVisibleRoster } from '../affiliates/recruitment.js';
import { readResolution } from '../completion/resolution.js';
import { readNextCampaignReadiness } from '../completion/next-campaign.js';
import { backerProgressionStep } from '../completion/satisfaction.js';
import { BACKER_PROGRESSION } from '../completion/logic.js';
import {
  FOUNDER_EXPORT_COLUMNS,
  FOUNDER_EXPORT_WITHHELD,
  DO_NOT_FULFILL_LABEL,
  isBackerDataPurpose,
  type BackerDataPurposeKey,
  type BackerDataRequestDecision,
} from './logic.js';

/* ── F2: the §19 operational share ───────────────────────────────────────── */

export interface FounderBackerRow {
  /** The pre-order this row is about. Quoted to support (§3.1: never `reservation`). */
  preorderReference: string;
  backerEmail: string;
  rewardSku: string;
  rewardTitle: string;
  /** `active` — you owe this person — or `do_not_fulfill`. */
  fulfillmentState: 'active' | 'do_not_fulfill';
  /**
   * The pinned sentence when nothing is owed. Rendered instead of the state
   * word, because "do_not_fulfill" is an enum value and the Founder is being
   * told a fact about somebody's money.
   */
  doNotFulfillLabel: string | null;
  doNotFulfillAt: string | null;
  sharedAt: string;
  /** §31.8's step this pre-order has actually reached. Never a predicted one. */
  progressionStep: string;
  progressionLabel: string;
}

export interface FounderBackersView {
  campaignId: string;
  /** §19's own count of what was shared, including the withdrawn ones. */
  sharedCount: number;
  /** How many are still owed a reward. The number a Founder packs against. */
  activeCount: number;
  doNotFulfillCount: number;
  rows: FounderBackerRow[];
  /** Named before the download control is pressed (§20 Explore 10). */
  exportColumns: readonly { key: string; header: string; definition: string }[];
  exportWithheld: readonly { header: string; reason: string }[];
  /** The open F4 ask and every decided one, newest first. */
  dataRequests: BackerDataRequestRow[];
}

const PROGRESSION_LABELS = new Map(BACKER_PROGRESSION.map((step) => [step.key, step.label]));

/**
 * One query per campaign, plus the fulfillment record. §31.8's step is decided
 * by `backerProgressionStep` — the same pure rule the per-reservation read
 * calls — so a Backer's own page and the Founder's list cannot disagree about
 * where a pre-order is.
 */
async function gatherBackerRows(
  db: Database,
  campaignId: string,
): Promise<FounderBackerRow[]> {
  const rows = await db
    .select({
      reservationId: founderOperationalShares.reservationId,
      backerEmail: founderOperationalShares.backerEmail,
      rewardSku: founderOperationalShares.rewardSku,
      rewardTitle: founderOperationalShares.rewardTitle,
      fulfillmentState: founderOperationalShares.fulfillmentState,
      doNotFulfillAt: founderOperationalShares.doNotFulfillAt,
      sharedAt: founderOperationalShares.sharedAt,
      reservationStatus: reservations.status,
      deliveredAt: campaignFulfillment.deliveryNotifiedAt,
    })
    .from(founderOperationalShares)
    .innerJoin(reservations, eq(reservations.id, founderOperationalShares.reservationId))
    .leftJoin(campaignFulfillment, eq(campaignFulfillment.campaignId, founderOperationalShares.campaignId))
    .where(eq(founderOperationalShares.campaignId, campaignId))
    .orderBy(desc(founderOperationalShares.sharedAt));

  return rows.map((row) => {
    const step = backerProgressionStep(row.reservationStatus as string, row.deliveredAt != null);
    const withdrawn = row.fulfillmentState === 'do_not_fulfill';
    return {
      preorderReference: row.reservationId,
      backerEmail: row.backerEmail,
      rewardSku: row.rewardSku,
      rewardTitle: row.rewardTitle,
      fulfillmentState: withdrawn ? ('do_not_fulfill' as const) : ('active' as const),
      // §19: a canceled share renders as what it IS. The failure mode is
      // silent — a row presented as deliverable when the money never moved is
      // a Founder shipping to somebody who was never charged, and neither side
      // finds out until it arrives.
      doNotFulfillLabel: withdrawn ? DO_NOT_FULFILL_LABEL : null,
      doNotFulfillAt: row.doNotFulfillAt?.toISOString() ?? null,
      sharedAt: row.sharedAt.toISOString(),
      progressionStep: step,
      progressionLabel: PROGRESSION_LABELS.get(step) ?? step,
    };
  });
}

export async function readFounderBackers(
  db: Database,
  campaignId: string,
): Promise<FounderBackersView> {
  const [rows, dataRequests] = await Promise.all([
    gatherBackerRows(db, campaignId),
    listBackerDataRequests(db, campaignId),
  ]);

  return {
    campaignId,
    sharedCount: rows.length,
    activeCount: rows.filter((row) => row.fulfillmentState === 'active').length,
    doNotFulfillCount: rows.filter((row) => row.fulfillmentState === 'do_not_fulfill').length,
    rows,
    exportColumns: FOUNDER_EXPORT_COLUMNS,
    exportWithheld: FOUNDER_EXPORT_WITHHELD,
    dataRequests,
  };
}

/* ── F3: the export (§20 Explore 10, §25.7) ──────────────────────────────── */

export interface FounderExport {
  columns: readonly string[];
  rows: Record<string, string>[];
  csv: string;
  withheldColumns: readonly { header: string; reason: string }[];
  filename: string;
}

/**
 * §20's Explore section 10, finally populated.
 *
 * TWO parameters, and that is the guarantee. There is no column list to pass,
 * no purpose, no request id, no override — the columns come from
 * `FOUNDER_EXPORT_COLUMNS` and a caller cannot widen them, which is what makes
 * an approved F4 request grant nothing.
 */
export async function exportBackerRows(
  db: Database,
  campaignId: string,
): Promise<FounderExport> {
  const rows = await gatherBackerRows(db, campaignId);
  const columns = FOUNDER_EXPORT_COLUMNS;

  const out = rows.map((row) => {
    const record: Record<string, string> = {};
    for (const column of columns) {
      const value =
        column.key === 'fulfillmentState'
          ? // The pinned sentence, not the enum value. A spreadsheet cell
            // reading `do_not_fulfill` is an internal name in a file that
            // outlives the session (§3.1).
            (row.doNotFulfillLabel ?? 'deliver')
          : (row as unknown as Record<string, unknown>)[column.key];
      record[column.header] = value === null || value === undefined ? '' : String(value);
    }
    return record;
  });

  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const headers = columns.map((column) => column.header);
  const csv = [
    headers.join(','),
    ...out.map((record) => headers.map((header) => escape(record[header] ?? '')).join(',')),
  ].join('\n');

  return {
    columns: headers,
    rows: out,
    csv,
    withheldColumns: FOUNDER_EXPORT_WITHHELD,
    filename: `preorders-${campaignId}.csv`,
  };
}

/* ── F4: the Backer data request (§25.7) ─────────────────────────────────── */

export interface BackerDataRequestRow {
  id: string;
  purpose: string;
  detail: string;
  status: string;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

export async function listBackerDataRequests(
  db: Database,
  campaignId: string,
): Promise<BackerDataRequestRow[]> {
  const rows = await db
    .select({
      id: founderBackerDataRequests.id,
      purpose: founderBackerDataRequests.purpose,
      detail: founderBackerDataRequests.detail,
      status: founderBackerDataRequests.status,
      requestedAt: founderBackerDataRequests.requestedAt,
      decidedAt: founderBackerDataRequests.decidedAt,
      decisionNote: founderBackerDataRequests.decisionNote,
    })
    .from(founderBackerDataRequests)
    .where(eq(founderBackerDataRequests.campaignId, campaignId))
    .orderBy(desc(founderBackerDataRequests.requestedAt));

  return rows.map((row) => ({
    id: row.id,
    purpose: row.purpose,
    detail: row.detail,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
  }));
}

export type BackerDataRefusal =
  | 'purpose_not_permitted'
  | 'detail_required'
  | 'already_open'
  | 'not_found'
  | 'already_decided';

export type BackerDataOutcome =
  | { ok: true; requestId: string }
  | { ok: false; code: BackerDataRefusal; message: string };

export interface BackerDataDeps {
  db: Database;
  audit: AuditWriter;
}

/**
 * The Founder's ask. §25.7 permits fulfillment and support; marketing and
 * community are refused by name in the service AND by a 0058 CHECK, so a
 * hand-written INSERT gets the same answer a route does.
 */
export async function requestBackerData(
  deps: BackerDataDeps,
  input: {
    campaignId: string;
    founderUserId: string;
    purpose: string;
    detail: string;
  },
): Promise<BackerDataOutcome> {
  if (!isBackerDataPurpose(input.purpose)) {
    return {
      ok: false,
      code: 'purpose_not_permitted',
      message:
        '§25.7 permits Backer email and purchase details for fulfillment and support only. Marketing follow-up and adding people to a community are not purposes Proovd can approve.',
    };
  }
  const detail = input.detail.trim();
  if (!detail) {
    return {
      ok: false,
      code: 'detail_required',
      message: 'Tell us what you need and why, so somebody can answer you properly.',
    };
  }

  // One open ask per campaign. The 0058 partial unique index refuses a second
  // regardless; this is so a Founder reads a sentence rather than a constraint
  // name (§27.1).
  const [open] = await deps.db
    .select({ id: founderBackerDataRequests.id })
    .from(founderBackerDataRequests)
    .where(
      and(
        eq(founderBackerDataRequests.campaignId, input.campaignId),
        eq(founderBackerDataRequests.status, 'open'),
      ),
    )
    .limit(1);
  if (open) {
    return {
      ok: false,
      code: 'already_open',
      message: 'You already have a request waiting on Proovd for this campaign.',
    };
  }

  const [row] = await deps.db
    .insert(founderBackerDataRequests)
    .values({
      campaignId: input.campaignId,
      founderUserId: input.founderUserId,
      purpose: input.purpose satisfies BackerDataPurposeKey,
      detail,
    })
    .returning({ id: founderBackerDataRequests.id });

  await deps.audit({
    action: 'founder.backer_data_requested',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `§25.7 Backer data request (${input.purpose}). The record grants no access.`,
    newValue: { requestId: row?.id, purpose: input.purpose },
    actorId: input.founderUserId,
  });

  return { ok: true, requestId: row?.id ?? '' };
}

/**
 * Admin's answer. Write-once by trigger; the ask is immutable.
 *
 * It grants nothing — there is no column here an exporter reads, and
 * `exportBackerRows` has no parameter an approval could arrive as. An approved
 * request is a person's undertaking to act, and what they do next is §26.7's
 * support case (§1.3's manual-but-recorded path).
 */
export async function decideBackerDataRequest(
  deps: BackerDataDeps,
  input: {
    requestId: string;
    decision: BackerDataRequestDecision;
    decisionNote: string;
    decidedBy: string;
  },
): Promise<BackerDataOutcome> {
  const note = input.decisionNote.trim();
  if (!note) {
    return {
      ok: false,
      code: 'detail_required',
      message: 'A decision has to say what the Founder is being told (§27.1).',
    };
  }

  const moved = await deps.db
    .update(founderBackerDataRequests)
    .set({
      status: input.decision,
      decidedAt: new Date(),
      decidedBy: input.decidedBy,
      decisionNote: note,
    })
    .where(
      and(
        eq(founderBackerDataRequests.id, input.requestId),
        eq(founderBackerDataRequests.status, 'open'),
      ),
    )
    .returning({ id: founderBackerDataRequests.id, campaignId: founderBackerDataRequests.campaignId });

  const row = moved[0];
  if (!row) {
    return {
      ok: false,
      code: 'already_decided',
      message: 'That request has already been answered, or does not exist.',
    };
  }

  await deps.audit({
    action: `founder.backer_data_${input.decision}`,
    targetType: 'campaign',
    targetId: row.campaignId,
    internalReason: `§25.7 request ${row.id} ${input.decision}. Grants no access — an approval is an undertaking to act, not a column an exporter reads.`,
    customerExplanation: note,
    newValue: { requestId: row.id, decision: input.decision },
    actorId: input.decidedBy,
  });

  return { ok: true, requestId: row.id };
}

/** Every undecided ask across every campaign — the Admin queue. */
export async function readBackerDataQueue(db: Database) {
  return db
    .select({
      id: founderBackerDataRequests.id,
      campaignId: founderBackerDataRequests.campaignId,
      campaignTitle: campaignBuild.title,
      purpose: founderBackerDataRequests.purpose,
      detail: founderBackerDataRequests.detail,
      requestedAt: founderBackerDataRequests.requestedAt,
    })
    .from(founderBackerDataRequests)
    .leftJoin(campaignBuild, eq(campaignBuild.campaignId, founderBackerDataRequests.campaignId))
    .where(eq(founderBackerDataRequests.status, 'open'))
    .orderBy(asc(founderBackerDataRequests.requestedAt));
}

/* ── F1: completion, work again, the next campaign, resolution ───────────── */

export interface WrapCreatorRow {
  associationId: string;
  publicHandle: string | null;
  subtype: string | null;
  audienceNiche: string | null;
  adminBio: string | null;
  status: string;
  rosterMembership: string;
  /** §22.8's recorded decision, or null while Proovd has not made one. */
  completion: {
    status: 'successfully_completed' | 'completion_disqualified';
    decidedAt: string;
    /** Present only on a disqualification — §22.8 CHECK-refuses one on a completion. */
    reason: string | null;
  } | null;
  /** §22.9: whether this Creator may be asked, and the last ask if there is one. */
  workAgain: {
    eligible: boolean;
    request: { id: string; status: string; requestedAt: string; responseNote: string | null } | null;
  };
}

export interface FounderWrapView {
  campaignId: string;
  campaignStatus: string;
  closedAt: string | null;
  /** §22.11 as a Founder reads it: resolved or not, and never an item key. */
  resolution: {
    resolved: boolean;
    resolvedAt: string | null;
    /** §22.11's own sentence — money reconciled is not a reward shipped. */
    fulfillmentNote: string;
    fulfillmentActive: boolean;
    fulfilledAt: string | null;
  };
  creators: WrapCreatorRow[];
  /** §22.10's two gates, from Phase 21b's own resolver. */
  nextCampaign: Awaited<ReturnType<typeof readNextCampaignReadiness>>;
}

export async function readFounderWrap(
  db: Database,
  campaignId: string,
): Promise<FounderWrapView | null> {
  const [campaign] = await db
    .select({
      id: campaigns.id,
      status: campaigns.status,
      closeAt: campaigns.campaignCloseAt,
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return null;

  const [roster, resolution, nextCampaign] = await Promise.all([
    listFounderVisibleRoster(db, campaignId),
    readResolution(db, campaignId),
    readNextCampaignReadiness(db, campaignId),
  ]);

  /*
    By handle, and the surface says so.

    `listFounderVisibleRoster` returns newest-recruited first, which is right
    for Chapter 1 (a Founder answering proposals wants the newest) and wrong
    here: a recap ordered by anything a reader might mistake for merit IS a
    ranking, because the order is the claim (§30). The reference sorts this
    exact list by backer count and puts a numbered badge on the top three.

    Sorted here rather than in the projection because the projection is
    Chapter 1's too, and §20's `creator_results` already takes the same
    decision for the same reason (`ORDER BY public_handle`, Session D). A
    handle that is not set sorts last rather than first — an unnamed row at the
    top of a list reads as a placement.
  */
  const orderedRoster = [...roster].sort((left, right) =>
    (left.publicHandle ?? '￿').localeCompare(right.publicHandle ?? '￿'),
  );

  const associationIds = orderedRoster.map((entry) => entry.associationId);
  const [completions, asks] = await Promise.all([
    associationIds.length
      ? db
          .select({
            associationId: creatorCompletionStatuses.associationId,
            status: creatorCompletionStatuses.status,
            decidedAt: creatorCompletionStatuses.completedAt,
            reason: creatorCompletionStatuses.disqualifyingReason,
          })
          .from(creatorCompletionStatuses)
          .where(
            and(
              inArray(creatorCompletionStatuses.associationId, associationIds),
              isNull(creatorCompletionStatuses.supersededAt),
            ),
          )
      : Promise.resolve([]),
    associationIds.length
      ? db
          .select({
            id: workAgainRequests.id,
            associationId: workAgainRequests.associationId,
            status: workAgainRequests.status,
            requestedAt: workAgainRequests.requestedAt,
            responseNote: workAgainRequests.responseNote,
          })
          .from(workAgainRequests)
          .where(inArray(workAgainRequests.associationId, associationIds))
          .orderBy(desc(workAgainRequests.requestedAt))
      : Promise.resolve([]),
  ]);

  const completionByAssociation = new Map(completions.map((row) => [row.associationId, row]));
  const askByAssociation = new Map<string, (typeof asks)[number]>();
  for (const ask of asks) if (!askByAssociation.has(ask.associationId)) askByAssociation.set(ask.associationId, ask);

  return {
    campaignId,
    campaignStatus: campaign.status,
    closedAt: campaign.closeAt?.toISOString() ?? null,
    resolution: {
      resolved: resolution.resolvedAt !== null,
      resolvedAt: resolution.resolvedAt,
      fulfillmentNote: resolution.fulfillment.note,
      fulfillmentActive: resolution.fulfillment.active,
      fulfilledAt: resolution.fulfillment.fulfilledAt,
    },
    creators: orderedRoster.map((entry) => {
      const completion = completionByAssociation.get(entry.associationId) ?? null;
      const ask = askByAssociation.get(entry.associationId) ?? null;
      return {
        associationId: entry.associationId,
        publicHandle: entry.publicHandle,
        subtype: entry.subtype,
        audienceNiche: entry.audienceNiche,
        adminBio: entry.adminBio,
        status: entry.status,
        rosterMembership: entry.rosterMembership,
        completion: completion
          ? {
              status: completion.status as 'successfully_completed' | 'completion_disqualified',
              decidedAt: completion.decidedAt.toISOString(),
              reason: completion.reason,
            }
          : null,
        /*
          §22.9's own eligibility: the ask is available for a Creator whose
          recorded §22.8 status is `successfully_completed`. That is five
          criteria with no sales term in them at all (§33.10.6), which is why
          the reference's "top three by backers" is refused — it would make a
          §22.8 decision out of a revenue figure. `requestWorkAgain` re-decides
          this and its refusal is what a Founder reads (§1.1).
        */
        workAgain: {
          eligible: completion?.status === 'successfully_completed' && ask === null,
          request: ask
            ? {
                id: ask.id,
                status: ask.status,
                requestedAt: ask.requestedAt.toISOString(),
                responseNote: ask.responseNote,
              }
            : null,
        },
      };
    }),
    nextCampaign,
  };
}



