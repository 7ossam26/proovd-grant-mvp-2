/**
 * The Backer magic-link API — Spec §19, §20, §33.5.13.
 *
 * The long-lived campaign-scoped page and its cancel action, both keyed by the
 * raw token in the path. Every failure to open the link returns the same opaque
 * rejection (§5.5), which the page renders as a recovery state rather than a
 * detail about what was wrong.
 */

export interface BackerTransaction {
  reservationId: string;
  rewardTitle: string | null;
  delivery: string | null;
  rewardSubtotal: string;
  salesTax: string;
  totalAuthorized: string;
  status: string;
  statusLabel: string;
  chargeOccurred: boolean;
  notChargedYet: boolean;
  canCancel: boolean;
  canChangeReward: boolean;
}

export interface BackerPageData {
  notChargedLead: string;
  campaign: { campaign: { title: string; model: 'idea' | 'product' } } | null;
  transactions: BackerTransaction[];
}

export type BackerPageResult =
  | { ok: true; page: BackerPageData }
  | { ok: false; reason: 'invalid' | 'error' };

export async function fetchBackerPage(token: string): Promise<BackerPageResult> {
  const res = await fetch(`/api/link/${encodeURIComponent(token)}/page`, {
    credentials: 'include',
  });
  if (res.ok) return { ok: true, page: (await res.json()) as BackerPageData };
  // A rejected link (invalid/expired/revoked/claimed) all answer identically.
  if (res.status === 401) return { ok: false, reason: 'invalid' };
  return { ok: false, reason: 'error' };
}

export async function cancelReservation(
  token: string,
  reservationId: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    `/api/link/${encodeURIComponent(token)}/reservations/${encodeURIComponent(reservationId)}/cancel`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: '{}' },
  );
  return { ok: res.ok };
}
