/**
 * Research-evidence files and per-metric decisions — Spec §5.3, §8, §12,
 * §25.6, §33.12.4 (the Affiliate rebuild, Session B, 2026-08-17).
 *
 * ── The upload is Phase 09a's three steps, against the person ───────────────
 * `requestEvidenceUpload` validates what the browser CLAIMS, records a
 * `pending` file, and returns a presigned PUT scoped to that one object; the
 * browser PUTs straight to R2; `verifyEvidenceUpload` reads the object back
 * and decides what it actually IS. The bytes decide the format, the key is
 * derived from ids and a fresh UUID (never a filename), and duplicates are
 * the 0048 partial unique index on live (prospect, checksum) — a SELECT-first
 * check would let two concurrent requests both see nothing.
 *
 * Pictures only. `EVIDENCE_PICTURES_ACCEPTED` names what the server accepts,
 * and the §1.8 record on that register is why HEIC is not in it. The
 * reference's uploader also accepted `.pdf,.csv,.xlsx`; those are refused
 * here because `inspectMedia` can only decide image and video bytes, and a
 * stored file whose content nothing verified is exactly what step 3 exists to
 * prevent. SVG stays excluded for 09a's reason: browsers execute it.
 *
 * ── Per-metric decisions are the trail beneath the §8 status ────────────────
 * `affiliate_evidence_verifications` is insert-only and latest-per-metric
 * wins. It never moves `verification_status` — the whole-record §8 decision
 * stays `recordVerification`'s, which refuses `verified` while §5.3 evidence
 * is outstanding. A `more_evidence_needed` decision is also the recorded ask
 * the §11 correction-request message dedups on.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import type { Database } from '../../db/client.js';
import { auditEvents } from '../../db/schema/integrity.js';
import { affiliateProspects } from '../../db/schema/affiliates.js';
import {
  affiliateEvidenceFiles,
  affiliateEvidenceVerifications,
} from '../../db/schema/creator-workspace.js';
import type { ObjectStorage } from '../../storage/object-storage.js';
import { ObjectNotStored } from '../../storage/object-storage.js';
import {
  inspectMedia,
  isImageType,
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  MIN_VISUAL_EDGE_PX,
} from '../../storage/media.js';
import { sendCorrectionRequest, type AskDeps } from './asks.js';
import {
  CREATOR_EVIDENCE_UPLOADED,
  CREATOR_EVIDENCE_REMOVED,
  CREATOR_METRIC_DECIDED,
} from './audit-actions.js';
import { evidenceCategoryKeys, evidenceMetricLabel, evidenceMetricKeys } from './labels.js';
import type { ActorContext } from './mutations.js';

export interface EvidenceDeps {
  db: Database;
  storage: ObjectStorage;
}

export type EvidenceFailure = {
  ok: false;
  code: 'not_found' | 'invalid' | 'storage_unavailable' | 'duplicate';
  message: string;
};

const invalid = (message: string): EvidenceFailure => ({ ok: false, code: 'invalid', message });

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/* ── Step 1: the presign ────────────────────────────────────────────────────*/

export type RequestEvidenceUploadResult =
  | {
      ok: true;
      fileId: string;
      url: string;
      requiredHeaders: Record<string, string>;
      expiresAt: Date;
    }
  | EvidenceFailure;

export async function requestEvidenceUpload(
  deps: EvidenceDeps,
  input: {
    prospectId: string;
    category: string;
    contentType: string;
    byteSize: number;
    checksumSha256: string;
    originalFilename: string | null;
    who: ActorContext;
  },
): Promise<RequestEvidenceUploadResult> {
  if (!deps.storage.configured) {
    return {
      ok: false,
      code: 'storage_unavailable',
      message:
        'Evidence uploads are not available on this deployment yet — the object-storage bucket is Track A4. Nothing else about the record is affected.',
    };
  }

  const [prospect] = await deps.db
    .select({ id: affiliateProspects.id })
    .from(affiliateProspects)
    .where(eq(affiliateProspects.id, input.prospectId))
    .limit(1);
  if (!prospect) {
    return { ok: false, code: 'not_found', message: 'There is no Affiliate at that address.' };
  }

  if (!evidenceCategoryKeys().includes(input.category)) {
    return invalid(
      'Evidence stays associated with a specific research item — choose one of the four categories.',
    );
  }
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(input.contentType)) {
    return invalid('Evidence pictures are PNG, JPG, WEBP or GIF. That kind of file cannot be used.');
  }
  if (!Number.isInteger(input.byteSize) || input.byteSize <= 0) {
    return invalid('That file is empty.');
  }
  if (input.byteSize > MAX_UPLOAD_BYTES) {
    return invalid('That file is too large.');
  }
  if (!/^[a-f0-9]{64}$/i.test(input.checksumSha256)) {
    return invalid('We could not read that file.');
  }

  const key = `affiliates/${input.prospectId}/evidence/${randomUUID()}.${
    EXTENSIONS[input.contentType] ?? 'bin'
  }`;

  let fileId: string;
  try {
    const [row] = await deps.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(affiliateEvidenceFiles)
        .values({
          prospectId: input.prospectId,
          category: input.category,
          storageKey: key,
          originalFilename: input.originalFilename,
          state: 'pending',
          checksumSha256: input.checksumSha256.toLowerCase(),
          byteSize: BigInt(input.byteSize),
          contentType: input.contentType,
          uploadedBy: input.who.actor,
        })
        .returning({ id: affiliateEvidenceFiles.id });

      await tx.insert(auditEvents).values({
        actor: input.who.actor,
        mfaContext: input.who.mfaContext,
        reauthContext: input.who.reauthContext,
        targetType: 'affiliate_prospect',
        targetId: input.prospectId,
        action: CREATOR_EVIDENCE_UPLOADED,
        internalReason: `Evidence picture presigned for ${input.category}.`,
        priorValue: null,
        newValue: { fileId: inserted[0]!.id, category: input.category },
      });

      return inserted;
    });
    fileId = row!.id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        code: 'duplicate',
        message: 'That exact picture is already on this Affiliate’s record.',
      };
    }
    throw error;
  }

  const presigned = await deps.storage.presignUpload({
    key,
    contentType: input.contentType,
    contentLength: input.byteSize,
  });

  return {
    ok: true,
    fileId,
    url: presigned.url,
    requiredHeaders: presigned.requiredHeaders,
    expiresAt: presigned.expiresAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === 'object' && (current as { code?: string }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/* ── Step 3: what the object actually is ────────────────────────────────────*/

export type VerifyEvidenceUploadResult =
  | { ok: true; fileId: string; state: 'stored' | 'rejected'; rejection: string | null }
  | EvidenceFailure;

export async function verifyEvidenceUpload(
  deps: EvidenceDeps,
  input: { prospectId: string; fileId: string; who: ActorContext },
): Promise<VerifyEvidenceUploadResult> {
  const [file] = await deps.db
    .select()
    .from(affiliateEvidenceFiles)
    .where(
      and(
        eq(affiliateEvidenceFiles.id, input.fileId),
        eq(affiliateEvidenceFiles.prospectId, input.prospectId),
      ),
    )
    .limit(1);
  if (!file) {
    return { ok: false, code: 'not_found', message: 'There is no evidence file at that address.' };
  }

  let rejection: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let byteSize = 0;

  try {
    const object = await deps.storage.getObject(file.storageKey);
    byteSize = object.byteSize;
    const facts = inspectMedia(object.body);
    width = facts.width;
    height = facts.height;

    if (facts.byteSize === 0) rejection = 'file_empty';
    else if (facts.detectedType === null) rejection = 'file_unreadable';
    else if (facts.detectedType !== file.contentType) rejection = 'file_type_unsupported';
    else if (facts.byteSize > MAX_UPLOAD_BYTES) rejection = 'file_too_large';
    else if (isImageType(facts.detectedType)) {
      if (facts.width === null || facts.height === null) rejection = 'file_unreadable';
      else if (
        Math.max(facts.width, facts.height) < MIN_VISUAL_EDGE_PX ||
        facts.width < 1 ||
        facts.height < 1
      ) {
        // The 1×1 tracking pixel is the case this rule exists for (09a).
        rejection = 'file_placeholder';
      }
    }

    if (rejection === null) {
      const actual = createHash('sha256').update(object.body).digest('hex');
      if (file.checksumSha256 && actual !== file.checksumSha256) rejection = 'file_unreadable';
    }
  } catch (error) {
    if (error instanceof ObjectNotStored) rejection = 'file_empty';
    else throw error;
  }

  const state = rejection === null ? ('stored' as const) : ('rejected' as const);

  await deps.db
    .update(affiliateEvidenceFiles)
    .set({
      state,
      rejection,
      width,
      height,
      ...(byteSize > 0 ? { byteSize: BigInt(byteSize) } : {}),
    })
    .where(eq(affiliateEvidenceFiles.id, file.id));

  return { ok: true, fileId: file.id, state, rejection };
}

/* ── Removal, one-way ───────────────────────────────────────────────────────*/

export async function removeEvidenceFile(
  deps: Pick<EvidenceDeps, 'db'>,
  input: { prospectId: string; fileId: string; reason: string | null; who: ActorContext },
): Promise<{ ok: true } | EvidenceFailure> {
  const [file] = await deps.db
    .select()
    .from(affiliateEvidenceFiles)
    .where(
      and(
        eq(affiliateEvidenceFiles.id, input.fileId),
        eq(affiliateEvidenceFiles.prospectId, input.prospectId),
        isNull(affiliateEvidenceFiles.removedAt),
      ),
    )
    .limit(1);
  if (!file) {
    return {
      ok: false,
      code: 'not_found',
      message: 'There is no live evidence file at that address.',
    };
  }

  await deps.db.transaction(async (tx) => {
    await tx
      .update(affiliateEvidenceFiles)
      .set({ removedAt: new Date(), removedBy: input.who.actor })
      .where(eq(affiliateEvidenceFiles.id, file.id));

    await tx.insert(auditEvents).values({
      actor: input.who.actor,
      mfaContext: input.who.mfaContext,
      reauthContext: input.who.reauthContext,
      targetType: 'affiliate_prospect',
      targetId: input.prospectId,
      action: CREATOR_EVIDENCE_REMOVED,
      internalReason: input.reason?.trim() || 'Evidence picture removed.',
      // Read from the row inside the write (§33.12.4), never supplied.
      priorValue: { state: file.state, category: file.category },
      newValue: { removed: true },
    });
  });

  return { ok: true };
}

/* ── The per-metric decision, and the ask it may carry ──────────────────────*/

export type MetricDecisionResult =
  | { ok: true; verificationId: string; sent: boolean; sendReason: string | null }
  | EvidenceFailure;

/**
 * Records one per-metric decision, and — on `more_evidence_needed` — sends the
 * §11 ask keyed on the recorded row.
 *
 * The send happens AFTER the transaction commits (08c's ordering: holding a
 * row open across a provider call is a much more expensive way to be no
 * safer), and a transport refusal leaves the decision recorded with the
 * refusal reported rather than rolled back — the record is the more valuable
 * of the two.
 */
export async function recordMetricDecision(
  deps: Pick<EvidenceDeps, 'db'> & { asks: Omit<AskDeps, 'db'> },
  input: {
    prospectId: string;
    metric: string;
    decision: string;
    detail: string | null;
    who: ActorContext;
  },
): Promise<MetricDecisionResult> {
  const [prospect] = await deps.db
    .select({ id: affiliateProspects.id })
    .from(affiliateProspects)
    .where(eq(affiliateProspects.id, input.prospectId))
    .limit(1);
  if (!prospect) {
    return { ok: false, code: 'not_found', message: 'There is no Affiliate at that address.' };
  }

  if (!evidenceMetricKeys().includes(input.metric)) {
    return invalid('A metric decision names one of the five §5.3 metrics.');
  }
  if (input.decision !== 'verified' && input.decision !== 'more_evidence_needed') {
    return invalid('A metric decision is either verified or more evidence needed.');
  }
  const detail = input.detail?.trim() ?? '';
  if (!detail) {
    return invalid(
      input.decision === 'verified'
        ? 'Say what the evidence showed. A decision with no detail is not reviewable (§25.6).'
        : 'Say what evidence is needed — the Affiliate reads this sentence.',
    );
  }

  const [prior] = await deps.db
    .select({ decision: affiliateEvidenceVerifications.decision })
    .from(affiliateEvidenceVerifications)
    .where(
      and(
        eq(affiliateEvidenceVerifications.prospectId, input.prospectId),
        eq(affiliateEvidenceVerifications.metric, input.metric),
      ),
    )
    .orderBy(desc(affiliateEvidenceVerifications.decidedAt))
    .limit(1);

  const verificationId = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(affiliateEvidenceVerifications)
      .values({
        prospectId: input.prospectId,
        metric: input.metric,
        decision: input.decision,
        detail,
        decidedBy: input.who.actor,
      })
      .returning({ id: affiliateEvidenceVerifications.id });

    await tx.insert(auditEvents).values({
      actor: input.who.actor,
      mfaContext: input.who.mfaContext,
      reauthContext: input.who.reauthContext,
      targetType: 'affiliate_prospect',
      targetId: input.prospectId,
      action: CREATOR_METRIC_DECIDED,
      internalReason: detail,
      // Read from the record inside the write (§33.12.4), never supplied.
      priorValue: { metric: input.metric, decision: prior?.decision ?? 'no recorded decision' },
      newValue: { metric: input.metric, decision: input.decision },
    });

    return row!.id;
  });

  if (input.decision !== 'more_evidence_needed') {
    return { ok: true, verificationId, sent: false, sendReason: null };
  }

  const outcome = await sendCorrectionRequest(
    { db: deps.db, ...deps.asks },
    {
      prospectId: input.prospectId,
      subjectLabel: evidenceMetricLabel(input.metric),
      note: detail,
      entityType: 'affiliate_evidence_verification',
      entityId: verificationId,
    },
  );
  return { ok: true, verificationId, sent: outcome.sent, sendReason: outcome.reason };
}
