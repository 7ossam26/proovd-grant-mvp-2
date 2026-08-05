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
  /** §24.12/§33.9.13: what this card's statement shows (or will show). */
  statementDescriptor: string | null;
  canCancel: boolean;
  canChangeReward: boolean;
  /**
   * The B.5 update-card state (§21, Phase 18b): the exact failed-payment body,
   * its ONE action, and the retry deadline. Null unless the charge failed and
   * is inside the one 48-hour window.
   */
  recovery: {
    body: string;
    action: string;
    deadlineUtc: string;
    deadlineIso: string;
    available: boolean;
  } | null;
  /**
   * The §24.8 refund states (§33.9.2, Phase 20a): the exact Appendix B.6 body
   * per refund of this pre-order — amount, destination, start date, typical
   * bank timing as a range, status, and the quotable reference.
   */
  refunds: Array<{
    reference: string;
    status: 'submitted' | 'succeeded' | 'failed';
    body: string;
    action: string;
  }>;
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

/* ── The B.5 update-card retry (§21, §33.7.9 — Phase 18b) ──────────────────── */

export type UpdateCardResult =
  | { status: 'captured' | 'already_captured'; message: string }
  | { status: 'requires_action'; clientSecret: string | null; message: string }
  | { status: 'failed_again' | 'setup_failed' | 'provider_error'; message: string }
  | { status: 'retry_window_closed'; message: string }
  | { status: 'error'; message: string };

export async function updateCardAndRetry(
  token: string,
  reservationId: string,
  paymentMethodId: string,
): Promise<UpdateCardResult> {
  const res = await fetch(
    `/api/link/${encodeURIComponent(token)}/reservations/${encodeURIComponent(reservationId)}/update-card`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ paymentMethodId }),
    },
  );
  const body = (await res.json().catch(() => null)) as
    | { status?: string; message?: string; clientSecret?: string | null }
    | null;
  const message = body?.message ?? 'Something went wrong. No money has moved.';
  switch (body?.status) {
    case 'captured':
    case 'already_captured':
      return { status: body.status, message };
    case 'requires_action':
      return { status: 'requires_action', clientSecret: body.clientSecret ?? null, message };
    case 'failed_again':
    case 'setup_failed':
    case 'provider_error':
      return { status: body.status, message };
    case 'retry_window_closed':
      return { status: 'retry_window_closed', message };
    default:
      return { status: 'error', message };
  }
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

/* ── The §29.9/§29.10 support path (Phase 20b) ─────────────────────────────── */

export interface BackerSupportCase {
  caseId: string;
  reference: string;
  topic: string;
  status: string;
  owner: string;
  openedAt: string;
  humanResponseDueAt: string;
  responded: boolean;
  escalatedAt: string | null;
  canEscalate: boolean;
  escalationOpensAt: string | null;
}

export interface BackerSupportView {
  topics: Array<{ key: string; label: string }>;
  cases: BackerSupportCase[];
  issuerRights: string;
}

export async function fetchBackerSupport(token: string): Promise<BackerSupportView | null> {
  const res = await fetch(`/api/link/${encodeURIComponent(token)}/support`, {
    credentials: 'include',
  });
  if (!res.ok) return null;
  return (await res.json()) as BackerSupportView;
}

export type OpenSupportResult =
  | { ok: true; reference: string; acknowledgement: string; issuerRights: string }
  | { ok: false; message: string };

export async function openSupportCase(
  token: string,
  input: { topic: string; message: string; reservationId?: string },
): Promise<OpenSupportResult> {
  const res = await fetch(`/api/link/${encodeURIComponent(token)}/support`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => null)) as
    | { reference?: string; acknowledgement?: string; issuerRights?: string; message?: string }
    | null;
  if (res.ok && body?.reference && body.acknowledgement) {
    return {
      ok: true,
      reference: body.reference,
      acknowledgement: body.acknowledgement,
      issuerRights: body.issuerRights ?? '',
    };
  }
  return { ok: false, message: body?.message ?? 'That request was not sent. Nothing was lost.' };
}

export type EscalateResult =
  | { ok: true }
  | { ok: false; message: string; opensAt?: string };

export async function escalateSupportCase(
  token: string,
  caseId: string,
  reason: string,
): Promise<EscalateResult> {
  const res = await fetch(
    `/api/link/${encodeURIComponent(token)}/support/${encodeURIComponent(caseId)}/escalate`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    },
  );
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => null)) as
    | { message?: string; opensAt?: string }
    | null;
  return {
    ok: false,
    message: body?.message ?? 'That escalation was not recorded.',
    ...(body?.opensAt ? { opensAt: body.opensAt } : {}),
  };
}
