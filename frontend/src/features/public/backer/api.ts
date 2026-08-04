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

/* ── The §18 comment thread (Phase 17b) ────────────────────────────────────── */

export interface BackerComment {
  id: string;
  updateId: string | null;
  authorDisplay: string;
  body: string;
  postedAt: string;
  mine: boolean;
}

export interface CommentThread {
  /** §18: whether NEW comments are open. Reading is always open. */
  open: boolean;
  closedReason: string | null;
  comments: BackerComment[];
}

export async function fetchComments(
  token: string,
  updateId?: string,
): Promise<CommentThread | null> {
  const query = updateId ? `?updateId=${encodeURIComponent(updateId)}` : '';
  const res = await fetch(`/api/link/${encodeURIComponent(token)}/comments${query}`, {
    credentials: 'include',
  });
  if (!res.ok) return null;
  return ((await res.json()) as { thread: CommentThread }).thread;
}

export type PostCommentResult =
  | { ok: true }
  | { ok: false; whatHappened: string; next: string };

export async function postComment(
  token: string,
  input: { body: string; updateId?: string; displayName?: string },
): Promise<PostCommentResult> {
  const res = await fetch(`/api/link/${encodeURIComponent(token)}/comments`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.ok) return { ok: true };
  const detail = (await res.json().catch(() => null)) as
    | { whatHappened?: string; next?: string }
    | null;
  return {
    ok: false,
    whatHappened: detail?.whatHappened ?? 'That comment was not posted.',
    next: detail?.next ?? 'Nothing you typed was lost.',
  };
}

export async function flagComment(
  token: string,
  commentId: string,
  reason: string,
): Promise<{ ok: boolean; next?: string }> {
  const res = await fetch(
    `/api/link/${encodeURIComponent(token)}/comments/${encodeURIComponent(commentId)}/flag`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    },
  );
  if (!res.ok) return { ok: false };
  const body = (await res.json().catch(() => null)) as { next?: string } | null;
  return { ok: true, ...(body?.next ? { next: body.next } : {}) };
}
