/**
 * The Campaigns Admin reads — Spec §26.1, §26.8, §16a's populated rule.
 *
 * Two reads: the directory and one record. Both compose from
 * `gatherCampaignFacts`, so the row and the record it opens are the same code
 * path — a list and a detail page that derive the same fact twice is how they
 * come to disagree.
 *
 * ── Not yet populated is not zero (§1.4, §16a) ──────────────────────────────
 * Every campaign ledger column defaults to 0 and every cross-domain record is
 * absent until its phase runs, so a naive summary says "US$0.00 charged" for a
 * campaign whose close batch has never run — indistinguishable from one that
 * charged nothing. Every `CampaignFact` on this page therefore carries either a
 * value or what it is waiting for, and never a zero standing in for both.
 *
 * ── This module writes nothing ──────────────────────────────────────────────
 * There is no `.insert(`, `.update(` or `.delete(` anywhere in
 * `campaigns/workspace/`, and a test asserts it. Campaigns is a hub: every
 * decision is made in the workspace that owns it, and a read module that could
 * write is one a later session will make write.
 */

import type { Database } from '../../db/client.js';
import { campaignStatusLabel } from '../../founders/logic.js';
import { formatDay, formatInstant } from '../../founders/format.js';
import { formatUsdCents } from '../../payments/listing-notifications.js';
import {
  CAMPAIGNS_IS_READ_ONLY,
  PROOVD_DECISION_HAS_NO_SCREEN,
  THRESHOLD_NOT_SET_NOTE,
  campaignDestination,
  campaignDisplayId,
  campaignInitials,
  CAMPAIGN_PUBLIC_STATE_LABELS,
  type CampaignDestinationKey,
} from './logic.js';
import {
  affiliateSummary,
  campaignNameOf,
  deriveBlocker,
  deriveDateLabel,
  deriveGroups,
  derivePublic,
  deriveStages,
  deriveStateKind,
  reviewSummary,
  supportSummary,
  typeLabelOf,
  type DerivedBlocker,
} from './derive.js';
import { gatherCampaignFacts, listCampaignIds, type CampaignFacts } from './facts.js';
import { composeCampaignHistory } from './history.js';
import type {
  CampaignBlocker,
  CampaignDirectoryRow,
  CampaignDirectoryView,
  CampaignFact,
  CampaignRecordLink,
  CampaignRecordView,
} from './types.js';

export interface CampaignReadDeps {
  db: Database;
  /** Where a public campaign page resolves — the origin the SPA is served from. */
  appBaseUrl: string;
}

/* ── Destinations ──────────────────────────────────────────────────────────*/

/**
 * One routing row, resolved against what actually exists.
 *
 * `href` and `unavailableBecause` are mutually exclusive by construction: the
 * register decides which side a destination is on, and this only supplies the
 * address for the built ones. A destination cannot acquire a fabricated route
 * by somebody editing this function, because the `built` flag is what gates it.
 */
function link(
  key: CampaignDestinationKey,
  detail: string,
  href: string | null,
): CampaignRecordLink {
  const destination = campaignDestination(key);
  if (!destination.built) {
    return {
      key,
      label: destination.label,
      detail,
      mark: destination.mark,
      href: null,
      unavailableBecause: destination.absentBecause ?? null,
    };
  }
  return {
    key,
    label: destination.label,
    detail,
    mark: destination.mark,
    href,
    unavailableBecause: href ? null : 'This record has no address in that workspace yet.',
  };
}

/**
 * The Founder workspace address for this campaign's Founder.
 *
 * Null when no prospect backs the campaign — which is possible for a campaign
 * created outside the §7 invitation path. Naming a route for a prospect that
 * does not exist would send an Admin to a 404 (§1.4).
 */
function founderHrefOf(facts: CampaignFacts): string | null {
  return facts.prospectId ? `/admin/founders/${facts.prospectId}` : null;
}

/**
 * The Creators workspace address for this campaign's roster.
 *
 * It is the DIRECTORY with the campaign name pre-searched, not a relationship
 * address, and that is a real limitation rather than a shortcut: the Creators
 * workspace is keyed on the PERSON (2026-08-11), and a campaign has a roster
 * rather than one Creator. The directory's `searchText` is composed server-side
 * across every campaign a Creator is on, which is why searching it works.
 *
 * `?q=` is honoured — `CreatorsDirectory` reads it into its search box, which
 * it did NOT do when this link was first written. A parameter a surface accepts
 * and drops is worse than one it never offered, so that was fixed on the
 * Creators side rather than papered over here.
 */
function affiliateHrefOf(name: string): string {
  return `/admin/creators?q=${encodeURIComponent(name)}`;
}

/** The Support queue, filtered to what is still open. */
const SUPPORT_HREF = '/admin/support';

function routeFor(blockerResult: DerivedBlocker, facts: CampaignFacts, name: string): CampaignRecordLink | null {
  if (!blockerResult.blocked) return null;
  switch (blockerResult.owner) {
    case 'founder':
      return link('founder_admin', blockerResult.text, founderHrefOf(facts));
    case 'creator':
      return link('affiliate_admin', blockerResult.text, affiliateHrefOf(name));
    case 'proovd_support':
      return link('support_admin', blockerResult.text, SUPPORT_HREF);
    case 'proovd_review':
    case 'proovd_operations':
      /* §15's review rounds and §16/§17's scheduling have routers and no
         screen — the old dashboard was replaced and those surfaces are
         supplied separately. Sending an Admin to the Founder workspace would
         be a wrong destination presented as a right one, which is worse than
         none, so the control is shown and says what is missing. */
      return {
        key: 'proovd_decision',
        label: 'Proovd decision',
        detail: blockerResult.text,
        mark: 'P',
        href: null,
        unavailableBecause: PROOVD_DECISION_HAS_NO_SCREEN,
      };
    default:
      return null;
  }
}

function toBlocker(
  blockerResult: DerivedBlocker,
  route: CampaignRecordLink | null,
): CampaignBlocker {
  return {
    blocked: blockerResult.blocked,
    clear: blockerResult.clear,
    text: blockerResult.text,
    owner: blockerResult.owner,
    ownerLabel: blockerResult.ownerLabel,
    due: blockerResult.due,
    route,
  };
}

/* ── Facts ─────────────────────────────────────────────────────────────────*/

function fact(label: string, value: string | null, waitingOn: string | null): CampaignFact {
  return { label, value, waitingOn };
}

/* ── The directory ─────────────────────────────────────────────────────────*/

/**
 * Every campaign, one row each.
 *
 * `searchText` is composed HERE rather than in the browser, so the directory
 * and the global palette match on exactly the same haystack — the arrangement
 * the Creators workspace established, and the reason typing a Founder's name
 * finds their campaign. It carries the full campaign id AND its short display
 * form, because an operator pasting either is asking the same question.
 */
export async function listCampaignDirectory(
  deps: CampaignReadDeps,
  now: Date = new Date(),
): Promise<CampaignDirectoryView> {
  const ids = await listCampaignIds(deps.db);
  const facts = await gatherCampaignFacts(deps.db, ids);

  const rows: CampaignDirectoryRow[] = [];
  for (const id of ids) {
    const entry = facts.get(id);
    if (!entry) continue;
    const name = campaignNameOf(entry);
    const blockerResult = deriveBlocker(entry, now);
    const route = routeFor(blockerResult, entry, name);

    rows.push({
      campaignId: id,
      displayId: campaignDisplayId(id),
      initials: campaignInitials(name),
      name,
      company: entry.companyName,
      founderName: entry.founderName,
      founderHref: founderHrefOf(entry),
      typeLabel: typeLabelOf(entry),
      stateLabel: campaignStatusLabel(entry.campaign.status),
      rawStatus: entry.campaign.status,
      stateKind: deriveStateKind(entry, blockerResult),
      groups: deriveGroups(entry, blockerResult),
      blocker: toBlocker(blockerResult, route),
      dateLabel: deriveDateLabel(entry),
      searchText: [
        name,
        entry.companyName ?? '',
        entry.founderName ?? '',
        id,
        campaignDisplayId(id),
        campaignStatusLabel(entry.campaign.status),
      ]
        .join(' ')
        .toLowerCase(),
    });
  }

  return {
    checkedAt: now.toISOString(),
    rows,
    /* The hero's number, and its caption says "waiting for SOMEONE" — so it
       counts rows a named party owes, never the `system` ones. Derived on every
       read; a stored count is a second campaign-state store. */
    blockedCount: rows.filter((row) => row.blocker.blocked).length,
  };
}

/* ── The record ────────────────────────────────────────────────────────────*/

export async function readCampaignRecord(
  deps: CampaignReadDeps,
  campaignId: string,
  now: Date = new Date(),
): Promise<CampaignRecordView | null> {
  const facts = await gatherCampaignFacts(deps.db, [campaignId]);
  const entry = facts.get(campaignId);
  if (!entry) return null;

  const campaign = entry.campaign;
  const name = campaignNameOf(entry);
  const blockerResult = deriveBlocker(entry, now);
  const route = routeFor(blockerResult, entry, name);
  const publicPage = derivePublic(entry, deps.appBaseUrl);
  const blocker = toBlocker(blockerResult, route);

  const review = reviewSummary(entry);
  const affiliates = affiliateSummary(entry);
  const support = supportSummary(entry);
  const activeCount = entry.reservationCounts.get('reserved_active') ?? 0;

  const founderLink = link(
    'founder_admin',
    `Campaign review: ${review}`,
    founderHrefOf(entry),
  );
  const affiliateLink = link('affiliate_admin', `Creator work: ${affiliates}`, affiliateHrefOf(name));
  const supportLink = link('support_admin', `Support cases: ${support}`, SUPPORT_HREF);
  const backerLink = link('backer_admin', `${activeCount} active pre-orders`, null);
  const moneyLink = link('money_admin', moneyLine(entry), null);
  const tasksLink = link('tasks', 'Work is recorded on the record it belongs to', null);

  const launchLabel = formatInstant(campaign.campaignLiveAt) ?? 'Not set';
  const closeLabel = formatInstant(campaign.campaignCloseAt) ?? 'Not set';

  return {
    checkedAt: now.toISOString(),
    header: {
      campaignId,
      displayId: campaignDisplayId(campaignId),
      name,
      company: entry.companyName,
      founderName: entry.founderName,
      founderHref: founderHrefOf(entry),
      typeLabel: typeLabelOf(entry),
      stateLabel: campaignStatusLabel(campaign.status),
      rawStatus: campaign.status,
      stateKind: deriveStateKind(entry, blockerResult),
      waitingOnLabel: blocker.blocked ? blocker.ownerLabel : 'Nobody',
      launch: launchLabel,
      close: closeLabel,
      publicState: publicPage.state,
      publicStateLabel: CAMPAIGN_PUBLIC_STATE_LABELS[publicPage.state],
      publicUrl: publicPage.url,
      publicUrlUnavailableBecause: publicPage.unavailableBecause,
    },
    overview: {
      blocker,
      quickFacts: [
        fact('Type', typeLabelOf(entry), typeLabelOf(entry) ? null : 'The campaign type locks when setup is submitted'),
        fact('Founder', entry.founderName, entry.founderName ? null : 'No Founder record is linked to this campaign'),
        fact('Review', review, null),
        fact('Creator work', affiliates, null),
        fact(
          'Public page',
          CAMPAIGN_PUBLIC_STATE_LABELS[publicPage.state],
          publicPage.note,
        ),
      ],
      stages: deriveStages(entry),
      dates: [
        fact('Launch', formatInstant(campaign.campaignLiveAt), campaign.campaignLiveAt ? null : 'No launch date has been scheduled'),
        fact('Close', formatInstant(campaign.campaignCloseAt), campaign.campaignCloseAt ? null : 'The close date is set when the campaign launches'),
        fact('Listing fee paid', formatInstant(campaign.listingPaidAt), campaign.listingPaidAt ? null : 'The listing fee has not been paid'),
        fact(
          'Discovery opened',
          formatDay(campaign.discoveryOpenedAt),
          campaign.discoveryOpenedAt ? null : 'Proovd browse and search open on Day 8 of a live campaign',
        ),
      ],
      links: [founderLink, affiliateLink, backerLink, moneyLink, supportLink, tasksLink],
    },
    liveTab: composeLive(entry, {
      publicStateLabel: CAMPAIGN_PUBLIC_STATE_LABELS[publicPage.state],
      links: [backerLink, affiliateLink, supportLink],
    }),
    close: composeClose(entry, [backerLink, moneyLink, supportLink, affiliateLink]),
    history: await composeCampaignHistory(deps.db, campaignId),
  };
}

/* ── The Live pane ─────────────────────────────────────────────────────────*/

/**
 * The live totals, or the reason there are none.
 *
 * "Live" here means the campaign actually went live — `campaign_live_at` is
 * set. A campaign that never launched gets the not-live state and its dates
 * rather than a metric hero reading three zeros, because a zero that means "no
 * pre-orders" and a zero that means "this never opened" are different facts and
 * the hero is the most quotable thing on the page (§16a).
 */
function composeLive(
  facts: CampaignFacts,
  chrome: { publicStateLabel: string; links: CampaignRecordLink[] },
): CampaignRecordView['liveTab'] {
  const campaign = facts.campaign;
  const wentLive = campaign.campaignLiveAt !== null;

  const dates = [
    fact('Went live', formatInstant(campaign.campaignLiveAt), campaign.campaignLiveAt ? null : 'Not launched yet'),
    fact('Closes', formatInstant(campaign.campaignCloseAt), campaign.campaignCloseAt ? null : 'Set at launch'),
    fact('Public page', chrome.publicStateLabel, null),
  ];

  if (!wentLive) {
    return { live: false, publicStateLabel: chrome.publicStateLabel, metrics: null, dates, links: chrome.links };
  }

  const active = facts.reservationCounts.get('reserved_active') ?? 0;
  const canceled = facts.reservationCounts.get('reserved_canceled') ?? 0;

  /* The third metric is type-dependent, per the reference. The Idea
     denominator is `campaign_build.order_threshold` — the Founder's own §14.4
     value — and when it is unset there is NO bar and the panel says so. The
     prototype hardcodes 120; a hardcoded denominator would measure every Idea
     campaign against a number nobody agreed to (§1 rule 6). */
  const third =
    campaign.type === 'pre_build'
      ? {
          label: 'Backers toward threshold',
          value:
            facts.orderThreshold !== null
              ? `${active} of ${facts.orderThreshold}`
              : `${active}`,
          progress:
            facts.orderThreshold !== null && facts.orderThreshold > 0
              ? {
                  percent: Math.min(100, Math.round((active / facts.orderThreshold) * 100)),
                  threshold: facts.orderThreshold,
                  note: null as null,
                }
              : { percent: null, threshold: null, note: THRESHOLD_NOT_SET_NOTE },
        }
      : {
          label: 'Reserved before tax',
          value: formatUsdCents(facts.activeSubtotalCents),
          progress: null,
        };

  return {
    live: true,
    publicStateLabel: chrome.publicStateLabel,
    metrics: { active, canceled, third },
    dates,
    links: chrome.links,
  };
}

/* ── The Close pane ────────────────────────────────────────────────────────*/

/**
 * What happened at close, or what will.
 *
 * Every line reads its own domain and says what it is waiting for when that
 * domain has not run. `Result` comes from the close batch's IMMUTABLE threshold
 * decision (§33.7.5) rather than from a recount — a later payment failure never
 * reverses it, and recounting here would be a second answer that could.
 */
function composeClose(
  facts: CampaignFacts,
  links: CampaignRecordLink[],
): CampaignRecordView['close'] {
  const campaign = facts.campaign;
  const batch = facts.closeBatch;
  const closed = campaign.campaignCloseAt !== null && batch !== null;

  const captured = facts.reservationCounts.get('captured') ?? 0;
  const failed = facts.reservationCounts.get('capture_failed_retrying') ?? 0;
  const dropped = facts.reservationCounts.get('capture_failed_dropped') ?? 0;

  const facts_: CampaignFact[] = [
    fact(
      'Close time',
      formatInstant(campaign.campaignCloseAt),
      campaign.campaignCloseAt ? null : 'The close date is set when the campaign launches',
    ),
    fact(
      'Result',
      batch === null
        ? null
        : batch.thresholdMet === null
          ? 'Every valid pre-order is charged'
          : batch.thresholdMet
            ? `Threshold met — ${batch.uniqueActiveBackers ?? 0} of ${batch.thresholdRequired ?? 0} Backers`
            : `Threshold not met — ${batch.uniqueActiveBackers ?? 0} of ${batch.thresholdRequired ?? 0} Backers, nobody was charged`,
      batch === null ? 'The close batch has not run' : null,
    ),
    fact(
      'Backer charges',
      batch === null
        ? null
        : `${captured} charged${failed > 0 ? `, ${failed} retrying` : ''}${dropped > 0 ? `, ${dropped} not charged` : ''}`,
      batch === null ? 'Nothing is charged until the campaign closes' : null,
    ),
    fact(
      'Founder payment',
      founderPaymentLine(facts),
      founderPaymentLine(facts) === null ? 'No Founder payment has been released yet' : null,
    ),
    fact(
      'Delivery',
      facts.fulfillment?.fulfilledAt
        ? `Complete — ${formatDay(facts.fulfillment.fulfilledAt)}`
        : facts.fulfillment?.deliveredAt
          ? `Delivered — ${formatDay(facts.fulfillment.deliveredAt)}`
          : null,
      facts.fulfillment ? 'Delivery has started and is not complete' : 'Delivery begins after charges are final',
    ),
    fact('Support cases', supportSummary(facts), null),
    fact(
      'Results',
      facts.resultsPreparedAt ? `Ready — ${formatDay(facts.resultsPreparedAt)}` : null,
      facts.resultsPreparedAt ? null : 'Results are prepared after the retry window closes',
    ),
  ];

  return {
    closed,
    heading: closed ? 'Campaign closed' : 'What happens at close',
    facts: facts_,
    links,
  };
}

/**
 * The §22.3 payment line, from the flags the campaign actually carries.
 *
 * Read from `campaign_payment_flags` rather than recomputed: §23.3 makes each
 * flag its own row with its amount, actor and evidence, and this page is a
 * summary of what was recorded — never a second calculation of what is owed
 * (§33.8.13's one-source rule applied to a read-only surface).
 */
function founderPaymentLine(facts: CampaignFacts): string | null {
  const flags = facts.paymentFlags;
  if (flags.has('founder_payment_paid')) return 'Released';
  if (flags.has('founder_payment_eligible')) return 'Eligible — not released yet';
  if (facts.campaign.status === 'captured_pending_w9') return 'Blocked — waiting on a verified W-9';
  return null;
}

/** The Money link's live sub-label. */
function moneyLine(facts: CampaignFacts): string {
  if (facts.campaign.listingPaidAt === null) return 'Listing fee unpaid';
  const released = founderPaymentLine(facts);
  return released ? `Founder payment: ${released}` : 'Listing fee paid';
}

/* ── The read-only posture, exported for the surface ───────────────────────*/

export const CAMPAIGN_READ_ONLY_NOTICE = CAMPAIGNS_IS_READ_ONLY;

/* ── The one existence check the router needs ──────────────────────────────*/

/**
 * Whether an id is even the shape of a campaign id.
 *
 * Cheap, and it keeps a malformed path parameter from reaching Postgres as an
 * invalid uuid literal — which errors at the driver rather than answering 404,
 * and a 500 where a 404 belongs tells a caller their guess was interesting.
 */
export function looksLikeCampaignId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
