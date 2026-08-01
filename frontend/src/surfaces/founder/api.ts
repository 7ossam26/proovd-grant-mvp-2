/**
 * The signed-in Founder client — Spec §12.
 *
 * Separate from the draft client and the Creator client for the reason both of
 * those document: those carry a raw token in the URL and no session cookie,
 * this carries a session cookie and no token. One module doing both would
 * eventually send one to the other's routes.
 *
 * ── Nothing here computes money ─────────────────────────────────────────────
 * Every amount arrives as a decimal string of integer cents and is rendered
 * with `shared/money`'s USD formatter. Phase 09's trap: "Don't recalculate in
 * the UI. The fee and high-effort come from `shared/money`. A second
 * implementation in a React component is how the preview and the charge
 * diverge." There is no arithmetic on a fee anywhere in this surface — the
 * server sends the base line, each saving, and the total, and the browser lays
 * them out.
 *
 * ── Uploads go to R2, not here ──────────────────────────────────────────────
 * `requestUpload` returns a presigned URL and the headers the browser must
 * send; `putToStorage` PUTs the file straight to the bucket. No file body ever
 * reaches Proovd's own server (tech-stack §9), and there is no route that would
 * accept one.
 */

import { AdminRequestError, type AdminError } from '../../features/admin/api.js';

export { AdminRequestError as FounderRequestError };
export type { AdminError as FounderError };

function opaque(status: number): AdminError {
  return {
    error: 'unreachable',
    status,
    title: 'Proovd could not be reached',
    whatHappened:
      status === 0
        ? 'The request did not complete, so nothing was saved and nothing was changed.'
        : `The server answered ${status} with no explanation, so it is not certain whether the change was applied.`,
    next:
      status === 0
        ? 'Check your connection and try again. Everything you have typed is still on this page.'
        : 'Reload to see what is stored before trying again.',
  };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      headers: init?.body ? { 'content-type': 'application/json' } : {},
      ...init,
    });
  } catch {
    throw new AdminRequestError(opaque(0));
  }

  if (!response.ok) {
    let body: Partial<AdminError> | null = null;
    try {
      body = (await response.json()) as Partial<AdminError>;
    } catch {
      body = null;
    }
    throw new AdminRequestError(
      body?.title ? { ...(body as AdminError), status: response.status } : opaque(response.status),
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/* ── Shapes ───────────────────────────────────────────────────────────────── */

export type OptionalItemKey = 'visuals' | 'branding' | 'interview' | 'story' | 'socials';

export interface ItemState {
  item: OptionalItemKey;
  complete: boolean;
  completedAt: string | null;
  decisionSource: string | null;
  rejections: string[];
  locked: boolean;
  invalidated: { at: string | null; explanation: string | null };
}

export interface FeeState {
  baseCents: string;
  itemDiscountCents: string;
  maxDiscountCents: string;
  minSubtotalCents: string;
  completedItems: number;
  discountLines: Array<{ item: OptionalItemKey; discountCents: string }>;
  discountCents: string;
  subtotalCents: string;
  calculatedAt: string | null;
  locked: boolean;
  /** §24.6. The server owns this sentence — it is a commercial statement. */
  separateStreamNote: string;
}

export interface HighEffortState {
  visualsCompleted: boolean;
  brandingCompleted: boolean;
  interviewScheduledOrConfirmed: boolean;
  highEffort: boolean;
  calculatedAt: string | null;
}

export interface AssetState {
  id: string;
  filename: string | null;
  contentType: string;
  state: 'pending' | 'stored' | 'rejected';
  rejection: string | null;
  approved: boolean;
  width: number | null;
  height: number | null;
  byteSize: string | null;
}

export interface SocialState {
  id: string;
  url: string;
  platform: string | null;
  handle: string | null;
  accessible: boolean | null;
  rejection: string | null;
  controlsConfirmed: boolean;
  checkedAt: string | null;
}

export interface WorkspaceState {
  campaignId: string;
  campaignStatus: string;
  listingPaid: boolean;
  items: ItemState[];
  fee: FeeState | null;
  highEffort: HighEffortState | null;
  brand: {
    colors: string | null;
    typography: string | null;
    notes: string | null;
    approved: boolean;
    logos: AssetState[];
  };
  story: { text: string | null; approved: boolean };
  visuals: AssetState[];
  socials: SocialState[];
  interview: {
    bookable: boolean;
    missingSettings: string[];
    providers: string[];
    availability: string | null;
    /** Phase 09b. `available` is false while §6 or Track A4 is outstanding. */
    embed: {
      available: boolean;
      eventTypeLink: string | null;
      reference: string | null;
    };
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
  uploadsAvailable: boolean;
}

export interface WorkspacePatch {
  brandColors?: string | null;
  brandTypography?: string | null;
  brandNotes?: string | null;
  storyText?: string | null;
  resumeStep?: string;
  brandApproved?: boolean;
  storyApproved?: boolean;
}

const base = (campaignId: string) => `/api/founder/campaigns/${encodeURIComponent(campaignId)}`;

/* ── Calls ────────────────────────────────────────────────────────────────── */

export const listCampaigns = (): Promise<{
  campaigns: Array<{
    campaignId: string;
    status: string;
    type: string | null;
    listingPaid: boolean;
    highEffort: boolean | null;
  }>;
}> => call('/api/founder/campaigns');

export const fetchWorkspace = (campaignId: string): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/workspace`);

export const saveWorkspace = (
  campaignId: string,
  patch: WorkspacePatch,
): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/workspace`, { method: 'PATCH', body: JSON.stringify(patch) });

/* ── Uploads ──────────────────────────────────────────────────────────────── */

export interface PresignedUpload {
  assetId: string;
  url: string;
  requiredHeaders: Record<string, string>;
  expiresAt: string;
}

/**
 * The SHA-256 of the file, computed in the browser.
 *
 * §12 rejects duplicate uploads and the server confirms this value against the
 * bytes it reads back, so a wrong one costs the upload rather than defeating
 * the rule. Computing it here means the duplicate is caught before a 20 MB
 * video is transferred.
 */
export async function fileChecksum(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const requestUpload = (
  campaignId: string,
  input: { purpose: 'visual' | 'logo'; contentType: string; byteSize: number; checksumSha256: string; filename: string },
): Promise<PresignedUpload> =>
  call(`${base(campaignId)}/uploads`, { method: 'POST', body: JSON.stringify(input) });

/**
 * PUTs the file to R2. The headers are part of the signature, so they are sent
 * exactly as issued — changing either would invalidate the URL, which is the
 * point of signing them.
 */
export async function putToStorage(
  upload: PresignedUpload,
  file: File,
): Promise<void> {
  const response = await fetch(upload.url, {
    method: 'PUT',
    headers: upload.requiredHeaders,
    body: file,
  });
  if (!response.ok) {
    throw new AdminRequestError({
      error: 'upload_failed',
      status: response.status,
      title: 'That file did not finish uploading',
      whatHappened: 'The file was not stored, so it has not been added to your campaign.',
      next: 'Try again. Nothing else on this page has changed.',
    });
  }
}

export const verifyUpload = (
  campaignId: string,
  assetId: string,
): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/uploads/${encodeURIComponent(assetId)}/verify`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const setAssetApproval = (
  campaignId: string,
  assetId: string,
  approved: boolean,
): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/uploads/${encodeURIComponent(assetId)}/approval`, {
    method: 'POST',
    body: JSON.stringify({ approved }),
  });

export const removeAsset = (
  campaignId: string,
  assetId: string,
): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/uploads/${encodeURIComponent(assetId)}`, { method: 'DELETE' });

/* ── Socials ──────────────────────────────────────────────────────────────── */

export const addSocial = (
  campaignId: string,
  input: { url: string; controlsConfirmed: boolean },
): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/socials`, { method: 'POST', body: JSON.stringify(input) });

export const recheckSocial = (
  campaignId: string,
  socialId: string,
): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/socials/${encodeURIComponent(socialId)}/recheck`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const confirmSocialControl = (
  campaignId: string,
  socialId: string,
  confirmed: boolean,
): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/socials/${encodeURIComponent(socialId)}/control`, {
    method: 'POST',
    body: JSON.stringify({ confirmed }),
  });

export const removeSocial = (
  campaignId: string,
  socialId: string,
): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/socials/${encodeURIComponent(socialId)}`, { method: 'DELETE' });

/* ── The interview ────────────────────────────────────────────────────────── */

export const cancelInterview = (
  campaignId: string,
  bookingId: string,
  reason: string,
): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/interview/${encodeURIComponent(bookingId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
