/**
 * The attribution a pre-order records — Spec §18, §25.2.
 *
 * Reads the winner cookie the §18 ingest set (`pv_attr_<campaignId>`), resolves
 * it to a current tracking link, and produces the snapshot §25.2 stores on the
 * reservation. A missing, forged, or stale cookie is simply "no Creator
 * attribution": the pre-order still succeeds, recorded as a direct arrival. The
 * status is the link's *current* status (provisional/verified/blocked), computed
 * live — a later verification changes what a captured charge may finalize, not
 * this record (§33.6.4).
 */

import type { Database } from '../db/client.js';
import {
  attributionCookieName,
  parseCookieHeader,
  verifyAttribution,
} from '../attribution/cookies.js';
import { resolveAttribution } from '../attribution/service.js';

export interface PreorderAttribution {
  source: 'creator' | 'direct';
  trackingLinkId: string | null;
  associationId: string | null;
  clickedAt: Date | null;
  status: string | null;
  sameDeviceLimitation: boolean;
}

const DIRECT: PreorderAttribution = {
  source: 'direct',
  trackingLinkId: null,
  associationId: null,
  clickedAt: null,
  status: null,
  sameDeviceLimitation: false,
};

export async function resolvePreorderAttribution(
  db: Pick<Database, 'select'>,
  secret: string,
  cookieHeader: string | undefined,
  campaignId: string,
): Promise<PreorderAttribution> {
  const cookies = parseCookieHeader(cookieHeader);
  const payload = verifyAttribution(cookies[attributionCookieName(campaignId)], secret);
  if (!payload) return DIRECT;

  const resolved = await resolveAttribution(db, { campaignId, trackingLinkId: payload.l });
  if (!resolved) return DIRECT;

  const clickedAt = Number.isNaN(Date.parse(payload.t)) ? null : new Date(payload.t);
  return {
    source: 'creator',
    trackingLinkId: resolved.trackingLinkId,
    associationId: resolved.associationId,
    clickedAt,
    status: resolved.status,
    // §18: the whole of attribution's "same browser" limitation. A cross-device
    // promise is neither made nor built.
    sameDeviceLimitation: true,
  };
}
