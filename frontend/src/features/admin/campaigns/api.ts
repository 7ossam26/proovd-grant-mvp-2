/**
 * The Campaigns workspace API client.
 *
 * One rule, the same one `features/admin/api.ts` states: the server decides,
 * and its refusal is what the Admin reads. Nothing here composes a friendlier
 * message over a server one — the server already answers §27.1's six questions
 * in `whatHappened` / `next`, and paraphrasing it in the browser is how the two
 * start disagreeing.
 *
 * ── Two functions, both reads ───────────────────────────────────────────────
 * Campaigns is a hub. There is no mutation in this file and no type for one,
 * because there is no write route to call — every campaign decision is made in
 * the workspace that owns it (§15's review, §16's readiness, §17's launch,
 * §21's close, §22.1's earnings, §24.8's refunds, §26.7's enforcement) and this
 * links there. The absence is checked: `campaigns.test.tsx` asserts no control
 * on either surface submits anything.
 *
 * ── The types are restated, not imported ────────────────────────────────────
 * `backend/src/campaigns/workspace/types.ts` is the contract; the two packages
 * have separate build roots, so this mirrors it name-for-name. The vocabulary
 * types DO come from `@proovd/shared`, which both sides import.
 */

import type {
  CampaignBlockerOwner,
  CampaignGroup,
  CampaignHistorySource,
  CampaignHistoryTag,
  CampaignPublicState,
  CampaignStage,
  CampaignStageState,
  CampaignStateKind,
} from '@proovd/shared';
import { AdminRequestError, call } from '../api.js';

export { AdminRequestError };
export type { AdminError } from '../api.js';

/* ── The contract ───────────────────────────────────────────────────────────*/

export interface CampaignRecordLink {
  key: string;
  label: string;
  detail: string;
  mark: string;
  href: string | null;
  unavailableBecause: string | null;
}

export interface CampaignFact {
  label: string;
  value: string | null;
  waitingOn: string | null;
}

export interface CampaignBlocker {
  blocked: boolean;
  clear: boolean;
  text: string;
  owner: CampaignBlockerOwner;
  ownerLabel: string;
  due: string;
  route: CampaignRecordLink | null;
}

export interface CampaignDirectoryRow {
  campaignId: string;
  displayId: string;
  initials: string;
  name: string;
  company: string | null;
  founderName: string | null;
  founderHref: string | null;
  typeLabel: string | null;
  stateLabel: string;
  rawStatus: string;
  stateKind: CampaignStateKind;
  groups: CampaignGroup[];
  blocker: CampaignBlocker;
  dateLabel: string;
  searchText: string;
}

export interface CampaignDirectoryView {
  checkedAt: string;
  rows: CampaignDirectoryRow[];
  blockedCount: number;
}

export interface CampaignRecordHeader {
  campaignId: string;
  displayId: string;
  name: string;
  company: string | null;
  founderName: string | null;
  founderHref: string | null;
  typeLabel: string | null;
  stateLabel: string;
  rawStatus: string;
  stateKind: CampaignStateKind;
  waitingOnLabel: string;
  launch: string;
  close: string;
  publicState: CampaignPublicState;
  publicStateLabel: string;
  publicUrl: string | null;
  publicUrlUnavailableBecause: string | null;
}

export interface CampaignStageView {
  key: CampaignStage;
  label: string;
  state: CampaignStageState;
  caption: string;
}

export interface CampaignOverviewPane {
  blocker: CampaignBlocker;
  quickFacts: CampaignFact[];
  stages: CampaignStageView[];
  dates: CampaignFact[];
  links: CampaignRecordLink[];
}

/**
 * The denominator is `threshold`, never `goal`.
 *
 * §3.2 bans `goal` for an Idea threshold in every audience *including
 * identifiers*, and a property name survives minification — so `progress.goal`
 * ships the banned word to every browser. §33.11.3's bundle scan caught exactly
 * that, which is what it is for.
 */
export type CampaignProgress =
  | { percent: number; threshold: number; note: null }
  | { percent: null; threshold: null; note: string };

export interface CampaignLivePane {
  live: boolean;
  publicStateLabel: string;
  metrics: {
    active: number;
    canceled: number;
    third: { label: string; value: string; progress: CampaignProgress | null };
  } | null;
  dates: CampaignFact[];
  links: CampaignRecordLink[];
}

export interface CampaignClosePane {
  closed: boolean;
  heading: string;
  facts: CampaignFact[];
  links: CampaignRecordLink[];
}

export interface CampaignHistoryEntry {
  id: string;
  at: string;
  atLabel: string;
  headline: string;
  detail: string;
  tag: CampaignHistoryTag;
  source: CampaignHistorySource;
}

export interface CampaignRecordView {
  checkedAt: string;
  header: CampaignRecordHeader;
  overview: CampaignOverviewPane;
  liveTab: CampaignLivePane;
  close: CampaignClosePane;
  history: CampaignHistoryEntry[];
}

/* ── The two reads ──────────────────────────────────────────────────────────*/

export function fetchCampaigns(): Promise<CampaignDirectoryView> {
  return call<CampaignDirectoryView>('/api/admin/campaigns');
}

export function fetchCampaign(campaignId: string): Promise<CampaignRecordView> {
  return call<CampaignRecordView>(`/api/admin/campaigns/${encodeURIComponent(campaignId)}`);
}
