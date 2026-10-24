import { Router } from 'express';
import express from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import type { AuditWriter } from '../auth/audit.js';
import { requireAdmin, requireFreshSession } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import { FounderEmailCopyError, isFounderEmailKey, validateFounderEmailCopy } from '../notifications/founder-email-editor/definitions.js';
import { listFounderEmailTemplates, readFounderEmailTemplate, renderFounderEmailVersions } from '../notifications/founder-email-editor/service.js';
import { FounderEmailVersionConflict, saveFounderEmailCopy } from '../notifications/founder-email-editor/store.js';
import { loadFounderEmailPreviewAssets, FounderEmailPreviewAssetsUnavailable } from '../notifications/founder-email-editor/preview-assets.js';

export interface FounderEmailsRouterDeps { db: Database; auth: Auth; audit: AuditWriter; publicDir?: string | undefined }

/** No send operation: editing and sample previews cannot contact a Founder. */
export function createFounderEmailsRouter({ db, auth, audit, publicDir }: FounderEmailsRouterDeps): Router {
  const router = Router();
  const guard = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json = express.json({ limit: '40kb' });
  const base = '/api/admin/founder-emails';
  router.use(base, (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  const previewAssets = () => publicDir ? loadFounderEmailPreviewAssets(publicDir) : undefined;

  router.get(base, guard, async (_req, res, next) => {
    try {
      res.json({ templates: await listFounderEmailTemplates(db, await previewAssets()) });
    } catch (error) {
      if (error instanceof FounderEmailPreviewAssetsUnavailable) { res.status(503).json({ error: 'email_preview_assets_unavailable', title: 'The original email artwork is unavailable.', next: 'Restore the app’s email preview assets and try again.' }); return; }
      next(error);
    }
  });

  router.post(`${base}/:key/preview`, guard, json, async (req, res, next) => {
    const key = String(req.params['key'] ?? '');
    if (!isFounderEmailKey(key)) { res.status(404).json({ error: 'unknown_founder_email', title: 'That email is not available.' }); return; }
    try {
      const copy = validateFounderEmailCopy(key, (req.body as { copy?: unknown } | undefined)?.copy);
      res.json(await renderFounderEmailVersions(key, copy, await previewAssets()));
    } catch (error) {
      if (error instanceof FounderEmailPreviewAssetsUnavailable) { res.status(503).json({ error: 'email_preview_assets_unavailable', title: 'The original email artwork is unavailable.', next: 'Restore the app’s email preview assets and try again.' }); return; }
      if (error instanceof FounderEmailCopyError) { res.status(400).json({ error: 'invalid_email_copy', title: error.message, fields: error.fields }); return; }
      next(error);
    }
  });

  router.put(`${base}/:key`, guard, fresh, json, async (req, res, next) => {
    const key = String(req.params['key'] ?? '');
    if (!isFounderEmailKey(key)) { res.status(404).json({ error: 'unknown_founder_email', title: 'That email is not available.' }); return; }
    try {
      const body = req.body as { copy?: unknown; version?: unknown; changeNote?: unknown } | undefined;
      if (!body || !Number.isSafeInteger(body.version) || Number(body.version) < 0 || Number(body.version) > 10_000_000) {
        res.status(400).json({ error: 'invalid_version', title: 'Reload the email before saving.' }); return;
      }
      if (body.changeNote !== undefined && (typeof body.changeNote !== 'string' || body.changeNote.length > 1000)) {
        res.status(400).json({ error: 'invalid_change_note', title: 'Use a change note of 1,000 characters or fewer.' }); return;
      }
      const copy = validateFounderEmailCopy(key, body.copy);
      // Check preview availability before saving, so an artwork failure never disguises a successful save.
      const assets = await previewAssets();
      await saveFounderEmailCopy(db, audit, { key, copy, version: Number(body.version), changeNote: typeof body.changeNote === 'string' ? body.changeNote : '', actorId: req.authUser!.id });
      res.json({ template: await readFounderEmailTemplate(db, key, assets) });
    } catch (error) {
      if (error instanceof FounderEmailPreviewAssetsUnavailable) { res.status(503).json({ error: 'email_preview_assets_unavailable', title: 'The original email artwork is unavailable.', next: 'No changes were saved. Restore the app’s email preview assets and try again.' }); return; }
      if (error instanceof FounderEmailCopyError) { res.status(400).json({ error: 'invalid_email_copy', title: error.message, fields: error.fields }); return; }
      if (error instanceof FounderEmailVersionConflict) { res.status(409).json({ error: 'email_copy_conflict', title: 'Someone saved a newer version.', next: 'Keep your edits, reload the saved version, and compare before saving again.' }); return; }
      next(error);
    }
  });
  return router;
}
