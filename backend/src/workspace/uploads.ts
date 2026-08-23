/**
 * Uploads — Spec §12, tech-stack §9, §33.3.1.
 *
 * Three steps, and the middle one is the point:
 *
 *  1. `requestUpload` validates what the browser *claims*, records a `pending`
 *     asset, and returns a presigned PUT scoped to that one object.
 *  2. The browser PUTs straight to R2. Nothing passes through this process.
 *  3. `verifyUpload` reads the object back and decides what it actually *is*.
 *
 * ── Step 1 is a courtesy; step 3 is the rule ────────────────────────────────
 * §1.1 requires server-side authorization on every surface and Phase 09 says it
 * again for this one: "Validate content type and size server-side, not just in
 * the browser." A declared content type is a request — a Founder with dev tools
 * can declare anything — so step 1 exists to fail fast and to bound what the
 * signature will permit, and step 3 is what actually decides. An object whose
 * bytes disagree with its declaration is rejected in step 3 whatever step 1
 * accepted.
 *
 * ── The key is ours ─────────────────────────────────────────────────────────
 * The storage key is derived from the campaign id and a fresh UUID, never from
 * the filename. A key containing user input is a path-traversal question that
 * has to be answered correctly forever; a key that contains none is not. The
 * original filename is stored as a display column and is never part of a path.
 *
 * ── Duplicates are a database constraint ────────────────────────────────────
 * §12 rejects "duplicate uploads". Checking with a SELECT would leave two
 * concurrent requests both seeing nothing; the partial unique index on
 * (campaign, checksum) over live rows is what actually decides, and this
 * translates its violation into the §12 rejection code.
 */

import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { Database } from '../db/client.js';
import { campaignAssets } from '../db/schema/workspace.js';
import type { ObjectStorage } from '../storage/object-storage.js';
import { ObjectNotStored } from '../storage/object-storage.js';
import {
  inspectMedia,
  ALLOWED_CONTENT_TYPES,
  ALLOWED_LOGO_TYPES,
  MAX_UPLOAD_BYTES,
  MIN_VISUAL_EDGE_PX,
  isImageType,
} from '../storage/media.js';
import type { EvidenceRejection } from './registry.js';

export type AssetPurpose = 'visual' | 'logo';

/** Logos may intentionally be compact; only campaign visuals use the 320px floor. */
export function imageIsPlaceholder(
  purpose: AssetPurpose,
  width: number,
  height: number,
): boolean {
  return width < 1 || height < 1 || (purpose === 'visual' && Math.max(width, height) < MIN_VISUAL_EDGE_PX);
}

export interface RequestUploadInput {
  campaignId: string;
  purpose: AssetPurpose;
  contentType: string;
  byteSize: number;
  /** Computed by the browser. Confirmed from the stored bytes in step 3. */
  checksumSha256: string;
  originalFilename?: string;
  actor: string;
}

export type UploadRefusal =
  | { ok: false; code: EvidenceRejection; message: string }
  | { ok: false; code: 'storage_unavailable'; message: string };

export type RequestUploadResult =
  | {
      ok: true;
      assetId: string;
      url: string;
      requiredHeaders: Record<string, string>;
      expiresAt: Date;
    }
  | UploadRefusal;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

export async function requestUpload(
  db: Database,
  storage: ObjectStorage,
  input: RequestUploadInput,
): Promise<RequestUploadResult> {
  if (!storage.configured) {
    return {
      ok: false,
      code: 'storage_unavailable',
      message:
        'Uploads are not available on this deployment yet. Nothing you have written has been lost.',
    };
  }

  const allowed = input.purpose === 'logo' ? ALLOWED_LOGO_TYPES : ALLOWED_CONTENT_TYPES;
  if (!allowed.includes(input.contentType)) {
    return { ok: false, code: 'file_type_unsupported', message: 'That kind of file cannot be used.' };
  }

  if (!Number.isInteger(input.byteSize) || input.byteSize <= 0) {
    return { ok: false, code: 'file_empty', message: 'That file is empty.' };
  }
  if (input.byteSize > MAX_UPLOAD_BYTES) {
    return { ok: false, code: 'file_too_large', message: 'That file is too large.' };
  }
  if (!/^[a-f0-9]{64}$/i.test(input.checksumSha256)) {
    return { ok: false, code: 'file_unreadable', message: 'We could not read that file.' };
  }

  const key = `campaigns/${input.campaignId}/${input.purpose}/${randomUUID()}.${
    EXTENSIONS[input.contentType] ?? 'bin'
  }`;

  let assetId: string;
  try {
    const [row] = await db
      .insert(campaignAssets)
      .values({
        campaignId: input.campaignId,
        purpose: input.purpose,
        storageKey: key,
        storageBucket: storage.bucket,
        originalFilename: input.originalFilename ?? null,
        contentType: input.contentType,
        byteSize: BigInt(input.byteSize),
        checksumSha256: input.checksumSha256.toLowerCase(),
        state: 'pending',
        createdBy: input.actor,
      })
      .returning({ id: campaignAssets.id });
    assetId = row!.id;
  } catch (error) {
    // The partial unique index on (campaign, checksum) over live rows. §12:
    // "duplicate uploads" do not qualify — and this is the version of that rule
    // two simultaneous requests cannot get past.
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        code: 'file_duplicate',
        message: 'That exact file is already attached to this campaign.',
      };
    }
    throw error;
  }

  const presigned = await storage.presignUpload({
    key,
    contentType: input.contentType,
    contentLength: input.byteSize,
  });

  return {
    ok: true,
    assetId,
    url: presigned.url,
    requiredHeaders: presigned.requiredHeaders,
    expiresAt: presigned.expiresAt,
  };
}

/**
 * Postgres's unique-violation code, found however deep Drizzle wrapped it.
 *
 * Drizzle raises its own `Failed query: …` error and hangs the driver error off
 * `cause`, so checking only the outer object silently misses every constraint
 * violation — and the §12 duplicate rule would surface as a 500 instead of the
 * message telling the Founder their file is already attached.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === 'object' && (current as { code?: string }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/* ── Step 3: what the object actually is ──────────────────────────────────── */

export interface VerifyResult {
  assetId: string;
  state: 'stored' | 'rejected';
  rejection: EvidenceRejection | null;
  width: number | null;
  height: number | null;
  byteSize: number;
}

/**
 * Reads the object back and decides. This is §12's objective check.
 *
 * Every refusal here is one of §12's own words. A zero-byte object is
 * `file_empty`; an object whose bytes are not the declared format, or are not a
 * format at all, is `file_unreadable`; an image below the narrowest viewport the
 * product supports is `file_placeholder` — the 1×1 tracking pixel is the case
 * that rule exists for.
 *
 * An object that never arrived is `file_empty` rather than an error: an
 * abandoned upload is an ordinary thing for a Founder to do, and §27.1 wants a
 * state they can act on, not a stack trace.
 */
export async function verifyUpload(
  db: Database,
  storage: ObjectStorage,
  input: { assetId: string; campaignId: string; actor: string },
): Promise<VerifyResult | null> {
  const [asset] = await db
    .select()
    .from(campaignAssets)
    .where(
      and(eq(campaignAssets.id, input.assetId), eq(campaignAssets.campaignId, input.campaignId)),
    )
    .limit(1);

  if (!asset) return null;

  let rejection: EvidenceRejection | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let byteSize = 0;

  try {
    const object = await storage.getObject(asset.storageKey);
    byteSize = object.byteSize;
    const facts = inspectMedia(object.body);
    width = facts.width;
    height = facts.height;

    if (facts.byteSize === 0) {
      rejection = 'file_empty';
    } else if (facts.detectedType === null) {
      // The bytes are not a format we recognise. Includes the case that matters
      // most: something that is not an image at all, stored under an image type.
      rejection = 'file_unreadable';
    } else if (facts.detectedType !== asset.contentType) {
      rejection = 'file_type_unsupported';
    } else if (facts.byteSize > MAX_UPLOAD_BYTES) {
      rejection = 'file_too_large';
    } else if (isImageType(facts.detectedType)) {
      if (facts.width === null || facts.height === null) {
        rejection = 'file_unreadable';
      } else if (imageIsPlaceholder(asset.purpose, facts.width, facts.height)) {
        rejection = 'file_placeholder';
      }
    }

    // The checksum the browser claimed, confirmed against the bytes that
    // arrived. Without this the duplicate rule is enforced against a value the
    // uploader chose, which is not a rule at all.
    if (rejection === null) {
      const actual = createHash('sha256').update(object.body).digest('hex');
      if (asset.checksumSha256 && actual !== asset.checksumSha256) {
        rejection = 'file_unreadable';
      }
    }
  } catch (error) {
    if (error instanceof ObjectNotStored) {
      rejection = 'file_empty';
    } else {
      throw error;
    }
  }

  const state = rejection === null ? ('stored' as const) : ('rejected' as const);

  await db
    .update(campaignAssets)
    .set({
      state,
      rejection,
      width,
      height,
      byteSize: byteSize > 0 ? BigInt(byteSize) : asset.byteSize,
      verifiedAt: new Date(),
      // A successful Founder upload is usable campaign evidence immediately.
      // The approval control remains available as an explicit opt-out.
      ...(state === 'stored'
        ? { approvedAt: new Date(), approvedBy: input.actor }
        : { approvedAt: null, approvedBy: null }),
      updatedAt: new Date(),
    })
    .where(eq(campaignAssets.id, asset.id));

  return { assetId: asset.id, state, rejection, width, height, byteSize };
}

/* ── Approval and removal ─────────────────────────────────────────────────── */

/**
 * §12: "Founder-approved for campaign use."
 *
 * The database refuses to approve anything not in `stored` state, so an
 * approval always means "I have seen this file and it is usable" rather than
 * "I clicked a button while an upload was in flight".
 */
export async function setAssetApproval(
  db: Database,
  input: { assetId: string; campaignId: string; approved: boolean; actor: string },
): Promise<boolean> {
  const now = new Date();
  const updated = await db
    .update(campaignAssets)
    .set({
      approvedAt: input.approved ? now : null,
      approvedBy: input.approved ? input.actor : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(campaignAssets.id, input.assetId),
        eq(campaignAssets.campaignId, input.campaignId),
      ),
    )
    .returning({ id: campaignAssets.id });

  return updated.length > 0;
}

/**
 * Removes a file from the campaign without destroying the record.
 *
 * §12 gives Admin an evidence view; a Founder who removed a visual an Admin had
 * already looked at would otherwise leave a gap. The row stays, the duplicate
 * index stops counting it, and re-uploading the same file afterwards is
 * permitted — that is a correction, not a duplicate.
 */
export async function removeAsset(
  db: Database,
  input: { assetId: string; campaignId: string; actor: string },
): Promise<boolean> {
  const now = new Date();
  const updated = await db
    .update(campaignAssets)
    .set({ removedAt: now, removedBy: input.actor, approvedAt: null, approvedBy: null, updatedAt: now })
    .where(
      and(
        eq(campaignAssets.id, input.assetId),
        eq(campaignAssets.campaignId, input.campaignId),
      ),
    )
    .returning({ id: campaignAssets.id });

  return updated.length > 0;
}
