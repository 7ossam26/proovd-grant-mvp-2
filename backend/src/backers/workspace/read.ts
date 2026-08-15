/**
 * The Backers Admin read — Spec §26.1, §26.5, §25.7, §28.4, §18, §24.3.
 *
 * One read composing two views: what every Creator brought in, and every
 * Backer behind those totals. Both are filtered, searched, and (for the Backer
 * list) paginated IN POSTGRES, never in the browser.
 *
 * ── Why the filtering is server-side, and it is a privacy rule ──────────────
 * The other three workspaces compose a `searchText` and let the browser filter
 * it, because their row sets are bounded by how many Founders and Creators
 * exist. This one is not: a campaign has as many Backer rows as it has
 * pre-orders, and every row carries an email address and a free-text answer
 * about the person who wrote it. Shipping the whole set so the browser can hide
 * most of it would put every Backer's identity in devtools for anyone who opens
 * the page — the displayed set and the transmitted set would be different
 * things, which is the failure, not the performance cost. So the query is the
 * filter, and the response contains only the page that is rendered.
 *
 * The Affiliate view keeps `searchText` because its row set is bounded by the
 * roster, and it carries no Backer data at all.
 *
 * ── This module writes nothing ──────────────────────────────────────────────
 * No `.insert(`, `.update(`, or `.delete(` anywhere under `backers/`, and a
 * test asserts it. Every pre-order operation — §20's cancellation, §21's close
 * and retry, §24.8's refunds, §24.11's disputes, §26.7's kill — lives in the
 * router that owns its rules, and a read module that could write is one a later
 * session will make write.
 *
 * ── No N+1 ─────────────────────────────────────────────────────────────────
 * Six batched queries for the whole page, `inArray` fan-out, nothing inside a
 * loop. The Affiliate aggregation is ONE grouped query over `reservations`
 * rather than a per-Creator count, which is what `affiliates/workspace/
 * relationship.ts` does deliberately for one relationship and would be an N+1
 * here.
 */

import { and, eq, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  campaigns,
  campaignAffiliateAssociations,
  reservations,
} from '../../db/schema/domain.js';
import { campaignBuild } from '../../db/schema/build.js';
import { campaignDrafts, founderProspects } from '../../db/schema/invitations.js';
import { trackingLinks } from '../../db/schema/decisions.js';
import { affiliateSignupProfiles } from '../../db/schema/affiliate-signup.js';
import { affiliateProspects } from '../../db/schema/affiliates.js';
import { campaignBackerNumbers } from '../../db/schema/live-editing.js';
import { formatUsdCents } from '../../payments/listing-notifications.js';
import { formatDay } from '../../founders/format.js';
import {
  BACKER_PAGE_SIZE,
  COUNTED_BACKER_STATUSES,
  SURVEY_RECOMMEND_QUESTION,
  SURVEY_WHY_QUESTION,
  UNATTRIBUTED_FILTER_VALUE,
  clampPageSize,
  formatRecommendAnswer,
  windowDays,
} from './logic.js';
import type {
  AffiliateResultRow,
  AffiliateResultsView,
  BackerAnswer,
  BackerListView,
  BackerQuery,
  BackerRow,
  BackersDirectoryView,
} from './types.js';

/* ── Copy resolved server-side, so both surfaces read the same words ────────
   These mirror `shared/src/admin/backer-workspace.ts`. They are duplicated for
   the same reason every other backend restatement is — no runtime import
   across the build-root boundary — and the drift test compares them. */

const READ_ONLY =
  'This page reads the record. Cancelling, refunding, and charging a pre-order stay in the admin page that owns each one.';
const NO_RECORD_PAGE = 'One row per Backer. No extra record page.';
const ANSWERS_NOT_EXPORTABLE =
  'Survey answers and Backer contact details are visible here for support and risk work. §25.7 keeps them out of every export, and this page has no export.';
const CONSENT_ABSENT_IS_NOT_GRANTED =
  'No answer is not consent. An unchecked optional consent is recorded as not granted and is never read as granted.';
const TOTALS_EXCLUDE_ORGANIC =
  'These three count Creator-attributed pre-orders only. Organic pre-orders appear in Every Backer and are not in these totals.';
const NO_ATTRIBUTION_YET =
  'No pre-order on this campaign came through a Creator link yet. Every Backer arrived organically — see Every Backer.';
const NO_LAUNCH_ANCHOR_NOTE =
  'This campaign has not gone live, so there is no launch date to measure a window from. Showing every pre-order.';
const CONSENT_GRANTED_LABEL = 'Founder contact allowed';
const CONSENT_GRANTED_PERMITS =
  'The Founder may contact this Backer beyond fulfillment and may see these answers with the Backer’s identity attached.';
const CONSENT_NOT_GRANTED_LABEL = 'Founder contact not allowed';
const CONSENT_NOT_GRANTED_PERMITS =
  'Do not forward these answers to the Founder with the identity attached, and do not add this Backer to Founder marketing. Fulfillment and purchase support are unaffected.';

const STATUS_LABELS: Readonly<Record<string, string>> = {
  reserved_active: 'Reserved',
  reserved_canceled: 'Canceled by Backer',
  threshold_not_met_no_charge: 'Threshold not met — no charge',
  pending_capture: 'Charging',
  capture_failed_retrying: 'Card failed — in retry window',
  capture_failed_dropped: 'Card failed — closed at US$0.00',
  captured: 'Charged',
  refunded: 'Refunded',
  reversed: 'Reversed',
  disputed: 'Disputed',
  killed_no_charge: 'Closed by Proovd — no charge',
};

const ATTRIBUTION_LABELS: Readonly<Record<string, string>> = {
  verified: 'Verified',
  provisional: 'Provisional',
  blocked: 'Blocked',
  none: 'None',
};

export interface BackersDeps {
  db: Database;
}

/** A campaign id is checked before the query so a bad one 404s, not 500s. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeId(value: string): boolean {
  return UUID.test(value);
}

/* ── The window (§18, §21, §33.12.1) ───────────────────────────────────────*/

interface WindowBound {
  from: Date | null;
  to: Date | null;
  /** Set when a window was asked for and the campaign has no launch instant. */
  anchorNote: string | null;
}

/**
 * A window is a real bound on `reserved_at`, anchored on `campaign_live_at`.
 *
 * Never on `created_at` or `updated_at`: §33.12.1 treats reading either as a
 * campaign anchor as the failure, and its source scan enforces it. A campaign
 * with no launch instant therefore has no window at all — the read says so
 * rather than falling back, because a fallback would silently answer a
 * different question from the one the filter asked.
 */
function resolveWindow(
  windowKey: string | undefined,
  liveAt: Date | null,
): WindowBound {
  const days = windowDays(windowKey ?? 'lifetime');
  if (days === null) return { from: null, to: null, anchorNote: null };
  if (!liveAt) return { from: null, to: null, anchorNote: NO_LAUNCH_ANCHOR_NOTE };
  const to = new Date(liveAt.getTime() + days * 24 * 60 * 60 * 1000);
  return { from: liveAt, to, anchorNote: null };
}

/* ── The read ──────────────────────────────────────────────────────────────*/

export async function readBackersDirectory(
  deps: BackersDeps,
  query: BackerQuery,
): Promise<BackersDirectoryView> {
  const { db } = deps;

  const campaignFilter =
    query.campaignId && looksLikeId(query.campaignId) ? query.campaignId : undefined;

  /* 1 — every campaign, for the filter list and for the launch anchor. Bounded
         by campaign count, not Backer count.

         A campaign has no `title` column: the name is the build's title, and
         before a build exists it is the prospect's product name. That is the
         resolution `campaigns/workspace/facts.ts` uses, reproduced here rather
         than invented, so the two tabs cannot name the same campaign
         differently — which is exactly what the drill-through would expose. */
  const campaignRows = await db
    .select({
      id: campaigns.id,
      buildTitle: campaignBuild.title,
      productName: founderProspects.productName,
      liveAt: campaigns.campaignLiveAt,
    })
    .from(campaigns)
    .leftJoin(campaignBuild, eq(campaignBuild.campaignId, campaigns.id))
    .leftJoin(campaignDrafts, eq(campaignDrafts.campaignId, campaigns.id))
    .leftJoin(founderProspects, eq(founderProspects.id, campaignDrafts.prospectId));

  const campaignById = new Map(campaignRows.map((c) => [c.id, c]));
  const nameOf = (id: string | null): string => {
    if (!id) return 'Unknown campaign';
    const row = campaignById.get(id);
    return row?.buildTitle?.trim() || row?.productName?.trim() || 'Untitled campaign';
  };

  /* The anchor is the filtered campaign's own launch. With no campaign filter a
     window cannot be applied at all — two campaigns launched months apart have
     no shared "first 7 days", and averaging them would be the reference's
     fabricated arithmetic in another form. */
  const anchorCampaign = campaignFilter ? campaignById.get(campaignFilter) : undefined;
  const bound = campaignFilter
    ? resolveWindow(query.window, anchorCampaign?.liveAt ?? null)
    : { from: null, to: null, anchorNote: null };

  /* Conditions every read below shares. */
  const base: SQL[] = [inArray(reservations.status, COUNTED_BACKER_STATUSES)];
  if (campaignFilter) base.push(eq(reservations.campaignId, campaignFilter));
  if (bound.from) base.push(gte(reservations.reservedAt, bound.from));
  if (bound.to) base.push(lt(reservations.reservedAt, bound.to));

  /* 2 — the Affiliate aggregation. ONE grouped query, not one per Creator. */
  const grouped = await db
    .select({
      associationId: reservations.attributionAssociationId,
      campaignId: reservations.campaignId,
      backers: sql<number>`count(*)::int`,
      preorderValue: sql<string>`coalesce(sum(${reservations.rewardSubtotalCents}), 0)::text`,
    })
    .from(reservations)
    .where(and(...base))
    .groupBy(reservations.attributionAssociationId, reservations.campaignId);

  const attributedGroups = grouped.filter((g) => g.associationId !== null);
  const associationIds = attributedGroups
    .map((g) => g.associationId)
    .filter((id): id is string => id !== null);

  /* 3 — Creator identity and link activation for exactly those associations. */
  const creatorRows = associationIds.length
    ? await db
        .select({
          associationId: campaignAffiliateAssociations.id,
          profileHandle: affiliateSignupProfiles.publicHandle,
          profileName: affiliateSignupProfiles.legalName,
          prospectHandle: affiliateProspects.publicHandle,
          prospectName: affiliateProspects.legalName,
          activatedAt: trackingLinks.activatedAt,
        })
        .from(campaignAffiliateAssociations)
        .leftJoin(
          affiliateSignupProfiles,
          eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
        )
        .leftJoin(
          affiliateProspects,
          eq(affiliateProspects.id, campaignAffiliateAssociations.affiliateId),
        )
        .leftJoin(trackingLinks, eq(trackingLinks.associationId, campaignAffiliateAssociations.id))
        .where(inArray(campaignAffiliateAssociations.id, associationIds))
    : [];

  const creatorById = new Map(creatorRows.map((r) => [r.associationId, r]));

  /* ── Compose the Affiliate rows ──────────────────────────────────────── */
  const affiliateSearch = (query.affiliateSearch ?? '').trim().toLowerCase();

  const allAffiliateRows: AffiliateResultRow[] = attributedGroups.map((g) => {
    const associationId = g.associationId as string;
    const creator = creatorById.get(associationId);
    /* Admin may see the legal name (§11's projection restricts the FOUNDER, not
       this workspace); the handle falls back to the name so a cell is never
       blank, and both fall back to the id so a row is always identifiable. */
    const name =
      creator?.profileName?.trim() ||
      creator?.prospectName?.trim() ||
      creator?.profileHandle?.trim() ||
      creator?.prospectHandle?.trim() ||
      `Creator ${associationId.slice(0, 8)}`;
    const handle =
      creator?.profileHandle?.trim() || creator?.prospectHandle?.trim() || name;

    const backers = Number(g.backers);
    const valueCents = BigInt(g.preorderValue);
    const campaignName = nameOf(g.campaignId);

    /* Time active is derived from real timestamps and is null when there are
       none — the reference stored a `days` integer and then prorated it, which
       is what produced its fabricated figures. The end is the window's own
       upper bound where one was asked for, so "first 7 days" cannot report 26. */
    const activatedAt = creator?.activatedAt ?? null;
    const endAt = bound.to ?? new Date();
    const timeActive =
      activatedAt && endAt.getTime() > activatedAt.getTime()
        ? `${Math.max(1, Math.round((endAt.getTime() - activatedAt.getTime()) / 86_400_000))} days`
        : null;

    return {
      associationId,
      campaignId: g.campaignId,
      name,
      handle,
      campaignName,
      backers,
      backersLabel: backers === 1 ? 'Backer' : 'Backers',
      preorderValue: formatUsdCents(valueCents),
      timeActive,
      timeActiveWaitingOn: timeActive
        ? null
        : 'The tracking link has not been activated, so there is no active period yet (§18).',
      /* Value ÷ Backers. Null over zero rather than US$0.00 — §16a's rule:
         not yet populated is not zero, and an average of nothing is not zero. */
      average: backers > 0 ? formatUsdCents(valueCents / BigInt(backers)) : null,
      drillThrough: { campaignId: g.campaignId, associationId },
      searchText: `${name} ${handle} ${campaignName}`.toLowerCase(),
    };
  });

  allAffiliateRows.sort((a, b) => b.backers - a.backers || a.name.localeCompare(b.name));

  const affiliateRows = affiliateSearch
    ? allAffiliateRows.filter((r) => r.searchText.includes(affiliateSearch))
    : allAffiliateRows;

  /* ── Totals (§5.1 of the brief) ──────────────────────────────────────────
     Attributed only, and the labels say so. They are computed from the same
     grouped query the rows are, so the strip and the table cannot disagree. */
  const attributedBackers = attributedGroups.reduce((n, g) => n + Number(g.backers), 0);
  const attributedValue = attributedGroups.reduce((n, g) => n + BigInt(g.preorderValue), 0n);
  const organicBackers = grouped
    .filter((g) => g.associationId === null)
    .reduce((n, g) => n + Number(g.backers), 0);

  const affiliateResults: AffiliateResultsView = {
    rows: affiliateRows,
    shown: `${affiliateRows.length} ${affiliateRows.length === 1 ? 'Affiliate' : 'Affiliates'} shown`,
    /* The third empty state the reference has no copy for: real Backers, no
       attribution at all. "No Affiliate results match." would send an Admin
       looking for a broken filter. */
    noAttributionNote:
      allAffiliateRows.length === 0 && organicBackers > 0 ? NO_ATTRIBUTION_YET : null,
    anchorNote: bound.anchorNote,
  };

  /* ── The Backer list ─────────────────────────────────────────────────── */
  /* Campaign ids whose NAME matches the search term, resolved through the same
     `nameOf` the rows render with — so the search and the display can never
     disagree about what a campaign is called. It is done here rather than as a
     SQL predicate because the name is not a column: it lives on the build, and
     falls back to the prospect's product name. The set is bounded by campaign
     count, which is why a JS pass is honest here and would not be over rows. */
  const term = (query.backerSearch ?? '').trim().toLowerCase();
  const campaignsMatchingName = term
    ? campaignRows.map((c) => c.id).filter((id) => nameOf(id).toLowerCase().includes(term))
    : [];

  const backers = await readBackerPage(deps, query, base, nameOf, creatorById, campaignsMatchingName);

  return {
    totals: {
      attributedBackers: {
        value: attributedBackers.toLocaleString('en-US'),
        label: 'Affiliate Backers',
      },
      attributedValue: { value: formatUsdCents(attributedValue), label: 'Affiliate pre-order value' },
      affiliates: { value: String(allAffiliateRows.length), label: 'Affiliates' },
      excludesNote: TOTALS_EXCLUDE_ORGANIC,
      organicBackers,
    },
    campaigns: campaignRows
      .map((c) => ({ value: c.id, label: nameOf(c.id) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    affiliates: [
      { value: UNATTRIBUTED_FILTER_VALUE, label: 'Organic' },
      ...allAffiliateRows
        .map((r) => ({ value: r.associationId, label: r.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ],
    affiliateResults,
    backers,
    readOnly: READ_ONLY,
    noRecordPage: NO_RECORD_PAGE,
    answersNotExportable: ANSWERS_NOT_EXPORTABLE,
    consentAbsentIsNotGranted: CONSENT_ABSENT_IS_NOT_GRANTED,
  };
}

/* ── The Backer page ───────────────────────────────────────────────────────*/

type CreatorRow = {
  associationId: string;
  profileHandle: string | null;
  profileName: string | null;
  prospectHandle: string | null;
  prospectName: string | null;
  activatedAt: Date | null;
};

async function readBackerPage(
  deps: BackersDeps,
  query: BackerQuery,
  base: SQL[],
  nameOf: (id: string | null) => string,
  creatorById: Map<string, CreatorRow>,
  campaignsMatchingName: string[],
): Promise<BackerListView> {
  const { db } = deps;

  const conditions: SQL[] = [...base];

  /* The Affiliate filter. `organic` is a sentinel for absent attribution, so it
     becomes IS NULL rather than a comparison against a display string — the
     reference compared against the literal `'Organic'` in the same field that
     holds real names, which collides with the first Creator to use it. */
  const affiliate = (query.affiliate ?? '').trim();
  if (affiliate === UNATTRIBUTED_FILTER_VALUE) {
    conditions.push(sql`${reservations.attributionAssociationId} is null`);
  } else if (affiliate && looksLikeId(affiliate)) {
    conditions.push(eq(reservations.attributionAssociationId, affiliate));
  }

  /**
   * The search.
   *
   * §7.2 asks for a real strategy over answer bodies. This is a deliberate
   * constraint rather than an index: the term is matched with `ILIKE` against
   * the email, the survey answer, and the campaign title, and the row set it
   * scans is already narrowed by the campaign and Affiliate filters above —
   * which is how this surface is actually used, since the drill-through always
   * arrives with both set. A trigram or tsvector index over `survey_why` is the
   * next step if unfiltered search across every campaign becomes a real
   * workload; it is not added speculatively because an index on a free-text
   * column of personal data is a second copy of that data to keep and to sweep
   * under §25.8.
   */
  const term = (query.backerSearch ?? '').trim();
  if (term) {
    /* `%` and `_` are LIKE wildcards, so a term containing one must be escaped
       or a search for `%` matches every Backer in the product. Backslash is
       Postgres's default LIKE escape, so escaping it is enough — but the
       backslash itself has to be escaped first or `\` alone becomes a dangling
       escape and the query errors. */
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const match = or(
      sql`${reservations.backerEmail} ilike ${like}`,
      sql`${reservations.surveyWhy} ilike ${like}`,
      /* The campaign-name arm. Resolved to ids by the caller through the same
         `nameOf` the rows render with, because the name is not a column on
         `campaigns` — it is the build's title, falling back to the prospect's
         product name. An empty list contributes nothing rather than matching
         everything. */
      campaignsMatchingName.length
        ? inArray(reservations.campaignId, campaignsMatchingName)
        : sql`false`,
    );
    if (match) conditions.push(match);
  }

  const where = and(...conditions);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(reservations)
    .where(where);
  const total = Number(countRow?.total ?? 0);

  const pageSize = clampPageSize(query.pageSize);
  const page = Math.max(1, Math.trunc(query.page ?? 1) || 1);
  const offset = (page - 1) * pageSize;

  const rows = await db
    .select({
      reservationId: reservations.id,
      campaignId: reservations.campaignId,
      backerIdentityId: reservations.backerIdentityId,
      email: reservations.backerEmail,
      subtotal: reservations.rewardSubtotalCents,
      status: sql<string>`${reservations.status}::text`,
      reservedAt: reservations.reservedAt,
      surveyWhy: reservations.surveyWhy,
      surveyRecommend: reservations.surveyRecommend,
      marketingConsent: reservations.founderMarketingConsent,
      associationId: reservations.attributionAssociationId,
      attributionStatus: reservations.attributionStatus,
    })
    .from(reservations)
    .where(where)
    .orderBy(sql`${reservations.reservedAt} desc nulls last`, reservations.id)
    .limit(pageSize)
    .offset(offset);

  /* §18's per-campaign Backer number, for exactly the identities on this page.
     Sparse by design — a number is minted when a Backer comments (17b) — so its
     absence is normal and never a gap to fill with something derived. */
  const identityIds = [...new Set(rows.map((r) => r.backerIdentityId).filter(Boolean))];
  const numberRows = identityIds.length
    ? await db
        .select({
          identityId: campaignBackerNumbers.backerIdentityId,
          number: campaignBackerNumbers.backerNumber,
        })
        .from(campaignBackerNumbers)
        .where(inArray(campaignBackerNumbers.backerIdentityId, identityIds))
    : [];
  const numberByIdentity = new Map(numberRows.map((r) => [r.identityId, r.number]));

  const composed: BackerRow[] = rows.map((r) => {
    const creator = r.associationId ? creatorById.get(r.associationId) : undefined;
    const affiliateName =
      creator?.profileName?.trim() ||
      creator?.prospectName?.trim() ||
      creator?.profileHandle?.trim() ||
      creator?.prospectHandle?.trim() ||
      (r.associationId ? `Creator ${r.associationId.slice(0, 8)}` : null);
    const affiliateHandle =
      creator?.profileHandle?.trim() || creator?.prospectHandle?.trim() || affiliateName;

    const campaignName = nameOf(r.campaignId);
    const granted = r.marketingConsent === true;

    /* §19's two questions. An unanswered one renders as unanswered — never a
       substituted default, which is what the reference did for both. */
    const answers: BackerAnswer[] = [
      {
        question: SURVEY_WHY_QUESTION,
        answer: r.surveyWhy?.trim() || 'Not answered',
        answered: Boolean(r.surveyWhy?.trim()),
      },
      {
        question: SURVEY_RECOMMEND_QUESTION,
        answer:
          typeof r.surveyRecommend === 'number'
            ? formatRecommendAnswer(r.surveyRecommend)
            : 'Not answered',
        answered: typeof r.surveyRecommend === 'number',
      },
    ];

    const email = r.email ?? 'No email on the record';

    return {
      reservationId: r.reservationId,
      backerNumber: numberByIdentity.get(r.backerIdentityId) ?? null,
      email,
      campaignId: r.campaignId,
      campaignName,
      orderAmount: formatUsdCents(BigInt(r.subtotal ?? 0)),
      affiliateName,
      affiliateHandle: r.associationId ? affiliateHandle : null,
      associationId: r.associationId,
      attributionStatus:
        ATTRIBUTION_LABELS[r.attributionStatus ?? 'none'] ?? (r.attributionStatus as string),
      statusLabel: STATUS_LABELS[r.status] ?? r.status,
      date: formatDay(r.reservedAt) ?? 'No date on the record',
      answers,
      consentState: granted ? 'granted' : 'not_granted',
      consentLabel: granted ? CONSENT_GRANTED_LABEL : CONSENT_NOT_GRANTED_LABEL,
      consentPermits: granted ? CONSENT_GRANTED_PERMITS : CONSENT_NOT_GRANTED_PERMITS,
      /* Composed for the rendered page only. The SEARCH runs in Postgres over
         the whole set; this exists so the browser can highlight, not filter. */
      searchText: `${email} ${campaignName} ${affiliateName ?? 'Organic'}`.toLowerCase(),
    };
  });

  return {
    rows: composed,
    shown: `${total.toLocaleString('en-US')} ${total === 1 ? 'Backer' : 'Backers'} shown`,
    page,
    pageSize,
    total,
    hasMore: offset + composed.length < total,
  };
}

export { BACKER_PAGE_SIZE };
