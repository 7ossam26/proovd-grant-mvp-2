/**
 * The Backers workspace API client.
 *
 * One rule, the same one `features/admin/api.ts` states: the server decides,
 * and its refusal is what the Admin reads. Nothing here composes a friendlier
 * message over a server one — the server already answers §27.1's six questions
 * in `whatHappened` / `next`, and paraphrasing it in the browser is how the two
 * start disagreeing.
 *
 * ── One function, and it is a read ──────────────────────────────────────────
 * Backers is a read-only section. There is no mutation in this file and no type
 * for one, because there is no write route to call — every pre-order operation
 * is made in the workspace that owns its rules (§20's cancellation, §21's close
 * and retry, §24.8's refunds, §24.11's disputes, §26.7's kill). The absence is
 * checked: `backers.test.tsx` asserts no control on the surface submits
 * anything, and the backend suite drives all four write verbs at the path.
 *
 * ── The filters are sent to the server, not applied here ────────────────────
 * Every other Admin workspace filters in the browser over a server-composed
 * `searchText`, because their row sets are bounded. This one is not: a row here
 * carries a Backer's email and their own free-text answer, and a set filtered
 * in the browser is a set that was transmitted in full first. So the query goes
 * up and only the rendered page comes back — the displayed set and the
 * transmitted set are the same thing, which is the privacy property, not a
 * performance one.
 */

import { AdminRequestError, call } from '../api.js';

export { AdminRequestError };
export type { AdminError } from '../api.js';

/* ── The contract ───────────────────────────────────────────────────────────
   `backend/src/backers/workspace/types.ts` is the authority; the two packages
   have separate build roots, so this mirrors it name for name. */

export type BackerConsentState = 'granted' | 'not_granted';

export interface BackerStat {
  value: string;
  label: string;
}

export interface BackerFilterOption {
  value: string;
  label: string;
}

export interface AffiliateResultRow {
  associationId: string;
  campaignId: string;
  name: string;
  handle: string;
  campaignName: string;
  backers: number;
  backersLabel: string;
  preorderValue: string;
  timeActive: string | null;
  timeActiveWaitingOn: string | null;
  average: string | null;
  drillThrough: { campaignId: string; associationId: string };
  searchText: string;
}

export interface AffiliateResultsView {
  rows: AffiliateResultRow[];
  shown: string;
  noAttributionNote: string | null;
  anchorNote: string | null;
}

export interface BackerAnswer {
  question: string;
  answer: string;
  answered: boolean;
}

export interface BackerRow {
  reservationId: string;
  backerNumber: number | null;
  email: string;
  campaignId: string;
  campaignName: string;
  orderAmount: string;
  affiliateName: string | null;
  affiliateHandle: string | null;
  associationId: string | null;
  attributionStatus: string;
  statusLabel: string;
  date: string;
  answers: BackerAnswer[];
  consentState: BackerConsentState;
  consentLabel: string;
  consentPermits: string;
  searchText: string;
}

export interface BackerListView {
  rows: BackerRow[];
  shown: string;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface BackerTotals {
  attributedBackers: BackerStat;
  attributedValue: BackerStat;
  affiliates: BackerStat;
  excludesNote: string;
  organicBackers: number;
}

export interface BackersDirectoryView {
  totals: BackerTotals;
  campaigns: BackerFilterOption[];
  affiliates: BackerFilterOption[];
  affiliateResults: AffiliateResultsView;
  backers: BackerListView;
  readOnly: string;
  noRecordPage: string;
  answersNotExportable: string;
  consentAbsentIsNotGranted: string;
}

export interface BackerQuery {
  campaignId?: string | undefined;
  affiliate?: string | undefined;
  window?: string | undefined;
  affiliateSearch?: string | undefined;
  backerSearch?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

/* ── The one read ───────────────────────────────────────────────────────────*/

export async function fetchBackers(query: BackerQuery): Promise<BackersDirectoryView> {
  const params = new URLSearchParams();
  if (query.campaignId) params.set('campaignId', query.campaignId);
  if (query.affiliate) params.set('affiliate', query.affiliate);
  if (query.window) params.set('window', query.window);
  if (query.affiliateSearch) params.set('affiliateSearch', query.affiliateSearch);
  if (query.backerSearch) params.set('backerSearch', query.backerSearch);
  if (query.page && query.page > 1) params.set('page', String(query.page));

  const qs = params.toString();
  return call<BackersDirectoryView>(`/api/admin/backers${qs ? `?${qs}` : ''}`);
}
